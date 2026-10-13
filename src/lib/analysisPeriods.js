// فترات التحليل المالي — وحدة خالصة (تُختبر في Node). التواريخ نصوص ISO (YYYY-MM-DD) تُحسب بلا منطقة زمنية،
// و«اليوم» وحده يُقرأ بتوقيت المنشأة (افتراضيًا Asia/Riyadh): حدود اليوم والشهر لا تتبع ساعة جهاز المستخدم.
//
// القواعد:
// • آخر شهر مكتمل (الافتراضي) مقابل الشهر الذي قبله، كفترتين تقويميتين بعدد أيام كل منهما.
// • الشهر الحالي حتى اليوم مقابل الأيام نفسها من الشهر السابق (1..اليوم). إن كان الشهر السابق أقصر، تنتهي المقارنة بآخر يوم فيه
//   ويُذكر الفرق في عدد الأيام؛ لا تمتد إلى أيام شهر آخر.
// • شهر محدد مقابل الشهر الذي قبله؛ الشهر الحالي يُعامل «حتى اليوم»؛ وشهر مستقبلي مرفوض.
// • فترة مخصصة مقابل الفترة السابقة لها مباشرة بالطول نفسه، بلا تداخل؛ ولا أيام بعد اليوم.
// • خط الأساس (اختياري): آخر ثلاث فترات مكتملة قبل الفترة الحالية بالشكل نفسه (ثلاثة أشهر كاملة، أو الأيام المقابلة منها للشهر
//   الحالي، أو ثلاث فترات سابقة بالطول نفسه للفترة المخصصة).
import { addDays, daysBetween, parseDate, toISO } from '../ui/format.js'

export const DEFAULT_TZ = 'Asia/Riyadh'
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
const ISO = /^\d{4}-\d{2}-\d{2}$/

/** تاريخ اليوم بتوقيت المنشأة. */
export function todayIn(tz = DEFAULT_TZ, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export const monthLength = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
export const isValidIso = s => ISO.test(s || '') && toISO(...Object.values(parseDate(s))) === s
const shiftMonth = (y, m, k) => { const t = y * 12 + (m - 1) + k; return { y: Math.floor(t / 12), m: (t % 12) + 1 } }
const pad = n => String(n).padStart(2, '0')
export const monthKey = (y, m) => `${y}-${pad(m)}`

/** نافذة: من/إلى وعدد الأيام ووصفها. */
export function windowOf(from, to, label, extra = {}) {
  return { from, to, days: daysBetween(from, to) + 1, label, ...extra }
}

export function fullMonth(y, m) {
  return windowOf(toISO(y, m, 1), toISO(y, m, monthLength(y, m)), `${MONTHS[m - 1]} ${y}`, { month: monthKey(y, m) })
}

/** أيام 1..day من شهر، مقصوصة على طوله؛ clipped = عدد الأيام المطلوبة التي لا توجد فيه. */
function monthToDay(y, m, day) {
  const last = Math.min(day, monthLength(y, m))
  return windowOf(toISO(y, m, 1), toISO(y, m, last), `1–${last} ${MONTHS[m - 1]} ${y}`, { month: monthKey(y, m), clipped: day - last })
}

/**
 * يحسب الفترة الحالية وفترة المقارنة وخط الأساس.
 * @param {{kind:'last_month'|'mtd'|'month'|'custom', year?, month?, from?, to?}} sel
 * @returns {{ ok:true, kind, cur, prev, baseline:[] , today } | { ok:false, code }}
 */
export function resolvePeriods(sel, today) {
  const t = parseDate(today)
  const kind = sel?.kind || 'last_month'
  if (kind === 'last_month') {
    const a = shiftMonth(t.y, t.m, -1)
    return monthPair(a.y, a.m, today, 'last_month')
  }
  if (kind === 'mtd') return mtd(t.y, t.m, t.d, today)
  if (kind === 'month') {
    const y = Number(sel.year), m = Number(sel.month)
    if (!(y >= 2000 && m >= 1 && m <= 12)) return { ok: false, code: 'bad_month' }
    if (y * 12 + m > t.y * 12 + t.m) return { ok: false, code: 'future' }
    if (y === t.y && m === t.m) return { ...mtd(y, m, t.d, today), kind: 'month' }
    return monthPair(y, m, today, 'month')
  }
  if (kind === 'custom') {
    const { from, to } = sel
    if (!isValidIso(from) || !isValidIso(to)) return { ok: false, code: 'bad_date' }
    if (from > to) return { ok: false, code: 'reversed' }
    if (to > today) return { ok: false, code: 'future' }
    const len = daysBetween(from, to) + 1
    const cur = windowOf(from, to, null)
    const before = k => windowOf(addDays(from, -len * k), addDays(from, -len * (k - 1) - 1), null)
    return { ok: true, kind, today, cur, prev: before(1), baseline: [1, 2, 3].map(before) }
  }
  return { ok: false, code: 'bad_kind' }
}

function monthPair(y, m, today, kind) {
  const cur = fullMonth(y, m)
  const p = shiftMonth(y, m, -1)
  return { ok: true, kind, today, cur, prev: fullMonth(p.y, p.m), baseline: [1, 2, 3].map(k => { const b = shiftMonth(y, m, -k); return fullMonth(b.y, b.m) }) }
}

function mtd(y, m, d, today) {
  const cur = windowOf(toISO(y, m, 1), today, `1–${d} ${MONTHS[m - 1]} ${y}`, { month: monthKey(y, m), partial: true })
  const at = k => { const b = shiftMonth(y, m, -k); return monthToDay(b.y, b.m, d) }
  return { ok: true, kind: 'mtd', today, cur, prev: at(1), baseline: [1, 2, 3].map(at) }
}

/** الأشهر التقويمية للاتجاه: حتى n شهرًا تنتهي بشهر نهاية الفترة؛ الشهر الذي لم ينته بعد يُعلَّم جزئيًا ويُقصّ على اليوم. */
export function trendMonths(endIso, today, n = 6) {
  const e = parseDate(endIso)
  const out = []
  for (let k = n - 1; k >= 0; k--) {
    const { y, m } = shiftMonth(e.y, e.m, -k)
    const w = fullMonth(y, m)
    if (w.from > today) continue
    out.push(w.to > today ? { ...w, to: today, days: daysBetween(w.from, today) + 1, partial: true } : w)
  }
  return out
}

/** وصف فترة للعرض: «سبتمبر 2026» أو «1–10 أكتوبر 2026» أو «3 – 17 سبتمبر 2026». */
export function windowText(w) {
  if (w.label) return w.label
  const a = parseDate(w.from), b = parseDate(w.to)
  if (a.y === b.y && a.m === b.m) return a.d === b.d ? `${a.d} ${MONTHS[a.m - 1]} ${a.y}` : `${a.d}–${b.d} ${MONTHS[a.m - 1]} ${a.y}`
  return `${a.d} ${MONTHS[a.m - 1]}${a.y !== b.y ? ' ' + a.y : ''} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`
}

/** مدى الجلب: من أبكر نافذة إلى أبعدها (الفترة والمقارنة وخط الأساس والاتجاه)، فلا يُعرض شهر في الاتجاه كاملًا وبعض أيامه لم تُجلب. */
export function fetchRange(p, trend = []) {
  const all = [p.cur, p.prev, ...(p.baseline || []), ...trend]
  return { from: all.reduce((m, w) => (w.from < m ? w.from : m), p.cur.from), to: all.reduce((m, w) => (w.to > m ? w.to : m), p.cur.to) }
}
