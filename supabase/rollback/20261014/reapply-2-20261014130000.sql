-- إعادة تطبيق 20261014130000 بعد الرجوع: الترحيل نفسه بصيغة آمنة للتكرار (مولّد من نصه، لا كتابة يدوية).
-- الترتيب: reapply-1 (120000) ثم reapply-2 (130000) ثم reapply-3 (140000).
\set ON_ERROR_STOP on
begin;
-- إدارة الموظفين لمالك المنشأة (تجهيز عميل جديد، 2026-10-14).
-- كان المالك يعطّل الموظف ويعيد تفعيله فقط (20260930000000)، والإضافة وتغيير الرمز للمحاسب وحده (write_user)، وتغيير الدور والفرع
-- بلا مسار. الآن للمالك الفعلي النشط، في منشأته وحدها: إضافة موظف (محاسب/مشتريات/كاشير) بفرع من فروع المنشأة أو لكل الفروع،
-- وتغيير دوره وفرعه، وتعيين رمز جديد له. لا يُنشئ مالكًا ولا مدير منصة، ولا يمس حساب مالك. كل التحقق من الخادم: هوية المنفّذ ومنشأته
-- من الجلسة لا من الطلب، والفرع من قائمة فروع المنشأة المحفوظة، وحد العمليات ومنع تكرار الرمز كمسار المحاسب نفسه، وسجل لكل تغيير.
-- مسار المحاسب (staff_create/staff_set_pin) ومسار مدير المنصة لا يتغيران.

-- ── سجل التغييرات: الأنواع الجديدة بجانب التعطيل وإعادة التفعيل ─────────────────────────────────────────────
alter table approval_private.user_status_changes drop constraint if exists user_status_changes_action_check;
alter table approval_private.user_status_changes add constraint user_status_changes_action_check
  check (action in ('deactivate', 'reactivate', 'create', 'set_access', 'set_pin'));

-- ── الدالة الواحدة لعمليات المالك ─────────────────────────────────────────────────────────────────────────
create or replace function staff_private.owner_write_user(p_action text, p_user_id uuid, p_name text, p_role text, p_branch text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; me record; t record; v_id uuid; k_h text; k_d text; v_until timestamptz; v_mac text; v_branch text; v_branches jsonb;
        v_detail text;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role is distinct from 'owner' or a.project_id is null then return approval_private.err('forbidden'); end if;
  if p_action is null or p_action not in ('create', 'set_access', 'set_pin') then return approval_private.err('invalid'); end if;
  if p_action in ('create', 'set_access') then
    if p_role is null or p_role not in ('accountant', 'purchasing', 'cashier') then return approval_private.err('invalid_role'); end if;
    -- الفرع: فارغ = كل الفروع؛ وإلا يجب أن يكون من فروع المنشأة المحفوظة (لا فرع مختلق ولا فرع منشأة أخرى)
    v_branch := nullif(btrim(coalesce(p_branch, '')), '');
    if v_branch is not null then
      select ps.settings -> 'branches' into v_branches from public.project_settings ps where ps.project_id = a.project_id;
      if jsonb_typeof(v_branches) is distinct from 'array' or not (v_branches ? v_branch) then return approval_private.err('invalid_branch'); end if;
    end if;
  end if;
  if p_action in ('create', 'set_pin') and (p_pin is null or p_pin !~ '^[0-9]{5}$') then return approval_private.err('invalid_pin'); end if;
  if p_action = 'create' and (p_name is null or btrim(p_name) = '' or length(btrim(p_name)) > 200) then return approval_private.err('invalid_name'); end if;
  if p_action <> 'create' and p_user_id is null then return approval_private.err('invalid'); end if;

  -- ترتيب الأقفال نفسه في المسارات الأخرى: تسلسل عمليات الموظفين داخل المنشأة
  perform 1 from public.app_users where project_id = a.project_id order by id for update;
  select u.auth_id, u.role, u.project_id, u.is_active, u.name into me from public.app_users u where u.id = a.id;
  if not found or me.auth_id is distinct from auth.uid() or not me.is_active then return approval_private.err('no_session'); end if;
  if me.role is distinct from 'owner' or me.project_id is distinct from a.project_id then return approval_private.err('forbidden'); end if;

  if p_action <> 'create' then
    select u.id, u.project_id, u.role, u.name, u.branch, u.is_active into t from public.app_users u where u.id = p_user_id;
    -- لا يُكشف وجود مستخدم خارج المنشأة، ولا يُدار مالك أو مدير منصة من هنا
    if not found or t.project_id is distinct from a.project_id or t.role not in ('accountant', 'purchasing', 'cashier') then
      return approval_private.err('not_found');
    end if;
  end if;

  if p_action = 'set_access' then
    -- آخر محاسب نشط لا يُحوَّل إلى دور آخر (الاعتماد وإدارة المستخدمين للمحاسب)؛ يُضاف محاسب أولًا
    if t.role = 'accountant' and p_role <> 'accountant' and t.is_active
       and not exists (select 1 from public.app_users u where u.project_id = a.project_id and u.role = 'accountant' and u.is_active and u.id <> t.id) then
      return approval_private.err('last_accountant');
    end if;
    if t.role = p_role and t.branch is not distinct from v_branch then return jsonb_build_object('ok', true, 'id', t.id, 'unchanged', true); end if;
    update public.app_users set role = p_role, branch = v_branch where id = t.id;
    -- بالعربية، والسهم من القديم إلى الجديد في سياق الكتابة من اليمين
    v_detail := (select string_agg(case r when 'accountant' then 'المحاسب' when 'purchasing' then 'المشتريات' when 'cashier' then 'الكاشير' else r end, ' ← ' order by o)
                   from (values (t.role, 1), (p_role, 2)) x(r, o))
             || ' · ' || coalesce(t.branch, 'كل الفروع') || ' ← ' || coalesce(v_branch, 'كل الفروع');
    insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason, actor_id, actor_name, actor_role)
    values (a.project_id, t.id, t.name, p_role, 'set_access', v_detail, a.id, me.name, 'owner');
    return jsonb_build_object('ok', true, 'id', t.id);
  end if;

  -- الإضافة وتعيين الرمز: الحد نفسه لعمليات فحص الرموز في المنشأة (يشترك فيه المحاسب ومدير المنصة)، يُحتسب قبل الفحص
  k_h := 'staff:tenant:h:' || a.project_id;
  k_d := 'staff:tenant:d:' || a.project_id;
  if auth_private.peek(k_h, interval '1 hour') >= 10 then v_until := auth_private.window_end(k_h, interval '1 hour'); end if;
  if auth_private.peek(k_d, interval '24 hours') >= 30 then v_until := greatest(v_until, auth_private.window_end(k_d, interval '24 hours')); end if;
  if v_until is not null then
    return jsonb_build_object('ok', false, 'code', 'try_later', 'retry_after', auth_private.seconds_until(v_until));
  end if;
  perform auth_private.bump(k_h, interval '1 hour');
  perform auth_private.bump(k_d, interval '24 hours');

  perform staff_private.pin_scope_lock(false);
  v_mac := staff_private.pin_mac(p_pin);
  if exists (select 1 from (select c.pin_hash from public.app_users u join staff_private.pin_credentials c on c.user_id = u.id
      where u.project_id = a.project_id and (p_action = 'create' or u.id <> p_user_id) offset 0) k where staff_private.pin_ok(v_mac, k.pin_hash))
     or staff_private.pin_taken_by_superadmin(v_mac, null) then
    return approval_private.err('pin_in_use');
  end if;

  begin
    if p_action = 'create' then
      insert into public.app_users(project_id, name, role, branch) values (a.project_id, btrim(p_name), p_role, v_branch) returning id into v_id;
      insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason, actor_id, actor_name, actor_role)
      values (a.project_id, v_id, btrim(p_name), p_role, 'create', coalesce(v_branch, 'كل الفروع'), a.id, me.name, 'owner');
    else
      v_id := t.id;
      insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason, actor_id, actor_name, actor_role)
      values (a.project_id, t.id, t.name, t.role, 'set_pin', null, a.id, me.name, 'owner');
    end if;
    insert into staff_private.pin_credentials (user_id, pin_hash) values (v_id, staff_private.pin_hash_of(v_mac))
      on conflict (user_id) do update set pin_hash = excluded.pin_hash, updated_at = now();
  exception when others then
    -- تُلغى الكتابة وحدها؛ احتساب العملية باقٍ
    return jsonb_build_object('ok', false, 'code', 'save_failed');
  end;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when others then
  -- أخطاء القيود قد تتضمن الصف كاملًا؛ لا تُرجع SQLERRM
  return jsonb_build_object('ok', false, 'code', 'save_failed');
end $$;
revoke all on function staff_private.owner_write_user(text, uuid, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function staff_private.owner_write_user(text, uuid, text, text, text, text) to authenticated;

create or replace function public.team_staff_create(p_name text, p_role text, p_branch text, p_pin text)
returns jsonb language sql security invoker set search_path = '' as $$
  select staff_private.owner_write_user('create', null, p_name, p_role, p_branch, p_pin)
$$;
create or replace function public.team_staff_set_access(p_user_id uuid, p_role text, p_branch text)
returns jsonb language sql security invoker set search_path = '' as $$
  select staff_private.owner_write_user('set_access', p_user_id, null, p_role, p_branch, null)
$$;
create or replace function public.team_staff_set_pin(p_user_id uuid, p_pin text)
returns jsonb language sql security invoker set search_path = '' as $$
  select staff_private.owner_write_user('set_pin', p_user_id, null, null, null, p_pin)
$$;
revoke all on function public.team_staff_create(text, text, text, text), public.team_staff_set_access(uuid, text, text),
  public.team_staff_set_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.team_staff_create(text, text, text, text), public.team_staff_set_access(uuid, text, text),
  public.team_staff_set_pin(uuid, text) to authenticated;

-- ── قائمة الفريق للمالك: ومعها فروع المنشأة لاختيار الفرع ─────────────────────────────────────────────────
create or replace function public.team_members() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a record;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role is distinct from 'owner' or a.project_id is null then return approval_private.err('forbidden'); end if;
  return jsonb_build_object('ok', true, 'me', a.id,
    'branches', coalesce((select case when jsonb_typeof(ps.settings -> 'branches') = 'array' then ps.settings -> 'branches' end
                            from public.project_settings ps where ps.project_id = a.project_id), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'role', u.role, 'branch', u.branch,
               'is_active', u.is_active, 'deactivated_at', u.deactivated_at, 'deactivated_by', d.name, 'is_self', u.id = a.id)
               order by u.is_active desc, case u.role when 'owner' then 0 when 'accountant' then 1 when 'purchasing' then 2 else 3 end, u.created_at)
        from public.app_users u left join public.app_users d on d.id = u.deactivated_by
       where u.project_id = a.project_id and u.role <> 'superadmin'), '[]'::jsonb),
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'user', c.user_name, 'action', c.action, 'reason', c.reason,
               'by', c.actor_name, 'at', c.created_at) order by c.created_at desc, c.id desc)
        from (select * from approval_private.user_status_changes
               where project_id = a.project_id order by created_at desc, id desc limit 20) c), '[]'::jsonb));
end $$;

notify pgrst, 'reload schema';

commit;
