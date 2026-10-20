// إيصالات سداد الموردين في «المستندات» (2026-10-20، الهجرة 20261020120000). دوال خالصة: العرض والفحص قبل الإرسال وبناء الحمولة.
// الخادم (approval_private.plan_supplier_payment) يعيد كل فحص هنا ويرفض ما يخالفه؛ لا مبلغ أو رصيد نهائي يُحسب هنا.
//   • المورد يختاره المراجع من موردي المنشأة (القائمة أو «آجل — باسم المورد»)؛ القراءة تقترح فقط، ولا يُنشأ مورد من اسم المستفيد.
//   • new: دفعة جديدة من الصندوق أو البنك. link: ربط بدفعة مسجلة سابقًا بالمبلغ نفسه، بلا أثر مالي.
import { normalizeSupplierName, similarityRatio } from './supplierMatching.js'
import { toHalalas, reviewChanges, money } from './approvalV2.js'

export const RECEIPT_TYPE = 'supplier_payment'
export const isReceipt = inv => inv?.type === RECEIPT_TYPE
export const DUPLICATE_WINDOW_DAYS = 7   // مطابق لنافذة اشتباه التكرار في الخادم

/** موردو المنشأة في قائمة واحدة: من القائمة (list) ومن «آجل — باسم المورد» (payable)، بمفتاح ثابت kind:id. */
export function supplierOptions(suppliers = [], payables = []) {
  return [
    ...suppliers.filter(s => s.is_active !== false).map(s => ({ kind: 'list', id: s.id, name: s.name, key: `list:${s.id}` })),
    ...payables.map(p => ({ kind: 'payable', id: p.id, name: p.name, key: `payable:${p.id}` })),
  ]
}
export const optionKey = inv => (inv?.supplierKind && inv?.supplierId ? `${inv.supplierKind}:${inv.supplierId}` : '')

/**
 * اقتراح المورد من اسم المستفيد المقروء. exact: اسم واحد مطابق بعد التطبيع؛ ambiguous: أكثر من مرشح (مطابقان أو متشابهان)؛
 * fuzzy: مرشح واحد متشابه؛ none. الاقتراح لا يُختار تلقائيًا: المراجع يؤكده.
 */
export function suggestSupplier(beneficiary, options, { threshold = 0.75 } = {}) {
  const norm = normalizeSupplierName(beneficiary)
  if (!norm) return { status: 'none', candidates: [] }
  const exact = options.filter(o => normalizeSupplierName(o.name) === norm)
  if (exact.length === 1) return { status: 'exact', candidates: exact }
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact }
  const near = options.map(o => {
    const n = normalizeSupplierName(o.name)
    if (!n) return null
    const ratio = similarityRatio(norm, n)
    return n.includes(norm) || norm.includes(n) || ratio >= threshold ? { ...o, score: Math.max(ratio, threshold) } : null
  }).filter(Boolean).sort((a, b) => b.score - a.score)
  if (!near.length) return { status: 'none', candidates: [] }
  return { status: near.length === 1 ? 'fuzzy' : 'ambiguous', candidates: near.slice(0, 5).map(({ score, ...o }) => o) }
}

/** تحويل فاتورة مقروءة (مصروف أو تحويل) إلى إيصال سداد عند تصحيح النوع. القراءة الأصلية تبقى في الخادم كما هي. */
export function toReceipt(inv) {
  const amount = inv?.amount ?? inv?.totalAmount ?? ''
  return {
    _id: inv?._id, type: RECEIPT_TYPE, date: inv?.date || '', amount, description: inv?.description || '',
    beneficiary: inv?.beneficiary ?? inv?.supplier_name ?? inv?.description ?? '', reference: inv?.reference ?? inv?.invoiceNumber ?? '',
    paySource: ['cash', 'bank'].includes(inv?.paySource) ? inv.paySource : '', bankAccountId: inv?.bankAccountId || '',
    paymentMode: 'new', supplierKind: inv?.supplierKind || null, supplierId: inv?.supplierId || null,
    ...(inv?.suggestedSupplier ? { suggestedSupplier: inv.suggestedSupplier } : {}),
    ...(inv?.paymentEvidence ? { paymentEvidence: inv.paymentEvidence } : {}),
  }
}

/** الرجوع من إيصال إلى مصروف (تصحيح معاكس): مصروف ببند واحد بالمبلغ، والتصنيف يختاره المراجع. */
export function fromReceipt(inv, type = 'expense') {
  const total = inv?.amount ?? ''
  return { _id: inv?._id, type, date: inv?.date || '', description: inv?.description || inv?.beneficiary || '', totalAmount: total, amount: total,
    vatAmount: 0, amountsBasis: 'inclusive', paySource: inv?.paySource || '', bankAccountId: inv?.bankAccountId || '', invoiceNumber: inv?.reference || '',
    items: type === 'expense' ? [{ description: inv?.description || inv?.beneficiary || '', amount: total, category_main: '', category_sub: '' }] : [] }
}

const days = (a, b) => Math.round(Math.abs(new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000)

/** مستندات الدفعة المعتمدة (قد تكون أكثر من مستند: إشعار التحويل وسند قبض المورد). */
export const paymentDocuments = p => (Array.isArray(p?.documents) && p.documents.length ? p.documents : p?.document_id ? [{ document_id: p.document_id, file_name: p.file_name }] : [])

/**
 * الدفعات المسجلة للمورد مرتبة للربط: بلا مستند أولًا، ثم المبلغ نفسه، ثم الأقرب تاريخًا.
 * likely: المبلغ نفسه وخلال نافذة التكرار — اقتراح لا يثبت أنها هي. الدفعة التي لها مستند تُربط بمستند آخر بعد تأكيد المراجع.
 */
export function rankPayments(payments = [], inv) {
  const amt = toHalalas(inv?.amount)
  return payments.map(p => {
    const same = amt != null && !Number.isNaN(amt) && toHalalas(p.amount) === amt
    const d = inv?.date && p.date ? days(inv.date, p.date) : null
    const linked = paymentDocuments(p).length > 0
    return { ...p, sameAmount: same, days: d, linked, likely: same && d != null && d <= DUPLICATE_WINDOW_DAYS && !linked }
  }).sort((a, b) => (a.linked - b.linked) || (b.sameAmount - a.sameAmount) || ((a.days ?? 1e9) - (b.days ?? 1e9)))
}

/** دفعات قائمة قد تكون هي نفسها (للتنبيه قبل تسجيل دفعة جديدة): المبلغ نفسه خلال 7 أيام، مربوطة أو لا. */
export function possibleDuplicates(payments = [], inv) {
  return rankPayments(payments, inv).filter(p => p.sameAmount && p.days != null && p.days <= DUPLICATE_WINDOW_DAYS)
}

/** سبب منع اعتماد الإيصال قبل إرساله، أو null. ctx: { payments } من supplier_payment_context إن حُمّل. */
export function receiptBlockReason(inv, ctx = null) {
  if (!isReceipt(inv)) return null
  if (!inv.supplierKind || !inv.supplierId) return 'اختر المورد من موردي المنشأة لهذا الإيصال.'
  const amt = toHalalas(inv.amount)
  if (amt == null || Number.isNaN(amt) || amt <= 0) return 'أدخل مبلغ السداد كما في الإيصال.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inv.date || '')) return 'أدخل تاريخ السداد.'
  if (inv.paymentMode === 'link') {
    if (!inv.linkJournal) return 'اختر الدفعة المسجلة التي يخصها هذا الإيصال.'
    const p = ctx?.payments?.find(x => x.journal_number === inv.linkJournal)
    if (p && toHalalas(p.amount) !== amt) return `مبلغ الإيصال (${money(amt / 100)}) لا يساوي مبلغ الدفعة ${p.journal_number} (${money(p.amount)}). صحّح المبلغ أو اختر دفعة أخرى.`
    // مستند آخر للدفعة نفسها مشروع (إشعار تحويل وسند قبض)؛ يُعرض المرفق، والمراجع يؤكد بسبب مكتوب
    if (p && paymentDocuments(p).length && !String(inv.linkReason || '').trim()) {
      return `الدفعة ${p.journal_number} مرفق بها مستند («${paymentDocuments(p).map(x => x.file_name).join('»، «')}»). إن كان هذا مستندًا آخر للدفعة نفسها فاكتب ذلك سببًا.`
    }
    return null
  }
  if (!['cash', 'bank'].includes(inv.paySource)) return 'اختر مصدر الدفع: الصندوق أو البنك.'
  if (ctx?.payments && !String(inv.newPaymentReason || '').trim() && possibleDuplicates(ctx.payments, inv).length) {
    return 'للمورد دفعة مسجلة بالمبلغ نفسه قريبة التاريخ: اربط الإيصال بها إن كانت هي، أو اكتب سبب أنها دفعة أخرى.'
  }
  return null
}

const RECEIPT_FIELDS = ['_id', 'type', 'date', 'amount', 'description', 'beneficiary', 'reference', 'supplierKind', 'supplierId', 'paymentMode',
  'suggestedSupplier', 'paymentEvidence', 'manualReview']

/** الإيصال كما يُرسل للخادم: حقول السداد وحدها، ومصدر الدفع لدفعة جديدة أو الدفعة المربوطة، وسجل التعديلات عن القراءة. */
export function buildReceiptPayload(inv, { original } = {}) {
  const out = {}
  for (const k of RECEIPT_FIELDS) if (inv[k] !== undefined && inv[k] !== null && inv[k] !== '') out[k] = inv[k]
  out.type = RECEIPT_TYPE
  out.paymentMode = inv.paymentMode === 'link' ? 'link' : 'new'
  if (out.paymentMode === 'link') {
    out.linkJournal = inv.linkJournal || null
    const reason = String(inv.linkReason || '').trim()
    if (reason) out.linkReason = reason
  } else {
    out.paySource = inv.paySource || null
    if (inv.paySource === 'bank' && inv.bankAccountId) out.bankAccountId = inv.bankAccountId
    const reason = String(inv.newPaymentReason || '').trim()
    if (reason) out.newPaymentReason = reason
  }
  out.review_changes = reviewChanges(original, out)
  return out
}

/** بعد قراءة المستند: المورد المقترح لكل إيصال (exact وحده) يُحفظ اقتراحًا؛ لا يُملأ supplierId. */
export function withSuggestedSuppliers(result, options) {
  const one = inv => {
    if (!isReceipt(inv) || inv.suggestedSupplier) return inv
    const s = suggestSupplier(inv.beneficiary, options)
    return s.status === 'exact' ? { ...inv, suggestedSupplier: { kind: s.candidates[0].kind, id: s.candidates[0].id, name: s.candidates[0].name } } : inv
  }
  if (!result) return result
  if (Array.isArray(result.invoices)) return { ...result, invoices: result.invoices.map(one) }
  return one(result)
}

/** الرصيد قبل السداد وبعده للعرض (هللات ← ريال). link لا يغيّر الرصيد. */
export function balanceAfter(balance, inv) {
  if (balance == null) return null
  const b = toHalalas(balance), amt = toHalalas(inv?.amount)
  if (inv?.paymentMode === 'link' || amt == null || Number.isNaN(amt)) return b / 100
  return (b - amt) / 100
}

/** سجل الإيصال (history من الخادم) بجملة: الدفعة المرتبطة حُذفت فعاد الإيصال للمراجعة. */
export function receiptHistoryNote(history) {
  const last = Array.isArray(history) ? [...history].reverse().find(h => h?.event === 'payment_deleted') : null
  if (!last) return null
  const at = last.at ? String(last.at).slice(0, 10) : ''
  return `اعتُمد هذا الإيصال سابقًا بالقيد ${last.journal_number || '—'}، ثم حُذفت الدفعة${last.by_name ? ` بواسطة ${last.by_name}` : ''}${at ? ` في ${at}` : ''}، فعاد بانتظار الاعتماد. اعتمده من جديد إن كان صحيحًا، أو استبعده.`
}

/**
 * بعد القراءة الآلية: «سداد مورد» لا يُقترح إلا بدليل مطبوع (paymentEvidence)؛ بدونه يعود مصروفًا كما كانت الحوالة الصادرة تُقرأ.
 * الإيصال بلا بنود ولا ضريبة، ومبلغه amount.
 */
export function normalizeReceiptReading(inv) {
  if (!isReceipt(inv)) return inv
  if (!String(inv.paymentEvidence || '').trim()) return { ...fromReceipt(inv, 'expense'), _id: inv._id, paySource: inv.paySource || '' }
  const { items, vatAmount, totalAmount, transType, category_main, category_sub, ...rest } = inv
  return { ...rest, amount: inv.amount ?? totalAmount ?? '', paymentMode: 'new' }
}
