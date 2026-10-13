-- تعطيل الموظف وإعادة تفعيله بيد مالك منشأته. هجرة مستقلة بعد 20260928000900، ولا تعتمد على وضع الاعتماد.
-- يعتمد على: 20260928000000 (approval_private.actor، err)، و000300 (usage على approval_private للمسجَّل).
--
-- القواعد:
--   • الحالة في app_users.is_active (افتراضيًا true)، مع وقت التعطيل ومنفّذه. لا يُحذف حساب ولا سجل؛ القيود والمستندات
--     والمبيعات تبقى بمعرّف منشئها واسمه.
--   • المنع في الخادم عند كل طلب، لا عند الدخول فقط: دوال الهوية (auth_project_id، auth_role، auth_user_name،
--     auth_is_superadmin، approval_private.actor) لا تعيد شيئًا لمستخدم معطّل، فتسقط سياسات RLS كلها ودوال الاعتماد
--     والتصنيفات والترقيم. الجلسة المفتوحة قبل التعطيل تُرفض في طلبها التالي. سياسة مقيّدة على التخزين تمنع المعطّل من أي
--     حاوية (ومنها public-assets التي لا تمر بدوال الهوية). login_with_pin لا يعيد مستخدمًا معطّلًا.
--   • الإدارة لمالك المنشأة الفعلي النشط وحده، في منشأته، عبر team_set_active. لا يعطّل نفسه، ولا آخر مالك نشط، ولا
--     حساب المشرف العام، ولا حسابًا في منشأة أخرى. تعطيل آخر محاسب نشط يحتاج إقرارًا صريحًا (الاعتماد يتوقف بعده).
--   • الكتابة المباشرة على app_users من العميل (للمحاسب اليوم): لا تغيير للحالة أبدًا (الدالة وحدها، ليُسجَّل)، ولا تغيير
--     للدور أو المنشأة أو الربط بالهوية، ولا إنشاء مالك أو مشرف، ولا تعديل أو حذف حساب مالك أو مشرف — إلا للمشرف العام.
--   • كل تعطيل وإعادة تفعيل يُسجَّل بمنفّذه ووقته في approval_private.user_status_changes.
--   • تُعاد كتابة دالتي auth_is_superadmin وauth_project_id بالصيغة الآمنة (search_path فارغ ومراجع مؤهلة) كما في الإصلاح
--     الأمني المطبّق في 2026-09-29؛ لذلك تتغير بصمتهما في حزمة ذلك الإصلاح بعد هذه الهجرة (متوقع وموثّق).

-- ── الحالة ──────────────────────────────────────────────────────────────────
alter table public.app_users
  add column is_active boolean not null default true,
  add column deactivated_at timestamptz,
  add column deactivated_by uuid references public.app_users(id) on delete set null;

-- ── السجل ───────────────────────────────────────────────────────────────────
create table approval_private.user_status_changes (
  id bigint generated always as identity primary key,
  project_id uuid,
  user_id uuid not null,
  user_name text, user_role text,
  action text not null check (action in ('deactivate', 'reactivate')),
  reason text,
  actor_id uuid, actor_name text, actor_role text, acting_as_role text,
  created_at timestamptz not null default now()
);
create index on approval_private.user_status_changes (project_id, created_at desc);
alter table approval_private.user_status_changes enable row level security;
revoke all on approval_private.user_status_changes from public, anon, authenticated;

-- ── دوال الهوية: المستخدم النشط وحده ─────────────────────────────────────────────
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
create or replace function approval_private.actor() returns table (id uuid, role text, project_id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select u.id, u.role, u.project_id, u.name from public.app_users u where u.auth_id = auth.uid() and u.is_active limit 1
$$;
-- للسياسة المقيّدة على التخزين
create function public.auth_user_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_users where auth_id = auth.uid() and is_active)
$$;

-- ── الدخول: لا يعيد مستخدمًا معطّلًا (التعريف كما في الإنتاج، مع شرط الحالة وحده) ─────────────
create or replace function public.login_with_pin(p_subdomain text, p_pin text)
 returns table(id uuid, name text, role text, project_id uuid, project_name text, branch text, subdomain_resolved boolean)
 language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_project_id uuid;
begin
  return query
    select u.id, u.name, u.role, u.project_id, p.name, u.branch, true
    from app_users u left join projects p on p.id = u.project_id
    where u.pin = p_pin and u.role = 'superadmin' and u.is_active
    limit 1;
  if found then return; end if;

  select pr.id into v_project_id from projects pr
   where pr.subdomain = p_subdomain limit 1;
  if v_project_id is null then
    return query select null::uuid, null::text, null::text,
                        null::uuid, null::text, null::text, false;
    return;
  end if;

  return query
    select u.id, u.name, u.role, u.project_id, p.name, u.branch, true
    from app_users u left join projects p on p.id = u.project_id
    where u.pin = p_pin and u.project_id = v_project_id and u.is_active
    limit 1;
end
$function$;

-- ── التخزين: المعطّل لا يصل إلى أي حاوية بجلسته ────────────────────────────────────
create policy active_users_only on storage.objects as restrictive for all to authenticated
  using (public.auth_user_active()) with check (public.auth_user_active());

-- ── الكتابة المباشرة على app_users من العميل ──────────────────────────────────────
-- دالة المشغّل بصلاحية المستدعي: current_user هو دور الطلب (authenticated/anon من الواجهة، service_role من
-- الخادم). دوال SECURITY DEFINER (team_set_active) تعمل بمالكها فلا يطالها هذا المنع، وتتحقق بنفسها.
create function approval_private.app_users_client_guard() returns trigger language plpgsql set search_path = '' as $$
declare sa boolean;
begin
  if current_user not in ('authenticated', 'anon') then return coalesce(new, old); end if;
  sa := public.auth_is_superadmin();
  if tg_op = 'INSERT' then
    if new.is_active is distinct from true or new.deactivated_at is not null or new.deactivated_by is not null then
      raise exception 'use_team_set_active' using errcode = '42501';
    end if;
    if not sa and (new.role in ('owner', 'superadmin') or new.auth_id is not null) then
      raise exception 'user_change_forbidden' using errcode = '42501';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.is_active is distinct from old.is_active or new.deactivated_at is distinct from old.deactivated_at
       or new.deactivated_by is distinct from old.deactivated_by then
      raise exception 'use_team_set_active' using errcode = '42501';
    end if;
    if not sa and (old.role in ('owner', 'superadmin') or new.role is distinct from old.role
                   or new.project_id is distinct from old.project_id or new.auth_id is distinct from old.auth_id) then
      raise exception 'user_change_forbidden' using errcode = '42501';
    end if;
    return new;
  else
    if not sa and old.role in ('owner', 'superadmin') then
      raise exception 'user_change_forbidden' using errcode = '42501';
    end if;
    return old;
  end if;
end $$;
create trigger app_users_client_guard before insert or update or delete on public.app_users
  for each row execute function approval_private.app_users_client_guard();

-- ── القراءة لشاشة الإعدادات (المالك) ──────────────────────────────────────────
-- بلا عمود الرمز. الأعضاء: منشأة المالك وحدها، بلا المشرف العام.
create function public.team_members() returns jsonb
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

-- ── التعطيل وإعادة التفعيل ──────────────────────────────────────────────────────
-- p_acknowledge = 'last_accountant' مطلوب لتعطيل آخر محاسب نشط. التكرار بالحالة نفسها لا يغيّر شيئًا ولا يُسجَّل.
create function public.team_set_active(p_user_id uuid, p_active boolean, p_reason text default null, p_acknowledge text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; t record; n int; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role is distinct from 'owner' or a.project_id is null then return approval_private.err('forbidden'); end if;
  if p_active is null or p_user_id is null then return approval_private.err('invalid'); end if;
  if length(v_reason) > 200 then return approval_private.err('reason_too_long'); end if;

  -- تغييرات الفريق في المنشأة الواحدة واحدًا بعد الآخر (شرطا آخر مالك وآخر محاسب لا يتسابقان)
  perform 1 from public.app_users where project_id = a.project_id order by id for update;
  select * into t from public.app_users where id = p_user_id;
  -- حساب منشأة أخرى أو المشرف العام: كأنه غير موجود (لا يُكشف وجوده)
  if not found or t.project_id is distinct from a.project_id or t.role = 'superadmin' then return approval_private.err('not_found'); end if;
  if t.id = a.id then return approval_private.err('self'); end if;
  if t.is_active = p_active then
    return jsonb_build_object('ok', true, 'changed', false, 'is_active', t.is_active);
  end if;

  if not p_active then
    if t.role = 'owner' then
      select count(*) into n from public.app_users where project_id = a.project_id and role = 'owner' and is_active and id <> t.id;
      if n = 0 then return approval_private.err('last_owner'); end if;
    end if;
    if t.role = 'accountant' and p_acknowledge is distinct from 'last_accountant' then
      select count(*) into n from public.app_users where project_id = a.project_id and role = 'accountant' and is_active and id <> t.id;
      if n = 0 then return approval_private.err('last_accountant'); end if;
    end if;
    update public.app_users set is_active = false, deactivated_at = now(), deactivated_by = a.id where id = t.id;
  else
    update public.app_users set is_active = true, deactivated_at = null, deactivated_by = null where id = t.id;
  end if;

  insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason,
    actor_id, actor_name, actor_role, acting_as_role)
  values (a.project_id, t.id, t.name, t.role, case when p_active then 'reactivate' else 'deactivate' end, v_reason,
    a.id, a.name, a.role, nullif(current_setting('app.acting_as', true), ''));

  return jsonb_build_object('ok', true, 'changed', true, 'is_active', p_active);
end $$;

-- ── الصلاحيات ───────────────────────────────────────────────────────────────
revoke all on function public.auth_user_active() from public, anon;
grant execute on function public.auth_user_active() to authenticated;
-- دالة مشغّل لا تُستدعى مباشرة؛ التنفيذ للدورين كما في approval_private.legacy_guard
revoke all on function approval_private.app_users_client_guard() from public;
grant execute on function approval_private.app_users_client_guard() to authenticated, anon;
do $$
declare f text;
begin
  foreach f in array array['team_members()', 'team_set_active(uuid, boolean, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
