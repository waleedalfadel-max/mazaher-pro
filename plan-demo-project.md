# خطة إنشاء مشروع العرض التجريبي — tashormik.tahseeb.app (نهائي)

> تخطيط + SQL جاهز فقط. لم يُنفَّذ أي تعديل بقاعدة البيانات.
> يبني من الصفر على `subdomain='tashormik'` — **تأكدنا أن المشروع القديم محذوف بالفعل** ضمن تنظيف اليوم (نفس مصير trial وbasal)، والبنية التحتية (DNS/Vercel) لا تزال تعمل فعلياً — تحققت بنفسي حياً: `tashormik.tahseeb.app` يستجيب ويعرض شاشة PIN بلا أي مشكلة، فلا حاجة لأي خطوة يدوية بلوحة Vercel هذي المرة.

---

## 1) إنشاء المشروع

```sql
insert into projects (name, subdomain)
values ('مطعم العرض التوضيحي', 'tashormik')
returning id;
```

```sql
insert into project_settings (project_id, settings, active)
select id, '{}', true from projects where subdomain = 'tashormik';
```

---

## 2) التصنيفات — قالب عام لأي مطعم (4 تصنيفات رئيسية، 12 فرعية)

```sql
with p as (select id from projects where subdomain = 'tashormik')
insert into categories (project_id, name, parent_id, type, sort_order)
select p.id, v.name, null, v.type, v.sort_order
from p, (values
  ('تكلفة البضاعة المباعة', 'expense', 1),
  ('مصروفات تشغيلية',        'expense', 2),
  ('صيانة',                  'expense', 3),
  ('أصول وتجهيزات',          'expense', 4)
) as v(name, type, sort_order);

with parents as (
  select id, name from categories
  where project_id = (select id from projects where subdomain = 'tashormik')
    and parent_id is null
)
insert into categories (project_id, name, parent_id, type, sort_order)
select (select id from projects where subdomain = 'tashormik'), sub.name, parents.id, 'expense', sub.sort_order
from parents
join (values
  ('تكلفة البضاعة المباعة', 'لحوم',              1),
  ('تكلفة البضاعة المباعة', 'خبز',                2),
  ('تكلفة البضاعة المباعة', 'خضار',               3),
  ('تكلفة البضاعة المباعة', 'مشروبات',            4),
  ('تكلفة البضاعة المباعة', 'فحم وغاز',           5),
  ('تكلفة البضاعة المباعة', 'مواد متنوعة',        6),
  ('مصروفات تشغيلية',       'رواتب',              1),
  ('مصروفات تشغيلية',       'تسويق وإعلان',       2),
  ('مصروفات تشغيلية',       'توصيل',              3),
  ('مصروفات تشغيلية',       'إيجار ومصروفات ثابتة', 4),
  ('صيانة',                 'صيانة معدات',        1),
  ('صيانة',                 'صيانة عامة',         2),
  ('أصول وتجهيزات',         'أثاث وتجهيزات',       1),
  ('أصول وتجهيزات',         'معدات مطبخ',          2)
) as sub(parent_name, name, sort_order) on sub.parent_name = parents.name;
```

⚠️ ملاحظة: جمعت "الإيجار" داخل "مصروفات تشغيلية" (بدل تصنيف "مصروفات ثابتة" منفصل) حتى تبقى الرئيسية أربعة بالضبط كما حدّدت. إن كنت تفضّل "مصروفات ثابتة" كتصنيف خامس مستقل بدل دمجه، أخبرني وأعدّل السطر بسهولة.

---

## 3) المستخدمون التجريبيون

```sql
with p as (select id from projects where subdomain = 'tashormik')
insert into app_users (project_id, name, role, pin, branch)
select p.id, v.name, v.role, v.pin, null
from p, (values
  ('مالك تجريبي',      'owner',      '11111'),
  ('محاسب تجريبي',     'accountant', '22222'),
  ('كاشير تجريبي',     'cashier',    '33333'),
  ('مشتريات تجريبي',   'purchasing', '44444')
) as v(name, role, pin);
```

---

## 4) توليد 90 يوماً من بيانات تجريبية واقعية

نفس منطق `generate_series` السابق، مُحدَّث ليوزّع مشتريات تكلفة البضاعة على التصنيفات الفرعية الستة أعلاه (بدل بند واحد) — يعطي مخطط "أكبر 5 بنود مصروفات" بلوحة التحكم تنوّعاً واقعياً بدل بند ضخم واحد.

```sql
-- مبيعات يومية (كاش + شبكة) — 90 يوماً تنتهي دائماً باليوم الحالي
with p as (select id from projects where subdomain = 'tashormik'),
days as (
  select generate_series(current_date - interval '89 days', current_date, interval '1 day')::date as d
),
daily as (
  select d,
    round((800 + random()*1200)::numeric, 2) as cash_amt,
    round((600 + random()*1400)::numeric, 2) as bank_amt
  from days
)
insert into ledger_entries (project_id, date, type, description, cash_in, cash_out, bank_in, bank_out, custody_in, custody_out, total_amount, status, journal_number, branch)
select p.id, d, '💵 مبيعات كاش', 'مبيعات يوم '||to_char(d,'YYYY-MM-DD'), cash_amt, 0, 0, 0, 0, 0, cash_amt, 'approved', 'DEMO-'||to_char(d,'YYYYMMDD')||'-1', null
from daily, p
union all
select p.id, d, '🏦 مبيعات شبكة', 'مبيعات يوم '||to_char(d,'YYYY-MM-DD'), 0, 0, bank_amt, 0, 0, 0, bank_amt, 'approved', 'DEMO-'||to_char(d,'YYYYMMDD')||'-2', null
from daily, p;

-- مطابقة جدول sales (تقرأه صفحة المبيعات مباشرة)
with p as (select id from projects where subdomain = 'tashormik'),
days as (
  select generate_series(current_date - interval '89 days', current_date, interval '1 day')::date as d
)
insert into sales (project_id, date, cash_sales, network_sales, hunger_sales, jahez_sales, keeta_sales, description)
select p.id, d, round((800+random()*1200)::numeric,2), round((600+random()*1400)::numeric,2), 0, 0, 0, 'بيانات عرض تجريبي'
from days, p;

-- مشتريات أسبوعية — بند مستقل لكل تصنيف فرعي من الستة، كل 7 أيام
with p as (select id from projects where subdomain = 'tashormik'),
weeks as (
  select generate_series(current_date - interval '84 days', current_date, interval '7 days')::date as d
),
subs as (
  select name, sort_order from categories
  where project_id = (select id from p)
    and parent_id = (select id from categories where project_id=(select id from p) and name='تكلفة البضاعة المباعة')
)
insert into ledger_entries (project_id, date, type, description, cash_in, cash_out, bank_in, bank_out, custody_in, custody_out, vat_amount, total_amount, status, journal_number, category_main, category_sub, branch)
select p.id, weeks.d, '🛒 مصروفات تشغيلية', 'توريد '||subs.name||' — أسبوعي',
       0, 0, 0, amt, 0, 0, round(amt*0.15/1.15,2), amt, 'approved',
       'DEMO-'||to_char(weeks.d,'YYYYMMDD')||'-COGS-'||subs.sort_order,
       'تكلفة البضاعة المباعة', subs.name, null
from weeks, p,
     subs,
     lateral (select round((300+random()*700)::numeric,2) as amt) a;

-- إيجار ومصروفات ثابتة — دفعة شهرية (3 دفعات)
with p as (select id from projects where subdomain = 'tashormik'),
months as (
  select generate_series(date_trunc('month', current_date - interval '2 months'), date_trunc('month', current_date), interval '1 month')::date as d
)
insert into ledger_entries (project_id, date, type, description, cash_in, cash_out, bank_in, bank_out, custody_in, custody_out, total_amount, status, journal_number, category_main, category_sub, branch)
select p.id, d, '💰 مصروفات ثابتة', 'إيجار الشهر', 0, 0, 0, 8000, 0, 0, 8000, 'approved',
       'DEMO-'||to_char(d,'YYYYMM')||'-RENT', 'مصروفات تشغيلية', 'إيجار ومصروفات ثابتة', null
from months, p;

-- صيانة وأصول — 3 بنود متفرقة عبر الفترة، لملء التصنيفَين المتبقيَين بأرقام حقيقية
with p as (select id from projects where subdomain = 'tashormik')
insert into ledger_entries (project_id, date, type, description, cash_in, cash_out, bank_in, bank_out, custody_in, custody_out, total_amount, status, journal_number, category_main, category_sub, branch)
select p.id, v.d, '🛒 مصروفات تشغيلية', v.desc, 0, 0, 0, v.amt, 0, 0, v.amt, 'approved',
       'DEMO-'||to_char(v.d,'YYYYMMDD')||'-MISC', v.cat_main, v.cat_sub, null
from p, (values
  ((current_date - interval '60 days')::date, 'صيانة ثلاجة العرض',   450.00,  'صيانة',         'صيانة معدات'),
  ((current_date - interval '30 days')::date, 'صيانة عامة للمطبخ',    300.00,  'صيانة',         'صيانة عامة'),
  ((current_date - interval '15 days')::date, 'شراء طاولات جديدة',   2200.00, 'أصول وتجهيزات', 'أثاث وتجهيزات')
) as v(d, desc, amt, cat_main, cat_sub);
```

**تحقق سريع بعد التشغيل الكامل:**
```sql
select category_main, count(*), sum(total_amount)
from ledger_entries
where project_id = (select id from projects where subdomain='tashormik')
group by category_main;
```
يجب أن تظهر أربعة أسطر (أو أكثر بقليل بسبب "مبيعات" بلا `category_main`) تغطي كل التصنيفات الأربعة بأرقام غير صفرية.

---

## RLS — نفس التأكيد السابق، بلا تغيير
كل السياسات وكل من `login_with_pin`/`get_project_branding` عامة تماماً (لا ربط باسم مشروع). أول تسجيل دخول ناجح لأي من الأربعة أعلاه يُنشئ الجلسة الحقيقية تلقائياً — بلا أي كود إضافي.

---

## ترتيب التنفيذ
1. القسم 1 (المشروع) → تأكد من رجوع `id`
2. القسم 2 (التصنيفات) — راجع خصوصاً ملاحظة "الإيجار"
3. القسم 3 (المستخدمون)
4. القسم 4 — شغّل كل جزء على حدة، وتحقق بالاستعلام الختامي بعد الجزء الأخير
5. اختبار حي: `tashormik.tahseeb.app` → تسجيل دخول بأي PIN → تأكد أن لوحة التحكم والتقارير تعرض أرقاماً منطقية عبر كل التصنيفات الأربعة

**لم يُنفَّذ أي شيء. بانتظار موافقتك النهائية.**
