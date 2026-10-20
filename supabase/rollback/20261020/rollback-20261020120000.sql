-- رجوع 20261020120000 (إيصالات سداد الموردين من المستندات): نصوص الدوال قبلها حرفيًا (كما في الإنتاج 7f47603 / الهجرة 20261018120000
-- وما قبلها)، وحذف الدوال الجديدة. لا بيانات تُحذف:
--   • الدفعات المسجلة من الإيصالات تبقى دفعات صحيحة في «الموردين» والدفتر، وروابطها بالمستندات (document_id) تبقى للاطلاع.
--   • عمود approval_private.document_invoices.history يبقى (سجل ما حدث)، ولا تقرؤه الدوال السابقة.
--   • بعد الرجوع: «سداد مورد» من المستندات يُرفض كما كان (supplier_payment_via_suppliers)، وحذف دفعة مرتبطة بإيصال لا يعيد
--     الإيصال للمراجعة (السلوك السابق).
-- الترتيب: الواجهة أولًا (ترقية النشر السابق)، ثم هذا الملف.
\set ON_ERROR_STOP on
begin;
-- public.approval_approve(uuid,uuid,integer,jsonb,jsonb,jsonb)
CREATE OR REPLACE FUNCTION public.approval_approve(p_document_id uuid, p_request_id uuid, p_expected_version integer, p_invoices jsonb, p_decisions jsonb DEFAULT '{}'::jsonb, p_document jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a record; d public.documents; rq record; di record; inv jsonb; plan jsonb; plans jsonb := '[]'; journals jsonb := '[]'; res jsonb;
  fp text := md5(jsonb_build_array(p_document_id, p_invoices, coalesce(p_decisions, '{}'), coalesce(p_document, '{}'))::text);
  v_id uuid; v_seen text[] := '{}'; v_num_keys text[] := '{}'; jn text; v_first_jn text; v_pending int;
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
    plans := plans || jsonb_build_array(plan);
  end loop;

  -- المرحلة 2: الكتابة كلها في هذه المعاملة. أي خطأ يلغيها كلها
  begin
    for plan in select value from jsonb_array_elements(plans) loop
      jn := approval_private.write_invoice(d, plan, a.id, p_request_id);
      v_first_jn := coalesce(v_first_jn, jn);
      journals := journals || jsonb_build_array(jsonb_build_object('invoice_id', plan ->> 'id', 'journal_number', jn));
    end loop;
  exception when unique_violation then
    return approval_private.err('duplicate_invoice', jsonb_build_object('detail', 'concurrent'));
  end;

  d := approval_private.finish_document(d, a.id, v_first_jn, coalesce(p_document, '{}'));
  select count(*) into v_pending from approval_private.document_invoices where document_id = d.id and status = 'pending';
  res := jsonb_build_object('ok', true, 'document_status', d.status, 'version', d.version, 'journals', journals, 'pending', v_pending);
  insert into approval_private.requests (request_id, project_id, document_id, action, fingerprint, actor_id, result)
  values (p_request_id, d.project_id, d.id, 'approve', fp, a.id, res);
  return res;
end $function$;

-- public.approval_prepare(uuid)
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
                 'journal_number', x.journal_number, 'excluded_reason', x.excluded_reason) order by x.idx)
               from approval_private.document_invoices x where x.document_id = d.id), '[]'));
end $function$;

-- approval_private.plan_invoice(documents,jsonb,jsonb,jsonb,boolean)
CREATE OR REPLACE FUNCTION approval_private.plan_invoice(d documents, inv jsonb, p_decisions jsonb, p_document jsonb, v_known boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare plan jsonb := approval_private.plan_invoice_core(d, inv, p_decisions, p_document, v_known); k text; v_needs boolean; v_code text;
begin
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

-- approval_private.write_invoice(documents,jsonb,uuid,uuid)
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
end $function$;

-- public.supplier_payment_record(text,uuid,numeric,date,text,text,uuid,uuid)
CREATE OR REPLACE FUNCTION public.supplier_payment_record(p_kind text, p_supplier uuid, p_amount numeric, p_date date, p_source text, p_notes text DEFAULT NULL::text, p_request uuid DEFAULT NULL::uuid, p_bank_account uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a record; v_name text; v_open numeric; v_unrec numeric; v_paid numeric; v_expense numeric; v_settle numeric; v_bal numeric;
        jn text; v_res jsonb; v_amt numeric;
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
end $function$;

-- public.supplier_payment_delete(text,uuid)
CREATE OR REPLACE FUNCTION public.supplier_payment_delete(p_journal_number text, p_entry_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a record; v_jn text := nullif(btrim(coalesce(p_journal_number, '')), ''); v_sup uuid; v_led int; v_tx int;
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

  perform set_config('tahseeb.supplier_payment', 'on', true);
  delete from public.ledger_entries le where le.project_id = a.project_id and le.type like '%سداد مورد%'
     and ((v_jn is not null and le.journal_number = v_jn) or le.id = p_entry_id);
  get diagnostics v_led = row_count;
  if v_jn is not null then
    delete from public.supplier_transactions t where t.project_id = a.project_id and t.journal_number = v_jn and t.type = 'payment';
    get diagnostics v_tx = row_count;
  end if;
  perform set_config('tahseeb.supplier_payment', 'off', true);
  return jsonb_build_object('ok', true, 'journal_number', v_jn, 'ledger_rows', v_led, 'supplier_rows', coalesce(v_tx, 0));
end $function$;

drop function public.supplier_payment_context(text, uuid, uuid);
drop function approval_private.write_supplier_payment(public.documents, jsonb, uuid);
drop function approval_private.plan_supplier_payment(public.documents, jsonb, jsonb, boolean);
drop function approval_private.supplier_payment_core(uuid, uuid, text, text, text, uuid, numeric, date, text, text, uuid, uuid, uuid, uuid, text);
commit;
