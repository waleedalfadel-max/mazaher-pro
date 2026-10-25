-- Disable new splits; retain aggregate readers so existing split payments remain linkable/deletable. No data is removed.
begin;
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

  if inv -> 'splitPayment' = 'true'::jsonb or inv ? 'paymentAllocations' then return approval_private.err('payment_split_disabled', v_inv); end if;
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
declare u record; v_res jsonb; v_jn text; v_led record; v_sup uuid := (plan ->> 'supplier_id')::uuid; v_inv uuid := (plan ->> 'id')::uuid;
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

  v_res := approval_private.supplier_payment_core(d.project_id, u.id, u.name, u.role, plan ->> 'supplier_kind', v_sup,
    (plan ->> 'total')::numeric, (plan ->> 'date')::date, plan ->> 'pay',
    coalesce('إيصال ' || nullif(plan ->> 'number_raw', '') || ' — ', '') || coalesce(plan ->> 'description', ''),
    null, nullif(plan ->> 'bank', '')::uuid, d.id, v_inv, d.file_url);
  if not coalesce((v_res ->> 'ok')::boolean, false) then
    raise exception 'APPROVAL_WRITE:%', v_res ->> 'code' using errcode = 'P0001',
      detail = (v_res || jsonb_build_object('invoice_id', v_inv))::text;
  end if;
  -- نتيجة الدفعة تحت مفتاحها، لا تغطي حقول الإيصال المرسلة (amount) في approved_payload
  return jsonb_build_object('journal_number', v_res ->> 'journal_number', 'payment_mode', 'new', 'payment_result', v_res - 'ok');
end $function$;

commit;
