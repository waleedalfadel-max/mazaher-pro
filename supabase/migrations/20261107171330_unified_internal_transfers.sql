-- One atomic transfer path for cash, custody and the company's named bank accounts.
-- Existing transfers and balances are not rewritten.
begin;
-- Managed transfers have a server-owned request ID and two protected legs. Two
-- cash/custody legs otherwise collide in the legacy single-row duplicate index.
drop index public.ledger_unique_legacy_path_by_account;
create unique index ledger_unique_legacy_path_by_account on public.ledger_entries
 (project_id,date,total_amount,type,description,coalesce(bank_account_id,'00000000-0000-0000-0000-000000000000'::uuid))
 where status <> 'cancelled' and document_invoice_id is null and type is distinct from '🔄 تحويل داخلي';
create table approval_private.internal_transfers (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id),
 request_id uuid, invoice_id uuid unique references approval_private.document_invoices(id),
 source_entry uuid unique references public.ledger_entries(id) deferrable initially deferred,
 destination_entry uuid unique references public.ledger_entries(id) deferrable initially deferred,
 from_account text not null, to_account text not null, amount numeric(14,2) not null check(amount>0),
 date date not null, description text not null, journal_number text not null,
 version integer not null default 1, created_by jsonb not null, history jsonb not null default '[]',
 created_at timestamptz not null default now(), deleted_at timestamptz,
 unique(project_id,request_id), check(from_account<>to_account),
 check((deleted_at is null and source_entry is not null and destination_entry is not null and source_entry<>destination_entry)
    or (deleted_at is not null and source_entry is null and destination_entry is null))
);
alter table approval_private.internal_transfers enable row level security;
revoke all on approval_private.internal_transfers from public,anon,authenticated;

create function approval_private.internal_transfer_check(p_project uuid,p_from text,p_to text) returns text
language plpgsql stable set search_path='' as $$
declare k text; bank_id uuid;
begin
 if coalesce(p_from,'')='' or coalesce(p_to,'')='' or p_from=p_to then return 'internal_transfer_accounts'; end if;
 foreach k in array array[p_from,p_to] loop
  if k='cash' then continue;
  elsif k='custody' then
   if coalesce((select settings->'account_dashboard'->>'enabled' from public.project_settings where project_id=p_project),'false')='true' then return 'internal_transfer_custody'; end if;
  elsif k ~ '^bank:[0-9a-fA-F-]{36}$' then
   bank_id:=substring(k from 6)::uuid;
   if k is distinct from 'bank:'||bank_id::text then return 'internal_transfer_accounts'; end if;
   if not exists(select 1 from public.bank_accounts where id=bank_id and project_id=p_project and is_active) then return 'bank_account_invalid'; end if;
  else return 'internal_transfer_accounts'; end if;
 end loop;
 return null;
exception when invalid_text_representation then return 'internal_transfer_accounts';
end $$;
revoke all on function approval_private.internal_transfer_check(uuid,text,text) from public,anon,authenticated;

create function approval_private.internal_transfer_amounts(k text,a numeric,incoming boolean) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('cash_in',case when k='cash' and incoming then a else 0 end,'cash_out',case when k='cash' and not incoming then a else 0 end,
 'custody_in',case when k='custody' and incoming then a else 0 end,'custody_out',case when k='custody' and not incoming then a else 0 end,
 'bank_in',case when k like 'bank:%' and incoming then a else 0 end,'bank_out',case when k like 'bank:%' and not incoming then a else 0 end,
 'bank_account_id',case when k like 'bank:%' then substring(k from 6)::uuid else null end,
 'receivable_in',0,'receivable_out',0,'payable_in',0,'payable_out',0,'vat_amount',0,'output_vat_amount',null,'total_amount',a);
$$;
revoke all on function approval_private.internal_transfer_amounts(text,numeric,boolean) from public,anon,authenticated;

create function approval_private.internal_transfer_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare p approval_private.internal_transfers; s public.ledger_entries; t public.ledger_entries; eid uuid; shared jsonb; inv approval_private.document_invoices;
begin
 eid:=case when tg_op='DELETE' then old.id else new.id end;
 select * into p from approval_private.internal_transfers where source_entry=eid or destination_entry=eid;
 if not found then
  if exists(select 1 from public.ledger_entries where id=eid and type='🔄 تحويل داخلي') then raise exception 'APPROVAL:internal_transfer_pair_required'; end if;
  return null;
 end if;
 select * into s from public.ledger_entries where id=p.source_entry;
 select * into t from public.ledger_entries where id=p.destination_entry;
 shared:=jsonb_build_object('project_id',p.project_id,'date',p.date,'description',p.description,'journal_number',p.journal_number,'type','🔄 تحويل داخلي','status','approved','branch',null,'document_invoice_id',p.invoice_id);
 if s.id is null or t.id is null or not(to_jsonb(s) @> (shared||approval_private.internal_transfer_amounts(p.from_account,p.amount,false)))
  or not(to_jsonb(t) @> (shared||approval_private.internal_transfer_amounts(p.to_account,p.amount,true)))
  or s.document_id is distinct from t.document_id then raise exception 'APPROVAL:internal_transfer_pair_edit'; end if;
 if p.invoice_id is not null then
  select * into inv from approval_private.document_invoices where id=p.invoice_id;
  if inv.status is distinct from 'approved' or inv.kind is distinct from 'transfer' or inv.project_id is distinct from p.project_id
   or inv.document_id is distinct from s.document_id or inv.total is distinct from p.amount or inv.invoice_date is distinct from p.date or inv.journal_number is distinct from p.journal_number
   or inv.approved_payload->'internalTransfer'->>'from' is distinct from p.from_account or inv.approved_payload->'internalTransfer'->>'to' is distinct from p.to_account
  then raise exception 'APPROVAL:internal_transfer_pair_edit'; end if;
 elsif s.document_id is not null then raise exception 'APPROVAL:internal_transfer_pair_edit'; end if;
 return null;
end $$;
revoke all on function approval_private.internal_transfer_guard() from public,anon,authenticated;
create constraint trigger internal_transfer_pair_guard after insert or update or delete on public.ledger_entries
 deferrable initially deferred for each row execute function approval_private.internal_transfer_guard();

create function approval_private.write_internal_transfer(p_project uuid,p_date date,p_amount numeric,p_from text,p_to text,p_description text,
 p_journal text,p_actor jsonb,p_request uuid default null,p_document uuid default null,p_invoice uuid default null,p_file text default '') returns jsonb
language plpgsql set search_path='' as $$
declare code text; s uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); pair uuid; m jsonb; eid uuid; k text; incoming boolean;
begin
 perform 1 from public.project_settings where project_id=p_project for share;
 perform 1 from public.bank_accounts where project_id=p_project and ('bank:'||id::text) in (p_from,p_to) order by id for share;
 code:=approval_private.internal_transfer_check(p_project,p_from,p_to);
 if code is not null then raise exception 'APPROVAL:%',code; end if;
 if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or p_amount<>round(p_amount,2) or p_amount>999999999.99 or p_date is null then raise exception 'APPROVAL:amount_invalid'; end if;
 foreach incoming in array array[false,true] loop
  eid:=case when incoming then t else s end; k:=case when incoming then p_to else p_from end;
  m:=approval_private.internal_transfer_amounts(k,p_amount,incoming);
  insert into public.ledger_entries(id,project_id,date,type,description,total_amount,status,journal_number,document_id,document_invoice_id,file_url,
   bank_account_id,cash_in,cash_out,bank_in,bank_out,custody_in,custody_out,receivable_in,receivable_out,payable_in,payable_out,vat_amount,created_by_user_id,created_by_name,created_by_role)
  values(eid,p_project,p_date,'🔄 تحويل داخلي',p_description,p_amount,'approved',p_journal,p_document,p_invoice,coalesce(p_file,''),
   (m->>'bank_account_id')::uuid,(m->>'cash_in')::numeric,(m->>'cash_out')::numeric,(m->>'bank_in')::numeric,(m->>'bank_out')::numeric,
   (m->>'custody_in')::numeric,(m->>'custody_out')::numeric,0,0,0,0,0,(p_actor->>'id')::uuid,p_actor->>'name',p_actor->>'role');
 end loop;
 insert into approval_private.internal_transfers(project_id,request_id,invoice_id,source_entry,destination_entry,from_account,to_account,amount,date,description,journal_number,created_by,history)
 values(p_project,p_request,p_invoice,s,t,p_from,p_to,p_amount,p_date,p_description,p_journal,p_actor,jsonb_build_array(jsonb_build_object('action','created','actor',p_actor,'at',now()))) returning id into pair;
 return jsonb_build_object('ok',true,'id',pair,'entry_id',s,'journal_number',p_journal);
end $$;
revoke all on function approval_private.write_internal_transfer(uuid,date,numeric,text,text,text,text,jsonb,uuid,uuid,uuid,text) from public,anon,authenticated;

create function public.internal_transfer_create(p_request uuid,p_date date,p_amount numeric,p_from text,p_to text,p_description text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare a record; prior approval_private.internal_transfers; code text; jn text; description text:=coalesce(nullif(btrim(p_description),''),'تحويل داخلي');
begin
 select * into a from approval_private.actor();
 if a.id is null then return approval_private.err('no_session'); end if;
 if not approval_private.can_approve(a.role,a.project_id) then return approval_private.err('forbidden'); end if;
 perform 1 from public.app_users where id=a.id and auth_id=auth.uid() and is_active and role=a.role and (role='superadmin' or project_id=a.project_id) for share;
 if not found then return approval_private.err('no_session'); end if;
 if p_request is null then return approval_private.err('request_required'); end if;
 perform pg_advisory_xact_lock(hashtextextended(a.project_id::text||p_request::text,0));
 select * into prior from approval_private.internal_transfers where project_id=a.project_id and request_id=p_request;
 if found then
  if prior.deleted_at is not null then return approval_private.err('request_deleted'); end if;
  if prior.date is distinct from p_date or prior.amount is distinct from p_amount or prior.from_account is distinct from p_from or prior.to_account is distinct from p_to or prior.description is distinct from description then return approval_private.err('request_conflict'); end if;
  return jsonb_build_object('ok',true,'id',prior.id,'entry_id',prior.source_entry,'journal_number',prior.journal_number,'existing',true);
 end if;
 code:=approval_private.internal_transfer_check(a.project_id,p_from,p_to);
 if code is not null then return approval_private.err(code); end if;
 if p_date is null or p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or p_amount<>round(p_amount,2) or p_amount>999999999.99 or length(description)>1000 then return approval_private.err('amount_invalid'); end if;
 jn:=approval_private.next_journal(a.project_id,p_date);
 return approval_private.write_internal_transfer(a.project_id,p_date,p_amount,p_from,p_to,description,jn,jsonb_build_object('id',a.id,'name',a.name,'role',a.role),p_request);
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then return approval_private.err('invalid');
 when sqlstate 'P0001' then return approval_private.err(replace(sqlerrm,'APPROVAL:',''));
end $$;
revoke all on function public.internal_transfer_create(uuid,date,numeric,text,text,text) from public,anon;
grant execute on function public.internal_transfer_create(uuid,date,numeric,text,text,text) to authenticated;

-- Keep the established approval identity, invoice locks, audit and retry handling.
do $install$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('approval_private.plan_invoice(public.documents,jsonb,jsonb,jsonb,boolean)'::regprocedure);
 anchor:='plan := approval_private.plan_invoice_core(d, inv, p_decisions, p_document, v_known);';
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'Unexpected transfer planner'; end if;
 execute replace(definition,anchor,$patch$
 if inv->>'type'='transfer' and inv->>'transType'='🔄 تحويل داخلي' then
  v_code:=approval_private.internal_transfer_check(d.project_id,inv->'internalTransfer'->>'from',inv->'internalTransfer'->>'to');
  if v_code is not null then return approval_private.err(v_code,jsonb_build_object('invoice_id',inv->>'_id')); end if;
  if coalesce((inv->>'vatAmount')::numeric,0)<>0 then return approval_private.err('vat_invalid',jsonb_build_object('invoice_id',inv->>'_id')); end if;
  inv:=inv||jsonb_build_object('paySource',case when inv->'internalTransfer'->>'from' like 'bank:%' then 'bank' else inv->'internalTransfer'->>'from' end,'bankAccountId',null);
  plan:=approval_private.plan_invoice_core(d,inv,p_decisions,p_document,v_known);
  return jsonb_set(plan,'{branch}','null'::jsonb);
 end if;
 $patch$||anchor);
 definition:=pg_get_functiondef('approval_private.write_invoice(public.documents,jsonb,uuid,uuid)'::regprocedure);
 anchor:='if v_kind=''transfer'' and plan->>''trans_type''=''🔄 تحويل داخلي — بين الحسابات البنكية'' then';
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'Unexpected transfer writer'; end if;
 execute replace(definition,anchor,$patch$
 if v_kind='transfer' and plan->>'trans_type'='🔄 تحويل داخلي' then
  perform approval_private.write_internal_transfer(d.project_id,v_date,(plan->>'total')::numeric,
   plan->'payload'->'internalTransfer'->>'from',plan->'payload'->'internalTransfer'->>'to',coalesce(plan->>'description',d.file_name),jn,
   (select jsonb_build_object('id',id,'name',name,'role',role) from public.app_users where id=p_actor),null,d.id,v_id,d.file_url);
 elsif v_kind='transfer' and plan->>'trans_type'='🔄 تحويل داخلي — بين الحسابات البنكية' then
 $patch$);
 definition:=pg_get_functiondef('public.approval_correct_invoice(uuid,uuid,uuid,integer,jsonb,text,jsonb,jsonb)'::regprocedure);
 anchor:='delete from approval_private.bank_transfers where invoice_id = di.id;';
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'Unexpected invoice correction'; end if;
 definition:=replace(definition,anchor,$patch$
 update approval_private.internal_transfers set source_entry=null,destination_entry=null,invoice_id=null,deleted_at=now(),version=version+1,
  history=history||jsonb_build_array(jsonb_build_object('action','invoice_corrected','reason',p_reason,'by',a.id,'by_name',a.name,'at',now(),'previous',v_prev))
  where invoice_id=di.id;
 $patch$||anchor);
 anchor:='update public.ledger_entries set journal_number = v_old_jn where document_invoice_id = di.id;';
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'Unexpected correction journal'; end if;
 execute replace(definition,anchor,anchor||' update approval_private.internal_transfers set journal_number=v_old_jn where invoice_id=di.id;');
end $install$;
create function public.internal_transfer_manage(p_entry uuid,p_action text default 'read',p_expected integer default null,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare a record; p approval_private.internal_transfers; s public.ledger_entries; t public.ledger_entries;
 v_amount numeric; v_date date; v_from text; v_to text; v_description text; v_reason text; v_payload jsonb; event jsonb; code text; m jsonb; eid uuid;
begin
 select * into a from approval_private.actor();
 if a.id is null then return approval_private.err('no_session'); end if;
 if not approval_private.can_approve(a.role,a.project_id) then return approval_private.err('forbidden'); end if;
 perform 1 from public.app_users where id=a.id and auth_id=auth.uid() and is_active and role=a.role and (role='superadmin' or project_id=a.project_id) for share;
 if not found then return approval_private.err('no_session'); end if;
 if p_action is null or p_action not in ('read','update','delete') then return approval_private.err('invalid'); end if;
 select * into p from approval_private.internal_transfers where project_id=a.project_id and p_entry in(source_entry,destination_entry) and deleted_at is null;
 if not found then return approval_private.err('not_found'); end if;
 perform 1 from public.documents where id=(select document_id from public.ledger_entries where id=p.source_entry) for update;
 perform 1 from public.projects where id=a.project_id for update;
 select * into p from approval_private.internal_transfers where id=p.id and deleted_at is null for update;
 if not found then return approval_private.err('not_found'); end if;
 select * into s from public.ledger_entries where id=p.source_entry for update;
 select * into t from public.ledger_entries where id=p.destination_entry for update;
 if p_action='read' then return jsonb_build_object('ok',true,'version',p.version,'from',p.from_account,'to',p.to_account,'amount',p.amount,'date',p.date,'description',p.description); end if;
 if p_expected is distinct from p.version then return approval_private.err('stale'); end if;
 v_reason:=nullif(btrim(p_data->>'reason'),'');
 if v_reason is null then return approval_private.err('reason_required'); end if;
 perform set_config('tahseeb.admin_reason',v_reason,true);
 select approved_payload into v_payload from approval_private.document_invoices where id=p.invoice_id for update;
 event:=jsonb_build_object('action',case when p_action='delete' then 'internal_transfer_deleted' else 'internal_transfer_updated' end,
  'reason',v_reason,'by',a.id,'by_name',a.name,'at',now(),'journal_number',p.journal_number,
  'previous',jsonb_build_object('from',p.from_account,'to',p.to_account,'amount',p.amount,'date',p.date,'description',p.description));
 if p_action='delete' then
  update approval_private.internal_transfers set source_entry=null,destination_entry=null,invoice_id=null,deleted_at=now(),version=version+1,history=history||jsonb_build_array(event) where id=p.id;
  delete from public.ledger_entries where id in (p.source_entry,p.destination_entry);
  if p.invoice_id is not null then
   update approval_private.document_invoices set status='pending',journal_number=null,decided_by=null,decided_at=null,request_id=null,history=history||jsonb_build_array(event) where id=p.invoice_id;
   update public.documents d set status='analyzed',version=version+1,approved_by=null,approved_at=null,
    analysis_result=jsonb_set(d.analysis_result,'{invoices}',(select jsonb_agg(case when x->>'_id'=p.invoice_id::text then v_payload else x end order by ord)
     from jsonb_array_elements(d.analysis_result->'invoices') with ordinality e(x,ord))) where id=s.document_id;
  end if;
 else
  v_amount:=approval_private.money(p_data->'amount','amount'); v_date:=nullif(p_data->>'date','')::date;
  v_from:=p_data->>'from'; v_to:=p_data->>'to'; v_description:=coalesce(nullif(btrim(p_data->>'description'),''),'تحويل داخلي');
  if v_amount is null or v_amount::text in ('NaN','Infinity','-Infinity') or v_amount<=0 or v_amount<>round(v_amount,2) or v_amount>999999999.99 or v_date is null or length(v_description)>1000 then return approval_private.err('amount_invalid'); end if;
  perform 1 from public.project_settings where project_id=a.project_id for share;
  perform 1 from public.bank_accounts where project_id=a.project_id and ('bank:'||id::text) in(v_from,v_to) order by id for share;
  code:=approval_private.internal_transfer_check(a.project_id,v_from,v_to);
  if code is not null then return approval_private.err(code); end if;
  foreach eid in array array[p.source_entry,p.destination_entry] loop
   m:=approval_private.internal_transfer_amounts(case when eid=p.source_entry then v_from else v_to end,v_amount,eid=p.destination_entry);
   update public.ledger_entries set date=v_date,description=v_description,total_amount=v_amount,
    bank_account_id=(m->>'bank_account_id')::uuid,cash_in=(m->>'cash_in')::numeric,cash_out=(m->>'cash_out')::numeric,
    bank_in=(m->>'bank_in')::numeric,bank_out=(m->>'bank_out')::numeric,custody_in=(m->>'custody_in')::numeric,custody_out=(m->>'custody_out')::numeric where id=eid;
  end loop;
  update approval_private.internal_transfers set from_account=v_from,to_account=v_to,amount=v_amount,date=v_date,description=v_description,version=version+1,history=history||jsonb_build_array(event) where id=p.id;
  if p.invoice_id is not null then
   v_payload:=v_payload||jsonb_build_object('amount',v_amount,'totalAmount',v_amount,'date',v_date,'description',v_description,'internalTransfer',jsonb_build_object('from',v_from,'to',v_to),
    'paySource',case when v_from like 'bank:%' then 'bank' else v_from end);
   update approval_private.document_invoices set total=v_amount,invoice_date=v_date,approved_payload=v_payload,history=history||jsonb_build_array(event) where id=p.invoice_id;
   update public.documents set version=version+1 where id=s.document_id;
  end if;
 end if;
 return jsonb_build_object('ok',true);
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then return approval_private.err('invalid');
 when sqlstate 'P0001' then return approval_private.err(replace(sqlerrm,'APPROVAL:',''));
end $$;
revoke all on function public.internal_transfer_manage(uuid,text,integer,jsonb) from public,anon;
grant execute on function public.internal_transfer_manage(uuid,text,integer,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
