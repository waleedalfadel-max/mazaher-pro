-- رجوع 20261014130000 (إدارة الموظفين للمالك): تُسحب دوال المالك الثلاث ويعود team_members كما كان. سجل التغييرات يبقى بقيده الموسّع
-- (الصفوف الجديدة فيه تبقى صالحة). الموظفون الذين أضافهم المالك يبقون كما هم.
\set ON_ERROR_STOP on
begin;
drop function if exists public.team_staff_create(text, text, text, text);
drop function if exists public.team_staff_set_access(uuid, text, text);
drop function if exists public.team_staff_set_pin(uuid, text);
drop function if exists staff_private.owner_write_user(text, uuid, text, text, text, text);
create or replace function public.team_members() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a record;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role is distinct from 'owner' or a.project_id is null then return approval_private.err('forbidden'); end if;
  return jsonb_build_object('ok', true, 'me', a.id,
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
