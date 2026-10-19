-- Platform administration: complete workspace access with the real actor retained.
-- No customer rows, credentials or project-specific activation is part of this migration.
CREATE OR REPLACE FUNCTION staff_private.admin_write_user(p_action text, p_project_id uuid, p_user_id uuid, p_name text, p_role text, p_branch text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a record; me record; t record; v_project uuid; v_name text := btrim(coalesce(p_name, '')); v_branch text := nullif(btrim(coalesce(p_branch, '')), '');
        v_branches jsonb; k_h text; k_d text; v_until timestamptz; v_id uuid; v_res jsonb; v_refs jsonb; v_auth uuid; v_rules boolean := p_action = 'create';
        role_ar constant jsonb := '{"owner": "المالك", "accountant": "المحاسب", "purchasing": "المشتريات", "cashier": "الكاشير"}';
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role is distinct from 'superadmin' then return approval_private.err('forbidden'); end if;
  if p_action is null or p_action not in ('create', 'update', 'set_pin', 'deactivate', 'reactivate', 'remove') then return approval_private.err('invalid'); end if;

  -- المنشأة: من المستخدم المستهدف (لا من الطلب) في كل ما عدا الإضافة
  if p_action = 'create' then
    v_project := p_project_id;
    if v_project is null or not exists (select 1 from public.projects where id = v_project) then return approval_private.err('not_found'); end if;
  else
    select u.project_id into v_project from public.app_users u where u.id = p_user_id;
    if v_project is null then return approval_private.err('not_found'); end if;
  end if;

  -- ترتيب الأقفال نفسه في المسارات الأخرى: تسلسل عمليات الموظفين داخل المنشأة
  perform 1 from public.app_users where project_id = v_project order by id for update;
  select u.auth_id, u.role, u.is_active, u.name into me from public.app_users u where u.id = a.id;
  if not found or me.auth_id is distinct from auth.uid() or not me.is_active or me.role is distinct from 'superadmin' then
    return approval_private.err('no_session');
  end if;
  if p_action <> 'create' then
    select u.id, u.project_id, u.name, u.role, u.branch, u.is_active, u.created_at into t from public.app_users u where u.id = p_user_id;
    if not found or t.project_id is distinct from v_project or t.role = 'superadmin' then return approval_private.err('not_found'); end if;
  end if;

  -- الاسم والدور والفرع (الإضافة والتعديل)
  if p_action in ('create', 'update') then
    if v_name = '' or length(v_name) > 200 then return approval_private.err('invalid_name'); end if;
    -- طلب صفة مدير المنصة مرفوض بالرمز نفسه في admin_create_user السابقة (forbidden)
    if p_role = 'superadmin' then return approval_private.err('forbidden'); end if;
    if p_role is null or p_role not in ('owner', 'accountant', 'purchasing', 'cashier') then return approval_private.err('invalid_role'); end if;
  end if;
  -- قواعد الدور والفرع عند الإضافة، وعند التعديل إن تغيّر الدور أو الفرع (فرع قديم محفوظ قبل قائمة الفروع يبقى كما هو عند تعديل الاسم وحده)
  -- (t لا يُقرأ عند الإضافة: لا مستخدم مستهدف بعد)
  if p_action = 'update' then v_rules := p_role is distinct from t.role or v_branch is distinct from t.branch; end if;
  if v_rules then
    select ps.settings -> 'branches' into v_branches from public.project_settings ps where ps.project_id = v_project;
    if v_branch is not null and (jsonb_typeof(v_branches) is distinct from 'array' or not (v_branches ? v_branch)) then return approval_private.err('invalid_branch'); end if;
    if p_role = 'owner' and v_branch is not null then return approval_private.err('owner_all_branches'); end if;
    if p_role = 'cashier' and v_branch is null and jsonb_typeof(v_branches) = 'array' and jsonb_array_length(v_branches) > 0 then
      return approval_private.err('branch_required');
    end if;
  end if;

  -- Platform administration is not subject to tenant staff quotas or the last-owner rule.
  -- PIN format, uniqueness, real actor checks and session revocation remain enforced below.
  if p_action = 'create' then
    insert into public.app_users (project_id, name, role, branch) values (v_project, v_name, p_role, v_branch) returning id into v_id;
    v_res := staff_private.set_pin_admin(v_id, p_pin);
    if not coalesce((v_res ->> 'ok')::boolean, false) then raise exception using errcode = 'P0001', message = coalesce(v_res ->> 'code', 'save_failed'); end if;
    insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason, actor_id, actor_name, actor_role)
    values (v_project, v_id, v_name, p_role, 'create', 'مدير المنصة: ' || coalesce(v_branch, 'كل الفروع'), a.id, me.name, 'superadmin');
    return jsonb_build_object('ok', true, 'id', v_id);

  elsif p_action = 'update' then
    if t.name = v_name and t.role = p_role and t.branch is not distinct from v_branch then return jsonb_build_object('ok', true, 'id', t.id, 'unchanged', true); end if;
    update public.app_users set name = v_name, role = p_role, branch = v_branch where id = t.id;
    insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason, actor_id, actor_name, actor_role)
    values (v_project, t.id, v_name, p_role, 'set_access',
            format('مدير المنصة: %s، %s، %s ← %s، %s، %s', t.name, coalesce(role_ar ->> t.role, t.role), coalesce(t.branch, 'كل الفروع'),
                   v_name, coalesce(role_ar ->> p_role, p_role), coalesce(v_branch, 'كل الفروع')), a.id, me.name, 'superadmin');
    return jsonb_build_object('ok', true, 'id', t.id);

  elsif p_action = 'set_pin' then
    v_res := staff_private.set_pin_admin(t.id, p_pin);
    if not coalesce((v_res ->> 'ok')::boolean, false) then return v_res; end if;
    -- الجلسات أُلغيت بمشغّل pin_change_revokes_sessions
    insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason, actor_id, actor_name, actor_role)
    values (v_project, t.id, t.name, t.role, 'set_pin', 'مدير المنصة: رمز جديد وإلغاء الجلسات', a.id, me.name, 'superadmin');
    return jsonb_build_object('ok', true, 'id', t.id, 'sessions', 'revoked');

  elsif p_action = 'deactivate' then
    if not t.is_active then return jsonb_build_object('ok', true, 'id', t.id, 'unchanged', true); end if;
    update public.app_users set is_active = false, deactivated_at = now(), deactivated_by = a.id where id = t.id;   -- يلغي الجلسات (المشغّل)
    insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason, actor_id, actor_name, actor_role)
    values (v_project, t.id, t.name, t.role, 'deactivate', 'مدير المنصة', a.id, me.name, 'superadmin');
    return jsonb_build_object('ok', true, 'id', t.id, 'sessions', 'revoked');

  elsif p_action = 'reactivate' then
    if t.is_active then return jsonb_build_object('ok', true, 'id', t.id, 'unchanged', true); end if;
    update public.app_users set is_active = true, deactivated_at = null, deactivated_by = null where id = t.id;
    insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason, actor_id, actor_name, actor_role)
    values (v_project, t.id, t.name, t.role, 'reactivate', 'مدير المنصة', a.id, me.name, 'superadmin');
    return jsonb_build_object('ok', true, 'id', t.id);

  else -- remove: حذف إن لم تكن له عمليات ولا ارتباطات، وإلا أرشفة
    v_refs := staff_private.user_references(t.id);
    if v_refs = '{}'::jsonb then
      select u.auth_id into v_auth from public.app_users u where u.id = t.id;
      delete from public.app_users where id = t.id;   -- يحذف معه رمزه المخزن (pin_credentials)، والمشغّل يلغي جلساته
      -- حساب الدخول الاصطناعي لهذا الصف وحده (لا حساب بريد حقيقي) لا حاجة له بعد الحذف
      delete from auth.users where id = v_auth and email like 'u-%@pin.internal.tahseeb.app';
      insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason, actor_id, actor_name, actor_role)
      values (v_project, t.id, t.name, t.role, 'delete', format('مدير المنصة: حساب بلا عمليات (أُنشئ %s)', to_char(t.created_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI')),
              a.id, me.name, 'superadmin');
      return jsonb_build_object('ok', true, 'id', t.id, 'result', 'deleted');
    end if;
    update public.app_users set is_active = false, deactivated_at = coalesce(deactivated_at, now()), deactivated_by = coalesce(deactivated_by, a.id) where id = t.id;
    insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason, actor_id, actor_name, actor_role)
    values (v_project, t.id, t.name, t.role, 'archive', 'مدير المنصة: له عمليات مسجلة (' || (select string_agg(k, '، ' order by k) from jsonb_object_keys(v_refs) k) || ')',
            a.id, me.name, 'superadmin');
    return jsonb_build_object('ok', true, 'id', t.id, 'result', 'archived', 'references', v_refs);
  end if;
exception when others then
  if sqlerrm in ('pin_in_use', 'invalid_pin') then return approval_private.err(sqlerrm); end if;
  return jsonb_build_object('ok', false, 'code', 'save_failed');
end $function$;

create schema admin_private;
revoke all on schema admin_private from public, anon, authenticated;
grant usage on schema admin_private to authenticated;

create table admin_private.action_log (
  id bigint generated always as identity primary key,
  happened_at timestamptz not null default clock_timestamp(),
  project_id uuid,
  actor_id uuid not null,
  actor_name text not null,
  actor_role text not null check (actor_role = 'superadmin'),
  entity text not null,
  row_id text,
  action text not null,
  reason text,
  before_value jsonb,
  after_value jsonb,
  changed_fields text[] not null default '{}',
  transaction_id bigint not null default txid_current()
);
alter table admin_private.action_log enable row level security;
revoke all on admin_private.action_log from public, anon, authenticated;
create index on admin_private.action_log(project_id,id desc);

-- Internal branch renames may preserve inactive historical bank links. The only
-- allowed change is the branch name, in this admin transaction and this business.
create function admin_private.rename_only(p_old jsonb,p_new jsonb) returns boolean
language sql stable set search_path='' as $$
 select coalesce(current_user not in ('authenticated','anon') and public.auth_is_superadmin()
   and (p_old-'branch')=(p_new-'branch')
   and p_old->>'project_id'=public.auth_project_id()::text
   and p_old->>'project_id'=(nullif(current_setting('tahseeb.branch_rename',true),'')::jsonb->>'project')
   and p_old->>'branch'=(nullif(current_setting('tahseeb.branch_rename',true),'')::jsonb->>'old')
   and p_new->>'branch'=(nullif(current_setting('tahseeb.branch_rename',true),'')::jsonb->>'new'),false)
$$;
revoke all on function admin_private.rename_only(jsonb,jsonb) from public,anon;
grant execute on function admin_private.rename_only(jsonb,jsonb) to authenticated;

-- Allowlist snapshots: credentials, auth IDs, signed URLs, uploaded files and OCR
-- payloads never enter the audit trail. The actor always comes from the session.
create function admin_private.audit_value(p_table text,p_row jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select case when p_row is null then null else coalesce(jsonb_object_agg(k,v),'{}'::jsonb) end
  from jsonb_each(coalesce(p_row,'{}'::jsonb)) e(k,v)
  where k = any(case
    when p_table='app_users' then array['id','project_id','name','role','branch','is_active','deactivated_at']
    when p_table='documents' then array['id','project_id','status','branch','document_date','total_amount','uploaded_by_name']
    when p_table='project_settings' then array['project_id','active','modules']
    else array['id','project_id','name','phone','notes','note','is_active','active','status','branch','branches','bank','sort_order',
      'currency','subdomain','date','description','description_norm','type','category','subcategory','category_id','subcategory_id',
      'suggested_category_id','suggested_subcategory_id','financial_class','parent_id','journal_number','amount','original_amount',
      'start_date','opening_balance','cash_in','cash_out','bank_in','bank_out','bank_account_id','payable_in','payable_out',
      'custody_in','custody_out','receivable_in','receivable_out','vat_amount','total_amount','discount_amount',
      'line_discount','invoice_discount_share','amount_before_discount','invoice_number','category_main','category_sub',
      'cash_sales','network_sales','total_sales','hunger_sales','jahez_sales','keeta_sales',
      'effective_from','ratio','item_label','item_key',
      'network','cash','transfer','hunger','jahez','keeta','mrsool','total','supplier_id','document_id','file_name','uploaded_by',
      'created_by_user_id','created_by_name','created_by_role','updated_by','created_at','updated_at',
      'user_id','user_name','user_role','action','reason'] end)
$$;
revoke all on function admin_private.audit_value(text,jsonb) from public,anon,authenticated;

create function admin_private.capture_action() returns trigger
language plpgsql security definer set search_path='' as $$
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
end $$;

create trigger admin_action_audit after insert on approval_private.user_status_changes
for each row execute function admin_private.capture_action();
revoke all on function admin_private.capture_action() from public,anon,authenticated;

do $$ declare t text; begin
  foreach t in array array['projects','project_settings','app_users','documents','document_items','ledger_entries','sales',
    'attachments','suppliers','supplier_transactions','payable_suppliers','loans','branches','bank_accounts','categories','item_category_rules','analysis_targets'] loop
    execute format('create trigger admin_action_audit after insert or update or delete on public.%I for each row execute function admin_private.capture_action()',t);
  end loop;
end $$;

create function public.admin_action_history(p_before bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a record; result jsonb;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role<>'superadmin' or a.project_id is null then return approval_private.err('forbidden'); end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id desc),'[]') into result from (
    select * from admin_private.action_log where project_id=a.project_id and (p_before is null or id<p_before) order by id desc limit 50
  ) r;
  return jsonb_build_object('ok',true,'project_id',a.project_id,'events',result);
end $$;
revoke all on function public.admin_action_history(bigint) from public,anon;
grant execute on function public.admin_action_history(bigint) to authenticated;

create function public.admin_business_settings() returns jsonb
language plpgsql security definer set search_path='' as $$
declare a record;
begin
 select * into a from approval_private.actor();
 if a.id is null then return approval_private.err('no_session'); end if;
 if a.role<>'superadmin' or a.project_id is null then return approval_private.err('forbidden'); end if;
 return jsonb_build_object('ok',true,'project_id',a.project_id,
  'project',(select to_jsonb(p) from public.projects p where id=a.project_id),
  'settings',(select ps.settings from public.project_settings ps where project_id=a.project_id),
  'banks',(select coalesce(jsonb_agg(to_jsonb(b) order by sort_order,name),'[]') from public.bank_accounts b where project_id=a.project_id),
  'suppliers',(select coalesce(jsonb_agg(to_jsonb(s) order by name),'[]') from public.suppliers s where project_id=a.project_id),
  'payables',(select coalesce(jsonb_agg(to_jsonb(s) order by name),'[]') from public.payable_suppliers s where project_id=a.project_id),
  'rules',(select coalesce(jsonb_agg(to_jsonb(r) order by description),'[]') from public.item_category_rules r where project_id=a.project_id),
  'categories',(select coalesce(jsonb_agg(to_jsonb(c) order by sort_order,name),'[]') from public.categories c where project_id=a.project_id));
end $$;
revoke all on function public.admin_business_settings() from public,anon;
grant execute on function public.admin_business_settings() to authenticated;

-- Dedicated writes rather than exposing unrestricted table access to every signed-in user.
create function public.admin_business_write(p_entity text,p_action text,p_id uuid default null,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare a record; r record; ps jsonb; v_name text; v_id uuid; v_branches text[]; v_channels jsonb; v_old text;
 v_balance numeric; v_refs boolean; v_result text:='saved'; v_category uuid; v_sub uuid; v_status text;
begin
 select * into a from approval_private.actor();
 if a.id is null then return approval_private.err('no_session'); end if;
 if a.role<>'superadmin' or a.project_id is null then return approval_private.err('forbidden'); end if;
 if p_entity is null or p_entity not in ('supplier','payable','bank','branch','item','category','expenses_scope')
    or p_action is null or p_action not in ('save','remove') or jsonb_typeof(p_data) is distinct from 'object' then return approval_private.err('invalid'); end if;
 -- Serialize configuration changes without locking any other business.
 perform 1 from public.projects where id=a.project_id for update;
 if not found then return approval_private.err('not_found'); end if;
 select settings into ps from public.project_settings where project_id=a.project_id for update;
 ps:=coalesce(ps,'{}');
 perform set_config('tahseeb.admin_reason',coalesce(p_data->>'reason',''),true);
 v_name:=nullif(btrim(p_data->>'name'),'');
 if p_action='save' and p_entity in ('supplier','payable','bank','branch','item') and (v_name is null or length(v_name)>200) then return approval_private.err('invalid_name'); end if;

 if p_entity='supplier' then
  if p_id is not null then
   select * into r from public.suppliers where id=p_id and project_id=a.project_id for update;
   if not found then return approval_private.err('not_found'); end if;
  end if;
  if p_action='remove' then
   if p_id is null then return approval_private.err('not_found'); end if;
   select exists(select 1 from public.supplier_transactions where supplier_id=p_id) or coalesce(r.opening_balance,0)<>0 into v_refs;
   if v_refs then
    update public.suppliers set is_active=false where id=p_id; v_result:='archived';
   else delete from public.suppliers where id=p_id; v_result:='deleted'; end if;
   v_id:=p_id;
  else
   v_balance:=coalesce(nullif(p_data->>'opening_balance','')::numeric,0);
   if v_balance::text in ('NaN','Infinity','-Infinity') or v_balance<>round(v_balance,2) then return approval_private.err('amount_invalid'); end if;
   if p_id is not null then
    if v_balance is distinct from r.opening_balance and nullif(btrim(p_data->>'reason'),'') is null then return approval_private.err('reason_required'); end if;
    update public.suppliers set name=v_name,phone=nullif(btrim(p_data->>'phone'),''),notes=nullif(btrim(p_data->>'notes'),''),opening_balance=v_balance,
      is_active=coalesce((p_data->>'is_active')::boolean,true) where id=p_id returning id into v_id;
   else
    insert into public.suppliers(project_id,name,phone,notes,opening_balance) values(a.project_id,v_name,nullif(btrim(p_data->>'phone'),''),nullif(btrim(p_data->>'notes'),''),v_balance) returning id into v_id;
   end if;
  end if;
 elsif p_entity='payable' then
  select * into r from public.payable_suppliers where id=p_id and project_id=a.project_id for update;
  if not found then return approval_private.err('not_found'); end if;
  if p_action='remove' then
   if exists(select 1 from public.ledger_entries where supplier_id=p_id) then return approval_private.err('linked_records'); end if;
   delete from public.payable_suppliers where id=p_id;v_result:='deleted';
  else update public.payable_suppliers set name=v_name where id=p_id; end if;
  v_id:=p_id;
 elsif p_entity='bank' then
  if p_id is not null then
   select * into r from public.bank_accounts where id=p_id and project_id=a.project_id for update;
   if not found then return approval_private.err('not_found'); end if;
  end if;
  if p_action='remove' then
   if p_id is null then return approval_private.err('not_found'); end if;
   if exists(select 1 from public.ledger_entries where bank_account_id=p_id) then
    update public.bank_accounts set is_active=false where id=p_id;v_result:='archived';
   else delete from public.bank_accounts where id=p_id;v_result:='deleted';end if;
   v_id:=p_id;
  else
   if jsonb_typeof(p_data->'branches') is distinct from 'array' then return approval_private.err('invalid_branch');end if;
   select coalesce(array_agg(distinct value),'{}') into v_branches from jsonb_array_elements_text(p_data->'branches');
   if exists(select 1 from unnest(v_branches) b where not coalesce((ps->'branches')?b,false)) then return approval_private.err('invalid_branch');end if;
   if p_id is null then
    insert into public.bank_accounts(project_id,name,bank,branches,is_active) values(a.project_id,v_name,nullif(btrim(p_data->>'bank'),''),v_branches,coalesce((p_data->>'is_active')::boolean,true)) returning id into v_id;
   else
    update public.bank_accounts set name=v_name,bank=nullif(btrim(p_data->>'bank'),''),branches=v_branches,is_active=coalesce((p_data->>'is_active')::boolean,true) where id=p_id returning id into v_id;
   end if;
  end if;
 elsif p_entity='item' then
  if p_id is not null then
   select * into r from public.item_category_rules where id=p_id and project_id=a.project_id for update;
   if not found then return approval_private.err('not_found'); end if;
  end if;
  if p_action='remove' then
   if p_id is null then return approval_private.err('not_found');end if;
   delete from public.item_category_rules where id=p_id;v_id:=p_id;v_result:='deleted';
  else
   v_category:=nullif(p_data->>'category_id','')::uuid;v_sub:=nullif(p_data->>'subcategory_id','')::uuid;v_status:=coalesce(p_data->>'status','review');
   if v_status not in ('active','review') then return approval_private.err('invalid');end if;
   if v_status='active' then
    if not exists(select 1 from public.categories where id=v_category and project_id=a.project_id and parent_id is null and is_active) then return approval_private.err('category_invalid');end if;
    if v_sub is not null and not exists(select 1 from public.categories where id=v_sub and project_id=a.project_id and parent_id=v_category and is_active) then return approval_private.err('subcategory_invalid');end if;
   else v_category:=null;v_sub:=null;end if;
   if p_id is null then
    insert into public.item_category_rules(project_id,description,description_norm,status,category_id,subcategory_id,note,updated_by)
    values(a.project_id,v_name,approval_private.norm_item(v_name),v_status,v_category,v_sub,nullif(btrim(p_data->>'note'),''),a.id) returning id into v_id;
   else
    update public.item_category_rules set description=v_name,description_norm=approval_private.norm_item(v_name),status=v_status,category_id=v_category,subcategory_id=v_sub,
      note=nullif(btrim(p_data->>'note'),''),updated_at=now(),updated_by=a.id where id=p_id returning id into v_id;
   end if;
  end if;
 elsif p_entity='category' then
  if p_action<>'remove' then return approval_private.err('invalid');end if;
  select * into r from public.categories where id=p_id and project_id=a.project_id for update;
  if not found then return approval_private.err('not_found');end if;
  if exists(select 1 from public.categories where parent_id=p_id) or exists(select 1 from public.ledger_entries where category_id=p_id)
     or exists(select 1 from public.document_items where category_id=p_id or subcategory_id=p_id)
     or exists(select 1 from public.item_category_rules where category_id=p_id or subcategory_id=p_id or suggested_category_id=p_id or suggested_subcategory_id=p_id) then
   update public.categories set is_active=false where id=p_id;v_result:='archived';
  else delete from public.categories where id=p_id;v_result:='deleted';end if;
  v_id:=p_id;
 elsif p_entity='branch' then
  v_old:=nullif(btrim(p_data->>'old_name'),'');
  if v_old is not null and not coalesce((ps->'branches')?v_old,false) then return approval_private.err('not_found');end if;
  if p_action='remove' then
   if v_old is null then return approval_private.err('not_found');end if;
   -- Preserve financial history; users can reassign branch staff/accounts before removal.
   if exists(select 1 from public.app_users where project_id=a.project_id and branch=v_old and is_active)
     or exists(select 1 from public.bank_accounts where project_id=a.project_id and is_active and v_old=any(branches)) then return approval_private.err('branch_in_use');end if;
   ps:=jsonb_set(ps,'{branches}',coalesce((select jsonb_agg(x) from jsonb_array_elements_text(ps->'branches') x where x<>v_old),'[]'));
   ps:=jsonb_set(ps,'{branch_channels}',coalesce(ps->'branch_channels','{}')-v_old);
   update public.branches set active=false where project_id=a.project_id and name=v_old;
   v_result:='archived';
  else
   if coalesce((ps->'branches')?v_name,false) and v_name is distinct from v_old then return approval_private.err('duplicate');end if;
   v_channels:=p_data->'channels';
   if jsonb_typeof(v_channels) is distinct from 'array' or exists(select 1 from jsonb_array_elements_text(v_channels) c where c not in ('cash','network','transfer','hunger','jahez','keeta','mrsool')) then return approval_private.err('invalid_channels');end if;
   if v_old is not null and v_old<>v_name then
    -- Branch names are historical keys in the current data model; preserve old names in history.
    -- Rename all references together so no employee or account silently loses its branch.
    ps:=jsonb_set(ps,'{branches}',(select jsonb_agg(case when x=v_old then v_name else x end) from jsonb_array_elements_text(ps->'branches') x));
    ps:=jsonb_set(ps,'{branch_channels}',(coalesce(ps->'branch_channels','{}')-v_old)||jsonb_build_object(v_name,v_channels));
    update public.project_settings set settings=ps where project_id=a.project_id;
    perform set_config('tahseeb.branch_rename',jsonb_build_object('project',a.project_id,'old',v_old,'new',v_name)::text,true);
    update public.bank_accounts set branches=array_replace(branches,v_old,v_name) where project_id=a.project_id and v_old=any(branches);
    update public.app_users set branch=v_name where project_id=a.project_id and branch=v_old;
    update public.documents set branch=v_name where project_id=a.project_id and branch=v_old;
    update public.sales set branch=v_name where project_id=a.project_id and branch=v_old;
    update public.ledger_entries set branch=v_name where project_id=a.project_id and branch=v_old;
    update public.branches set name=v_name where project_id=a.project_id and name=v_old;
    update approval_private.sales_reports set branch_key=v_name where project_id=a.project_id and branch_key=v_old;
    update approval_private.sales_report_revisions set branch_key=v_name where project_id=a.project_id and branch_key=v_old;
    update approval_private.legacy_sales_links set branch=v_name where project_id=a.project_id and branch=v_old;
    perform set_config('tahseeb.branch_rename','',true);
   elsif v_old is null then
    ps:=jsonb_set(ps,'{branches}',coalesce(ps->'branches','[]')||jsonb_build_array(v_name));
   end if;
   ps:=jsonb_set(ps,'{branch_channels}',coalesce(ps->'branch_channels','{}')||jsonb_build_object(v_name,v_channels));
  end if;
  insert into public.project_settings(project_id,settings) values(a.project_id,ps) on conflict(project_id) do update set settings=excluded.settings;
 elsif p_entity='expenses_scope' then
  if p_action<>'save' or p_data->>'value' is null or p_data->>'value' not in ('project','branch') then return approval_private.err('invalid');end if;
  ps:=jsonb_set(ps,'{expenses_scope}',to_jsonb(p_data->>'value'));
  insert into public.project_settings(project_id,settings) values(a.project_id,ps) on conflict(project_id) do update set settings=excluded.settings;
 end if;
 return jsonb_build_object('ok',true,'id',v_id,'result',v_result);
exception
 when unique_violation then return approval_private.err('duplicate');
 when foreign_key_violation then return approval_private.err('linked_records');
 when invalid_text_representation or numeric_value_out_of_range or check_violation then return approval_private.err('invalid');
end $$;
revoke all on function public.admin_business_write(text,text,uuid,jsonb) from public,anon;
grant execute on function public.admin_business_write(text,text,uuid,jsonb) to authenticated;

CREATE OR REPLACE FUNCTION approval_private.ledger_bank_account_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_has boolean; v_ok boolean; v_one uuid; v_n int;
begin
  if tg_op = 'UPDATE' and admin_private.rename_only(to_jsonb(old),to_jsonb(new)) then return new; end if;
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
end $function$;
CREATE OR REPLACE FUNCTION approval_private.ledger_branch_channel_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_ch text := approval_private.channel_of_type(new.type);
begin
  if tg_op = 'UPDATE' and admin_private.rename_only(to_jsonb(old),to_jsonb(new)) then return new; end if;
  if v_ch is not null and new.branch is not null and coalesce(new.total_amount, 0) >= 0
     and (tg_op = 'INSERT' or new.type is distinct from old.type or new.branch is distinct from old.branch)
     and not approval_private.channel_enabled(new.project_id, new.branch, v_ch) then
    raise exception '«%» غير مفعّل في «%». القنوات المفعلة لكل فرع من إعداد المنشأة.', approval_private.channel_label(v_ch), new.branch
      using errcode = 'P0001', hint = 'channel_not_enabled_for_branch';
  end if;
  return new;
end $function$;


