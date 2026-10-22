-- Optional, tenant-scoped bank workflows. No tenant settings or financial rows are changed here.
-- Function baseline rechecked against production f61357e. Existing account IDs and balances are retained.
set search_path = public;
create or replace function public.admin_bank_workflow_save(p_workflow jsonb, p_expected jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; ps jsonb; r record; v_id uuid; v_target uuid; v_channels jsonb;
begin
 select * into a from approval_private.actor();
 if a.id is null then return approval_private.err('no_session'); end if;
 if a.role <> 'superadmin' or a.project_id is null then return approval_private.err('forbidden'); end if;
 perform 1 from public.projects where id=a.project_id for update;
 select settings into ps from public.project_settings where project_id=a.project_id for update;
 if not found then return approval_private.err('not_found'); end if;
 if coalesce(ps->'bank_workflow','null') is distinct from coalesce(p_expected,'null') then return approval_private.err('stale'); end if;
 if jsonb_typeof(p_workflow) is distinct from 'object' or p_workflow->'version' is distinct from '1'::jsonb
  or exists(select 1 from jsonb_object_keys(p_workflow) k where k not in ('version','uploaders','network_by_branch','transfer_by_branch','apps_collection_account','accounts'))
  or jsonb_typeof(p_workflow->'uploaders') is distinct from 'object'
  or jsonb_typeof(p_workflow->'network_by_branch') is distinct from 'object'
  or (p_workflow ? 'transfer_by_branch' and jsonb_typeof(p_workflow->'transfer_by_branch') is distinct from 'object')
  or jsonb_typeof(p_workflow->'accounts') is distinct from 'object' then return approval_private.err('invalid'); end if;
 for r in select * from jsonb_each(p_workflow->'uploaders') loop
  if r.key not in ('owner','purchasing','cashier') or jsonb_typeof(r.value) <> 'object'
   or coalesce(r.value->>'source','') not in ('bank','cash')
   or exists(select 1 from jsonb_object_keys(r.value) k where k not in ('source','account_id')) then return approval_private.err('invalid'); end if;
  if r.value->>'source'='bank' then
   v_id:=nullif(r.value->>'account_id','')::uuid;
   if not exists(select 1 from public.bank_accounts where id=v_id and project_id=a.project_id and is_active) then return approval_private.err('invalid'); end if;
  elsif nullif(r.value->>'account_id','') is not null then return approval_private.err('invalid'); end if;
 end loop;
 for v_channels in select value from jsonb_each(jsonb_build_object('network',p_workflow->'network_by_branch','transfer',coalesce(p_workflow->'transfer_by_branch','{}'))) loop
 for r in select * from jsonb_each_text(v_channels) loop
  v_id:=r.value::uuid;
  if not coalesce(ps->'branches','[]') ? r.key or not exists(select 1 from public.bank_accounts where id=v_id and project_id=a.project_id and is_active
    and (coalesce(cardinality(branches),0)=0 or r.key=any(branches))) then return approval_private.err('invalid'); end if;
 end loop;
 end loop;
 v_id:=nullif(p_workflow->>'apps_collection_account','')::uuid;
 if v_id is not null and not exists(select 1 from public.bank_accounts where id=v_id and project_id=a.project_id and is_active) then return approval_private.err('invalid'); end if;
 for r in select * from jsonb_each(p_workflow->'accounts') loop
  v_id:=r.key::uuid;
  if not exists(select 1 from public.bank_accounts where id=v_id and project_id=a.project_id)
   or jsonb_typeof(r.value) <> 'object' or exists(select 1 from jsonb_object_keys(r.value) k where k not in ('purpose','operating_available','transfer_to'))
   or (r.value ? 'purpose' and (jsonb_typeof(r.value->'purpose') <> 'string' or length(r.value->>'purpose')>500))
   or (r.value ? 'operating_available' and jsonb_typeof(r.value->'operating_available') <> 'boolean') then return approval_private.err('invalid'); end if;
  v_target:=nullif(r.value->>'transfer_to','')::uuid;
  if v_target is not null and (v_target=v_id or not exists(select 1 from public.bank_accounts where id=v_target and project_id=a.project_id and is_active)) then return approval_private.err('invalid'); end if;
 end loop;
 update public.project_settings set settings=jsonb_set(coalesce(settings,'{}'),'{bank_workflow}',p_workflow) where project_id=a.project_id;
 return jsonb_build_object('ok',true,'project_id',a.project_id);
exception when invalid_text_representation then return approval_private.err('invalid');
end $$;
revoke all on function public.admin_bank_workflow_save(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.admin_bank_workflow_save(jsonb,jsonb) to authenticated;

CREATE OR REPLACE FUNCTION admin_private.capture_action()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a record; old_json jsonb; new_json jsonb; b jsonb; n jsonb; pid uuid; rid text; fields text[];
begin
  select * into a from approval_private.actor();
  if a.role is distinct from 'superadmin' then return null; end if;
  if tg_op <> 'INSERT' then old_json:=to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_json:=to_jsonb(new); end if;
  pid:=nullif(coalesce(new_json,old_json)->>'project_id','')::uuid;
  if tg_table_name='projects' then pid:=(coalesce(new_json,old_json)->>'id')::uuid; end if;
  rid:=coalesce(new_json,old_json)->>'id';
  b:=admin_private.audit_value(tg_table_name,old_json);
  n:=admin_private.audit_value(tg_table_name,new_json);
  if tg_table_name='project_settings' then
    if b is not null then b:=b||jsonb_build_object('settings',coalesce((select jsonb_object_agg(k,v) from jsonb_each(coalesce(old_json->'settings','{}')) e(k,v) where k=any(array['branches','branch_channels','expenses_scope','transaction_types','modules','bank_workflow'])),'{}')); end if;
    if n is not null then n:=n||jsonb_build_object('settings',coalesce((select jsonb_object_agg(k,v) from jsonb_each(coalesce(new_json->'settings','{}')) e(k,v) where k=any(array['branches','branch_channels','expenses_scope','transaction_types','modules','bank_workflow'])),'{}')); end if;
  end if;
  -- Record that a file/reading changed, but never store its contents or URL.
  -- Login bookkeeping is not a business edit and must not create audit noise.
  select coalesce(array_agg(k order by k),'{}') into fields from (
    select jsonb_object_keys(coalesce(old_json,'{}')||coalesce(new_json,'{}')) k
  ) keys where old_json->k is distinct from new_json->k
    and k not in ('auth_id','pin','password','password_hash','token','updated_at')
    and (tg_table_name<>'app_users' or b ? k or n ? k);
  if tg_op='UPDATE' and cardinality(fields)=0 then return null; end if;
  insert into admin_private.action_log(project_id,actor_id,actor_name,actor_role,entity,row_id,action,before_value,after_value,changed_fields,reason)
  values(pid,a.id,a.name,a.role,tg_table_name,rid,tg_op,b,n,fields,nullif(current_setting('tahseeb.admin_reason',true),''));
  return null;
end $function$
;
CREATE OR REPLACE FUNCTION approval_private.plan_invoice(d documents, inv jsonb, p_decisions jsonb, p_document jsonb, v_known boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare plan jsonb; k text; v_needs boolean; v_code text;
begin
  -- إيصال سداد مورد (20261020120000): دفعة جديدة أو ربط بدفعة قائمة، بخطة مستقلة
  if inv ->> 'type' = 'supplier_payment' then
    return approval_private.plan_supplier_payment(d, inv, p_decisions, v_known);
  end if;
  plan := approval_private.plan_invoice_core(d, inv, p_decisions, p_document, v_known);
  if not coalesce((plan ->> 'ok')::boolean, false) then
    -- «يوجد تقرير لهذا اليوم»: حسابات قنواته من قيوده، لتعرض الشاشة على أي حساب يُسجَّل فرق كل قناة قبل التصحيح (R2)
    if plan ->> 'code' = 'sales_report_exists' and jsonb_typeof(plan -> 'linked') = 'object' then
      plan := jsonb_set(plan, '{linked,accounts}', coalesce(approval_private.report_channel_accounts(d.project_id,
        nullif(btrim(coalesce(p_document ->> 'branch', d.branch, '')), ''), nullif(inv ->> 'date', '')::date), 'null'::jsonb));
    end if;
    return plan;
  end if;
  -- مصروفات على مستوى المنشأة (إعداد المنشأة expenses_scope = 'project'، 20261019120000): فاتورة المصروف تُسجَّل بلا فرع ولو رُفع
  -- مستندها من مستخدم فرع، وحسابها البنكي من حسابات المنشأة دون اشتراط فرع. المبيعات والتحويلات ومنشآت بلا الإعداد كما هي.
  if plan ->> 'kind' = 'expense'
     and coalesce((select ps.settings ->> 'expenses_scope' from public.project_settings ps where ps.project_id = d.project_id), '') = 'project' then
    plan := jsonb_set(plan, '{branch}', 'null'::jsonb);
  end if;
  -- App remittances settle company receivables. Only opted-in businesses use a company account across branches.
  if plan->>'kind'='transfer' and plan->>'trans_type' like '%تحصيل ذمم%'
     and plan->>'trans_type' ~ '(هنقر|جاهز|مرسول|كيتا|نينجا)'
     and (select settings->'bank_workflow'->'version' from public.project_settings where project_id=d.project_id)='1'::jsonb then
    plan:=jsonb_set(plan,'{branch}','null'::jsonb);
  end if;
  if plan->>'kind'='transfer' and plan->>'trans_type'='🔄 تحويل داخلي — بين الحسابات البنكية' then
    if nullif(inv->'bankTransfer'->>'from','') is null or nullif(inv->'bankTransfer'->>'to','') is null
      or inv->'bankTransfer'->>'from'=inv->'bankTransfer'->>'to' then return approval_private.err('bank_transfer_accounts',jsonb_build_object('invoice_id',plan->>'id')); end if;
    if (select count(*) from public.bank_accounts where project_id=d.project_id and is_active
         and id in ((inv->'bankTransfer'->>'from')::uuid,(inv->'bankTransfer'->>'to')::uuid))<>2 then
      return approval_private.err('bank_account_invalid',jsonb_build_object('invoice_id',plan->>'id')); end if;
    return jsonb_set(plan,'{branch}','null'::jsonb);
  end if;
  -- الحساب البنكي: الفاتورة التي فيها حركة بنك في منشأة بحسابات تحتاج حسابًا صالحًا لفرعها (أو حسابًا وحيدًا متاحًا)
  v_needs := case plan ->> 'kind'
    when 'sales' then coalesce(nullif(plan -> 'channels' ->> 'network', '')::numeric, 0) > 0 or coalesce(nullif(plan -> 'channels' ->> 'transfer', '')::numeric, 0) > 0
    when 'transfer' then plan ->> 'pay' = 'bank' or plan ->> 'trans_type' is null or plan ->> 'trans_type' ~ '(إيداع نقدي|تحصيل ذمم|صرف عهدة)'
    when 'expense' then plan ->> 'pay' = 'bank'
    else false end;
  if v_needs and plan ->> 'kind' = 'sales' then
    -- لكل قناة بنكية فيها مبلغ: حسابها (bankAccounts.<القناة>) أو الاختيار العام أو الوحيد المتاح
    for k in select * from (values ('network'), ('transfer')) v(k) loop
      continue when coalesce(nullif(plan -> 'channels' ->> k, '')::numeric, 0) <= 0;
      v_code := approval_private.bank_account_check(d.project_id, plan ->> 'branch',
        coalesce(nullif(inv -> 'bankAccounts' ->> k, '')::uuid, nullif(inv ->> 'bankAccountId', '')::uuid));
      if v_code is not null then return approval_private.err(v_code, jsonb_build_object('invoice_id', plan ->> 'id', 'branch', plan ->> 'branch', 'channel', k)); end if;
    end loop;
  elsif v_needs then
    v_code := approval_private.bank_account_check(d.project_id, plan ->> 'branch', nullif(inv ->> 'bankAccountId', '')::uuid);
    if v_code is not null then return approval_private.err(v_code, jsonb_build_object('invoice_id', plan ->> 'id', 'branch', plan ->> 'branch')); end if;
  end if;
  if plan ->> 'kind' = 'sales' then
    for k in select key from jsonb_each_text(case when jsonb_typeof(plan -> 'channels') = 'object' then plan -> 'channels' else '{}' end) e(key, value)
              where coalesce(nullif(e.value, '')::numeric, 0) > 0 loop
      if not approval_private.channel_enabled(d.project_id, plan ->> 'branch', k) then
        return approval_private.err('channel_not_enabled', jsonb_build_object('invoice_id', plan ->> 'id', 'channel', k,
          'label', approval_private.channel_label(k), 'branch', plan ->> 'branch'));
      end if;
    end loop;
    return plan;
  end if;
  if coalesce(plan ->> 'trans_type', '') like '%سداد مورد%' or coalesce(plan ->> 'type', '') like '%سداد مورد%'
     or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(plan -> 'groups') = 'array' then plan -> 'groups' else '[]' end) g
                 where coalesce(g ->> 'type', '') like '%سداد مورد%' or coalesce(g ->> 'main', '') like '%سداد مورد%'
                    or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(g -> 'items') = 'array' then g -> 'items' else '[]' end) x
                                where coalesce(x ->> 'type', '') like '%سداد مورد%' or coalesce(x ->> 'main', '') like '%سداد مورد%')) then
    return approval_private.err('supplier_payment_via_suppliers', jsonb_build_object('invoice_id', plan ->> 'id'));
  end if;
  return plan;
end $function$
;

-- A transfer is a single operation with two ledger legs. Existing ledger rows are untouched.
create table if not exists approval_private.bank_transfers (
 invoice_id uuid primary key references approval_private.document_invoices(id),
 project_id uuid not null references public.projects(id),
 source_entry uuid not null unique references public.ledger_entries(id) deferrable initially deferred,
 destination_entry uuid not null unique references public.ledger_entries(id) deferrable initially deferred,
 check(source_entry <> destination_entry)
);
alter table approval_private.bank_transfers enable row level security;
revoke all on approval_private.bank_transfers from public,anon,authenticated;

create or replace function approval_private.check_bank_transfer_pair()
returns trigger language plpgsql security definer set search_path='' as $$
declare p approval_private.bank_transfers; s public.ledger_entries; t public.ledger_entries; eid uuid;
begin
 eid:=case when tg_op='DELETE' then old.id else new.id end;
 select * into p from approval_private.bank_transfers where source_entry=eid or destination_entry=eid;
 if p.invoice_id is null then
  if tg_op<>'DELETE' and new.type='🔄 تحويل داخلي — بين الحسابات البنكية' and exists(select 1 from public.ledger_entries where id=eid) then
   raise exception 'APPROVAL:bank_transfer_pair_required';
  end if;
  return null;
 end if;
 select * into s from public.ledger_entries where id=p.source_entry;
 select * into t from public.ledger_entries where id=p.destination_entry;
 if s.id is null or t.id is null or s.project_id<>p.project_id or t.project_id<>p.project_id
  or s.document_invoice_id is distinct from p.invoice_id or t.document_invoice_id is distinct from p.invoice_id
  or s.document_id is distinct from t.document_id or s.date is distinct from t.date
  or s.description is distinct from t.description or s.journal_number is distinct from t.journal_number
  or s.type<>'🔄 تحويل داخلي — بين الحسابات البنكية' or t.type<>s.type
  or s.status<>'approved' or t.status<>s.status or s.branch is not null or t.branch is not null
  or s.bank_account_id is null or t.bank_account_id is null or s.bank_account_id=t.bank_account_id
  or s.bank_out<=0 or s.bank_out<>t.bank_in or s.bank_in<>0 or t.bank_out<>0
  or s.total_amount<>s.bank_out or t.total_amount<>t.bank_in
  or exists(select 1 from (values (s),(t)) r(e) where coalesce((r.e).cash_in,0)<>0 or coalesce((r.e).cash_out,0)<>0
   or coalesce((r.e).custody_in,0)<>0 or coalesce((r.e).custody_out,0)<>0 or coalesce((r.e).receivable_in,0)<>0
   or coalesce((r.e).receivable_out,0)<>0 or coalesce((r.e).payable_in,0)<>0 or coalesce((r.e).payable_out,0)<>0 or coalesce((r.e).vat_amount,0)<>0)
 then raise exception 'APPROVAL:bank_transfer_pair_edit'; end if;
 return null;
end $$;
drop trigger if exists bank_transfer_pair_guard on public.ledger_entries;
create constraint trigger bank_transfer_pair_guard after insert or update or delete on public.ledger_entries
 deferrable initially deferred for each row execute function approval_private.check_bank_transfer_pair();
revoke all on function approval_private.check_bank_transfer_pair() from public,anon,authenticated;

create or replace function public.bank_transfer_manage(p_invoice uuid, p_action text default 'read', p_expected text default null, p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare a record; p approval_private.bank_transfers; s public.ledger_entries; t public.ledger_entries; v_version text;
 v_amount numeric; v_from uuid; v_to uuid; v_date date; v_description text; v_reason text; v_payload jsonb; v_history jsonb;
begin
 select * into a from approval_private.actor();
 if a.id is null then return approval_private.err('no_session'); end if;
 if not approval_private.can_approve(a.role,a.project_id) then return approval_private.err('forbidden'); end if;
 if p_action is null or p_action not in ('read','update','delete') then return approval_private.err('invalid'); end if;
 -- Same lock order as approval: document, business, then payment rows.
 select * into p from approval_private.bank_transfers where invoice_id=p_invoice and project_id=a.project_id;
 if not found then return approval_private.err('not_found'); end if;
 perform 1 from public.documents where id=(select document_id from public.ledger_entries where id=p.source_entry) for update;
 perform 1 from public.projects where id=a.project_id for update;
 select * into p from approval_private.bank_transfers where invoice_id=p_invoice and project_id=a.project_id for update;
 if not found then return approval_private.err('not_found'); end if;
 select * into s from public.ledger_entries where id=p.source_entry for update;
 select * into t from public.ledger_entries where id=p.destination_entry for update;
 v_version:=md5(to_jsonb(s)::text||to_jsonb(t)::text);
 if p_action='read' then return jsonb_build_object('ok',true,'version',v_version,'source',to_jsonb(s),'destination',to_jsonb(t)); end if;
 if p_expected is distinct from v_version then return approval_private.err('stale'); end if;
 v_reason:=nullif(btrim(p_data->>'reason'),'');
 if v_reason is null then return approval_private.err('reason_required'); end if;
 perform set_config('tahseeb.admin_reason',v_reason,true);
 select approved_payload into v_payload from approval_private.document_invoices where id=p_invoice for update;
 v_history:=jsonb_build_object('action',case when p_action='delete' then 'bank_transfer_deleted' else 'bank_transfer_updated' end,
  'reason',v_reason,'by',a.id,'by_name',a.name,'at',now(),'journal_number',s.journal_number,'previous',v_payload);
 if p_action='delete' then
  delete from approval_private.bank_transfers where invoice_id=p_invoice;
  delete from public.ledger_entries where id in (p.source_entry,p.destination_entry);
  update approval_private.document_invoices set status='pending',journal_number=null,decided_by=null,decided_at=null,request_id=null,
   history=history||jsonb_build_array(v_history) where id=p_invoice;
  update public.documents d set status='analyzed',version=version+1,approved_by=null,approved_at=null,
   analysis_result=jsonb_set(d.analysis_result,'{invoices}',(select jsonb_agg(case when x->>'_id'=p_invoice::text then v_payload else x end order by ord)
    from jsonb_array_elements(d.analysis_result->'invoices') with ordinality e(x,ord)))
   where id=s.document_id;
 else
  v_amount:=approval_private.money(p_data->'amount','amount'); v_date:=nullif(p_data->>'date','')::date;
  v_from:=nullif(p_data->>'from','')::uuid; v_to:=nullif(p_data->>'to','')::uuid;
  v_description:=nullif(btrim(p_data->>'description'),'');
  if v_amount<=0 or v_date is null or v_description is null or v_from is null or v_to is null or v_from=v_to then return approval_private.err('invalid'); end if;
  if (select count(*) from public.bank_accounts where id in (v_from,v_to) and project_id=a.project_id and is_active)<>2 then return approval_private.err('bank_account_invalid'); end if;
  update public.ledger_entries set bank_out=case when id=p.source_entry then v_amount else 0 end,
   bank_in=case when id=p.destination_entry then v_amount else 0 end,total_amount=v_amount,date=v_date,description=v_description,
   bank_account_id=case when id=p.source_entry then v_from else v_to end where id in (p.source_entry,p.destination_entry);
  v_payload:=v_payload||jsonb_build_object('amount',v_amount,'totalAmount',v_amount,'date',v_date,'description',v_description,'bankTransfer',jsonb_build_object('from',v_from,'to',v_to));
  update approval_private.document_invoices set total=v_amount,invoice_date=v_date,approved_payload=v_payload,
   history=history||jsonb_build_array(v_history) where id=p_invoice;
 end if;
 return jsonb_build_object('ok',true);
exception when invalid_text_representation or datetime_field_overflow then return approval_private.err('invalid');
end $$;
revoke all on function public.bank_transfer_manage(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.bank_transfer_manage(uuid,text,text,jsonb) to authenticated;

CREATE OR REPLACE FUNCTION approval_private.write_invoice(d documents, plan jsonb, p_actor uuid, p_request uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_id uuid := (plan ->> 'id')::uuid; v_date date := (plan ->> 'date')::date; v_kind text := plan ->> 'kind';
  jn text; v_ch jsonb; s_id uuid; v_total numeric; v_type text; v_pay text := plan ->> 'pay'; v_supplier uuid; v_incoming boolean;
  g jsonb; v_gross numeric; le_id uuid; v_key text := plan ->> 'supplier_key'; v_branch text := plan ->> 'branch';
  -- الحساب البنكي المختار في الفاتورة (20261014140000). حارس الدفتر يتحقق منه ويختاره تلقائيًا إن كان للفرع حساب واحد.
  v_bank uuid := nullif(plan -> 'payload' ->> 'bankAccountId', '')::uuid;
  v_extra jsonb := '{}';
begin
  if not (plan ->> 'known')::boolean then
    insert into approval_private.document_invoices (id, document_id, project_id, idx)
    values (v_id, d.id, d.project_id, coalesce((select max(idx) from approval_private.document_invoices where document_id = d.id), 0) + 1);
  end if;

  if v_kind = 'supplier_payment' then
    -- إيصال سداد مورد (20261020120000): رقم القيد من الدفعة الجديدة أو من الدفعة المربوطة
    v_extra := approval_private.write_supplier_payment(d, plan, p_actor);
    jn := v_extra ->> 'journal_number';
  else
  jn := approval_private.next_journal(d.project_id, v_date);

  if v_kind='transfer' and plan->>'trans_type'='🔄 تحويل داخلي — بين الحسابات البنكية' then
    v_total:=(plan->>'total')::numeric;
    insert into public.ledger_entries(project_id,date,type,description,bank_out,total_amount,status,journal_number,document_id,document_invoice_id,bank_account_id,file_url)
    values(d.project_id,v_date,plan->>'trans_type',coalesce(plan->>'description',d.file_name),v_total,v_total,'approved',jn,d.id,v_id,(plan->'payload'->'bankTransfer'->>'from')::uuid,coalesce(d.file_url,'')) returning id into le_id;
    insert into public.ledger_entries(project_id,date,type,description,bank_in,total_amount,status,journal_number,document_id,document_invoice_id,bank_account_id,file_url)
    values(d.project_id,v_date,plan->>'trans_type',coalesce(plan->>'description',d.file_name),v_total,v_total,'approved',jn,d.id,v_id,(plan->'payload'->'bankTransfer'->>'to')::uuid,coalesce(d.file_url,'')) returning id into s_id;
    insert into approval_private.bank_transfers(invoice_id,project_id,source_entry,destination_entry) values(v_id,d.project_id,le_id,s_id);
  elsif v_kind = 'sales' then
    v_ch := plan -> 'channels';
    insert into public.sales (project_id, date, cash_sales, network_sales, hunger_sales, jahez_sales, keeta_sales, description, branch)
    values (d.project_id, v_date, (v_ch ->> 'cash')::numeric, (v_ch ->> 'network')::numeric, (v_ch ->> 'hunger')::numeric,
            (v_ch ->> 'jahez')::numeric, (v_ch ->> 'keeta')::numeric, 'تقرير POS', v_branch)
    returning id into s_id;
    insert into public.ledger_entries (project_id, date, type, description, cash_in, cash_out, bank_in, bank_out, custody_in, custody_out,
      receivable_in, receivable_out, total_amount, status, journal_number, file_url, branch, document_id, document_invoice_id, bank_account_id)
    select d.project_id, v_date, t.type, t.description, t.cash_in, 0, t.bank_in, 0, 0, 0, t.recv, 0, t.amount, 'approved', jn,
           coalesce(d.file_url, ''), v_branch, d.id, v_id,
           -- حساب كل قناة بنكية (R2-02): المختار لها، وإلا العام
           case when t.bank_in > 0 then coalesce(nullif(plan -> 'payload' -> 'bankAccounts' ->> t.k, '')::uuid, v_bank) end
      from (values
        ('💵 مبيعات كاش', 'مبيعات كاش — POS', (v_ch ->> 'cash')::numeric, 0::numeric, 0::numeric, (v_ch ->> 'cash')::numeric, 'cash'),
        ('🏦 مبيعات شبكة', 'مبيعات شبكة — POS', 0, (v_ch ->> 'network')::numeric, 0, (v_ch ->> 'network')::numeric, 'network'),
        ('💸 مبيعات تحويل', 'مبيعات تحويل — POS', 0, (v_ch ->> 'transfer')::numeric, 0, (v_ch ->> 'transfer')::numeric, 'transfer'),
        ('🍔 مبيعات هنقر ستيشن', 'ذمم هنقر — POS', 0, 0, (v_ch ->> 'hunger')::numeric, (v_ch ->> 'hunger')::numeric, 'hunger'),
        ('🛵 مبيعات جاهز', 'ذمم جاهز — POS', 0, 0, (v_ch ->> 'jahez')::numeric, (v_ch ->> 'jahez')::numeric, 'jahez'),
        ('🛺 مبيعات كيتا', 'ذمم كيتا — POS', 0, 0, (v_ch ->> 'keeta')::numeric, (v_ch ->> 'keeta')::numeric, 'keeta'),
        ('🛵 مبيعات مرسول', 'ذمم مرسول — POS', 0, 0, (v_ch ->> 'mrsool')::numeric, (v_ch ->> 'mrsool')::numeric, 'mrsool')
      ) as t(type, description, cash_in, bank_in, recv, amount, k)
     where t.amount > 0;
    insert into approval_private.sales_reports (project_id, branch_key, report_date, document_id, invoice_id, sales_id, journal_number, current)
    values (d.project_id, plan ->> 'branch_key', v_date, d.id, v_id, s_id, jn, v_ch);

  elsif v_kind = 'transfer' then
    -- مطابق لمنطق المسار السابق، مع قراءة المبلغ من amount أو totalAmount
    v_total := (plan ->> 'total')::numeric; v_type := plan ->> 'trans_type';
    insert into public.ledger_entries (project_id, date, type, description, cash_in, bank_in, custody_in, cash_out, bank_out, custody_out,
      receivable_in, receivable_out, vat_amount, total_amount, status, file_url, journal_number, branch, document_id, document_invoice_id, bank_account_id)
    values (d.project_id, v_date,
      coalesce(v_type, '🏧 تحويل داخلي — إيداع نقدي'), coalesce(plan ->> 'description', d.file_name),
      0,
      case when v_type like '%تحصيل ذمم%' or v_type is null or v_type like '%إيداع نقدي%' then v_total else 0 end,
      case when v_type like '%صرف عهدة%' then v_total else 0 end,
      case when v_type like '%تحصيل ذمم%' or v_type like '%صرف عهدة%' then 0
           when v_type is null or v_type like '%إيداع نقدي%' then v_total
           when v_pay = 'cash' then v_total else 0 end,
      case when v_type like '%صرف عهدة%' then v_total
           when v_type like '%تحصيل ذمم%' or v_type is null or v_type like '%إيداع نقدي%' then 0
           when v_pay = 'bank' then v_total else 0 end,
      case when v_type like '%تحصيل ذمم%' or v_type like '%صرف عهدة%' or v_type is null or v_type like '%إيداع نقدي%' then 0
           when v_pay = 'custody' then v_total else 0 end,
      0, case when v_type like '%تحصيل ذمم%' then v_total else 0 end,
      0, v_total, 'approved', coalesce(d.file_url, ''), jn, v_branch, d.id, v_id, v_bank);

  else
    if v_kind = 'credit' then
      -- مورد من القائمة: حركة «فاتورة» في حساب المورد كما كانت، ومعها الآن قيد الشراء في الدفتر آجلًا (payable_in) بضريبته وتصنيفه
      -- وبنوده كالآجل باسم المورد، فيُحتسب الشراء بصافيه بتاريخ الفاتورة مرة واحدة. الربط بحساب المورد برقم القيد نفسه
      -- (supplier_id في الدفتر يشير إلى payable_suppliers).
      insert into public.supplier_transactions (supplier_id, project_id, type, amount, date, notes, document_id, journal_number)
      values ((plan ->> 'supplier_id')::uuid, d.project_id, 'invoice', (plan ->> 'total')::numeric, v_date,
              coalesce(plan ->> 'description', d.file_name), d.id, jn);
      v_supplier := null;
      v_pay := 'payable';
    else
    v_supplier := nullif(plan ->> 'supplier_id', '')::uuid;
    if (plan ->> 'supplier_new')::boolean then
      -- فاتورة سابقة في الطلب نفسه (أو طلب سبقه تحت قفل المنشأة) أنشأت المورد بالاسم نفسه: يُستعمل، لا يُكرَّر
      select ps.id into v_supplier from public.payable_suppliers ps
       where ps.project_id = d.project_id and approval_private.norm_name(ps.name) = approval_private.norm_name(plan ->> 'label')
       order by ps.created_at nulls last limit 1;
      if v_supplier is null then
        insert into public.payable_suppliers (project_id, name) values (d.project_id, plan ->> 'label') returning id into v_supplier;
      end if;
      v_key := 'ps:' || v_supplier;
    end if;
    end if;
    v_incoming := (plan ->> 'incoming')::boolean;
    for g in select value from jsonb_array_elements(plan -> 'groups') loop
      v_gross := (g ->> 'gross')::numeric;
      insert into public.ledger_entries (project_id, date, type, description, cash_out, bank_out, custody_out, cash_in, bank_in, custody_in,
        payable_in, payable_out, supplier_id, vat_amount, total_amount, status, file_url, journal_number, branch, purchase_category,
        category_main, category_sub, document_id, document_invoice_id, invoice_number, category_id, financial_class, discount_amount, bank_account_id)
      values (d.project_id, v_date, coalesce(g ->> 'type', '🛒 مصروفات تشغيلية'), coalesce(plan ->> 'description', d.file_name),
        case when not v_incoming and v_pay = 'cash' then v_gross else 0 end,
        case when not v_incoming and v_pay = 'bank' then v_gross else 0 end,
        case when not v_incoming and v_pay = 'custody' then v_gross else 0 end,
        case when v_incoming and v_pay = 'cash' then v_gross else 0 end,
        case when v_incoming and v_pay = 'bank' then v_gross else 0 end,
        case when v_incoming and v_pay = 'custody' then v_gross else 0 end,
        case when not v_incoming and v_pay = 'payable' then v_gross else 0 end, 0,
        v_supplier, (g ->> 'vat')::numeric, v_gross, 'approved', coalesce(d.file_url, ''), jn, v_branch, d.purchase_category,
        g ->> 'main', g ->> 'sub', d.id, v_id, plan ->> 'number_raw', nullif(g ->> 'category_id', '')::uuid, g ->> 'financial_class',
        coalesce((g ->> 'discount')::numeric, 0), case when v_pay = 'bank' then v_bank end)
      returning id into le_id;
      insert into public.document_items (document_id, project_id, journal_number, description, amount, vat_amount, category_main, category_sub,
        sort_order, ledger_entry_id, document_invoice_id, category_id, subcategory_id, line_discount, invoice_discount_share, amount_before_discount)
      select d.id, d.project_id, jn, x ->> 'description', (x ->> 'amount')::numeric, (x ->> 'vat')::numeric, x ->> 'main', x ->> 'sub',
             (x ->> 'sort')::int, le_id, v_id, nullif(x ->> 'category_id', '')::uuid, nullif(x ->> 'subcategory_id', '')::uuid,
             coalesce((x ->> 'line_discount')::numeric, 0), coalesce((x ->> 'invoice_discount_share')::numeric, 0),
             (x ->> 'amount_read')::numeric + coalesce((x ->> 'line_discount')::numeric, 0)
        from jsonb_array_elements(g -> 'items') x;
    end loop;
  end if;
  end if;

  update approval_private.document_invoices set
    status = 'approved', kind = v_kind, invoice_number_raw = plan ->> 'number_raw', invoice_number_norm = plan ->> 'number',
    supplier_key = v_key, supplier_label = coalesce(plan ->> 'label', plan ->> 'description'),
    invoice_date = v_date, total = (plan ->> 'total')::numeric, journal_number = jn,
    approved_payload = (plan -> 'payload') || v_extra, review_changes = plan -> 'payload' -> 'review_changes',
    duplicate_decision = case when jsonb_typeof(plan -> 'duplicate_decision') = 'object'
                              then (plan -> 'duplicate_decision') || jsonb_build_object('by', p_actor, 'at', now()) end,
    decided_by = p_actor, decided_at = now(), request_id = p_request
  where id = v_id;
  return jn;
end $function$
;
