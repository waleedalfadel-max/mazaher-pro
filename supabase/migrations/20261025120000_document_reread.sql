-- إعادة قراءة مستند مقروء لم يُعتمد: تُستبدل القراءة في الخادم وحده، بعد حفظ السابقة، في معاملة واحدة.
-- لا قيد مالي ولا اعتماد. يُرفض المستند المعتمد أو المرفوض أو الذي اعتُمدت أو استُبعدت إحدى فواتيره أو له قيد.
-- تجهيز المراجعة السابق (approval_private.document_invoices، وكلها «قيد المراجعة» حينها) يُحذف فيُعاد تجهيزه من القراءة الجديدة،
-- ويزيد version فيرفض الخادم أي اعتماد بالنسخة القديمة.
set search_path = public;

create table if not exists approval_private.document_readings (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  project_id uuid not null references public.projects(id),
  reading jsonb,                         -- القراءة المستبدلة (analysis_result) كما كانت
  prepared_invoices jsonb,               -- القراءة الأصلية لكل فاتورة كما جُهّزت للمراجعة (إن جُهّزت)
  version_before integer not null,
  replaced_by uuid not null, replaced_by_name text not null, replaced_by_role text not null,
  replaced_at timestamptz not null default now()
);
create index if not exists document_readings_document on approval_private.document_readings (document_id, replaced_at desc);
alter table approval_private.document_readings enable row level security;
revoke all on approval_private.document_readings from public, anon, authenticated;

-- Ignore empty containers, whitespace, booleans and internal metadata. Keep partial evidence.
create or replace function approval_private.reread_evidence(v jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare e record;
begin
  if jsonb_typeof(v) = 'number' then return true; end if;
  if jsonb_typeof(v) = 'string' then return btrim(v #>> '{}', E' \t\r\n') <> ''; end if;
  if jsonb_typeof(v) = 'array' then
    for e in select value from jsonb_array_elements(v) loop
      if approval_private.reread_evidence(e.value) then return true; end if;
    end loop;
  elsif jsonb_typeof(v) = 'object' then
    for e in select key, value from jsonb_each(v) loop
      if left(e.key, 1) <> '_' and approval_private.reread_evidence(e.value) then return true; end if;
    end loop;
  end if;
  return false;
end $$;
revoke all on function approval_private.reread_evidence(jsonb) from public, anon, authenticated;

-- Pending invoice identifiers from a replaced reading can never become manual additions.
-- Raises an exception to roll back the ENTIRE approval, including earlier invoices in its batch.
create or replace function approval_private.reject_replaced_invoice()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from approval_private.document_readings r
      where r.document_id = new.document_id
        and r.prepared_invoices @> jsonb_build_array(jsonb_build_object('id', new.id))) then
    raise exception using errcode = 'P0023', message = 'reading_replaced';
  end if;
  return new;
end $$;
revoke all on function approval_private.reject_replaced_invoice() from public, anon, authenticated;
drop trigger if exists reject_replaced_invoice on approval_private.document_invoices;
create trigger reject_replaced_invoice before insert or update of id, document_id
  on approval_private.document_invoices for each row execute function approval_private.reject_replaced_invoice();

create or replace function public.document_reread_save(p_document_id uuid, p_expected_version integer, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; d public.documents; v_reading uuid; v_version integer; v_invoices jsonb;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  select * into d from public.documents where id = p_document_id for update;
  if d.id is null or a.project_id is distinct from d.project_id then return approval_private.err('not_found'); end if;
  if not approval_private.can_approve(a.role, d.project_id) then return approval_private.err('forbidden'); end if;
  if d.status is distinct from 'analyzed' then return approval_private.err('not_rereadable', jsonb_build_object('status', d.status)); end if;
  if exists (select 1 from approval_private.document_invoices where document_id = d.id and status <> 'pending')
     or exists (select 1 from public.ledger_entries where document_id = d.id)
     or exists (select 1 from approval_private.sales_reports where document_id = d.id) then
    return approval_private.err('partially_decided');
  end if;
  if p_expected_version is null or p_expected_version is distinct from d.version then
    return approval_private.err('stale', jsonb_build_object('version', d.version));
  end if;
  if jsonb_typeof(p_result) is distinct from 'object' or jsonb_typeof(p_result -> 'invoices') is distinct from 'array'
     or jsonb_array_length(p_result -> 'invoices') not between 1 and 30 or octet_length(p_result::text) > 2000000
     or exists (select 1 from jsonb_array_elements(p_result -> 'invoices') e where jsonb_typeof(e.value) is distinct from 'object') then
    return approval_private.err('invalid');
  end if;
  if exists (select 1 from jsonb_array_elements(p_result -> 'invoices') inv
      where not exists (select 1 from jsonb_each(inv.value) field
        where field.key = any(array['description','date','invoiceNumber','invoice_number','supplier_name','amount','totalAmount','vatAmount','items','sales','payments','returns','paymentLines','returnLines','reportGrossTotal','reportNetTotal','totalSales','cashSales','networkSales','transferSales','hungerSales','jahez','keeta','mrsool','reference','beneficiary'])
          and approval_private.reread_evidence(field.value))) then
    return approval_private.err('invalid');
  end if;
  -- معرّفات الفواتير يولّدها تجهيز المراجعة من جديد؛ لا تُقبل من القراءة
  select jsonb_agg(e.value - '_id' order by e.ordinality) into v_invoices from jsonb_array_elements(p_result -> 'invoices') with ordinality e;

  insert into approval_private.document_readings (document_id, project_id, reading, prepared_invoices, version_before, replaced_by, replaced_by_name, replaced_by_role)
  values (d.id, d.project_id, d.analysis_result,
          (select jsonb_agg(jsonb_build_object('id', x.id, 'idx', x.idx, 'original_reading', x.original_reading) order by x.idx)
             from approval_private.document_invoices x where x.document_id = d.id),
          coalesce(d.version, 0), a.id, a.name, a.role)
  returning id into v_reading;
  delete from approval_private.document_invoices where document_id = d.id;   -- كلها «قيد المراجعة» (فُحص أعلاه)
  update public.documents set analysis_result = jsonb_set(p_result, '{invoices}', v_invoices) || jsonb_build_object('_readingId', v_reading), version = coalesce(version, 0) + 1
   where id = d.id returning version into v_version;
  return jsonb_build_object('ok', true, 'version', v_version, 'reading_id', v_reading);
end $$;

-- القراءات السابقة للمراجعة: المالك والمحاسب وإدارة تحسيب داخل المنشأة
create or replace function public.document_readings(p_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a record; d record;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  select id, project_id into d from public.documents where id = p_document_id;
  if d.id is null or a.project_id is distinct from d.project_id then return approval_private.err('not_found'); end if;
  if a.role not in ('owner', 'accountant', 'superadmin') then return approval_private.err('forbidden'); end if;
  return jsonb_build_object('ok', true, 'readings', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'replaced_at', r.replaced_at,
      'replaced_by_name', r.replaced_by_name, 'replaced_by_role', r.replaced_by_role, 'version_before', r.version_before, 'reading', r.reading) order by r.replaced_at desc)
    from approval_private.document_readings r where r.document_id = d.id), '[]'::jsonb));
end $$;

revoke all on function public.document_reread_save(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.document_readings(uuid) from public, anon, authenticated;
grant execute on function public.document_reread_save(uuid, integer, jsonb) to authenticated;
grant execute on function public.document_readings(uuid) to authenticated;
