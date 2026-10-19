-- Run in one transaction. Retains the append-only admin audit and all business rows.
-- Session revocation is unchanged; only admin controls and branch rename exceptions are rolled back.
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

  -- آخر مالك نشط: لا يُعطَّل ولا يُحذف ولا يُحوَّل
  if p_action in ('update', 'deactivate', 'remove') then
    if t.role = 'owner' and t.is_active and (p_action <> 'update' or p_role <> 'owner')
       and not exists (select 1 from public.app_users u where u.project_id = v_project and u.role = 'owner' and u.is_active and u.id <> t.id) then
      return approval_private.err('last_owner');
    end if;
  end if;

  -- الحد نفسه لعمليات فحص الرموز في المنشأة (يشترك فيه مسار المالك وإضافة المدير)
  if p_action in ('create', 'set_pin') then
    if p_pin is null or p_pin !~ '^[0-9]{5}$' then return approval_private.err('invalid_pin'); end if;
    k_h := 'staff:tenant:h:' || v_project; k_d := 'staff:tenant:d:' || v_project;
    if auth_private.peek(k_h, interval '1 hour') >= 10 then v_until := auth_private.window_end(k_h, interval '1 hour'); end if;
    if auth_private.peek(k_d, interval '24 hours') >= 30 then v_until := greatest(v_until, auth_private.window_end(k_d, interval '24 hours')); end if;
    if v_until is not null then return jsonb_build_object('ok', false, 'code', 'try_later', 'retry_after', auth_private.seconds_until(v_until)); end if;
    perform auth_private.bump(k_h, interval '1 hour');
    perform auth_private.bump(k_d, interval '24 hours');
  end if;

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

CREATE OR REPLACE FUNCTION approval_private.ledger_bank_account_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION approval_private.ledger_branch_channel_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_ch text := approval_private.channel_of_type(new.type);
begin
  if v_ch is not null and new.branch is not null and coalesce(new.total_amount, 0) >= 0
     and (tg_op = 'INSERT' or new.type is distinct from old.type or new.branch is distinct from old.branch)
     and not approval_private.channel_enabled(new.project_id, new.branch, v_ch) then
    raise exception '«%» غير مفعّل في «%». القنوات المفعلة لكل فرع من إعداد المنشأة.', approval_private.channel_label(v_ch), new.branch
      using errcode = 'P0001', hint = 'channel_not_enabled_for_branch';
  end if;
  return new;
end $function$;

drop function public.admin_business_write(text,text,uuid,jsonb);
drop function public.admin_business_settings();
