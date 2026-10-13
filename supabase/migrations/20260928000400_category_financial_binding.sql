-- =============================================================================
-- ربط التصنيف بمعالجته المالية بمعرّف ثابت، لا باسمه — شرط قبل تمكين المالك من إعادة التسمية.
--
-- • categories: رمز مالي (financial_class: cogs | opex | fixed)، ونوع القيد (ledger_type)، وحالة (is_active).
--   التسمية لا تغيّر أيًّا منها. التعطيل يخفي التصنيف من الاختيار الجديد ولا يمس ما ارتبط به.
-- • ledger_entries: category_id وfinancial_class يُكتبان وقت الاعتماد (لقطة ثابتة للمعالجة).
-- • document_items: category_id وsubcategory_id.
-- • المحرك والتقارير يصنّفان بالرمز حين يوجد، وبالاستنتاج السابق من نوع القيد للبيانات القديمة (لا تتغير).
-- • التعبئة الأولى للأعمدة الجديدة في التصنيفات بالاستنتاج نفسه الذي يعمل به التطبيق اليوم. لا يُعدَّل قيد ولا بند.
-- =============================================================================

alter table public.categories
  add column if not exists financial_class text check (financial_class in ('cogs', 'opex', 'fixed')),
  add column if not exists ledger_type text,
  add column if not exists is_active boolean not null default true;
alter table public.ledger_entries
  add column if not exists category_id uuid,
  add column if not exists financial_class text;
alter table public.document_items
  add column if not exists category_id uuid,
  add column if not exists subcategory_id uuid;

-- مطابقة الاسم كما في التطبيق (normCat): تُحذف الرموز والإيموجي، وتُوحَّد المسافات والأرقام (العربية الهندية إلى لاتينية)
-- وحالة الحروف اللاتينية. تبقى الحروف العربية واللاتينية والأرقام، فلا يتطابق اسمان مختلفان (مثل «Coffee 1» و«Coffee 2»).
create function approval_private.norm_cat(t text) returns text language sql immutable set search_path = '' as $$
  select lower(btrim(regexp_replace(regexp_replace(translate(coalesce(t, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
    '[^A-Za-z0-9؀-ۿ[:space:]]', '', 'g'), '\s+', ' ', 'g')))
$$;

-- التعبئة الأولى (التصنيفات الأساسية): نوع الحركة بالاسم نفسه من إعدادات المنشأة، والرمز كما يصنّفه المحرك اليوم.
-- لا تمس قيمة موجودة (coalesce)، فتشغيلها مرة ثانية آمن. تُستدعى هنا، وبعد تحميل بيانات بيئة الاختبار.
create function approval_private.backfill_category_finance() returns int language plpgsql set search_path = '' as $f$
declare n int;
begin
  update public.categories c set
    ledger_type = coalesce(c.ledger_type, (
      select t.label from public.project_settings ps,
             lateral jsonb_array_elements(case when jsonb_typeof(ps.settings -> 'transaction_types') = 'array' then ps.settings -> 'transaction_types' else '[]' end) x,
             lateral (select coalesce(x ->> 'label', x #>> '{}') as label) t
       where ps.project_id = c.project_id and approval_private.norm_cat(t.label) = approval_private.norm_cat(c.name)
       limit 1)),
    financial_class = coalesce(c.financial_class, case
      when approval_private.norm_cat(c.name) like any (array['%تكلفة البضاعة المباعة%', '%مشتريات قهوة ومواد%', '%مواد تعبئة وتغليف%']) then 'cogs'
      when approval_private.norm_cat(c.name) like '%مصروفات ثابتة%' then 'fixed'
      else 'opex' end)
  where c.parent_id is null;
  get diagnostics n = row_count;
  return n;
end $f$;
select approval_private.backfill_category_finance();

-- التصنيف الأساسي للبند: بمعرّفه، أو أبو الفرعي بمعرّفه، أو بالاسم (للقراءة القديمة)، أو المربوط بنوع الحركة
create function approval_private.resolve_category(p_project uuid, p_id text, p_sub_id text, p_name text, p_sub_name text, p_ledger_type text default null)
returns public.categories language plpgsql stable set search_path = '' as $$
declare c public.categories;
begin
  if nullif(p_id, '') is not null then
    select * into c from public.categories where id = p_id::uuid and project_id = p_project;
    if c.parent_id is not null then select * into c from public.categories where id = c.parent_id; end if;
    if c.id is not null then return c; end if;
  end if;
  if nullif(p_sub_id, '') is not null then
    select p.* into c from public.categories s join public.categories p on p.id = s.parent_id where s.id = p_sub_id::uuid and s.project_id = p_project;
    if c.id is not null then return c; end if;
  end if;
  if nullif(p_sub_name, '') is not null then
    select p.* into c from public.categories s join public.categories p on p.id = s.parent_id
     where s.project_id = p_project and approval_private.norm_cat(s.name) = approval_private.norm_cat(p_sub_name)
     order by p.is_active desc limit 1;
    if c.id is not null then return c; end if;
  end if;
  if nullif(p_name, '') is not null then
    select * into c from public.categories where project_id = p_project and parent_id is null
       and approval_private.norm_cat(name) = approval_private.norm_cat(p_name) order by is_active desc limit 1;
    if c.id is not null then return c; end if;
  end if;
  if nullif(p_ledger_type, '') is not null then
    select * into c from public.categories where project_id = p_project and parent_id is null and ledger_type = p_ledger_type
     order by is_active desc limit 1;
  end if;
  return c;
end $$;

create function approval_private.resolve_subcategory(p_parent uuid, p_sub_id text, p_sub_name text) returns public.categories
language plpgsql stable set search_path = '' as $$
declare c public.categories;
begin
  if p_parent is null then return c; end if;
  if nullif(p_sub_id, '') is not null then
    select * into c from public.categories where id = p_sub_id::uuid and parent_id = p_parent;
    if c.id is not null then return c; end if;
  end if;
  if nullif(p_sub_name, '') is not null then
    select * into c from public.categories where parent_id = p_parent and approval_private.norm_cat(name) = approval_private.norm_cat(p_sub_name) limit 1;
  end if;
  return c;
end $$;

revoke all on function approval_private.norm_cat(text), approval_private.resolve_category(uuid, text, text, text, text, text),
  approval_private.resolve_subcategory(uuid, text, text) from public, anon, authenticated;

create or replace function approval_private.plan_invoice(d public.documents, inv jsonb, p_decisions jsonb, p_document jsonb, v_known boolean)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_id uuid := (inv ->> '_id')::uuid; v_kind text; v_total numeric; v_vat numeric; v_pay text; v_type text; v_basis text; v_date date;
  v_items jsonb; v_amounts numeric[]; v_vats numeric[]; v_sum numeric; v_n int; k int; v_groups jsonb; v_item jsonb; v_main text;
  v_gross numeric; v_label text; v_key text; v_num_raw text; v_num text; v_supplier uuid; v_sup_new boolean := false;
  v_link record; v_dec jsonb; v_branch text; v_branch_key text; v_branches jsonb; v_ch jsonb; v_sales_sum numeric; plan jsonb;
  v_cat public.categories; v_sub public.categories; v_key_cat text;
begin
  v_date := nullif(inv ->> 'date', '')::date;
  if v_date is null then return approval_private.err('date_required', jsonb_build_object('invoice_id', v_id)); end if;
  v_kind := case inv ->> 'type' when 'sales' then 'sales' when 'transfer' then 'transfer'
                 else case when inv ->> 'paySource' = 'credit' then 'credit' else 'expense' end end;
  v_pay := nullif(inv ->> 'paySource', '');
  v_label := nullif(btrim(coalesce(inv ->> 'description', '')), '');
  v_num_raw := nullif(btrim(coalesce(inv ->> 'invoiceNumber', '')), '');
  v_num := approval_private.norm_invoice_number(v_num_raw);
  v_branch := nullif(btrim(coalesce(p_document ->> 'branch', d.branch, '')), '');
  plan := jsonb_build_object('ok', true, 'id', v_id, 'kind', v_kind, 'date', v_date, 'description', v_label, 'number_raw', v_num_raw,
                             'number', v_num, 'pay', v_pay, 'payload', inv, 'known', v_known, 'branch', v_branch);

  if v_kind = 'sales' then
    select settings -> 'branches' into v_branches from public.project_settings where project_id = d.project_id;
    if jsonb_typeof(v_branches) = 'array' and jsonb_array_length(v_branches) > 0 then
      if v_branch is null or not (v_branches ? v_branch) then return approval_private.err('branch_required', jsonb_build_object('invoice_id', v_id)); end if;
      v_branch_key := v_branch;
    else
      v_branch_key := coalesce(v_branch, '∅');   -- منشأة بلا فروع: مفتاح «بلا فرع» صريح
    end if;
    v_ch := jsonb_build_object(
      'cash', approval_private.money(inv -> 'cashSales', 'cashSales'), 'network', approval_private.money(inv -> 'networkSales', 'networkSales'),
      'transfer', approval_private.money(inv -> 'transferSales', 'transferSales'), 'hunger', approval_private.money(inv -> 'hungerSales', 'hungerSales'),
      'jahez', approval_private.money(inv -> 'jahez', 'jahez'), 'keeta', approval_private.money(inv -> 'keeta', 'keeta'),
      'mrsool', approval_private.money(inv -> 'mrsool', 'mrsool'));
    select sum(value::numeric) into v_sales_sum from jsonb_each_text(v_ch);
    if v_sales_sum <= 0 then return approval_private.err('amount_required', jsonb_build_object('invoice_id', v_id)); end if;
    if nullif(inv ->> 'totalSales', '') is not null and approval_private.money(inv -> 'totalSales', 'totalSales') <> v_sales_sum then
      return approval_private.err('amounts_mismatch', jsonb_build_object('invoice_id', v_id, 'items_total', v_sales_sum,
        'total', approval_private.money(inv -> 'totalSales', 'totalSales'), 'difference', v_sales_sum - approval_private.money(inv -> 'totalSales', 'totalSales')));
    end if;
    select r.document_id, r.journal_number, r.current, dd.file_name into v_link
      from approval_private.sales_reports r left join public.documents dd on dd.id = r.document_id
     where r.project_id = d.project_id and r.branch_key = v_branch_key and r.report_date = v_date;
    if found then
      return approval_private.err('sales_report_exists', jsonb_build_object('invoice_id', v_id, 'linked', to_jsonb(v_link)));
    end if;
    if exists (select 1 from public.sales s where s.project_id = d.project_id and s.date = v_date and s.description = 'تقرير POS'
                and coalesce(s.branch, '∅') = v_branch_key) then
      return approval_private.err('sales_report_exists_legacy', jsonb_build_object('invoice_id', v_id, 'date', v_date, 'branch', v_branch));
    end if;
    return plan || jsonb_build_object('channels', v_ch, 'branch_key', v_branch_key, 'total', v_sales_sum);
  end if;

  if v_kind = 'transfer' then
    if v_pay is null then return approval_private.err('pay_required', jsonb_build_object('invoice_id', v_id)); end if;
    v_total := approval_private.money(coalesce(inv -> 'amount', inv -> 'totalAmount'), 'amount');
    if v_total <= 0 then return approval_private.err('amount_required', jsonb_build_object('invoice_id', v_id)); end if;
    return plan || jsonb_build_object('total', v_total, 'trans_type', nullif(inv ->> 'transType', ''));
  end if;

  -- مصروف (نقدي/بنك/عهدة/آجل) أو مورد من القائمة
  if v_pay is null or v_pay not in ('cash', 'bank', 'custody', 'payable', 'credit') then
    return approval_private.err('pay_required', jsonb_build_object('invoice_id', v_id));
  end if;
  v_type := coalesce(d.purchase_category, nullif(inv ->> 'transType', ''));
  v_items := coalesce(inv -> 'items', '[]');
  v_n := jsonb_array_length(v_items);
  if v_n <= 1 and v_type is null then return approval_private.err('type_required', jsonb_build_object('invoice_id', v_id)); end if;
  v_total := approval_private.money(coalesce(inv -> 'totalAmount', inv -> 'amount'), 'totalAmount');
  v_vat := approval_private.money(inv -> 'vatAmount', 'vatAmount');
  if v_total <= 0 then return approval_private.err('amount_required', jsonb_build_object('invoice_id', v_id)); end if;
  if v_vat < 0 or v_vat > v_total then return approval_private.err('vat_invalid', jsonb_build_object('invoice_id', v_id)); end if;
  v_basis := case when inv ->> 'amountsBasis' = 'exclusive' then 'exclusive' else 'inclusive' end;

  -- البنود: مطابقة تامة بالهللة على أساس المستند، والضريبة موزعة بالباقي الأكبر؛ قيد لكل تصنيف أساسي
  v_groups := '[]';
  if v_n > 0 then
    v_amounts := array(select approval_private.money(x -> 'amount', 'items.amount') from jsonb_array_elements(v_items) x);
    v_sum := (select sum(x) from unnest(v_amounts) x);
    if (v_basis = 'inclusive' and v_sum <> v_total) or (v_basis = 'exclusive' and v_sum + v_vat <> v_total) then
      return approval_private.err('amounts_mismatch', jsonb_build_object('invoice_id', v_id, 'basis', v_basis, 'items_total', v_sum,
        'total', v_total, 'vat', v_vat, 'difference', case when v_basis = 'inclusive' then v_sum - v_total else v_sum + v_vat - v_total end));
    end if;
    v_vats := approval_private.allocate(v_amounts, v_vat);
    for k in 1..v_n loop
      v_item := v_items -> (k - 1);
      v_main := coalesce(nullif(v_item ->> 'category_main', ''), nullif(inv ->> 'category_main', ''));
      -- التصنيف الأساسي بمعرّفه (أو بالفرعي، أو بالاسم للتوافق)؛ نوع القيد ومعالجته من التصنيف نفسه، لا من اسمه
      v_cat := approval_private.resolve_category(d.project_id, v_item ->> 'category_id', v_item ->> 'subcategory_id', v_main, v_item ->> 'category_sub');
      if v_cat.id is not null and not v_cat.is_active then
        return approval_private.err('category_inactive', jsonb_build_object('invoice_id', v_id, 'name', v_cat.name));
      end if;
      v_sub := approval_private.resolve_subcategory(v_cat.id, v_item ->> 'subcategory_id', v_item ->> 'category_sub');
      v_main := coalesce(v_cat.name, v_main);
      v_key_cat := coalesce(v_cat.id::text, 'n:' || coalesce(v_main, ''));
      v_gross := case when v_basis = 'inclusive' then v_amounts[k] else v_amounts[k] + v_vats[k] end;
      v_item := jsonb_build_object('description', coalesce(nullif(v_item ->> 'description', ''), v_label, ''), 'amount', v_gross, 'vat', v_vats[k],
        'main', v_main, 'sub', coalesce(v_sub.name, nullif(v_item ->> 'category_sub', '')), 'sort', k,
        'category_id', v_cat.id, 'subcategory_id', v_sub.id, 'cat_key', v_key_cat, 'financial_class', v_cat.financial_class,
        'type', coalesce(case when v_n = 1 then v_type end, v_cat.ledger_type, nullif(v_item ->> 'ledger_type', ''), v_type, '🛒 مصروفات تشغيلية'));
      if exists (select 1 from jsonb_array_elements(v_groups) gg where gg ->> 'cat_key' = v_key_cat) then
        v_groups := (select jsonb_agg(case when gg ->> 'cat_key' = v_key_cat
            then gg || jsonb_build_object('gross', (gg ->> 'gross')::numeric + v_gross, 'vat', (gg ->> 'vat')::numeric + v_vats[k],
                                          'items', (gg -> 'items') || jsonb_build_array(v_item))
            else gg end) from jsonb_array_elements(v_groups) gg);
      else
        v_groups := v_groups || jsonb_build_array(jsonb_build_object('main', v_main, 'type', v_item -> 'type', 'gross', v_gross,
          'vat', v_vats[k], 'items', jsonb_build_array(v_item), 'cat_key', v_key_cat, 'category_id', v_cat.id, 'financial_class', v_cat.financial_class));
      end if;
    end loop;
  else
    -- بلا بنود: تصنيف الفاتورة بمعرّفه، أو التصنيف المربوط بنوع الحركة المختار
    v_cat := approval_private.resolve_category(d.project_id, inv ->> 'category_id', null, nullif(inv ->> 'category_main', ''), null, v_type);
    if v_cat.id is not null and not v_cat.is_active then
      return approval_private.err('category_inactive', jsonb_build_object('invoice_id', v_id, 'name', v_cat.name));
    end if;
    v_groups := jsonb_build_array(jsonb_build_object('main', coalesce(v_cat.name, nullif(inv ->> 'category_main', '')), 'type', v_type,
      'gross', v_total, 'vat', v_vat, 'sub', nullif(inv ->> 'category_sub', ''), 'items', '[]'::jsonb,
      'category_id', v_cat.id, 'financial_class', v_cat.financial_class));
  end if;

  -- المورد ومفتاحه (نطاق ترقيم الفواتير: كل مورد يرقّم فواتيره بنفسه)
  if v_kind = 'credit' then
    v_supplier := nullif(coalesce(inv ->> 'supplier_id', p_document ->> 'supplier_id'), '')::uuid;
    if v_supplier is null or not exists (select 1 from public.suppliers s where s.id = v_supplier and s.project_id = d.project_id) then
      return approval_private.err('supplier_required', jsonb_build_object('invoice_id', v_id));
    end if;
    v_key := 's:' || v_supplier;
    v_label := coalesce(v_label, (select s.name from public.suppliers s where s.id = v_supplier));
  elsif v_pay = 'payable' then
    v_label := coalesce(nullif(btrim(inv ->> 'supplier_name'), ''), v_label);
    if v_label is null then return approval_private.err('supplier_required', jsonb_build_object('invoice_id', v_id)); end if;
    v_dec := p_decisions -> 'suppliers' -> (v_id::text);
    select ps.id into v_supplier from public.payable_suppliers ps
     where ps.project_id = d.project_id and approval_private.norm_name(ps.name) = approval_private.norm_name(v_label) limit 1;
    if v_supplier is null then
      if v_dec ->> 'resolution' = 'existing' then
        v_supplier := nullif(v_dec ->> 'supplier_id', '')::uuid;
        if not exists (select 1 from public.payable_suppliers ps where ps.id = v_supplier and ps.project_id = d.project_id) then
          return approval_private.err('supplier_required', jsonb_build_object('invoice_id', v_id));
        end if;
      elsif v_dec ->> 'resolution' = 'new' then v_sup_new := true;
      else return approval_private.err('supplier_decision_required', jsonb_build_object('invoice_id', v_id, 'name', v_label));
      end if;
    end if;
    v_key := case when v_supplier is not null then 'ps:' || v_supplier else 'n:' || approval_private.norm_name(v_label) end;
  else
    v_key := 'n:' || coalesce(approval_private.norm_name(v_label), '');
  end if;

  -- التكرار: الرقم نفسه للمورد نفسه يُمنع دائمًا. الاشتباه يحتاج سببًا مكتوبًا، ولا يمس حماية إعادة الاعتماد
  if v_num is not null then
    select x.document_id, x.journal_number, x.invoice_date, x.total, dd.file_name into v_link
      from approval_private.document_invoices x join public.documents dd on dd.id = x.document_id
     where x.project_id = d.project_id and x.status = 'approved' and x.kind in ('expense', 'credit')
       and x.supplier_key = v_key and x.invoice_number_norm = v_num limit 1;
    if found then return approval_private.err('duplicate_invoice', jsonb_build_object('invoice_id', v_id, 'linked', to_jsonb(v_link))); end if;
  end if;
  v_dec := p_decisions -> 'duplicates' -> (v_id::text);
  if nullif(btrim(coalesce(v_dec ->> 'reason', '')), '') is null then
    v_dec := null;
    select 'same_number_other_supplier' as reason, x.document_id, x.journal_number, x.invoice_date, x.total, dd.file_name, x.supplier_label into v_link
      from approval_private.document_invoices x join public.documents dd on dd.id = x.document_id
     where v_num is not null and x.project_id = d.project_id and x.status = 'approved' and x.kind in ('expense', 'credit')
       and x.invoice_number_norm = v_num and x.supplier_key <> v_key limit 1;
    if not found then
      select 'same_supplier_date_total' as reason, x.document_id, x.journal_number, x.invoice_date, x.total, dd.file_name, x.supplier_label into v_link
        from approval_private.document_invoices x join public.documents dd on dd.id = x.document_id
       where x.project_id = d.project_id and x.status = 'approved' and x.kind in ('expense', 'credit')
         and x.supplier_key = v_key and x.invoice_date = v_date and x.total = v_total
         and (v_num is null or x.invoice_number_norm is null) limit 1;   -- رقمان مختلفان = فاتورتان مختلفتان
    end if;
    if not found then   -- قيود المسار السابق (بلا سجل فواتير)
      select 'legacy_entry_match' as reason, null::uuid as document_id, le.journal_number, le.date as invoice_date, le.total_amount as total,
             null::text as file_name, le.description as supplier_label into v_link
        from public.ledger_entries le
       where le.project_id = d.project_id and le.document_invoice_id is null and le.date = v_date and le.total_amount = v_total
         and approval_private.norm_name(regexp_replace(coalesce(le.description, ''), '\s*(—.*|\[[a-z0-9]+\])$', '')) = approval_private.norm_name(v_label)
       limit 1;
    end if;
    if found then return approval_private.err('suspected_duplicate', jsonb_build_object('invoice_id', v_id, 'linked', to_jsonb(v_link))); end if;
  end if;

  return plan || jsonb_build_object('total', v_total, 'vat', v_vat, 'basis', v_basis, 'type', v_type, 'groups', v_groups,
    'supplier_id', v_supplier, 'supplier_new', v_sup_new, 'supplier_key', v_key, 'label', v_label,
    'incoming', coalesce(v_type, '') like '%تحصيل جملة%', 'duplicate_decision', v_dec);
exception when sqlstate 'P0001' then
  if sqlerrm like 'APPROVAL:%' then
    return approval_private.err(split_part(sqlerrm, ':', 2), jsonb_build_object('invoice_id', v_id, 'field', split_part(sqlerrm, ':', 3)));
  end if;
  raise;
end $$;

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

  elsif v_kind = 'credit' then
    insert into public.supplier_transactions (supplier_id, project_id, type, amount, date, notes, document_id, journal_number)
    values ((plan ->> 'supplier_id')::uuid, d.project_id, 'invoice', (plan ->> 'total')::numeric, v_date,
            coalesce(plan ->> 'description', d.file_name), d.id, jn);

  else
    v_supplier := nullif(plan ->> 'supplier_id', '')::uuid;
    if (plan ->> 'supplier_new')::boolean then
      insert into public.payable_suppliers (project_id, name) values (d.project_id, plan ->> 'label') returning id into v_supplier;
      v_key := 'ps:' || v_supplier;
    end if;
    v_incoming := (plan ->> 'incoming')::boolean;
    for g in select value from jsonb_array_elements(plan -> 'groups') loop
      v_gross := (g ->> 'gross')::numeric;
      insert into public.ledger_entries (project_id, date, type, description, cash_out, bank_out, custody_out, cash_in, bank_in, custody_in,
        payable_in, payable_out, supplier_id, vat_amount, total_amount, status, file_url, journal_number, branch, purchase_category,
        category_main, category_sub, document_id, document_invoice_id, invoice_number, category_id, financial_class)
      values (d.project_id, v_date, coalesce(g ->> 'type', '🛒 مصروفات تشغيلية'), coalesce(plan ->> 'description', d.file_name),
        case when not v_incoming and v_pay = 'cash' then v_gross else 0 end,
        case when not v_incoming and v_pay = 'bank' then v_gross else 0 end,
        case when not v_incoming and v_pay = 'custody' then v_gross else 0 end,
        case when v_incoming and v_pay = 'cash' then v_gross else 0 end,
        case when v_incoming and v_pay = 'bank' then v_gross else 0 end,
        case when v_incoming and v_pay = 'custody' then v_gross else 0 end,
        case when not v_incoming and v_pay = 'payable' then v_gross else 0 end, 0,
        v_supplier, (g ->> 'vat')::numeric, v_gross, 'approved', coalesce(d.file_url, ''), jn, v_branch, d.purchase_category,
        g ->> 'main', g ->> 'sub', d.id, v_id, plan ->> 'number_raw', nullif(g ->> 'category_id', '')::uuid, g ->> 'financial_class')
      returning id into le_id;
      insert into public.document_items (document_id, project_id, journal_number, description, amount, vat_amount, category_main, category_sub,
        sort_order, ledger_entry_id, document_invoice_id, category_id, subcategory_id)
      select d.id, d.project_id, jn, x ->> 'description', (x ->> 'amount')::numeric, (x ->> 'vat')::numeric, x ->> 'main', x ->> 'sub',
             (x ->> 'sort')::int, le_id, v_id, nullif(x ->> 'category_id', '')::uuid, nullif(x ->> 'subcategory_id', '')::uuid
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
