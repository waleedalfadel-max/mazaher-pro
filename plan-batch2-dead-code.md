# الدفعة 2 — حذف الكود الميت (23 موضعاً) — خطة نهائية

> **تخطيط فقط. لا حذف يُنفَّذ.** فحصت كل موضع بنفس مستوى تتبّع تشخيص Storage — كل مرجع مستورِد، كل استدعاء، قبل ترشيح أي حذف.
> **مُستبعَد نهائياً من هذي الخطة بقرارك:** "الإدخال السريع للمبيعات" ([Layout.jsx:39](src/components/Layout.jsx#L39)، [CashierDashboard.jsx:297](src/pages/CashierDashboard.jsx#L297)) — ميزة حيّة تُستخدَم فعلياً، تبقى بلا أي تعديل.

---

## 1. القائمة الكاملة — مقسّمة حسب نوع الحذف

### أ) ملفات كاملة قابلة للحذف (3 ملفات + مكتبتان مساعدتان)

| الملف | الأسطر | يُستورَد من |
|---|---:|---|
| [RoasterySales.jsx](src/pages/RoasterySales.jsx) | 524 | [App.jsx:20](src/App.jsx#L20)، [App.jsx:161](src/App.jsx#L161) فقط |
| [AppReconciliation.jsx](src/pages/AppReconciliation.jsx) | 271 | [App.jsx:23](src/App.jsx#L23)، [App.jsx:107](src/App.jsx#L107) فقط |
| [PayableSuppliers.jsx](src/pages/PayableSuppliers.jsx) | 415 | [App.jsx:22](src/App.jsx#L22)، [App.jsx:101](src/App.jsx#L101) فقط |
| [lib/appReconciliation.js](src/lib/appReconciliation.js) | 25 | `AppReconciliation.jsx` فقط — **لا مستورِد آخر بكل المشروع** |
| [lib/payableBalances.js](src/lib/payableBalances.js) | 8 | `Reports.jsx` فقط (تفصيل بالبند ب أدناه — يُحذف الاستيراد معه لا الملف بمعزل) |

**تحقق السلامة (كالضبط بأسلوب تشخيص Storage):** `grep` شامل لكل استيراد لأسماء المكوّنات الثلاثة بكامل `src/` أعاد **فقط** استيرادات `App.jsx` — لا استدعاء غير مباشر، لا Lazy import، لا مرجع بأي ملف آخر. `claude.js:423` يحتوي **تعليقاً نصياً فقط** يشير لـ`AppReconciliation.jsx` كتوثيق (لا استيراد كود) — يُنظَّف كجزء من الحذف لا يمنعه.

### ب) شروط/كتل فردية داخل ملفات لا تزال مستخدَمة فعلياً (يبقى الملف، تُحذف أجزاء منه)

| # | الملف : الأسطر | الشرط/الكتلة | ⚠️ تنبيه دقة |
|---|---|---|---|
| 1 | [Layout.jsx:41](src/components/Layout.jsx#L41) | رابط "مبيعات المحمصة" | حذف السطر كاملاً |
| 2 | [Layout.jsx:48-49](src/components/Layout.jsx#L48) | رابطا "الذمم الدائنة"/"مطابقة التطبيقات" | حذف السطرين |
| 3 | [CashierDashboard.jsx:24-154](src/pages/CashierDashboard.jsx#L24) (تعريف `RoasteryMainPanel`) + [206-220](src/pages/CashierDashboard.jsx#L206) (الاستدعاء الشرطي) | كل مكوّن الفرع الرئيسي | **مكوّن مستقل تماماً — تحققت أنه لا يُستدعى إلا بموضع واحد (سطر 221)** |
| 4 | [InvoiceUpload.jsx:36](src/pages/InvoiceUpload.jsx#L36)، [40](src/pages/InvoiceUpload.jsx#L40)، [121](src/pages/InvoiceUpload.jsx#L121)، [124-130](src/pages/InvoiceUpload.jsx#L124)، [196-209](src/pages/InvoiceUpload.jsx#L196)، [319](src/pages/InvoiceUpload.jsx#L319) | منتقي مصدر الدفع الصريح + متغيّر `paySource` كاملاً | ⚠️ **6 مواضع مترابطة بنفس الملف — يجب حذفها معاً بخطوة واحدة، لا تدريجياً**، وإلا يبقى الكود مرجعاً لمتغيّر محذوف |
| 5 | [PendingDocuments.jsx:71](src/pages/PendingDocuments.jsx#L71)، [74-75](src/pages/PendingDocuments.jsx#L74) | سطران داخل `getDefaultPaySource` | ⚠️ **لا تحذف الدالة كاملة** — فيها قواعد عامة حيّة (`cashier→cash`, `owner→bank`, `purchasing→custody`) تُستخدَم فعلياً بمزاهر. يُحذف السطران المشروطان فقط |
| 6 | [PendingDocuments.jsx:246](src/pages/PendingDocuments.jsx#L246)-[253](src/pages/PendingDocuments.jsx#L253) | `isTashormik` + تبسيط الشرط لـ`if (defaultPaySource)` | يُبسَّط لا يُحذف بالكامل — `defaultPaySource` نفسه (من الدالة أعلاه) يبقى مطلوباً |
| 7 | [PendingDocuments.jsx:312](src/pages/PendingDocuments.jsx#L312) | ترنري `تشورميك` بحساب `pay` | يبسَّط لـ`const pay = res.paySource || 'custody'` |
| 8 | [PendingDocuments.jsx:844-850](src/pages/PendingDocuments.jsx#L844)، [1159](src/pages/PendingDocuments.jsx#L1159) | `hideBranchPicker` | حذف المتغيّر + تبسيط الشرط بالسطر 1159 لـ`!doc.branch && branches.length > 0` |
| 9 | [Reports.jsx:90](src/pages/Reports.jsx#L90) (مدخل `payables` بـ`ALL_TABS`)، [97](src/pages/Reports.jsx#L97) (`isBaAsal`)، [123](src/pages/Reports.jsx#L123)+[210](src/pages/Reports.jsx#L210)+[297](src/pages/Reports.jsx#L297) (جلب/حساب `payableSupplierRows`)، [517](src/pages/Reports.jsx#L517) (فلترة `visibleTabs`)، [978-1013](src/pages/Reports.jsx#L978) (كتلة عرض التبويب) | تبويب "الذمم" **كاملاً** | تحققت: `payableSupplierRows` **لا يُستخدَم إلا داخل هذي الكتلة تحديداً** ([السطر 988](src/pages/Reports.jsx#L988)، [1001](src/pages/Reports.jsx#L1001)) — لا استهلاك آخر بالملف. حذف الكتلة يُلغي حاجة استيراد `aggregateSupplierBalances` من `lib/payableBalances.js` أيضاً |
| 10 | [Sales.jsx:23-35](src/pages/Sales.jsx#L23) (`CAFE_CHANNELS`/`ROASTERY_CHANNELS`) + [107-317](src/pages/Sales.jsx#L107) (`MahmasaView` كاملاً) + [323](src/pages/Sales.jsx#L323)+[380-381](src/pages/Sales.jsx#L380) (`isMahmasa` والاستدعاء) | عرض محمصة كون الخاص | تحققت: كلا الثابتين مستخدَمان **حصرياً** داخل `MahmasaView` (لا استخدام خارجها) — حذف نظيف بلا أثر جانبي على العرض العادي |
| 11 | [Dashboard.jsx:684-685](src/pages/Dashboard.jsx#L684) | بطاقة "مستحق للموردين" | ℹ️ **ليس ميتاً بحكم الشرط وحده** — `balances?.payable` تُحسَب عامةً لكل مشروع، لكنها `0` لمزاهر فعلياً (لا معاملات آجلة) فالبطاقة مخفية بشرطين مزدوَجين. حذف شرط اسم المشروع **يجعل هذي البطاقة "افتراضية عامة"** (تظهر تلقائياً لأي مشروع مستقبلي برصيد مستحق حقيقي) — هذا أقرب لتصنيف "فئة ب: قاعدة عامة" من "كود ميت للحذف". **قرار مطلوب منك:** حذف الشرط (تعميم)، أم حذف الكتلة كاملة (إزالة كما بقية بـ عسل)؟ اقترح **التعميم** (حذف شرط الاسم فقط) لأنه سلوك صحيح عاماً بلا أي كلفة إضافية — لكن هذا خارج نطاق "حذف كود ميت" الصرف، أذكره بصراحة |
| 12 | [claude.js:260](src/lib/claude.js#L260) | سطر واحد بترنري أطول | حذف السطر فقط — الترنري يحتفظ بقواعده العامة الثلاث الأخرى |
| 13 | [Login.jsx:18-37](src/pages/Login.jsx#L18) | 4 مدخلات ميتة بـ`PROJECT_INFO` (`tashormik`,`koon`,`trial`,`basal`) | يبقى مدخل `mazaher` فقط |

---

## 2. ترتيب الحذف الآمن — 5 خطوات، كل خطوة مبنية

| الخطوة | ماذا | لماذا بهذا الترتيب |
|---|---|---|
| **1** | حذف الملفات الثلاثة الكاملة (أ) + `lib/appReconciliation.js` + إزالة استيراداتها وروابطها الثلاثة بـ`App.jsx` (السطور 20،22،23 والمسارات 99-109، 159-163) + السطرين بـ`Layout.jsx` (1، 2 بالجدول أعلاه) | **أقل مخاطرة** — حذف بيني تماماً (ملف كامل + مرجعه الوحيد)، لا منطق مختلط بملفات حيّة |
| **2** | حذف `RoasteryMainPanel` من `CashierDashboard.jsx` (البند 3) | مكوّن مستقل بملف حيّ، لكن حذفه معزول بحدود واضحة (بداية/نهاية دالة) |
| **3** | تبسيط `PendingDocuments.jsx` (البنود 5-8 معاً، بنفس الملف) | أكثر الملفات كثافة بالمنطق المالي الحيّ — يُنفَّذ بخطوة واحدة مركّزة، يليه اختبار مالي دقيق |
| **4** | حذف تبويب "الذمم" من `Reports.jsx` (البند 9) + `MahmasaView` من `Sales.jsx` (البند 10) | كتلتان معزولتان بملفين مختلفين، تحذفان معاً لتشابه طبيعة الاختبار (تقارير/عروض) |
| **5** | البنود الصغيرة المتبقية: `InvoiceUpload.jsx` (البند 4، 6 مواضع مترابطة بخطوة واحدة)، `claude.js` (12)، `Login.jsx` (13)، وقرارك بخصوص `Dashboard.jsx` (11) | الأخطر بيتها (`InvoiceUpload.jsx` يمسّ مسار رفع فاتورة مسؤول المشتريات الحيّ) — أخيراً، بعد ثبات كل ما قبله |

---

## 3. التحقق بعد كل خطوة

### بعد الخطوة 1 (الملفات الثلاثة + Layout.jsx)
1. `npm run build` — يجب أن ينجح بلا أخطاء "Cannot find module" (يتأكد من إزالة كل الاستيرادات المعلَّقة بـ`App.jsx`).
2. تصفّح القائمة الجانبية بكل الأدوار — تأكيد عدم ظهور أي رابط مكسور (لم تكن هذي الروابط ظاهرة أصلاً لمزاهر، فلا فرق بصري متوقَّع).
3. تجربة فتح `/roastery-sales`، `/payable-suppliers`، `/app-reconciliation` مباشرة بالرابط — يجب أن يُعاد التوجيه (`Navigate` من `App.jsx`'s catch-all) بدل صفحة بيضاء أو خطأ.

### بعد الخطوة 2 (`RoasteryMainPanel`)
4. **cashier** → `/cashier` → تأكيد ظهور شاشة "رفع مستند" العادية (لا تغيير — مزاهر أصلاً لا تُطابق `branch === 'المحمصة الرئيسية'`).

### بعد الخطوة 3 (`PendingDocuments.jsx`)
5. `npm run build`.
6. **accountant** → اعتماد مستند مصروف حقيقي (كاشير رفعه، أو مسؤول مشتريات) → تأكيد أن مصدر الدفع الافتراضي يُقترَح بشكل صحيح حسب الدور (نفس السلوك قبل الحذف بالضبط — القواعد العامة لم تُمَس).
7. اعتماد مستند "تحويل" حقيقي → تأكيد أن `pay` المبسَّطة (`res.paySource || 'custody'`) لا تزال تعمل بلا كسر (الحارس الإلزامي من الدفعة 1 يمنع أصلاً وصول `paySource` فارغ لهنا).

### بعد الخطوة 4 (`Reports.jsx` + `Sales.jsx`)
8. `npm run build`.
9. **owner/accountant** → التقارير → تأكيد أن التبويبات الأربعة المتبقية (مبيعات، مصروفات، ضريبة، أرصدة) تعمل بلا تغيير، ولا يظهر تبويب "الذمم" (لم يكن يظهر أصلاً).
10. **owner/accountant** → المبيعات → تأكيد ظهور العرض العادي (القنوات الاعتيادية)، لا خطأ جافاسكربت.

### بعد الخطوة 5 (`InvoiceUpload.jsx` + `claude.js` + `Login.jsx` + قرار `Dashboard.jsx`)
11. `npm run build`.
12. **purchasing** → رفع فاتورة حقيقية → تأكيد النجاح الكامل (نفس اختبار دفعة RLS السابق — هذا أخطر مسار بكل الدفعة).
13. **owner** → لوحة التحكم → تأكيد ظهورها بلا تغيير.
14. زيارة شاشة الدخول → تأكيد ظهور شعار/ترحيب مزاهر الطبيعي بالرابط الصحيح.

---

## سؤال قرار وحيد قبل التنفيذ
**البند 11 (`Dashboard.jsx`):** هل تُفضّل حذف الشرط (تعميم البطاقة لأي مشروع مستقبلي برصيد مستحق حقيقي — توصيتي)، أم حذف الكتلة كاملة (نفس معاملة بقية ميزات "بـ عسل")؟

**لم يُحذف أي كود أو يُعدَّل أثناء إعداد هذي الخطة.**
