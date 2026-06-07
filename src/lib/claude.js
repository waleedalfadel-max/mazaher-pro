// strip any non-ASCII chars that would fail ISO-8859-1 header validation
const API_KEY = (import.meta.env.VITE_CLAUDE_API_KEY || '').trim().replace(/[^\x20-\x7E]/g, '')
const MODEL   = (import.meta.env.VITE_CLAUDE_MODEL  || 'claude-opus-4-5').trim()

export async function analyzeDocument(fileBase64, mimeType, fileName, uploadedBy = '') {
  const isImage = mimeType.startsWith('image/')
  const isPdf   = mimeType === 'application/pdf'

  const contentBlock = isImage
    ? { type: 'image', source: { type: 'base64', media_type: mimeType, data: fileBase64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } }

  const today = new Date().toISOString().split('T')[0]

  const prompt = `أنت مساعد محاسبي خبير. اسم الملف: ${fileName}
اليوم: ${today}

أنواع الحركات المتاحة:
💵 مبيعات كاش | 🏦 مبيعات شبكة | 🛒 مصروفات تشغيلية | 💰 مصروفات ثابتة
💳 قسط سيارة | 💳 قسط شراء أرض | 💳 قرض ١ | 💳 قرض ٢
👤 صرف عهدة | 💼 مسحوبات سليمان | 💼 مسحوبات أم طوبى | 🏛️ ضريبة القيمة المضافة

مصادر الدفع: cash=صندوق نقدي | bank=بنك أو مدى أو تحويل | custody=عهدة موظف

١. تقرير مبيعات (POS أو ملخص مبيعات يومي):
{"type":"sales","date":"YYYY-MM-DD","cashSales":0.00,"networkSales":0.00,"totalSales":0.00}

٢. أي مستند آخر (فاتورة شراء، إيصال، سند، كشف):
{"type":"auto","date":"YYYY-MM-DD","amount":0.00,"vatAmount":0.00,"transType":"اختر من القائمة أعلاه","paySource":"cash أو bank أو custody","description":"وصف مختصر"}

قواعد صارمة — لا استثناء:
- إذا كان المستند ملخص مبيعات أو تقرير مبيعات استخدم النوع الأول (sales) دائماً
- cashSales: مبيعات الكاش/النقد فقط — إذا لم يُذكر صراحةً ضعه 0
- networkSales: مبيعات الشبكة/البطاقة/المدى فقط — إذا لم يُذكر صراحةً ضعه 0
- إذا كان الإجمالي فقط بدون تفصيل: ضع الكل في cashSales واترك networkSales صفراً
- transType: يجب اختياره دائماً من القائمة — الافتراضي 🛒 مصروفات تشغيلية لأي فاتورة شراء
- paySource: ثابت حسب من رفع المستند — ${
  uploadedBy === 'cashier'    ? 'cash (الكاشير يدفع من الصندوق دائماً)' :
  uploadedBy === 'purchasing' ? 'custody (مسؤول المشتريات يدفع من العهدة دائماً)' :
  uploadedBy === 'owner'      ? 'bank (المالك يدفع من البنك دائماً)' :
  'custody'
} — لا تغيّره حتى لو ذُكر غيره في المستند
- date: YYYY-MM-DD — إذا غير واضح استخدم ${today}
- amount: الإجمالي شامل الضريبة (المبلغ الكامل المدفوع)
- vatAmount: مبلغ ضريبة القيمة المضافة (VAT/ضريبة) كما هو مذكور في الفاتورة — ابحث عن كلمات: ضريبة، VAT، الضريبة، ض.ق.م — إذا غير مذكور ضعه 0
- JSON فقط بدون أي نص قبله أو بعده`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: [contentBlock, { type: 'text', text: prompt }],
      }],
    }),
  })

  if (!res.ok) throw new Error(`Claude API error: ${res.status}`)
  const data = await res.json()
  const text = data.content[0].text.trim()

  const clean = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const s = clean.indexOf('{'), e = clean.lastIndexOf('}')
  if (s === -1 || e === -1) throw new Error('لا يوجد JSON في الرد')
  return JSON.parse(clean.substring(s, e + 1))
}
