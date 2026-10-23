// كشف حساب تطبيقات التوصيل (ذمم مدينة): دوال خالصة بلا React ولا Supabase.
// الرصيد الدفتري من قيود الدفتر وحدها: مبيعات التطبيق (receivable_in) ناقص تحصيلاته وتسوياته (receivable_out).
// لا رصيد افتتاحي مقدَّر: رصيد بداية الفترة هو مجموع قيود التطبيق المسجلة قبلها في تحسيب، لا غير؛
// وما قبل أول قيد مسجل للتطبيق (قبل بدء الاستخدام) غير معروف ولا يُفترض صفرًا.
import { APPS } from './appReconciliation.js'
import { isCounted } from './financeRules.js'
import { toLatinNumber } from './amountInput.js'

export { APPS }
const cents = v => Math.round((Number(v) || 0) * 100)
const money = c => c / 100
const hasReceivable = e => cents(e.receivable_in) !== 0 || cents(e.receivable_out) !== 0
// الحالات المحتسبة نفسها في المحرك والتقارير واللوحة (financeRules.isCounted: approved وauto)؛ المعلّق والمرفوض والملغى وبلا حالة لا تدخل الكشف
const counted = isCounted
const order = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.journal_number || '').localeCompare(String(b.journal_number || '')) || String(a.id).localeCompare(String(b.id))

/**
 * نسبة قيد ذمم إلى تطبيق، بلا تخمين:
 * - نوع القيد يذكر تطبيقًا واحدًا (مبيعات التطبيق أو تحصيل ذممه): ذلك التطبيق.
 * - وإلا فالوصف (تسويات مثل عمولات «مطابقة التطبيقات» المسجلة بنوع مصروف ووصف «عمولات هنقر…»): إن ذكر تطبيقًا واحدًا فقط.
 * - وصف يذكر أكثر من تطبيق، أو لا يذكر أيًّا منها: غير منسوب، ويظهر للمراجعة.
 */
export function attribution(entry) {
  if (!entry || !hasReceivable(entry)) return { app: null, reason: null }
  const inType = APPS.filter(a => (entry.type || '').includes(a.keyword))
  if (inType.length === 1) return { app: inType[0].key, by: 'type' }
  if (inType.length > 1) return { app: null, reason: 'نوع القيد يذكر أكثر من تطبيق' }
  const inDesc = APPS.filter(a => (entry.description || '').includes(a.keyword))
  if (inDesc.length === 1) return { app: inDesc[0].key, by: 'description' }
  return { app: null, reason: inDesc.length > 1 ? 'الوصف يذكر أكثر من تطبيق' : 'لا يذكر النوع ولا الوصف تطبيقًا' }
}
export const appOf = entry => attribution(entry).app

/** نوع الحركة في الكشف. */
export function kindOf(entry) {
  const type = entry.type || ''
  if (type.includes('تحصيل ذمم')) return 'collection'
  if (type.includes('مبيعات') && cents(entry.receivable_in) > 0 && cents(entry.receivable_out) === 0) return 'sale'
  return 'settlement'
}
export const KIND_LABEL = { sale: 'مبيعات', collection: 'تحصيل', settlement: 'تسوية' }

/** الرصيد الدفتري لكل تطبيق حتى تاريخ (شاملًا)، والذمم غير المنسوبة لتطبيق. كل قيد يُحتسب مرة واحدة: لتطبيق واحد أو لغير المنسوب. */
export function receivableBalances(entries, to = null) {
  const out = Object.fromEntries(APPS.map(a => [a.key, 0])), seen = new Set()
  let unassigned = 0
  for (const e of entries || []) {
    if (!counted(e) || !hasReceivable(e) || (to && String(e.date) > to)) continue
    const k = appOf(e), d = cents(e.receivable_in) - cents(e.receivable_out)
    if (k) { out[k] += d; seen.add(k) } else unassigned += d
  }
  return { balances: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, money(v)])), active: APPS.filter(a => seen.has(a.key)).map(a => a.key), unassigned: money(unassigned) }
}

/** قيود ذمم لا يمكن نسبتها لتطبيق بثقة حتى تاريخ: تُعرض للمراجعة ولا تُوزَّع. */
export function unassignedEntries(entries, to = null) {
  return (entries || []).filter(e => counted(e) && hasReceivable(e) && (!to || String(e.date) <= to) && !appOf(e)).sort(order)
    .map(e => ({ id: e.id, date: e.date, journal: e.journal_number || '', type: e.type || '', description: e.description || '', reason: attribution(e).reason,
      amount: money(cents(e.receivable_in) - cents(e.receivable_out)) }))
}

/**
 * كشف حساب تطبيق واحد للفترة: رصيد بداية الفترة من قيود تحسيب السابقة، ثم كل حركة في عمودها (مبيعات / تحصيل / تسوية) برصيدها بعدها.
 * firstRecorded: تاريخ أول قيد مسجل للتطبيق في تحسيب؛ ما قبله غير معروف.
 */
export function buildAppStatement(entries, app, { from, to }) {
  const all = (entries || []).filter(e => counted(e) && appOf(e) === app).sort(order)
  const mine = all.filter(e => !to || String(e.date) <= to)
  let opening = 0
  const before = mine.filter(e => from && String(e.date) < from)
  for (const e of before) opening += cents(e.receivable_in) - cents(e.receivable_out)
  let bal = opening
  const totals = { sale: 0, collection: 0, settlement: 0 }
  const rows = mine.filter(e => !from || String(e.date) >= from).map(e => {
    const delta = cents(e.receivable_in) - cents(e.receivable_out), kind = kindOf(e)
    bal += delta
    totals[kind] += delta
    // المبيعات تزيد الرصيد (موجبة)، والتحصيل والتسوية تخفضانه (موجبة في عموديهما؛ والتسوية العكسية سالبة)
    return { id: e.id, date: e.date, journal: e.journal_number || '', kind, kindLabel: KIND_LABEL[kind], type: e.type || '', description: e.description || '',
      branch: e.branch || null, sale: kind === 'sale' ? money(delta) : null, collection: kind === 'collection' ? money(-delta) : null,
      settlement: kind === 'settlement' ? money(-delta) : null, balance: money(bal) }
  })
  return { app, from, to, opening: money(opening), rows, closing: money(bal),
    totals: { sales: money(totals.sale), collections: money(0 - totals.collection), settlements: money(0 - totals.settlement) },
    previousCount: before.length, firstRecorded: all[0]?.date || null }
}

/**
 * المقارنة مع كشف التطبيق الخارجي: آخر رصيد ساري مُدخل من كشف التطبيق حتى نهاية الفترة، مقابل الرصيد الدفتري حتى تاريخه نفسه.
 * لا يُوصف الحساب «مطابقًا»: يُذكر الفرق في تاريخ الكشف ومصدره، وأن الحركات بعد ذلك التاريخ لم تُقارن.
 */
export function statementComparison(entries, checkpoints, app, to) {
  const list = (checkpoints || []).filter(c => c.app === app && !c.voided_at && (!to || String(c.statement_date) <= to))
    .sort((a, b) => String(b.statement_date).localeCompare(String(a.statement_date)) || String(b.created_at).localeCompare(String(a.created_at)))
  const cp = list[0]
  if (!cp) return null
  const book = receivableBalances(entries, cp.statement_date).balances[app] || 0
  const diff = money(cents(cp.statement_balance) - cents(book))
  return { checkpoint: cp, date: cp.statement_date, statementBalance: Number(cp.statement_balance), bookBalance: book, difference: diff,
    noDifference: diff === 0, coversPeriodEnd: !to || String(cp.statement_date) === to, source: cp.reference, enteredBy: cp.created_by_name }
}

/** وصف نتيجة المقارنة بجملة، بلا كلمة «مطابق» مطلقة. */
export function comparisonText(cmp) {
  if (!cmp) return null
  const head = cmp.noDifference ? `لا فرق في ${cmp.date} بين الرصيد الدفتري ورصيد كشف التطبيق` : `فرق ${cmp.difference.toFixed(2)} في ${cmp.date} (رصيد كشف التطبيق − الرصيد الدفتري)`
  return `${head}، حسب «${cmp.source}» الذي أدخله ${cmp.enteredBy}.${cmp.coversPeriodEnd ? '' : ' الحركات بعد هذا التاريخ لم تُقارن بكشف التطبيق.'}`
}

/** شرح الرصيد الدفتري بجملة، بلا تقدير ولا اقتراح قيد. */
export function balanceNote(balance) {
  if (balance < 0) return 'التحصيلات والتسويات المسجلة أكبر من المبيعات المسجلة لهذا التطبيق. قد يخص التحصيل مبيعات قبل بدء التسجيل في تحسيب أو مبيعات لم تُسجَّل؛ يُحدَّد ذلك من كشف التطبيق. لا يُنشأ قيد أو رصيد افتتاحي تقديري لتغطيته.'
  if (balance > 0) return 'مبيعات مسجلة لم يُسجَّل تحصيلها بعد.'
  return 'لا رصيد دفتري.'
}

/** رصيد ما قبل بدء التسجيل في تحسيب: غير معروف دائمًا من الدفتر. */
export function preSystemNote(firstRecorded) {
  return firstRecorded
    ? `أول قيد مسجل لهذا التطبيق في تحسيب بتاريخ ${firstRecorded}. أي رصيد للتطبيق قبل ذلك غير مسجل وغير معروف من الدفتر، ولا يُفترض صفرًا؛ يُعرف من كشف التطبيق.`
    : 'لا قيود مسجلة لهذا التطبيق في تحسيب.'
}

/** رصيد كشف التطبيق كما كُتب في الحقل: رقم بمنزلتين عشريتين كحد أقصى، والصفر الصريح والسالب مقبولان؛ الفارغ والمسافات وغير الرقمي null. */
export function parseStatementBalance(raw) {
  const t = toLatinNumber(raw)   // يحذف المسافات وفواصل الآلاف ويحوّل الأرقام العربية والهندية
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) && Math.abs(n) < 1e12 ? (n === 0 ? 0 : n) : null
}
