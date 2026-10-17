-- رجوع 20261017120000 (إدارة مستخدمي المنشآت من شاشة مدير المنصة). يبقي البيانات:
--   المستخدمون والرموز والسجل كما هي (ومنها صفوف delete/archive في السجل، فيبقى قيد الإجراءات الموسّع).
-- بعده: الإضافة من الشاشة كما كانت (admin_create_user)، والتعديل من الشاشة السابقة يعود إلى الفشل القديم.
-- ودوال الهوية تعود لا تشترط الجلسة (رمز وصول جلسة محذوفة يُقبل في القاعدة حتى انتهائه، كما قبل الإصلاح).
-- يُنفَّذ قبل إرجاع الواجهة أو بعده: الواجهة الجديدة تُظهر رسالة خطأ للإجراءات المسحوبة ولا تحفظ شيئًا.
\set ON_ERROR_STOP on
begin;
create or replace function public.admin_staff_create(p_project_id uuid, p_name text, p_role text, p_branch text, p_pin text)
returns jsonb language sql security invoker set search_path = '' as $$
  select staff_private.admin_create_user(p_project_id, p_name, p_role, p_branch, p_pin)
$$;
drop function public.admin_staff_update(uuid, text, text, text);
drop function public.admin_staff_set_pin(uuid, text);
drop function public.admin_staff_set_active(uuid, boolean);
drop function public.admin_staff_remove(uuid);
drop function staff_private.admin_write_user(text, uuid, uuid, text, text, text, text);
-- الجلسة الصالحة وإلغاء الجلسات بالمشغّل: دوال الهوية وسياسة قراءة الصف كما كانت قبل 20261017120000 (نصها من الإنتاج)
drop trigger pin_change_revokes_sessions on staff_private.pin_credentials;
drop trigger user_change_revokes_sessions on public.app_users;
drop function staff_private.revoke_sessions_trigger();
create or replace function public.auth_is_superadmin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_users where auth_id = auth.uid() and role = 'superadmin' and is_active)
$$;
create or replace function public.auth_project_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select project_id from public.app_users where auth_id = auth.uid() and is_active limit 1
$$;
create or replace function public.auth_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.app_users where auth_id = auth.uid() and is_active limit 1
$$;
create or replace function public.auth_user_name() returns text
language sql stable security definer set search_path = '' as $$
  select name from public.app_users where auth_id = auth.uid() and is_active limit 1
$$;
create or replace function public.auth_user_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_users where auth_id = auth.uid() and is_active)
$$;
create or replace function approval_private.actor() returns table (id uuid, role text, project_id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select u.id, u.role, u.project_id, u.name from public.app_users u where u.auth_id = auth.uid() and u.is_active limit 1
$$;
create or replace function public.auth_view_project_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select case
    when (current_setting('request.headers', true)::json ->> 'x-tahseeb-view-project') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and exists (select 1 from public.app_users where auth_id = auth.uid() and role = 'superadmin' and is_active)
    then (current_setting('request.headers', true)::json ->> 'x-tahseeb-view-project')::uuid
  end
$$;
alter policy app_users_select on public.app_users
  using ((auth_id = auth.uid()) or ((project_id = public.auth_project_id()) and (public.auth_is_superadmin() or (public.auth_role() = 'accountant'::text))));
drop function public.auth_account_status();
drop function public.auth_session_valid();
drop function staff_private.user_references(uuid);
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
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'role', u.role, 'branch', u.branch, 'is_active', u.is_active)
               order by u.role, u.name, u.id)
        from public.app_users u where u.project_id = p_project_id), '[]'::jsonb));
end $$;
notify pgrst, 'reload schema';
commit;
