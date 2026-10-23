-- كشف حساب تطبيقات التوصيل: «رصيد كشف التطبيق» كما يظهر في كشف التطبيق نفسه في تاريخ محدد، للمطابقة مع الرصيد الدفتري.
-- السجل للمطابقة وحدها: لا يُنشئ قيدًا ولا رصيدًا افتتاحيًا ولا يغيّر أي حركة. يُلغى بسبب ولا يُحذف.
set search_path = public;

create table if not exists approval_private.app_statement_checkpoints (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  app text not null check (app in ('hunger', 'jahez', 'keeta', 'ninja', 'mrsool', 'chefz')),
  statement_date date not null,
  statement_balance numeric(14, 2) not null,
  reference text not null check (length(btrim(reference)) between 1 and 200),
  note text check (note is null or length(note) <= 1000),
  created_by uuid not null, created_by_name text not null, created_by_role text not null, created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid, voided_by_name text, void_reason text,
  check ((voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null))
);
create index if not exists app_statement_checkpoints_lookup on approval_private.app_statement_checkpoints (project_id, app, statement_date desc);
alter table approval_private.app_statement_checkpoints enable row level security;
revoke all on approval_private.app_statement_checkpoints from public, anon, authenticated;

-- القراءة: المالك والمحاسب وإدارة تحسيب في المنشأة المختارة (عرضًا أو تشغيلًا)
create or replace function public.app_statement_checkpoints(p_app text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a record;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.project_id is null or a.role not in ('owner', 'accountant', 'superadmin') then return approval_private.err('forbidden'); end if;
  return jsonb_build_object('ok', true, 'checkpoints', coalesce((select jsonb_agg(to_jsonb(c) - 'project_id' order by c.statement_date desc, c.created_at desc)
    from approval_private.app_statement_checkpoints c where c.project_id = a.project_id and (p_app is null or c.app = p_app)), '[]'::jsonb));
end $$;

-- التسجيل: المعتمدون (المحاسب، وإدارة تحسيب داخل المنشأة)، بالفاعل الحقيقي
create or replace function public.app_statement_checkpoint_save(p_app text, p_date date, p_balance numeric, p_reference text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; v_id uuid;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if not approval_private.can_approve(a.role, a.project_id) then return approval_private.err('forbidden'); end if;
  if p_app is null or p_app not in ('hunger', 'jahez', 'keeta', 'ninja', 'mrsool', 'chefz') or p_date is null or p_date > current_date + 1
     or p_balance is null or p_balance <> round(p_balance, 2) or abs(p_balance) >= 1e12
     or nullif(btrim(p_reference), '') is null or length(btrim(p_reference)) > 200 or length(coalesce(p_note, '')) > 1000 then
    return approval_private.err('invalid');
  end if;
  insert into approval_private.app_statement_checkpoints (project_id, app, statement_date, statement_balance, reference, note, created_by, created_by_name, created_by_role)
  values (a.project_id, p_app, p_date, p_balance, btrim(p_reference), nullif(btrim(p_note), ''), a.id, a.name, a.role) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.app_statement_checkpoint_void(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; c approval_private.app_statement_checkpoints;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if not approval_private.can_approve(a.role, a.project_id) then return approval_private.err('forbidden'); end if;
  if nullif(btrim(p_reason), '') is null or length(p_reason) > 500 then return approval_private.err('reason_required'); end if;
  select * into c from approval_private.app_statement_checkpoints where id = p_id and project_id = a.project_id for update;
  if not found then return approval_private.err('not_found'); end if;
  if c.voided_at is not null then return approval_private.err('already_voided'); end if;
  update approval_private.app_statement_checkpoints set voided_at = now(), voided_by = a.id, voided_by_name = a.name, void_reason = btrim(p_reason) where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.app_statement_checkpoints(text) from public, anon, authenticated;
revoke all on function public.app_statement_checkpoint_save(text, date, numeric, text, text) from public, anon, authenticated;
revoke all on function public.app_statement_checkpoint_void(uuid, text) from public, anon, authenticated;
grant execute on function public.app_statement_checkpoints(text) to authenticated;
grant execute on function public.app_statement_checkpoint_save(text, date, numeric, text, text) to authenticated;
grant execute on function public.app_statement_checkpoint_void(uuid, text) to authenticated;
