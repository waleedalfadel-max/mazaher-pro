# الدفعة 3 — تفعيل RLS على الـ11 جدولاً الباقية (الخطة النهائية)

> **تخطيط فقط. لا SQL نُفِّذ.** يفترض هذا المستند نجاح الدفعة 2-أ (مؤكَّد: كل الأدوار الخمسة لها `auth_id` حقيقي).

## 0. تصحيح ضروري قبل البدء — إصلاح توقيت منح الجلسة (كود، لا SQL)

مفصَّل بالرسالة أعلاه. **بند منفصل يحتاج موافقتك أولاً**، مستقل عن ترتيب الجداول:

```js
// AuthContext.jsx — بدل: mintPinSession(user.id, pin)
await Promise.race([
  mintPinSession(user.id, pin),
  new Promise(resolve => setTimeout(resolve, 3000)),
])
```
`mintPinSession` نفسها تبقى بلا تغيير (تُغلَّف أصلاً بـ`try/catch` داخلياً، فلا ترمي أبداً). أضيف مهلة 3 ثوانٍ كحدّ أقصى للتأخير — أطول من الزمن الطبيعي للعملية (~300مللي-1 ثانية) بهامش كافٍ، لكن يمنع التجمّد لو تعطّل الخادم.

## 1. تأكيد سريع — حالة Tier 0

فحصت الدالتين المساعدتين: **موجودتان وتعملان** (`auth_project_id()`, `auth_is_superadmin()`) — يعني شغّلت الجزء الأول من كتلة SQL على الأقل. لم أستطع التأكد بلا تدمير من أن `loans`/`branches` وصلا فعلياً لـ`ENABLE ROW LEVEL SECURITY` (الفحص غير المباشر بمفتاح anon كان حاسماً فقط لو قبلتُ إدراج صف تجريبي حقيقي، وتجنّبت ذلك). **أكِّد لي أنك شغّلت الكتلة كاملة** (حتى `CREATE POLICY branches_project_isolation`) — إن لم تكن متأكداً، أرسل السطر الأخير الذي وصلت له، أو أعد تشغيل الكتلة كاملة (كل أوامرها `IF NOT EXISTS`/`CREATE OR REPLACE` — آمنة التكرار).

## 2. الترتيب — 7 دفعات صغيرة، كل دفعة بجلسة تحقق مستقلة

نفس ترتيب الخطورة المعتمد بـ`plan-rls-phase2.md` (استدعاءات أقل + دور أضيق أولاً)، مجمَّعاً بحسب من يلمس ماذا فعلياً بمزاهر اليوم:

| الدفعة | الجداول | الأدوار اللامسة | لماذا هذا التجميع |
|---|---|---|---|
| **أ** | `supplier_transactions`, `suppliers`, `payable_suppliers` | accountant | الثلاثة فارغة اليوم (0 صف)، ومسارا `PayableSuppliers.jsx`/جزء من `InvoiceUpload.jsx` مقفلان لمزاهر أصلاً (مقيّدان بـ`'بـ عسل'`) — أضيق أثر ممكن |
| **ب** | `document_items`, `attachments` | accountant | مرتبطان بتدفّق اعتماد المستندات — نفس الصفحة (`PendingDocuments.jsx`) |
| **جـ** | `quick_sales_draft` | **cashier فقط** | معزول تماماً بصفحة واحدة (`QuickSale.jsx`) |
| **د** | `categories`, `project_settings` | purchasing, cashier, accountant (الأوسع تدريجياً) | يغذّيان قوائم اختيار بصفحات متعددة، لا كتابة مباشرة من المستخدم غالباً |
| **هـ** | `sales` | owner, accountant, cashier | إيرادات — يستحق دفعة منفردة |
| **و** | `documents` | **كل الأدوار غير superadmin** (الأوسع بين الـ11) | رفع الفواتير بكل الأدوار |
| **ز** | `ledger_entries` | owner, accountant, cashier | **الأخطر — قلب النظام، 43 استدعاءً بالكود.** أخيراً بعد نجاح الست دفعات السابقة |

## 3. السياسة — نفس القالب لكل جدول

```sql
ALTER TABLE <T> ENABLE ROW LEVEL SECURITY;
CREATE POLICY <T>_project_isolation ON <T> FOR ALL
  USING (project_id = auth_project_id() OR auth_is_superadmin())
  WITH CHECK (project_id = auth_project_id() OR auth_is_superadmin());
```
**التراجع الفوري لأي جدول (نفس الأمر دائماً):**
```sql
ALTER TABLE <T> DISABLE ROW LEVEL SECURITY;
```

## 4. خطة التحقق — محدَّدة لكل دفعة، لا "افتح الصفحة وشوف"

### دفعة أ — `supplier_transactions`, `suppliers`, `payable_suppliers`
```sql
ALTER TABLE supplier_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_transactions_project_isolation ON supplier_transactions FOR ALL
  USING (project_id = auth_project_id() OR auth_is_superadmin())
  WITH CHECK (project_id = auth_project_id() OR auth_is_superadmin());

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY suppliers_project_isolation ON suppliers FOR ALL
  USING (project_id = auth_project_id() OR auth_is_superadmin())
  WITH CHECK (project_id = auth_project_id() OR auth_is_superadmin());

ALTER TABLE payable_suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY payable_suppliers_project_isolation ON payable_suppliers FOR ALL
  USING (project_id = auth_project_id() OR auth_is_superadmin())
  WITH CHECK (project_id = auth_project_id() OR auth_is_superadmin());
```
**تحقق:**
1. دخول accountant → صفحة **الموردين** (`Suppliers.jsx`) → **أضف مورداً جديداً** (اختبار كتابة حقيقي، لا قراءة فقط — الجدول فارغ فلا معنى لاختبار قراءة وحدها). يجب أن يظهر بالقائمة فوراً.
2. دخول accountant → **التقارير** → تأكد التحميل بلا خطأ console (Reports.jsx يستعلم `payable_suppliers` دائماً بصرف النظر عن ظهور تبويبها).
3. ⚠️ ملاحظة صريحة: `PayableSuppliers.jsx` نفسها مقفلة لمزاهر (`TARGET_PROJECT = 'بـ عسل'`) — لا تتوقع محتوى بتلك الصفحة تحديداً، هذا متوقَّع وليس عطلاً.

### دفعة ب — `document_items`, `attachments`
```sql
ALTER TABLE document_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_items_project_isolation ON document_items FOR ALL
  USING (project_id = auth_project_id() OR auth_is_superadmin())
  WITH CHECK (project_id = auth_project_id() OR auth_is_superadmin());

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY attachments_project_isolation ON attachments FOR ALL
  USING (project_id = auth_project_id() OR auth_is_superadmin())
  WITH CHECK (project_id = auth_project_id() OR auth_is_superadmin());
```
**تحقق:** دخول accountant → **مستندات جديدة** (`PendingDocuments.jsx`) → افتح مستنداً فيه بنود متعددة (239 بنداً موجودة اليوم — أي فاتورة بها أكثر من بند) → تأكد ظهور البنود بالتفصيل كما كانت → اعتمد مستنداً تجريبياً كاملاً (اختبار كتابة على `document_items`) → تأكد ظهوره بـ**سجل الحركات** (`JournalLedger.jsx`، يستعلم `attachments`).

### دفعة جـ — `quick_sales_draft`
```sql
ALTER TABLE quick_sales_draft ENABLE ROW LEVEL SECURITY;
CREATE POLICY quick_sales_draft_project_isolation ON quick_sales_draft FOR ALL
  USING (project_id = auth_project_id() OR auth_is_superadmin())
  WITH CHECK (project_id = auth_project_id() OR auth_is_superadmin());
```
**تحقق:** دخول **cashier** → **الإدخال السريع للمبيعات** → سجّل عملية (كاش أو شبكة) → تأكد ظهورها بقائمة "عمليات اليوم" فوراً → **لا تُقفل اليوم بعد** (اترك القيد بلا إقفال، أو أقفله إن لم يهم — الصفوف الموجودة أصلاً بالجدول هي بيانات يوم عمل مزاهر الحقيقي الحالي، انتبه ألا تقفله بالخطأ أثناء الاختبار لو لم يكن ذلك مقصوداً).

### دفعة د — `categories`, `project_settings`
```sql
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY categories_project_isolation ON categories FOR ALL
  USING (project_id = auth_project_id() OR auth_is_superadmin())
  WITH CHECK (project_id = auth_project_id() OR auth_is_superadmin());

ALTER TABLE project_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_settings_project_isolation ON project_settings FOR ALL
  USING (project_id = auth_project_id() OR auth_is_superadmin())
  WITH CHECK (project_id = auth_project_id() OR auth_is_superadmin());
```
**تحقق:**
1. دخول **purchasing** → **رفع فاتورة** → تأكد ظهور قائمة "نوع المادة" (تُبنى من `categories` عبر `getProjectSettings`).
2. دخول **cashier** بفرع المحمصة الرئيسية (إن وُجد بالبيانات) أو أي كاشير → تأكد تحميل الصفحة بلا خطأ (تعتمد `project_settings` لأنواع الحركة).
3. دخول accountant → **إدارة العملاء/الإعدادات** إن كانت متاحة → تأكد قراءة/تعديل الأنواع يعمل (كتابة على `project_settings`).

### دفعة هـ — `sales`
```sql
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_project_isolation ON sales FOR ALL
  USING (project_id = auth_project_id() OR auth_is_superadmin())
  WITH CHECK (project_id = auth_project_id() OR auth_is_superadmin());
```
**تحقق:** دخول owner أو accountant → **لوحة التحكم** → تأكد ظهور رقم المبيعات كما كان قبل التفعيل بالضبط (قارن رقماً محدداً تعرفه مسبقاً، لا "يبدو معقولاً" فقط) → **التقارير** → نفس المقارنة على `data.totalSales`.

### دفعة و — `documents`
```sql
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY documents_project_isolation ON documents FOR ALL
  USING (project_id = auth_project_id() OR auth_is_superadmin())
  WITH CHECK (project_id = auth_project_id() OR auth_is_superadmin());
```
**تحقق (الأوسع أثراً — اختبر الأربعة أدوار):**
1. **purchasing** → رفع فاتورة جديدة (كتابة) → تأكد ظهورها بقائمة "آخر المستندات المرفوعة".
2. **cashier** → نفس الاختبار من `CashierDashboard.jsx`.
3. **accountant** → **مستندات جديدة** → تأكد ظهور الـ276 مستنداً الموجودة (أو ما تبقى) كاملة، لا نقص.
4. **owner** → أي صفحة تعرض حالة المستندات → تأكد التحميل الطبيعي.

### دفعة ز — `ledger_entries` (الأخيرة، الأخطر)
```sql
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY ledger_entries_project_isolation ON ledger_entries FOR ALL
  USING (project_id = auth_project_id() OR auth_is_superadmin())
  WITH CHECK (project_id = auth_project_id() OR auth_is_superadmin());
```
**تحقق (الأشمل بكل الدفعة):**
1. **accountant** → **الدفتر** → قارن رقم "الرصيد الحالي" (صندوق/بنك/عهدة) بما كان قبل التفعيل بالضبط.
2. **accountant** → اعتماد مستند من `PendingDocuments.jsx` (كتابة قيد جديد) → تأكد ظهوره فوراً بالدفتر.
3. **owner** → **لوحة التحكم** → قارن صافي الربح المعروض (من `financialEngine.js`) برقم معروف مسبقاً.
4. **cashier** → **الإدخال السريع** → أقفل يوم عمل حقيقياً (كتابة قيد `ledger_entries` من هذا المسار تحديداً) → تأكد ظهوره بالدفتر.
5. **superadmin** → **إدارة العملاء** → تأكد رؤية إحصائيات مزاهر كاملة (يعتمد `auth_is_superadmin()` لا `auth_project_id()`).

## 5. بعد كل دفعة
- نجاح كامل → انتقل للدفعة التالية بجلسة منفصلة أو بنفس الجلسة إن كان الوقت يسمح.
- أي فشل → `ALTER TABLE <T> DISABLE ROW LEVEL SECURITY;` فوراً لذلك الجدول تحديداً (لا تراجع بقية الدفعة إن نجحت جداولها الأخرى)، ثم أخبرني بالضبط: أي دور، أي صفحة، أي رسالة/سلوك.

**لم يُنفَّذ أي SQL ولا كود أثناء إعداد هذا المستند.**
