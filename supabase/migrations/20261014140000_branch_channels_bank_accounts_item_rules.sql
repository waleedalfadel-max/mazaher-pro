-- متطلبات تجهيز العميل الجديد (2026-10-14): تطبيقات التوصيل حسب الفرع، والحسابات البنكية المنفصلة، وقاموس ربط الأصناف.
-- كلها لكل منشأة: منشأة بلا إعداد (مزاهر والديمو اليوم) يبقى سلوكها كما كان حرفيًا — لا قنوات فروع ⇒ كل القنوات، لا حسابات بنكية ⇒ «البنك»
-- رصيد واحد كما كان، لا قواعد أصناف ⇒ لا اقتراح. لا تعديل لقيود قائمة.

-- ══ 1) تطبيقات التوصيل (قنوات المبيعات) حسب الفرع ═══════════════════════════════════════════════════════════════
-- الإعداد: project_settings.settings.branch_channels = { "<اسم الفرع>": ["cash","network","transfer","hunger","jahez","keeta","mrsool"] }.
-- فرع غير مذكور أو منشأة بلا الإعداد ⇒ كل القنوات. القيد بلا فرع لا يُفحص (لا يُنسب لفرع).
create function approval_private.channel_of_type(p_type text) returns text language sql immutable set search_path = '' as $$
  select case
    when p_type like '%هنقر%' then 'hunger' when p_type like '%جاهز%' then 'jahez' when p_type like '%كيتا%' then 'keeta'
    when p_type like '%مرسول%' then 'mrsool' when p_type like '%مبيعات تحويل%' then 'transfer' when p_type like '%مبيعات شبكة%' then 'network'
    when p_type like '%مبيعات كاش%' then 'cash' end
$$;
create function approval_private.channel_enabled(p_project uuid, p_branch text, p_channel text) returns boolean language sql stable set search_path = '' as $$
  select p_channel is null or p_branch is null or coalesce((
    select case when jsonb_typeof(ps.settings -> 'branch_channels' -> p_branch) = 'array'
                then (ps.settings -> 'branch_channels' -> p_branch) ? p_channel end
      from public.project_settings ps where ps.project_id = p_project), true)
$$;
create function approval_private.channel_label(p text) returns text language sql immutable set search_path = '' as $$
  select case p when 'cash' then 'النقدي' when 'network' then 'الشبكة' when 'transfer' then 'التحويل' when 'hunger' then 'هنقرستيشن'
                when 'jahez' then 'جاهز' when 'keeta' then 'كيتا' when 'mrsool' then 'مرسول' else p end
$$;
-- حارس الدفتر: أي كاتب (الاعتماد، التصحيح، القيد اليدوي، المسار السابق)
create function approval_private.ledger_branch_channel_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_ch text := approval_private.channel_of_type(new.type);
begin
  if v_ch is not null and new.branch is not null
     and (tg_op = 'INSERT' or new.type is distinct from old.type or new.branch is distinct from old.branch)
     and not approval_private.channel_enabled(new.project_id, new.branch, v_ch) then
    raise exception '«%» غير مفعّل في «%». القنوات المفعلة لكل فرع من إعداد المنشأة.', approval_private.channel_label(v_ch), new.branch
      using errcode = 'P0001', hint = 'channel_not_enabled_for_branch';
  end if;
  return new;
end $$;
create trigger ledger_branch_channel_guard before insert or update on public.ledger_entries
  for each row execute function approval_private.ledger_branch_channel_guard();

-- الاعتماد: رسالة واضحة قبل أي كتابة (تقرير المبيعات بقناة غير مفعلة للفرع)
create or replace function approval_private.plan_invoice(d public.documents, inv jsonb, p_decisions jsonb, p_document jsonb, v_known boolean)
returns jsonb language plpgsql stable set search_path = '' as $$
declare plan jsonb := approval_private.plan_invoice_core(d, inv, p_decisions, p_document, v_known); k text; v_needs boolean; v_code text;
begin
  if not coalesce((plan ->> 'ok')::boolean, false) then return plan; end if;
  -- الحساب البنكي: الفاتورة التي فيها حركة بنك في منشأة بحسابات تحتاج حسابًا صالحًا لفرعها (أو حسابًا وحيدًا متاحًا)
  v_needs := case plan ->> 'kind'
    when 'sales' then coalesce(nullif(plan -> 'channels' ->> 'network', '')::numeric, 0) > 0 or coalesce(nullif(plan -> 'channels' ->> 'transfer', '')::numeric, 0) > 0
    when 'transfer' then plan ->> 'pay' = 'bank' or plan ->> 'trans_type' is null or plan ->> 'trans_type' ~ '(إيداع نقدي|تحصيل ذمم|صرف عهدة)'
    when 'expense' then plan ->> 'pay' = 'bank'
    else false end;
  if v_needs then
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
end $$;
revoke all on function approval_private.plan_invoice(public.documents, jsonb, jsonb, jsonb, boolean) from public, anon, authenticated;

-- ══ 2) الحسابات البنكية المنفصلة ═════════════════════════════════════════════════════════════════════════════════
-- المنشأة بحسابات: كل قيد فيه بنك (bank_in/bank_out) يحمل حسابًا من حساباتها النشطة، مسموحًا لفرع القيد. إن لم يُرسل حساب:
-- يُختار تلقائيًا إن كان المسموح حسابًا واحدًا، وإلا يُرفض («اختر الحساب البنكي»). المنشأة بلا حسابات: كما كانت (رصيد بنك واحد).
create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  name text not null check (btrim(name) <> '' and length(name) <= 200),
  bank text,
  branches text[] not null default '{}',   -- فارغ = كل الفروع
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.bank_accounts (project_id);
alter table public.bank_accounts enable row level security;
revoke all on public.bank_accounts from public, anon, authenticated;
grant select on public.bank_accounts to authenticated;
create policy bank_accounts_select on public.bank_accounts for select to authenticated
  using (project_id = auth_project_id() or auth_is_superadmin() or project_id = (select auth_view_project_id()));

alter table public.ledger_entries add column bank_account_id uuid references public.bank_accounts(id);
create index on public.ledger_entries (bank_account_id) where bank_account_id is not null;

create function approval_private.ledger_bank_account_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_has boolean; v_ok boolean; v_one uuid; v_n int;
begin
  if coalesce(new.bank_in, 0) = 0 and coalesce(new.bank_out, 0) = 0 then
    new.bank_account_id := null; return new;
  end if;
  if tg_op = 'UPDATE' and new.bank_account_id is not distinct from old.bank_account_id and new.branch is not distinct from old.branch
     and new.project_id is not distinct from old.project_id and coalesce(old.bank_in, 0) + coalesce(old.bank_out, 0) > 0 then
    return new;   -- لا تغيير في الحساب أو الفرع لقيد بنك قائم (قيود ما قبل الإعداد تبقى كما هي)
  end if;
  select exists (select 1 from public.bank_accounts b where b.project_id = new.project_id and b.is_active) into v_has;
  if not v_has then new.bank_account_id := null; return new; end if;
  if new.bank_account_id is not null then
    select exists (select 1 from public.bank_accounts b where b.id = new.bank_account_id and b.project_id = new.project_id and b.is_active
                     and (new.branch is null or cardinality(b.branches) = 0 or new.branch = any (b.branches))) into v_ok;
    if not v_ok then
      raise exception 'الحساب البنكي المختار ليس من حسابات المنشأة المتاحة لهذا الفرع.' using errcode = 'P0001', hint = 'bank_account_invalid';
    end if;
    return new;
  end if;
  select count(*), min(b.id::text)::uuid into v_n, v_one from public.bank_accounts b
   where b.project_id = new.project_id and b.is_active and (new.branch is null or cardinality(b.branches) = 0 or new.branch = any (b.branches));
  if v_n = 1 then new.bank_account_id := v_one; return new; end if;
  raise exception 'اختر الحساب البنكي لهذه الحركة%.', case when new.branch is not null then ' (' || new.branch || ')' else '' end
    using errcode = 'P0001', hint = 'bank_account_required';
end $$;
create trigger ledger_bank_account_guard before insert or update on public.ledger_entries
  for each row execute function approval_private.ledger_bank_account_guard();

-- فحص الحساب للاعتماد (رسالة قبل الكتابة): null = سليم أو لا حسابات للمنشأة
create function approval_private.bank_account_check(p_project uuid, p_branch text, p_account uuid) returns text
language sql stable set search_path = '' as $$
  with eligible as (select b.id from public.bank_accounts b where b.project_id = p_project and b.is_active
                     and (p_branch is null or cardinality(b.branches) = 0 or p_branch = any (b.branches)))
  select case
    when not exists (select 1 from public.bank_accounts b where b.project_id = p_project and b.is_active) then null
    when p_account is not null then case when exists (select 1 from eligible where id = p_account) then null else 'bank_account_invalid' end
    when (select count(*) from eligible) = 1 then null
    else 'bank_account_required' end
$$;

-- الاعتماد: الحساب البنكي للفاتورة (bankAccountId) في كل قيد بنك
create or replace function approval_private.write_invoice(d public.documents, plan jsonb, p_actor uuid, p_request uuid) returns text
language plpgsql set search_path = '' as $$
declare
  v_id uuid := (plan ->> 'id')::uuid; v_date date := (plan ->> 'date')::date; v_kind text := plan ->> 'kind';
  jn text; v_ch jsonb; s_id uuid; v_total numeric; v_type text; v_pay text := plan ->> 'pay'; v_supplier uuid; v_incoming boolean;
  g jsonb; v_gross numeric; le_id uuid; v_key text := plan ->> 'supplier_key'; v_branch text := plan ->> 'branch';
  -- الحساب البنكي المختار في الفاتورة (20261014140000). حارس الدفتر يتحقق منه ويختاره تلقائيًا إن كان للفرع حساب واحد.
  v_bank uuid := nullif(plan -> 'payload' ->> 'bankAccountId', '')::uuid;
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
      receivable_in, receivable_out, total_amount, status, journal_number, file_url, branch, document_id, document_invoice_id, bank_account_id)
    select d.project_id, v_date, t.type, t.description, t.cash_in, 0, t.bank_in, 0, 0, 0, t.recv, 0, t.amount, 'approved', jn,
           coalesce(d.file_url, ''), v_branch, d.id, v_id, case when t.bank_in > 0 then v_bank end
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

-- سداد الموردين: معامل الحساب البنكي (الاستدعاء بلا المعامل يعمل كما كان)
drop function public.supplier_payment_record(text, uuid, numeric, date, text, text, uuid);
create function public.supplier_payment_record(p_kind text, p_supplier uuid, p_amount numeric, p_date date, p_source text,
                                               p_notes text default null, p_request uuid default null, p_bank_account uuid default null) returns jsonb
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
  -- الحساب البنكي (20261014140000): منشأة بحسابات تحتاج حسابًا صالحًا للسداد من البنك (أو حسابًا وحيدًا)، قبل أي كتابة
  if p_source = 'bank' then
    v_res := to_jsonb(approval_private.bank_account_check(a.project_id, null, p_bank_account));
    if v_res <> 'null'::jsonb then return approval_private.err(v_res #>> '{}'); end if;
    v_res := null;
  end if;

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
    payable_in, payable_out, supplier_id, vat_amount, total_amount, status, file_url, journal_number, created_by_user_id, created_by_name, created_by_role, bank_account_id)
  -- رقم القيد في الوصف: دفعتان بالمبلغ نفسه للمورد نفسه في اليوم نفسه دفعتان مشروعتان، لا تكرار (فهرس ledger_unique_invoice_legacy_path)
  values (a.project_id, p_date, '🏪 سداد مورد', 'سداد مستحقات ' || v_name || ' — ' || jn,
    case when p_source = 'cash' then v_amt else 0 end, case when p_source = 'bank' then v_amt else 0 end, 0, 0, 0, 0,
    0, v_settle, case when p_kind = 'payable' then p_supplier end, 0, v_amt, 'approved', '', jn, a.id, a.name, a.role,
    case when p_source = 'bank' then p_bank_account end);

  perform set_config('tahseeb.supplier_payment', 'off', true);

  v_res := jsonb_build_object('ok', true, 'journal_number', jn, 'amount', v_amt, 'expense_part', v_expense, 'settlement_part', v_settle);
  if p_request is not null then
    insert into approval_private.supplier_payment_requests (request_id, project_id, result) values (p_request, a.project_id, v_res);
  end if;
  return v_res;
end $$;
revoke all on function public.supplier_payment_record(text, uuid, numeric, date, text, text, uuid, uuid) from public, anon;
grant execute on function public.supplier_payment_record(text, uuid, numeric, date, text, text, uuid, uuid) to authenticated;

-- ══ 3) قاموس ربط الأصناف ═════════════════════════════════════════════════════════════════════════════════════════
-- قاعدة لكل وصف صنف (بعد توحيد المسافات والهمزات): active = تصنيف مقترح يُعرض للمحاسب في الاعتماد ويغيّره إن شاء؛ review = بلا تصنيف،
-- يظهر للمراجعة ولا يُقترح تلقائيًا. القاعدة اقتراح في الشاشة، لا تفرض تصنيفًا على الخادم.
create function approval_private.norm_item(p text) returns text language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(translate(coalesce(p, ''), 'أإآٱـ', 'اااا'), '\s+', ' ', 'g')), '')
$$;
grant execute on function approval_private.norm_item(text) to authenticated;
create table public.item_category_rules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  description text not null,
  description_norm text not null,
  category_id uuid references public.categories(id),
  subcategory_id uuid references public.categories(id),
  status text not null check (status in ('active', 'review')),
  suggested_category_id uuid references public.categories(id),   -- مقترح للمراجعة فقط، لا يُطبَّق
  suggested_subcategory_id uuid references public.categories(id),
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (project_id, description_norm),
  check (status = 'review' or category_id is not null)
);
alter table public.item_category_rules enable row level security;
revoke all on public.item_category_rules from public, anon, authenticated;
grant select on public.item_category_rules to authenticated;
create policy item_category_rules_select on public.item_category_rules for select to authenticated
  using (project_id = auth_project_id() or auth_is_superadmin() or project_id = (select auth_view_project_id()));

-- المالك يعتمد قاعدة (تصنيف + فرعي ⇒ active) أو يعيدها للمراجعة، في منشأته وحدها
create function public.item_rule_set(p_rule_id uuid, p_category_id uuid, p_subcategory_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; r record; c record; s record;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role is distinct from 'owner' or a.project_id is null then return approval_private.err('forbidden'); end if;
  if p_status is null or p_status not in ('active', 'review') then return approval_private.err('invalid'); end if;
  select * into r from public.item_category_rules where id = p_rule_id and project_id = a.project_id for update;
  if not found then return approval_private.err('not_found'); end if;
  if p_status = 'active' then
    select * into c from public.categories where id = p_category_id and project_id = a.project_id and parent_id is null and is_active;
    if not found then return approval_private.err('category_invalid'); end if;
    if p_subcategory_id is not null then
      select * into s from public.categories where id = p_subcategory_id and project_id = a.project_id and parent_id = c.id and is_active;
      if not found then return approval_private.err('subcategory_invalid'); end if;
    end if;
    update public.item_category_rules set status = 'active', category_id = c.id, subcategory_id = p_subcategory_id, updated_at = now(), updated_by = a.id
     where id = r.id;
  else
    update public.item_category_rules set status = 'review', category_id = null, subcategory_id = null, updated_at = now(), updated_by = a.id
     where id = r.id;
  end if;
  return jsonb_build_object('ok', true, 'id', r.id, 'status', p_status);
end $$;
revoke all on function public.item_rule_set(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.item_rule_set(uuid, uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
