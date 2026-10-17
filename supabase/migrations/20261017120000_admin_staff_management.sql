-- إدارة مستخدمي المنشآت من شاشة مدير المنصة، كلها عبر الخادم (لا كتابة مباشرة في app_users من المتصفح):
--   الإضافة، وتعديل الاسم والدور والفرع، وإعادة تعيين الرمز، والتعطيل وإعادة التفعيل، والحذف (أو الأرشفة إن كانت للحساب عمليات).
-- السبب الأصلي: التعديل كان يكتب في app_users مباشرة، والكتابة المباشرة مسحوبة منذ حماية الرموز (20261008120000)، فيفشل بـ
-- «permission denied for table app_users».
-- القواعد على الخادم:
--   • مدير المنصة النشط وحده (actor + auth_id = auth.uid())، وعلى مستخدم منشأة لا مدير منصة. لا منح عام على app_users.
--   • الفرع: فارغ = كل الفروع، وإلا من فروع المنشأة المحفوظة. المالك لكل الفروع؛ والكاشير لفرع محدد إن كانت للمنشأة فروع.
--   • لا يُعطَّل ولا يُحذف ولا يُحوَّل آخر مالك نشط في المنشأة (last_owner)؛ يُضاف مالك آخر أولًا.
--   • الرمز: 5 أرقام، لا يكرر رمزًا في المنشأة ولا رمز مدير منصة (staff_private.set_pin_admin)، ويُخزَّن للتحقق وحده.
--     بعد تغييره تُلغى جلسات الحساب: الحساب الاصطناعي لدخول الرمز يُفصل ويُحذف (فيسقط أي رمز جلسة قائم فورًا ويُنشأ جديد
--     عند الدخول التالي)، وغير الاصطناعي تُحذف جلساته.
--   • التعطيل يمنع الاستعمال فورًا (كل دوال الهوية تشترط is_active) وتُحذف جلساته؛ والدخول يرفض المعطّل.
--   • الحذف للحساب بلا عمليات ولا ارتباطات؛ وإلا يُؤرشف: يُعطَّل ويبقى اسمه وتاريخه في السجلات.
--   • كل تغيير يُسجَّل في approval_private.user_status_changes بلا أسرار (لا رمز ولا تجزئته).

alter table approval_private.user_status_changes drop constraint if exists user_status_changes_action_check;
alter table approval_private.user_status_changes add constraint user_status_changes_action_check
  check (action in ('deactivate', 'reactivate', 'create', 'set_access', 'set_pin', 'delete', 'archive'));

-- ── المراجع: ما يدل على أن للحساب عمليات أو ارتباطات تستلزم حفظه ───────────────────────────────────────
create function staff_private.user_references(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'documents', nullif((select count(*) from public.documents where created_by_user_id = p_user_id or approved_by = p_user_id), 0),
    'documents_by_name', nullif((select count(*) from public.documents d join public.app_users u on u.id = p_user_id
        where d.project_id = u.project_id and d.created_by_user_id is null and d.uploaded_by_name = u.name), 0),
    'ledger', nullif((select count(*) from public.ledger_entries where created_by_user_id = p_user_id), 0),
    'sales', nullif((select count(*) from public.sales where created_by_user_id = p_user_id), 0),
    'analysis_targets', nullif((select count(*) from public.analysis_targets where created_by = p_user_id), 0),
    'item_rules', nullif((select count(*) from public.item_category_rules where updated_by = p_user_id), 0),
    'deactivated_others', nullif((select count(*) from public.app_users where deactivated_by = p_user_id), 0),
    'approvals', nullif((select count(*) from approval_private.requests where actor_id = p_user_id)
                      + (select count(*) from approval_private.document_invoices where decided_by = p_user_id)
                      + (select count(*) from approval_private.sales_report_revisions where actor_id = p_user_id), 0),
    'settings', nullif((select count(*) from approval_private.settings where updated_by = p_user_id)
                     + (select count(*) from approval_private.category_changes where actor_id = p_user_id)
                     + (select count(*) from approval_private.bank_account_links where actor_id = p_user_id), 0),
    'supplier_payments', nullif((select count(*) from approval_private.supplier_payment_requests where deleted_by = p_user_id), 0),
    'staff_actions', nullif((select count(*) from approval_private.user_status_changes where actor_id = p_user_id), 0)))
$$;
revoke all on function staff_private.user_references(uuid) from public, anon, authenticated, service_role;

-- ── إلغاء جلسات الحساب ───────────────────────────────────────────────────────────────────────────────────
create function staff_private.revoke_user_sessions(p_user_id uuid, p_unlink boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare v_auth uuid; v_email text;
begin
  select auth_id into v_auth from public.app_users where id = p_user_id;
  if v_auth is null then return 'none'; end if;
  select email into v_email from auth.users where id = v_auth;
  if p_unlink and v_email like 'u-%@pin.internal.tahseeb.app' then
    update public.app_users set auth_id = null where id = p_user_id;
    delete from auth.users where id = v_auth;   -- يحذف معه جلساته ورموز تجديدها
    return 'revoked_now';
  end if;
  delete from auth.sessions where user_id = v_auth;
  return 'sessions_deleted';
end $$;
revoke all on function staff_private.revoke_user_sessions(uuid, boolean) from public, anon, authenticated, service_role;

-- ── الدالة الواحدة لعمليات مدير المنصة على مستخدمي المنشآت ───────────────────────────────────────────────
create function staff_private.admin_write_user(p_action text, p_project_id uuid, p_user_id uuid, p_name text, p_role text, p_branch text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; me record; t record; v_project uuid; v_name text := btrim(coalesce(p_name, '')); v_branch text := nullif(btrim(coalesce(p_branch, '')), '');
        v_branches jsonb; k_h text; k_d text; v_until timestamptz; v_id uuid; v_res jsonb; v_refs jsonb; v_sessions text; v_rules boolean := p_action = 'create';
        role_ar constant jsonb := '{"owner": "المالك", "accountant": "المحاسب", "purchasing": "المشتريات", "cashier": "الكاشير"}';
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role is distinct from 'superadmin' then return approval_private.err('forbidden'); end if;
  if p_action is null or p_action not in ('create', 'update', 'set_pin', 'deactivate', 'reactivate', 'remove') then return approval_private.err('invalid'); end if;

  -- المنشأة: من المستخدم المستهدف (لا من الطلب) في كل ما عدا الإضافة
  if p_action = 'create' then
    v_project := p_project_id;
    if v_project is null or not exists (select 1 from public.projects where id = v_project) then return approval_private.err('not_found'); end if;
  else
    select u.project_id into v_project from public.app_users u where u.id = p_user_id;
    if v_project is null then return approval_private.err('not_found'); end if;
  end if;

  -- ترتيب الأقفال نفسه في المسارات الأخرى: تسلسل عمليات الموظفين داخل المنشأة
  perform 1 from public.app_users where project_id = v_project order by id for update;
  select u.auth_id, u.role, u.is_active, u.name into me from public.app_users u where u.id = a.id;
  if not found or me.auth_id is distinct from auth.uid() or not me.is_active or me.role is distinct from 'superadmin' then
    return approval_private.err('no_session');
  end if;
  if p_action <> 'create' then
    select u.id, u.project_id, u.name, u.role, u.branch, u.is_active, u.created_at into t from public.app_users u where u.id = p_user_id;
    if not found or t.project_id is distinct from v_project or t.role = 'superadmin' then return approval_private.err('not_found'); end if;
  end if;

  -- الاسم والدور والفرع (الإضافة والتعديل)
  if p_action in ('create', 'update') then
    if v_name = '' or length(v_name) > 200 then return approval_private.err('invalid_name'); end if;
    if p_role is null or p_role not in ('owner', 'accountant', 'purchasing', 'cashier') then return approval_private.err('invalid_role'); end if;
  end if;
  -- قواعد الدور والفرع عند الإضافة، وعند التعديل إن تغيّر الدور أو الفرع (فرع قديم محفوظ قبل قائمة الفروع يبقى كما هو عند تعديل الاسم وحده)
  -- (t لا يُقرأ عند الإضافة: لا مستخدم مستهدف بعد)
  if p_action = 'update' then v_rules := p_role is distinct from t.role or v_branch is distinct from t.branch; end if;
  if v_rules then
    select ps.settings -> 'branches' into v_branches from public.project_settings ps where ps.project_id = v_project;
    if v_branch is not null and (jsonb_typeof(v_branches) is distinct from 'array' or not (v_branches ? v_branch)) then return approval_private.err('invalid_branch'); end if;
    if p_role = 'owner' and v_branch is not null then return approval_private.err('owner_all_branches'); end if;
    if p_role = 'cashier' and v_branch is null and jsonb_typeof(v_branches) = 'array' and jsonb_array_length(v_branches) > 0 then
      return approval_private.err('branch_required');
    end if;
  end if;

  -- آخر مالك نشط: لا يُعطَّل ولا يُحذف ولا يُحوَّل
  if p_action in ('update', 'deactivate', 'remove') then
    if t.role = 'owner' and t.is_active and (p_action <> 'update' or p_role <> 'owner')
       and not exists (select 1 from public.app_users u where u.project_id = v_project and u.role = 'owner' and u.is_active and u.id <> t.id) then
      return approval_private.err('last_owner');
    end if;
  end if;

  -- الحد نفسه لعمليات فحص الرموز في المنشأة (يشترك فيه مسار المالك وإضافة المدير)
  if p_action in ('create', 'set_pin') then
    if p_pin is null or p_pin !~ '^[0-9]{5}$' then return approval_private.err('invalid_pin'); end if;
    k_h := 'staff:tenant:h:' || v_project; k_d := 'staff:tenant:d:' || v_project;
    if auth_private.peek(k_h, interval '1 hour') >= 10 then v_until := auth_private.window_end(k_h, interval '1 hour'); end if;
    if auth_private.peek(k_d, interval '24 hours') >= 30 then v_until := greatest(v_until, auth_private.window_end(k_d, interval '24 hours')); end if;
    if v_until is not null then return jsonb_build_object('ok', false, 'code', 'try_later', 'retry_after', auth_private.seconds_until(v_until)); end if;
    perform auth_private.bump(k_h, interval '1 hour');
    perform auth_private.bump(k_d, interval '24 hours');
  end if;

  if p_action = 'create' then
    insert into public.app_users (project_id, name, role, branch) values (v_project, v_name, p_role, v_branch) returning id into v_id;
    v_res := staff_private.set_pin_admin(v_id, p_pin);
    if not coalesce((v_res ->> 'ok')::boolean, false) then raise exception using errcode = 'P0001', message = coalesce(v_res ->> 'code', 'save_failed'); end if;
    insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason, actor_id, actor_name, actor_role)
    values (v_project, v_id, v_name, p_role, 'create', 'مدير المنصة: ' || coalesce(v_branch, 'كل الفروع'), a.id, me.name, 'superadmin');
    return jsonb_build_object('ok', true, 'id', v_id);

  elsif p_action = 'update' then
    if t.name = v_name and t.role = p_role and t.branch is not distinct from v_branch then return jsonb_build_object('ok', true, 'id', t.id, 'unchanged', true); end if;
    update public.app_users set name = v_name, role = p_role, branch = v_branch where id = t.id;
    insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason, actor_id, actor_name, actor_role)
    values (v_project, t.id, v_name, p_role, 'set_access',
            format('مدير المنصة: %s، %s، %s ← %s، %s، %s', t.name, coalesce(role_ar ->> t.role, t.role), coalesce(t.branch, 'كل الفروع'),
                   v_name, coalesce(role_ar ->> p_role, p_role), coalesce(v_branch, 'كل الفروع')), a.id, me.name, 'superadmin');
    return jsonb_build_object('ok', true, 'id', t.id);

  elsif p_action = 'set_pin' then
    v_res := staff_private.set_pin_admin(t.id, p_pin);
    if not coalesce((v_res ->> 'ok')::boolean, false) then return v_res; end if;
    v_sessions := staff_private.revoke_user_sessions(t.id, true);
    insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason, actor_id, actor_name, actor_role)
    values (v_project, t.id, t.name, t.role, 'set_pin', 'مدير المنصة: رمز جديد وإلغاء الجلسات', a.id, me.name, 'superadmin');
    return jsonb_build_object('ok', true, 'id', t.id, 'sessions', v_sessions);

  elsif p_action = 'deactivate' then
    if not t.is_active then return jsonb_build_object('ok', true, 'id', t.id, 'unchanged', true); end if;
    update public.app_users set is_active = false, deactivated_at = now(), deactivated_by = a.id where id = t.id;
    v_sessions := staff_private.revoke_user_sessions(t.id, false);
    insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason, actor_id, actor_name, actor_role)
    values (v_project, t.id, t.name, t.role, 'deactivate', 'مدير المنصة', a.id, me.name, 'superadmin');
    return jsonb_build_object('ok', true, 'id', t.id, 'sessions', v_sessions);

  elsif p_action = 'reactivate' then
    if t.is_active then return jsonb_build_object('ok', true, 'id', t.id, 'unchanged', true); end if;
    update public.app_users set is_active = true, deactivated_at = null, deactivated_by = null where id = t.id;
    insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason, actor_id, actor_name, actor_role)
    values (v_project, t.id, t.name, t.role, 'reactivate', 'مدير المنصة', a.id, me.name, 'superadmin');
    return jsonb_build_object('ok', true, 'id', t.id);

  else -- remove: حذف إن لم تكن له عمليات ولا ارتباطات، وإلا أرشفة
    v_refs := staff_private.user_references(t.id);
    if v_refs = '{}'::jsonb then
      v_sessions := staff_private.revoke_user_sessions(t.id, true);
      delete from public.app_users where id = t.id;   -- يحذف معه رمزه المخزن (pin_credentials)
      insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason, actor_id, actor_name, actor_role)
      values (v_project, t.id, t.name, t.role, 'delete', format('مدير المنصة: حساب بلا عمليات (أُنشئ %s)', to_char(t.created_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI')),
              a.id, me.name, 'superadmin');
      return jsonb_build_object('ok', true, 'id', t.id, 'result', 'deleted');
    end if;
    update public.app_users set is_active = false, deactivated_at = coalesce(deactivated_at, now()), deactivated_by = coalesce(deactivated_by, a.id) where id = t.id;
    v_sessions := staff_private.revoke_user_sessions(t.id, false);
    insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason, actor_id, actor_name, actor_role)
    values (v_project, t.id, t.name, t.role, 'archive', 'مدير المنصة: له عمليات مسجلة (' || (select string_agg(k, '، ' order by k) from jsonb_object_keys(v_refs) k) || ')',
            a.id, me.name, 'superadmin');
    return jsonb_build_object('ok', true, 'id', t.id, 'result', 'archived', 'references', v_refs);
  end if;
exception when others then
  if sqlerrm in ('pin_in_use', 'invalid_pin') then return approval_private.err(sqlerrm); end if;
  return jsonb_build_object('ok', false, 'code', 'save_failed');
end $$;
revoke all on function staff_private.admin_write_user(text, uuid, uuid, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function staff_private.admin_write_user(text, uuid, uuid, text, text, text, text) to authenticated;

-- ── واجهات الشاشة (بصلاحية المستدعي؛ الفحص كله في admin_write_user) ───────────────────────────────────────
create or replace function public.admin_staff_create(p_project_id uuid, p_name text, p_role text, p_branch text, p_pin text)
returns jsonb language sql security invoker set search_path = '' as $$
  select staff_private.admin_write_user('create', p_project_id, null, p_name, p_role, p_branch, p_pin)
$$;
create function public.admin_staff_update(p_user_id uuid, p_name text, p_role text, p_branch text)
returns jsonb language sql security invoker set search_path = '' as $$
  select staff_private.admin_write_user('update', null, p_user_id, p_name, p_role, p_branch, null)
$$;
create function public.admin_staff_set_pin(p_user_id uuid, p_pin text)
returns jsonb language sql security invoker set search_path = '' as $$
  select staff_private.admin_write_user('set_pin', null, p_user_id, null, null, null, p_pin)
$$;
create function public.admin_staff_set_active(p_user_id uuid, p_active boolean)
returns jsonb language sql security invoker set search_path = '' as $$
  select staff_private.admin_write_user(case when p_active then 'reactivate' else 'deactivate' end, null, p_user_id, null, null, null, null)
$$;
create function public.admin_staff_remove(p_user_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select staff_private.admin_write_user('remove', null, p_user_id, null, null, null, null)
$$;
revoke all on function public.admin_staff_create(uuid, text, text, text, text), public.admin_staff_update(uuid, text, text, text),
  public.admin_staff_set_pin(uuid, text), public.admin_staff_set_active(uuid, boolean), public.admin_staff_remove(uuid) from public, anon, authenticated;
grant execute on function public.admin_staff_create(uuid, text, text, text, text), public.admin_staff_update(uuid, text, text, text),
  public.admin_staff_set_pin(uuid, text), public.admin_staff_set_active(uuid, boolean), public.admin_staff_remove(uuid) to authenticated;

-- ── قائمة مستخدمي المنشأة لمدير المنصة: + تاريخ الإنشاء وتاريخ التعطيل (للتمييز بين حسابين بالاسم نفسه) وفروع المنشأة ──
create or replace function public.admin_project_users(p_project_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a record;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role is distinct from 'superadmin' then return approval_private.err('forbidden'); end if;
  if p_project_id is null then return approval_private.err('invalid'); end if;
  if not exists (select 1 from public.projects where id = p_project_id) then return approval_private.err('not_found'); end if;
  return jsonb_build_object('ok', true, 'project_id', p_project_id,
    'branches', coalesce((select case when jsonb_typeof(ps.settings -> 'branches') = 'array' then ps.settings -> 'branches' end
                            from public.project_settings ps where ps.project_id = p_project_id), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'role', u.role, 'branch', u.branch, 'is_active', u.is_active,
                                          'created_at', u.created_at, 'deactivated_at', u.deactivated_at)
               order by u.role, u.name, u.created_at, u.id)
        from public.app_users u where u.project_id = p_project_id), '[]'::jsonb));
end $$;

notify pgrst, 'reload schema';
