# خطة حذف المشاريع التجريبية — الإبقاء على "ديوانية مزاهر" فقط

> **خطة فقط — لم يُنفَّذ أي حذف، ولم يُعدَّل أي ملف كود أو صف بيانات.**
> كل الأرقام أدناه من جرد حي (قراءة فقط) بتاريخ 2026-08-11.
> ⛔ **لا تُنفَّذ أي خطوة قبل موافقتك الصريحة.**

---

## المعرّفات — أساس كل ما يلي

| المشروع | `project_id` | subdomain | المصير |
|---|---|---|:---:|
| **ديوانية مزاهر** | `03149efa-1def-45ec-91b2-2d2b24e38e8c` | `mazaher` | ✅ **يُبقى** |
| بـ عسل ☕ | `3822c886-7f53-4fdb-aaa2-ef7b6d4aea63` | `basal` | 🗑️ يُحذف |
| تشورميك | `50b7ed07-1faa-4882-b0bc-ad3823a2a417` | `tashormik` | 🗑️ يُحذف |
| تيست مزاهر | `d64b040a-0824-43b8-966e-eb41ee095f82` | — | 🗑️ يُحذف |
| محمصة كون | `ab1c819e-441f-46ce-919b-db9f0711910b` | `koon` | 🗑️ يُحذف |
| مطعم الوادي 🍔 | `d3c001a0-1999-4171-8979-867c167eb91d` | `trial` | 🗑️ يُحذف |

### 🔑 مبدأ الأمان المعتمد بكل استعلامات هذه الخطة
**كل عمليات الحذف تستخدم قائمة إيجابية صريحة بالمعرّفات الخمسة** (`IN (...)`)، **ولا تستخدم النفي إطلاقاً** (`<>` أو `NOT IN`). السبب:

- النفي يحذف أي صف لا يطابق — بما فيه صفوف **مشاريع مستقبلية** أو صفوف بمعرّف غير متوقع.
- ⚠️ **الأهم:** حساب `superadmin` الوحيد بالنظام له `project_id IS NULL`. بمنطق SQL، `NULL <> 'x'` تُقيَّم كـ`NULL` لا `TRUE`، فينجو الحساب — **لكن بالمصادفة لا بالتصميم**. القائمة الإيجابية تجعل نجاته مضمونة صراحةً.

---

## 1. جرد ما سيُحذف بالضبط

| الجدول | بـ عسل | تشورميك | تيست مزاهر | محمصة كون | مطعم الوادي | **المجموع** | ✅ يبقى لمزاهر |
|---|---:|---:|---:|---:|---:|---:|---:|
| `ledger_entries` | 12 | 668 | 166 | 66 | 308 | **1,220** | 398 |
| `document_items` | 14 | 387 | 0 | 62 | 0 | **463** | 236 |
| `documents` | 6 | 261 | 0 | 70 | 0 | **337** | 274 |
| `sales` | 1 | 138 | 39 | 4 | 90 | **272** | 70 |
| `categories` | 30 | 22 | 0 | 15 | 19 | **86** | 23 |
| `app_users` | 4 | 7 | 0 | 5 | 6 | **22** | 4 |
| `loans` | 0 | 0 | 4 | 0 | 0 | **4** | 0 |
| `project_settings` | 1 | 1 | 0 | 1 | 1 | **4** | 1 |
| `payable_suppliers` | 2 | 0 | 0 | 0 | 0 | **2** | 0 |
| `suppliers` | 0 | 0 | 0 | 1 | 0 | **1** | 0 |
| `supplier_transactions` | 0 | 0 | 0 | 0 | 0 | **0** | 0 |
| `quick_sales_draft` | 0 | 0 | 0 | 0 | 0 | **0** | 2 |
| `projects` | 1 | 1 | 1 | 1 | 1 | **5** | 1 |
| **الإجمالي** | **71** | **1,485** | **210** | **225** | **425** | **🗑️ 2,416 صفاً** | **1,008** |

### ✅ فحص السلامة المرجعية — نظيف تماماً
| الفحص | النتيجة |
|---|---|
| `ledger_entries.supplier_id` يشير لمورد بمشروع آخر | **0** |
| `ledger_entries.paid_invoice_id` عابر للمشاريع | **0** (لا وجود لأي مرجع أصلاً) |
| `document_items.document_id` عابر للمشاريع | **0** |

⇒ **لا يوجد أي صف بمزاهر يعتمد على صف بمشروع محذوف.** الحذف آمن مرجعياً.

### 📁 ملفات Storage — تحتاج حذفاً منفصلاً
حذف صفوف `documents` **لا يحذف الملفات الفعلية** من bucket `documents`:

| المشروع | عدد الملفات |
|---|---:|
| تشورميك | 261 |
| محمصة كون | 70 |
| بـ عسل | 6 |
| تيست مزاهر / مطعم الوادي | 0 |
| **المجموع المطلوب حذفه** | **337 ملفاً** |
| ✅ مزاهر (يبقى) | 274 |

الملفات مخزّنة بمجلدات باسم `project_id`، فحذفها مباشر ومنفصل (سكربت بالقسم 6).

---

## 2. ترتيب الحذف الصحيح (مراعاةً للـFK)

الترتيب من **الأبناء إلى الآباء**. جدول `projects` **أخيراً دائماً**:

| # | الجدول | لماذا بهذا الترتيب |
|:--:|---|---|
| 1 | `document_items` | يشير إلى `documents` |
| 2 | `supplier_transactions` | يشير إلى `suppliers` و`documents` |
| 3 | `ledger_entries` | يشير إلى `suppliers`/`payable_suppliers` (و`paid_invoice_id` ذاتياً) |
| 4 | `documents` | صار بلا أبناء بعد 1 و2 |
| 5 | `payable_suppliers`, `suppliers` | صارت بلا مراجع بعد 3 |
| 6 | `sales`, `categories`, `quick_sales_draft`, `loans`, `app_users`, `project_settings` | تشير إلى `projects` فقط |
| 7 | **`projects`** | الجذر — أخيراً |

> **ملاحظة عن `ON DELETE CASCADE`:** جدول `suppliers` مُعرَّف بـ`ON DELETE CASCADE` ([supabase-suppliers.sql](supabase-suppliers.sql))، لكن **بقية الجداول أُنشئت خارج المستودع** وحالة قيودها غير موثّقة. الحذف الصريح بالترتيب أعلاه **يعمل بنجاح في الحالتين** — سواء وُجد CASCADE أم لا. لمعرفة الحالة الفعلية (اختياري):
> ```sql
> SELECT tc.table_name, kcu.column_name, rc.delete_rule
> FROM information_schema.table_constraints tc
> JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
> JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
> WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
> ORDER BY 1, 2;
> ```

---

## 3. الخطوة 1 — النسخة الاحتياطية (تُنفَّذ أولاً وإلزامياً)

### 3-أ. أرشيف داخل قاعدة البيانات (الأسرع — محرر SQL بـSupabase)

```sql
-- ═══════════════════════════════════════════════════════════════════
-- نسخة احتياطية كاملة للمشاريع الخمسة قبل الحذف
-- تُنشئ سكيما منفصلة archive_2026_08 تحتفظ بكل شيء
-- ═══════════════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS archive_2026_08;

-- المعرّفات الخمسة المستهدفة — تتكرر بكل استعلام صراحةً
-- (مزاهر 03149efa-... غير مذكور هنا إطلاقاً)

CREATE TABLE archive_2026_08.projects AS
  SELECT * FROM public.projects WHERE id IN (
    '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63',  -- بـ عسل
    '50b7ed07-1faa-4882-b0bc-ad3823a2a417',  -- تشورميك
    'd64b040a-0824-43b8-966e-eb41ee095f82',  -- تيست مزاهر
    'ab1c819e-441f-46ce-919b-db9f0711910b',  -- محمصة كون
    'd3c001a0-1999-4171-8979-867c167eb91d'   -- مطعم الوادي
  );

CREATE TABLE archive_2026_08.ledger_entries AS
  SELECT * FROM public.ledger_entries WHERE project_id IN (
    '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
    'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
    'd3c001a0-1999-4171-8979-867c167eb91d');

CREATE TABLE archive_2026_08.documents AS
  SELECT * FROM public.documents WHERE project_id IN (
    '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
    'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
    'd3c001a0-1999-4171-8979-867c167eb91d');

CREATE TABLE archive_2026_08.document_items AS
  SELECT * FROM public.document_items WHERE project_id IN (
    '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
    'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
    'd3c001a0-1999-4171-8979-867c167eb91d');

CREATE TABLE archive_2026_08.sales AS
  SELECT * FROM public.sales WHERE project_id IN (
    '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
    'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
    'd3c001a0-1999-4171-8979-867c167eb91d');

CREATE TABLE archive_2026_08.app_users AS
  SELECT * FROM public.app_users WHERE project_id IN (
    '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
    'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
    'd3c001a0-1999-4171-8979-867c167eb91d');

CREATE TABLE archive_2026_08.categories AS
  SELECT * FROM public.categories WHERE project_id IN (
    '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
    'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
    'd3c001a0-1999-4171-8979-867c167eb91d');

CREATE TABLE archive_2026_08.project_settings AS
  SELECT * FROM public.project_settings WHERE project_id IN (
    '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
    'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
    'd3c001a0-1999-4171-8979-867c167eb91d');

CREATE TABLE archive_2026_08.suppliers AS
  SELECT * FROM public.suppliers WHERE project_id IN (
    '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
    'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
    'd3c001a0-1999-4171-8979-867c167eb91d');

CREATE TABLE archive_2026_08.supplier_transactions AS
  SELECT * FROM public.supplier_transactions WHERE project_id IN (
    '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
    'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
    'd3c001a0-1999-4171-8979-867c167eb91d');

CREATE TABLE archive_2026_08.payable_suppliers AS
  SELECT * FROM public.payable_suppliers WHERE project_id IN (
    '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
    'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
    'd3c001a0-1999-4171-8979-867c167eb91d');

CREATE TABLE archive_2026_08.quick_sales_draft AS
  SELECT * FROM public.quick_sales_draft WHERE project_id IN (
    '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
    'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
    'd3c001a0-1999-4171-8979-867c167eb91d');

CREATE TABLE archive_2026_08.loans AS
  SELECT * FROM public.loans WHERE project_id IN (
    '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
    'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
    'd3c001a0-1999-4171-8979-867c167eb91d');

-- ── تحقق: يجب أن تطابق أعداد الجرد بالقسم 1 ──
SELECT 'projects' t, count(*) FROM archive_2026_08.projects
UNION ALL SELECT 'ledger_entries', count(*) FROM archive_2026_08.ledger_entries
UNION ALL SELECT 'documents',      count(*) FROM archive_2026_08.documents
UNION ALL SELECT 'document_items', count(*) FROM archive_2026_08.document_items
UNION ALL SELECT 'sales',          count(*) FROM archive_2026_08.sales
UNION ALL SELECT 'app_users',      count(*) FROM archive_2026_08.app_users
UNION ALL SELECT 'categories',     count(*) FROM archive_2026_08.categories
UNION ALL SELECT 'project_settings', count(*) FROM archive_2026_08.project_settings
UNION ALL SELECT 'suppliers',      count(*) FROM archive_2026_08.suppliers
UNION ALL SELECT 'payable_suppliers', count(*) FROM archive_2026_08.payable_suppliers
UNION ALL SELECT 'loans',          count(*) FROM archive_2026_08.loans
ORDER BY 1;
```

**الأعداد المتوقعة:** `projects`=5 · `ledger_entries`=1220 · `documents`=337 · `document_items`=463 · `sales`=272 · `app_users`=22 · `categories`=86 · `project_settings`=4 · `suppliers`=1 · `payable_suppliers`=2 · `loans`=4

### 3-ب. ⚠️ نسخة خارج قاعدة البيانات (موصى بها بشدة)

الأرشيف أعلاه **يبقى داخل نفس قاعدة البيانات** — لا يحميك من خطأ يطال القاعدة كلها. للنسخة الحقيقية:

**الخيار الأسهل:** لوحة Supabase → **Database → Backups → Download backup**

**أو `pg_dump`** (يتطلب رابط الاتصال من Settings → Database):
```bash
pg_dump "postgresql://postgres:[PASSWORD]@db.dnuxevxxgmgptptmuzdy.supabase.co:5432/postgres" \
  --schema=archive_2026_08 --no-owner --no-acl \
  -f archive_2026_08_backup.sql
```
> ⚠️ لا تضع كلمة المرور بأي ملف يُرفع لـgit. نفّذ هذا الأمر بنفسك — لن أطلبها ولن أتعامل معها.

**تصدير JSON سريع بديل** (نسخة واحدة لكل جدول عبر محرر SQL ثم "Download JSON"):
```sql
SELECT json_agg(t) FROM archive_2026_08.ledger_entries t;
```

---

## 4. الخطوة 2 — التحقق قبل الحذف (تشغيل جاف)

```sql
-- ═══════ فحص ما قبل الحذف — لا يحذف شيئاً ═══════

-- 1) تأكيد أن مزاهر ليست ضمن القائمة المستهدفة (يجب أن يعيد 0 صف)
SELECT id, name FROM public.projects
WHERE id IN ('3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
             'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
             'd3c001a0-1999-4171-8979-867c167eb91d')
  AND name = 'ديوانية مزاهر';
-- ⛔ لو أعاد أي صف — أوقف كل شيء فوراً

-- 2) تأكيد أن المستهدفين خمسة بالضبط وأسماؤهم متوقعة
SELECT id, name FROM public.projects
WHERE id IN ('3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
             'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
             'd3c001a0-1999-4171-8979-867c167eb91d')
ORDER BY name;
-- المتوقع: 5 صفوف — بـ عسل ☕ / تشورميك / تيست مزاهر / محمصة كون / مطعم الوادي 🍔

-- 3) تأكيد نجاة حساب superadmin (project_id IS NULL)
SELECT count(*) AS superadmins_protected FROM public.app_users
WHERE project_id IS NULL AND role = 'superadmin';
-- المتوقع: 1

-- 4) تأكيد بقاء حسابات مزاهر
SELECT role, count(*) FROM public.app_users
WHERE project_id = '03149efa-1def-45ec-91b2-2d2b24e38e8c' GROUP BY role ORDER BY 1;
-- المتوقع: accountant=1, cashier=1, owner=1, purchasing=1
```

---

## 5. الخطوة 3 — الحذف (داخل معاملة واحدة قابلة للتراجع)

```sql
-- ═══════════════════════════════════════════════════════════════════
-- الحذف — معاملة واحدة: إما تنجح كلها أو تُلغى كلها
-- ⛔ لا تنفّذ COMMIT إلا بعد مراجعة أعداد الحذف
-- ═══════════════════════════════════════════════════════════════════
BEGIN;

-- الترتيب: أبناء ← آباء (انظر القسم 2)

DELETE FROM public.document_items WHERE project_id IN (
  '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
  'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
  'd3c001a0-1999-4171-8979-867c167eb91d');                       -- متوقع: 463

DELETE FROM public.supplier_transactions WHERE project_id IN (
  '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
  'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
  'd3c001a0-1999-4171-8979-867c167eb91d');                       -- متوقع: 0

DELETE FROM public.ledger_entries WHERE project_id IN (
  '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
  'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
  'd3c001a0-1999-4171-8979-867c167eb91d');                       -- متوقع: 1220

DELETE FROM public.documents WHERE project_id IN (
  '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
  'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
  'd3c001a0-1999-4171-8979-867c167eb91d');                       -- متوقع: 337

DELETE FROM public.payable_suppliers WHERE project_id IN (
  '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
  'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
  'd3c001a0-1999-4171-8979-867c167eb91d');                       -- متوقع: 2

DELETE FROM public.suppliers WHERE project_id IN (
  '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
  'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
  'd3c001a0-1999-4171-8979-867c167eb91d');                       -- متوقع: 1

DELETE FROM public.sales WHERE project_id IN (
  '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
  'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
  'd3c001a0-1999-4171-8979-867c167eb91d');                       -- متوقع: 272

DELETE FROM public.categories WHERE project_id IN (
  '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
  'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
  'd3c001a0-1999-4171-8979-867c167eb91d');                       -- متوقع: 86

DELETE FROM public.quick_sales_draft WHERE project_id IN (
  '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
  'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
  'd3c001a0-1999-4171-8979-867c167eb91d');                       -- متوقع: 0

DELETE FROM public.loans WHERE project_id IN (
  '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
  'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
  'd3c001a0-1999-4171-8979-867c167eb91d');                       -- متوقع: 4

DELETE FROM public.app_users WHERE project_id IN (
  '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
  'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
  'd3c001a0-1999-4171-8979-867c167eb91d');                       -- متوقع: 22
-- ✅ الحساب الوحيد بـproject_id IS NULL (superadmin) لا يطابق IN فينجو

DELETE FROM public.project_settings WHERE project_id IN (
  '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
  'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
  'd3c001a0-1999-4171-8979-867c167eb91d');                       -- متوقع: 4

-- الجذر — أخيراً
DELETE FROM public.projects WHERE id IN (
  '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63','50b7ed07-1faa-4882-b0bc-ad3823a2a417',
  'd64b040a-0824-43b8-966e-eb41ee095f82','ab1c819e-441f-46ce-919b-db9f0711910b',
  'd3c001a0-1999-4171-8979-867c167eb91d');                       -- متوقع: 5

-- ═══════ تحقق داخل المعاملة قبل الاعتماد ═══════
SELECT 'projects متبقية' k, count(*) v FROM public.projects
UNION ALL SELECT 'قيود مزاهر', count(*) FROM public.ledger_entries
          WHERE project_id='03149efa-1def-45ec-91b2-2d2b24e38e8c'
UNION ALL SELECT 'قيود غير مزاهر (يجب 0)', count(*) FROM public.ledger_entries
          WHERE project_id <> '03149efa-1def-45ec-91b2-2d2b24e38e8c'
UNION ALL SELECT 'حسابات مزاهر', count(*) FROM public.app_users
          WHERE project_id='03149efa-1def-45ec-91b2-2d2b24e38e8c'
UNION ALL SELECT 'superadmin ناجٍ', count(*) FROM public.app_users
          WHERE project_id IS NULL AND role='superadmin';
-- المتوقع: 1 / 398 / 0 / 4 / 1

-- ⛔ راجع الأرقام أعلاه. لو طابقت:  COMMIT;
-- ⛔ لو اختلف أي رقم:               ROLLBACK;
```

---

## 6. الخطوة 4 — حذف ملفات Storage (منفصلة عن SQL)

لا يمكن حذف ملفات Storage بـSQL. سكربت Node (يُنفَّذ بعد نجاح الحذف وتأكيد النسخة الاحتياطية):

```js
// حذف مجلدات المشاريع الخمسة من bucket documents — 337 ملفاً
import { createClient } from '@supabase/supabase-js'
const sb = createClient(URL, SERVICE_ROLE_KEY)   // ⚠️ يحتاج service_role لا anon

const DELETE_IDS = [
  '3822c886-7f53-4fdb-aaa2-ef7b6d4aea63', '50b7ed07-1faa-4882-b0bc-ad3823a2a417',
  'd64b040a-0824-43b8-966e-eb41ee095f82', 'ab1c819e-441f-46ce-919b-db9f0711910b',
  'd3c001a0-1999-4171-8979-867c167eb91d',
]
const KEEP = '03149efa-1def-45ec-91b2-2d2b24e38e8c'   // مزاهر — لا يُمس

for (const pid of DELETE_IDS) {
  if (pid === KEEP) throw new Error('حماية: محاولة حذف مجلد مزاهر')
  const { data: files } = await sb.storage.from('documents').list(pid, { limit: 1000 })
  if (!files?.length) { console.log(`${pid}: لا ملفات`); continue }
  const paths = files.map(f => `${pid}/${f.name}`)
  const { error } = await sb.storage.from('documents').remove(paths)
  console.log(`${pid}: حُذف ${paths.length} ملف`, error ? `خطأ: ${error.message}` : '✅')
}
```

> ⚠️ **يحتاج `service_role` key** (من Settings → API). **لا تضعه بأي ملف داخل المستودع ولا بـ`.env` الذي يُقرأ بالواجهة** — مرّره كمتغيّر بيئة عند التشغيل فقط.
> **بديل بلا مفاتيح حساسة:** لوحة Supabase → Storage → bucket `documents` → احذف المجلدات الخمسة يدوياً بأسمائها (معرّفات المشاريع).

---

## 7. ما سيصبح كوداً ميتاً بعد الحذف

> ⛔ **معروض للمراجعة فقط — لن أحذف أي سطر قبل قرارك.**

### 7-أ. ملفات كاملة تصبح بلا أي مستخدم (1,210 سطراً)

| الملف | الأسطر | لمن؟ | مسار مرتبط بـ`App.jsx` |
|---|---:|---|---|
| [RoasterySales.jsx](src/pages/RoasterySales.jsx) | 524 | محمصة كون | `/roastery-sales` ([App.jsx:159](src/App.jsx#L159)) |
| [PayableSuppliers.jsx](src/pages/PayableSuppliers.jsx) | 415 | بـ عسل | `/payable-suppliers` ([App.jsx:99](src/App.jsx#L99)) |
| [AppReconciliation.jsx](src/pages/AppReconciliation.jsx) | 271 | بـ عسل | `/app-reconciliation` ([App.jsx:105](src/App.jsx#L105)) |
| [lib/appReconciliation.js](src/lib/appReconciliation.js) | 25 | بـ عسل | — |
| [lib/payableBalances.js](src/lib/payableBalances.js) | 8 | بـ عسل | — |

⚠️ **تنبيه:** حذف `PayableSuppliers.jsx` يُلغي مفهوم "الذمم الدائنة" كلياً. **مزاهر لا تستخدمه إطلاقاً** (0 صف بـ`payable_suppliers`، و`payable_in/out` غير مستخدمين) — فالحذف آمن، لكنه قرار منتَج لا مجرد تنظيف.

### 7-ب. شروط مربوطة بمشاريع محذوفة (تصبح دائماً `false`)

| الملف : السطر | الشرط | الأثر بعد الحذف |
|---|---|---|
| [Layout.jsx:41](src/components/Layout.jsx#L41) | `n === 'محمصة كون'` | رابط لن يظهر أبداً |
| [Layout.jsx:48](src/components/Layout.jsx#L48) | `includes('بـ عسل')` | رابط لن يظهر أبداً |
| [Layout.jsx:49](src/components/Layout.jsx#L49) | `includes('بـ عسل')` | رابط لن يظهر أبداً |
| [PendingDocuments.jsx:71](src/pages/PendingDocuments.jsx#L71) | `includes('تشورميك')` | فرع ميت |
| [PendingDocuments.jsx:74-75](src/pages/PendingDocuments.jsx#L74) | `includes('كون')` | فرع ميت |
| [PendingDocuments.jsx:246,250,253](src/pages/PendingDocuments.jsx#L246) | `isTashormik` | فرع ميت |
| [PendingDocuments.jsx:312](src/pages/PendingDocuments.jsx#L312) | `includes('تشورميك')` | فرع ميت |
| [PendingDocuments.jsx:543-544](src/pages/PendingDocuments.jsx#L543) | `=== 'محمصة كون'` | ⚠️ التحقق الإلزامي يصبح معطّلاً كلياً — **راجع القسم 7-هـ** |
| [PendingDocuments.jsx:828](src/pages/PendingDocuments.jsx#L828) | `includes('بـ عسل')` | فرع ميت |
| [InvoiceUpload.jsx:40](src/pages/InvoiceUpload.jsx#L40) + [123-130](src/pages/InvoiceUpload.jsx#L123) + [196-209](src/pages/InvoiceUpload.jsx#L196) | `includes('بـ عسل')` | منتقي مصدر الدفع لن يظهر |
| [Reports.jsx:97](src/pages/Reports.jsx#L97), [532](src/pages/Reports.jsx#L532), [993](src/pages/Reports.jsx#L993) | `isBaAsal` | تبويب "الذمم الدائنة" لن يظهر |
| [claude.js:260](src/lib/claude.js#L260) | `=== 'تشورميك'` | شرط ميت داخل البرومبت |
| [CashierDashboard.jsx:210-220](src/pages/CashierDashboard.jsx#L210) + `RoasteryMainPanel` [27-158](src/pages/CashierDashboard.jsx#L27) | `branch === 'المحمصة الرئيسية'` | ≈130 سطراً ميتاً |
| [Sales.jsx:23-35](src/pages/Sales.jsx#L23), [106-320](src/pages/Sales.jsx#L106), [323](src/pages/Sales.jsx#L323) | `isMahmasa` | ≈215 سطراً — عرض المحمصة كاملاً |
| [Login.jsx:12-38](src/pages/Login.jsx#L12) | `PROJECT_INFO` | 4 مدخلات من 5 (يبقى `mazaher` فقط) |

### 7-ج. `financialEngine.js` — أنواع لا تستخدمها مزاهر

تحققت من الأنواع الـ20 المستخدمة فعلياً بمزاهر. **الأنواع التالية لن يبقى لها أي صف بقاعدة البيانات:**

```
SALES_TYPES (يُحذف منها 10 من 12):
  ❌ مبيعات تحويل · مبيعات هنقر ستيشن · مبيعات جاهز · مبيعات كيتا
  ❌ مبيعات مرسول · مبيعات سلة · مبيعات تابي · مبيعات تمارا
  ❌ تحصيل جملة · مبيعات إلكترونية
  ✅ يبقى: مبيعات كاش · مبيعات شبكة

WITHDRAWALS_TYPES: ❌ مسحوبات الشركاء   (✅ سليمان/فايز/أم طوبى/مسحوبات تبقى — مزاهر تستخدمها)
DEBT_TYPES:        ❌ قرض ٢ · قرض 1 · قرض 2 · قرض نقاط البيع   (✅ قسط سيارة/قسط شراء أرض/قرض ١/قسط تبقى)
COGS_TYPES:        ❌ ☕ مشتريات قهوة ومواد · 📦 مواد تعبئة وتغليف   (✅ 🥩 تكلفة البضاعة المباعة تبقى)
```

> ✅ **أسماء الشركاء تبقى مبرَّرة:** `مسحوبات سليمان`/`فايز`/`أم طوبى` تخص مزاهر نفسها وتُستخدم فعلياً. زرعها بالكود يبقى مشكلة معمارية (البند 4 بتقرير review-1)، لكنها **ليست كوداً ميتاً**.

### 7-د. مسارات وتبعيات مرتبطة

- [App.jsx:99-109](src/App.jsx#L99)، [159-163](src/App.jsx#L159): ثلاثة مسارات + `import` لثلاث صفحات
- `pdf-lib` — تُستخدم بـ[BankReconciliation.jsx:2](src/pages/BankReconciliation.jsx#L2) فقط. **مزاهر لا تستخدم المطابقة البنكية حالياً** (لا فروع، ولا كشوف) — لكن الصفحة متاحة لدور المحاسب بكل المشاريع، فلا تصبح ميتة تقنياً. **قرارك.**

### 7-هـ. ⚠️ ثلاثة تنبيهات قبل الحذف

**1. حذف شرط محمصة كون يُلغي التحقق الإلزامي كلياً**
[PendingDocuments.jsx:543](src/pages/PendingDocuments.jsx#L543) هو **الموضع الوحيد** الذي يمنع اعتماد مستند بلا تصنيف أو مصدر دفع. حذفه بحجة "كود ميت" يزيل حارساً محاسبياً حقيقياً. **التوصية: لا يُحذف — بل يُعمَّم على كل المشاريع** (كما فُعل مع حالة "تحويل" بـcommit `54e69cc`).

**2. مزاهر بلا فروع إطلاقاً**
كل قيودها الـ398 لها `branch = null`، و`settings.branches = null`. ⇒ منطق الفروع كله (منتقي الفرع، فلتر الفرع بالتقارير، `applyBranch`، معامل الفرع الذي أضفته للتو بـ`financialEngine`) يصبح **بلا أثر عملي** — لكنه **ليس ميتاً** (يعمل بصمت مع `null`). أنصح بإبقائه: إزالته تعني إعادة بنائه لأي عميل قادم.

**3. `modules` لمزاهر = `[]` فارغة**
⇒ رابط "الموردين" ([Layout.jsx:42](src/components/Layout.jsx#L42)، `module: 'suppliers'`) **لا يظهر لمزاهر أصلاً**، وصفحة [Suppliers.jsx](src/pages/Suppliers.jsx) (327 سطراً) غير مستخدمة عملياً. لم أدرجها بقائمة الحذف لأنها ليست مربوطة بمشروع محذوف — لكنها مرشّحة للمراجعة.

---

## 8. الترتيب التنفيذي المقترح

| # | الخطوة | قابلية التراجع |
|:--:|---|---|
| 1 | نسخة احتياطية خارجية (Supabase Backups أو `pg_dump`) | — |
| 2 | أرشيف داخلي `archive_2026_08` (القسم 3-أ) + تحقق الأعداد | — |
| 3 | فحوص ما قبل الحذف (القسم 4) | — |
| 4 | معاملة الحذف + مراجعة الأعداد قبل `COMMIT` (القسم 5) | ✅ `ROLLBACK` متاح قبل الاعتماد |
| 5 | التحقق من التطبيق حياً بمزاهر (تسجيل دخولك) | — |
| 6 | حذف ملفات Storage (القسم 6) | ❌ **نهائي** |
| 7 | تنظيف الكود الميت (القسم 7) — بموافقة منفصلة | ✅ عبر git |

> **الخطوة 5 قبل 6 عمداً:** تحقّق أن التطبيق يعمل بمزاهر **قبل** حذف الملفات نهائياً. حذف Storage غير قابل للتراجع إطلاقاً.
>
> 💡 **اقتراح:** أجّل حذف سكيما `archive_2026_08` أسبوعين على الأقل بعد التأكد من استقرار كل شيء. حجمها ضئيل ولا تكلّف شيئاً.

**لم يُنفَّذ أي حذف، ولم يُعدَّل أي ملف كود أو صف بيانات أثناء إعداد هذه الخطة.**
