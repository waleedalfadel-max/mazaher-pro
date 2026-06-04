const API_KEY = import.meta.env.VITE_CLAUDE_API_KEY
const MODEL   = import.meta.env.VITE_CLAUDE_MODEL || 'claude-opus-4-5'

export async function analyzeDocument(fileBase64, mimeType, fileName) {
  const isImage = mimeType.startsWith('image/')
  const isPdf   = mimeType === 'application/pdf'

  const contentBlock = isImage
    ? { type: 'image', source: { type: 'base64', media_type: mimeType, data: fileBase64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } }

  const today = new Date().toISOString().split('T')[0]

  const prompt = `أنت مساعد محاسبي. اسم الملف: ${fileName}
اليوم: ${today}

أنواع الحركات: 💵 مبيعات كاش | 🏦 مبيعات شبكة | 🛒 مصروفات تشغيلية | 💰 مصروفات ثابتة | 💳 قسط قرض | 👤 صرف عهدة | ✅ تسوية عهدة | 💼 مسحوبات سليمان | 💼 مسحوبات أم طوبى | 🏛️ ضريبة القيمة المضافة

مصادر الدفع: cash = صندوق | bank = بنك/مدى/تحويل | custody = عهدة

١. تقرير POS (مبيعات يومية):
{"type":"sales","date":"YYYY-MM-DD","cashSales":0.00,"networkSales":0.00,"totalSales":0.00}

٢. مستند واضح (إيصال بنكي، سند صرف):
{"type":"auto","date":"YYYY-MM-DD","amount":0.00,"vatAmount":0.00,"transType":"النوع من القائمة","paySource":"cash/bank/custody","description":"وصف أقل من 50 حرف"}

٣. فاتورة شراء عادية:
{"type":"auto","date":"YYYY-MM-DD","amount":0.00,"vatAmount":0.00,"transType":"🛒 مصروفات تشغيلية","paySource":"custody","description":"وصف"}

٤. غير واضح:
{"type":"expense","date":"YYYY-MM-DD","amount":0.00,"vatAmount":0.00,"description":"وصف"}

قواعد: التاريخ YYYY-MM-DD — المبلغ الإجمالي فقط — vatAmount إذا مذكور وإلا 0 — JSON فقط بدون أي نص إضافي`

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
