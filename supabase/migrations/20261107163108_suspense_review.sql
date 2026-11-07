-- Explicit suspense register. No existing balance is changed by this migration.
begin;
create schema if not exists suspense_private;
revoke all on schema suspense_private from public, anon, authenticated;

create table public.suspense_cases (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id),
 entry_id uuid not null unique references public.ledger_entries(id), counter_entry_id uuid references public.ledger_entries(id),
 request_id uuid, source_date date not null, source_account text not null, amount numeric(14,2) not null check(amount>0),
 direction text not null check(direction in ('in','out')), reason text not null check(length(btrim(reason))>=10),
 reference text, status text not null default 'open' check(status in ('open','proposed','resolved')),
 version integer not null default 1, source_snapshot jsonb not null, proposal jsonb,
 opened_by jsonb not null, proposed_by jsonb, approved_by jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), closed_at timestamptz,
 unique(project_id,request_id)
);
create index suspense_cases_project_status on public.suspense_cases(project_id,status,source_date);
create index suspense_cases_counter_entry on public.suspense_cases(counter_entry_id) where counter_entry_id is not null;
create table public.suspense_events (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id),
 case_id uuid not null references public.suspense_cases(id), action text not null,
 actor jsonb not null, detail jsonb not null, created_at timestamptz not null default now()
);
create index suspense_events_case on public.suspense_events(project_id,case_id,created_at);
alter table public.suspense_cases enable row level security;
alter table public.suspense_events enable row level security;
revoke all on public.suspense_cases,public.suspense_events from public,anon,authenticated;
grant select on public.suspense_cases,public.suspense_events to authenticated;
create policy suspense_cases_read on public.suspense_cases for select to authenticated using (
 (project_id=(select public.auth_project_id()) and (select public.auth_role()) in ('owner','accountant'))
 or project_id=(select public.auth_view_project_id())
);
create policy suspense_events_read on public.suspense_events for select to authenticated using (
 (project_id=(select public.auth_project_id()) and (select public.auth_role()) in ('owner','accountant'))
 or project_id=(select public.auth_view_project_id())
);

-- A private transaction-scoped permit, not a client-settable session flag.
create table suspense_private.write_permits (transaction_id bigint not null, entry_id uuid not null, primary key(transaction_id,entry_id));
alter table suspense_private.write_permits enable row level security;
revoke all on suspense_private.write_permits from public,anon,authenticated;
create function suspense_private.guard_entry() returns trigger language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 v_id:=case when tg_op='DELETE' then old.id else new.id end;
 if exists(select 1 from suspense_private.write_permits where transaction_id=txid_current() and entry_id=v_id) then
  if tg_op='DELETE' then return old; else return new; end if;
 end if;
 if (tg_op<>'DELETE' and new.type='فروقات قيد المراجعة') or exists(select 1 from public.suspense_cases where entry_id=v_id or counter_entry_id=v_id) then
  raise exception using errcode='P0001',message='يُعالج هذا القيد من صفحة الفروقات وباعتماد المالك.';
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function suspense_private.guard_entry() from public,anon,authenticated;
create trigger suspense_entry_guard before insert or update or delete on public.ledger_entries for each row execute function suspense_private.guard_entry();

create function suspense_private.open_existing(p_project uuid,p_entry uuid,p_reason text,p_reference text,p_actor jsonb,p_request uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.ledger_entries; c public.suspense_cases; v_in numeric; v_out numeric; v_source text; v_fields int;
begin
 if length(btrim(coalesce(p_reason,'')))<10 or length(p_reason)>1000 or length(coalesce(p_reference,''))>500 then return approval_private.err('reason_required'); end if;
 select * into e from public.ledger_entries where id=p_entry and project_id=p_project for update;
 if not found then return approval_private.err('not_found'); end if;
 select * into c from public.suspense_cases where entry_id=e.id;
 if found then return jsonb_build_object('ok',true,'id',c.id,'existing',true); end if;
 if coalesce(e.status,'') not in ('approved','auto') or e.document_invoice_id is not null or e.supplier_id is not null
  or coalesce(e.vat_amount,0)<>0 or coalesce(e.output_vat_amount,0)<>0
  or coalesce(e.receivable_in,0)<>0 or coalesce(e.receivable_out,0)<>0 or coalesce(e.payable_in,0)<>0 or coalesce(e.payable_out,0)<>0
  or coalesce(e.type,'') not in ('تسوية مطابقة بنكية','فرق صندوق','فرق عهدة','فروقات قيد المراجعة') then return approval_private.err('source_not_eligible'); end if;
 select count(*) filter(where v>0),coalesce(sum(v) filter(where k like '%_in'),0),coalesce(sum(v) filter(where k like '%_out'),0)
 into v_fields,v_in,v_out from (values('cash_in',e.cash_in),('cash_out',e.cash_out),('bank_in',e.bank_in),('bank_out',e.bank_out),('custody_in',e.custody_in),('custody_out',e.custody_out)) t(k,v);
 if v_fields<>1 or least(coalesce(e.cash_in,0),coalesce(e.cash_out,0),coalesce(e.bank_in,0),coalesce(e.bank_out,0),coalesce(e.custody_in,0),coalesce(e.custody_out,0))<0
  or v_in+v_out<>e.total_amount then return approval_private.err('source_not_eligible'); end if;
 v_source:=case when coalesce(e.bank_in,0)+coalesce(e.bank_out,0)>0 then 'bank:'||e.bank_account_id
  when coalesce(e.cash_in,0)+coalesce(e.cash_out,0)>0 then 'cash' else 'custody' end;
 if v_source is null or (v_source like 'bank:%' and not exists(select 1 from public.bank_accounts where id=e.bank_account_id and project_id=p_project)) then return approval_private.err('account_required'); end if;
 insert into public.suspense_cases(project_id,entry_id,request_id,source_date,source_account,amount,direction,reason,reference,source_snapshot,opened_by)
 values(p_project,e.id,p_request,e.date,v_source,v_in+v_out,case when v_in>0 then 'in' else 'out' end,btrim(p_reason),nullif(btrim(p_reference),''),to_jsonb(e),p_actor) returning * into c;
 insert into suspense_private.write_permits values(txid_current(),e.id) on conflict do nothing;
 update public.ledger_entries set type='فروقات قيد المراجعة',category_id=null,category_main=null,category_sub=null,financial_class=null where id=e.id;
 delete from suspense_private.write_permits where transaction_id=txid_current() and entry_id=e.id;
 insert into public.suspense_events(project_id,case_id,action,actor,detail) values(p_project,c.id,'opened',p_actor,jsonb_build_object('reason',c.reason,'reference',c.reference));
 return jsonb_build_object('ok',true,'id',c.id);
end $$;
revoke all on function suspense_private.open_existing(uuid,uuid,text,text,jsonb,uuid) from public,anon,authenticated;

-- A linked supplier payment must remain consistent with the owner's approved case.
create function suspense_private.guard_supplier_transaction() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.suspense_cases c join public.ledger_entries l on l.id=c.entry_id
  where c.project_id=old.project_id and c.status='resolved' and c.proposal->>'kind'='supplier'
   and c.proposal->>'supplier_kind'='list' and c.proposal->>'supplier_id'=old.supplier_id::text and l.journal_number=old.journal_number)
 then raise exception using errcode='P0001',message='دفعة مرتبطة بمعالجة فرق معتمدة؛ راجع سجل المعالجة.'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function suspense_private.guard_supplier_transaction() from public,anon,authenticated;
create trigger suspense_supplier_guard before update or delete on public.supplier_transactions for each row execute function suspense_private.guard_supplier_transaction();

-- Validation is repeated on approval: a proposal cannot authorize a stale or foreign account.
create function suspense_private.validate_proposal(c public.suspense_cases,p jsonb) returns text
language plpgsql stable set search_path='' as $$
declare k text:=p->>'kind'; v_vat numeric; v_id uuid; cat public.categories; target text; tax_status text;
begin
 if jsonb_typeof(p) is distinct from 'object' or length(btrim(coalesce(p->>'reason','')))<10 or length(p->>'reason')>1000
  or exists(select 1 from jsonb_object_keys(p) as keys(key) where keys.key not in ('kind','reason','vat','category_id','supplier_id','supplier_kind','target','branch')) then return 'proposal_invalid'; end if;
 if k is null or k not in ('expense','sales','supplier','transfer','withdrawal','liability','shortage') then return 'proposal_invalid'; end if;
 v_vat:=coalesce((p->>'vat')::numeric,0);
 if v_vat::text in ('NaN','Infinity','-Infinity') or v_vat<0 or v_vat>c.amount or v_vat<>round(v_vat,2) or (k not in ('expense','sales') and v_vat<>0) then return 'vat_invalid'; end if;
 select settings->'onboarding'->'tax'->>'status' into tax_status from public.project_settings where project_id=c.project_id;
 if v_vat>0 and tax_status is distinct from 'مسجل' then return 'tax_status_required'; end if;
 if k='expense' then
  select * into cat from public.categories where id=(p->>'category_id')::uuid and project_id=c.project_id and parent_id is null and is_active;
  if not found or coalesce(cat.financial_class,'') not in ('cogs','opex','fixed') or cat.ledger_type is null then return 'category_required'; end if;
 elsif k='sales' then
  if c.direction<>'in' or c.source_account='custody' or p->>'vat' is null then return 'sales_invalid'; end if;
  if nullif(p->>'branch','') is null or not (coalesce((select settings->'branches' from public.project_settings where project_id=c.project_id),'[]') ? (p->>'branch')) then return 'branch_required'; end if;
 elsif k in ('supplier','withdrawal','shortage') and c.direction<>'out' then return 'direction_invalid';
 end if;
 if k='supplier' then
  v_id:=(p->>'supplier_id')::uuid;
  if p->>'supplier_kind'='list' then
   if not exists(select 1 from public.suppliers where id=v_id and project_id=c.project_id) then return 'supplier_required'; end if;
  elsif p->>'supplier_kind'='payable' then
   if not exists(select 1 from public.payable_suppliers where id=v_id and project_id=c.project_id) then return 'supplier_required'; end if;
  else return 'supplier_required'; end if;
 elsif k='transfer' then
  target:=p->>'target';
  if target is null or target=c.source_account then return 'account_required'; end if;
  if target not in ('cash','custody') then
   if target !~ '^bank:[0-9a-f-]{36}$' or not exists(select 1 from public.bank_accounts where id=substring(target from 6)::uuid and project_id=c.project_id and is_active) then return 'account_required'; end if;
  end if;
 end if;
 return null;
exception when invalid_text_representation or numeric_value_out_of_range then return 'proposal_invalid';
end $$;
revoke all on function suspense_private.validate_proposal(public.suspense_cases,jsonb) from public,anon,authenticated;

create function public.suspense_write(p_action text,p_case uuid default null,p_expected integer default null,p_payload jsonb default '{}',p_request uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a record; actor jsonb; c public.suspense_cases; e public.ledger_entries; result jsonb; code text; k text; v_source text;
 v_id uuid; v_bank uuid; v_amount numeric; v_date date; v_in boolean; jn text; cat public.categories; v_vat numeric;
 v_supplier uuid; v_balance numeric; v_unrecorded int; v_name text; v_counter uuid; payload jsonb;
begin
 select * into a from approval_private.actor();
 if a.id is null then return approval_private.err('no_session'); end if;
 if a.project_id is null or a.role not in ('owner','accountant','superadmin') then return approval_private.err('forbidden'); end if;
 perform 1 from public.app_users where id=a.id and auth_id=auth.uid() and is_active and role=a.role and (role='superadmin' or project_id=a.project_id) for share;
 if not found then return approval_private.err('no_session'); end if;
 perform 1 from public.project_settings where project_id=a.project_id for share;
 if not coalesce((select active from public.project_settings where project_id=a.project_id),true) then return approval_private.err('project_inactive'); end if;
 actor:=jsonb_build_object('id',a.id,'name',a.name,'role',a.role);
 if jsonb_typeof(p_payload) is distinct from 'object' then return approval_private.err('proposal_invalid'); end if;
 if p_action='open' then
  return suspense_private.open_existing(a.project_id,(p_payload->>'entry_id')::uuid,p_payload->>'reason',p_payload->>'reference',actor);
 elsif p_action='new' then
  if p_payload->>'confirmed' is distinct from 'true' then return approval_private.err('confirmation_required'); end if;
  if p_request is null then return approval_private.err('request_required'); end if;
  perform pg_advisory_xact_lock(hashtextextended(a.project_id::text||p_request::text,0));
  select * into c from public.suspense_cases where project_id=a.project_id and request_id=p_request;
  if found then
   if c.amount is distinct from (p_payload->>'amount')::numeric or c.source_date is distinct from (p_payload->>'date')::date or c.source_account is distinct from p_payload->>'account' or c.direction is distinct from p_payload->>'direction' or c.reason is distinct from btrim(p_payload->>'reason') or c.reference is distinct from nullif(btrim(p_payload->>'reference'),'') then return approval_private.err('request_conflict'); end if;
   return jsonb_build_object('ok',true,'id',c.id,'existing',true);
  end if;
  v_amount:=(p_payload->>'amount')::numeric; v_date:=(p_payload->>'date')::date; v_source:=p_payload->>'account'; v_in:=p_payload->>'direction'='in';
  if v_amount is null or v_amount::text in ('NaN','Infinity','-Infinity') or v_amount>999999999.99 or v_amount<=0 or v_amount<>round(v_amount,2) or v_date is null or v_date>current_date
   or coalesce(p_payload->>'direction','') not in ('in','out') or length(btrim(coalesce(p_payload->>'reason','')))<10 then return approval_private.err('proposal_invalid'); end if;
  if v_source is null then return approval_private.err('account_required'); end if;
  if v_source not in ('cash','custody') then
   if v_source !~ '^bank:[0-9a-f-]{36}$' then return approval_private.err('account_required'); end if;
   v_bank:=substring(v_source from 6)::uuid;
   if not exists(select 1 from public.bank_accounts where id=v_bank and project_id=a.project_id and is_active) then return approval_private.err('account_required'); end if;
  end if;
  v_id:=gen_random_uuid(); jn:=approval_private.next_journal(a.project_id,v_date);
  insert into suspense_private.write_permits values(txid_current(),v_id);
  insert into public.ledger_entries(id,project_id,date,type,description,total_amount,status,journal_number,bank_account_id,cash_in,cash_out,bank_in,bank_out,custody_in,custody_out,vat_amount,output_vat_amount,created_by_user_id,created_by_name,created_by_role)
  values(v_id,a.project_id,v_date,'فروقات قيد المراجعة',(p_payload->>'reason')||' — '||jn,v_amount,'approved',jn,v_bank,
   case when v_source='cash' and v_in then v_amount else 0 end,case when v_source='cash' and not v_in then v_amount else 0 end,
   case when v_bank is not null and v_in then v_amount else 0 end,case when v_bank is not null and not v_in then v_amount else 0 end,
   case when v_source='custody' and v_in then v_amount else 0 end,case when v_source='custody' and not v_in then v_amount else 0 end,0,null,a.id,a.name,a.role);
  result:=suspense_private.open_existing(a.project_id,v_id,p_payload->>'reason',p_payload->>'reference',actor,p_request);
  if not coalesce((result->>'ok')::boolean,false) then raise exception using errcode='P0001',message=result->>'code'; end if;
  delete from suspense_private.write_permits where transaction_id=txid_current() and entry_id=v_id;
  return result;
 end if;
 if p_action not in ('propose','approve','return') then return approval_private.err('proposal_invalid'); end if;
 select * into c from public.suspense_cases where id=p_case and project_id=a.project_id for update;
 if not found then return approval_private.err('not_found'); end if;
 if p_action in ('approve','return') and a.role<>'owner' then return approval_private.err('owner_required'); end if;
 if c.status='resolved' then return jsonb_build_object('ok',true,'id',c.id,'resolved',true); end if;
 if p_expected is distinct from c.version then return approval_private.err('stale'); end if;
 if p_action='propose' then
  code:=suspense_private.validate_proposal(c,p_payload);
  if code is not null then return approval_private.err(code); end if;
  update public.suspense_cases set proposal=p_payload,proposed_by=actor,status='proposed',version=version+1,updated_at=now() where id=c.id;
  insert into public.suspense_events(project_id,case_id,action,actor,detail) values(c.project_id,c.id,'proposed',actor,p_payload);
  return jsonb_build_object('ok',true,'id',c.id);
 elsif p_action='return' then
  if c.status<>'proposed' or length(btrim(coalesce(p_payload->>'reason','')))<10 then return approval_private.err('reason_required'); end if;
  update public.suspense_cases set status='open',proposal=null,proposed_by=null,version=version+1,updated_at=now() where id=c.id;
  insert into public.suspense_events(project_id,case_id,action,actor,detail) values(c.project_id,c.id,'returned',actor,p_payload);
  return jsonb_build_object('ok',true,'id',c.id);
 end if;
 if c.status<>'proposed' or p_payload->>'confirmed' is distinct from 'true' then return approval_private.err('confirmation_required'); end if;
 payload:=c.proposal; code:=suspense_private.validate_proposal(c,payload);
 if code is not null then return approval_private.err(code); end if;
 select * into e from public.ledger_entries where id=c.entry_id and project_id=c.project_id for update;
 if not found or e.type is distinct from 'فروقات قيد المراجعة' then return approval_private.err('stale'); end if;
 k:=payload->>'kind'; v_vat:=coalesce((payload->>'vat')::numeric,0);
 insert into suspense_private.write_permits values(txid_current(),e.id);
 if k='expense' then
  select * into cat from public.categories where id=(payload->>'category_id')::uuid and project_id=c.project_id and parent_id is null and is_active for share;
  if not found or coalesce(cat.financial_class,'') not in ('cogs','opex','fixed') or cat.ledger_type is null then raise exception using errcode='P0001',message='category_required'; end if;
  update public.ledger_entries set type=cat.ledger_type,category_id=cat.id,category_main=cat.name,financial_class=cat.financial_class,vat_amount=v_vat,output_vat_amount=null,description=(payload->>'reason')||' — '||coalesce(e.journal_number,e.id::text) where id=e.id;
 elsif k='shortage' then
  update public.ledger_entries set type='🛒 مصروفات تشغيلية',category_main='عجز صندوق معتمد',financial_class='opex',vat_amount=0,output_vat_amount=null,description=(payload->>'reason')||' — '||coalesce(e.journal_number,e.id::text) where id=e.id;
 elsif k='sales' then
  update public.ledger_entries set type=case when c.source_account='cash' then '💵 مبيعات كاش' else '💸 مبيعات تحويل' end,branch=payload->>'branch',vat_amount=0,output_vat_amount=v_vat,description=(payload->>'reason')||' — '||coalesce(e.journal_number,e.id::text) where id=e.id;
 elsif k='withdrawal' then
  update public.ledger_entries set type='مسحوبات الشركاء',vat_amount=0,output_vat_amount=null,description=(payload->>'reason')||' — '||coalesce(e.journal_number,e.id::text) where id=e.id;
 elsif k='liability' then
  update public.ledger_entries set type=case when c.direction='in' then 'حوالة واردة بالخطأ' else 'رد حوالات واردة بالخطأ' end,vat_amount=0,output_vat_amount=null,description=(payload->>'reason')||' — '||coalesce(e.journal_number,e.id::text) where id=e.id;
 elsif k='supplier' then
  v_supplier:=(payload->>'supplier_id')::uuid;
  if payload->>'supplier_kind'='list' then
   select name,coalesce(opening_balance,0) into v_name,v_balance from public.suppliers where id=v_supplier and project_id=c.project_id for update;
   if not found then raise exception using errcode='P0001',message='supplier_required'; end if;
   select v_balance+coalesce(sum(case when type='invoice' then amount when type='payment' then -amount else 0 end),0) into v_balance from public.supplier_transactions where supplier_id=v_supplier and project_id=c.project_id;
   select count(*) into v_unrecorded from public.supplier_transactions t where t.supplier_id=v_supplier and t.project_id=c.project_id and t.type='invoice'
    and not exists(select 1 from public.ledger_entries l where l.project_id=c.project_id and l.journal_number=t.journal_number and l.payable_in>0 and l.status in ('approved','auto'));
   if v_unrecorded>0 then raise exception using errcode='P0001',message='supplier_invoices_required'; end if;
  else
   perform 1 from public.payable_suppliers where id=v_supplier and project_id=c.project_id for update;
   if not found then raise exception using errcode='P0001',message='supplier_required'; end if;
   select coalesce(sum(coalesce(payable_in,0)-coalesce(payable_out,0)),0) into v_balance from public.ledger_entries where project_id=c.project_id and supplier_id=v_supplier and status in ('approved','auto');
  end if;
  if not found or v_balance is null then raise exception using errcode='P0001',message='supplier_required'; end if;
  if c.amount>v_balance then raise exception using errcode='P0001',message='exceeds_balance'; end if;
  if payload->>'supplier_kind'='list' then
   insert into public.supplier_transactions(project_id,supplier_id,type,amount,date,notes,journal_number) values(c.project_id,v_supplier,'payment',c.amount,c.source_date,payload->>'reason',e.journal_number);
  end if;
  perform set_config('tahseeb.supplier_payment','on',true);
  update public.ledger_entries set type='🏪 سداد مورد',supplier_id=case when payload->>'supplier_kind'='payable' then v_supplier else null end,payable_out=c.amount,vat_amount=0,output_vat_amount=null,description=(payload->>'reason')||' — '||coalesce(e.journal_number,e.id::text) where id=e.id;
  perform set_config('tahseeb.supplier_payment','off',true);
 elsif k='transfer' then
  v_source:=payload->>'target'; v_bank:=case when v_source like 'bank:%' then substring(v_source from 6)::uuid end;
  if v_bank is not null then
   perform 1 from public.bank_accounts where id=v_bank and project_id=c.project_id and is_active for share;
   if not found then raise exception using errcode='P0001',message='account_required'; end if;
  end if;
  v_in:=c.direction='out'; v_counter:=gen_random_uuid();
  insert into suspense_private.write_permits values(txid_current(),v_counter);
  update public.ledger_entries set type='تحويل داخلي — معالجة فرق',description=(payload->>'reason')||' — '||coalesce(e.journal_number,e.id::text) where id=e.id;
  insert into public.ledger_entries(id,project_id,date,type,description,total_amount,status,journal_number,bank_account_id,cash_in,cash_out,bank_in,bank_out,custody_in,custody_out,vat_amount,output_vat_amount,created_by_user_id,created_by_name,created_by_role)
  values(v_counter,c.project_id,c.source_date,'تحويل داخلي — معالجة فرق',payload->>'reason',c.amount,'approved',e.journal_number,v_bank,
   case when v_source='cash' and v_in then c.amount else 0 end,case when v_source='cash' and not v_in then c.amount else 0 end,
   case when v_bank is not null and v_in then c.amount else 0 end,case when v_bank is not null and not v_in then c.amount else 0 end,
   case when v_source='custody' and v_in then c.amount else 0 end,case when v_source='custody' and not v_in then c.amount else 0 end,0,null,a.id,a.name,a.role);
 end if;
 update public.suspense_cases set status='resolved',approved_by=actor,closed_at=now(),updated_at=now(),version=version+1,counter_entry_id=v_counter where id=c.id;
 insert into public.suspense_events(project_id,case_id,action,actor,detail) values(c.project_id,c.id,'resolved',actor,payload||jsonb_build_object('source_before',to_jsonb(e),'source_after',(select to_jsonb(l) from public.ledger_entries l where id=e.id),'counter_entry_id',v_counter));
 delete from suspense_private.write_permits where transaction_id=txid_current() and entry_id in (e.id,v_counter);
 return jsonb_build_object('ok',true,'id',c.id,'resolved',true);
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then return approval_private.err('proposal_invalid');
 when sqlstate 'P0001' then return approval_private.err(sqlerrm);
end $$;
revoke all on function public.suspense_write(text,uuid,integer,jsonb,uuid) from public,anon;
grant execute on function public.suspense_write(text,uuid,integer,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
