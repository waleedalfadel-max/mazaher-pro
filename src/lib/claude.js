import { supabase } from './supabase'
import { createAnalyzeFetch } from './analyzeRequest'
import { normalizeSalesReading } from './salesReport.js'
import { normalizeReceiptReading } from './supplierReceipts.js'
import { normRotation, uprightImage } from './readingImage.js'

const MODEL = (import.meta.env.VITE_CLAUDE_MODEL || 'claude-opus-4-5').trim()

// كل نداءات التحليل تحمل الجلسة الحقيقية — الخادم يرفض أي طلب بلا مستخدم موثّق
const analyzeFetch = createAnalyzeFetch({ getSession: () => supabase.auth.getSession() })

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

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

  const today = fmtDate(new Date())

  // normalize transTypes — قد تكون strings أو objects {label, category}
  const typesAsStrings = (Array.isArray(transTypes) ? transTypes : [])
    .map(t => (typeof t === 'string' ? t : (t?.label || t?.name || '')).trim())
    .filter(Boolean)

  // build transaction types section — use project-specific list if provided
  const transTypesSection = typesAsStrings.length > 0
    ? `⚠️ أنواع الحركات المتاحة لهذا المشروع — اختر transType منها حرفياً بما فيه الإيموجي:\n${typesAsStrings.join('\n')}`
    : `أنواع الحركات المتاحة:\n💵 مبيعات كاش | 🏦 مبيعات شبكة | 🛒 مصروفات تشغيلية | 💰 مصروفات ثابتة\n💳 قسط سيارة | 💳 قسط شراء أرض | 💳 قرض ١ | 💳 قرض ٢\n👤 صرف عهدة | 💼 مسحوبات سليمان | 💼 مسحوبات فايز | 💼 مسحوبات أم طوبى | 🏛️ ضريبة القيمة المضافة\n🔄 تحويل داخلي — صرف عهدة | 🏧 تحويل داخلي — إيداع نقدي | 📥 تحصيل جملة\n📥 تحصيل ذمم هنقر | 📥 تحصيل ذمم جاهز | 📥 تحصيل ذمم كيتا | 📥 تحصيل ذمم مرسول\n🛵 مبيعات مرسول`

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
- كل صنف مطبوع = item واحد، حتى إن تشارك عدة أصناف التصنيف نفسه. لا تجمعها أو تقسّم الإجمالي تقديرياً.
- قد تمتد بيانات الصنف الواحد على عدة أسطر: وصف، كمية، سعر وحدة، مبلغ قبل الضريبة، ضريبة، وإجمالي شامل. هذه بيانات item واحد وليست أصنافاً مستقلة.
- لا تكرر الصنف بسبب التفاف اسمه أو تعدد مبالغه. وإن تكرر الصنف فعلاً في سطر شراء مستقل فاحتفظ بالسطرين.
- انسخ مبالغ الأصناف المطبوعة فقط. لا تخترع بنداً باسم "الباقي"، ولا تعدّل مبلغاً أو إجمالياً لتجعل المجموع يتوازن.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

قاعدة القراءة الحرفية:
اقرأ النص المكتوب في الفاتورة حرفياً كما هو دون تخمين أو تصحيح إملائي.
إذا كان نص معين غير واضح، اكتب أفضل قراءة ممكنة مع إضافة (?) في نهاية الوصف — لا تخترع اسماً لا تتأكد منه.

قاعدة قراءة مبالغ بنود الفاتورة الضريبية:
عند قراءة مبلغ كل بند في الفاتورة الضريبية:
- حدّد أعمدة الصنف وأسطره أولاً: الكمية وسعر الوحدة ومبلغ الكمية قبل الضريبة والضريبة وإجمالي الكمية شامل الضريبة.
- اختر إجمالي الكمية للصنف مرة واحدة، لا سعر الوحدة ولا مبلغ الضريبة ولا الاثنين معاً. قد يكون الإجمالي في سطر تالٍ للوصف.
- إذا كان إجمالي كل صنف شاملاً للضريبة مطبوعاً وواضحاً، انسخه في amount وحدّد amountsBasis="inclusive".
- إذا كانت مبالغ الأصناف المطبوعة قبل الضريبة، والضريبة تُضاف في أسفل الفاتورة، انسخها كما هي وحدّد amountsBasis="exclusive". لا تضف ضريبة محسوبة إلى كل بند.
- استخدم أساساً واحداً لجميع البنود؛ لا تخلط مبالغ قبل الضريبة بأخرى شاملة. كلمة "الإجمالي" أو "Total" وحدها لا تثبت أنها شاملة: اقرأ عنوان العمود وملخص الضريبة.
- لا تجعل السعر أو الضريبة أو صافي الصنف بنداً إضافياً بجانب إجماليه. ولا تحذف سطر شراء حقيقياً لمجرد تطابق اسمه أو مبلغه مع سطر آخر.
- اقرأ totalAmount وvatAmount من ملخص الفاتورة المطبوع، مستقلين عن مجموع ما استخرجته. لا تغيّر الأرقام لتغطية فرق.

مسح الصورة الكامل — قبل إرجاع أي نتيجة:
افحص الصورة بعناية كاملة: هل فيها أكثر من إيصال أو فاتورة منفصلة (حتى لو متراكبة أو جزء منها مقصوص)؟
إذا كان هناك أكثر من مستند: أرجع كل واحد كعنصر مستقل في مصفوفة invoices.
لا تدمج فاتورتين في فاتورة واحدة، ولا تتجاهل أي فاتورة ثانية تظهر في الصورة ولو جزئياً.

${transTypesSection}

مصادر الدفع: cash=صندوق نقدي | bank=بنك أو مدى أو تحويل | custody=عهدة موظف
${categorySection}
١. تقرير مبيعات (POS أو ملخص مبيعات يومي):
{"type":"sales","date":"YYYY-MM-DD","paymentLines":[{"label":"اسم وسيلة الدفع كما طُبع حرفيًا","amount":0.00}],"returnLines":[{"label":"اسم وسيلة المرتجع كما طُبع","amount":0.00}],"reportGrossTotal":0.00,"reportNetTotal":null,"cashSales":0.00,"networkSales":0.00,"transferSales":0.00,"hungerSales":0.00,"jahez":0.00,"keeta":0.00,"mrsool":0.00,"totalSales":0.00}

أسطر وسائل الدفع (الأهم — منها تُحسب القنوات في التطبيق):
  paymentLines ← انسخ كل سطر وسيلة دفع في جدول/قسم وسائل الدفع بمبلغه كما طُبع، سطرًا سطرًا، ولو تكرر اسم القناة بصيغ مختلفة
     (مثل «كاش» و«كاش توصيل» و«توصيل كاش»، أو «مدى» و«مدى توصيل» و«توصيل مدى»). لا تجمع أسطرًا ولا تحذف سطرًا، ولا تُسقط سطرًا لصغر مبلغه
     (مثل «تحويل» بمبلغ صغير). انسخ الاسم حرفيًا ولو لم تعرفه — التطبيق يصنّفه أو يعرضه للمراجعة. لا تضع فيها المرتجعات ولا الإجماليات.
  returnLines  ← أسطر المرتجعات/الاسترجاع حسب وسيلة الدفع (مثل «مرتجع كاش» أو «مرتجعات مدى»)، والمبلغ موجبًا. لا مرتجعات ⇒ [].
  reportGrossTotal ← إجمالي المبيعات المطبوع قبل المرتجعات شاملًا الضريبة (مجموع وسائل الدفع كما طُبع). غير مطبوع ⇒ null.
  reportNetTotal   ← الإجمالي المطبوع بعد المرتجعات شاملًا الضريبة إن طُبع (مثل «Net sales with tax» أو «صافي المبيعات شامل الضريبة»)، وإلا null. لا تحسبه أنت.
     ⚠️ لا تأخذ الصافي قبل الضريبة (مثل «Net sales» بلا «with tax»، أو «المبيعات قبل الضريبة»): وسائل الدفع شاملة الضريبة، فالمطابقة بالشامل.
  مبلغ سطر غير واضح: اكتب amount = null ولا تحذف السطر ولا تخمّن — التطبيق يعرضه للمراجعة.
  في جدول وسائل الدفع (مثل «Payments Breakdown») قد يكون لكل سطر رقمان: عدد العمليات ثم المبلغ — amount هو المبلغ (بالكسور العشرية) لا العدد.
  المرتجعات (مثل «Refund Details» أو «Total returns» مفصّلة بوسيلة الدفع) ⇒ returnLines بالمبلغ لا بالعدد.
  ⚠️ أقسام ليست وسائل دفع فلا تضعها في paymentLines: نوع الطلب («Order Type Breakdown»: استلام / توصيل / سيارة)، والضرائب، والخصومات، والرسوم («Charges»).
     كلمة «توصيل» في قسم نوع الطلب نوعُ طلب لا وسيلة دفع.
  «توصيل» صفة لطريقة التسليم وليست قناة: «كاش توصيل» نقدي، و«مدى توصيل» شبكة. لا تعتبر كلمة «توصيل» وحدها تطبيق توصيل.

طريقة القراءة الصحيحة — ابحث عن كل قناة باسمها بالضبط ثم خذ الرقم المقابل لها مباشرة:
  cashSales     ← السطر الذي يحتوي: Cash أو كاش أو نقدي (ويشمل «كاش توصيل» و«توصيل كاش»)
  networkSales  ← السطر الذي يحتوي: Mada أو مدى أو بطاقة أو شبكة أو Card (ويشمل «مدى توصيل» و«توصيل مدى»)
  transferSales ← السطر الذي يحتوي: Transfer أو تحويل (قناة مستقلة — غير هنقر/جاهز/مرسول)
  hungerSales   ← السطر الذي يحتوي: Hunger أو هنقر أو HungerStation
  jahez         ← السطر الذي يحتوي: Jahez أو جاهز
  keeta         ← السطر الذي يحتوي: Keeta أو كيتا (إذا غير موجود: 0)
  mrsool        ← السطر الذي يحتوي: Mrsool أو مرسول (الحقل "mrsool" حرفياً)

تحذير: كل قناة لها رقمها المستقل في سطرها — لا تأخذ رقم سطر وتضعه في حقل قناة أخرى
مثال صحيح: إذا رأيت Transfer=88 و Hunger=584 و Jahez=273 فـ transferSales=88, hungerSales=584, jahez=273
مثال خاطئ: لا تضع 584 في جاهز ولا 273 في هنقر لمجرد أنك تجاهلت Transfer

٢. تحويل داخلي — نقل مال بين حسابات المنشأة نفسها فقط (صندوق ↔ بنك ↔ عهدة مسؤول المشتريات).
   ⚠️ لا يشمل إطلاقاً أي مبلغ يخرج لطرف خارجي أو لشخص (مالك، شريك، مورد، موظف) — حتى لو كُتب على المستند لفظ "تحويل":
{"type":"transfer","transType":"تحويل داخلي — صرف عهدة أو تحويل داخلي — إيداع نقدي","date":"YYYY-MM-DD","amount":0.00,"description":"وصف التحويل"}

٣. أي مستند آخر (فاتورة شراء، إيصال، سند، كشف) — فكّك لبنود:
{"type":"expense","date":"YYYY-MM-DD","totalAmount":0.00,"vatAmount":0.00,"amountsBasis":"inclusive أو exclusive بحسب مبالغ البنود المطبوعة","transType":"اختر من القائمة أعلاه","paySource":"cash أو bank أو custody","description":"اسم المورد أو وصف الفاتورة","invoiceNumber":"رقم الفاتورة كما هو مطبوع أو null"${supplierNameField},"items":[{"description":"وصف البند","amount":0.00,"category_main":"التصنيف الرئيسي","category_sub":"التصنيف الفرعي"}]}

٤. سداد مورد — دفعة لمورد مقابل مستحق عليه (إيصال حوالة أو سند صرف أو سند قبض صادر من المورد)، لا شراء جديد:
{"type":"supplier_payment","date":"YYYY-MM-DD","amount":0.00,"beneficiary":"اسم المستفيد/المورد كما طُبع حرفيًا","reference":"رقم العملية أو المرجع أو السند كما طُبع أو null","paySource":"cash أو bank","description":"وصف قصير","paymentEvidence":"النص المطبوع الذي يدل على أنه سداد لمورد، حرفيًا"}

قواعد صارمة — لا استثناء:
- إذا كان المستند ملخص مبيعات أو تقرير مبيعات استخدم النوع الأول (sales) دائماً
- إذا كان المستند سحباً شخصياً لمالك أو شريك (يظهر اسم شخص من الملّاك، أو لفظ "مسحوبات" أو "سحب شخصي" أو "محسوبات") → استخدم النوع الثالث (expense) مع transType="مسحوبات [اسم الشريك]" مطابقاً حرفياً لما في قائمة الأنواع أعلاه — ⚠️ لا تصنّفه تحويلاً داخلياً أبداً حتى لو بدأ الوصف بكلمة "تحويل داخلي"، فالمال خرج لشخص لا بين حسابات المنشأة
- إذا كان المستند حوالة بنكية لمسؤول مشتريات أو ما يدل على صرف عهدة من البنك → استخدم النوع الثاني (transfer) مع transType="تحويل داخلي — صرف عهدة" — لا تصنّفه كمصروف
- إذا كان المستند إيصال إيداع نقدي أو تحويل من الصندوق إلى البنك → استخدم النوع الثاني (transfer) مع transType="تحويل داخلي — إيداع نقدي" — لا تصنّفه كمبيعات
- إذا كان الإشعار البنكي يظهر تحويل وارد من Hunger Station أو هنقر → استخدم النوع الثاني (transfer) مع transType="📥 تحصيل ذمم هنقر" — المبلغ يذهب bank_in
- إذا كان الإشعار البنكي يظهر تحويل وارد من Jahez أو جاهز → استخدم النوع الثاني (transfer) مع transType="📥 تحصيل ذمم جاهز" — المبلغ يذهب bank_in
- إذا كان الإشعار البنكي يظهر تحويل وارد من Keeta أو كيتا → استخدم النوع الثاني (transfer) مع transType="📥 تحصيل ذمم كيتا" — المبلغ يذهب bank_in
- إذا كان الإشعار البنكي يظهر تحويل وارد من Mrsool أو مرسول → استخدم النوع الثاني (transfer) مع transType="📥 تحصيل ذمم مرسول" — المبلغ يذهب bank_in
- مبيعات مرسول في تقرير POS: تُسجَّل في حقل مستقل مثل هنقر/جاهز/كيتا — ذمم مدينة (receivable_in)
- إذا كان المستند حوالة واردة (مبلغ دخل للحساب): علاماتها: كلمة "إيداع" أو "credited" أو "مبلغ مضاف" أو "تم استلام" أو اسم مرسِل/عميل جملة ظاهر → استخدم النوع الثالث (expense) مع transType="📥 تحصيل جملة" و paySource="bank" وضع المبلغ في bank_in وليس bank_out
- النوع الرابع (supplier_payment) فقط عند دليل مطبوع صريح أنه سداد لمورد: لفظ "سداد" أو "دفعة" أو "تسديد" أو "payment" أو "settlement" مع اسم مورد، أو إشارة إلى فاتورة أو كشف حساب المورد، أو سند قبض صادر من المورد باستلام المبلغ. انسخ ذلك النص في paymentEvidence. الحوالة البنكية وحدها لا تثبت أنها سداد مورد: حوالة صادرة بلا هذا الدليل تبقى بالقاعدة التالية. إيصال سداد ليس فيه بنود ولا ضريبة؛ لا تضع items ولا vatAmount.
- إذا كان المستند حوالة صادرة (مبلغ خرج من الحساب): علاماتها: كلمة "تحويل" أو "debited" أو "مبلغ مخصوم" أو اسم مستفيد/مورد → استخدم النوع الثالث (expense) مع paySource="bank" وضع المبلغ في bank_out
- cashSales: مبيعات الكاش/النقد فقط — إذا لم يُذكر صراحةً ضعه 0
- networkSales: مبيعات الشبكة/البطاقة/مدى فقط (ليس تطبيقات التوصيل، ليس تحويل) — إذا لم يُذكر ضعه 0
- transferSales: مبيعات التحويل البنكي المباشر من العملاء (Transfer) — إذا لم يُذكر ضعه 0
- hungerSales: مبيعات هنقر ستيشن / Hunger Station فقط — إذا لم يُذكر ضعه 0
- jahez: مبيعات جاهز / Jahez فقط — إذا لم يُذكر ضعه 0
- keeta: مبيعات كيتا / Keeta فقط — إذا لم يُذكر ضعه 0
- mrsool: مبيعات مرسول / Mrsool فقط — إذا لم يُذكر ضعه 0
- totalSales: مجموع cashSales + networkSales + transferSales + hungerSales + jahez + keeta + mrsool (التطبيق يعيد حسابه من paymentLines والإجمالي المطبوع)
- إذا كان الإجمالي فقط بدون تفصيل: ضع الكل في cashSales واترك الباقي 0
- transType: يجب اختياره دائماً من القائمة أعلاه حرفياً بما فيه الإيموجي — الافتراضي ${defaultExpenseType} لأي فاتورة شراء
- paySource: ثابت حسب من رفع المستند — ${
  uploadedBy === 'cashier'    ? 'cash (الكاشير يدفع من الصندوق دائماً)' :
  uploadedBy === 'purchasing' ? 'custody (مسؤول المشتريات يدفع من العهدة دائماً)' :
  uploadedBy === 'owner'      ? 'bank (المالك يدفع من البنك دائماً)' :
  'custody'
} — لا تغيّره حتى لو ذُكر غيره في المستند (عدا سداد المورد: paySource من الإيصال نفسه — حوالة أو تحويل بنكي = bank، سند صرف نقدي = cash)
- date: YYYY-MM-DD — إذا غير واضح استخدم ${today}
- انتبه بشكل خاص للأرقام المتشابهة بصرياً بالتاريخ (مثل 0 و2، أو 6 و8، حسب خط الفاتورة). إذا كان التاريخ الذي قرأته يقع بعد تاريخ اليوم (${today}) — هذا مؤشر قوي على خطأ قراءة (رقم يوم أو شهر مقلوب) — أعد فحص الرقم المشتبه به بعناية أكبر قبل اعتماده. لو بقي غير واضح تماماً حتى بعد إعادة الفحص، استخدم أفضل قراءة ممكنة بصيغة YYYY-MM-DD صحيحة دائماً (لا تكتب "؟" أو أي رمز داخل حقل date نفسه أبداً)، وأضف "(تحقق من التاريخ)" في نهاية حقل description لتنبيه المحاسب
- invoiceNumber: رقم الفاتورة كما هو مطبوع حرفيًا (بالأصفار والحروف والرموز كما هي، دون تعديل). إن لم يوجد رقم واضح فاكتب null — لا تخمّن ولا تستعمل الرقم الضريبي أو رقم الطلب
- totalAmount: الإجمالي الكلي للفاتورة شامل الضريبة
- vatAmount: مبلغ ضريبة القيمة المضافة كما هو مذكور — ابحث عن: ضريبة، VAT، ض.ق.م — إذا غير مذكور ضعه 0
- items: بند واحد لكل صنف مطبوع، لا لكل سطر نصي أو رقمي. amount هو إجمالي كمية الصنف بعد خصمه، وبالأساس المحدد في amountsBasis. سعر الوحدة والكمية والضريبة ليست بنوداً إضافية.
- amountsBasis: "inclusive" للمبالغ الشاملة للضريبة، أو "exclusive" للمبالغ قبل الضريبة. انسخ الأرقام كما طُبعت ولا تحوّلها بين الأساسين.
- إذا لم توجد أصلاً بنود مفصّلة في المستند، ضع بنداً واحداً بالمبلغ الإجمالي الكامل شامل الضريبة (totalAmount) وحدّد amountsBasis="inclusive". لا تستخدم هذا البديل لإخفاء بنود موجودة لم تستطع قراءتها.
- الخصم: إن طُبع خصم على سطر بعينه فمبلغ البند amount هو بعد خصمه، وضع الخصم في "discount" داخل البند. وإن طُبع خصم على إجمالي الفاتورة فضعه موجبًا في "invoiceDiscount" على مستوى الفاتورة، ولا تطرحه من البنود. لا تكتب بندًا سالبًا للخصم أبدًا. المرتجع ليس خصمًا.
- category_main: انسخ الاسم حرفياً من القائمة أعلاه بما فيه الإيموجي — ممنوع اختراع أسماء جديدة أو تعديل الأسماء
- category_sub: انسخ الاسم حرفياً من الفرعيات تحت category_main المختار — إذا لا يوجد فرعي مناسب اتركه فارغاً ""${supplierNameRule}
- إذا الصورة تحتوي على أكثر من فاتورة أو إيصال منفصل (مثلاً فاتورتان في صفحة أو صور مجمّعة): استخرج كل فاتورة بشكل مستقل
- في جميع الحالات أعد النتيجة بهذا الشكل الموحّد: {"rotation":0,"invoices":[{...الفاتورة الأولى بنفس الحقول المعتادة...},{...الفاتورة الثانية...}]}
- إذا كانت فاتورة واحدة فقط: {"rotation":0,"invoices":[{...الفاتورة...}]}
- rotation: كم درجة تُدار الصورة باتجاه عقارب الساعة ليصبح نص المستند مستقيمًا للقراءة (0 أو 90 أو 180 أو 270). مستقيم ⇒ 0.
  مثال: نص يُقرأ من أعلى إلى أسفل (الصورة مدارة ربع دورة مع عقارب الساعة) ⇒ 270؛ ومن أسفل إلى أعلى ⇒ 90؛ ومقلوب ⇒ 180.
- المفتاح الخارجي دائماً هو "invoices" وهو مصفوفة حتى لو عنصر واحد — لا تُعد JSON مجرد object بدون invoices
- JSON فقط بدون أي نص قبله أو بعده`

  // قراءة واحدة لصورة/ملف؛ تُكرَّر مرة واحدة فقط للصورة المدوّرة بعد تدويرها مستقيمة (src/lib/readingImage.js)
  async function readOnce(block) {
  const res = await analyzeFetch({
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
        content: [block, { type: 'text', text: prompt }],
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
  return result
  }

  let result = await readOnce(contentBlock)
  // صورة غير مستقيمة (تدوير غير صفري من القراءة الأولى): تُدار كاملة وتُقرأ PNG بلا فقد مرة ثانية واحدة.
  // نتيجة القراءة الأولى لا تُستعمل للأرقام (قراءة النص المائل غير موثوقة: تقرير 2026-10-18).
  let reading = { calls: 1, rotated: 0 }
  const rot = isImage ? normRotation(result?.rotation) : 0
  if (rot) {
    const up = await uprightImage(fileBase64, mime, rot)
    result = await readOnce({ type: 'image', source: { type: 'base64', media_type: up.mime, data: up.base64 } })
    reading = { calls: 2, rotated: rot, size: [up.width, up.height], stillRotated: normRotation(result?.rotation) || undefined }
  }

  // Normalize to always { invoices: [...] }
  const normalized = result.invoices ? result : { invoices: [result] }
  delete normalized.rotation
  // أثر تجهيز الصورة للمراجعة: عدد القراءات والتدوير (لا أثر له على المبالغ)
  if (reading.calls > 1) normalized._reading = reading
  // تقرير المبيعات: القنوات من أسطر وسائل الدفع المنسوخة (المرادفات والتحويل والمرتجعات وغير المعروف) — src/lib/salesReport.js.
  // مرة واحدة عند القراءة: تعديلات المحاسب بعدها لا يُعاد حسابها.
  normalized.invoices = normalized.invoices.map(normalizeSalesReading)
  // إيصال سداد مورد: بدليل مطبوع وحده، وبلا بنود (src/lib/supplierReceipts.js)
  normalized.invoices = normalized.invoices.map(normalizeReceiptReading)

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

  const res = await analyzeFetch({
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

  const res = await analyzeFetch({
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
