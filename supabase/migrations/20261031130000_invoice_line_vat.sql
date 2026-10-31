-- ضريبة البنود كما طُبعت وروجعت (2026-10-31).
-- كان الاعتماد يوزّع ضريبة الفاتورة على البنود بنسبة مبالغها (allocate)، فبند ضريبته المطبوعة 0 يُحمَّل ضريبة وتنقص ضريبة غيره، فتختلف ضريبة
-- كل تصنيف وإجماليه عن الورق (الإجمالي والضريبة والصافي صحيحة).
-- ضريبة السطر المقروءة «صالحة» لبند فقط متى وصفت المبلغ المراجَع نفسه بعد أي خصم:
--   lineVat رقم صريح بهللتين على الأكثر وغير سالب (0 رقم صريح = ضريبة صفر؛ غيابه أو null أو نص = غير معروفة، لا صفر)،
--   lineNet + lineVat = printedLineTotal، ومبلغ البند بعد خصمه وحصته من خصم الفاتورة = lineNet (قبل الضريبة) أو printedLineTotal (الشامل)،
--   ولا تتجاوز 15% من lineNet بهامش هللتين. فأي تغيير في المبلغ أو في الخصم لم يعد يطابق الأسطر المطبوعة يُسقط صلاحيتها لذلك البند.
-- التوزيع:
--   ١) كل البنود صالحة ومجموعها = ضريبة الفاتورة ⇒ ضريبة كل بند كما طُبعت.
--   ٢) بعضها صالح وبعضها غير معروف: الصالح بضريبته المطبوعة (والصفر الصريح صفر)، والباقي من ضريبة الفاتورة يوزَّع نسبيًا على غير المعروف وحده،
--      متى كان الباقي بين 0 و15% من صافيها.
--   ٣) غير ذلك (أرقام غير متسقة): ضريبة الفاتورة كلها نسبيًا على كل البنود عدا ذات الصفر الصريح الصالح؛ فإن لم يبقَ بند يحمل ضريبة والضريبة
--      موجبة ⇒ null فيتوقف الاعتماد للمراجعة (line_vat_conflict).
--   ٤) لا ضريبة سطر صالحة في أي بند (بيانات قديمة أو قراءة بلا أسطر) ⇒ التوزيع النسبي كما كان تمامًا.
-- لا يُستنتج إعفاء من اسم الصنف. لا تتغير أي معادلة مطابقة ولا أي قيد معتمد سابق.
set search_path = public;

create or replace function approval_private.item_vats(p_items jsonb, p_after numeric[], p_vat numeric, p_basis text, p_disc numeric)
returns numeric[] language plpgsql immutable set search_path = '' as $$
declare
  n int := coalesce(array_length(p_after, 1), 0); x jsonb; k int := 0; l numeric; ln numeric; lt numeric; ok boolean;
  st text[] := '{}'; lv numeric[] := '{}'; v numeric[]; known numeric := 0; rest numeric; cap numeric := 0;
  u_idx int[] := '{}'; u_w numeric[] := '{}'; nz_idx int[] := '{}'; nz_w numeric[] := '{}'; share numeric[]; i int;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) <> n or n = 0 then return approval_private.allocate(p_after, p_vat); end if;
  for x in select value from jsonb_array_elements(p_items) loop
    k := k + 1;
    l := null;
    ok := coalesce(jsonb_typeof(x -> 'lineVat') = 'number' and jsonb_typeof(x -> 'lineNet') = 'number' and jsonb_typeof(x -> 'printedLineTotal') = 'number', false);
    if ok then
      l := (x ->> 'lineVat')::numeric; ln := (x ->> 'lineNet')::numeric; lt := (x ->> 'printedLineTotal')::numeric;
      ok := coalesce(l >= 0 and l = round(l, 2) and ln + l = lt and l <= round(ln * 0.15, 2) + 0.02
            and p_after[k] = (case when p_basis = 'inclusive' then lt else ln end), false);
    end if;
    st := array_append(st, case when not ok then 'u' when l = 0 then 'z' else 'v' end);
    lv := array_append(lv, case when ok then l end);
  end loop;
  if not ('z' = any (st) or 'v' = any (st)) then return approval_private.allocate(p_after, p_vat); end if;   -- (٤)
  v := array_fill(0::numeric, array[n]);
  for i in 1..n loop
    if st[i] = 'v' then known := known + lv[i]; v[i] := lv[i]; end if;
    if st[i] = 'u' then u_idx := u_idx || i; u_w := u_w || p_after[i];
      cap := cap + round((case when p_basis = 'inclusive' then p_after[i] * 100 / 115 else p_after[i] end) * 0.15, 2) + 0.02; end if;
    if st[i] <> 'z' then nz_idx := nz_idx || i; nz_w := nz_w || p_after[i]; end if;
  end loop;
  if array_length(u_idx, 1) is null then
    if known = p_vat then return v; end if;                                                                  -- (١)
  else
    rest := p_vat - known;
    if rest >= 0 and rest <= cap then                                                                        -- (٢)
      share := approval_private.allocate(u_w, rest);
      for i in 1..array_length(u_idx, 1) loop v[u_idx[i]] := share[i]; end loop;
      return v;
    end if;
  end if;
  -- (٣) غير متسق: كل الضريبة على البنود عدا الصفر الصريح الصالح
  if array_length(nz_idx, 1) is null then
    if p_vat = 0 then return v; end if;
    return null;
  end if;
  v := array_fill(0::numeric, array[n]);
  share := approval_private.allocate(nz_w, p_vat);
  for i in 1..array_length(nz_idx, 1) loop v[nz_idx[i]] := share[i]; end loop;
  return v;
end $$;
revoke all on function approval_private.item_vats(jsonb, numeric[], numeric, text, numeric) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION approval_private.plan_invoice_core(d documents, inv jsonb, p_decisions jsonb, p_document jsonb, v_known boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_id uuid := (inv ->> '_id')::uuid; v_kind text; v_total numeric; v_vat numeric; v_pay text; v_type text; v_basis text; v_date date;
  v_items jsonb; v_amounts numeric[]; v_vats numeric[]; v_sum numeric; v_n int; k int; v_groups jsonb; v_item jsonb; v_main text;
  v_gross numeric; v_label text; v_key text; v_num_raw text; v_num text; v_supplier uuid; v_sup_new boolean := false;
  v_link record; v_dec jsonb; v_branch text; v_branch_key text; v_branches jsonb; v_ch jsonb; v_sales_sum numeric; plan jsonb;
  v_cat public.categories; v_sub public.categories; v_key_cat text; v_res jsonb;
  v_disc numeric; v_line_disc numeric[]; v_disc_shares numeric[]; v_after numeric[];
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
    -- الفحص نفسه في التصحيح: كل قناة غير سالبة، والمجموع موجب ويطابق totalSales
    v_ch := approval_private.sales_channels(inv);
    if v_ch ? 'code' then return approval_private.err(v_ch ->> 'code', (v_ch - 'code') || jsonb_build_object('invoice_id', v_id)); end if;
    v_sales_sum := (v_ch ->> 'total')::numeric; v_ch := v_ch -> 'channels';
    select r.document_id, r.journal_number, r.current, r.revision, dd.file_name into v_link
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
  -- الخصم على إجمالي الفاتورة (موجب): يُطرح من مجموع البنود قبل الضريبة في أساس «قبل الضريبة»، ومن الشامل في الأساس الشامل
  v_disc := approval_private.money(inv -> 'invoiceDiscount', 'invoiceDiscount');
  if v_disc < 0 then return approval_private.err('invalid_discount', jsonb_build_object('invoice_id', v_id)); end if;
  if v_disc > 0 and v_n = 0 then return approval_private.err('discount_needs_items', jsonb_build_object('invoice_id', v_id)); end if;
  if v_n > 0 then
    -- مبلغ البند المحتسب هو بعد خصم البند؛ خصم البند يُسجَّل للتدقيق ولا يدخل المعادلة مرة ثانية
    v_amounts := array(select approval_private.money(x -> 'amount', 'items.amount') from jsonb_array_elements(v_items) x);
    v_line_disc := array(select approval_private.money(x -> 'discount', 'items.discount') from jsonb_array_elements(v_items) x);
    if exists (select 1 from unnest(v_line_disc) x where x < 0) then return approval_private.err('invalid_discount', jsonb_build_object('invoice_id', v_id)); end if;
    v_sum := (select sum(x) from unnest(v_amounts) x);
    if v_disc >= v_sum and v_disc > 0 then return approval_private.err('invalid_discount', jsonb_build_object('invoice_id', v_id, 'discount', v_disc, 'items_total', v_sum)); end if;
    if (v_basis = 'inclusive' and v_sum - v_disc <> v_total) or (v_basis = 'exclusive' and v_sum - v_disc + v_vat <> v_total) then
      return approval_private.err('amounts_mismatch', jsonb_build_object('invoice_id', v_id, 'basis', v_basis, 'items_total', v_sum, 'discount', v_disc,
        'total', v_total, 'vat', v_vat, 'difference', case when v_basis = 'inclusive' then v_sum - v_disc - v_total else v_sum - v_disc + v_vat - v_total end));
    end if;
    -- الخصم يوزَّع على البنود بنسبة مبالغها، ثم الضريبة على المبالغ بعد الخصم — بالهللة وبالباقي الأكبر
    v_disc_shares := approval_private.allocate(v_amounts, v_disc);
    v_after := array(select v_amounts[i] - v_disc_shares[i] from generate_subscripts(v_amounts, 1) i order by i);
    -- ضريبة كل بند كما طُبعت وروجعت (20261031130000): القواعد في approval_private.item_vats أعلاه
    v_vats := approval_private.item_vats(v_items, v_after, v_vat, v_basis, v_disc);
    -- كل البنود ضريبتها المطبوعة صفر والفاتورة بضريبة: أرقام متعارضة، يتوقف الاعتماد للمراجعة
    if v_vats is null then return approval_private.err('line_vat_conflict', jsonb_build_object('invoice_id', v_id, 'vat', v_vat)); end if;
    for k in 1..v_n loop
      v_item := v_items -> (k - 1);
      v_main := coalesce(nullif(v_item ->> 'category_main', ''), nullif(inv ->> 'category_main', ''));
      -- التصنيف الأساسي بمعرّفه (أو بالفرعي، أو بالاسم للتوافق)؛ نوع القيد ومعالجته من التصنيف نفسه، لا من اسمه
      v_res := approval_private.resolve_item_category(d.project_id, v_item ->> 'category_id', v_item ->> 'subcategory_id', v_main, v_item ->> 'category_sub');
      if v_res ? 'code' then return approval_private.err(v_res ->> 'code', (v_res - 'code') || jsonb_build_object('invoice_id', v_id, 'item', k)); end if;
      select * into v_cat from public.categories where id = (v_res ->> 'category_id')::uuid;
      select * into v_sub from public.categories where id = (v_res ->> 'subcategory_id')::uuid;
      if v_cat.id is not null and not v_cat.is_active then
        return approval_private.err('category_inactive', jsonb_build_object('invoice_id', v_id, 'name', v_cat.name));
      end if;
      if v_sub.id is not null and not v_sub.is_active then
        return approval_private.err('category_inactive', jsonb_build_object('invoice_id', v_id, 'name', v_sub.name, 'parent', v_cat.name));
      end if;
      v_main := coalesce(v_cat.name, v_main);
      v_key_cat := coalesce(v_cat.id::text, 'n:' || coalesce(v_main, ''));
      v_gross := case when v_basis = 'inclusive' then v_after[k] else v_after[k] + v_vats[k] end;
      v_item := jsonb_build_object('description', coalesce(nullif(v_item ->> 'description', ''), v_label, ''), 'amount', v_gross, 'vat', v_vats[k],
        'main', v_main, 'sub', coalesce(v_sub.name, nullif(v_item ->> 'category_sub', '')), 'sort', k,
        'category_id', v_cat.id, 'subcategory_id', v_sub.id, 'cat_key', v_key_cat, 'financial_class', v_cat.financial_class,
        'line_discount', v_line_disc[k], 'invoice_discount_share', v_disc_shares[k], 'amount_read', v_amounts[k],
        'type', coalesce(v_cat.ledger_type, case when v_n = 1 then v_type end, nullif(v_item ->> 'ledger_type', ''), v_type, '🛒 مصروفات تشغيلية'));
      if exists (select 1 from jsonb_array_elements(v_groups) gg where gg ->> 'cat_key' = v_key_cat) then
        v_groups := (select jsonb_agg(case when gg ->> 'cat_key' = v_key_cat
            then gg || jsonb_build_object('gross', (gg ->> 'gross')::numeric + v_gross, 'vat', (gg ->> 'vat')::numeric + v_vats[k],
                                          'discount', (gg ->> 'discount')::numeric + v_disc_shares[k],
                                          'items', (gg -> 'items') || jsonb_build_array(v_item))
            else gg end) from jsonb_array_elements(v_groups) gg);
      else
        v_groups := v_groups || jsonb_build_array(jsonb_build_object('main', v_main, 'type', v_item -> 'type', 'gross', v_gross,
          'vat', v_vats[k], 'items', jsonb_build_array(v_item), 'cat_key', v_key_cat, 'category_id', v_cat.id, 'financial_class', v_cat.financial_class,
          'discount', v_disc_shares[k]));
      end if;
    end loop;
  else
    -- بلا بنود: تصنيف الفاتورة بمعرّفه، أو التصنيف المربوط بنوع الحركة المختار
    v_res := approval_private.resolve_item_category(d.project_id, inv ->> 'category_id', inv ->> 'subcategory_id', nullif(inv ->> 'category_main', ''), inv ->> 'category_sub', v_type);
    if v_res ? 'code' then return approval_private.err(v_res ->> 'code', (v_res - 'code') || jsonb_build_object('invoice_id', v_id)); end if;
    select * into v_cat from public.categories where id = (v_res ->> 'category_id')::uuid;
    if v_cat.id is not null and not v_cat.is_active then
      return approval_private.err('category_inactive', jsonb_build_object('invoice_id', v_id, 'name', v_cat.name));
    end if;
    v_groups := jsonb_build_array(jsonb_build_object('main', coalesce(v_cat.name, nullif(inv ->> 'category_main', '')), 'type', v_type,
      'gross', v_total, 'vat', v_vat, 'sub', coalesce((select name from public.categories where id=(v_res->>'subcategory_id')::uuid),nullif(inv ->> 'category_sub', '')), 'items', '[]'::jsonb,
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
       and x.invoice_number_norm = v_num
       and (x.supplier_key = v_key
            -- طرف بلا سجل مورد (مفتاحه الاسم) يطابق بالاسم المطبّع أي مسار: نقدي ثم آجل أو من القائمة، أو العكس
            or ((x.supplier_key like 'n:%' or v_key like 'n:%')
                and approval_private.norm_name(x.supplier_label) = approval_private.norm_name(v_label)))
     limit 1;
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

  return plan || jsonb_build_object('total', v_total, 'vat', v_vat, 'basis', v_basis, 'type', v_type, 'groups', v_groups, 'invoice_discount', v_disc,
    'supplier_id', v_supplier, 'supplier_new', v_sup_new, 'supplier_key', v_key, 'label', v_label,
    'incoming', coalesce(v_type, '') like '%تحصيل جملة%', 'duplicate_decision', v_dec);
exception when sqlstate 'P0001' then
  if sqlerrm like 'APPROVAL:%' then
    return approval_private.err(split_part(sqlerrm, ':', 2), jsonb_build_object('invoice_id', v_id, 'field', split_part(sqlerrm, ':', 3)));
  end if;
  raise;
end $function$
;
