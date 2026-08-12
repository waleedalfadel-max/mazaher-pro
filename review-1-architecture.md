# جولة مراجعة 1 من 5 — المعمارية والتخصيص لكل عميل

> **تشخيص فقط — لم يُعدَّل أي سطر كود.** أرقام الأسطر تعود لحالة المستودع عند commit `8320ca5`.
> إجمالي `src/`: 11,895 سطراً بـ36 ملفاً.

---

## 1. الشروط المربوطة بعميل بعينه

وجدت **24 موضعاً** يقارن اسم مشروع أو فرعاً أو معرّفاً ثابتاً. مصنّفة حسب الخطورة:

### 1-أ. تخصيص التنقّل والوصول للصفحات (5 مواضع)

| # | الملف : السطر | الشرط | ما يفعله |
|---|---|---|---|
| 1 | [Layout.jsx:39](src/components/Layout.jsx#L39) | `n === 'ديوانية مزاهر'` | يُظهر رابط "إدخال سريع للمبيعات" للكاشير |
| 2 | [Layout.jsx:41](src/components/Layout.jsx#L41) | `n === 'محمصة كون'` | يُظهر رابط "مبيعات المحمصة" للمحاسب |
| 3 | [Layout.jsx:48](src/components/Layout.jsx#L48) | `(n\|\|'').includes('بـ عسل')` | يُظهر رابط "الذمم الدائنة" |
| 4 | [Layout.jsx:49](src/components/Layout.jsx#L49) | `(n\|\|'').includes('بـ عسل')` | يُظهر رابط "مطابقة التطبيقات" |
| 5 | [Reports.jsx:97](src/pages/Reports.jsx#L97) → [532](src/pages/Reports.jsx#L532)، [993](src/pages/Reports.jsx#L993) | `isBaAsal` | يُظهر/يُخفي تبويب "الذمم الدائنة" داخل التقارير |

**ملاحظة تناقض:** السطر 39 و41 يستخدمان `===` (مطابقة تامة)، بينما 48 و49 يستخدمان `includes`. لو غُيّر اسم مشروع مزاهر لـ"ديوانية مزاهر ☕" بلوحة Super Admin — يختفي رابط الكاشير فوراً وبلا أي رسالة خطأ. هذا **هشّ جداً**: اسم المشروع حقل نصي قابل للتحرير من الواجهة، ومربوط به منطق وصول.

### 1-ب. حرّاس صفحات كاملة (2)

| # | الملف : السطر | الشرط | ما يفعله |
|---|---|---|---|
| 6 | [PayableSuppliers.jsx:9](src/pages/PayableSuppliers.jsx#L9)، [59](src/pages/PayableSuppliers.jsx#L59) | `TARGET_PROJECT = 'بـ عسل'` | الصفحة كلها ترفض العرض لأي مشروع آخر |
| 7 | [AppReconciliation.jsx:11](src/pages/AppReconciliation.jsx#L11)، [64](src/pages/AppReconciliation.jsx#L64) | `TARGET_PROJECT = 'بـ عسل'` | نفس الحارس |

هذان الأفضل بنيوياً (ثابت مسمّى بأعلى الملف بدل نص مبعثر)، لكنهما لا يزالان مربوطين بالاسم.

### 1-ج. منطق مالي مشروط بالعميل — **الأخطر** (7)

| # | الملف : السطر | الشرط | ما يفعله |
|---|---|---|---|
| 8 | [PendingDocuments.jsx:71](src/pages/PendingDocuments.jsx#L71) | `projName?.includes('تشورميك')` | مصدر الدفع الافتراضي = `bank` |
| 9 | [PendingDocuments.jsx:74](src/pages/PendingDocuments.jsx#L74) | `includes('كون') && uploadedBy==='purchasing'` | افتراضي = `bank` |
| 10 | [PendingDocuments.jsx:75](src/pages/PendingDocuments.jsx#L75) | `includes('كون') && uploadedBy==='accountant'` | افتراضي = `bank` |
| 11 | [PendingDocuments.jsx:246](src/pages/PendingDocuments.jsx#L246) | `isTashormik` | يفرض `bank` **متجاوزاً** قراءة الذكاء الاصطناعي |
| 12 | [PendingDocuments.jsx:312](src/pages/PendingDocuments.jsx#L312) | `includes('تشورميك') ? 'bank' : (paySource\|\|'custody')` | يحدد الحساب الذي يُخصم منه القيد فعلياً |
| 13 | [PendingDocuments.jsx:543](src/pages/PendingDocuments.jsx#L543) | `docProjName === 'محمصة كون'` | يفرض تحقق إلزامي (تصنيف + مصدر دفع) قبل الاعتماد |
| 14 | [claude.js:260](src/lib/claude.js#L260) | `projectName === 'تشورميك'` | يغيّر **نص البرومبت** المُرسل للذكاء الاصطناعي |

> ⚠️ **الموضع 9 و10 خطر كامن:** الشرط `includes('كون')` يطابق أي مشروع يحتوي حرفي "كون" — مثلاً "بـ عسل كونتيننتال" أو "كوني كافيه" سيرث سلوك محمصة كون المالي بصمت. وأخطر: `includes('كون')` **لا يطابق** "محمصة كون" فقط، بل أي اسم فيه كلمة "كون" — وهذا يشمل كلمات عربية شائعة.
>
> ⚠️ **الموضع 13 مقترن بخلل معروف:** التحقق الإلزامي محصور بمحمصة كون رغم أنه قاعدة محاسبية عامة. (أُصلحت جزئياً لحالة "تحويل" بجميع المشاريع في commit `54e69cc`، لكن بقية التحقق ما زالت محصورة.)

### 1-د. تخصيص واجهات وفروع (6)

| # | الملف : السطر | الشرط | ما يفعله |
|---|---|---|---|
| 15 | [CashierDashboard.jsx:210](src/pages/CashierDashboard.jsx#L210) | `branch === 'المحمصة الرئيسية'` | يستبدل الصفحة كلياً بلوحة إدخال مبيعات |
| 16 | [CashierDashboard.jsx:297](src/pages/CashierDashboard.jsx#L297) | `projectName === 'ديوانية مزاهر'` | يعرض بانر توجيه لـQuickSale |
| 17 | [Sales.jsx:323](src/pages/Sales.jsx#L323) → [380](src/pages/Sales.jsx#L380) | `projectName === 'محمصة كون'` | فرعان مختلفان كلياً بنفس الصفحة (عرض مختلف + استعلامات مختلفة) |
| 18 | [Sales.jsx:130](src/pages/Sales.jsx#L130) | `.eq('branch','المحمصة الرئيسية')` | استعلام مقيّد بفرع باسمه النصي |
| 19 | [RoasterySales.jsx:8](src/pages/RoasterySales.jsx#L8) | `const BRANCH = 'المحمصة الرئيسية'` | كل قيود الصفحة تُكتب بهذا الفرع |
| 20 | [PendingDocuments.jsx:828](src/pages/PendingDocuments.jsx#L828) | `includes('بـ عسل')` | يُخفي منتقي الفرع |
| 21 | [InvoiceUpload.jsx:40](src/pages/InvoiceUpload.jsx#L40) | `role==='purchasing' && includes('بـ عسل')` | يُظهر منتقي مصدر الدفع |

### 1-هـ. أسماء أشخاص وقروض مزروعة بالكود (3) — **مفاجئ**

| # | الملف : السطر | الثابت | ما يفعله |
|---|---|---|---|
| 22 | [financialEngine.js:20](src/lib/financialEngine.js#L20) | `'مسحوبات سليمان'، 'مسحوبات فايز'، 'مسحوبات أم طوبى'` | **أسماء شركاء حقيقيين** بمحرّك مالي عام |
| 23 | [financialEngine.js:26-30](src/lib/financialEngine.js#L26) | `'قرض ١'، 'قرض ٢'، 'قسط سيارة'، 'قسط شراء أرض'` | تصنيف الديون |
| 24 | [Loans.jsx:5-10](src/pages/Loans.jsx#L5) + [Reports.jsx:255](src/pages/Reports.jsx#L255) | نفس القائمتين مكررتين | حساب الأقساط والمسحوبات |

هذي أعمق مشكلة تخصيص بالمشروع: **محرّك التقارير المالية "العام" يحتوي أسماء شركاء ديوانية مزاهر**. أي عميل جديد بأسماء شركاء مختلفة، مسحوباته لن تُصنَّف إطلاقاً — وستُحسب خطأً كمصروف تشغيلي يخفّض صافي الربح.

### 1-و. خارج النطاق تقنياً لكن مذكور للاكتمال

[Login.jsx:12-38](src/pages/Login.jsx#L12) — خريطة `PROJECT_INFO` تربط 5 subdomains بأسماء وألوان ترحيب. أقل خطورة (تجميلية فقط، والصفحة تعمل بدونها عبر `|| null`)، لكنها تعني أن كل عميل جديد يحتاج تعديل كود + إعادة نشر ليظهر اسمه بشاشة الدخول.

---

## 2. اقتراح مفاتيح الميزات (feature flags)

### الخبر الجيد: البنية التحتية **موجودة أصلاً وغير مستغَلة**

جدول `project_settings` فيه عمود `modules` مستخدم فعلياً — [Layout.jsx:42](src/components/Layout.jsx#L42) و[58](src/components/Layout.jsx#L58):

```js
{ to: '/suppliers', ..., module: 'suppliers' },   // ✅ النمط الصحيح
(!item.module || modules.includes(item.module)) &&
```

بينما الأربعة الأخرى بنفس المصفوفة تستخدم `cond: n => n === '...'` ❌. أي أن **النمط الصحيح مطبّق بسطر واحد فقط من خمسة**. الإصلاح لا يحتاج بنية جديدة — يحتاج نقل الأربعة الباقية لنفس الآلية.

### الشكل المقترح لـ `project_settings.settings`

```jsonc
{
  "transaction_types": [ /* موجود حالياً */ ],
  "branches":          [ /* موجود حالياً */ ],

  "features": {
    "quick_sale":          true,   // مواضع 1، 16
    "roastery_sales":      false,  // مواضع 2، 15، 18، 19
    "payable_suppliers":   false,  // مواضع 3، 6، 5
    "app_reconciliation":  false,  // مواضع 4، 7
    "explicit_pay_source": false,  // موضع 21
    "strict_approval":     true,   // موضع 13 — يُنصح بجعله true افتراضياً للجميع
    "single_branch":       false   // موضع 20 — يُخفي منتقي الفرع
  },

  "defaults": {
    "pay_source": {                // مواضع 8، 9، 10، 11، 12، 14
      "force":  null,              // "bank" = فرض مطلق (حالة تشورميك)
      "by_role": {                 // بديل مرن يغني عن getDefaultPaySource كلياً
        "cashier":    "cash",
        "purchasing": "custody",
        "accountant": "bank",
        "owner":      "bank"
      }
    },
    "main_branch": null            // بديل نص "المحمصة الرئيسية" المزروع
  },

  "accounting": {                  // مواضع 22، 23، 24 — الأهم
    "withdrawal_types": ["مسحوبات سليمان", "مسحوبات فايز"],
    "debt_types":       ["قسط سيارة", "قرض ١", "قرض ٢"],
    "cogs_types":       ["تكلفة البضاعة المباعة"]
  }
}
```

### ملاحظات تنفيذية مهمة

1. **`features` أفضل من `modules` المسطّح** — لأن `modules` مصفوفة نصوص لا تحتمل قيماً (مثل `pay_source.force = "bank"`). الأنسب: إبقاء `modules` للتوافق الخلفي + إضافة `features`/`defaults`/`accounting` ككائنات.

2. **`accounting` يجب أن يمرّ عبر `financialEngine`** كوسيط اختياري:
   ```js
   getFinancialSummary(projectId, from, to, { accounting })
   ```
   وإلا تبقى أسماء الشركاء مزروعة. مع بقاء القوائم الحالية كـ`FALLBACK` (نفس نمط `FALLBACK_TYPES` بـ[projectSettings.js:3](src/lib/projectSettings.js#L3)) لئلا تنكسر المشاريع القائمة.

3. **`defaults.main_branch` يحل مشكلة مختلفة عن الباقي** — "المحمصة الرئيسية" ليس اسم مشروع بل اسم **فرع**، مخزّن فعلياً بـ`app_users.branch` وبعمود `ledger_entries.branch`. نقله لإعداد يمنع كسر البيانات لو أُعيدت تسمية الفرع.

4. **`AuthContext` يحتاج تمرير `features`** — حالياً يمرّر `modules` فقط ([AuthContext.jsx:108](src/contexts/AuthContext.jsx#L108)، [151](src/contexts/AuthContext.jsx#L151)). إضافة `features` لنفس المسار = تغيير سطرين، وتصبح متاحة لكل الصفحات عبر `useAuth()`.

5. **لوحة Super Admin تحتاج واجهة تحرير لها** — حالياً [SuperAdmin.jsx:166-175](src/pages/SuperAdmin.jsx#L166) يحرّر `transaction_types` فقط. بدون واجهة، المفاتيح ستحتاج تعديل SQL يدوي لكل عميل (أفضل من إعادة نشر، لكن ليس الهدف النهائي).

### ما **لا** يُنصح بنقله

- [Login.jsx:12-38](src/pages/Login.jsx#L12) `PROJECT_INFO` — الحل الأصح ليس feature flag بل قراءة الاسم/اللون من جدول `projects` مباشرة عبر الـsubdomain (استعلام واحد قبل تسجيل الدخول)، لأن البيانات موجودة أصلاً بقاعدة البيانات.
- [Sales.jsx:323](src/pages/Sales.jsx#L323) `isMahmasa` — الفرعان مختلفان جذرياً (مصادر بيانات وواجهات مختلفة). الأنسب فصلهما لمكوّنين مستقلين ثم تفعيل أحدهما بـ`features.roastery_sales`، لا مجرد استبدال الشرط.

---

## 3. أكبر 10 ملفات ومسؤولياتها

| # | الملف | الأسطر | واجهة | منطق أعمال | وصول DB | التقييم |
|---|---|---:|:---:|:---:|:---:|---|
| 1 | `pages/PendingDocuments.jsx` | **1,557** | ✅ | ✅ | ✅ | 🔴 **الأسوأ** |
| 2 | `pages/Reports.jsx` | **1,554** | ✅ | ✅ | ✅ | 🔴 **حرج** |
| 3 | `pages/Dashboard.jsx` | 829 | ✅ | ✅ | ✅ | 🟠 |
| 4 | `pages/SuperAdmin.jsx` | 547 | ✅ | ⚠️ | ✅ | 🟡 |
| 5 | `pages/RoasterySales.jsx` | 524 | ✅ | ✅ | ✅ | 🟠 |
| 6 | `pages/JournalArchive.jsx` | 501 | ✅ | ⚠️ | ✅ | 🟡 |
| 7 | `lib/claude.js` | 491 | ❌ | ✅ | ❌ | 🟢 مقبول |
| 8 | `pages/Sales.jsx` | 480 | ✅ | ✅ | ✅ | 🟠 |
| 9 | `pages/BankReconciliation.jsx` | 479 | ✅ | ⚠️ | ✅ | 🟢 **الأفضل** |
| 10 | `pages/JournalLedger.jsx` | 471 | ✅ | ⚠️ | ✅ | 🟡 |

### تفصيل الحالتين الحرجتين

**`PendingDocuments.jsx` (1,557 سطر)** — ملف واحد يحوي:
- 3 مكوّنات React (`PendingDocuments`, `DocCard`, `ItemRow`, `InvoiceSubPanel` = 4 فعلياً)
- `_approveOne` ([السطر 309](src/pages/PendingDocuments.jsx#L309)) — **دالة واحدة بـ200 سطر** فيها 5 فروع محاسبية مختلفة (مبيعات / تحويل / آجل / مصروف ببنود / مصروف بسيط)، كل فرع يبني صف `ledger_entries` بيده.
- منطق تصنيف مالي: `resolveItemCategoryMain`, `resolveInvoiceType`, `getDefaultPaySource`
- كشف تكرار (`checkLedgerDup`)، مطابقة موردين، إنشاء موردين جدد
- 12+ استعلام Supabase مباشر

**الاستخراج الموصى به:** `lib/documentApproval.js` (دوال خالصة تبني صفوف الدفتر) + `lib/documentClassification.js`. الفائدة الكبرى: يصبح `_approveOne` قابلاً للاختبار — وهو أخطر كود بالمشروع (يكتب قيوداً مالية نهائية) وحالياً **غير قابل للاختبار إطلاقاً** لأنه محشور داخل مكوّن React.

**`Reports.jsx` (1,554 سطر)** — أسوأ من ناحية التماسك:
- 9 استعلامات متوازية داخل `Promise.all` ([السطور 216-238](src/pages/Reports.jsx#L216))
- حسابات مالية محلية تناقض `financialEngine` (تفصيلها بالقسم 5)
- توليد PDF بمكانين ([339](src/pages/Reports.jsx#L339)، [384](src/pages/Reports.jsx#L384))
- 6+ تبويبات، كل واحد فعلياً صفحة مستقلة

### الاستثناء المضيء 🟢

`BankReconciliation.jsx` هو **النموذج الصحيح الوحيد** بالمشروع: منطق المطابقة الخالص مستخرج بالكامل لـ[`lib/bankReconciliation.js`](src/lib/bankReconciliation.js) (`matchLinesToLedger`, `computeNetworkAggregate`, `buildLedgerInsertRow`) — دوال بلا React ولا Supabase. نفس النمط بـ[`lib/appReconciliation.js`](src/lib/appReconciliation.js) و[`lib/payableBalances.js`](src/lib/payableBalances.js) و[`lib/supplierMatching.js`](src/lib/supplierMatching.js).

**الاستنتاج:** المشروع يعرف النمط الصحيح ويطبّقه — لكن فقط بالميزات المضافة حديثاً. الملفات الأقدم (PendingDocuments، Reports، Dashboard) لم تُعاد هيكلتها بعد.

---

## 4. المنطق المكرر حرفياً

### 4-أ. 🔴 `fmtDate` — **11 ملفاً**

نسخة متطابقة حرفياً بـ:
[claude.js:56](src/lib/claude.js#L56) · [BankReconciliation:22](src/pages/BankReconciliation.jsx#L22) · [CashierDashboard:23](src/pages/CashierDashboard.jsx#L23) · [Dashboard:43](src/pages/Dashboard.jsx#L43) · [JournalArchive:150](src/pages/JournalArchive.jsx#L150) · [JournalLedger:9](src/pages/JournalLedger.jsx#L9) · [Ledger:31](src/pages/Ledger.jsx#L31) · [PendingDocuments:11](src/pages/PendingDocuments.jsx#L11) · [Reports:22](src/pages/Reports.jsx#L22) · [RoasterySales:16](src/pages/RoasterySales.jsx#L16) · [Sales:37](src/pages/Sales.jsx#L37)

> **هذا التكرار هو السبب المباشر لخلل `toISOString()` الذي استغرق 4 جولات إصلاح منفصلة** (commits `803bd65`, `da96dd2` وما قبلهما). كل موضع أُصلح على حدة لأنه لا يوجد مصدر واحد. **الأولوية القصوى للتوحيد** — لأن الخلل سيتكرر حتماً مع أي ملف جديد يُنشأ بنفس النمط.
>
> ⚠️ **تحذير تسمية:** [JournalLedger.jsx:74](src/pages/JournalLedger.jsx#L74) فيه `const fmtDate` **مختلف تماماً** (`toLocaleDateString('en-GB')` للعرض) داخل مكوّن، يظلّل الدالة العامة بنفس الملف. أي توحيد يجب أن يعيد تسمية أحدهما (مقترح: `toISODate` للحساب، `formatDisplayDate` للعرض).

### 4-ب. 🔴 حساب الفترات السريعة — **6 نسخ**

| الشكل | المواضع |
|---|---|
| `getRange(type)` | [Dashboard:180](src/pages/Dashboard.jsx#L180) · [JournalArchive:154](src/pages/JournalArchive.jsx#L154) · [Ledger:35](src/pages/Ledger.jsx#L35) · [Sales:41](src/pages/Sales.jsx#L41) |
| `setQuick(type)` (نفس المنطق مضمّناً) | [JournalArchive:218](src/pages/JournalArchive.jsx#L218) · [JournalLedger:228](src/pages/JournalLedger.jsx#L228) |

`JournalArchive.jsx` فيه **الاثنان معاً** — `getRange` و`setQuick` بنفس الملف.

### 4-ج. 🟠 `normCat` — مُصدَّرة أصلاً ومُعاد تعريفها

[bankReconciliation.js:3](src/lib/bankReconciliation.js#L3) يُصدّرها ✅ ويستوردها [AppReconciliation:6](src/pages/AppReconciliation.jsx#L6) و[BankReconciliation:6](src/pages/BankReconciliation.jsx#L6) — بينما [PendingDocuments.jsx:37](src/pages/PendingDocuments.jsx#L37) **يعيد كتابتها حرفياً** بدل استيرادها. أسهل إصلاح بالقائمة كلها: حذف سطر + إضافة استيراد.

### 4-د. 🟠 `toBase64` — 4 نسخ متطابقة

[AppReconciliation:15](src/pages/AppReconciliation.jsx#L15) · [CashierDashboard:10](src/pages/CashierDashboard.jsx#L10) · [InvoiceUpload:11](src/pages/InvoiceUpload.jsx#L11) · [RoasterySales:33](src/pages/RoasterySales.jsx#L33)

موقعها الطبيعي [`lib/storage.js`](src/lib/storage.js) (فيه `fetchAsBase64` أصلاً).

### 4-هـ. 🟠 قوائم أنواع الملفات المسموحة — 5 نسخ بـ3 تعريفات مختلفة

| التعريف | المواضع |
|---|---|
| `['image/jpeg','image/jpg','image/png','image/webp','image/heic','application/pdf']` | [CashierDashboard:228](src/pages/CashierDashboard.jsx#L228) · [InvoiceUpload:18](src/pages/InvoiceUpload.jsx#L18) · [RoasterySales:118](src/pages/RoasterySales.jsx#L118) |
| `['image/jpeg','image/png','image/gif','image/webp']` | [claude.js:61](src/lib/claude.js#L61) · [RoasterySales:11](src/pages/RoasterySales.jsx#L11) |

⚠️ **تعارض حقيقي:** الأولى تقبل `heic` والثانية ترفضه وتقبل `gif`. أي أن ملف HEIC (صيغة كاميرا آيفون الافتراضية) يجتاز التحقق بالرفع ثم قد يُرفض عند التحليل. كذلك `normMime` ([RoasterySales:20](src/pages/RoasterySales.jsx#L20)) نسخة مبسّطة من `normalizeMimeType` ([claude.js:63](src/lib/claude.js#L63)) — الأولى لا تعالج `jfif`/`pjpeg`.

### 4-و. 🟡 تكرارات أصغر

| المنطق | العدد | ملاحظة |
|---|---:|---|
| `fmt` (تنسيق عملة) | **18** | 5 تنويعات مختلفة: بعضها يعرض `'—'` للصفر، بعضها `0.00`، بعضها `Math.abs` |
| `ROLE_AR` | 4 | [InvoiceUpload:9](src/pages/InvoiceUpload.jsx#L9) **ناقصة `cashier`** بينما الثلاث الأخرى كاملة ⚠️ — والقائمة الأصح موجودة أصلاً كـ`ROLE_LABELS` بـ[AuthContext:5](src/contexts/AuthContext.jsx#L5) |
| `NAVY`/`GOLD`/`TEAL` | 13 ملفاً | ألوان الهوية مكررة كثوابت محلية |
| `MONTHS_AR` | 3 | [Dashboard:22](src/pages/Dashboard.jsx#L22) · [Reports:20](src/pages/Reports.jsx#L20) · [QuickSale:14](src/pages/QuickSale.jsx#L14) |
| `todayStr` | 3 | [PayableSuppliers:12](src/pages/PayableSuppliers.jsx#L12) · [QuickSale:10](src/pages/QuickSale.jsx#L10) · [Suppliers:9](src/pages/Suppliers.jsx#L9) — نفس `fmtDate(new Date())` |
| كشف التكرار قبل الإدراج | 4 | [PendingDocuments:300](src/pages/PendingDocuments.jsx#L300) · [BankReconciliation:168](src/pages/BankReconciliation.jsx#L168)، [232](src/pages/BankReconciliation.jsx#L232) · [AppReconciliation:132](src/pages/AppReconciliation.jsx#L132) — نفس الاستعلام الخماسي |

**الحصيلة التقديرية للتوحيد:** ~250-300 سطر مكرر قابلة للحذف، موزّعة على `lib/dateUtils.js` + `lib/format.js` + `lib/constants.js` + توسيع `lib/storage.js`.

---

## 5. حسابات مالية خارج `financialEngine.js` ⚠️

`financialEngine.js` (142 سطراً) يُفترض أنه مصدر الحقيقة الواحد. الواقع: **`getFinancialSummary` مستورد في ملفين فقط** — `Reports.jsx` و`Dashboard.jsx` — ومع ذلك **كلاهما يحسب نفس الأرقام محلياً بالتوازي**.

### 5-أ. 🔴🔴 `Reports.jsx:245-262` — تعريفان متناقضان لصافي الربح بنفس الصفحة

```js
// Reports.jsx:249-258 — الحساب المحلي
const cashSales    = sum(sales,'cash_sales')          // ← من جدول sales
const networkSales = sum(sales,'network_sales')
const totalSales   = cashSales + networkSales
const opEx         = sumOut(ledger, ['🛒 مصروفات تشغيلية'])
const fixEx        = sumOut(ledger, ['💰 مصروفات ثابتة'])
const loans        = sumOut(ledger, ['💳 قسط سيارة','💳 قسط شراء أرض','💳 قرض ١','💳 قرض ٢'])
const draws        = sumOut(ledger, ['💼 مسحوبات سليمان','💼 مسحوبات فايز'])
const grossProfit  = totalSales - opEx - fixEx
const netProfit    = grossProfit - loans
```

مقابل [financialEngine.js:106-132](src/lib/financialEngine.js#L106):
```js
const grossProfit = totalSales - cogs
netProfit: grossProfit - operatingExpenses
```

**أربعة تناقضات جوهرية:**

| البند | `financialEngine` | `Reports.jsx` المحلي | الأثر |
|---|---|---|---|
| مصدر المبيعات | `ledger_entries` (cash_in + bank_in + **receivable_in**) | جدول `sales` (cash + network فقط) | **مبيعات التطبيقات (هنقر/جاهز/كيتا/مرسول) غير محسوبة إطلاقاً** |
| `grossProfit` | `المبيعات − تكلفة البضاعة` | `المبيعات − تشغيلية − ثابتة` | تعريفان مختلفان لنفس المصطلح |
| تكلفة البضاعة المباعة | مطروحة صراحة | **غائبة تماماً** من الحساب | 🥩 لا تُحتسب كمصروف — **صافي الربح مبالَغ فيه** |
| `netProfit` | `− المصروفات التشغيلية` | `− الأقساط` | المسحوبات والأقساط تُعامَل عكسياً |

**والأخطر — الخلط بالعرض:** [السطر 881](src/pages/Reports.jsx#L881) و[1448](src/pages/Reports.jsx#L1448) يعرضان `data.totalSales` (المحلي)، بينما [1165](src/pages/Reports.jsx#L1165) و[1266](src/pages/Reports.jsx#L1266) يستخدمان `engineSummary?.totalSales || data?.totalSales` (المحرّك مع احتياط). أي أن **نفس صفحة التقارير قد تعرض رقمَي مبيعات مختلفين بتبويبين مختلفين** — ومصدر الفرق هو مبيعات التطبيقات.

### 5-ب. 🔴 `Dashboard.jsx:269-289` — تكرار كامل لحساب الأرصدة

```js
setBalances({
  cash:    rows.reduce((s,r) => s + (r.cash_in||0) - (r.cash_out||0), 0),
  bank:    rows.reduce((s,r) => s + (r.bank_in||0) - (r.bank_out||0), 0),
  ...
})
```
`getFinancialSummary` يُرجع `cashBalance`/`bankBalance`/`custodyBalance`/`payableBalance` جاهزة ([financialEngine:117-121](src/lib/financialEngine.js#L117)) — ونفس الملف يستدعيه بالفعل [بالسطر 304](src/pages/Dashboard.jsx#L304). استعلام إضافي كامل بلا داعٍ.

### 5-ج. 🔴 `Loans.jsx:19-31` — بلا فلترة الملغى

```js
const { data: ledger } = await supabase.from('ledger_entries')
  .select('type,cash_out,bank_out,custody_out').eq('project_id', pid)
  // ← لا يوجد .neq('status','cancelled')
```
كل بقية المشروع يستثني `cancelled`. هنا **القيود الملغاة تُحتسب كأقساط مدفوعة** — رقم خاطئ صراحةً، لا مجرد تكرار. كما أنه يعرّف قائمة القروض محلياً بدل `DEBT_TYPES`/`isDebt` الموجودين بالمحرّك.

### 5-د. 🟠 مواضع أخرى تحسب من `ledger_entries` مباشرة

| الملف : السطر | ما يحسبه | التقييم |
|---|---|---|
| [Reports.jsx:305-310](src/pages/Reports.jsx#L305) | أرصدة الصندوق/البنك/العهدة/الدائنة | تكرار ثالث لنفس المنطق |
| [Ledger.jsx:80-97](src/pages/Ledger.jsx#L80) | أرصدة تراكمية جارية | ✅ مبرَّر (عرض صف-بصف، لا يوفّره المحرّك) |
| [Sales.jsx:127-160](src/pages/Sales.jsx#L127) | تجميع مبيعات المحمصة | 🟡 منطق خاص، لكن يستحق دالة بـ`lib/` |
| [Dashboard.jsx:398-484](src/pages/Dashboard.jsx#L398) | تجميعات يومية/قنوات/فروع | ✅ يستخدم `isSales` المستوردة — نمط صحيح جزئياً |
| [PayableSuppliers.jsx:47-51](src/pages/PayableSuppliers.jsx#L47) | ذمم الموردين | ✅ يفوّض لـ[`lib/payableBalances.js`](src/lib/payableBalances.js) |
| [AppReconciliation.jsx:90-94](src/pages/AppReconciliation.jsx#L90) | إجمالي ذمم التطبيقات | ✅ يفوّض لـ[`lib/appReconciliation.js`](src/lib/appReconciliation.js) |
| [BankReconciliation.jsx:122-127](src/pages/BankReconciliation.jsx#L122) | تجميع الشبكة للمطابقة | ✅ يفوّض لـ[`lib/bankReconciliation.js`](src/lib/bankReconciliation.js) |

**نمط واضح:** الميزات الحديثة (المطابقات، الذمم) تفوّض لمكتبات خالصة ✅. الصفحات الأقدم (التقارير، اللوحة، القروض) تحسب بيدها ❌.

### 5-هـ. مبيعات تُكتب من 6 مواضع مستقلة

قيود المبيعات تُنشأ بـ: [PendingDocuments:365](src/pages/PendingDocuments.jsx#L365) · [QuickSale:121](src/pages/QuickSale.jsx#L121)،[135](src/pages/QuickSale.jsx#L135) · [CashierDashboard:62](src/pages/CashierDashboard.jsx#L62) · [RoasterySales:191](src/pages/RoasterySales.jsx#L191)،[209](src/pages/RoasterySales.jsx#L209) · [AppReconciliation:143](src/pages/AppReconciliation.jsx#L143) · [BankReconciliation:186](src/pages/BankReconciliation.jsx#L186) — كلٌّ يبني كائن `ledger_entries` يدوياً بحقوله الـ15+.

`buildLedgerInsertRow` موجودة بـ[`lib/bankReconciliation.js`](src/lib/bankReconciliation.js) لكن يستخدمها ملف واحد فقط. ترقيتها لدالة عامة (`lib/ledgerEntry.js`) يمنع صنفاً كاملاً من الأخطاء — مثل خطأ `paySource` الفارغ الذي أُصلح بـ`54e69cc`، ومثل نسيان `neq('status','cancelled')` بـ`Loans.jsx`.

---

## الخلاصة — ترتيب الأولويات المقترح

| # | البند | الخطورة | الجهد | المبرر |
|---|---|:---:|:---:|---|
| 1 | توحيد `fmtDate` (11 نسخة) → `lib/dateUtils.js` | 🔴 | صغير | تسبّب فعلياً بـ4 جولات إصلاح؛ سيتكرر حتماً |
| 2 | توحيد صافي الربح بـ`Reports.jsx` مع المحرّك | 🔴🔴 | متوسط | **أرقام مالية خاطئة معروضة الآن** (تكلفة البضاعة ومبيعات التطبيقات) |
| 3 | إضافة `neq('status','cancelled')` بـ`Loans.jsx` | 🔴 | سطر واحد | خطأ صريح بالأرقام |
| 4 | نقل أسماء الشركاء/القروض من `financialEngine` لـ`settings` | 🔴 | متوسط | يمنع أي عميل جديد من الحصول على أرقام صحيحة |
| 5 | نقل الشروط الأربعة بـ`Layout.jsx` لـ`features` | 🟠 | صغير | البنية جاهزة (`module` مطبّق بسطر واحد أصلاً) |
| 6 | استبدال `includes('كون')` بمعرّف صريح | 🟠 | صغير | مطابقة عرضية محتملة لأي اسم فيه "كون" |
| 7 | توحيد قوائم أنواع الملفات (تعارض HEIC) | 🟠 | صغير | تعارض حقيقي بالسلوك |
| 8 | استخراج `_approveOne` لـ`lib/documentApproval.js` | 🟠 | كبير | أخطر كود بالمشروع وغير قابل للاختبار |
| 9 | توحيد `getRange` (6 نسخ) | 🟡 | صغير | — |
| 10 | باقي التكرارات (`toBase64`, `fmt`, `ROLE_AR`, ألوان) | 🟡 | صغير | ~200 سطر |

**لم يُعدَّل أي ملف من ملفات المشروع أثناء هذه المراجعة.**
