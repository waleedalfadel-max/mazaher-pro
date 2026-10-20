-- إيصالات سداد الموردين من «المستندات» (2026-10-20)
--
-- كان: قيد «سداد مورد» يُسجَّل من صفحة «الموردين» وحدها، والمستند الذي فيه سداد يُرفض في الاعتماد (supplier_payment_via_suppliers)،
-- فالإيصال لا يرتبط بالدفعة ولا بالمورد.
-- الآن: فاتورة في المستند نوعها supplier_payment («سداد مورد») يعتمدها المحاسب أو إدارة تحسيب بأحد مسارين:
--   • new  — دفعة جديدة: الدالة نفسها التي تسجّل دفعة «الموردين» (supplier_payment_core، منقولة حرفيًا من supplier_payment_record)
--            داخل معاملة الاعتماد: حركة «دفعة» للمورد + قيد «🏪 سداد مورد» يخفض المستحق والصندوق أو البنك، مربوطان بالمستند وفاتورته.
--            قواعد البيانات القديمة كما هي: الرصيد الافتتاحي أولًا (تسوية)، ثم فواتير لم تدخل الدفتر قط (تكلفة)، ثم المسجلة (تسوية).
--   • link — ربط بدفعة مسجلة سابقًا: يُرفق المستند بها بلا أي أثر مالي جديد. المبلغ يجب أن يساوي مبلغ الدفعة. للدفعة الواحدة
--            أكثر من مستند مشروع (إشعار التحويل وسند قبض المورد): المستند المرفق سابقًا يُعرض، والمراجع يؤكد بسبب مكتوب.
-- الدفعة والربط وحالة الفاتورة والمستند في معاملة approval_approve نفسها: كلها أو لا شيء، وإعادة الطلب نفسه لا تكرر شيئًا.
-- التكرار:
--   • المثبت يُمنع قطعيًا: المستند نفسه أو فاتورته بعد اعتمادها (already_approved / invoice_already_decided)، والطلب نفسه (يعيد
--     نتيجته الأولى بلا كتابة)، والاعتماد المتزامن للمستند نفسه (قفله).
--   • التشابه اشتباه يُعرض ولا يُمنع: إيصال معتمد للمورد نفسه بالمرجع نفسه، أو بالتاريخ والمبلغ نفسيهما وأحدهما بلا مرجع؛ ودفعة
--     قائمة بالمبلغ نفسه خلال 7 أيام؛ ومستند مرفق سابقًا بالدفعة المربوطة؛ وإيصالان متشابهان في الطلب نفسه. يتوقف الاعتماد حتى يكتب
--     المحاسب أو إدارة تحسيب سببًا (newPaymentReason / linkReason)، فيُحفظ مع المرشحين والمنفّذ والوقت في duplicate_decision.
--   • حدود الكشف: المرجع والتاريخ والمبلغ من قراءة الإيصال (قد تُخطئ القراءة)؛ لا مقارنة لمحتوى الصورة، فإعادة تصوير الإيصال
--     ملف آخر؛ النافذة 7 أيام؛ المقارنة داخل المورد الواحد.
-- حذف دفعة مرتبطة بإيصال (supplier_payment_delete) يعيد فاتورة الإيصال «بانتظار الاعتماد» ومستندها إلى «مستندات جديدة»، مع سجل
-- في history، فلا يبقى مستند «معتمد» بلا دفعة.
-- supplier_payment_context: قراءة لشاشة المراجعة و«الموردين» (الرصيد، الدفعات وإيصالاتها، الإيصالات المنتظرة للمورد).
-- لا تغيير على بيانات قائمة. الرجوع: supabase/rollback/20261020/rollback-20261020120000.sql

alter table approval_private.document_invoices add column if not exists history jsonb not null default '[]'::jsonb;


-- ─── الدفعة نفسها: جسم supplier_payment_record السابق بلا تحديد المنفّذ، ومعه ربط اختياري بالمستند ─────────────────────────
create function approval_private.supplier_payment_core(p_project uuid, p_actor uuid, p_actor_name text, p_actor_role text,
  p_kind text, p_supplier uuid, p_amount numeric, p_date date, p_source text, p_notes text, p_request uuid, p_bank_account uuid,
  p_document uuid default null, p_invoice uuid default null, p_file_url text default null)
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
declare v_name text; v_open numeric; v_unrec numeric; v_paid numeric; v_expense numeric; v_settle numeric; v_bal numeric;
        jn text; v_res jsonb; v_amt numeric;
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
    -- المتزامنتان تُحسبان بالتتابع. الدفعة المقدمة لمورد ليست من هذا المسار (سلوك منفصل غير مُعرَّف).
    select v_open + coalesce(sum(case when t.type = 'invoice' then t.amount when t.type = 'payment' then -t.amount else 0 end), 0) into v_bal
      from public.supplier_transactions t where t.supplier_id = p_supplier and t.project_id = p_project;
    if v_amt > v_bal then return approval_private.err('exceeds_balance', jsonb_build_object('balance', greatest(v_bal, 0))); end if;
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
    if v_amt > v_bal then return approval_private.err('exceeds_balance', jsonb_build_object('balance', v_bal)); end if;
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
  if p_request is not null then
    insert into approval_private.supplier_payment_requests (request_id, project_id, result) values (p_request, p_project, v_res);
  end if;
  return v_res;
end $function$;
revoke all on function approval_private.supplier_payment_core(uuid, uuid, text, text, text, uuid, numeric, date, text, text, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;

-- ─── «الموردين»: السلوك نفسه، والمنفّذ من الجلسة ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.supplier_payment_record(p_kind text, p_supplier uuid, p_amount numeric, p_date date, p_source text, p_notes text DEFAULT NULL::text, p_request uuid DEFAULT NULL::uuid, p_bank_account uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a record; v_res jsonb;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role not in ('accountant', 'superadmin') or a.project_id is null then return approval_private.err('forbidden'); end if;
  if not coalesce((select ps.active from public.project_settings ps where ps.project_id = a.project_id), true) then
    return approval_private.err('project_inactive');
  end if;
  if p_request is not null then
    v_res := approval_private.payment_request_replay(p_request, a.project_id);
    if v_res is not null then return v_res; end if;
  end if;
  return approval_private.supplier_payment_core(a.project_id, a.id, a.name, a.role, p_kind, p_supplier, p_amount, p_date, p_source,
    p_notes, p_request, p_bank_account);
end $function$;

-- ─── خطة فاتورة «سداد مورد» في المستند (بلا كتابة) ───────────────────────────────────────────────────────────────────
create function approval_private.plan_supplier_payment(d public.documents, inv jsonb, p_decisions jsonb, v_known boolean)
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
as $function$
declare
  v_id uuid := (inv ->> '_id')::uuid; v_date date; v_amt numeric; v_kind text := nullif(inv ->> 'supplierKind', ''); v_sup uuid;
  v_name text; v_open numeric; v_bal numeric; v_mode text; v_src text; v_code text; v_ref_raw text; v_ref text; v_key text;
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
      from public.ledger_entries le
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
        from public.ledger_entries le left join public.documents dd on dd.id = le.document_id
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
revoke all on function approval_private.plan_supplier_payment(public.documents, jsonb, jsonb, boolean) from public, anon, authenticated;

-- ─── كتابة «سداد مورد» داخل معاملة الاعتماد ────────────────────────────────────────────────────────────────────────
-- الخطأ هنا (مستحق تغيّر، دفعة حُذفت للتو) يُرفع APPROVAL_WRITE فيلغي approval_approve كل كتابة الطلب ويعيد رمزه.
create function approval_private.write_supplier_payment(d public.documents, plan jsonb, p_actor uuid)
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
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
revoke all on function approval_private.write_supplier_payment(public.documents, jsonb, uuid) from public, anon, authenticated;

-- ─── plan_invoice: «سداد مورد» بخطته، والباقي كما كان حرفيًا ─────────────────────────────────────────────────────
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
end $function$;

-- ─── write_invoice: «سداد مورد» بدالته (رقم قيده منها)، والباقي كما كان حرفيًا ───────────────────────────────────────
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

  if v_kind = 'sales' then
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
end $function$;

-- ─── approval_approve: كما كان، ومعه رمز خطأ الكتابة (APPROVAL_WRITE) بدل استثناء ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approval_approve(p_document_id uuid, p_request_id uuid, p_expected_version integer, p_invoices jsonb, p_decisions jsonb DEFAULT '{}'::jsonb, p_document jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a record; d public.documents; rq record; di record; inv jsonb; plan jsonb; plans jsonb := '[]'; journals jsonb := '[]'; res jsonb;
  fp text := md5(jsonb_build_array(p_document_id, p_invoices, coalesce(p_decisions, '{}'), coalesce(p_document, '{}'))::text);
  v_id uuid; v_seen text[] := '{}'; v_num_keys text[] := '{}'; jn text; v_first_jn text; v_pending int; v_detail text; v_batch jsonb; v_reason text;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if p_request_id is null then return approval_private.err('request_id_required'); end if;

  select * into d from public.documents where id = p_document_id for update;   -- الطلب المتزامن للمستند نفسه ينتظر هنا
  if d.id is null or a.project_id is distinct from d.project_id then return approval_private.err('not_found'); end if;
  if not approval_private.can_approve(a.role, d.project_id) then return approval_private.err('forbidden'); end if;
  -- إعادة الطلب: بعد التحقق من المنشأة والصلاحية الحالية، ولصاحب الطلب وللمستند نفسه فقط
  res := approval_private.replay(p_request_id, a.id, a.project_id, p_document_id, fp); if res is not null then return res; end if;
  case approval_private.mode_of(d.project_id)
    when 'legacy' then return approval_private.err('legacy_mode');
    when 'paused' then return approval_private.err('paused');
    else null;
  end case;
  perform pg_advisory_xact_lock(hashtextextended('approval:' || d.project_id::text, 0));

  -- طلب مطابق اكتمل أثناء الانتظار على القفل
  res := approval_private.replay(p_request_id, a.id, a.project_id, p_document_id, fp); if res is not null then return res; end if;

  if d.status = 'approved' then
    return approval_private.err('already_approved', jsonb_build_object('journal_number', d.journal_number, 'approved_at', d.approved_at));
  end if;
  if d.status <> 'analyzed' then return approval_private.err('bad_status', jsonb_build_object('status', d.status)); end if;
  if d.version <> p_expected_version then return approval_private.err('stale', jsonb_build_object('version', d.version)); end if;
  if jsonb_typeof(p_invoices) <> 'array' or jsonb_array_length(p_invoices) = 0 then return approval_private.err('empty'); end if;

  -- المرحلة 1: خطة كل فاتورة، بلا أي كتابة
  for inv in select value from jsonb_array_elements(p_invoices) loop
    v_id := nullif(inv ->> '_id', '')::uuid;
    if v_id is null then return approval_private.err('invoice_id_missing'); end if;
    if v_id::text = any (v_seen) then return approval_private.err('duplicate_in_batch', jsonb_build_object('invoice_id', v_id)); end if;
    v_seen := v_seen || v_id::text;
    select * into di from approval_private.document_invoices where id = v_id;
    if found and di.document_id <> d.id then return approval_private.err('invoice_mismatch', jsonb_build_object('invoice_id', v_id)); end if;
    if found and di.status <> 'pending' then
      return approval_private.err('invoice_already_decided', jsonb_build_object('invoice_id', v_id, 'status', di.status, 'journal_number', di.journal_number));
    end if;
    plan := approval_private.plan_invoice(d, inv, coalesce(p_decisions, '{}'), coalesce(p_document, '{}'), di.id is not null);
    if not (plan ->> 'ok')::boolean then return plan; end if;
    -- الرقم نفسه لمورد بالاسم نفسه داخل الطلب، ولو اختلف مسار الدفع، متى كان أحد الطرفين بلا سجل مورد (مفتاحه الاسم).
    -- موردان مسجّلان مختلفان بالاسم نفسه ليسا تكرارًا. الرفض في مرحلة الخطة، قبل أي كتابة.
    if plan ->> 'number' is not null and plan ->> 'kind' in ('expense', 'credit') then
      if exists (select 1 from jsonb_array_elements(plans) p
                  where p ->> 'number' = plan ->> 'number' and p ->> 'kind' in ('expense', 'credit')
                    and (p ->> 'supplier_key' = plan ->> 'supplier_key'
                         or ((p ->> 'supplier_key' like 'n:%' or plan ->> 'supplier_key' like 'n:%')
                             and approval_private.norm_name(p ->> 'label') = approval_private.norm_name(plan ->> 'label')))) then
        return approval_private.err('duplicate_in_batch', jsonb_build_object('invoice_id', v_id, 'number', plan ->> 'number'));
      end if;
    end if;
    -- إيصالان متشابهان في الطلب نفسه (المرجع نفسه للمورد، أو الدفعة المربوطة نفسها، أو التاريخ والمبلغ وأحدهما بلا مرجع):
    -- اشتباه كالسابق: بلا سبب على الثاني يتوقف ويعرض الأول؛ وبسبب يُحفظ القرار بالسبب والمرشحين (والمنفّذ والوقت في write_invoice)
    if plan ->> 'kind' = 'supplier_payment' then
      select jsonb_agg(jsonb_build_object('kind', 'batch', 'invoice_id', p ->> 'id', 'date', p ->> 'date', 'amount', (p ->> 'total')::numeric,
               'reference', p ->> 'number_raw', 'same_reference', plan ->> 'number' is not null and p ->> 'number' = plan ->> 'number',
               'link_journal', p ->> 'link_journal'))
        into v_batch from jsonb_array_elements(plans) p
       where p ->> 'kind' = 'supplier_payment' and p ->> 'supplier_key' = plan ->> 'supplier_key'
         and ((plan ->> 'number' is not null and p ->> 'number' = plan ->> 'number')
              or (plan ->> 'link_journal' is not null and p ->> 'link_journal' = plan ->> 'link_journal')
              or (p ->> 'date' = plan ->> 'date' and (p ->> 'total')::numeric = (plan ->> 'total')::numeric
                  and (plan ->> 'number' is null or p ->> 'number' is null)));
      if v_batch is not null then
        v_reason := nullif(btrim(coalesce(plan -> 'payload' ->> case plan ->> 'mode' when 'link' then 'linkReason' else 'newPaymentReason' end, '')), '');
        if v_reason is null then
          return approval_private.err('payment_possible_duplicate', jsonb_build_object('invoice_id', v_id, 'in_batch', true, 'name', plan ->> 'label',
            'mode', plan ->> 'mode', 'candidates', v_batch));
        end if;
        plan := jsonb_set(plan, '{duplicate_decision}', coalesce(nullif(plan -> 'duplicate_decision', 'null'::jsonb),
          jsonb_build_object('kind', 'receipt_batch', 'reason', v_reason, 'candidates', '[]'::jsonb)) || jsonb_build_object('batch_candidates', v_batch));
      end if;
    end if;
    plans := plans || jsonb_build_array(plan);
  end loop;

  -- المرحلة 2: الكتابة كلها في هذه المعاملة. أي خطأ يلغيها كلها
  begin
    for plan in select value from jsonb_array_elements(plans) loop
      jn := approval_private.write_invoice(d, plan, a.id, p_request_id);
      v_first_jn := coalesce(v_first_jn, jn);
      journals := journals || jsonb_build_array(jsonb_build_object('invoice_id', plan ->> 'id', 'journal_number', jn));
    end loop;
  exception
    when unique_violation then
      return approval_private.err('duplicate_invoice', jsonb_build_object('detail', 'concurrent'));
    when sqlstate 'P0001' then
      -- خطأ كتابة معروف (20261020120000): الكتابة كلها أُلغيت، ويعود رمزه كبقية رموز الاعتماد
      if sqlerrm like 'APPROVAL_WRITE:%' then
        get stacked diagnostics v_detail = pg_exception_detail;
        return coalesce(nullif(v_detail, '')::jsonb, approval_private.err(split_part(sqlerrm, ':', 2)));
      end if;
      raise;
  end;

  d := approval_private.finish_document(d, a.id, v_first_jn, coalesce(p_document, '{}'));
  select count(*) into v_pending from approval_private.document_invoices where document_id = d.id and status = 'pending';
  res := jsonb_build_object('ok', true, 'document_status', d.status, 'version', d.version, 'journals', journals, 'pending', v_pending);
  insert into approval_private.requests (request_id, project_id, document_id, action, fingerprint, actor_id, result)
  values (p_request_id, d.project_id, d.id, 'approve', fp, a.id, res);
  return res;
end $function$;

-- ─── الحذف: كما كان، ومعه إعادة الإيصال المرتبط إلى «بانتظار الاعتماد» ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.supplier_payment_delete(p_journal_number text, p_entry_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a record; v_jn text := nullif(btrim(coalesce(p_journal_number, '')), ''); v_sup uuid; v_led int; v_tx int;
        v_docs uuid[]; rd record; v_reopened int := 0; v_ap jsonb; v_restored jsonb;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role not in ('accountant', 'superadmin') or a.project_id is null then return approval_private.err('forbidden'); end if;
  if not coalesce((select ps.active from public.project_settings ps where ps.project_id = a.project_id), true) then
    return approval_private.err('project_inactive');
  end if;
  if p_entry_id is not null then
    select le.journal_number into v_jn from public.ledger_entries le
     where le.id = p_entry_id and le.project_id = a.project_id and le.type like '%سداد مورد%';
    if not found then return approval_private.err('not_found'); end if;
  end if;
  if v_jn is null and p_entry_id is null then return approval_private.err('bad_request'); end if;

  -- مستندات الإيصالات المرتبطة أولًا (ترتيب الأقفال كالاعتماد: المستند ثم المورد)، 20261020120000
  select coalesce(array_agg(distinct x.document_id), '{}') into v_docs from (
    select le.document_id from public.ledger_entries le where le.project_id = a.project_id and le.type like '%سداد مورد%'
       and le.document_id is not null and ((v_jn is not null and le.journal_number = v_jn) or le.id = p_entry_id)
    union all
    select t.document_id from public.supplier_transactions t where t.project_id = a.project_id and v_jn is not null
       and t.journal_number = v_jn and t.type = 'payment' and t.document_id is not null
    union all
    select di.document_id from approval_private.document_invoices di where di.project_id = a.project_id and v_jn is not null
       and di.journal_number = v_jn and di.kind = 'supplier_payment' and di.status = 'approved') x;
  perform 1 from public.documents dd where dd.id = any (v_docs) order by dd.id for update;

  -- قفل مورد القائمة (أو المورد الآجل) قبل الحذف
  if v_jn is not null then
    select t.supplier_id into v_sup from public.supplier_transactions t
     where t.project_id = a.project_id and t.journal_number = v_jn and t.type = 'payment' limit 1;
    if v_sup is not null then
      perform 1 from public.suppliers s where s.id = v_sup and s.project_id = a.project_id for update;
    else
      perform 1 from public.payable_suppliers ps where ps.project_id = a.project_id and ps.id in (
        select le.supplier_id from public.ledger_entries le where le.project_id = a.project_id and le.journal_number = v_jn
           and le.type like '%سداد مورد%' and le.supplier_id is not null) for update;
    end if;
  end if;

  -- بعد القفل: لا شيء يُحذف ← not_found بلا أي كتابة (ولا يُعلَّم سجل طلب)
  if not exists (select 1 from public.ledger_entries le where le.project_id = a.project_id and le.type like '%سداد مورد%'
                  and ((v_jn is not null and le.journal_number = v_jn) or le.id = p_entry_id))
     and not (v_jn is not null and exists (select 1 from public.supplier_transactions t
                  where t.project_id = a.project_id and t.journal_number = v_jn and t.type = 'payment')) then
    return approval_private.err('not_found');
  end if;
  if v_jn is not null then
    update approval_private.supplier_payment_requests r set deleted_at = now(), deleted_by = a.id
     where r.project_id = a.project_id and r.result ->> 'journal_number' = v_jn and r.deleted_at is null;
  end if;

  -- الإيصال المرتبط بالدفعة (دفعة سُجّلت منه أو رُبط بها) يعود «بانتظار الاعتماد»: لا يبقى مستند معتمد بلا دفعة.
  -- ما كان معتمدًا يُحفظ في history، وإعادة طلب الاعتماد القديم تعيد payment_deleted بدل نتيجته.
  for rd in select distinct x.inv_id, x.document_id from (
              select le.document_invoice_id as inv_id, le.document_id from public.ledger_entries le
               where le.project_id = a.project_id and le.type like '%سداد مورد%' and le.document_invoice_id is not null
                 and ((v_jn is not null and le.journal_number = v_jn) or le.id = p_entry_id)
              union all
              select di.id, di.document_id from approval_private.document_invoices di
               where di.project_id = a.project_id and v_jn is not null and di.journal_number = v_jn and di.kind = 'supplier_payment'
                 and di.status = 'approved') x loop
    select x.approved_payload into v_ap from approval_private.document_invoices x
     where x.id = rd.inv_id and x.project_id = a.project_id and x.status = 'approved';
    update approval_private.document_invoices x set
      status = 'pending', journal_number = null, decided_by = null, decided_at = null, request_id = null,
      approved_payload = null, review_changes = null,
      history = x.history || jsonb_build_array(jsonb_build_object('event', 'payment_deleted', 'journal_number', coalesce(v_jn, x.journal_number),
        'at', now(), 'by', a.id, 'by_name', a.name, 'by_role', a.role, 'approved_by', x.decided_by, 'approved_at', x.decided_at,
        'approved_payload', x.approved_payload))
     where x.id = rd.inv_id and x.project_id = a.project_id and x.status = 'approved';
    if found then
      v_reopened := v_reopened + 1;
      update approval_private.requests q set result = approval_private.err('payment_deleted',
          jsonb_build_object('journal_number', v_jn, 'document_id', rd.document_id))
       where q.project_id = a.project_id and q.document_id = rd.document_id and q.action = 'approve' and coalesce((q.result ->> 'ok')::boolean, false)
         and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(q.result -> 'journals') = 'array' then q.result -> 'journals' else '[]' end) j
                      where j ->> 'invoice_id' = rd.inv_id::text);
      -- الإيصال كما أكده المراجع (النوع والمورد والمبلغ والتاريخ والمسار)، بلا نتيجة الكتابة ولا الدفعة المحذوفة؛ فاعتماده من جديد
      -- لا يرجع إلى قراءة البرنامج (مصروفًا مثلًا)
      v_restored := coalesce(v_ap, '{}'::jsonb) - 'journal_number' - 'payment_mode' - 'payment_result' - 'primary_document' - 'review_changes'
                    - 'linkJournal' - 'linkReason' || jsonb_build_object('_id', rd.inv_id::text);
      update public.documents dd set
        analysis_result = case when v_ap is not null and jsonb_typeof(dd.analysis_result -> 'invoices') = 'array'
          then jsonb_set(dd.analysis_result, '{invoices}', (select jsonb_agg(case when e ->> '_id' = rd.inv_id::text then v_restored else e end order by o)
                 from jsonb_array_elements(dd.analysis_result -> 'invoices') with ordinality t(e, o)))
          else dd.analysis_result end,
        status = case when dd.status = 'approved' then 'analyzed' else dd.status end,
        approved_by = null, approved_at = null,
        journal_number = (select min(x.journal_number) from approval_private.document_invoices x where x.document_id = dd.id and x.status = 'approved'),
        version = dd.version + 1
       where dd.id = rd.document_id and dd.project_id = a.project_id;
    end if;
  end loop;

  perform set_config('tahseeb.supplier_payment', 'on', true);
  delete from public.ledger_entries le where le.project_id = a.project_id and le.type like '%سداد مورد%'
     and ((v_jn is not null and le.journal_number = v_jn) or le.id = p_entry_id);
  get diagnostics v_led = row_count;
  if v_jn is not null then
    delete from public.supplier_transactions t where t.project_id = a.project_id and t.journal_number = v_jn and t.type = 'payment';
    get diagnostics v_tx = row_count;
  end if;
  perform set_config('tahseeb.supplier_payment', 'off', true);
  return jsonb_build_object('ok', true, 'journal_number', v_jn, 'ledger_rows', v_led, 'supplier_rows', coalesce(v_tx, 0),
    'reopened_receipts', v_reopened);
end $function$;

-- ─── قراءة: رصيد المورد ودفعاته وإيصالاته، والإيصالات المنتظرة (لا كتابة) ─────────────────────────────────────────────
create function public.supplier_payment_context(p_kind text, p_supplier uuid, p_document uuid default null)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
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
           le.bank_account_id, le.document_id, dd.file_name, dd.status as document_status, le.created_by_name,
           coalesce((select jsonb_agg(jsonb_build_object('document_id', x.document_id, 'file_name', xd.file_name) order by x.decided_at)
              from approval_private.document_invoices x join public.documents xd on xd.id = x.document_id
             where x.project_id = a.project_id and x.status = 'approved' and x.kind = 'supplier_payment' and x.journal_number = le.journal_number), '[]'::jsonb) as documents
      from public.ledger_entries le left join public.documents dd on dd.id = le.document_id
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
revoke all on function public.supplier_payment_context(text, uuid, uuid) from public, anon;
grant execute on function public.supplier_payment_context(text, uuid, uuid) to authenticated;

-- ─── approval_prepare: كما كان، ومعه سجل كل فاتورة (history) لتعرض الشاشة سبب عودة إيصال للمراجعة ───────────────────────
CREATE OR REPLACE FUNCTION public.approval_prepare(p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a record; d record; invs jsonb; el jsonb; i int := 0; new_invs jsonb := '[]'; v_id uuid; v_mode text;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  select * into d from public.documents where id = p_document_id for update;
  if d.id is null or a.project_id is distinct from d.project_id then return approval_private.err('not_found'); end if;
  if not approval_private.can_approve(a.role, d.project_id) then return approval_private.err('forbidden'); end if;
  v_mode := approval_private.mode_of(d.project_id);
  if v_mode = 'legacy' then return approval_private.err('legacy_mode'); end if;
  if d.status = 'analyzed' and d.analysis_result is not null
     and not exists (select 1 from approval_private.document_invoices where document_id = d.id) then
    invs := case when jsonb_typeof(d.analysis_result -> 'invoices') = 'array' then d.analysis_result -> 'invoices'
                 else jsonb_build_array(d.analysis_result) end;
    for el in select value from jsonb_array_elements(invs) loop
      i := i + 1;
      v_id := case when (el ->> '_id') ~* '^[0-9a-f-]{36}$' then (el ->> '_id')::uuid else gen_random_uuid() end;
      el := jsonb_set(el, '{_id}', to_jsonb(v_id::text));
      new_invs := new_invs || jsonb_build_array(el);
      insert into approval_private.document_invoices (id, document_id, project_id, idx, original_reading)
      values (v_id, d.id, d.project_id, i, el);
    end loop;
    update public.documents
       set analysis_result = case when jsonb_typeof(d.analysis_result -> 'invoices') = 'array'
                                  then jsonb_set(d.analysis_result, '{invoices}', new_invs)
                                  else jsonb_build_object('invoices', new_invs) end,
           version = version + 1
     where id = d.id
     returning * into d;
  end if;
  return jsonb_build_object('ok', true, 'mode', v_mode, 'version', d.version, 'status', d.status,
    'analysis_result', d.analysis_result,
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'idx', x.idx, 'status', x.status,
                 'journal_number', x.journal_number, 'excluded_reason', x.excluded_reason, 'history', x.history,
                 'original_reading', case when jsonb_array_length(x.history) > 0 then x.original_reading end) order by x.idx)
               from approval_private.document_invoices x where x.document_id = d.id), '[]'));
end $function$;
