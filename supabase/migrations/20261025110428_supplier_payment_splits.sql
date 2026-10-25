-- Optional two-bank settlement for a supplier receipt. No existing rows are updated.
-- The existing approval transaction, supplier locks, replay protection and delete/reopen flow are retained.
-- The supplier transaction remains one total; its ledger legs carry only their own amounts.
begin;
-- One supplier payment header may have two bank legs. Group legacy null journals by row id.
create or replace view approval_private.supplier_payment_totals as
select le.project_id, le.journal_number, min(le.id::text)::uuid as id, min(le.date) as date,
  min(le.type) as type, min(le.status) as status,
  sum(le.total_amount) as total_amount, sum(le.bank_out) as bank_out, sum(le.cash_out) as cash_out,
  case when count(distinct le.bank_account_id)=1 then min(le.bank_account_id::text)::uuid end as bank_account_id,
  min(le.document_id::text)::uuid as document_id, min(le.supplier_id::text)::uuid as supplier_id,
  min(le.created_by_name) as created_by_name,
  jsonb_agg(jsonb_build_object('bankAccountId',le.bank_account_id,'amount',le.total_amount,'source',case when le.bank_out>0 then 'bank' else 'cash' end) order by le.created_at,le.id) as allocations
from public.ledger_entries le
where le.type like '%سداد مورد%' and le.status in ('approved','auto')
group by le.project_id, le.journal_number, case when le.journal_number is null then le.id end;
revoke all on approval_private.supplier_payment_totals from public, anon, authenticated;

create or replace function approval_private.validate_supplier_payment_split(p_project uuid, p_parts jsonb, p_total numeric)
returns jsonb language plpgsql stable set search_path to '' as $split$
declare v_part jsonb; v_account uuid; v_amount numeric; v_sum numeric := 0; v_ids uuid[] := '{}'; v_normal jsonb := '[]';
begin
  if jsonb_typeof(p_parts) is distinct from 'array' then return approval_private.err('payment_split_invalid'); end if;
  if jsonb_array_length(p_parts) <> 2 then return approval_private.err('payment_split_invalid'); end if;
  for v_part in select value from jsonb_array_elements(p_parts) loop
    v_account := nullif(v_part ->> 'bankAccountId','')::uuid;
    v_amount := approval_private.money(v_part -> 'amount', 'paymentAllocations.amount');
    if v_account is null or v_amount is null or v_amount <= 0 or v_amount::text in ('NaN','Infinity','-Infinity') or v_account = any(v_ids) then
      return approval_private.err('payment_split_invalid');
    end if;
    if not exists (select 1 from public.bank_accounts b where b.id=v_account and b.project_id=p_project and b.is_active) then
      return approval_private.err('bank_account_invalid');
    end if;
    v_ids := array_append(v_ids,v_account); v_sum := v_sum + v_amount;
    v_normal := v_normal || jsonb_build_array(jsonb_build_object('bankAccountId',v_account,'amount',v_amount));
  end loop;
  if p_total is null or v_sum <> p_total then return approval_private.err('payment_split_mismatch',jsonb_build_object('split_total',v_sum,'amount',p_total)); end if;
  return jsonb_build_object('ok',true,'allocations',v_normal);
exception when invalid_text_representation or numeric_value_out_of_range then return approval_private.err('payment_split_invalid');
end $split$;
revoke all on function approval_private.validate_supplier_payment_split(uuid,jsonb,numeric) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION approval_private.plan_supplier_payment(d documents, inv jsonb, p_decisions jsonb, v_known boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_id uuid := (inv ->> '_id')::uuid; v_date date; v_amt numeric; v_kind text := nullif(inv ->> 'supplierKind', ''); v_sup uuid;
  v_split jsonb; v_name text; v_open numeric; v_bal numeric; v_mode text; v_src text; v_code text; v_ref_raw text; v_ref text; v_key text;
  v_link record; v_jn text; v_cands jsonb; v_reason text; plan jsonb; v_inv jsonb := jsonb_build_object('invoice_id', (inv ->> '_id'));
begin
  v_date := nullif(inv ->> 'date', '')::date;
  if v_date is null then return approval_private.err('date_required', v_inv); end if;
  v_amt := approval_private.money(coalesce(inv -> 'amount', inv -> 'totalAmount'), 'amount');
  if v_amt <= 0 then return approval_private.err('amount_required', v_inv); end if;
  v_sup := nullif(inv ->> 'supplierId', '')::uuid;
  if v_kind = 'list' then
    select s.name, coalesce(s.opening_balance, 0) into v_name, v_open from public.suppliers s where s.id = v_sup and s.project_id = d.project_id;
  elsif v_kind = 'payable' then
    select ps.name into v_name from public.payable_suppliers ps where ps.id = v_sup and ps.project_id = d.project_id;
  end if;
  -- المورد يختاره المراجع من موردي المنشأة؛ لا يُنشأ مورد من اسم المستفيد
  if v_name is null then return approval_private.err('supplier_required', v_inv); end if;
  v_key := case v_kind when 'list' then 's:' else 'ps:' end || v_sup;
  v_ref_raw := nullif(btrim(coalesce(inv ->> 'reference', '')), '');
  v_ref := approval_private.norm_invoice_number(v_ref_raw);
  v_mode := coalesce(nullif(inv ->> 'paymentMode', ''), 'new');
  if v_mode not in ('new', 'link') then return approval_private.err('payment_mode_required', v_inv); end if;
  -- سبب المراجع لاشتباه التكرار: «دفعة أخرى» للدفعة الجديدة، و«مستند آخر للدفعة نفسها» للربط
  v_reason := nullif(btrim(coalesce(inv ->> case v_mode when 'link' then 'linkReason' else 'newPaymentReason' end, '')), '');
  plan := jsonb_build_object('ok', true, 'id', v_id, 'kind', 'supplier_payment', 'date', v_date, 'total', v_amt,
    'description', coalesce(nullif(btrim(coalesce(inv ->> 'description', '')), ''), 'إيصال سداد — ' || v_name),
    'number_raw', v_ref_raw, 'number', v_ref, 'payload', inv, 'known', v_known, 'branch', null,
    'supplier_kind', v_kind, 'supplier_id', v_sup, 'supplier_key', v_key, 'label', v_name, 'mode', v_mode);

  -- اشتباه التكرار (لا منع): إيصالات معتمدة للمورد نفسه بالمرجع نفسه، أو بالتاريخ والمبلغ نفسيهما وأحدهما بلا مرجع.
  -- التشابه لا يثبت أنه الإيصال نفسه: يُعرض السابق، والمراجع يحسم بسبب مكتوب. المنع القاطع للتكرار المثبت وحده (المستند نفسه
  -- أو الطلب نفسه، في approval_approve).
  select jsonb_agg(c order by c.date desc, c.journal_number) into v_cands from (
    select 'receipt' as kind, x.journal_number, x.invoice_date as date, x.total as amount, x.document_id, dd.file_name,
           (v_ref is not null and x.invoice_number_norm = v_ref) as same_reference, x.approved_payload ->> 'payment_mode' as payment_mode
      from approval_private.document_invoices x join public.documents dd on dd.id = x.document_id
     where x.project_id = d.project_id and x.status = 'approved' and x.kind = 'supplier_payment' and x.supplier_key = v_key
       and ((v_ref is not null and x.invoice_number_norm = v_ref)
            or (x.invoice_date = v_date and x.total = v_amt and (v_ref is null or x.invoice_number_norm is null)))
     limit 5) c;

  if v_mode = 'link' then
    v_jn := nullif(btrim(coalesce(inv ->> 'linkJournal', '')), '');
    if v_jn is null then return approval_private.err('link_required', v_inv); end if;
    select le.id, le.date, le.total_amount, le.document_id, le.supplier_id into v_link
      from approval_private.supplier_payment_totals le
     where le.project_id = d.project_id and le.journal_number = v_jn and le.type like '%سداد مورد%' and le.status in ('approved', 'auto')
     limit 1;
    if not found then return approval_private.err('link_not_found', v_inv || jsonb_build_object('journal_number', v_jn)); end if;
    if (v_kind = 'list' and not exists (select 1 from public.supplier_transactions t where t.project_id = d.project_id
                                          and t.journal_number = v_jn and t.type = 'payment' and t.supplier_id = v_sup))
       or (v_kind = 'payable' and v_link.supplier_id is distinct from v_sup) then
      return approval_private.err('link_supplier_mismatch', v_inv || jsonb_build_object('journal_number', v_jn, 'name', v_name));
    end if;
    if v_link.total_amount <> v_amt then
      return approval_private.err('link_amount_mismatch', v_inv || jsonb_build_object('journal_number', v_jn, 'payment_amount', v_link.total_amount, 'amount', v_amt));
    end if;
    -- الربط لا ينشئ أثرًا ماليًا. للدفعة الواحدة أكثر من مستند مشروع (إشعار التحويل وسند قبض المورد): المستند المرفق سابقًا
    -- يُعرض، والمراجع يؤكد أنه مستند آخر للدفعة نفسها بسبب مكتوب
    v_cands := coalesce(v_cands, '[]'::jsonb) || coalesce((select jsonb_agg(jsonb_build_object('kind', 'payment_document', 'journal_number', v_jn,
        'date', x.invoice_date, 'amount', x.total, 'document_id', x.document_id, 'file_name', dd.file_name))
      from approval_private.document_invoices x join public.documents dd on dd.id = x.document_id
     where x.project_id = d.project_id and x.status = 'approved' and x.kind = 'supplier_payment' and x.journal_number = v_jn), '[]'::jsonb);
    if v_link.document_id is not null and not exists (select 1 from jsonb_array_elements(v_cands) c where c ->> 'document_id' = v_link.document_id::text) then
      v_cands := v_cands || jsonb_build_array(jsonb_build_object('kind', 'payment_document', 'journal_number', v_jn, 'document_id', v_link.document_id,
        'file_name', (select dd.file_name from public.documents dd where dd.id = v_link.document_id)));
    end if;
    if jsonb_array_length(v_cands) > 0 and v_reason is null then
      return approval_private.err('payment_possible_duplicate', v_inv || jsonb_build_object('candidates', v_cands, 'name', v_name, 'mode', 'link'));
    end if;
    return plan || jsonb_build_object('link_journal', v_jn, 'pay', null,
      'duplicate_decision', case when jsonb_array_length(v_cands) > 0 then jsonb_build_object('kind', 'receipt_link', 'reason', v_reason, 'candidates', v_cands) end);
  end if;

  if inv -> 'splitPayment' = 'true'::jsonb then
    v_split := approval_private.validate_supplier_payment_split(d.project_id, inv -> 'paymentAllocations', v_amt);
    if not coalesce((v_split ->> 'ok')::boolean, false) then return v_split || v_inv; end if;
    inv := inv || jsonb_build_object('paySource', 'bank', 'bankAccountId', v_split -> 'allocations' -> 0 ->> 'bankAccountId');
    plan := plan || jsonb_build_object('allocations', v_split -> 'allocations', 'payload', inv || jsonb_build_object('paymentAllocations', v_split -> 'allocations'));
  elsif inv ? 'paymentAllocations' and inv -> 'paymentAllocations' <> 'null'::jsonb then
    return approval_private.err('payment_split_invalid', v_inv);
  end if;
  -- دفعة جديدة: مصدرها وحسابها البنكي، ولا تتجاوز المستحق (يُعاد الفحص تحت قفل المورد عند الكتابة)
  v_src := nullif(inv ->> 'paySource', '');
  if v_src is null or v_src not in ('cash', 'bank') then return approval_private.err('pay_required', v_inv); end if;
  if v_src = 'bank' then
    v_code := approval_private.bank_account_check(d.project_id, null, nullif(inv ->> 'bankAccountId', '')::uuid);
    if v_code is not null then return approval_private.err(v_code, v_inv); end if;
  end if;
  if v_kind = 'list' then
    select v_open + coalesce(sum(case when t.type = 'invoice' then t.amount when t.type = 'payment' then -t.amount else 0 end), 0) into v_bal
      from public.supplier_transactions t where t.supplier_id = v_sup and t.project_id = d.project_id;
  else
    select coalesce(sum(coalesce(le.payable_in, 0) - coalesce(le.payable_out, 0)), 0) into v_bal from public.ledger_entries le
     where le.project_id = d.project_id and le.supplier_id = v_sup and le.status in ('approved', 'auto');
  end if;
  if v_amt > v_bal then return approval_private.err('exceeds_balance', v_inv || jsonb_build_object('balance', greatest(v_bal, 0), 'name', v_name)); end if;
  -- ودفعات قائمة للمورد نفسه بالمبلغ نفسه خلال 7 أيام (من «الموردين» أو من إيصالات)
  v_cands := coalesce(v_cands, '[]'::jsonb) || coalesce((select jsonb_agg(c order by c.days, c.journal_number) from (
      select 'payment' as kind, le.journal_number, le.date, le.total_amount as amount, abs(le.date - v_date) as days, le.document_id, dd.file_name,
             case when le.bank_out > 0 then 'bank' else 'cash' end as source
        from approval_private.supplier_payment_totals le left join public.documents dd on dd.id = le.document_id
       where le.project_id = d.project_id and le.type like '%سداد مورد%' and le.status in ('approved', 'auto')
         and le.total_amount = v_amt and abs(le.date - v_date) <= 7
         and ((v_kind = 'payable' and le.supplier_id = v_sup)
              or (v_kind = 'list' and exists (select 1 from public.supplier_transactions t where t.project_id = d.project_id
                                                and t.journal_number = le.journal_number and t.type = 'payment' and t.supplier_id = v_sup)))
       limit 5) c), '[]'::jsonb);
  if jsonb_array_length(v_cands) > 0 and v_reason is null then
    return approval_private.err('payment_possible_duplicate', v_inv || jsonb_build_object('candidates', v_cands, 'name', v_name, 'mode', 'new'));
  end if;
  return plan || jsonb_build_object('pay', v_src, 'bank', nullif(inv ->> 'bankAccountId', ''), 'new_reason', v_reason,
    'duplicate_decision', case when jsonb_array_length(v_cands) > 0 then jsonb_build_object('kind', 'receipt_new_payment', 'reason', v_reason, 'candidates', v_cands) end);
exception when sqlstate 'P0001' then
  if sqlerrm like 'APPROVAL:%' then
    return approval_private.err(split_part(sqlerrm, ':', 2), v_inv || jsonb_build_object('field', split_part(sqlerrm, ':', 3)));
  end if;
  raise;
end $function$;

CREATE OR REPLACE FUNCTION approval_private.write_supplier_payment(d documents, plan jsonb, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare u record; v_res jsonb; v_jn text; v_led record; v_part jsonb; v_row public.ledger_entries; v_piece numeric; v_remaining numeric; v_first boolean := true; v_check jsonb; v_sup uuid := (plan ->> 'supplier_id')::uuid; v_inv uuid := (plan ->> 'id')::uuid;
begin
  select x.id, x.name, x.role into u from public.app_users x where x.id = p_actor;
  if plan ->> 'mode' = 'link' then
    v_jn := plan ->> 'link_journal';
    -- ترتيب الأقفال كالدفعة والحذف: المورد ثم قيده
    if plan ->> 'supplier_kind' = 'list' then
      perform 1 from public.suppliers s where s.id = v_sup and s.project_id = d.project_id for update;
    else
      perform 1 from public.payable_suppliers ps where ps.id = v_sup and ps.project_id = d.project_id for update;
    end if;
    select le.id, le.document_id into v_led from public.ledger_entries le
     where le.project_id = d.project_id and le.journal_number = v_jn and le.type like '%سداد مورد%' limit 1 for update;
    if not found then
      raise exception 'APPROVAL_WRITE:link_not_found' using errcode = 'P0001',
        detail = approval_private.err('link_not_found', jsonb_build_object('invoice_id', v_inv, 'journal_number', v_jn))::text;
    end if;
    -- أول مستند للدفعة يُسجَّل على قيدها وحركتها؛ المستند الإضافي (بعد تأكيد المراجع) يرتبط بها برقم القيد في فاتورته وحدها
    if v_led.document_id is null then
      perform set_config('tahseeb.supplier_payment', 'on', true);
      update public.ledger_entries le set document_id = d.id, document_invoice_id = v_inv, file_url = coalesce(nullif(d.file_url, ''), le.file_url)
       where le.project_id = d.project_id and le.journal_number = v_jn and le.type like '%سداد مورد%';
      update public.supplier_transactions t set document_id = d.id
       where t.project_id = d.project_id and t.journal_number = v_jn and t.type = 'payment' and t.document_id is null;
      perform set_config('tahseeb.supplier_payment', 'off', true);
    end if;
    return jsonb_build_object('journal_number', v_jn, 'payment_mode', 'link', 'primary_document', v_led.document_id is null);
  end if;

  if plan ? 'allocations' then
    v_check := approval_private.validate_supplier_payment_split(d.project_id, plan -> 'allocations', (plan ->> 'total')::numeric);
    if not coalesce((v_check ->> 'ok')::boolean, false) then
      raise exception 'APPROVAL_WRITE:payment_split_invalid' using errcode = 'P0001', detail = (v_check || jsonb_build_object('invoice_id', v_inv))::text;
    end if;
  end if;
  v_res := approval_private.supplier_payment_core(d.project_id, u.id, u.name, u.role, plan ->> 'supplier_kind', v_sup,
    (plan ->> 'total')::numeric, (plan ->> 'date')::date, plan ->> 'pay',
    coalesce('إيصال ' || nullif(plan ->> 'number_raw', '') || ' — ', '') || coalesce(plan ->> 'description', ''),
    null, nullif(plan ->> 'bank', '')::uuid, d.id, v_inv, d.file_url);
  if not coalesce((v_res ->> 'ok')::boolean, false) then
    raise exception 'APPROVAL_WRITE:%', v_res ->> 'code' using errcode = 'P0001',
      detail = (v_res || jsonb_build_object('invoice_id', v_inv))::text;
  end if;
  if plan ? 'allocations' then
    select * into strict v_row from public.ledger_entries le
      where le.project_id = d.project_id and le.journal_number = v_res ->> 'journal_number' and le.type like '%سداد مورد%' for update;
    v_remaining := v_row.payable_out;
    perform set_config('tahseeb.supplier_payment', 'on', true);
    for v_part in select value from jsonb_array_elements(v_check -> 'allocations') loop
      v_piece := (v_part ->> 'amount')::numeric;
      -- Settlement consumes the documented opening/recorded debt first, exactly as the single payment did.
      -- Across all legs payable_out + expense component and bank_out still sum to the original payment.
      if v_first then
        update public.ledger_entries set total_amount = v_piece, bank_out = v_piece,
          bank_account_id = (v_part ->> 'bankAccountId')::uuid, payable_out = least(v_remaining, v_piece)
          where id = v_row.id and project_id = d.project_id;
        v_first := false;
      else
        v_row.id := gen_random_uuid();
        v_row.total_amount := v_piece; v_row.bank_out := v_piece;
        v_row.bank_account_id := (v_part ->> 'bankAccountId')::uuid;
        v_row.payable_out := least(v_remaining, v_piece);
        insert into public.ledger_entries select (v_row).*;
      end if;
      v_remaining := greatest(v_remaining - v_piece, 0);
    end loop;
    perform set_config('tahseeb.supplier_payment', 'off', true);
    v_res := v_res || jsonb_build_object('allocations', v_check -> 'allocations');
  end if;
  -- نتيجة الدفعة تحت مفتاحها، لا تغطي حقول الإيصال المرسلة (amount) في approved_payload
  return jsonb_build_object('journal_number', v_res ->> 'journal_number', 'payment_mode', 'new', 'payment_result', v_res - 'ok');
end $function$;

CREATE OR REPLACE FUNCTION public.supplier_payment_context(p_kind text, p_supplier uuid, p_document uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a record; v_name text; v_bal numeric; v_pay jsonb; v_wait jsonb;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role not in ('accountant', 'superadmin', 'owner') or a.project_id is null then return approval_private.err('forbidden'); end if;
  if p_kind = 'list' then
    select s.name, coalesce(s.opening_balance, 0) + coalesce((select sum(case when t.type = 'invoice' then t.amount when t.type = 'payment' then -t.amount else 0 end)
             from public.supplier_transactions t where t.supplier_id = s.id and t.project_id = a.project_id), 0)
      into v_name, v_bal from public.suppliers s where s.id = p_supplier and s.project_id = a.project_id;
  elsif p_kind = 'payable' then
    select ps.name, coalesce((select sum(coalesce(le.payable_in, 0) - coalesce(le.payable_out, 0)) from public.ledger_entries le
             where le.project_id = a.project_id and le.supplier_id = ps.id and le.status in ('approved', 'auto')), 0)
      into v_name, v_bal from public.payable_suppliers ps where ps.id = p_supplier and ps.project_id = a.project_id;
  end if;
  if v_name is null then return approval_private.err('not_found'); end if;

  select coalesce(jsonb_agg(p order by p.date desc, p.journal_number desc), '[]') into v_pay from (
    select le.journal_number, le.date, le.total_amount as amount, case when le.bank_out > 0 then 'bank' else 'cash' end as source,
           le.bank_account_id, le.allocations, le.document_id, dd.file_name, dd.status as document_status, le.created_by_name,
           coalesce((select jsonb_agg(jsonb_build_object('document_id', x.document_id, 'file_name', xd.file_name) order by x.decided_at)
              from approval_private.document_invoices x join public.documents xd on xd.id = x.document_id
             where x.project_id = a.project_id and x.status = 'approved' and x.kind = 'supplier_payment' and x.journal_number = le.journal_number), '[]'::jsonb) as documents
      from approval_private.supplier_payment_totals le left join public.documents dd on dd.id = le.document_id
     where le.project_id = a.project_id and le.type like '%سداد مورد%' and le.status in ('approved', 'auto')
       and ((p_kind = 'payable' and le.supplier_id = p_supplier)
            or (p_kind = 'list' and exists (select 1 from public.supplier_transactions t where t.project_id = a.project_id
                                              and t.journal_number = le.journal_number and t.type = 'payment' and t.supplier_id = p_supplier)))
     order by le.date desc, le.journal_number desc limit 50) p;

  -- إيصالات «سداد مورد» لهذا المورد لم تُعتمد بعد (في مستندات جديدة)
  select coalesce(jsonb_agg(w order by w.uploaded_at desc), '[]') into v_wait from (
    select dd.id as document_id, dd.file_name, dd.uploaded_at, e ->> '_id' as invoice_id, e ->> 'amount' as amount, e ->> 'date' as date,
           e ->> 'paymentMode' as payment_mode
      from public.documents dd
      cross join lateral jsonb_array_elements(case when jsonb_typeof(dd.analysis_result -> 'invoices') = 'array' then dd.analysis_result -> 'invoices'
                                                   else jsonb_build_array(dd.analysis_result) end) e
     where dd.project_id = a.project_id and dd.status = 'analyzed' and dd.id is distinct from p_document
       and e ->> 'type' = 'supplier_payment'
       -- المورد كما اختاره المراجع في المسودة المحفوظة، أو كما اقترحته القراءة، أو اسم المستفيد المطبوع مطابقًا لاسمه
       and ((e ->> 'supplierKind' = p_kind and e ->> 'supplierId' = p_supplier::text)
            or (e -> 'suggestedSupplier' ->> 'kind' = p_kind and e -> 'suggestedSupplier' ->> 'id' = p_supplier::text)
            or (nullif(e ->> 'beneficiary', '') is not null and approval_private.norm_name(e ->> 'beneficiary') = approval_private.norm_name(v_name)))
       and not exists (select 1 from approval_private.document_invoices x where x.id::text = e ->> '_id' and x.status <> 'pending')
     limit 20) w;

  return jsonb_build_object('ok', true, 'name', v_name, 'balance', v_bal, 'payments', v_pay, 'pending_receipts', v_wait);
end $function$;

commit;
