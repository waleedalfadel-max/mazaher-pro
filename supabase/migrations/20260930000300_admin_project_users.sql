-- شاشة مدير المنصة: موظفو المنشأة وعددهم عبر دالتين في الخادم. بعد 20260930000200.
--
-- السبب: سياسة القراءة app_users_select تحصر مدير المنصة في صفه (منشأته null، وشرطه داخل شرط مطابقة المنشأة)، فتظهر
-- الشاشة «لا يوجد مستخدمون» و«0 مستخدم». التشخيص: tahseeb-private-checks/superadmin-users-diagnosis-2026-09-30.
-- القواعد:
--   • المستدعي مدير منصة نشط، من هوية الجلسة (approval_private.actor، الذي لا يعيد المعطّل)، لا من أي قيمة من المتصفح.
--   • الحقول اللازمة للشاشة وحدها: المعرّف، والاسم، والدور، والفرع، والحالة. لا رمز الدخول، ولا auth_id، ولا بيانات مصادقة.
--   • سياسة القراءة العامة للجدول كما هي، بلا توسيع.

create function public.admin_project_users(p_project_id uuid) returns jsonb
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

-- عدد الموظفين لكل منشأة (للعدّاد في رأس البطاقة): الكل والنشطون
create function public.admin_project_user_counts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a record;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role is distinct from 'superadmin' then return approval_private.err('forbidden'); end if;
  return jsonb_build_object('ok', true, 'counts', coalesce((
    select jsonb_object_agg(project_id, jsonb_build_object('total', n, 'active', n_active))
      from (select project_id, count(*) as n, count(*) filter (where is_active) as n_active
              from public.app_users where project_id is not null group by project_id) x), '{}'::jsonb));
end $$;

do $$
declare f text;
begin
  foreach f in array array['admin_project_users(uuid)', 'admin_project_user_counts()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
