// قراءة تقرير المبيعات (2026-10-18): وسائل الدفع كما طُبعت في التقرير ← قنوات تحسيب، والمرتجعات، والإجمالي المطبوع.
// المزوّد ينسخ أسطر وسائل الدفع والمرتجعات حرفيًا (paymentLines / returnLines)، والتصنيف هنا بقواعد ثابتة قابلة للاختبار:
//   • «كاش توصيل» و«توصيل كاش» نقدي، و«مدى توصيل» و«توصيل مدى» شبكة: «توصيل» وصف لطريقة التسليم لا قناة، ولا تدل وحدها على تطبيق.
//   • التحويل قناة مستقلة (حسابها البنكي كالشبكة).
//   • سطر لا يُعرف بمبلغ غير صفري لا يُهمل: يبقى في unknownPayments للمراجعة، ويمنع الاعتماد حتى يُنسب لقناة أو يُستبعد بسبب.
//   • المرتجع يُخصم مرة واحدة من قناته: القناة المسجلة = قبل المرتجعات − مرتجعاتها (ما دخل الصندوق أو الحساب فعلًا).
//   • totalSales = إجمالي التقرير المطبوع (لا مجموع القنوات)، فيرفض الخادم أي فرق غير مفسّر (amounts_mismatch).
import { toHalalas, fromHalalas } from './approvalV2.js'

export const CHANNELS = ['cash', 'network', 'transfer', 'hunger', 'jahez', 'keeta', 'mrsool']
export const CHANNEL_FIELD = { cash: 'cashSales', network: 'networkSales', transfer: 'transferSales', hunger: 'hungerSales', jahez: 'jahez', keeta: 'keeta', mrsool: 'mrsool' }
export const CHANNEL_NAME = { cash: 'نقدي', network: 'شبكة / مدى', transfer: 'تحويل', hunger: 'هنقرستيشن', jahez: 'جاهز', keeta: 'كيتا', mrsool: 'مرسول' }

/** توحيد الكتابة العربية واللاتينية للمطابقة: بلا تشكيل ولا تطويل، والألف والياء والتاء المربوطة بصورة واحدة، وبلا رموز وأرقام. */
export function normLabel(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[^a-zء-ي\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

const WORDS = {
  cash: ['كاش', 'نقدي', 'نقدا', 'نقد', 'cash'],
  network: ['مدي', 'شبكه', 'بطاقه', 'mada', 'card', 'visa', 'فيزا', 'span'],
  transfer: ['تحويل', 'transfer'],
  hunger: ['هنقر', 'هنقرستيشن', 'هنجر', 'hunger', 'hungerstation'],
  jahez: ['جاهز', 'jahez'],
  keeta: ['كيتا', 'keeta'],
  mrsool: ['مرسول', 'mrsool', 'marsool'],   // «Marsool» كما يطبعه تقرير نقاط البيع (قراءة فعلية 2026-10-18)
}
// كلمات تصف ولا تحدد قناة: تُهمل في التصنيف («توصيل» منها: لا تدل وحدها على تطبيق توصيل)
const MODIFIERS = new Set(['توصيل', 'delivery', 'بنكي', 'بنكيه', 'مبيعات', 'sales', 'ستيشن', 'station', 'دفع', 'payment', 'عبر', 'بال', 'ب', 'و', 'طلبات', 'تطبيق'])
// كلمات المرتجع: وصف مقبول في أسطر المرتجعات وحدها؛ في أسطر وسائل الدفع تجعل السطر للمراجعة (لا يُحسب مرتجعٌ بيعًا)
const RETURN_WORDS = new Set(['مرتجع', 'مرتجعات', 'استرجاع', 'مسترجع', 'refund', 'refunds', 'return', 'returns'])
const LOOKUP = new Map(Object.entries(WORDS).flatMap(([ch, ws]) => ws.map(w => [normLabel(w), ch])))

function tokenChannel(t) {
  if (LOOKUP.has(t)) return LOOKUP.get(t)
  if (t.startsWith('ال') && t.length > 3 && LOOKUP.has(t.slice(2))) return LOOKUP.get(t.slice(2))
  if (t.startsWith('بال') && t.length > 4 && LOOKUP.has(t.slice(3))) return LOOKUP.get(t.slice(3))
  return null
}

/**
 * قناة سطر وسيلة دفع كما طُبع، أو null (غير معروفة أو ملتبسة).
 * كل كلمة يجب أن تكون قناة واحدة أو وصفًا معروفًا؛ أي كلمة أخرى (مثل «أبل باي») أو قناتان في سطر واحد ⇒ null للمراجعة.
 */
export function classifyPaymentLabel(label, { returns = false } = {}) {
  const tokens = normLabel(label).split(' ').filter(Boolean)
  const found = new Set()
  for (const t of tokens) {
    const ch = tokenChannel(t)
    if (ch) { found.add(ch); continue }
    if (MODIFIERS.has(t) || (t.startsWith('ال') && MODIFIERS.has(t.slice(2)))) continue
    if (returns && (RETURN_WORDS.has(t) || (t.startsWith('ال') && RETURN_WORDS.has(t.slice(2))))) continue
    return null
  }
  return found.size === 1 ? [...found][0] : null
}

const amountH = v => { const h = toHalalas(typeof v === 'string' ? v.replace(/,/g, '') : v); return h == null || Number.isNaN(h) ? null : h }

/**
 * يحوّل قراءة تقرير مبيعات فيها paymentLines إلى حقول القنوات المعتادة (صافية بعد المرتجعات) وتفصيل للمراجعة.
 * بلا paymentLines (قراءة قديمة أو مستند غير مبيعات): يعيد الفاتورة كما هي.
 */
export function normalizeSalesReading(inv) {
  if (!inv || inv.type !== 'sales' || !Array.isArray(inv.paymentLines)) return inv
  const zero = () => Object.fromEntries(CHANNELS.map(c => [c, 0]))
  const gross = zero(), returns = zero(), unknown = [], lines = [], returnLines = []
  let unreadable = 0
  // سطر بلا مبلغ مقروء لا يُحذف: يبقى باسمه ونوعه للمراجعة (unreadable)، ويمنع الاعتماد حتى يُكتب مبلغه أو يُستبعد بسبب (مراجعة a2f72ca)
  const keepUnreadable = (l, kind) => { unreadable++; unknown.push({ label: String(l?.label ?? ''), amount: null, kind, unreadable: true }) }
  for (const l of inv.paymentLines) {
    const h = amountH(l?.amount)
    if (h == null) { keepUnreadable(l, 'payment'); continue }
    if (h === 0) continue
    const ch = classifyPaymentLabel(l?.label)
    lines.push({ label: String(l?.label ?? ''), amount: fromHalalas(h), channel: ch })
    if (ch) gross[ch] += h; else unknown.push({ label: String(l?.label ?? ''), amount: fromHalalas(h), kind: 'payment' })
  }
  for (const l of inv.returnLines || []) {
    const h = amountH(l?.amount)
    if (h == null) { keepUnreadable(l, 'return'); continue }
    if (h === 0) continue
    const ch = classifyPaymentLabel(l?.label, { returns: true })
    returnLines.push({ label: String(l?.label ?? ''), amount: fromHalalas(Math.abs(h)), channel: ch })
    if (ch) returns[ch] += Math.abs(h); else unknown.push({ label: String(l?.label ?? ''), amount: fromHalalas(-Math.abs(h)), kind: 'return' })
  }
  const out = { ...inv }
  for (const c of CHANNELS) out[CHANNEL_FIELD[c]] = Number(fromHalalas(gross[c] - returns[c]))
  const knownUnknownReturns = unknown.filter(u => u.kind === 'return' && !u.unreadable)
  const totalReturns = Object.values(returns).reduce((t, h) => t + h, 0) + knownUnknownReturns.reduce((t, u) => t - amountH(u.amount), 0)
  const netPrinted = amountH(inv.reportNetTotal), grossPrinted = amountH(inv.reportGrossTotal)
  // الإجمالي المطبوع بعد المرتجعات: المطبوع صراحة، أو قبل المرتجعات − المرتجعات ما دامت كلها مقروءة؛ وإلا يُكتب من التقرير يدويًا
  const unreadableReturn = unknown.some(u => u.kind === 'return' && u.unreadable)
  const printed = netPrinted ?? (grossPrinted != null && !unreadableReturn ? grossPrinted - totalReturns : null)
  if (printed != null) out.totalSales = Number(fromHalalas(printed)); else delete out.totalSales
  out.unknownPayments = unknown
  // قراءة بالأسطر (الجديدة): الإجمالي المستقل من التقرير شرط للاعتماد في الشاشة والخادم؛ المستندات القديمة بلا هذه العلامة كما كانت
  out.salesReadingVersion = 2
  out.salesBreakdown = {
    lines, returnLines, unreadable,
    gross: Object.fromEntries(CHANNELS.map(c => [c, Number(fromHalalas(gross[c]))])),
    returns: Object.fromEntries(CHANNELS.map(c => [c, Number(fromHalalas(returns[c]))])),
    grossTotal: Number(fromHalalas(Object.values(gross).reduce((t, h) => t + h, 0))),
    returnsTotal: Number(fromHalalas(totalReturns)),
    printedGross: grossPrinted == null ? null : Number(fromHalalas(grossPrinted)),
    printedNet: netPrinted == null ? null : Number(fromHalalas(netPrinted)),
  }
  return out
}

/** مجموع القنوات المسجلة بالهللة. */
export const channelsTotalH = inv => CHANNELS.reduce((t, c) => t + (amountH(inv?.[CHANNEL_FIELD[c]] ?? 0) ?? 0), 0)

/**
 * فحص تقرير المبيعات قبل الاعتماد: وسائل غير معروفة، وقناة سالبة (مرتجع أكبر من مبيعات قناته)، والفرق مع الإجمالي المطبوع.
 * @returns {{ ok: boolean, reasons: string[], unknown: object[], total: number|null, channels: number, diff: number|null }}
 */
export function salesReportCheck(inv) {
  const reasons = []
  // غير المعروف بمبلغ غير صفري، وكل سطر بلا مبلغ مقروء (لا يُعدّ صفرًا)
  const unknown = (inv?.unknownPayments || []).filter(u => { const h = amountH(u?.amount); return h == null || h !== 0 })
  const unreadable = unknown.filter(u => amountH(u?.amount) == null), unmapped = unknown.filter(u => amountH(u?.amount) != null)
  if (unreadable.length) reasons.push(`سطر في التقرير بلا مبلغ مقروء: ${unreadable.map(u => `«${u.label || '—'}» (${u.kind === 'return' ? 'مرتجع' : 'وسيلة دفع'})`).join('، ')}. اكتب مبلغه من التقرير وانسبه إلى قناته، أو استبعده بسبب.`)
  if (unmapped.length) reasons.push(`وسيلة دفع غير معروفة في التقرير: ${unmapped.map(u => `«${u.label || '—'}» ${u.amount}`).join('، ')}. انسبها إلى قناتها أو استبعدها بسبب.`)
  if ((inv?.resolvedPayments || []).some(r => !r?.channel && !String(r?.reason || '').trim())) reasons.push('سطر مستبعد بلا سبب موثّق. اكتب سبب الاستبعاد.')
  const negative = CHANNELS.filter(c => (amountH(inv?.[CHANNEL_FIELD[c]] ?? 0) ?? 0) < 0)
  if (negative.length) reasons.push(`مرتجعات ${negative.map(c => CHANNEL_NAME[c]).join(' و')} أكبر من مبيعاتها في التقرير. راجع القراءة.`)
  const ch = channelsTotalH(inv)
  const t = inv?.totalSales == null || inv.totalSales === '' ? null : amountH(inv.totalSales)
  const diff = t == null ? null : ch - t
  // القراءة الجديدة بلا إجمالي مستقل من التقرير: لا اعتماد (لا يُستعمل مجموع القنوات بديلًا). القديمة (بلا salesReadingVersion) كما كانت
  if (t == null && Number(inv?.salesReadingVersion) >= 2) reasons.push('اكتب «إجمالي التقرير المطبوع» شامل الضريبة بعد المرتجعات (مثل Net sales with tax) من التقرير نفسه، ليُطابق قبل الاعتماد.')
  if (inv?.totalSales != null && inv.totalSales !== '' && t == null) reasons.push('إجمالي التقرير المطبوع ليس مبلغًا صالحًا.')
  if (diff) reasons.push(`مجموع وسائل الدفع ${fromHalalas(ch)} لا يطابق إجمالي التقرير ${fromHalalas(t)}: الفرق ${fromHalalas(Math.abs(diff))}.`)
  return { ok: reasons.length === 0, reasons, unknown, total: t == null ? null : Number(fromHalalas(t)), channels: Number(fromHalalas(ch)), diff: diff == null ? null : Number(fromHalalas(diff)) }
}

/**
 * نسبة سطر غير معروف إلى قناة (أو استبعاده بسبب): يُضاف مبلغه إلى القناة (أو يُطرح إن كان مرتجعًا)، ويُسجَّل القرار للمراجعة.
 * @param {number} index موضعه في unknownPayments
 * @param {string|null} channel قناة من CHANNELS، أو null للاستبعاد (ليس وسيلة دفع)
 * @param {string} reason سبب الاستبعاد (شرط له)
 * @param {string|number} [amount] المبلغ من التقرير لسطر بلا مبلغ مقروء (شرط لنسبته؛ موجب، والمرتجع يُطرح)
 * لا تغيير (يعيد الفاتورة كما هي) لاستبعاد بلا سبب، أو لنسبة سطر غير مقروء بلا مبلغ صالح.
 */
export function resolveUnknownPayment(inv, index, channel, reason = '', amount) {
  const u = inv?.unknownPayments?.[index]
  if (!u) return inv
  const why = String(reason || '').trim()
  if (!channel && !why) return inv
  let h = amountH(u.amount)
  if (channel && h == null) {
    const typed = amountH(amount)
    if (typed == null || typed <= 0) return inv
    h = u.kind === 'return' ? -typed : typed
  }
  const out = { ...inv, unknownPayments: inv.unknownPayments.filter((_, i) => i !== index) }
  if (channel) {
    const f = CHANNEL_FIELD[channel]
    out[f] = Number(fromHalalas((amountH(inv[f] ?? 0) ?? 0) + h))
  }
  out.resolvedPayments = [...(inv.resolvedPayments || []), { label: u.label, amount: h == null ? null : fromHalalas(h), kind: u.kind, channel: channel || null,
    ...(u.unreadable ? { unreadable: true } : {}), ...(channel ? {} : { reason: why }) }]
  return out
}
