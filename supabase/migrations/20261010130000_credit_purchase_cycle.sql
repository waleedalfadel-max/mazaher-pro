-- دورة الشراء الآجل (بعد 20261010120000). محلي للمراجعة؛ لا يُطبَّق على الإنتاج دون موافقة المالك.
--
-- قبلها: «آجل — باسم المورد» يكتب قيد الشراء آجلًا في الدفتر (payable_in) ولا مسار لسداده؛ و«آجل — مورد من القائمة» لا يكتب قيد دفتر
-- أصلًا (حركة «فاتورة» في حساب المورد وحدها، بلا ضريبة ولا تصنيف)، ويُسجَّل سداده من «الموردين» قيد «سداد مورد» تكلفةً كاملة بتاريخ السداد.
-- فاختلف مبلغ الشراء وفترته وتصنيفه بحسب طريقة اختيار المورد.
--
-- بعدها، للعمليات الجديدة:
-- 1) الفاتورة في المسارين تثبت الشراء في الدفتر آجلًا بإجماليها وضريبتها وتصنيفها وبنودها ← تكلفة بصافيها بتاريخ الفاتورة مرة واحدة.
-- 2) السداد (public.supplier_payment_record) خروج نقدي يخفض الالتزام payable_out ← ليس تكلفة جديدة؛ وجزئيًا ثم الباقي كذلك.
--    لموردي القائمة فقط: جزء الدفعة الذي يغطي ما لم يدخل الدفتر قط (الرصيد الافتتاحي + فواتير قبل هذا التغيير) يبقى تكلفة عند السداد
--    كما كان، حتى لا تختفي تكلفة الفواتير التاريخية؛ يُحسب تحت قفل المورد: max(0, min(الدفعة، غير المسجل − ما سُدد قبلها)).
-- 3) البيانات التاريخية لا تُعدَّل هنا (خطة منفصلة للمراجعة).
-- لا تتغير أي سياسة قراءة أو كتابة قائمة. الدالة الجديدة SECURITY DEFINER بفحص المحاسب النشط والمنشأة غير الموقوفة.

-- ── 1) write_invoice: نسخة 20260928000900 بتغيير فرع «مورد من القائمة» وحده ─────────────────────────────
create or replace function approval_private.write_invoice(d public.documents, plan jsonb, p_actor uuid, p_request uuid) returns text
language plpgsql set search_path = '' as $$
declare
  v_id uuid := (plan ->> 'id')::uuid; v_date date := (plan ->> 'date')::date; v_kind text := plan ->> 'kind';
  jn text; v_ch jsonb; s_id uuid; v_total numeric; v_type text; v_pay text := plan ->> 'pay'; v_supplier uuid; v_incoming boolean;
  g jsonb; v_gross numeric; le_id uuid; v_key text := plan ->> 'supplier_key'; v_branch text := plan ->> 'branch';
begin
  if not (plan ->> 'known')::boolean then
    insert into approval_private.document_invoices (id, document_id, project_id, idx)
    values (v_id, d.id, d.project_id, coalesce((select max(idx) from approval_private.document_invoices where document_id = d.id), 0) + 1);
  end if;
  jn := approval_private.next_journal(d.project_id, v_date);

  if v_kind = 'sales' then
    v_ch := plan -> 'channels';
    insert into public.sales (project_id, date, cash_sales, network_sales, hunger_sales, jahez_sales, keeta_sales, description, branch)
    values (d.project_id, v_date, (v_ch ->> 'cash')::numeric, (v_ch ->> 'network')::numeric, (v_ch ->> 'hunger')::numeric,
            (v_ch ->> 'jahez')::numeric, (v_ch ->> 'keeta')::numeric, 'تقرير POS', v_branch)
    returning id into s_id;
    insert into public.ledger_entries (project_id, date, type, description, cash_in, cash_out, bank_in, bank_out, custody_in, custody_out,
      receivable_in, receivable_out, total_amount, status, journal_number, file_url, branch, document_id, document_invoice_id)
    select d.project_id, v_date, t.type, t.description, t.cash_in, 0, t.bank_in, 0, 0, 0, t.recv, 0, t.amount, 'approved', jn,
           coalesce(d.file_url, ''), v_branch, d.id, v_id
      from (values
        ('💵 مبيعات كاش', 'مبيعات كاش — POS', (v_ch ->> 'cash')::numeric, 0::numeric, 0::numeric, (v_ch ->> 'cash')::numeric),
        ('🏦 مبيعات شبكة', 'مبيعات شبكة — POS', 0, (v_ch ->> 'network')::numeric, 0, (v_ch ->> 'network')::numeric),
        ('💸 مبيعات تحويل', 'مبيعات تحويل — POS', 0, (v_ch ->> 'transfer')::numeric, 0, (v_ch ->> 'transfer')::numeric),
        ('🍔 مبيعات هنقر ستيشن', 'ذمم هنقر — POS', 0, 0, (v_ch ->> 'hunger')::numeric, (v_ch ->> 'hunger')::numeric),
        ('🛵 مبيعات جاهز', 'ذمم جاهز — POS', 0, 0, (v_ch ->> 'jahez')::numeric, (v_ch ->> 'jahez')::numeric),
        ('🛺 مبيعات كيتا', 'ذمم كيتا — POS', 0, 0, (v_ch ->> 'keeta')::numeric, (v_ch ->> 'keeta')::numeric),
        ('🛵 مبيعات مرسول', 'ذمم مرسول — POS', 0, 0, (v_ch ->> 'mrsool')::numeric, (v_ch ->> 'mrsool')::numeric)
      ) as t(type, description, cash_in, bank_in, recv, amount)
     where t.amount > 0;
    insert into approval_private.sales_reports (project_id, branch_key, report_date, document_id, invoice_id, sales_id, journal_number, current)
    values (d.project_id, plan ->> 'branch_key', v_date, d.id, v_id, s_id, jn, v_ch);

  elsif v_kind = 'transfer' then
    -- مطابق لمنطق المسار السابق، مع قراءة المبلغ من amount أو totalAmount
    v_total := (plan ->> 'total')::numeric; v_type := plan ->> 'trans_type';
    insert into public.ledger_entries (project_id, date, type, description, cash_in, bank_in, custody_in, cash_out, bank_out, custody_out,
      receivable_in, receivable_out, vat_amount, total_amount, status, file_url, journal_number, branch, document_id, document_invoice_id)
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
      0, v_total, 'approved', coalesce(d.file_url, ''), jn, v_branch, d.id, v_id);

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
        category_main, category_sub, document_id, document_invoice_id, invoice_number, category_id, financial_class, discount_amount)
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
        coalesce((g ->> 'discount')::numeric, 0))
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

  update approval_private.document_invoices set
    status = 'approved', kind = v_kind, invoice_number_raw = plan ->> 'number_raw', invoice_number_norm = plan ->> 'number',
    supplier_key = v_key, supplier_label = coalesce(plan ->> 'label', plan ->> 'description'),
    invoice_date = v_date, total = (plan ->> 'total')::numeric, journal_number = jn,
    approved_payload = plan -> 'payload', review_changes = plan -> 'payload' -> 'review_changes',
    duplicate_decision = case when jsonb_typeof(plan -> 'duplicate_decision') = 'object'
                              then (plan -> 'duplicate_decision') || jsonb_build_object('by', p_actor, 'at', now()) end,
    decided_by = p_actor, decided_at = now(), request_id = p_request
  where id = v_id;
  return jn;
end $$;


-- ── 2) تسجيل دفعة مورد في معاملة واحدة، مقاومة للتكرار بمعرّف الطلب ─────────────────────────────────────
create table approval_private.supplier_payment_requests (
  request_id uuid primary key,
  project_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  -- R4-01: حذف الدفعة لا يمسح سجل طلبها؛ يعلّمه، فإعادة الطلب نفسه بعد الحذف ترد payment_deleted ولا تعيد إنشاءها
  deleted_at timestamptz,
  deleted_by uuid
);
alter table approval_private.supplier_payment_requests enable row level security;
revoke all on approval_private.supplier_payment_requests from public, anon, authenticated;

-- نتيجة طلب سابق بالمعرّف نفسه، أو null إن لم يوجد. FOR SHARE: إن كان حذف دفعته جاريًا في معاملة أخرى (يعلّم السجل أول ما يكتب)
-- ينتظر انتهاءه ثم يقرأ الحالة الأخيرة. دفعة حُذفت ← payment_deleted (لا كتابة)، وإلا النتيجة الأولى replayed. بيانات الطلب الجديدة لا تغيّر ذلك.
create function approval_private.payment_request_replay(p_request uuid, p_project uuid) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare r record;
begin
  if p_request is null then return null; end if;
  select q.result, q.deleted_at into r from approval_private.supplier_payment_requests q
   where q.request_id = p_request and q.project_id = p_project for share;
  if not found then return null; end if;
  if r.deleted_at is not null then
    return approval_private.err('payment_deleted', jsonb_build_object('journal_number', r.result ->> 'journal_number', 'deleted_at', r.deleted_at));
  end if;
  return r.result || jsonb_build_object('replayed', true);
end $$;
revoke all on function approval_private.payment_request_replay(uuid, uuid) from public, anon, authenticated;

-- p_kind: 'list' مورد من القائمة (suppliers + supplier_transactions)، 'payable' مورد آجل باسم المورد (payable_suppliers).
create function public.supplier_payment_record(p_kind text, p_supplier uuid, p_amount numeric, p_date date, p_source text,
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
    -- ما لم يدخل الدفتر قط: الرصيد الافتتاحي + فواتير القائمة بلا قيد شراء آجل برقم قيدها
    select v_open + coalesce(sum(t.amount), 0) into v_unrec from public.supplier_transactions t
     where t.supplier_id = p_supplier and t.project_id = a.project_id and t.type = 'invoice'
       and not exists (select 1 from public.ledger_entries le where le.project_id = t.project_id and le.journal_number = t.journal_number
                        and coalesce(le.payable_in, 0) > 0 and (le.status is null or le.status <> 'cancelled'));
    select coalesce(sum(t.amount), 0) into v_paid from public.supplier_transactions t
     where t.supplier_id = p_supplier and t.project_id = a.project_id and t.type = 'payment';
    v_expense := greatest(0, least(v_amt, v_unrec - v_paid));
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

-- ── 3) إغلاق كتابة الدفعة القديمة من المتصفح (صفحات «الموردين» المفتوحة من نسخة سابقة) ─────────────────────────────
-- النسخة السابقة تكتب حركة «دفعة» مباشرة ثم قيد «سداد مورد» بخروج كامل بلا تخفيض التزام؛ مع الفواتير المسجلة الآن في الدفتر
-- يُحتسب ذلك تكلفة ثانية. حارس 20260928000300 يستثني الدفعات اليدوية، فيُرفض هنا من الخادم أول ما تكتبه: حركة «دفعة» من دور المتصفح.
-- الدالة supplier_payment_record (SECURITY DEFINER) لا يمسها الحارس. الرفض قبل أي كتابة، فلا أثر جزئي.
create function approval_private.supplier_payment_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.type = 'payment' and current_user in ('authenticated', 'anon') then
    raise exception 'تسجيل دفعات الموردين صار من الصفحة المحدّثة فقط. حدّث الصفحة ثم سجّل الدفعة من «الموردين».'
      using errcode = 'P0001', hint = 'supplier_payment_record';
  end if;
  return new;
end $$;
create trigger supplier_payment_guard before insert on public.supplier_transactions
  for each row execute function approval_private.supplier_payment_guard();

notify pgrst, 'reload schema';
