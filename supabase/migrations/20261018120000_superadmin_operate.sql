-- تشغيل إدارة تحسيب (مدير المنصة النشط) داخل المنشأة التي يختارها، كاملًا وباسمه — بطلب المالك 2026-10-18.
-- المنشأة المختارة تصل مع كل طلب في x-tahseeb-view-project (كما في العرض 20261009150000)، ولا تمنح شيئًا وحدها: auth_view_project_id
-- يقبلها لمدير منصة نشط بجلسة صالحة فقط. الآن تصير منشأة عمله:
--   • auth_project_id() وapproval_private.actor().project_id لمدير المنصة = المنشأة المختارة (ولغيره كما كانت)، فتعمل سياسات الكتابة
--     الموجودة له أصلًا (auth_is_superadmin() أو المحاسب) ودوال الإجراءات بقواعدها كما هي داخل تلك المنشأة وحدها.
--   • الإجراءات المقصورة على المحاسب أو المالك تقبله أيضًا: الاعتماد والرفض والتصحيح (can_approve)، والتصنيفات (category_denied)،
--     وسداد الموردين وحذفه، وسجل تقارير المبيعات، وقاموس الأصناف، وأهداف التحليل.
--   • ترقيم القيود وتصنيف شراء القيد: لم يعد مدير المنصة مستثنى من مطابقة المنشأة؛ تُشترط منشأته المختارة.
-- النسبة: كل كتابة تُسجَّل بحسابه الحقيقي (المشغّل fill_audit_fields والسجلات من actor()): معرّفه واسمه ودوره superadmin، لا باسم أحد في المنشأة.
-- القواعد (التحقق والتكرار والتاريخ المالي والعزل) كما هي: الدوال نفسها بشروطها، وكل سجل يُطابق منشأته منشأة المنفّذ.
-- مولّد من نصوص الإنتاج الحالية (gen-operate.mjs)؛ الرجوع في supabase/rollback/20261018 بالنصوص الأصلية حرفيًا.

-- approval_private.can_approve(text,uuid)
CREATE OR REPLACE FUNCTION approval_private.can_approve(p_role text, p_project uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p_role in ('accountant', 'superadmin')
     and p_project is not null
     and coalesce((select ps.active from public.project_settings ps where ps.project_id = p_project), true)
$function$;

-- approval_private.category_denied(uuid,text,uuid)
CREATE OR REPLACE FUNCTION approval_private.category_denied(p_id uuid, p_role text, p_project uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when p_id is null then approval_private.err('no_session')
    when p_role not in ('owner', 'superadmin') or p_project is null then approval_private.err('forbidden')
    when not coalesce((select ps.active from public.project_settings ps where ps.project_id = p_project), true) then approval_private.err('project_inactive')
    when approval_private.mode_of(p_project) = 'legacy' then approval_private.err('approval_v2_required')
  end
$function$;

-- public.analysis_access(uuid)
CREATE OR REPLACE FUNCTION public.analysis_access(p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a record;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if p_project_id is null then return approval_private.err('bad_request'); end if;
  if a.role = 'superadmin' then
    if not exists (select 1 from public.projects where id = p_project_id) then return approval_private.err('not_found'); end if;
    -- الترويسة نفسها يجب أن تصل إلى سياسات القراءة، وإلا عادت الأرقام أصفارًا مضللة
    if public.auth_view_project_id() is distinct from p_project_id then return approval_private.err('view_not_applied'); end if;
    -- منشأة موقوفة: اطّلاع فقط كما كان (analysis_target_set يرفضها لكل الأدوار)
    return jsonb_build_object('ok', true, 'role', 'superadmin', 'can_set_targets', coalesce((select ps.active from public.project_settings ps where ps.project_id = p_project_id), true), 'read_only', not coalesce((select ps.active from public.project_settings ps where ps.project_id = p_project_id), true));
  end if;
  if a.role is distinct from 'owner' and a.role is distinct from 'accountant' then return approval_private.err('forbidden'); end if;
  if a.project_id is distinct from p_project_id then return approval_private.err('forbidden'); end if;
  if not coalesce((select ps.active from public.project_settings ps where ps.project_id = p_project_id), true) then
    return approval_private.err('project_inactive');
  end if;
  return jsonb_build_object('ok', true, 'role', a.role, 'can_set_targets', a.role = 'owner', 'read_only', false);
end $function$;

-- public.analysis_target_set(text,text,text,numeric,date,boolean)
CREATE OR REPLACE FUNCTION public.analysis_target_set(p_item_key text, p_item_label text, p_branch text, p_ratio numeric, p_effective_from date, p_active boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a record; v_row public.analysis_targets;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role not in ('owner', 'superadmin') or a.project_id is null then return approval_private.err('forbidden'); end if;
  if not coalesce((select ps.active from public.project_settings ps where ps.project_id = a.project_id), true) then
    return approval_private.err('project_inactive');
  end if;
  if p_item_key is null or length(btrim(p_item_key)) not between 1 and 200
     or p_item_label is null or length(btrim(p_item_label)) not between 1 and 200
     or p_active is null
     or (p_branch is not null and length(btrim(p_branch)) not between 1 and 100) then
    return approval_private.err('bad_request');
  end if;
  if p_effective_from is null then return approval_private.err('date_required'); end if;
  if p_active and (p_ratio is null or p_ratio < 0 or p_ratio > 1000) then return approval_private.err('ratio_invalid'); end if;
  insert into public.analysis_targets (project_id, item_key, item_label, branch, ratio, active, effective_from, created_by)
  values (a.project_id, p_item_key, btrim(p_item_label), btrim(p_branch), case when p_active then round(p_ratio, 2) end, p_active,
          p_effective_from, a.id)
  returning * into v_row;
  return jsonb_build_object('ok', true, 'target', to_jsonb(v_row));
end $function$;

-- public.category_settings()
CREATE OR REPLACE FUNCTION public.category_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a record; e jsonb;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role not in ('owner', 'superadmin') or a.project_id is null then return approval_private.err('forbidden'); end if;
  e := approval_private.category_denied(a.id, a.role, a.project_id);
  return jsonb_build_object('ok', true, 'can_edit', e is null, 'blocked', e ->> 'code', 'mode', approval_private.mode_of(a.project_id),
    'categories', coalesce((
      select jsonb_agg(approval_private.category_json(c) || jsonb_build_object('usage', u.usage)
                       order by (c.parent_id is not null), coalesce(c.sort_order, 2147483647), c.name)
        from public.categories c,
             lateral (select jsonb_build_object(
               'entries', (select count(*) from public.ledger_entries le where le.project_id = c.project_id and le.category_id = c.id),
               'items', (select count(*) from public.document_items di where di.project_id = c.project_id and (di.category_id = c.id or di.subcategory_id = c.id))) as usage) u
       where c.project_id = a.project_id), '[]'::jsonb),
    'review', coalesce((
      select jsonb_agg(jsonb_build_object('source', r.source, 'main', r.stored_main, 'sub', r.stored_sub, 'status', r.status, 'rows', r.rows_count)
                       order by r.status, r.stored_main)
        from approval_private.category_link_review r where r.project_id = a.project_id), '[]'::jsonb),
    'changes', coalesce((
      select jsonb_agg(x order by x ->> 'at' desc) from (
        select jsonb_build_object('at', l.created_at, 'action', l.action, 'category_id', l.category_id, 'before', l.before, 'after', l.after,
                                  'by', l.actor_name) as x
          from approval_private.category_changes l where l.project_id = a.project_id order by l.created_at desc, l.id desc limit 20) t), '[]'::jsonb));
end $function$;

-- public.item_rule_set(uuid,uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.item_rule_set(p_rule_id uuid, p_category_id uuid, p_subcategory_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a record; r record; c record; s record;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role not in ('owner', 'superadmin') or a.project_id is null then return approval_private.err('forbidden'); end if;
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
end $function$;

-- public.approval_sales_report_history(date,text)
CREATE OR REPLACE FUNCTION public.approval_sales_report_history(p_date date, p_branch text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a record; v_branches jsonb; v_branch text := nullif(btrim(coalesce(p_branch, '')), ''); v_key text; r record;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.project_id is null or a.role not in ('owner', 'accountant', 'superadmin') then return approval_private.err('forbidden'); end if;
  select settings -> 'branches' into v_branches from public.project_settings where project_id = a.project_id;
  v_key := case when jsonb_typeof(v_branches) = 'array' and jsonb_array_length(v_branches) > 0 then v_branch else coalesce(v_branch, '∅') end;
  select * into r from approval_private.sales_reports where project_id = a.project_id and branch_key = v_key and report_date = p_date;
  if not found then return approval_private.err('no_report'); end if;
  return jsonb_build_object('ok', true, 'report_date', r.report_date, 'branch', nullif(r.branch_key, '∅'),
    'journal_number', r.journal_number, 'current', r.current, 'revision', r.revision,
    'revisions', coalesce((
      select jsonb_agg(jsonb_build_object('at', v.created_at, 'previous', v.previous, 'corrected', v.corrected,
               'journal_number', v.journal_number, 'reason', v.reason, 'by', u.name) order by v.id)
        from approval_private.sales_report_revisions v left join public.app_users u on u.id = v.actor_id
       where v.project_id = r.project_id and v.branch_key = r.branch_key and v.report_date = r.report_date), '[]'::jsonb));
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

-- public.next_journal_number(uuid,date)
CREATE OR REPLACE FUNCTION public.next_journal_number(p_project_id uuid, p_date date)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- مدير المنصة أيضًا: المنشأة المختارة وحدها (لا ترقيم في منشأة أخرى من نموذج مفتوح قبل التبديل)
  if p_project_id is null or public.auth_project_id() is null or p_project_id <> public.auth_project_id() then
    raise exception 'forbidden: project mismatch';
  end if;
  return approval_private.next_journal(p_project_id, p_date);
end $function$;

-- public.set_entry_purchase_category(uuid,text)
CREATE OR REPLACE FUNCTION public.set_entry_purchase_category(entry_id uuid, category text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_project uuid;
begin
  select project_id into v_project from ledger_entries where id = entry_id;

  -- مدير المنصة أيضًا: قيد المنشأة المختارة وحدها
  if v_project is null
     or auth_project_id() is null
     or v_project <> auth_project_id()
     or auth_role() not in ('accountant', 'superadmin') then
    raise exception 'forbidden';
  end if;

  update ledger_entries set purchase_category = category where id = entry_id;
end $function$;

-- public.auth_project_id()
CREATE OR REPLACE FUNCTION public.auth_project_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select project_id from public.app_users where auth_id = auth.uid() and is_active and role <> 'superadmin' and public.auth_session_valid() limit 1),
    public.auth_view_project_id())
$function$;

-- approval_private.actor()
CREATE OR REPLACE FUNCTION approval_private.actor()
 RETURNS TABLE(id uuid, role text, project_id uuid, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select u.id, u.role, coalesce(u.project_id, case when u.role = 'superadmin' then public.auth_view_project_id() end), u.name
    from public.app_users u where u.auth_id = auth.uid() and u.is_active and public.auth_session_valid() limit 1
$function$;

-- عزل المنشآت في الكتابة: سياستا القروض والفروع كانتا تسمحان لمدير المنصة بالكتابة في أي منشأة (OR auth_is_superadmin()).
-- القراءة كما كانت؛ والكتابة لمنشأة العمل وحدها (منشأته المختارة لمدير المنصة)، فلا يكتب نموذج مفتوح قبل التبديل في منشأة أخرى.
drop policy loans_project_isolation on public.loans;
create policy loans_project_isolation on public.loans for select using ((project_id = public.auth_project_id()) or public.auth_is_superadmin());
create policy loans_project_write on public.loans for all using (project_id = public.auth_project_id()) with check (project_id = public.auth_project_id());
drop policy branches_project_isolation on public.branches;
create policy branches_project_isolation on public.branches for select using ((project_id = public.auth_project_id()) or public.auth_is_superadmin());
create policy branches_project_write on public.branches for all using (project_id = public.auth_project_id()) with check (project_id = public.auth_project_id());

-- الرفع باسم مدير المنصة: الحقل uploaded_by يقبل دوره (كان مقصورًا على أدوار المنشأة)
alter table public.documents drop constraint documents_uploaded_by_check;
alter table public.documents add constraint documents_uploaded_by_check check (uploaded_by = any (array['purchasing', 'accountant', 'cashier', 'owner', 'superadmin']));

notify pgrst, 'reload schema';
