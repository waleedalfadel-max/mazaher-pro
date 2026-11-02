-- Explicit supplier-credit confirmation for Tashormik document approvals only.
-- No existing records, amounts, permissions or public RPC signatures are changed.
-- Original manual supplier payments retain their limit. Duplicate/tenant/session checks remain in approval_approve.
begin;
CREATE OR REPLACE FUNCTION approval_private.supplier_payment_core(p_project uuid, p_actor uuid, p_actor_name text, p_actor_role text, p_kind text, p_supplier uuid, p_amount numeric, p_date date, p_source text, p_notes text, p_request uuid, p_bank_account uuid, p_document uuid, p_invoice uuid, p_file_url text, p_overpayment jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_name text; v_open numeric; v_unrec numeric; v_paid numeric; v_expense numeric; v_settle numeric; v_bal numeric;
        jn text; v_res jsonb; v_amt numeric; v_confirmation jsonb; v_overpayment jsonb;
begin
  if p_kind is null or p_kind not in ('list', 'payable') or p_supplier is null then return approval_private.err('bad_request'); end if;
  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt <= 0 or v_amt <> p_amount then return approval_private.err('amount_invalid'); end if;
  if p_date is null then return approval_private.err('date_required'); end if;
  if p_source is null or p_source not in ('bank', 'cash') then return approval_private.err('source_invalid'); end if;
  -- الحساب البنكي (20261014140000): منشأة بحسابات تحتاج حسابًا صالحًا للسداد من البنك (أو حسابًا وحيدًا)، قبل أي كتابة
  if p_source = 'bank' then
    v_res := to_jsonb(approval_private.bank_account_check(p_project, null, p_bank_account));
    if v_res <> 'null'::jsonb then return approval_private.err(v_res #>> '{}'); end if;
    v_res := null;
  end if;

  if p_kind = 'list' then
    select s.name, coalesce(s.opening_balance, 0) into v_name, v_open from public.suppliers s
     where s.id = p_supplier and s.project_id = p_project for update;
    if not found then return approval_private.err('not_found'); end if;
    -- بعد قفل المورد: طلب مطابق انتظر القفل نفسه يعيد نتيجة سابقه بدل دفعة ثانية
    if p_request is not null then
      v_res := approval_private.payment_request_replay(p_request, p_project);
      if v_res is not null then return v_res; end if;
    end if;
    -- المستحق للمورد كما تعرضه صفحة «الموردين» (الافتتاحي + الفواتير − الدفعات)، محسوبًا تحت القفل: الدفعة لا تتجاوزه، والدفعتان
    -- المتزامنتان تُحسبان بالتتابع. تجاوز المستحق يتطلب تأكيد الرصيد الحالي تحت قفل المورد.
    select v_open + coalesce(sum(case when t.type = 'invoice' then t.amount when t.type = 'payment' then -t.amount else 0 end), 0) into v_bal
      from public.supplier_transactions t where t.supplier_id = p_supplier and t.project_id = p_project;
    if v_amt > v_bal then
      -- Only an explicitly reviewed document in Tashormik may create supplier credit.
      if p_document is null or p_invoice is null or not exists (
        select 1 from public.projects p where p.id = p_project and p.subdomain = 'tashormik'
      ) then return approval_private.err('exceeds_balance', jsonb_build_object('balance', v_bal, 'name', v_name)); end if;
      v_confirmation := jsonb_build_object('document_id', p_document, 'invoice_id', p_invoice,
        'supplier_kind', p_kind, 'supplier_id', p_supplier, 'date', p_date,
        'amount', v_amt, 'balance', v_bal);
      if p_overpayment is distinct from v_confirmation then
        return approval_private.err('supplier_overpayment_confirmation', jsonb_build_object(
          'invoice_id', p_invoice, 'name', v_name, 'balance', v_bal, 'amount', v_amt,
          'after', v_bal - v_amt, 'excess', v_amt - greatest(v_bal, 0), 'confirmation', v_confirmation));
      end if;
      v_overpayment := v_confirmation || jsonb_build_object('balance_after', v_bal - v_amt,
        'excess', v_amt - greatest(v_bal, 0), 'confirmed_by', p_actor,
        'confirmed_by_name', p_actor_name, 'confirmed_at', now());
    end if;
    -- فواتير القائمة التي لم تدخل الدفتر قط (بلا قيد شراء آجل برقم قيدها): تكلفتها لم تُحتسب، فسدادها تكلفة.
    -- الرصيد الافتتاحي ليس منها: التزام سابق لبداية التسجيل، سداده تسوية لا تكلفة (20261014120000).
    select coalesce(sum(t.amount), 0) into v_unrec from public.supplier_transactions t
     where t.supplier_id = p_supplier and t.project_id = p_project and t.type = 'invoice'
       and not exists (select 1 from public.ledger_entries le where le.project_id = t.project_id and le.journal_number = t.journal_number
                        and coalesce(le.payable_in, 0) > 0 and (le.status is null or le.status <> 'cancelled'));
    select coalesce(sum(t.amount), 0) into v_paid from public.supplier_transactions t
     where t.supplier_id = p_supplier and t.project_id = p_project and t.type = 'payment';
    -- ترتيب السداد (FIFO): الرصيد الافتتاحي أولًا (تسوية)، ثم الفواتير غير المسجلة في الدفتر (تكلفة)، ثم المسجلة (تسوية).
    -- الدفعات السابقة تستهلك الترتيب نفسه، فالحذف وإعادة السداد يعيدان الحساب من الدفعات الباقية.
    v_expense := least(greatest(v_amt - greatest(v_open - v_paid, 0), 0), greatest(v_unrec - greatest(v_paid - v_open, 0), 0));
    v_settle := v_amt - v_expense;
    jn := approval_private.next_journal(p_project, p_date);
    insert into public.supplier_transactions (supplier_id, project_id, type, amount, date, notes, journal_number, document_id)
    values (p_supplier, p_project, 'payment', v_amt, p_date, nullif(btrim(coalesce(p_notes, '')), ''), jn, p_document);
  else
    select ps.name into v_name from public.payable_suppliers ps where ps.id = p_supplier and ps.project_id = p_project for update;
    if not found then return approval_private.err('not_found'); end if;
    if p_request is not null then
      v_res := approval_private.payment_request_replay(p_request, p_project);
      if v_res is not null then return v_res; end if;
    end if;
    select coalesce(sum(coalesce(le.payable_in, 0) - coalesce(le.payable_out, 0)), 0) into v_bal from public.ledger_entries le
     where le.project_id = p_project and le.supplier_id = p_supplier and le.status in ('approved', 'auto');
    if v_amt > v_bal then
      -- Only an explicitly reviewed document in Tashormik may create supplier credit.
      if p_document is null or p_invoice is null or not exists (
        select 1 from public.projects p where p.id = p_project and p.subdomain = 'tashormik'
      ) then return approval_private.err('exceeds_balance', jsonb_build_object('balance', v_bal, 'name', v_name)); end if;
      v_confirmation := jsonb_build_object('document_id', p_document, 'invoice_id', p_invoice,
        'supplier_kind', p_kind, 'supplier_id', p_supplier, 'date', p_date,
        'amount', v_amt, 'balance', v_bal);
      if p_overpayment is distinct from v_confirmation then
        return approval_private.err('supplier_overpayment_confirmation', jsonb_build_object(
          'invoice_id', p_invoice, 'name', v_name, 'balance', v_bal, 'amount', v_amt,
          'after', v_bal - v_amt, 'excess', v_amt - greatest(v_bal, 0), 'confirmation', v_confirmation));
      end if;
      v_overpayment := v_confirmation || jsonb_build_object('balance_after', v_bal - v_amt,
        'excess', v_amt - greatest(v_bal, 0), 'confirmed_by', p_actor,
        'confirmed_by_name', p_actor_name, 'confirmed_at', now());
    end if;
    v_expense := 0; v_settle := v_amt;
    jn := approval_private.next_journal(p_project, p_date);
  end if;

  -- المسار الموثوق لقيد «سداد مورد» داخل طلب من الواجهة (حارس 20261013120000): يُفتح للقيد وحده ثم يُغلق
  perform set_config('tahseeb.supplier_payment', 'on', true);
  insert into public.ledger_entries (project_id, date, type, description, cash_out, bank_out, custody_out, cash_in, bank_in, custody_in,
    payable_in, payable_out, supplier_id, vat_amount, total_amount, status, file_url, journal_number, created_by_user_id, created_by_name, created_by_role,
    bank_account_id, document_id, document_invoice_id)
  -- رقم القيد في الوصف: دفعتان بالمبلغ نفسه للمورد نفسه في اليوم نفسه دفعتان مشروعتان، لا تكرار (فهرس ledger_unique_invoice_legacy_path)
  values (p_project, p_date, '🏪 سداد مورد', 'سداد مستحقات ' || v_name || ' — ' || jn,
    case when p_source = 'cash' then v_amt else 0 end, case when p_source = 'bank' then v_amt else 0 end, 0, 0, 0, 0,
    0, v_settle, case when p_kind = 'payable' then p_supplier end, 0, v_amt, 'approved', coalesce(p_file_url, ''), jn, p_actor, p_actor_name, p_actor_role,
    case when p_source = 'bank' then p_bank_account end, p_document, p_invoice);

  perform set_config('tahseeb.supplier_payment', 'off', true);

  v_res := jsonb_build_object('ok', true, 'journal_number', jn, 'amount', v_amt, 'expense_part', v_expense, 'settlement_part', v_settle);
  if v_overpayment is not null then v_res := v_res || jsonb_build_object('overpayment_confirmation', v_overpayment); end if;
  if p_request is not null then
    insert into approval_private.supplier_payment_requests (request_id, project_id, result) values (p_request, p_project, v_res);
  end if;
  return v_res;
end $function$

;
revoke all on function approval_private.supplier_payment_core(uuid, uuid, text, text, text, uuid, numeric, date, text, text, uuid, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
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
  -- دفعة جديدة: مصدرها وحسابها البنكي؛ فحص المستحق وتأكيد تجاوزه تحت قفل المورد عند الكتابة
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
  if v_amt > v_bal and not exists (select 1 from public.projects p where p.id = d.project_id and p.subdomain = 'tashormik') then return approval_private.err('exceeds_balance', v_inv || jsonb_build_object('balance', greatest(v_bal, 0), 'name', v_name)); end if;
  -- Check the actual balance in the write phase under the supplier lock, including earlier invoices in this batch.
  -- A confirmation failure rolls back the whole approval transaction. OCR payloads never authorize an overpayment.
  plan := plan || jsonb_build_object('overpayment_confirmation', p_decisions -> 'overpayments' -> v_id::text);
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
end $function$

;
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
    null, nullif(plan ->> 'bank', '')::uuid, d.id, v_inv, d.file_url, plan -> 'overpayment_confirmation');
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
end $function$

;
commit;
