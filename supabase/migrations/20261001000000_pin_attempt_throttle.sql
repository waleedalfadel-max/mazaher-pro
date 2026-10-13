-- حد محاولات رموز الدخول في القاعدة (مشترك بين نسخ الخادم، يبقى بعد إعادة تشغيله، آمن مع التزامن). بعد 20260930181135.
--
-- القواعد:
--   • مسار واحد للتحقق من الرمز: public.pin_login_attempt، لمفتاح الخدمة وحده (خادم /api/pin-login و/api/pin-session).
--     إغلاق login_with_pin أمام المتصفح في ملف مستقل (20261001000100) يُطبَّق بعد نشر الواجهة الجديدة والتحقق منها؛
--     هذا الملف وحده لا يغيّر شيئًا في دخول الواجهة المنشورة.
--   • محاولة الدخول تُحتسب قبل فحص الرمز (عدّاد ذري بـ insert … on conflict)، ثم تُسترد إن نجحت: الحد فعليًا على الفاشلة،
--     والمحاولات المتزامنة لا تتجاوزه لأن كل واحدة تُحتسب قبل أن تُفحص.
--   • مدة الانتظار (retry_after) = موعد السماح الفعلي حين تجتمع القيود: الأبعد بين القيود القائمة، وتشديد المنشأة يرتفع
--     بانتهاء أيٍّ من نافذتيه. (تقدير لأقرب موعد ممكن: فشل جديد من مصادر أخرى قد يعيد تشديد المنشأة.)
--   • المصدر يحدده الخادم من معلومات موثوقة (لا من جسم الطلب)، ويُخزَّن مجزّأً (sha256) لا عنوانًا. لا يُخزَّن أي رمز.
--   • الحد على المصدر عبر كل المنشآت: تغيير نطاق المطعم أو مسار الطلب لا يعيده.
--   • هجوم موزّع على منشأة (فشل كثير فيها من مصادر متعددة): يُشدَّد الحد على كل مصدر فاشل فيها، ولا تُقفل المنشأة كلها؛
--     من يُدخل رمزه الصحيح من مصدر لم يفشل يدخل.
--   • ينطبق على كل الأدوار، ومنها مدير المنصة (يُتحقق منه في المسار نفسه).
--   • إدارة الموظفين: كل عملية تفحص رمزًا (إضافة موظف أو تعيين رمز، ناجحة أو فاشلة) تُحتسب قبل فحص التكرار ولا تُسترد،
--     في عدّاد واحد للمنشأة يشترك فيه المساران وكل محاسبيها؛ فلا تُفحص بها أعداد كبيرة من الرموز (ومنها «الرمز مستخدم»).
--     العملية المرفوضة بالحد لا تُحتسب (لا تطيل الانتظار).
--
-- الحدود (قابلة للمراجعة):
--   مصدر:            10 محاولات دخول فاشلة / 15 دقيقة، عبر كل المنشآت
--   منشأة تحت هجوم:   أكثر من 30 فاشلة / ساعة فيها ← كل مصدر: 3 فاشلة / ساعة في تلك المنشأة
--   إدارة الموظفين:   10 عمليات فحص رمز / ساعة، و30 / 24 ساعة، لكل منشأة

create schema auth_private;
revoke all on schema auth_private from public, anon, authenticated;

create table auth_private.attempt_counters (
  key text primary key,
  window_start timestamptz not null,
  failures integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table auth_private.attempt_counters enable row level security;
revoke all on auth_private.attempt_counters from public, anon, authenticated;
create index on auth_private.attempt_counters (updated_at);

-- يحتسب محاولة ويعيد عددها ضمن النافذة (تبدأ نافذة جديدة إن انتهت السابقة). ذري: التحديث يقفل الصف.
create function auth_private.bump(p_key text, p_window interval) returns integer
language sql volatile set search_path = '' as $$
  insert into auth_private.attempt_counters as c (key, window_start, failures) values (p_key, now(), 1)
  on conflict (key) do update set
    failures = case when c.window_start <= now() - p_window then 1 else c.failures + 1 end,
    window_start = case when c.window_start <= now() - p_window then now() else c.window_start end,
    updated_at = now()
  returning failures
$$;
-- استرداد محاولة نجحت
create function auth_private.refund(p_key text) returns void
language sql volatile set search_path = '' as $$
  update auth_private.attempt_counters set failures = greatest(failures - 1, 0), updated_at = now() where key = p_key
$$;
-- عدد المحاولات في النافذة الجارية، بلا احتساب (0 إن انتهت)
create function auth_private.peek(p_key text, p_window interval) returns integer
language sql stable set search_path = '' as $$
  select coalesce((select failures from auth_private.attempt_counters where key = p_key and window_start > now() - p_window), 0)
$$;
-- نهاية النافذة الجارية
create function auth_private.window_end(p_key text, p_window interval) returns timestamptz
language sql stable set search_path = '' as $$
  select window_start + p_window from auth_private.attempt_counters where key = p_key
$$;
-- ثوانٍ حتى موعد (1 على الأقل)
create function auth_private.seconds_until(p_at timestamptz) returns integer
language sql stable set search_path = '' as $$
  select greatest(1, ceil(extract(epoch from (p_at - now())))::int)
$$;
revoke all on all functions in schema auth_private from public, anon, authenticated;

-- ── التحقق الوحيد من رمز الدخول ─────────────────────────────────────────────────
-- p_source: مصدر المحاولة كما يحدده الخادم (عنوان موثوق). بنطاق المطعم (p_subdomain) من شاشة الدخول، أو بمعرّف المستخدم
-- (p_user_id) من /api/pin-session. يعيد المستخدم عند النجاح فقط، ورموز أخطاء عامة غير ذلك.
create function public.pin_login_attempt(p_source text, p_subdomain text, p_user_id uuid, p_pin text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  src text; v_project uuid; n int; t int := 0; st int := 0; u record; v_resolved boolean := false;
  k_src text; k_tenant text; k_src_tenant text; v_until timestamptz;
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

  -- 2) فحص الرمز (كما في login_with_pin: مدير المنصة من أي نطاق، ثم مستخدمو منشأة النطاق؛ النشطون وحدهم)
  if p_pin is not null and p_pin ~ '^[0-9]{4,8}$' then
    if p_user_id is not null then
      select x.id, x.name, x.role, x.project_id, x.branch into u from public.app_users x
       where x.id = p_user_id and x.pin = p_pin and x.is_active;
    else
      select x.id, x.name, x.role, x.project_id, x.branch into u from public.app_users x
       where x.pin = p_pin and x.role = 'superadmin' and x.is_active limit 1;
      if u.id is null and v_project is not null then
        select x.id, x.name, x.role, x.project_id, x.branch into u from public.app_users x
         where x.pin = p_pin and x.project_id = v_project and x.is_active limit 1;
      end if;
    end if;
  end if;

  if u.id is null then
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

-- ── إدارة الموظفين: حد لعمليات فحص الرموز ────────────────────────────────────────
-- التعريف كما في 20260930181135 (مع الرمز 5 أرقام)، والفروق: فقرة «الحد» بعد إعادة التحقق وقبل فحص التكرار، والكتابة
-- وحدها داخل كتلة استثناء فرعية (فشلها لا يلغي احتساب العملية).
create or replace function staff_private.write_user(p_action text, p_user_id uuid, p_name text, p_role text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; me record; t record; v_id uuid; k_h text; k_d text; v_until timestamptz;
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
  -- القراءة ثم الاحتساب آمنان مع التزامن: قفل صفوف المنشأة أعلاه يسلسل كل عمليات المنشأة، والعدّادات للمنشأة وحدها.
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
  if exists (select 1 from public.app_users u where u.project_id = a.project_id and u.pin = p_pin
      and (p_action = 'create' or u.id <> p_user_id)) then
    return approval_private.err('pin_in_use');
  end if;

  begin
    if p_action = 'create' then
      insert into public.app_users(project_id, name, role, pin)
        values (a.project_id, btrim(p_name), p_role, p_pin) returning id into v_id;
    else
      update public.app_users set pin = p_pin where id = t.id;
      v_id := t.id;
    end if;
  exception when others then
    -- تُلغى الكتابة وحدها؛ احتساب العملية باقٍ (فلا يُفحص رمز بإفشال الكتابة عمدًا دون احتساب)
    return jsonb_build_object('ok', false, 'code', 'save_failed');
  end;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when others then
  -- أخطاء القيود قد تتضمن الصف كاملاً؛ لا تُرجع SQLERRM أو PG_EXCEPTION_DETAIL.
  -- كتلة الاستثناء تُلغي أي كتابة داخل هذه الدعوة قبل إرجاع الفشل.
  return jsonb_build_object('ok', false, 'code', 'save_failed');
end $$;

notify pgrst, 'reload schema';
