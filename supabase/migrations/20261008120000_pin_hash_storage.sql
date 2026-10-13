-- تخزين رموز الدخول غير مقروء (بعد 20261004171444). معاملة واحدة: تفشل كلها أو تنجح كلها.
--
-- التصميم (التفاصيل في docs/pin-hash-storage.md):
--   • الرمز لا يُخزَّن. يُخزَّن bcrypt (pgcrypto، كلفة 10) لقيمة HMAC-SHA256 للرمز بسرّ (pepper) في Supabase Vault.
--     سرّ Vault مشفّر بمفتاح تديره المنصة خارج القاعدة: نسخ القاعدة (pg_dump) وتسرّب الجداول لا تكشفه، فلا يكفي تسرّب القاعدة
--     لتخمين رموز من 5 أرقام. يُنشأ السر هنا عشوائيًا داخل القاعدة ولا يراه أحد.
--   • التحقق بالمقارنة مع حسابات المنشأة (لا قيمة حتمية مخزّنة يُبحث بها): الرمز يحدد الحساب داخل منشأة النطاق، ومدير المنصة أولًا،
--     كما كان. وكذلك منع التكرار داخل المنشأة.
--   • بيانات التحقق في staff_private.pin_credentials: مخطط غير معروض في REST ولا GraphQL، ولا صلاحية عليه لأي دور غير المالك.
--   • عمود app_users.pin يُفرَّغ ويُقفل بقيد (pin is null): لا مسار يعيد حفظ رمز مقروءًا، ولو استُعيدت صلاحية كتابة مباشرة.
--   • لا تغيير في طول الرموز (5 أرقام) ولا في حد المحاولات ولا العزل ولا التعطيل ولا إغلاق الدخول القديم.
begin;
set local lock_timeout = '5s';

-- ── 1) السر ───────────────────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'tahseeb_pin_pepper') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'tahseeb_pin_pepper',
      'سر تجزئة رموز الدخول في تحسيب. لا يُعرض ولا يُنسخ. فقدانه = إعادة تعيين كل الرموز (docs/pin-hash-storage.md).');
  end if;
end $$;

-- ── 2) بيانات التحقق ──────────────────────────────────────────────────────────────
create table staff_private.pin_credentials (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  pin_hash text not null check (pin_hash ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'),
  updated_at timestamptz not null default now()
);
alter table staff_private.pin_credentials enable row level security;   -- بلا سياسات: لا قراءة إلا للمالك
revoke all on table staff_private.pin_credentials from public, anon, authenticated, service_role;

-- ── 3) الدوال الداخلية (المالك وحده؛ تُستدعى من دوال security definer) ────────────────
create function staff_private.pin_mac(p_pin text) returns text
language plpgsql stable set search_path = '' as $$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'tahseeb_pin_pepper';
  if k is null or k = '' then raise exception 'pin_pepper_missing'; end if;
  return encode(extensions.hmac(convert_to(p_pin, 'UTF8'), convert_to(k, 'UTF8'), 'sha256'), 'hex');
end $$;

create function staff_private.pin_hash_of(p_mac text) returns text
language sql volatile set search_path = '' as $$ select extensions.crypt(p_mac, extensions.gen_salt('bf', 10)) $$;

-- مكلفة عمدًا (bcrypt): تُقيَّم آخرًا وعلى المرشحين وحدهم. الاستعلامات تحصر المرشحين أولًا في استعلام فرعي بـ offset 0 (حاجز تحسين)
-- حتى لا ينقلها المخطط إلى فحص جدول بيانات التحقق كله لكل صف (كلفة تربيعية مُقاسة قبل هذا الحاجز).
create function staff_private.pin_ok(p_mac text, p_hash text) returns boolean
language sql stable cost 10000 set search_path = '' as $$ select p_hash is not null and extensions.crypt(p_mac, p_hash) = p_hash $$;

-- ── الحد بين مدير المنصة ومستخدمي المنشآت ─────────────────────────────────────────
-- مدير المنصة يُفحص أولًا من أي نطاق، فرمز موظف يساوي رمزه يمنح الموظف هوية مدير المنصة. لذلك رمز مدير المنصة (نشطًا أو معطّلًا)
-- لا يساوي رمز أي مستخدم منشأة (نشطًا أو معطّلًا، في أي منشأة)، في الاتجاهين ومن كل مسارات الإضافة والتغيير. تكرار رموز الموظفين بين
-- منشأتين يبقى مسموحًا. التزامن: كل كتابة رمز تأخذ قفل نطاق مدير المنصة — مشتركًا لمستخدمي المنشآت (فلا تتعطل المنشآت ببعضها)،
-- وحصريًا لمدير المنصة (فينتظر كل كتابة جارية في أي منشأة وتنتظره). لا يتعارض مع أقفال صفوف المنشآت (لا دورة).
create function staff_private.pin_scope_lock(p_superadmin boolean) returns void
language plpgsql volatile set search_path = '' as $$
begin
  if p_superadmin then perform pg_advisory_xact_lock(hashtextextended('tahseeb.pin.superadmin-scope', 0));
  else perform pg_advisory_xact_lock_shared(hashtextextended('tahseeb.pin.superadmin-scope', 0)); end if;
end $$;

-- هل يطابق الرمز (بقيمة HMAC) مدير منصة غير p_except؟ / مستخدم منشأة غير p_except في أي منشأة؟ (نشطين ومعطّلين)
create function staff_private.pin_taken_by_superadmin(p_mac text, p_except uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from (select c.pin_hash from public.app_users u join staff_private.pin_credentials c on c.user_id = u.id
    where u.role = 'superadmin' and u.id is distinct from p_except offset 0) k where staff_private.pin_ok(p_mac, k.pin_hash))
$$;
create function staff_private.pin_taken_by_staff(p_mac text, p_except uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from (select c.pin_hash from public.app_users u join staff_private.pin_credentials c on c.user_id = u.id
    where u.role is distinct from 'superadmin' and u.id is distinct from p_except offset 0) k where staff_private.pin_ok(p_mac, k.pin_hash))
$$;

-- تعيين رمز من لوحة القاعدة (المالك ومدير المنصة، والبيانات الأولية للاختبار). للمالك postgres وحده؛ لا يُعرض لأي دور.
-- 5 أرقام بالضبط (ما تقبله شاشة الدخول)، وغير مكرر داخل المنشأة (أو بين مديري المنصة)، ولا يعبر الحد بين مدير المنصة والمنشآت.
create function staff_private.set_pin_admin(p_user_id uuid, p_pin text) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare t record; v_mac text;
begin
  if p_pin is null or p_pin !~ '^[0-9]{5}$' then return jsonb_build_object('ok', false, 'code', 'invalid_pin'); end if;
  select u.id, u.project_id, u.role into t from public.app_users u where u.id = p_user_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  perform staff_private.pin_scope_lock(t.role = 'superadmin');
  perform 1 from public.app_users where project_id is not distinct from t.project_id order by id for update;
  v_mac := staff_private.pin_mac(p_pin);
  if exists (select 1 from (select c.pin_hash from public.app_users u join staff_private.pin_credentials c on c.user_id = u.id
      where u.project_id is not distinct from t.project_id and u.id <> t.id offset 0) k where staff_private.pin_ok(v_mac, k.pin_hash))
     or (t.role = 'superadmin' and staff_private.pin_taken_by_staff(v_mac, t.id))
     or (t.role is distinct from 'superadmin' and staff_private.pin_taken_by_superadmin(v_mac, t.id)) then
    return jsonb_build_object('ok', false, 'code', 'pin_in_use');
  end if;
  insert into staff_private.pin_credentials (user_id, pin_hash) values (t.id, staff_private.pin_hash_of(v_mac))
    on conflict (user_id) do update set pin_hash = excluded.pin_hash, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

revoke all on function staff_private.pin_mac(text), staff_private.pin_hash_of(text), staff_private.pin_ok(text, text),
  staff_private.set_pin_admin(uuid, text), staff_private.pin_scope_lock(boolean), staff_private.pin_taken_by_superadmin(text, uuid),
  staff_private.pin_taken_by_staff(text, uuid) from public, anon, authenticated, service_role;

-- ── 4) نقل الرموز الحالية ثم إقفال العمود المقروء ─────────────────────────────────
-- داخل القاعدة وحدها: لا يُقرأ رمز خارجها ولا يُكتب في ملف أو سجل.
-- نقطة توقف: تعارض قائم بين رمز مدير منصة ورمز مستخدم منشأة يُلغي الهجرة كلها (لا شيء يتغير، ولا يُطبع رمز ولا حساب).
-- العلاج قبل إعادة المحاولة: تغيير أحد الرمزين، ثم إعادة الفحص المسبق في خطة النشر.
do $$ begin
  if exists (select 1 from public.app_users s join public.app_users e on e.pin = s.pin and e.id <> s.id
             where s.role = 'superadmin' and e.role is distinct from 'superadmin' and s.pin is not null) then
    raise exception 'superadmin_pin_conflict';
  end if;
end $$;
insert into staff_private.pin_credentials (user_id, pin_hash)
  select u.id, staff_private.pin_hash_of(staff_private.pin_mac(u.pin)) from public.app_users u where u.pin is not null;
alter table public.app_users alter column pin drop not null;
update public.app_users set pin = null where pin is not null;
alter table public.app_users add constraint app_users_pin_retired check (pin is null);

-- ── 5) التحقق عند الدخول (كما في 20261001000000، والفرق فقرة فحص الرمز وحدها) ─────────
create or replace function public.pin_login_attempt(p_source text, p_subdomain text, p_user_id uuid, p_pin text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  src text; v_project uuid; n int; t int := 0; st int := 0; u record; v_resolved boolean := false;
  k_src text; k_tenant text; k_src_tenant text; v_until timestamptz; v_mac text; v_conflict boolean := false;
begin
  if p_source is null or btrim(p_source) = '' or (p_subdomain is null and p_user_id is null) then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  src := encode(sha256(convert_to(btrim(p_source), 'UTF8')), 'hex');
  k_src := 'login:src:' || src;

  -- المنشأة المقصودة (ليست سرًا: النطاق عنوان عام). لا تُفحص الرموز هنا.
  if p_user_id is not null then
    select project_id into v_project from public.app_users where id = p_user_id;
  else
    select id into v_project from public.projects where subdomain = p_subdomain limit 1;
  end if;
  v_resolved := v_project is not null;

  -- 1) احتساب المحاولة وتطبيق الحد قبل أي فحص للرمز
  n := auth_private.bump(k_src, interval '15 minutes');
  if v_project is not null then
    k_tenant := 'login:tenant:' || v_project;
    k_src_tenant := 'login:srct:' || src || ':' || v_project;
    t := auth_private.bump(k_tenant, interval '1 hour');
    st := auth_private.bump(k_src_tenant, interval '1 hour');
  end if;
  -- المدة: الأبعد بين القيود القائمة. تشديد المنشأة (t و st معًا) يرتفع بانتهاء أقرب نافذتيه.
  if n > 10 then
    v_until := auth_private.window_end(k_src, interval '15 minutes');
  end if;
  if t > 30 and st > 3 then
    v_until := greatest(v_until, least(auth_private.window_end(k_tenant, interval '1 hour'), auth_private.window_end(k_src_tenant, interval '1 hour')));
  end if;
  if v_until is not null then
    return jsonb_build_object('ok', false, 'code', 'throttled', 'retry_after', auth_private.seconds_until(v_until));
  end if;

  -- 2) فحص الرمز بالمقارنة مع بيانات التحقق: مدير المنصة من أي نطاق، ثم مستخدمو منشأة النطاق؛ النشطون وحدهم
  if p_pin is not null and p_pin ~ '^[0-9]{4,8}$' then
    v_mac := staff_private.pin_mac(p_pin);
    if p_user_id is not null then
      select k.id, k.name, k.role, k.project_id, k.branch into u from (select x.id, x.name, x.role, x.project_id, x.branch, c.pin_hash
        from public.app_users x join staff_private.pin_credentials c on c.user_id = x.id
       where x.id = p_user_id and x.is_active offset 0) k where staff_private.pin_ok(v_mac, k.pin_hash);
    else
      select k.id, k.name, k.role, k.project_id, k.branch into u from (select x.id, x.name, x.role, x.project_id, x.branch, c.pin_hash
        from public.app_users x join staff_private.pin_credentials c on c.user_id = x.id
       where x.role = 'superadmin' and x.is_active offset 0) k where staff_private.pin_ok(v_mac, k.pin_hash) limit 1;
      if u.id is null and v_project is not null then
        select k.id, k.name, k.role, k.project_id, k.branch into u from (select x.id, x.name, x.role, x.project_id, x.branch, c.pin_hash
          from public.app_users x join staff_private.pin_credentials c on c.user_id = x.id
         where x.project_id = v_project and x.is_active offset 0) k where staff_private.pin_ok(v_mac, k.pin_hash) limit 1;
      end if;
    end if;
  end if;

  -- تعارض قائم عبر الحد بين مدير المنصة والمنشآت (بيانات قديمة؛ الكتابة تمنعه): رفض آمن كالرمز الخاطئ، بلا جلسة لأي من الطرفين
  -- ولا كشف للسبب، ويُحتسب محاولة فاشلة. يزول بتغيير أحد الرمزين.
  if u.id is not null and (
       (u.role = 'superadmin' and staff_private.pin_taken_by_staff(v_mac, u.id))
    or (u.role is distinct from 'superadmin' and staff_private.pin_taken_by_superadmin(v_mac, u.id))) then
    v_conflict := true;
  end if;

  if u.id is null or v_conflict then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'tenant_resolved', v_resolved);
  end if;

  -- 3) النجاح: تُسترد المحاولة (الحد على الفاشلة)
  perform auth_private.refund(k_src);
  if k_tenant is not null then perform auth_private.refund(k_tenant); perform auth_private.refund(k_src_tenant); end if;
  return jsonb_build_object('ok', true, 'user', jsonb_build_object('id', u.id, 'name', u.name, 'role', u.role,
    'project_id', u.project_id, 'branch', u.branch,
    'project_name', (select p.name from public.projects p where p.id = u.project_id)));
end $$;
revoke all on function public.pin_login_attempt(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.pin_login_attempt(text, text, uuid, text) to service_role;

-- ── 6) إدارة الموظفين (كما في 20261001000000، والفرق: فحص التكرار والكتابة على بيانات التحقق) ─────
create or replace function staff_private.write_user(p_action text, p_user_id uuid, p_name text, p_role text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; me record; t record; v_id uuid; k_h text; k_d text; v_until timestamptz; v_mac text;
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

  -- الحد: كل عملية تبلغ فحص الرمز تُحتسب قبله ولا تُسترد (الناجحة أيضًا)، لكل المنشأة وللمسارين معًا.
  k_h := 'staff:tenant:h:' || a.project_id;
  k_d := 'staff:tenant:d:' || a.project_id;
  if auth_private.peek(k_h, interval '1 hour') >= 10 then
    v_until := auth_private.window_end(k_h, interval '1 hour');
  end if;
  if auth_private.peek(k_d, interval '24 hours') >= 30 then
    v_until := greatest(v_until, auth_private.window_end(k_d, interval '24 hours'));
  end if;
  if v_until is not null then
    return jsonb_build_object('ok', false, 'code', 'try_later', 'retry_after', auth_private.seconds_until(v_until));
  end if;
  perform auth_private.bump(k_h, interval '1 hour');
  perform auth_private.bump(k_d, interval '24 hours');

  if p_action = 'set_pin' then
    select u.id, u.project_id, u.role into t from public.app_users u where u.id = p_user_id;
    -- لا يُكشف وجود مستخدم خارج نطاق إدارة المحاسب.
    if not found or t.project_id is distinct from a.project_id or t.role not in ('accountant', 'purchasing', 'cashier') then
      return approval_private.err('not_found');
    end if;
  end if;
  -- الحد بين مدير المنصة والمنشآت: قفل النطاق المشترك، ثم رمز مدير منصة (نشط أو معطّل) = pin_in_use بالرد نفسه لتكرار المنشأة
  perform staff_private.pin_scope_lock(false);
  v_mac := staff_private.pin_mac(p_pin);
  if exists (select 1 from (select c.pin_hash from public.app_users u join staff_private.pin_credentials c on c.user_id = u.id
      where u.project_id = a.project_id and (p_action = 'create' or u.id <> p_user_id) offset 0) k where staff_private.pin_ok(v_mac, k.pin_hash))
     or staff_private.pin_taken_by_superadmin(v_mac, null) then
    return approval_private.err('pin_in_use');
  end if;

  begin
    if p_action = 'create' then
      insert into public.app_users(project_id, name, role)
        values (a.project_id, btrim(p_name), p_role) returning id into v_id;
    else
      v_id := t.id;
    end if;
    insert into staff_private.pin_credentials (user_id, pin_hash) values (v_id, staff_private.pin_hash_of(v_mac))
      on conflict (user_id) do update set pin_hash = excluded.pin_hash, updated_at = now();
  exception when others then
    -- تُلغى الكتابة وحدها؛ احتساب العملية باقٍ (فلا يُفحص رمز بإفشال الكتابة عمدًا دون احتساب)
    return jsonb_build_object('ok', false, 'code', 'save_failed');
  end;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when others then
  -- أخطاء القيود قد تتضمن الصف كاملاً؛ لا تُرجع SQLERRM أو PG_EXCEPTION_DETAIL.
  return jsonb_build_object('ok', false, 'code', 'save_failed');
end $$;

-- ── 7) إضافة موظف من شاشة مدير المنصة (كان إدراجًا مباشرًا مقروءًا مرفوضًا بالصلاحيات منذ 20260930181135) ─────
create function staff_private.admin_create_user(p_project_id uuid, p_name text, p_role text, p_branch text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; me record; v_id uuid; k_h text; k_d text; v_until timestamptz; v_mac text;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role is distinct from 'superadmin' then return approval_private.err('forbidden'); end if;
  if p_pin is null or p_pin !~ '^[0-9]{5}$' then return approval_private.err('invalid_pin'); end if;
  if p_name is null or btrim(p_name) = '' or length(btrim(p_name)) > 200 then return approval_private.err('invalid_name'); end if;
  if p_role is null or p_role not in ('owner', 'accountant', 'purchasing', 'cashier') then return approval_private.err('forbidden'); end if;
  if p_branch is not null and length(btrim(p_branch)) > 200 then return approval_private.err('invalid'); end if;
  if p_project_id is null or not exists (select 1 from public.projects where id = p_project_id) then return approval_private.err('not_found'); end if;

  perform 1 from public.app_users where project_id = p_project_id order by id for update;
  select u.auth_id, u.role, u.is_active into me from public.app_users u where u.id = a.id;
  if not found or me.auth_id is distinct from auth.uid() or not me.is_active or me.role is distinct from 'superadmin' then
    return approval_private.err('no_session');
  end if;

  -- الحد نفسه لعمليات فحص الرموز في المنشأة (يشترك فيه المساران)
  k_h := 'staff:tenant:h:' || p_project_id;
  k_d := 'staff:tenant:d:' || p_project_id;
  if auth_private.peek(k_h, interval '1 hour') >= 10 then v_until := auth_private.window_end(k_h, interval '1 hour'); end if;
  if auth_private.peek(k_d, interval '24 hours') >= 30 then v_until := greatest(v_until, auth_private.window_end(k_d, interval '24 hours')); end if;
  if v_until is not null then
    return jsonb_build_object('ok', false, 'code', 'try_later', 'retry_after', auth_private.seconds_until(v_until));
  end if;
  perform auth_private.bump(k_h, interval '1 hour');
  perform auth_private.bump(k_d, interval '24 hours');

  perform staff_private.pin_scope_lock(false);
  v_mac := staff_private.pin_mac(p_pin);
  if exists (select 1 from (select c.pin_hash from public.app_users u join staff_private.pin_credentials c on c.user_id = u.id
      where u.project_id = p_project_id offset 0) k where staff_private.pin_ok(v_mac, k.pin_hash))
     or staff_private.pin_taken_by_superadmin(v_mac, null) then
    return approval_private.err('pin_in_use');
  end if;
  begin
    insert into public.app_users(project_id, name, role, branch)
      values (p_project_id, btrim(p_name), p_role, nullif(btrim(p_branch), '')) returning id into v_id;
    insert into staff_private.pin_credentials (user_id, pin_hash) values (v_id, staff_private.pin_hash_of(v_mac));
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'save_failed');
  end;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when others then
  return jsonb_build_object('ok', false, 'code', 'save_failed');
end $$;
revoke all on function staff_private.admin_create_user(uuid, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function staff_private.admin_create_user(uuid, text, text, text, text) to authenticated;

create function public.admin_staff_create(p_project_id uuid, p_name text, p_role text, p_branch text, p_pin text)
returns jsonb language sql security invoker set search_path = '' as $$
  select staff_private.admin_create_user(p_project_id, p_name, p_role, p_branch, p_pin)
$$;
revoke all on function public.admin_staff_create(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_staff_create(uuid, text, text, text, text) to authenticated;

-- ── 8) الدخول القديم يبقى مغلقًا: لا يفحص رمزًا ولا يعيد أحدًا (التوقيع كما هو، والتنفيذ مسحوب منذ 20261001000100) ─────
create or replace function public.login_with_pin(p_subdomain text, p_pin text)
 returns table(id uuid, name text, role text, project_id uuid, project_name text, branch text, subdomain_resolved boolean)
 language sql stable security definer set search_path = '' as $$
  select null::uuid, null::text, null::text, null::uuid, null::text, null::text, null::boolean where false
$$;
revoke all on function public.login_with_pin(text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
