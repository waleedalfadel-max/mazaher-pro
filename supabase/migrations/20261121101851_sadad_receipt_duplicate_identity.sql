-- Al Rajhi SADAD receipts print a recurring biller number and a separate per-payment reference.
-- Use only server-saved reading evidence. Keep the printed biller number on the document and ledger.
create function approval_private.is_sadad_expense(r jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(r->>'type' = 'expense' and r->>'paySource' = 'bank'
    and r->>'description' ~* '(نظام[[:space:]]+سداد|فواتير[[:space:]]+سداد|\mSADAD\M)', false)
$$;

create function approval_private.sadad_receipt_identity(r jsonb) returns text
language sql immutable set search_path = '' as $$
  with receipt as (
    select r->'bankReceipt' as bank,
           approval_private.norm_invoice_number(r#>>'{bankReceipt,reference}') as ref,
           r#>>'{bankReceipt,date}' as printed_date
  )
  select 'sadad:' || encode(sha256(convert_to(ref, 'UTF8')), 'hex') from receipt
   where approval_private.is_sadad_expense(r) and bank->>'kind' = 'bank_receipt'
     and bank->>'bankName' ~* '(الراجحي|al[[:space:]]*rajhi)'
     and printed_date = r->>'date' and printed_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     -- Existing Al Rajhi format: full debit account, printed date, transaction sequence.
     and ref ~ ('^[0-9]{15,21}' || replace(printed_date,'-','') || '[0-9]{5,10}$')
     and ref is distinct from approval_private.norm_invoice_number(r->>'invoiceNumber')
$$;
revoke all on function approval_private.is_sadad_expense(jsonb), approval_private.sadad_receipt_identity(jsonb)
  from public, anon, authenticated;

-- A namespace ordinary invoice numbers (normalized to uppercase) cannot occupy.
create unique index document_invoices_sadad_transaction_once
  on approval_private.document_invoices(project_id, invoice_number_norm)
  where status='approved' and kind='expense' and invoice_number_norm like 'sadad:%';

-- Modify the two duplicate checks in place. Abort if the installed definitions have drifted.
do $migration$
declare
  core text := pg_get_functiondef('approval_private.plan_invoice_core(public.documents,jsonb,jsonb,jsonb,boolean)'::regprocedure);
  batch text := pg_get_functiondef('public.approval_approve(uuid,uuid,integer,jsonb,jsonb,jsonb)'::regprocedure);
  start_pos int; end_pos int;
  new_check text := $check$
  if v_num is not null then
    select x.document_id, x.journal_number, x.invoice_date, x.total, dd.file_name into v_link
      from approval_private.document_invoices x join public.documents dd on dd.id=x.document_id
     where x.project_id=d.project_id and x.status='approved' and x.kind in ('expense','credit')
       and (
         -- Also find pre-migration approvals still indexed by the biller number.
         (bank_key is not null and (x.invoice_number_norm=bank_key
           or approval_private.sadad_receipt_identity(x.original_reading)=bank_key))
         or (
           (x.supplier_key=v_key or ((x.supplier_key like 'n:%' or v_key like 'n:%')
             and approval_private.norm_name(x.supplier_label)=approval_private.norm_name(v_label)))
           and (
             (x.invoice_number_norm=v_num)
             or ((bank_key is not null or x.invoice_number_norm like 'sadad:%')
               and approval_private.norm_invoice_number(x.invoice_number_raw) in
                 (approval_private.norm_invoice_number(v_num_raw), approval_private.norm_invoice_number(saved->>'invoiceNumber'))
               and not coalesce(
                 bank_key is not null and x.kind='expense' and approval_private.is_sadad_expense(x.original_reading)
                 and (
                   approval_private.sadad_receipt_identity(x.original_reading)<>bank_key
                   or (approval_private.sadad_receipt_identity(x.original_reading) is null
                     and x.invoice_date<>v_date and x.total<>v_total
                     and saved->>'date'=v_date::text and saved->'totalAmount'=to_jsonb(v_total))
                 ), false))
           )
         )
       )
     limit 1;
    if found then return approval_private.err('duplicate_invoice', jsonb_build_object('invoice_id',v_id,'linked',to_jsonb(v_link))); end if;
  end if;
$check$;
begin
  if strpos(core,'  v_num := approval_private.norm_invoice_number(v_num_raw);')=0 then
    raise exception 'Unexpected invoice number initialization'; end if;
  core := replace(core,'declare' || chr(10) || '  v_id uuid','declare' || chr(10) || '  saved jsonb; bank_key text;' || chr(10) || '  v_id uuid');
  core := replace(core,'  v_num := approval_private.norm_invoice_number(v_num_raw);',$init$
  if v_kind='expense' and v_pay='bank' then
    select i.original_reading into saved from approval_private.document_invoices i
     where i.id=v_id and i.document_id=d.id and i.project_id=d.project_id;
    bank_key := approval_private.sadad_receipt_identity(saved);
  end if;
  v_num := coalesce(bank_key, approval_private.norm_invoice_number(v_num_raw));$init$);
  start_pos := strpos(core,'  if v_num is not null then');
  end_pos := strpos(core,'  v_dec := p_decisions -> ''duplicates''');
  if start_pos=0 or end_pos<=start_pos or strpos(substr(core,start_pos,end_pos-start_pos), 'x.invoice_number_norm = v_num')=0
     or strpos(core,'saved jsonb;')=0 then raise exception 'Unexpected invoice duplicate check'; end if;
  execute overlay(core placing new_check from start_pos for end_pos-start_pos);

  start_pos := strpos(batch,'                  where p ->> ''number'' = plan ->> ''number''');
  end_pos := strpos(batch,'        return approval_private.err(''duplicate_in_batch''');
  if start_pos=0 or end_pos<=start_pos then raise exception 'Unexpected batch duplicate check'; end if;
  batch := overlay(batch placing $batch$
                  where p->>'kind' in ('expense','credit') and (
                    (plan->>'number' like 'sadad:%' and p->>'number'=plan->>'number')
                    or ((p->>'supplier_key'=plan->>'supplier_key'
                      or ((p->>'supplier_key' like 'n:%' or plan->>'supplier_key' like 'n:%')
                        and approval_private.norm_name(p->>'label')=approval_private.norm_name(plan->>'label')))
                      and (p->>'number'=plan->>'number'
                        or ((p->>'number' like 'sadad:%')<>(plan->>'number' like 'sadad:%')
                          and approval_private.norm_invoice_number(p->>'number_raw')=approval_private.norm_invoice_number(plan->>'number_raw'))))
                  )) then
$batch$ from start_pos for end_pos-start_pos);
  execute replace(batch,'''duplicate_in_batch'', jsonb_build_object(''invoice_id'', v_id, ''number'', plan ->> ''number'')',
                        '''duplicate_in_batch'', jsonb_build_object(''invoice_id'', v_id, ''number'', plan ->> ''number_raw'')');
end $migration$;
