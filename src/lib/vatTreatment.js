// معالجة قيود الضريبة في التقارير — وحدة خالصة (تُختبر في Node).
//
// مسارات إنشاء قيد بنوع «🏛️ ضريبة القيمة المضافة» في التطبيق (مقروءة من الكود):
//   • الدفتر (Ledger.jsx): إدخال يدوي بأي نوع ومبالغ داخلة أو خارجة، بلا vat_amount.
//   • المطابقة البنكية (bankReconciliation.js): سطر كشف بنكي يُصنَّف بهذا النوع، vat_amount = 0.
//   • اعتماد مستند (السابق في PendingDocuments.jsx والجديد في الخادم): مستند صُنّف بهذا النوع (مثل إيصال سداد للهيئة،
//     أو فاتورة صُنّفت خطأً)، وقد يحمل vat_amount مقروءًا من المستند.
// لا مسار في التطبيق يسجّل ضريبة مدخلات فاتورة مشتريات قيدًا منفصلًا: ضريبة الفاتورة تُحفظ في vat_amount على قيد الفاتورة نفسه.
// لذلك:
//   • سداد مؤكد: نوع ضريبة القيمة المضافة، وخروج من الصندوق أو البنك أو العهدة فقط، بلا ضريبة مسجلة عليه وبلا بنود مستند.
//     لا يدخل المصروفات ولا ضريبة المدخلات، ويبقى أثره في الأرصدة. يُعرض «مدفوعات الضريبة خلال الفترة» منفصلًا ولا يُطرح من صافي الفترة.
//   • استرداد: النوع نفسه ودخول فقط بالشروط نفسها. يُعرض منفصلًا.
//   • غير ذلك (ضريبة مسجلة عليه، أو بنود مستند، أو دخول وخروج معًا، أو بلا حركة نقدية، أو نوع ضريبي آخر): يحتاج تأكيد المحاسب.
//     لا يُخمَّن تصنيفه ولا يُعدَّل القيد: لا يدخل المصروفات (كما في لوحة التحكم) ولا ضريبة المدخلات، ويُعرض بمبالغه وسببه.
import { isTaxType, isCounted, inputVatOf, signedGrossOf } from './financeRules.js'
import { itemsForEntry } from './expenseBreakdown.js'

export const VAT_TYPE = 'ضريبة القيمة المضافة'
export const isVatType = type => (type || '').includes(VAT_TYPE)

const n = v => Number(v) || 0
const outOf = e => n(e.cash_out) + n(e.bank_out) + n(e.custody_out)
const inOf = e => n(e.cash_in) + n(e.bank_in) + n(e.custody_in)
const SOURCES = [['cash', 'الصندوق'], ['bank', 'البنك'], ['custody', 'العهدة']]
const sourceOf = (e, dir) => SOURCES.filter(([k]) => n(e[`${k}_${dir}`]) > 0).map(([, l]) => l).join(' و') || '—'

export const REVIEW_REASONS = {
  other_tax: 'نوع ضريبي غير ضريبة القيمة المضافة: لا يدخل المصروفات (كما في لوحة التحكم) ولا ضريبة المدخلات. ما طبيعته؟',
  vat_recorded: 'عليه ضريبة مسجلة كأنه فاتورة: سداد للهيئة أم فاتورة مشتريات صُنّفت بنوع الضريبة خطأً؟',
  has_items: 'له بنود مستند مصنّفة كفاتورة: سداد للهيئة أم فاتورة مشتريات؟',
  both_directions: 'فيه دخول وخروج معًا: ما الذي يمثّله؟',
  no_cash: 'بلا حركة في الصندوق أو البنك أو العهدة (آجل أو ذمم): ما الذي يمثّله؟',
  vat_no_amount: 'عليه ضريبة مسجلة بلا أي مبلغ (لا خروج ولا آجل ولا دخول): لا تُحتسب في ضريبة المدخلات حتى يتأكد المحاسب.',
}

/** يصنّف قيدًا بنوع ضريبي. يعيد null لغير الضريبي. */
export function classifyTaxEntry(e, items = []) {
  if (!isTaxType(e?.type)) return null
  const out = outOf(e), inn = inOf(e), vat = n(e.vat_amount)
  if (!isVatType(e.type)) return { kind: 'review', reason: 'other_tax', out, in: inn, vat }
  if (vat > 0) return { kind: 'review', reason: 'vat_recorded', out, in: inn, vat }
  if (itemsForEntry(e, items).length) return { kind: 'review', reason: 'has_items', out, in: inn, vat }
  if (out > 0 && inn > 0) return { kind: 'review', reason: 'both_directions', out, in: inn, vat }
  if (out > 0) return { kind: 'payment', amount: out, source: sourceOf(e, 'out'), out, in: inn, vat }
  if (inn > 0) return { kind: 'refund', amount: inn, source: sourceOf(e, 'in'), out, in: inn, vat }
  return { kind: 'review', reason: 'no_cash', out, in: inn, vat }
}

/**
 * ضريبة الفترة من قيودها (المُستعلَمة بالفترة والفرع) وضريبة المخرجات من المحرك.
 * صافي ضريبة الفترة قبل السداد = المخرجات − المدخلات. المدفوعات والمستردات منفصلة ولا يُحسب منها «متبقٍ».
 */
export function vatFigures({ entries, docItems, outputVat = 0 }) {
  // غياب البنود دليل على «لا بنود» فقط إن كانت محمّلة كاملة؛ قائمة غير محمّلة لا تُعامل كقائمة فارغة
  if (!Array.isArray(docItems)) throw new Error('vat_items_unavailable')
  const rows = (entries || []).filter(isCounted)   // القيود المحتسبة وحدها (financeRules)
  const regular = rows.filter(e => !isTaxType(e.type))
  // ضريبة المدخلات بإشارة تكلفة القيد (financeRules.inputVatOf): المرتجع يعكس ضريبة الشراء، والملتبس للمراجعة لا يُخمَّن
  const payments = [], refunds = [], review = []
  const inputVatEntries = []
  for (const e of regular) {
    if (!n(e.vat_amount)) continue
    const v = inputVatOf(e)
    if (v === null) { review.push({ id: e.id, date: e.date, type: e.type, description: e.description, journal_number: e.journal_number, kind: 'review', reason: 'vat_no_amount',
      out: 0, in: 0, vat: n(e.vat_amount), reasonText: REVIEW_REASONS.vat_no_amount }); continue }
    inputVatEntries.push({ ...e, signedVat: v, signedGross: signedGrossOf(e) })
  }
  const inputVat = Math.round(inputVatEntries.reduce((s, e) => s + Math.round(e.signedVat * 100), 0)) / 100
  for (const e of rows) {
    const c = classifyTaxEntry(e, docItems)
    if (!c) continue
    const row = { id: e.id, date: e.date, type: e.type, description: e.description, journal_number: e.journal_number, ...c }
    if (c.kind === 'payment') payments.push(row)
    else if (c.kind === 'refund') refunds.push(row)
    else review.push({ ...row, reasonText: REVIEW_REASONS[c.reason] })
  }
  const sum = (list, k) => list.reduce((s, r) => s + n(r[k]), 0)
  return {
    outputVat, inputVat, inputVatEntries,
    netBeforePayment: outputVat - inputVat,
    payments, paymentsTotal: sum(payments, 'amount'),
    refunds, refundsTotal: sum(refunds, 'amount'),
    review,
  }
}
