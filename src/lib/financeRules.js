// قواعد تصنيف القيود ومبالغها — وحدة خالصة بلا اتصال بالقاعدة (تُختبر في Node). نُقلت من financialEngine.js كما هي،
// وتُعاد تصديرها من هناك. isTaxType هو الشرط نفسه الذي يستبعد به المحرك أنواع «ضريبة» من المصروفات.
import { COGS_TYPES, isCOGS, isCOGSEntry } from './financeClass.js'
export { COGS_TYPES, isCOGS, isCOGSEntry }

// نسبة ضريبة القيمة المضافة بالسعودية
export const VAT_RATE = 0.15

const SALES_KEYWORD = 'مبيعات'
const SALES_EXTRA_TYPES = ['تحصيل جملة']  // النوع الوحيد المصنَّف مبيعات بلا كلمة "مبيعات" بنصه

const EXCLUDED_TYPES = [
  'تحويل داخلي',
  'صرف عهدة',
  'إيداع نقدي',
  'تحويل داخلي — صرف عهدة',
  'تحويل داخلي — إيداع نقدي',
  'تحصيل ذمم',
]

export const WITHDRAWALS_TYPES = [
  'مسحوبات سليمان', 'مسحوبات فايز', 'مسحوبات أم طوبى',
  'مسحوبات الشركاء', '💼 مسحوبات الشركاء', 'مسحوبات',
]

export const DEBT_TYPES = [
  'قسط سيارة', '💳 قسط سيارة',
  'قسط شراء أرض',
  'قرض ١', 'قرض ٢', 'قرض 1', 'قرض 2',
  'قرض نقاط البيع', '💳 قرض نقاط البيع',
  'قسط',
]

export function isSales(type) {
  const t = type || ''
  return t.includes(SALES_KEYWORD) || SALES_EXTRA_TYPES.some(s => t.includes(s))
}

export function isExcluded(type) {
  return EXCLUDED_TYPES.some(t => (type || '').includes(t))
}


export function isWithdrawal(type) {
  return WITHDRAWALS_TYPES.some(t => (type || '').includes(t))
}

export function isDebt(type) {
  return DEBT_TYPES.some(t => (type || '').includes(t))
}

/** نوع قيد ضريبي (يحمل كلمة «ضريبة»): لا يدخل المصروفات في المحرك ولا في تفصيل التقارير. */
export function isTaxType(type) {
  return (type || '').includes('ضريبة')
}

export function isRealExpense(entry) {
  const type = entry.type || ''
  if (isWithdrawal(type)) return false
  if (isDebt(type))       return false
  if (isTaxType(type)) return false
  return true
}

// للتوافق مع الكود القديم
export const isInternal = isExcluded

// ── الحالات المحتسبة: قاعدة واحدة للوحة التحكم والتقارير والتصدير والتحليل ──────────────────────────
// المحتسب: «معتمد» و«تلقائي» فقط. «معلق» و«مرفوض» وبلا حالة (NULL) و«ملغى» القديمة لا تدخل المبيعات ولا المصروفات ولا الضريبة،
// وتُعرض منفصلة بعددها ومبلغها حيث تُعرض المؤشرات. (الأرصدة النقدية في لوحة التحكم والتقارير لها استعلامها ولم تتغير.)
export const COUNTED_STATUSES = ['approved', 'auto']
export const isCounted = e => COUNTED_STATUSES.includes(e?.status)
export const UNCOUNTED_LABEL = { pending: 'معلّق', rejected: 'مرفوض', null: 'بلا حالة', cancelled: 'ملغى' }

/** ملخص القيود غير المحتسبة: العدد والإجمالي لكل حالة. */
export function uncountedSummary(entries) {
  const byStatus = {}
  let n = 0
  for (const e of entries || []) {
    if (isCounted(e)) continue
    const k = e?.status ?? 'null'
    byStatus[k] = byStatus[k] || { n: 0, h: 0 }
    byStatus[k].n++; byStatus[k].h += Math.round((Number(e.total_amount) || 0) * 100); n++
  }
  return { n, byStatus }
}

/** نص عربي لملخص غير المحتسب (للوحة التحكم والتقارير والتصدير)؛ null إن لم يوجد. */
export function uncountedText(u) {
  if (!u?.n) return null
  const parts = Object.entries(u.byStatus).map(([k, v]) => `${v.n} ${UNCOUNTED_LABEL[k] || k} بمبلغ ${(v.h / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  return `قيود غير محتسبة في الأرقام لأنها غير معتمدة: ${parts.join('، ')}. تُراجَع في سجل الدفتر.`
}

export function sumField(entries, field) {
  return entries.reduce((s, e) => s + (Number(e[field]) || 0), 0)
}

// ── مبالغ القيد الواحد بنفس المعالجة الضريبية المطبَّقة بالإجماليات ──────────
// أي شاشة تجمع من القيود الخام مباشرة (رسوم، تفصيل تصنيفات، أداء فروع) يجب أن
// تمرّ من هنا، وإلا ظهرت أرقام إجمالية بجانب بطاقات صافية — تناقض مربك للمستخدم.

export function salesAmountGross(e) {
  return (Number(e.cash_in) || 0) + (Number(e.bank_in) || 0) + (Number(e.receivable_in) || 0)
}

export function salesAmountNet(e) {
  return salesAmountGross(e) / (1 + VAT_RATE)
}

// مبلغ القيد في المصروفات — بالهللات ثم يعاد بالريال (لا كسور عائمة).
// • الشراء الآجل: الفاتورة تثبت الالتزام `payable_in` بإجماليها وضريبتها في vat_amount ← تكلفة بصافيها بتاريخ الفاتورة مرة واحدة.
// • السداد: خروج نقدي يخفض الالتزام `payable_out` بالمبلغ نفسه ← ليس تكلفة. ما زاد من الخروج على ما يخفضه من الالتزام تكلفة: سداد
//   فواتير تاريخية لم تدخل الدفتر (نقدي الأساس كما كان)، وهو وحده يُحتسب (انظر supplier_payment_record في 20261010130000).
// • مرتجع الشراء: نقدًا (دخول) أو بتخفيض الالتزام بلا خروج ← ينقص التكلفة بصافيه.
// • قيد فيه خروج ودخول معًا: الخروج − الضريبة كما كان (الدخول لا يُخمَّن معناه). قيد بلا مبلغ: صفر.
const h = v => Math.round((Number(v) || 0) * 100)
const outOf = e => h(e.cash_out) + h(e.bank_out) + h(e.custody_out) + h(e.receivable_out)
const inOf = e => h(e.cash_in) + h(e.bank_in) + h(e.custody_in)

export function expenseAmountGross(e) {
  return (outOf(e) + h(e.payable_in) - h(e.payable_out)) / 100
}

export function expenseAmountNet(e) {
  const vat = h(e.vat_amount)
  const gross = outOf(e) + h(e.payable_in) - h(e.payable_out)
  if (gross > 0) return (gross - vat) / 100
  if (gross < 0) return (gross + vat) / 100   // مرتجع بتخفيض الالتزام
  const back = inOf(e)
  if (back > 0) return -(back - vat) / 100
  return 0
}

/**
 * ضريبة المدخلات للقيد بإشارة تكلفته نفسها (expenseAmountNet): شراء ← موجبة، مرتجع (تخفيض التزام أو دخول) ← سالبة تعكس ضريبة الشراء.
 * قيد عليه ضريبة بلا أي مبلغ: null (ملتبس؛ لا تُخمَّن ضريبته ويُعرض للمراجعة). بلا ضريبة: 0.
 */
export function inputVatOf(e) {
  const vat = h(e.vat_amount)
  if (!vat) return 0
  const gross = outOf(e) + h(e.payable_in) - h(e.payable_out)
  if (gross > 0) return vat / 100
  if (gross < 0) return -vat / 100
  if (inOf(e) > 0) return -vat / 100
  return null
}

/** المبلغ الإجمالي للقيد بالإشارة نفسها (للعرض بجانب ضريبته): الخروج والآجل موجبًا، والمرتجع سالبًا. */
export function signedGrossOf(e) {
  const gross = outOf(e) + h(e.payable_in) - h(e.payable_out)
  return (gross !== 0 ? gross : -inOf(e)) / 100
}

