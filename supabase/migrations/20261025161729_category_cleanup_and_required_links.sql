-- Current category review and explicit parent/child links. No automatic financial reclassification.
CREATE OR REPLACE FUNCTION approval_private.resolve_item_category(p_project uuid, p_cat_id text, p_sub_id text, p_main text, p_sub text, p_ledger_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare c public.categories; s public.categories; v uuid; n int;
begin
  if nullif(btrim(coalesce(p_cat_id, '')), '') is not null then
    begin v := p_cat_id::uuid; exception when invalid_text_representation then return jsonb_build_object('code', 'category_invalid'); end;
    select * into c from public.categories where id = v and project_id = p_project;
    if c.id is null then return jsonb_build_object('code', 'category_invalid'); end if;
    if c.parent_id is not null then s := c; select * into c from public.categories where id = s.parent_id; end if;
  end if;
  if nullif(btrim(coalesce(p_sub_id, '')), '') is not null then
    begin v := p_sub_id::uuid; exception when invalid_text_representation then return jsonb_build_object('code', 'subcategory_invalid'); end;
    if s.id is null or s.id <> v then
      select * into s from public.categories where id = v and project_id = p_project and parent_id is not null;
      if s.id is null then return jsonb_build_object('code', 'subcategory_invalid'); end if;
    end if;
    if c.id is not null and s.parent_id <> c.id then
      return jsonb_build_object('code', 'subcategory_mismatch', 'name', s.name, 'parent', c.name);
    end if;
    if c.id is null then select * into c from public.categories where id = s.parent_id; end if;
  end if;
  if c.id is null and nullif(approval_private.norm_cat(p_main), '') is not null then
    select count(*) into n from public.categories where project_id = p_project and parent_id is null
       and approval_private.norm_cat(name) = approval_private.norm_cat(p_main);
    if n > 1 then return jsonb_build_object('code', 'category_ambiguous', 'name', p_main); end if;
    if n = 1 then
      select * into c from public.categories where project_id = p_project and parent_id is null
         and approval_private.norm_cat(name) = approval_private.norm_cat(p_main);
    end if;
  end if;
  if s.id is null and nullif(approval_private.norm_cat(p_sub), '') is not null then
    if c.id is not null then
      select count(*) into n from public.categories where parent_id = c.id and approval_private.norm_cat(name) = approval_private.norm_cat(p_sub);
      if n > 1 then return jsonb_build_object('code', 'category_ambiguous', 'name', p_sub, 'parent', c.name); end if;
      if n = 1 then select * into s from public.categories where parent_id = c.id and approval_private.norm_cat(name) = approval_private.norm_cat(p_sub); end if;
    else
      select count(*) into n from public.categories where project_id = p_project and parent_id is not null
         and approval_private.norm_cat(name) = approval_private.norm_cat(p_sub);
      if n > 1 then return jsonb_build_object('code', 'category_ambiguous', 'name', p_sub, 'needs_main', true); end if;
      if n = 1 then
        select * into s from public.categories where project_id = p_project and parent_id is not null
           and approval_private.norm_cat(name) = approval_private.norm_cat(p_sub);
        select * into c from public.categories where id = s.parent_id;
      end if;
    end if;
  end if;
  if c.id is null and nullif(p_ledger_type, '') is not null then
    select count(*) into n from public.categories where project_id = p_project and parent_id is null and ledger_type = p_ledger_type;
    if n = 1 then select * into c from public.categories where project_id = p_project and parent_id is null and ledger_type = p_ledger_type; end if;
  end if;
  if coalesce((select settings #>> '{category_policy,require_complete}' from public.project_settings where project_id=p_project),'false')='true' then
    if c.id is null then return jsonb_build_object('code','category_required'); end if;
    if s.id is null and exists(select 1 from public.categories where project_id=p_project and parent_id=c.id and is_active) then
      return jsonb_build_object('code','subcategory_required','name',c.name);
    end if;
  end if;
  return jsonb_build_object('category_id', c.id, 'subcategory_id', s.id);
end $function$
;
-- Expense-only review computed from current rows, never from a historical cache.
create or replace function approval_private.category_review_rows(p_project uuid)
returns table(source text,row_id uuid,main text,sub text,status text,old_class text)
language sql stable set search_path='' as $$
 with expenses as (
  select e.*,coalesce(e.financial_class,case when e.type ~ '(تكلفة البضاعة|مشتريات قهوة|مواد تعبئة)' then 'cogs' else 'opex' end) as cls
  from public.ledger_entries e where e.project_id=p_project
   and e.type !~ '(مبيعات|تحصيل|تحويل|عهدة|إيداع|مسحوبات|قرض|قروض|قسط|ضريبة|سداد مورد)'
   and e.type ~ '(مصروف|تكلفة|مشتريات|أصول|تجهيزات|صيانة|الصيانة)'
 ), item_candidates as (
  select i.*,c.id cid,c.financial_class,s.id sid,l.cls
  from public.document_items i
  left join public.categories c on c.id=i.category_id and c.project_id=p_project and c.parent_id is null
  left join public.categories s on s.id=i.subcategory_id and s.project_id=p_project and s.parent_id=c.id
  join lateral (select min(e.cls) cls from expenses e where
    (i.ledger_entry_id is not null and e.id=i.ledger_entry_id) or
    (i.ledger_entry_id is null and e.journal_number=i.journal_number and (e.document_id is null or e.document_id=i.document_id))
    having count(*)>0 and min(e.cls)=max(e.cls)) l on true
  where i.project_id=p_project
 ), problems as (
  select 'item'::text source,i.id row_id,approval_private.norm_cat(i.category_main) main,approval_private.norm_cat(i.category_sub) sub,
   case when i.cid is null then 'unmatched_main'
    when (i.financial_class='cogs') is distinct from (i.cls='cogs') then 'financial_review'
    when nullif(approval_private.norm_cat(i.category_sub),'') is null then 'missing_sub' else 'unmatched_sub' end status,i.cls old_class
  from item_candidates i where i.cid is null or (i.financial_class='cogs') is distinct from (i.cls='cogs')
   or (i.sid is null and (nullif(approval_private.norm_cat(i.category_sub),'') is not null or exists(select 1 from public.categories c where c.parent_id=i.cid and c.is_active)))
  union all
  select 'ledger',e.id,approval_private.norm_cat(coalesce(nullif(e.category_main,''),e.type)),approval_private.norm_cat(e.category_sub),
   case when c.id is null then 'unmatched_main' when (c.financial_class='cogs') is distinct from (e.cls='cogs') then 'financial_review' else 'missing_sub' end,e.cls
  from expenses e left join public.categories c on c.id=e.category_id and c.project_id=p_project and c.parent_id is null
  where c.id is null or (c.financial_class='cogs') is distinct from (e.cls='cogs') or
   (not exists(select 1 from public.document_items i where i.project_id=p_project and
      (i.ledger_entry_id=e.id or (i.ledger_entry_id is null and i.journal_number=e.journal_number and (e.document_id is null or e.document_id=i.document_id))))
    and exists(select 1 from public.categories s where s.parent_id=c.id and s.is_active)
    and not exists(select 1 from public.categories s where s.parent_id=c.id and approval_private.norm_cat(s.name)=approval_private.norm_cat(e.category_sub)))
 ) select * from problems;
$$;
revoke all on function approval_private.category_review_rows(uuid) from public,anon,authenticated;

create or replace function public.category_link_legacy(p_main text,p_sub text,p_category uuid,p_subcategory uuid,p_reason text default null,p_fingerprint text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a record; denied jsonb;c public.categories;s public.categories; rows_json jsonb;fp text;n int;bad int;before_money text;after_money text;
begin
 select * into a from approval_private.actor();denied:=approval_private.category_denied(a.id,a.role,a.project_id);
 if denied is not null then return denied;end if;
 perform pg_advisory_xact_lock(hashtextextended('categories:'||a.project_id::text,0));
 select * into c from public.categories where project_id=a.project_id and id=p_category and parent_id is null and is_active for share;
 if c.id is null then return approval_private.err('category_invalid');end if;
 select * into s from public.categories where project_id=a.project_id and id=p_subcategory and parent_id=c.id and is_active for share;
 if s.id is null then return approval_private.err('subcategory_invalid');end if;
 -- Lock affected rows before reading the preview fingerprint; a stale screen never remaps newly changed rows.
 perform 1 from public.document_items i where i.project_id=a.project_id and i.id in(select row_id from approval_private.category_review_rows(a.project_id) where source='item' and main=approval_private.norm_cat(p_main) and sub=approval_private.norm_cat(p_sub)) for update;
 perform 1 from public.ledger_entries e where e.project_id=a.project_id and e.id in(select row_id from approval_private.category_review_rows(a.project_id) where source='ledger' and main=approval_private.norm_cat(p_main) and sub=approval_private.norm_cat(p_sub)) for update;
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('before',case when r.source='item' then (select to_jsonb(i) from public.document_items i where i.id=r.row_id) else (select to_jsonb(e) from public.ledger_entries e where e.id=r.row_id) end) order by source,row_id),'[]'),count(*),count(*) filter(where (r.old_class='cogs') is distinct from (c.financial_class='cogs'))
 into rows_json,n,bad from approval_private.category_review_rows(a.project_id) r where r.main=approval_private.norm_cat(p_main) and r.sub=approval_private.norm_cat(p_sub);
 if n=0 then return approval_private.err('no_change');end if;
 fp:=md5(rows_json::text||to_jsonb(c)::text||to_jsonb(s)::text);
 if bad>0 then return approval_private.err('financial_review_required',jsonb_build_object('rows',bad));end if;
 if p_fingerprint is null then return jsonb_build_object('ok',true,'preview',true,'fingerprint',fp,'rows',n,'items',(select count(*) from jsonb_array_elements(rows_json) r where r->>'source'='item'),'entries',(select count(*) from jsonb_array_elements(rows_json) r where r->>'source'='ledger'),'examples',(select jsonb_agg(x) from (select jsonb_build_object('description',r#>>'{before,description}','journal',r#>>'{before,journal_number}') x from jsonb_array_elements(rows_json) r limit 10) q));end if;
 if fp<>p_fingerprint then return approval_private.err('stale');end if;
 if length(btrim(coalesce(p_reason,'')))<5 then return approval_private.err('reason_required');end if;
 select md5(coalesce(string_agg((to_jsonb(e)-'category_id'-'category_main'-'category_sub')::text,'' order by id),'')) into before_money from public.ledger_entries e where project_id=a.project_id;
 update public.document_items i set category_id=c.id,subcategory_id=s.id where i.project_id=a.project_id and i.id in(select (r->>'row_id')::uuid from jsonb_array_elements(rows_json) r where r->>'source'='item');
 update public.ledger_entries e set category_id=c.id,category_sub=s.name where e.project_id=a.project_id and e.id in(select (r->>'row_id')::uuid from jsonb_array_elements(rows_json) r where r->>'source'='ledger');
 select md5(coalesce(string_agg((to_jsonb(e)-'category_id'-'category_main'-'category_sub')::text,'' order by id),'')) into after_money from public.ledger_entries e where project_id=a.project_id;
 if before_money<>after_money then raise exception 'category linking changed financial fields';end if;
 perform approval_private.log_category(a.project_id,c.id,'link',jsonb_build_object('rows',rows_json),jsonb_build_object('category_id',c.id,'subcategory_id',s.id,'name',c.name||' / '||s.name,'reason',p_reason,'rows',n),a.id,a.name,a.role);
 return jsonb_build_object('ok',true,'rows',n);
end $$;
revoke all on function public.category_link_legacy(text,text,uuid,uuid,text,text) from public,anon;
grant execute on function public.category_link_legacy(text,text,uuid,uuid,text,text) to authenticated;

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
    'review', coalesce((select jsonb_agg(to_jsonb(r) order by r.status,r.main,r.sub) from
      (select source,main,sub,status,count(*)::int rows from approval_private.category_review_rows(a.project_id) group by source,main,sub,status) r),'[]'::jsonb),
    'changes', coalesce((
      select jsonb_agg(x order by x ->> 'at' desc) from (
        select jsonb_build_object('at', l.created_at, 'action', l.action, 'category_id', l.category_id, 'before', l.before, 'after', l.after,
                                  'by', l.actor_name) as x
          from approval_private.category_changes l where l.project_id = a.project_id order by l.created_at desc, l.id desc limit 20) t), '[]'::jsonb));
end $function$
;

alter table approval_private.category_changes drop constraint category_changes_action_check;
alter table approval_private.category_changes add constraint category_changes_action_check check(action in('create','rename','set_class','disable','enable','move','link'));

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
    v_vats := approval_private.allocate(v_after, v_vat);
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
