-- بعد 20260930000300. لا يغيّر أي رمز أو بيانات موظف، ولا يوسّع سياسات الصفوف.
-- الحقول العامة تُقرأ صراحة؛ الإضافة وتعيين رمز جديد عبر RPC فقط.
begin;
set local lock_timeout = '5s';

revoke all on table public.app_users from public, anon, authenticated;
-- المنح على الأعمدة مستقلة عن منح الجدول؛ أزلها أيضًا إن أضيفت سابقًا.
do $$
declare cols text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into cols
    from pg_attribute where attrelid = 'public.app_users'::regclass and attnum > 0 and not attisdropped;
  execute format('revoke select (%s), insert (%s), update (%s), references (%s) on public.app_users from public, anon, authenticated',
    cols, cols, cols, cols);
end $$;
grant select (id, project_id, name, role, created_at, branch, auth_id, is_active, deactivated_at, deactivated_by)
  on public.app_users to authenticated;

create schema staff_private;
revoke all on schema staff_private from public, anon, authenticated;
grant usage on schema staff_private to authenticated;

-- لا تمرّر هوية المنفّذ أو منشأته أو صلاحياته من المتصفح. هذه الدالة تتحقق بنفسها
-- حتى لو نوديت مباشرة. المخطط غير مضاف إلى مخططات Data API.
create function staff_private.write_user(p_action text, p_user_id uuid, p_name text, p_role text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; me record; t record; v_id uuid;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role is distinct from 'accountant' or a.project_id is null then return approval_private.err('forbidden'); end if;
  if p_action is null or p_action not in ('create', 'set_pin') then return approval_private.err('invalid'); end if;
  -- 5 أرقام بالضبط: ما تقبله شاشة الدخول (رمز بطول آخر يُحفظ ولا يدخل به صاحبه أبدًا)
  if p_pin is null or p_pin !~ '^[0-9]{5}$' then return approval_private.err('invalid_pin'); end if;
  if p_action = 'create' then
    if p_name is null or btrim(p_name) = '' or length(btrim(p_name)) > 200 then return approval_private.err('invalid_name'); end if;
    if p_role is null or p_role not in ('accountant', 'purchasing', 'cashier') then return approval_private.err('forbidden'); end if;
  elsif p_user_id is null then
    return approval_private.err('invalid');
  end if;

  -- نفس ترتيب أقفال team_set_active: تسلسل الإضافة وتغيير الرمز والتعطيل داخل المنشأة.
  perform 1 from public.app_users where project_id = a.project_id order by id for update;
  select u.auth_id, u.role, u.project_id, u.is_active into me from public.app_users u where u.id = a.id;
  if not found or me.auth_id is distinct from auth.uid() or not me.is_active then return approval_private.err('no_session'); end if;
  if me.role is distinct from 'accountant' or me.project_id is distinct from a.project_id then return approval_private.err('forbidden'); end if;

  if p_action = 'set_pin' then
    select u.id, u.project_id, u.role into t from public.app_users u where u.id = p_user_id;
    -- لا يُكشف وجود مستخدم خارج نطاق إدارة المحاسب.
    if not found or t.project_id is distinct from a.project_id or t.role not in ('accountant', 'purchasing', 'cashier') then
      return approval_private.err('not_found');
    end if;
  end if;
  if exists (select 1 from public.app_users u where u.project_id = a.project_id and u.pin = p_pin
      and (p_action = 'create' or u.id <> p_user_id)) then
    return approval_private.err('pin_in_use');
  end if;

  if p_action = 'create' then
    insert into public.app_users(project_id, name, role, pin)
      values (a.project_id, btrim(p_name), p_role, p_pin) returning id into v_id;
  else
    update public.app_users set pin = p_pin where id = t.id;
    v_id := t.id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when others then
  -- أخطاء القيود قد تتضمن الصف كاملاً؛ لا تُرجع SQLERRM أو PG_EXCEPTION_DETAIL.
  -- كتلة الاستثناء تُلغي أي كتابة داخل هذه الدعوة قبل إرجاع الفشل.
  return jsonb_build_object('ok', false, 'code', 'save_failed');
end $$;
revoke all on function staff_private.write_user(text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function staff_private.write_user(text, uuid, text, text, text) to authenticated;

create function public.staff_create(p_name text, p_role text, p_pin text)
returns jsonb language sql security invoker set search_path = '' as $$
  select staff_private.write_user('create', null, p_name, p_role, p_pin)
$$;
create function public.staff_set_pin(p_user_id uuid, p_pin text)
returns jsonb language sql security invoker set search_path = '' as $$
  select staff_private.write_user('set_pin', p_user_id, null, null, p_pin)
$$;
revoke all on function public.staff_create(text, text, text), public.staff_set_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.staff_create(text, text, text), public.staff_set_pin(uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;
