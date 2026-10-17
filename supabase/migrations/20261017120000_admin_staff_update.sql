-- تعديل موظف من شاشة مدير المنصة (الاسم والدور والفرع) عبر الخادم.
-- السبب: الشاشة كانت تكتب في app_users مباشرة من المتصفح، والكتابة المباشرة مسحوبة منذ حماية الرموز (20261008120000)،
-- فيفشل كل تعديل بـ «permission denied for table app_users»؛ والإضافة تعمل لأنها عبر admin_staff_create.
-- لا منح عام على app_users: دالة واحدة لمدير المنصة النشط وحده، على مستخدم منشأة (لا مدير منصة)، ولا تمس الرمز ولا الحالة ولا الربط.
-- كل تعديل يُسجَّل في approval_private.user_status_changes (set_access) باسم مدير المنصة.

create function staff_private.admin_update_user(p_user_id uuid, p_name text, p_role text, p_branch text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; me record; t record; v_name text := btrim(coalesce(p_name, '')); v_branch text := nullif(btrim(coalesce(p_branch, '')), '');
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role is distinct from 'superadmin' then return approval_private.err('forbidden'); end if;
  if v_name = '' or length(v_name) > 200 then return approval_private.err('invalid_name'); end if;
  if p_role is null or p_role not in ('owner', 'accountant', 'purchasing', 'cashier') then return approval_private.err('forbidden'); end if;
  if v_branch is not null and length(v_branch) > 200 then return approval_private.err('invalid'); end if;

  select u.auth_id, u.role, u.is_active, u.name into me from public.app_users u where u.id = a.id;
  if not found or me.auth_id is distinct from auth.uid() or not me.is_active or me.role is distinct from 'superadmin' then
    return approval_private.err('no_session');
  end if;

  select u.id, u.project_id, u.name, u.role, u.branch into t from public.app_users u where u.id = p_user_id for update;
  if not found or t.project_id is null or t.role = 'superadmin' then return approval_private.err('not_found'); end if;

  update public.app_users set name = v_name, role = p_role, branch = v_branch where id = t.id;
  insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason, actor_id, actor_name, actor_role)
  values (t.project_id, t.id, v_name, p_role, 'set_access',
          format('مدير المنصة: الاسم %s، الدور %s، الفرع %s (كان: %s، %s، %s)', v_name, p_role, coalesce(v_branch, 'كل الفروع'),
                 t.name, t.role, coalesce(t.branch, 'كل الفروع')), a.id, me.name, 'superadmin');
  return jsonb_build_object('ok', true, 'id', t.id);
exception when others then
  return jsonb_build_object('ok', false, 'code', 'save_failed');
end $$;
revoke all on function staff_private.admin_update_user(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function staff_private.admin_update_user(uuid, text, text, text) to authenticated;

create function public.admin_staff_update(p_user_id uuid, p_name text, p_role text, p_branch text)
returns jsonb language sql security invoker set search_path = '' as $$
  select staff_private.admin_update_user(p_user_id, p_name, p_role, p_branch)
$$;
revoke all on function public.admin_staff_update(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_staff_update(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
