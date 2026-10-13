-- عرض بيانات منشأة لمدير المنصة، للقراءة فقط (بعد 20261009120000).
--
-- السبب (مُثبت محليًا على بنية الإنتاج): «دخول» من لوحة المنصة يغيّر المنشأة في المتصفح وحده. سياسات القراءة تحصر الصفوف في
-- project_id = auth_project_id()، وهي من حساب المستخدم في app_users، ومدير المنصة بلا منشأة، فتعود كل القراءات فارغة بلا خطأ
-- (المالك: 258 قيدًا و55 تقرير مبيعات؛ مدير المنصة بالطلب نفسه: 0)، وتعرضها الصفحات أصفارًا.
--
-- الإصلاح بأقل تعديل:
--   • المنشأة المختارة تصل مع كل طلب في الترويسة x-tahseeb-view-project. الترويسة لا تمنح شيئًا وحدها: auth_view_project_id()
--     تعيدها فقط إن كان صاحب الجلسة مدير منصة نشطًا (من app_users بهوية auth.uid() في الخادم)، وإلا NULL.
--   • سياسة قراءة إضافية (SELECT فقط) على جداول بيانات المنشأة: project_id = auth_view_project_id(). سياسات الكتابة والاعتماد كما هي،
--     وauth_project_id() كما هي، فلا تتسع أي صلاحية تعديل. حسابات المنشآت لا يتغير لها شيء (الدالة تعيد NULL لهم).
--   • admin_view_project(p): يتحقق في الخادم أن المستدعي مدير منصة نشط والمنشأة موجودة، ويُثبت أن الترويسة وصلت إلى سياسات القراءة،
--     فتعرف الواجهة الرفض من الصفر الحقيقي قبل عرض أي رقم.
create function public.auth_view_project_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select case
    when (current_setting('request.headers', true)::json ->> 'x-tahseeb-view-project') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and exists (select 1 from public.app_users where auth_id = auth.uid() and role = 'superadmin' and is_active)
    then (current_setting('request.headers', true)::json ->> 'x-tahseeb-view-project')::uuid
  end
$$;
revoke all on function public.auth_view_project_id() from public, anon;
grant execute on function public.auth_view_project_id() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['ledger_entries', 'documents', 'document_items', 'sales', 'attachments', 'payable_suppliers', 'supplier_transactions',
                           'suppliers', 'quick_sales_draft'] loop
    execute format('create policy %I on public.%I for select to authenticated using (project_id = (select public.auth_view_project_id()))',
                   t || '_superadmin_view_select', t);
  end loop;
end $$;

create function public.admin_view_project(p_project_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a record; v_name text;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role is distinct from 'superadmin' then return approval_private.err('forbidden'); end if;
  select name into v_name from public.projects where id = p_project_id;
  if not found then return approval_private.err('not_found'); end if;
  -- الترويسة نفسها يجب أن تصل إلى سياسات القراءة؛ وإلا فالعرض سيعيد أصفارًا مضللة
  if public.auth_view_project_id() is distinct from p_project_id then return approval_private.err('view_not_applied'); end if;
  return jsonb_build_object('ok', true, 'project_id', p_project_id, 'name', v_name);
end $$;
revoke all on function public.admin_view_project(uuid) from public, anon;
grant execute on function public.admin_view_project(uuid) to authenticated;

notify pgrst, 'reload schema';
