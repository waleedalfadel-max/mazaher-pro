const MODEL = (import.meta.env.VITE_CLAUDE_MODEL || 'claude-opus-4-5').trim()

function extractJSON(text) {
  // أزل markdown أولاً
  const clean = text.replace(/```json/gi, '').replace(/```/g, '').trim()

  const start = clean.indexOf('{')
  if (start === -1) return null

  // عدّ الأقواس لإيجاد نهاية الـ JSON بدقة — يتجنب أخطاء lastIndexOf عند وجود نص بعد الـ JSON
  let depth = 0, inStr = false, esc = false, end = -1
  for (let i = start; i < clean.length; i++) {
    const ch = clean[i]
    if (esc)              { esc = false; continue }
    if (ch === '\\' && inStr) { esc = true; continue }
    if (ch === '"')       { inStr = !inStr; continue }
    if (inStr)            continue
    if (ch === '{')       depth++
    if (ch === '}')       { depth--; if (depth === 0) { end = i; break } }
  }
  if (end === -1) return null

  const jsonStr = clean.slice(start, end + 1)
  try {
    return JSON.parse(jsonStr)
  } catch {
    const fixed = jsonStr
      .replace(/[\x00-\x1F\x7F]/g, ' ')
      .replace(/,(\s*[}\]])/g, '$1')
    return JSON.parse(fixed)
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

export async function analyzeDocument(fileBase64, mimeType, fileName, uploadedBy = '', categories = []) {
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

  const prompt = `أنت مساعد محاسبي خبير. اسم الملف: ${fileName}
اليوم: ${today}

أنواع الحركات المتاحة:
💵 مبيعات كاش | 🏦 مبيعات شبكة | 🛒 مصروفات تشغيلية | 💰 مصروفات ثابتة
💳 قسط سيارة | 💳 قسط شراء أرض | 💳 قرض ١ | 💳 قرض ٢
👤 صرف عهدة | 💼 مسحوبات سليمان | 💼 مسحوبات فايز | 🏛️ ضريبة القيمة المضافة
🔄 تحويل داخلي — صرف عهدة | 🏧 تحويل داخلي — إيداع نقدي | 📥 تحصيل جملة

مصادر الدفع: cash=صندوق نقدي | bank=بنك أو مدى أو تحويل | custody=عهدة موظف
${categorySection}
١. تقرير مبيعات (POS أو ملخص مبيعات يومي):
{"type":"sales","date":"YYYY-MM-DD","cashSales":0.00,"networkSales":0.00,"hungerSales":0.00,"jahez":0.00,"keeta":0.00,"totalSales":0.00}

٢. تحويل داخلي (حوالة بنكية لمسؤول مشتريات / صرف عهدة، أو إيصال إيداع نقدي):
{"type":"transfer","transType":"تحويل داخلي — صرف عهدة أو تحويل داخلي — إيداع نقدي","date":"YYYY-MM-DD","amount":0.00,"description":"وصف التحويل"}

٣. أي مستند آخر (فاتورة شراء، إيصال، سند، كشف) — فكّك لبنود:
{"type":"expense","date":"YYYY-MM-DD","totalAmount":0.00,"vatAmount":0.00,"transType":"اختر من القائمة أعلاه","paySource":"cash أو bank أو custody","description":"اسم المورد أو وصف الفاتورة","items":[{"description":"وصف البند","amount":0.00,"category_main":"التصنيف الرئيسي","category_sub":"التصنيف الفرعي"}]}

قواعد صارمة — لا استثناء:
- إذا كان المستند ملخص مبيعات أو تقرير مبيعات استخدم النوع الأول (sales) دائماً
- إذا كان المستند حوالة بنكية لمسؤول مشتريات أو ما يدل على صرف عهدة من البنك → استخدم النوع الثاني (transfer) مع transType="تحويل داخلي — صرف عهدة" — لا تصنّفه كمصروف
- إذا كان المستند إيصال إيداع نقدي أو تحويل من الصندوق إلى البنك → استخدم النوع الثاني (transfer) مع transType="تحويل داخلي — إيداع نقدي" — لا تصنّفه كمبيعات
- إذا كان المستند حوالة واردة (مبلغ دخل للحساب): علاماتها: كلمة "إيداع" أو "credited" أو "مبلغ مضاف" أو "تم استلام" أو اسم مرسِل/عميل جملة ظاهر → استخدم النوع الثالث (expense) مع transType="📥 تحصيل جملة" و paySource="bank" وضع المبلغ في bank_in وليس bank_out
- إذا كان المستند حوالة صادرة (مبلغ خرج من الحساب): علاماتها: كلمة "تحويل" أو "debited" أو "مبلغ مخصوم" أو اسم مستفيد/مورد → استخدم النوع الثالث (expense) مع paySource="bank" وضع المبلغ في bank_out
- cashSales: مبيعات الكاش/النقد فقط — إذا لم يُذكر صراحةً ضعه 0
- networkSales: مبيعات الشبكة/البطاقة/مدى فقط (ليس تطبيقات التوصيل) — إذا لم يُذكر ضعه 0
- hungerSales: مبيعات هنقر ستيشن / Hunger Station فقط — إذا لم يُذكر ضعه 0
- jahez: مبيعات جاهز / Jahez فقط — إذا لم يُذكر ضعه 0
- keeta: مبيعات كيتا / Keeta فقط — إذا لم يُذكر ضعه 0
- totalSales: مجموع cashSales + networkSales + hungerSales + jahez + keeta
- إذا كان الإجمالي فقط بدون تفصيل: ضع الكل في cashSales واترك الباقي 0
- transType: يجب اختياره دائماً من القائمة — الافتراضي 🛒 مصروفات تشغيلية لأي فاتورة شراء
- paySource: ثابت حسب من رفع المستند — ${
  uploadedBy === 'cashier'    ? 'cash (الكاشير يدفع من الصندوق دائماً)' :
  uploadedBy === 'purchasing' ? 'custody (مسؤول المشتريات يدفع من العهدة دائماً)' :
  uploadedBy === 'owner'      ? 'bank (المالك يدفع من البنك دائماً)' :
  'custody'
} — لا تغيّره حتى لو ذُكر غيره في المستند
- date: YYYY-MM-DD — إذا غير واضح استخدم ${today}
- totalAmount: الإجمالي الكلي للفاتورة شامل الضريبة
- vatAmount: مبلغ ضريبة القيمة المضافة كما هو مذكور — ابحث عن: ضريبة، VAT، ض.ق.م — إذا غير مذكور ضعه 0
- items: فكّك كل سطر في الفاتورة إلى بند منفصل. المبالغ في items هي الأسعار قبل الضريبة
- إذا لم تجد بنوداً مفصّلة، ضع بنداً واحداً بالمبلغ الإجمالي صافياً (totalAmount - vatAmount)
- category_main: انسخ الاسم حرفياً من القائمة أعلاه بما فيه الإيموجي — ممنوع اختراع أسماء جديدة أو تعديل الأسماء
- category_sub: انسخ الاسم حرفياً من الفرعيات تحت category_main المختار — إذا لا يوجد فرعي مناسب اتركه فارغاً ""
- JSON فقط بدون أي نص قبله أو بعده`

  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
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

  // api/analyze.js يرجع هذا عند فشل JSON.parse — يعرض النص الخام للتشخيص
  if (data.error === 'JSON_PARSE_ERROR') {
    throw new Error(`خطأ في تحليل الرد:\n${data.parseError}\n\nالنص الخام:\n${data.rawText}`)
  }

  const text = data.content[0].text.trim()

  const clean = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const result = extractJSON(clean)
  if (!result) throw new Error('لا يوجد JSON صالح في الرد')

  // تصحيح أسماء التصنيفات — يطابق بدون إيموجي ويصحح للاسم الحرفي في DB
  if (categories.length > 0 && result.items?.length > 0) {
    const norm    = s => (s || '').replace(/[^؀-ۿ\s]/g, '').replace(/\s+/g, ' ').trim()
    const parents = categories.filter(c => !c.parent_id)
    const kidsOf  = id => categories.filter(c => c.parent_id === id)
    result.items  = result.items.map(item => {
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
  }

  return result
}
