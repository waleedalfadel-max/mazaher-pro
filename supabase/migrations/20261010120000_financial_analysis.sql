-- التحليل المالي (بعد 20261009150000). هجرة مستقلة لا تعدّل أي جدول أو سياسة أو دالة قائمة.
--
-- 1) public.analysis_access(p): تحقق خادم من صلاحية قراءة التحليل قبل عرض أي رقم، فتفرّق الواجهة «لا صلاحية» عن «لا بيانات»
--    (سياسات القراءة القائمة تعيد صفوفًا فارغة بلا خطأ لمن لا يملك الصلاحية). المسموح: المالك والمحاسب النشطان لمنشأتهما فقط
--    (منشأة غير موقوفة)، ومدير المنصة النشط للمنشأة التي يعرضها بالترويسة نفسها التي تقبلها auth_view_project_id() — قراءة فقط.
--    الكاشير والمشتريات والحساب المعطّل والمنشأة الأخرى: رفض. القراءة نفسها تبقى على سياسات الجداول كما هي (لا امتياز جديد).
-- 2) public.analysis_targets: أهداف نسب البنود إلى المبيعات يحددها المالك وحده. سجلّ لا يُعدَّل ولا يُحذف: كل تغيير صف جديد بتاريخ
--    سريانه، فلا يتغير تقييم فترة سابقة بصمت؛ وصف «معطّل» يلغي الهدف من تاريخه. الصفر هدف صالح (active و ratio = 0).
--    القراءة: المالك والمحاسب لمنشأتهما، ومدير المنصة للمنشأة المعروضة. لا كتابة مباشرة لأي دور؛ الكتابة بالدالة analysis_target_set.

create table public.analysis_targets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  item_key text not null check (length(btrim(item_key)) between 1 and 200),
  item_label text not null check (length(btrim(item_label)) between 1 and 200),
  branch text check (branch is null or length(btrim(branch)) between 1 and 100),
  ratio numeric(6,2) check (ratio is null or (ratio >= 0 and ratio <= 1000)),
  active boolean not null,
  effective_from date not null,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  constraint analysis_targets_active_ratio check ((active and ratio is not null) or (not active and ratio is null))
);
create index analysis_targets_lookup on public.analysis_targets (project_id, item_key, effective_from);
alter table public.analysis_targets enable row level security;
revoke all on public.analysis_targets from public, anon, authenticated;
grant select on public.analysis_targets to authenticated;
create policy analysis_targets_select on public.analysis_targets for select to authenticated using (
  (project_id = (select public.auth_project_id()) and (select public.auth_role()) in ('owner', 'accountant'))
  or project_id = (select public.auth_view_project_id()));

create function public.analysis_access(p_project_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a record;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if p_project_id is null then return approval_private.err('bad_request'); end if;
  if a.role = 'superadmin' then
    if not exists (select 1 from public.projects where id = p_project_id) then return approval_private.err('not_found'); end if;
    -- الترويسة نفسها يجب أن تصل إلى سياسات القراءة، وإلا عادت الأرقام أصفارًا مضللة
    if public.auth_view_project_id() is distinct from p_project_id then return approval_private.err('view_not_applied'); end if;
    return jsonb_build_object('ok', true, 'role', 'superadmin', 'can_set_targets', false, 'read_only', true);
  end if;
  if a.role is distinct from 'owner' and a.role is distinct from 'accountant' then return approval_private.err('forbidden'); end if;
  if a.project_id is distinct from p_project_id then return approval_private.err('forbidden'); end if;
  if not coalesce((select ps.active from public.project_settings ps where ps.project_id = p_project_id), true) then
    return approval_private.err('project_inactive');
  end if;
  return jsonb_build_object('ok', true, 'role', a.role, 'can_set_targets', a.role = 'owner', 'read_only', false);
end $$;
revoke all on function public.analysis_access(uuid) from public, anon;
grant execute on function public.analysis_access(uuid) to authenticated;

create function public.analysis_target_set(p_item_key text, p_item_label text, p_branch text, p_ratio numeric, p_effective_from date,
                                           p_active boolean default true) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare a record; v_row public.analysis_targets;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role is distinct from 'owner' or a.project_id is null then return approval_private.err('forbidden'); end if;
  if not coalesce((select ps.active from public.project_settings ps where ps.project_id = a.project_id), true) then
    return approval_private.err('project_inactive');
  end if;
  if p_item_key is null or length(btrim(p_item_key)) not between 1 and 200
     or p_item_label is null or length(btrim(p_item_label)) not between 1 and 200
     or p_active is null
     or (p_branch is not null and length(btrim(p_branch)) not between 1 and 100) then
    return approval_private.err('bad_request');
  end if;
  if p_effective_from is null then return approval_private.err('date_required'); end if;
  if p_active and (p_ratio is null or p_ratio < 0 or p_ratio > 1000) then return approval_private.err('ratio_invalid'); end if;
  insert into public.analysis_targets (project_id, item_key, item_label, branch, ratio, active, effective_from, created_by)
  values (a.project_id, p_item_key, btrim(p_item_label), btrim(p_branch), case when p_active then round(p_ratio, 2) end, p_active,
          p_effective_from, a.id)
  returning * into v_row;
  return jsonb_build_object('ok', true, 'target', to_jsonb(v_row));
end $$;
revoke all on function public.analysis_target_set(text, text, text, numeric, date, boolean) from public, anon;
grant execute on function public.analysis_target_set(text, text, text, numeric, date, boolean) to authenticated;

notify pgrst, 'reload schema';
