// تنسيق الأرقام والتواريخ للواجهة. دوال نقية بلا اعتماد على المتصفح، فتُختبر في Node.

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

/** 1234.5 → "1,234.50" (أرقام لاتينية كما في تحسيب للتجزئة). */
export function formatNumber(value, decimals = 2) {
  const n = Number(value) || 0
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/** "2026-09-20" → { y, m, d } بلا منطقة زمنية. */
export function parseDate(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return { y, m, d }
}

export function toISO(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toISOString().slice(0, 10)
}

export function addDays(iso, days) {
  const { y, m, d } = parseDate(iso)
  return toISO(y, m, d + days)
}

export function daysBetween(fromIso, toIso) {
  const a = parseDate(fromIso), b = parseDate(toIso)
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000)
}

export function weekday(iso) {
  const { y, m, d } = parseDate(iso)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** "2026-09-20" → "20 سبتمبر" (والسنة إن اختلفت عن سنة المرجع). */
export function formatDate(iso, { year = false, day = false, refYear } = {}) {
  if (!iso) return '—'
  const { y, m, d } = parseDate(iso)
  const withYear = year || (refYear && refYear !== y)
  return `${day ? DAYS[weekday(iso)] + ' ' : ''}${d} ${MONTHS[m - 1]}${withYear ? ' ' + y : ''}`
}

/** نطاق مختصر: "1–26 سبتمبر" أو "28 أغسطس – 3 سبتمبر". */
export function formatRange(from, to) {
  if (from === to) return formatDate(from)
  const a = parseDate(from), b = parseDate(to)
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS[b.m - 1]}`
  return `${formatDate(from)} – ${formatDate(to)}`
}

/** "2026-09-26T10:42" → "10:42 ص" */
export function formatTime(isoDateTime) {
  const [h, min] = String(isoDateTime).slice(11, 16).split(':').map(Number)
  const suffix = h < 12 ? 'ص' : 'م'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(min).padStart(2, '0')} ${suffix}`
}

/** "منذ 3 أيام" بالنسبة إلى يوم مرجعي. */
export function formatAgo(isoDateTime, todayIso) {
  const days = daysBetween(String(isoDateTime).slice(0, 10), todayIso)
  if (days <= 0) return `اليوم ${formatTime(isoDateTime)}`
  if (days === 1) return 'أمس'
  if (days === 2) return 'منذ يومين'
  if (days <= 10) return `منذ ${days} أيام`
  return `منذ ${days} يومًا`
}

/**
 * العدد مع المعدود حسب قواعد العربية المبسطة:
 * plural(1, 'مستند واحد', 'مستندان', 'مستندات', 'مستندًا') → "مستند واحد"
 */
export function plural(n, one, two, few, many) {
  if (n === 0) return `لا ${few}`
  if (n === 1) return one
  if (n === 2) return two
  if (n >= 3 && n <= 10) return `${n} ${few}`
  return `${n} ${many}`
}

/** "2026-09-25" → "25/09/2026" لحقل التاريخ. */
export function isoToDayText(iso) {
  if (!iso) return ''
  const { y, m, d } = parseDate(iso)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

/** "25/9/2026" أو "٢٥/٠٩/٢٠٢٦" → "2026-09-25"، أو null إن لم يكن تاريخًا صحيحًا. */
export function dayTextToIso(text) {
  const latin = String(text || '').replace(/[٠-٩]/g, ch => String(ch.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, ch => String(ch.charCodeAt(0) - 0x06F0))
  const m = latin.trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/)
  if (!m) return null
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const iso = toISO(y, mo, d)
  return isoToDayText(iso) === `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}` ? iso : null
}

/**
 * يقرأ رقمًا كتبه المستخدم: يقبل الأرقام العربية والفارسية، والفاصلة العشرية «٫»، وفواصل الآلاف.
 * يعيد NaN لكل ما ليس رقمًا (ومنه الفارغ)، ولا يحوّله إلى صفر.
 */
export function parseDecimal(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  const s = String(value ?? '').trim()
    .replace(/[٠-٩]/g, ch => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, ch => String(ch.charCodeAt(0) - 0x06F0))
    .replace(/٫/g, '.')
    .replace(/[,٬\s]/g, '')
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN
}

/**
 * مبلغ من حقل نصي («سجل الدفتر»): الفارغ صفر لأن الحقل اختياري. المقبول: أرقام لاتينية أو عربية أو فارسية، وفاصلة عشرية «.» أو «٫»،
 * وفواصل آلاف «,» أو «٬» في مواضعها الصحيحة فقط، وإشارة سالب في أوله (كان الحقل السابق يقبلها).
 * كل ما عدا ذلك (مثل «230 ريال» أو «12.3.4» أو «1,23» أو «1e3») يعيد NaN ليُرفض برسالة، لا ليصير صفرًا أو رقمًا آخر بصمت.
 */
export function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  const s = String(value ?? '').trim()
    .replace(/[٠-٩]/g, ch => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, ch => String(ch.charCodeAt(0) - 0x06F0))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
    .replace(/^−/, '-')
  if (s === '') return 0
  const m = s.match(/^(-?)(\d+|\d{1,3}(?:,\d{3})+)?(?:\.(\d*))?$/)
  if (!m || (!m[2] && !m[3])) return NaN
  const n = Number(`${m[1]}${(m[2] || '0').replace(/,/g, '')}.${m[3] || '0'}`)
  return n === 0 ? 0 : n
}
