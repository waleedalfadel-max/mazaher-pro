-- رجوع 20261017120000 (إدارة مستخدمي المنشآت من شاشة مدير المنصة). يبقي البيانات:
--   المستخدمون والرموز والسجل كما هي (ومنها صفوف delete/archive في السجل، فيبقى قيد الإجراءات الموسّع).
-- بعده: الإضافة من الشاشة كما كانت (admin_create_user)، والتعديل من الشاشة السابقة يعود إلى الفشل القديم.
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
drop function staff_private.revoke_user_sessions(uuid, boolean);
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
