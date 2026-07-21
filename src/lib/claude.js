const MODEL = (import.meta.env.VITE_CLAUDE_MODEL || 'claude-opus-4-5').trim()

const CLASSIFICATION_RULES = `قبل أي شيء آخر، اتبع هذه القواعد بدقة مطلقة:

إذا رأيت في الفاتورة أي من هذه الكلمات أو ما يشابهها، فـ transType = تكلفة البضاعة المباعة دائماً:
خبز، صامولي، قرصان، شاورما، بريوش، مخبز → تكلفة البضاعة المباعة
لحم، دجاج، مجمدات، كبدة، شحم، دواجن، أسماك، مواشي → تكلفة البضاعة المباعة
خضار، فواكه، بقوليات، نعناع، ورق عنب، خضروات → تكلفة البضاعة المباعة
قهوة، شاي، حليب، كريمة، سكر، قهوة عربية → تكلفة البضاعة المباعة
فحم، غاز، اسطوانة، بوتاجاز → تكلفة البضاعة المباعة
مشروبات، عصير، مياه معبأة (تُباع مع الطلب) → تكلفة البضاعة المباعة
مواد غذائية، مشتريات غذائية، أي مادة خام للمنتج → تكلفة البضاعة المباعة

هذه القاعدة أقوى من أي شيء آخر في هذه التعليمات.
لا تختار "مصروفات تشغيلية" لأي فاتورة فيها الكلمات أعلاه.`

function extractJSON(text) {
  let clean = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()
    .normalize('NFC')

  const start = clean.indexOf('{')
  if (start === -1) return null

  let depth = 0, inStr = false, esc = false, end = -1
  for (let i = start; i < clean.length; i++) {
    const ch = clean[i]
    if (esc)                 { esc = false; continue }
    if (ch === '\\' && inStr){ esc = true;  continue }
    if (ch === '"')          { inStr = !inStr; continue }
    if (inStr)               continue
    if (ch === '{')          depth++
    if (ch === '}')          { depth--; if (depth === 0) { end = i; break } }
  }
  if (end === -1) return null

  let jsonStr = clean.slice(start, end + 1)

  try {
    return JSON.parse(jsonStr)
  } catch {
    try {
      const fixed = jsonStr
        .replace(/[\x00-\x1F\x7F]/g, ' ')
        .replace(/,(\s*[}\]])/g, '$1')
        .replace(/([{,]\s*)([A-Za-z_]\w*)(\s*:)/g, '$1"$2"$3')
      return JSON.parse(fixed)
    } catch {
      return null
    }
  }
}

// Claude only accepts these image MIME types
const VALID_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

function normalizeMimeType(mimeType, fileName = '') {
  if (!mimeType) {
    const ext = (fileName.split('.').pop() || '').toLowerCase()
    if (ext === 'pdf')               return 'application/pdf'
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
    if (ext === 'png')               return 'image/png'
    if (ext === 'gif')               return 'image/gif'
    if (ext === 'webp')              return 'image/webp'
    return 'application/pdf'
  }
  const t = mimeType.toLowerCase().trim()
  if (t === 'image/jpg')  return 'image/jpeg'
  if (t === 'image/jfif') return 'image/jpeg'
  if (t === 'image/pjpeg') return 'image/jpeg'
  return t
}

export async function analyzeDocument(fileBase64, mimeType, fileName, uploadedBy = '', categories = [], projectName = '', transTypes = [], extractSupplierName = false) {
  const mime    = normalizeMimeType(mimeType, fileName)
  const isImage = VALID_IMAGE_TYPES.includes(mime)
  const isPdf   = mime === 'application/pdf'

  if (!isImage && !isPdf) {
    throw new Error(`نوع الملف غير مدعوم: ${mime} — المدعوم: PDF أو صورة (JPEG/PNG/WEBP/GIF)`)
  }

  const contentBlock = isImage
    ? { type: 'image',    source: { type: 'base64', media_type: mime,               data: fileBase64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf',  data: fileBase64 } }

  const today = new Date().toISOString().split('T')[0]

  // normalize transTypes — قد تكون strings أو objects {label, category}
  const typesAsStrings = (Array.isArray(transTypes) ? transTypes : [])
    .map(t => (typeof t === 'string' ? t : (t?.label || t?.name || '')).trim())
    .filter(Boolean)

  // build transaction types section — use project-specific list if provided
  const transTypesSection = typesAsStrings.length > 0
    ? `⚠️ أنواع الحركات المتاحة لهذا المشروع — اختر transType منها حرفياً بما فيه الإيموجي:\n${typesAsStrings.join('\n')}`
    : `أنواع الحركات المتاحة:\n💵 مبيعات كاش | 🏦 مبيعات شبكة | 🛒 مصروفات تشغيلية | 💰 مصروفات ثابتة\n💳 قسط سيارة | 💳 قسط شراء أرض | 💳 قرض ١ | 💳 قرض ٢\n👤 صرف عهدة | 💼 مسحوبات سليمان | 💼 مسحوبات فايز | 🏛️ ضريبة القيمة المضافة\n🔄 تحويل داخلي — صرف عهدة | 🏧 تحويل داخلي — إيداع نقدي | 📥 تحصيل جملة\n📥 تحصيل ذمم هنقر | 📥 تحصيل ذمم جاهز | 📥 تحصيل ذمم كيتا | 📥 تحصيل ذمم مرسول\n🛵 مبيعات مرسول`

  // default expense transType = first non-sales/transfer type in the list
  const defaultExpenseType = typesAsStrings.find(t => !t.includes('مبيعات') && !t.includes('تحويل') && !t.includes('تحصيل'))
    || '🛒 مصروفات تشغيلية'

  // استخراج اسم المورد — مشروط فقط (مصدر دفع "آجل" بمشروع "بـ عسل" حالياً)، لا يغيّر البرومبت لأي حالة أخرى
  const supplierNameField = extractSupplierName ? ',"supplier_name":"اسم المورد كما هو مكتوب حرفياً"' : ''
  const supplierNameRule  = extractSupplierName ? `
- supplier_name: استخرج اسم المورد/البائع (اسم المحل أو الشركة أو الشخص) كما هو مكتوب حرفياً على الفاتورة تماماً — بدون تخمين أو تصحيح إملائي. إذا كان النص غير واضح، اكتب أفضل قراءة ممكنة مع إضافة (?) في النهاية.` : ''

  // build strict category list for the prompt
  let categorySection = ''
  if (categories.length > 0) {
    const parents = categories.filter(c => !c.parent_id)
    const kidsOf  = id => categories.filter(c => c.parent_id === id)
    const lines   = parents.map(p => {
      const kids = kidsOf(p.id)
      if (kids.length === 0) return `  category_main="${p.name}"`
      return `  category_main="${p.name}"\n${kids.map(k => `    category_sub="${k.name}"`).join('\n')}`
    })
    categorySection = `
⚠️ قائمة التصنيفات المسموح بها — لا يجوز استخدام أي اسم غير موجود هنا:
${lines.join('\n')}
`
  } else {
    categorySection = `\nالتصنيفات المتاحة: مصروفات تشغيلية / رواتب / إيجارات / قروض / مسحوبات / مصاريف إدارية\n`
  }

  const prompt = `${CLASSIFICATION_RULES}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

أجب بـ JSON فقط بدون أي نص قبله أو بعده، بدون \`\`\`json أو أي markdown.

أنت مساعد محاسبي خبير. اسم الملف: ${fileName}
اليوم: ${today}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
تفاصيل قواعد التصنيف مع أمثلة:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

أي فاتورة تحتوي كلمة من هذه الكلمات أو ما يشابهها → transType = "تكلفة البضاعة المباعة" دائماً:
  • لحوم، دواجن، أسماك، مجمدات، مواشي
  • خضار، فواكه، بقوليات، خضروات
  • خبز، صامولي، قرصان، مخبوزات، كيك، عجين
  • قهوة، شاي، حليب، كريمة، سكر، قهوة عربية
  • فحم، غاز طبخ، بوتاجاز
  • مشروبات غازية، عصائر، مياه معبأة تُباع مع الطلب
  • أي مادة خام تدخل مباشرة في تحضير المنتج المباع للعميل

هذه القاعدة أقوى من أي اجتهاد عام. حتى لو لم تكن متأكداً 100% من التصنيف الفرعي الدقيق، اختر "تكلفة البضاعة المباعة" والتصنيف الفرعي الأقرب — ولا تختر "مصروفات تشغيلية" أبداً لهذه الفواتير.

"مصروفات تشغيلية" تُستخدم فقط لـ:
  • نظافة ومستلزمات تنظيف
  • وقود ومواصلات وصيانة سيارات
  • قرطاسية وطباعة غير متعلقة بالمنتج
  • اشتراكات وخدمات وانترنت
  • أي شيء لا يدخل مباشرة في تحضير المنتج المباع

أمثلة صحيحة:
  ✅ "فحم إندونيسي" → تكلفة البضاعة المباعة / فحم وغاز
  ✅ "خبز شاورما" أو "قرصان" → تكلفة البضاعة المباعة / خبز ومخبوزات
  ✅ "مشروبات غازية بيبسي" → تكلفة البضاعة المباعة / مواد غذائية متنوعة
  ✅ "صامولي" → تكلفة البضاعة المباعة / خبز ومخبوزات
  ✅ "غاز الطبخ" أو "أسطوانة غاز" → تكلفة البضاعة المباعة / فحم وغاز
  ❌ "مواد تنظيف" → مصروفات تشغيلية / نظافة ومستلزمات
  ❌ "بنزين/ديزل" → مصروفات تشغيلية / وقود ومواصلات
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

قاعدة تفكيك الفواتير متعددة الأصناف:
إذا كانت الفاتورة من سوبرماركت أو محل متعدد الأصناف
(مثل العثيم، بنده، أسواق، هايبر، مخازن، كارفور، دانة، لولو، أوشن، بن داود)
أو كانت الفاتورة تحتوي أصنافاً مختلفة التصنيف:

افحص بنود الفاتورة وفككها إلى items منفصلة:
- كل مجموعة أصناف من نفس category_sub = item واحد
- مثال: فاتورة العثيم فيها مشروبات + خضار + بهارات
  → item 1: مشروبات غازية — المبلغ المحدد أو التقريبي
  → item 2: خضار وبقوليات — المبلغ المحدد أو التقريبي
  → item 3: مواد غذائية متنوعة — الباقي

إذا ما تقدر تحدد المبالغ بدقة من الفاتورة:
- قسّم المبلغ الإجمالي تقديرياً حسب الأصناف الظاهرة
- أضف "(تقديري)" في اسم البند
- تأكد أن مجموع items = totalAmount

إذا كانت الفاتورة صنف واحد واضح (مثل فاتورة لحوم فقط):
- لا تفكك، سجلها كبند واحد

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

قاعدة القراءة الحرفية:
اقرأ النص المكتوب في الفاتورة حرفياً كما هو دون تخمين أو تصحيح إملائي.
إذا كان نص معين غير واضح، اكتب أفضل قراءة ممكنة مع إضافة (?) في نهاية الوصف — لا تخترع اسماً لا تتأكد منه.

قاعدة قراءة مبالغ بنود الفاتورة الضريبية:
عند قراءة مبلغ كل بند في الفاتورة الضريبية:
- ابحث عن عمود اسمه: "إجمالي شامل" أو "إجمالي شامل ضريبة القيمة المضافة" أو "المبلغ شامل الضريبة" أو "الإجمالي" أو "Total"
- اقرأ القيمة من هذا العمود لكل بند — هذا هو المبلغ الصحيح
- لا تقرأ من عمود "السعر" أو "سعر الوحدة" أو "السعر قبل الضريبة" أو "Unit Price"
- مجموع مبالغ بنودك يجب أن يقترب من إجمالي الفاتورة المكتوب في الأسفل
- مثال: إذا عمود "السعر" = 47 وعمود "إجمالي شامل" = 54.05 → اكتب 54.05

مسح الصورة الكامل — قبل إرجاع أي نتيجة:
افحص الصورة بعناية كاملة: هل فيها أكثر من إيصال أو فاتورة منفصلة (حتى لو متراكبة أو جزء منها مقصوص)؟
إذا كان هناك أكثر من مستند: أرجع كل واحد كعنصر مستقل في مصفوفة invoices.
لا تدمج فاتورتين في فاتورة واحدة، ولا تتجاهل أي فاتورة ثانية تظهر في الصورة ولو جزئياً.

${transTypesSection}

مصادر الدفع: cash=صندوق نقدي | bank=بنك أو مدى أو تحويل | custody=عهدة موظف
${categorySection}
١. تقرير مبيعات (POS أو ملخص مبيعات يومي):
{"type":"sales","date":"YYYY-MM-DD","cashSales":0.00,"networkSales":0.00,"transferSales":0.00,"hungerSales":0.00,"jahez":0.00,"keeta":0.00,"mrsool":0.00,"totalSales":0.00}

طريقة القراءة الصحيحة — ابحث عن كل قناة باسمها بالضبط ثم خذ الرقم المقابل لها مباشرة:
  cashSales     ← السطر الذي يحتوي: Cash أو كاش أو نقدي
  networkSales  ← السطر الذي يحتوي: Mada أو مدى أو بطاقة أو شبكة أو Card
  transferSales ← السطر الذي يحتوي: Transfer أو تحويل (قناة مستقلة — غير هنقر/جاهز/مرسول)
  hungerSales   ← السطر الذي يحتوي: Hunger أو هنقر أو HungerStation
  jahez         ← السطر الذي يحتوي: Jahez أو جاهز
  keeta         ← السطر الذي يحتوي: Keeta أو كيتا (إذا غير موجود: 0)
  mrsool        ← السطر الذي يحتوي: Mrsool أو مرسول (الحقل "mrsool" حرفياً)

تحذير: كل قناة لها رقمها المستقل في سطرها — لا تأخذ رقم سطر وتضعه في حقل قناة أخرى
مثال صحيح: إذا رأيت Transfer=88 و Hunger=584 و Jahez=273 فـ transferSales=88, hungerSales=584, jahez=273
مثال خاطئ: لا تضع 584 في جاهز ولا 273 في هنقر لمجرد أنك تجاهلت Transfer

٢. تحويل داخلي (حوالة بنكية لمسؤول مشتريات / صرف عهدة، أو إيصال إيداع نقدي):
{"type":"transfer","transType":"تحويل داخلي — صرف عهدة أو تحويل داخلي — إيداع نقدي","date":"YYYY-MM-DD","amount":0.00,"description":"وصف التحويل"}

٣. أي مستند آخر (فاتورة شراء، إيصال، سند، كشف) — فكّك لبنود:
{"type":"expense","date":"YYYY-MM-DD","totalAmount":0.00,"vatAmount":0.00,"transType":"اختر من القائمة أعلاه","paySource":"cash أو bank أو custody","description":"اسم المورد أو وصف الفاتورة"${supplierNameField},"items":[{"description":"وصف البند","amount":0.00,"category_main":"التصنيف الرئيسي","category_sub":"التصنيف الفرعي"}]}

قواعد صارمة — لا استثناء:
- إذا كان المستند ملخص مبيعات أو تقرير مبيعات استخدم النوع الأول (sales) دائماً
- إذا كان المستند حوالة بنكية لمسؤول مشتريات أو ما يدل على صرف عهدة من البنك → استخدم النوع الثاني (transfer) مع transType="تحويل داخلي — صرف عهدة" — لا تصنّفه كمصروف
- إذا كان المستند إيصال إيداع نقدي أو تحويل من الصندوق إلى البنك → استخدم النوع الثاني (transfer) مع transType="تحويل داخلي — إيداع نقدي" — لا تصنّفه كمبيعات
- إذا كان الإشعار البنكي يظهر تحويل وارد من Hunger Station أو هنقر → استخدم النوع الثاني (transfer) مع transType="📥 تحصيل ذمم هنقر" — المبلغ يذهب bank_in
- إذا كان الإشعار البنكي يظهر تحويل وارد من Jahez أو جاهز → استخدم النوع الثاني (transfer) مع transType="📥 تحصيل ذمم جاهز" — المبلغ يذهب bank_in
- إذا كان الإشعار البنكي يظهر تحويل وارد من Keeta أو كيتا → استخدم النوع الثاني (transfer) مع transType="📥 تحصيل ذمم كيتا" — المبلغ يذهب bank_in
- إذا كان الإشعار البنكي يظهر تحويل وارد من Mrsool أو مرسول → استخدم النوع الثاني (transfer) مع transType="📥 تحصيل ذمم مرسول" — المبلغ يذهب bank_in
- مبيعات مرسول في تقرير POS: تُسجَّل في حقل مستقل مثل هنقر/جاهز/كيتا — ذمم مدينة (receivable_in)
- إذا كان المستند حوالة واردة (مبلغ دخل للحساب): علاماتها: كلمة "إيداع" أو "credited" أو "مبلغ مضاف" أو "تم استلام" أو اسم مرسِل/عميل جملة ظاهر → استخدم النوع الثالث (expense) مع transType="📥 تحصيل جملة" و paySource="bank" وضع المبلغ في bank_in وليس bank_out
- إذا كان المستند حوالة صادرة (مبلغ خرج من الحساب): علاماتها: كلمة "تحويل" أو "debited" أو "مبلغ مخصوم" أو اسم مستفيد/مورد → استخدم النوع الثالث (expense) مع paySource="bank" وضع المبلغ في bank_out
- cashSales: مبيعات الكاش/النقد فقط — إذا لم يُذكر صراحةً ضعه 0
- networkSales: مبيعات الشبكة/البطاقة/مدى فقط (ليس تطبيقات التوصيل، ليس تحويل) — إذا لم يُذكر ضعه 0
- transferSales: مبيعات التحويل البنكي المباشر من العملاء (Transfer) — إذا لم يُذكر ضعه 0
- hungerSales: مبيعات هنقر ستيشن / Hunger Station فقط — إذا لم يُذكر ضعه 0
- jahez: مبيعات جاهز / Jahez فقط — إذا لم يُذكر ضعه 0
- keeta: مبيعات كيتا / Keeta فقط — إذا لم يُذكر ضعه 0
- mrsool: مبيعات مرسول / Mrsool فقط — إذا لم يُذكر ضعه 0
- totalSales: مجموع cashSales + networkSales + transferSales + hungerSales + jahez + keeta + mrsool
- إذا كان الإجمالي فقط بدون تفصيل: ضع الكل في cashSales واترك الباقي 0
- transType: يجب اختياره دائماً من القائمة أعلاه حرفياً بما فيه الإيموجي — الافتراضي ${defaultExpenseType} لأي فاتورة شراء
- paySource: ثابت حسب من رفع المستند — ${
  projectName === 'تشورميك' ? 'bank (جميع مصروفات تشورميك من البنك دائماً بلا استثناء — بصرف النظر عن الدور)' :
  uploadedBy === 'cashier'    ? 'cash (الكاشير يدفع من الصندوق دائماً)' :
  uploadedBy === 'purchasing' ? 'custody (مسؤول المشتريات يدفع من العهدة دائماً)' :
  uploadedBy === 'owner'      ? 'bank (المالك يدفع من البنك دائماً)' :
  'custody'
} — لا تغيّره حتى لو ذُكر غيره في المستند
- date: YYYY-MM-DD — إذا غير واضح استخدم ${today}
- انتبه بشكل خاص للأرقام المتشابهة بصرياً بالتاريخ (مثل 0 و2، أو 6 و8، حسب خط الفاتورة). إذا كان التاريخ الذي قرأته يقع بعد تاريخ اليوم (${today}) — هذا مؤشر قوي على خطأ قراءة (رقم يوم أو شهر مقلوب) — أعد فحص الرقم المشتبه به بعناية أكبر قبل اعتماده. لو بقي غير واضح تماماً حتى بعد إعادة الفحص، استخدم أفضل قراءة ممكنة بصيغة YYYY-MM-DD صحيحة دائماً (لا تكتب "؟" أو أي رمز داخل حقل date نفسه أبداً)، وأضف "(تحقق من التاريخ)" في نهاية حقل description لتنبيه المحاسب
- totalAmount: الإجمالي الكلي للفاتورة شامل الضريبة
- vatAmount: مبلغ ضريبة القيمة المضافة كما هو مذكور — ابحث عن: ضريبة، VAT، ض.ق.م — إذا غير مذكور ضعه 0
- items: فكّك كل سطر في الفاتورة إلى بند منفصل. المبالغ في items: اقرأ من عمود "إجمالي شامل" أو "الإجمالي شامل الضريبة" لكل بند — وليس من عمود "السعر" أو "سعر الوحدة". هذا يعني كل مبلغ بند يشمل ضريبته الخاصة.
- إذا لم تجد بنوداً مفصّلة، ضع بنداً واحداً بالمبلغ الإجمالي الكامل شامل الضريبة (totalAmount) — وليس صافياً.
- category_main: انسخ الاسم حرفياً من القائمة أعلاه بما فيه الإيموجي — ممنوع اختراع أسماء جديدة أو تعديل الأسماء
- category_sub: انسخ الاسم حرفياً من الفرعيات تحت category_main المختار — إذا لا يوجد فرعي مناسب اتركه فارغاً ""${supplierNameRule}
- إذا الصورة تحتوي على أكثر من فاتورة أو إيصال منفصل (مثلاً فاتورتان في صفحة أو صور مجمّعة): استخرج كل فاتورة بشكل مستقل
- في جميع الحالات أعد النتيجة بهذا الشكل الموحّد: {"invoices":[{...الفاتورة الأولى بنفس الحقول المعتادة...},{...الفاتورة الثانية...}]}
- إذا كانت فاتورة واحدة فقط: {"invoices":[{...الفاتورة...}]}
- المفتاح الخارجي دائماً هو "invoices" وهو مصفوفة حتى لو عنصر واحد — لا تُعد JSON مجرد object بدون invoices
- JSON فقط بدون أي نص قبله أو بعده`

  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: `${CLASSIFICATION_RULES}\n\nأجب بـ JSON فقط بدون أي نص قبله أو بعده، بدون \`\`\`json أو أي markdown، بدون شرح.`,
      messages: [{
        role: 'user',
        content: [contentBlock, { type: 'text', text: prompt }],
      }],
    }),
  })

  if (!res.ok) {
    let detail = ''
    try { const e = await res.json(); detail = e?.error?.message || JSON.stringify(e) } catch {}
    throw new Error(`Claude API error ${res.status}: ${detail}`)
  }

  const data = await res.json()

  // أخطاء Claude API (overloaded, invalid_request, etc.)
  if (data.error === 'CLAUDE_API_ERROR') {
    const msg = data.claudeError?.message || JSON.stringify(data.claudeError)
    throw new Error(`خطأ من Claude API: ${msg}`)
  }

  // فشل JSON parsing في الـ server
  if (data.error === 'JSON_PARSE_ERROR') {
    throw new Error(`خطأ في تحليل الرد:\n${data.parseError}\n\nالنص الخام:\n${data.rawText}`)
  }

  const text = data.content[0].text.trim()

  const clean = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const result = extractJSON(clean)
  if (!result) throw new Error('لا يوجد JSON صالح في الرد')

  // Normalize to always { invoices: [...] }
  const normalized = result.invoices ? result : { invoices: [result] }

  // تصحيح أسماء التصنيفات لكل الفواتير
  if (categories.length > 0) {
    const norm    = s => (s || '').replace(/[^؀-ۿ\s]/g, '').replace(/\s+/g, ' ').trim()
    const parents = categories.filter(c => !c.parent_id)
    const kidsOf  = id => categories.filter(c => c.parent_id === id)
    const fixItems = items => (items || []).map(item => {
      const matchedParent = parents.find(p =>
        p.name === item.category_main || norm(p.name) === norm(item.category_main)
      )
      if (!matchedParent) return item
      const subs       = kidsOf(matchedParent.id)
      const matchedSub = subs.find(s =>
        s.name === item.category_sub || norm(s.name) === norm(item.category_sub)
      )
      return {
        ...item,
        category_main: matchedParent.name,
        category_sub:  matchedSub ? matchedSub.name : (item.category_sub || ''),
      }
    })
    normalized.invoices = normalized.invoices.map(inv => ({
      ...inv,
      items: inv.items ? fixItems(inv.items) : inv.items,
    }))
  }

  return normalized
}

// يحلّل صفحة واحدة من كشف حساب بنكي PDF ويستخرج كل حركاتها المالية
// يُستدعى مرة لكل صفحة (بعد تقسيم الـ PDF بـ pdf-lib) عشان يبقى الرد صغيراً وسريعاً
// وما يقترب من حد الوقت المسموح للـ API — انظر src/pages/BankReconciliation.jsx
export async function analyzeBankStatementPage(pageBase64, fileName, pageLabel = '') {
  const prompt = `أنت محلل بنكي خبير. المرفق صفحة واحدة${pageLabel ? ` (${pageLabel})` : ''} من كشف حساب بنكي، من ملف اسمه: ${fileName}.

استخرج كل حركة/سطر مالي فعلي ظاهر في هذه الصفحة كعنصر في مصفوفة "lines". تجاهل ترويسة الصفحة، عنوان البنك، والرصيد الافتتاحي/الختامي — هذه ليست حركات.

لكل حركة أعد كائناً بهذا الشكل بالضبط:
{"date":"YYYY-MM-DD","description":"الوصف كما هو مكتوب حرفياً","amount":0.00,"direction":"in أو out","bank_category":"pos_credit أو installment_loan أو fee أو transfer أو cash_deposit أو other"}

قواعد كل حقل:
- date: بصيغة YYYY-MM-DD حصراً — استنتج السنة من سياق الكشف إن لم تكن مكتوبة صراحة في كل سطر
- amount: القيمة المطلقة دائماً موجبة (بدون إشارة سالبة)
- direction: "in" إذا كانت الحركة دائنة وزادت رصيد الحساب، "out" إذا كانت مدينة وخصمت من الرصيد
- bank_category — اختر الأقرب دائماً من هذه القائمة فقط:
  • pos_credit: أي حركة دائنة من نقاط بيع أو "دائنة التاجر" أو تسوية مدى أو عمليات فيزا/ماستركارد التجارية (MC/VC Merchant settlement)
  • installment_loan: أقساط أو قروض بنكية
  • fee: عمولات أو رسوم بنكية
  • transfer: تحويلات صادرة أو واردة عادية (ليست من نقاط بيع)
  • cash_deposit: إيداع نقدي في فرع أو عبر صراف آلي
  • other: أي حركة أخرى لا تندرج تحت ما سبق

لو الصفحة لا تحتوي أي حركات مالية (مثلاً صفحة غلاف أو ملخص فقط): أعد {"lines":[]}

أعد فقط: {"lines":[...]}
JSON فقط بدون أي نص أو markdown قبله أو بعده.`

  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: 'أجب بـ JSON فقط بدون أي نص قبله أو بعده، بدون ```json أو أي markdown، بدون شرح.',
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pageBase64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  })

  if (!res.ok) {
    let detail = ''
    try { const e = await res.json(); detail = e?.error?.message || JSON.stringify(e) } catch {}
    throw new Error(`Claude API error ${res.status}: ${detail}`)
  }

  const data = await res.json()

  if (data.error === 'CLAUDE_API_ERROR') {
    const msg = data.claudeError?.message || JSON.stringify(data.claudeError)
    throw new Error(`خطأ من Claude API: ${msg}`)
  }
  if (data.error === 'JSON_PARSE_ERROR') {
    throw new Error(`خطأ في تحليل رد الصفحة${pageLabel ? ` (${pageLabel})` : ''}:\n${data.parseError}`)
  }

  const text  = data.content[0].text.trim()
  const clean = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const result = extractJSON(clean)
  if (!result) throw new Error(`لا يوجد JSON صالح في رد تحليل الصفحة${pageLabel ? ` (${pageLabel})` : ''}`)

  return Array.isArray(result.lines) ? result.lines : []
}

// يحلّل كشف/إيصال تحويل من تطبيق توصيل (صورة أو PDF) ويستخرج المبيعات المعلَنة،
// العمولة، الضريبة، أي استقطاعات أخرى، وصافي المبلغ المحوّل فعلياً — انظر src/pages/AppReconciliation.jsx
export async function analyzeAppStatement(fileBase64, mimeType, fileName) {
  const mime    = normalizeMimeType(mimeType, fileName)
  const isImage = VALID_IMAGE_TYPES.includes(mime)
  const isPdf   = mime === 'application/pdf'

  if (!isImage && !isPdf) {
    throw new Error(`نوع الملف غير مدعوم: ${mime} — المدعوم: PDF أو صورة (JPEG/PNG/WEBP/GIF)`)
  }

  const contentBlock = isImage
    ? { type: 'image',    source: { type: 'base64', media_type: mime,              data: fileBase64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } }

  const prompt = `أنت محلل مالي خبير. المرفق كشف أو إيصال تحويل من تطبيق توصيل طلبات، من ملف اسمه: ${fileName}.

استخرج من هذا الكشف:
- reportedSales: إجمالي المبيعات كما يذكرها التطبيق نفسه بالكشف (رقم) — إذا غير مذكور صراحة اجعله null
- commission: إجمالي العمولة التي خصمها التطبيق (رقم) — إذا غير مذكور ضعه 0
- tax: إجمالي الضريبة على العمولة (رقم) — إذا غير مذكور ضعه 0
- otherDeductions: أي استقطاعات أو تعويضات أخرى مذكورة بالكشف، كل واحدة بوصفها ومبلغها — مصفوفة [{"description":"...","amount":0.00}] — إذا لا يوجد اتركها []
- netTransferred: صافي المبلغ المحوّل فعلياً للحساب البنكي كما هو مذكور بالكشف (الرقم الأهم — يجب أن يكون موجوداً دائماً)

أعد فقط: {"reportedSales":0.00,"commission":0.00,"tax":0.00,"otherDeductions":[],"netTransferred":0.00}
JSON فقط بدون أي نص أو markdown قبله أو بعده.`

  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: 'أجب بـ JSON فقط بدون أي نص قبله أو بعده، بدون ```json أو أي markdown، بدون شرح.',
      messages: [{
        role: 'user',
        content: [contentBlock, { type: 'text', text: prompt }],
      }],
    }),
  })

  if (!res.ok) {
    let detail = ''
    try { const e = await res.json(); detail = e?.error?.message || JSON.stringify(e) } catch {}
    throw new Error(`Claude API error ${res.status}: ${detail}`)
  }

  const data = await res.json()

  if (data.error === 'CLAUDE_API_ERROR') {
    const msg = data.claudeError?.message || JSON.stringify(data.claudeError)
    throw new Error(`خطأ من Claude API: ${msg}`)
  }
  if (data.error === 'JSON_PARSE_ERROR') {
    throw new Error(`خطأ في تحليل رد كشف التطبيق:\n${data.parseError}`)
  }

  const text  = data.content[0].text.trim()
  const clean = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const result = extractJSON(clean)
  if (!result) throw new Error('لا يوجد JSON صالح في رد تحليل كشف التطبيق')

  return {
    reportedSales:   result.reportedSales != null ? Number(result.reportedSales) : null,
    commission:      Number(result.commission) || 0,
    tax:             Number(result.tax) || 0,
    otherDeductions: Array.isArray(result.otherDeductions) ? result.otherDeductions : [],
    netTransferred:  Number(result.netTransferred) || 0,
  }
}
