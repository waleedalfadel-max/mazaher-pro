-- Roll back UI first. Configuration and historical financial data are retained.
set search_path=public;
CREATE OR REPLACE FUNCTION admin_private.capture_action()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a record; old_json jsonb; new_json jsonb; b jsonb; n jsonb; pid uuid; rid text; fields text[];
begin
  select * into a from approval_private.actor();
  if a.role is distinct from 'superadmin' then return null; end if;
  if tg_op <> 'INSERT' then old_json:=to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_json:=to_jsonb(new); end if;
  pid:=nullif(coalesce(new_json,old_json)->>'project_id','')::uuid;
  if tg_table_name='projects' then pid:=(coalesce(new_json,old_json)->>'id')::uuid; end if;
  rid:=coalesce(new_json,old_json)->>'id';
  b:=admin_private.audit_value(tg_table_name,old_json);
  n:=admin_private.audit_value(tg_table_name,new_json);
  if tg_table_name='project_settings' then
    if b is not null then b:=b||jsonb_build_object('settings',coalesce((select jsonb_object_agg(k,v) from jsonb_each(coalesce(old_json->'settings','{}')) e(k,v) where k=any(array['branches','branch_channels','expenses_scope','transaction_types','modules'])),'{}')); end if;
    if n is not null then n:=n||jsonb_build_object('settings',coalesce((select jsonb_object_agg(k,v) from jsonb_each(coalesce(new_json->'settings','{}')) e(k,v) where k=any(array['branches','branch_channels','expenses_scope','transaction_types','modules'])),'{}')); end if;
  end if;
  -- Record that a file/reading changed, but never store its contents or URL.
  -- Login bookkeeping is not a business edit and must not create audit noise.
  select coalesce(array_agg(k order by k),'{}') into fields from (
    select jsonb_object_keys(coalesce(old_json,'{}')||coalesce(new_json,'{}')) k
  ) keys where old_json->k is distinct from new_json->k
    and k not in ('auth_id','pin','password','password_hash','token','updated_at')
    and (tg_table_name<>'app_users' or b ? k or n ? k);
  if tg_op='UPDATE' and cardinality(fields)=0 then return null; end if;
  insert into admin_private.action_log(project_id,actor_id,actor_name,actor_role,entity,row_id,action,before_value,after_value,changed_fields,reason)
  values(pid,a.id,a.name,a.role,tg_table_name,rid,tg_op,b,n,fields,nullif(current_setting('tahseeb.admin_reason',true),''));
  return null;
end $function$
;
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
end $function$
;
drop function if exists public.admin_bank_workflow_save(jsonb,jsonb);

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
end $function$
;
-- Retain bank_transfers, its pair guard and bank_transfer_manage after use.
-- This preserves the integrity of existing transfers. The previous UI cannot edit one leg.
-- Reapply the release to manage those transfers in the UI; no financial rows are deleted.
