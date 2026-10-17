-- إعادة تطبيق 20261014120000 بعد الرجوع: الترحيل نفسه بصيغة آمنة للتكرار (مولّد من نصه، لا كتابة يدوية).
-- الترتيب: reapply-1 (120000) ثم reapply-2 (130000) ثم reapply-3 (140000).
\set ON_ERROR_STOP on
begin;
-- سداد الرصيد الافتتاحي للمورد تسوية لا تكلفة (تجهيز عميل جديد، 2026-10-14).
-- الرصيد الافتتاحي في «الموردين» التزام قائم قبل بداية التسجيل في تحسيب: مشترياته خارج فترات المنشأة في البرنامج.
-- كانت supplier_payment_record (20261010130000) تحسب سداده تكلفةً عند السداد مع فواتير القائمة غير المسجلة في الدفتر، فتظهر
-- مشتريات ما قبل البداية مصروفًا في شهر السداد. الآن: الدفعة تُوزَّع بالترتيب — الافتتاحي (تسوية: يخفض المستحق ولا مصروف ولا ضريبة)،
-- ثم فواتير القائمة التي لم تدخل الدفتر (تكلفة كما كانت)، ثم الفواتير المسجلة (تسوية كما كانت). قيد الدفتر واحد بخروج المال مرة واحدة،
-- وpayable_out = جزء التسوية. لا يتغير شيء آخر في الدالة (القفل، حد المستحق، إعادة الطلب، الحذف).
-- الأثر على البيانات القائمة: لا قيود تُعدَّل؛ يتغير فقط تقسيم الدفعات الجديدة لموردين لهم رصيد افتتاحي.

create or replace function public.supplier_payment_record(p_kind text, p_supplier uuid, p_amount numeric, p_date date, p_source text,
                                               p_notes text default null, p_request uuid default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare a record; v_name text; v_open numeric; v_unrec numeric; v_paid numeric; v_expense numeric; v_settle numeric; v_bal numeric;
        jn text; v_res jsonb; v_amt numeric;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role is distinct from 'accountant' or a.project_id is null then return approval_private.err('forbidden'); end if;
  if not coalesce((select ps.active from public.project_settings ps where ps.project_id = a.project_id), true) then
    return approval_private.err('project_inactive');
  end if;
  if p_request is not null then
    v_res := approval_private.payment_request_replay(p_request, a.project_id);
    if v_res is not null then return v_res; end if;
  end if;
  if p_kind is null or p_kind not in ('list', 'payable') or p_supplier is null then return approval_private.err('bad_request'); end if;
  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt <= 0 or v_amt <> p_amount then return approval_private.err('amount_invalid'); end if;
  if p_date is null then return approval_private.err('date_required'); end if;
  if p_source is null or p_source not in ('bank', 'cash') then return approval_private.err('source_invalid'); end if;

  if p_kind = 'list' then
    select s.name, coalesce(s.opening_balance, 0) into v_name, v_open from public.suppliers s
     where s.id = p_supplier and s.project_id = a.project_id for update;
    if not found then return approval_private.err('not_found'); end if;
    -- بعد قفل المورد: طلب مطابق انتظر القفل نفسه يعيد نتيجة سابقه بدل دفعة ثانية
    if p_request is not null then
      v_res := approval_private.payment_request_replay(p_request, a.project_id);
      if v_res is not null then return v_res; end if;
    end if;
    -- المستحق للمورد كما تعرضه صفحة «الموردين» (الافتتاحي + الفواتير − الدفعات)، محسوبًا تحت القفل: الدفعة لا تتجاوزه، والدفعتان
    -- المتزامنتان تُحسبان بالتتابع. الدفعة المقدمة لمورد ليست من هذا المسار (سلوك منفصل غير مُعرَّف).
    select v_open + coalesce(sum(case when t.type = 'invoice' then t.amount when t.type = 'payment' then -t.amount else 0 end), 0) into v_bal
      from public.supplier_transactions t where t.supplier_id = p_supplier and t.project_id = a.project_id;
    if v_amt > v_bal then return approval_private.err('exceeds_balance', jsonb_build_object('balance', greatest(v_bal, 0))); end if;
    -- فواتير القائمة التي لم تدخل الدفتر قط (بلا قيد شراء آجل برقم قيدها): تكلفتها لم تُحتسب، فسدادها تكلفة.
    -- الرصيد الافتتاحي ليس منها: التزام سابق لبداية التسجيل، سداده تسوية لا تكلفة (20261014120000).
    select coalesce(sum(t.amount), 0) into v_unrec from public.supplier_transactions t
     where t.supplier_id = p_supplier and t.project_id = a.project_id and t.type = 'invoice'
       and not exists (select 1 from public.ledger_entries le where le.project_id = t.project_id and le.journal_number = t.journal_number
                        and coalesce(le.payable_in, 0) > 0 and (le.status is null or le.status <> 'cancelled'));
    select coalesce(sum(t.amount), 0) into v_paid from public.supplier_transactions t
     where t.supplier_id = p_supplier and t.project_id = a.project_id and t.type = 'payment';
    -- ترتيب السداد (FIFO): الرصيد الافتتاحي أولًا (تسوية)، ثم الفواتير غير المسجلة في الدفتر (تكلفة)، ثم المسجلة (تسوية).
    -- الدفعات السابقة تستهلك الترتيب نفسه، فالحذف وإعادة السداد يعيدان الحساب من الدفعات الباقية.
    v_expense := least(greatest(v_amt - greatest(v_open - v_paid, 0), 0), greatest(v_unrec - greatest(v_paid - v_open, 0), 0));
    v_settle := v_amt - v_expense;
    jn := approval_private.next_journal(a.project_id, p_date);
    insert into public.supplier_transactions (supplier_id, project_id, type, amount, date, notes, journal_number)
    values (p_supplier, a.project_id, 'payment', v_amt, p_date, nullif(btrim(coalesce(p_notes, '')), ''), jn);
  else
    select ps.name into v_name from public.payable_suppliers ps where ps.id = p_supplier and ps.project_id = a.project_id for update;
    if not found then return approval_private.err('not_found'); end if;
    if p_request is not null then
      v_res := approval_private.payment_request_replay(p_request, a.project_id);
      if v_res is not null then return v_res; end if;
    end if;
    select coalesce(sum(coalesce(le.payable_in, 0) - coalesce(le.payable_out, 0)), 0) into v_bal from public.ledger_entries le
     where le.project_id = a.project_id and le.supplier_id = p_supplier and le.status in ('approved', 'auto');
    if v_amt > v_bal then return approval_private.err('exceeds_balance', jsonb_build_object('balance', v_bal)); end if;
    v_expense := 0; v_settle := v_amt;
    jn := approval_private.next_journal(a.project_id, p_date);
  end if;

  -- المسار الموثوق لقيد «سداد مورد» داخل طلب من الواجهة (حارس 20261013120000): يُفتح للقيد وحده ثم يُغلق
  perform set_config('tahseeb.supplier_payment', 'on', true);
  insert into public.ledger_entries (project_id, date, type, description, cash_out, bank_out, custody_out, cash_in, bank_in, custody_in,
    payable_in, payable_out, supplier_id, vat_amount, total_amount, status, file_url, journal_number, created_by_user_id, created_by_name, created_by_role)
  -- رقم القيد في الوصف: دفعتان بالمبلغ نفسه للمورد نفسه في اليوم نفسه دفعتان مشروعتان، لا تكرار (فهرس ledger_unique_invoice_legacy_path)
  values (a.project_id, p_date, '🏪 سداد مورد', 'سداد مستحقات ' || v_name || ' — ' || jn,
    case when p_source = 'cash' then v_amt else 0 end, case when p_source = 'bank' then v_amt else 0 end, 0, 0, 0, 0,
    0, v_settle, case when p_kind = 'payable' then p_supplier end, 0, v_amt, 'approved', '', jn, a.id, a.name, a.role);

  perform set_config('tahseeb.supplier_payment', 'off', true);

  v_res := jsonb_build_object('ok', true, 'journal_number', jn, 'amount', v_amt, 'expense_part', v_expense, 'settlement_part', v_settle);
  if p_request is not null then
    insert into approval_private.supplier_payment_requests (request_id, project_id, result) values (p_request, a.project_id, v_res);
  end if;
  return v_res;
end $$;
revoke all on function public.supplier_payment_record(text, uuid, numeric, date, text, text, uuid) from public, anon;
grant execute on function public.supplier_payment_record(text, uuid, numeric, date, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
