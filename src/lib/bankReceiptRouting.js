import { INTERNAL_TRANSFER_TYPE, isInternalTransfer, normalizeInternalTransfer } from './internalTransfer.js'
import { bankAccountLabel } from './branchSetup.js'

// Match complete, explicitly registered identifiers; never fuzzy-match account tails.
export function normalizeBankIdentifier(value) {
  if (typeof value !== 'string') return ''
  const id = value.replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776)).replace(/[\s\-]/g, '').toUpperCase()
  return /^(?:\d{10,34}|SA\d{22})$/.test(id) ? id : ''
}
const endpoint = value => value && typeof value.label === 'string' && value.label.trim()
  ? normalizeBankIdentifier(value.number) : ''
const mapping = (settings, accounts) => (accounts || []).filter(a => a.is_active !== false).map(account => ({ account,
  ids: (settings?.bank_workflow?.accounts?.[account.id]?.receipt_identifiers || []).map(normalizeBankIdentifier).filter(Boolean) }))
const unique = matches => matches.length === 1 ? matches[0].account : null
export function receiptAccountMatch(receipt, settings, accounts) {
  if (receipt?.kind !== 'bank_receipt') return null
  const rows = mapping(settings, accounts), source = endpoint(receipt.fromAccount), destination = endpoint(receipt.toAccount)
  let from = source ? unique(rows.filter(r => r.ids.includes(source))) : null
  const to = destination ? unique(rows.filter(r => r.ids.includes(destination))) : null
  let sourceEvidence = from ? 'account' : null
  // Some Al Rajhi receipts print the full debit-account identifier at the START of
  // the reference, followed by YYYYMMDD and an operation sequence. Only a registered
  // full alias + valid receipt date can match. No arbitrary substring extraction.
  const ref = typeof receipt.reference === 'string' ? receipt.reference.replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632)).replace(/\s/g, '') : ''
  if (!source && /الراجحي|al\s*rajhi/i.test(receipt.bankName || '') && /^\d{28,39}$/.test(ref) && /^\d{4}-\d{2}-\d{2}$/.test(receipt.date || '')) {
    const date = receipt.date.replaceAll('-', '')
    const matches = rows.filter(r => r.ids.some(id => /^\d{15,21}$/.test(id) && ref.startsWith(id + date) && /^\d{5,10}$/.test(ref.slice(id.length + 8))))
    from = unique(matches); if (from) sourceEvidence = 'reference'
  }
  return { from, to, sourceEvidence, source, destination }
}

export function suggestReceiptPayment(inv, settings, accounts) {
  const match = receiptAccountMatch(inv?.bankReceipt, settings, accounts)
  if (!match || inv.type === 'sales' || inv.paymentMode === 'link' || ['credit', 'payable'].includes(inv.paySource)) return null
  const { from, to } = match
  const note = from ? `حساب الخروج من ${match.sourceEvidence === 'reference' ? 'الرقم المرجعي البنكي' : 'رقم الحساب في الإيصال'}: ${bankAccountLabel(from)}.`
    : 'إيصال بنكي: حساب الخروج غير محدد من الأرقام المقروءة. اختر الحساب بعد مراجعة الصورة.'
  const base = { ...inv, paySource: 'bank', bankAccountId: from?.id || '', _paymentInitialized: true,
    bankReceiptMatch: { from: from?.id || null, to: to?.id || null, sourceEvidence: match.sourceEvidence }, _paymentSuggested: note }
  if (from && to && from.id !== to.id) {
    const result = normalizeInternalTransfer({ ...base, type: 'transfer', transType: INTERNAL_TRANSFER_TYPE,
      amount: inv.amount ?? inv.totalAmount, internalTransfer: { from: `bank:${from.id}`, to: `bank:${to.id}` } })
    return { ...result, _paymentSuggested: `${note} حساب الدخول: ${bankAccountLabel(to)}. تحويل بين حسابين للمنشأة؛ راجعه قبل الاعتماد.` }
  }
  // A bank's "internal transfer" means within the bank, not necessarily this business.
  // An unrecognized recipient never creates an automatic company transfer.
  if (isInternalTransfer(inv)) {
    if (from && match.destination && !to) {
      const result = { ...base, type: 'expense', transType: '🛒 مصروفات تشغيلية', totalAmount: inv.totalAmount ?? inv.amount,
        vatAmount: 0, amountsBasis: 'inclusive', items: [{ description: inv.description || 'حوالة بنكية — حدد الغرض',
          amount: inv.amount ?? inv.totalAmount, category_main: '', category_sub: '' }],
        _paymentSuggested: `${note} المستفيد غير مطابق لحساب مسجل للمنشأة؛ حدد غرض الحوالة وتصنيفها.` }
      delete result.internalTransfer; delete result.bankTransfer
      return result
    }
    return { ...normalizeInternalTransfer({ ...base, internalTransfer: { from: from ? `bank:${from.id}` : '', to: to && to.id !== from?.id ? `bank:${to.id}` : '' } }),
      _paymentSuggested: `${note} لم يُثبت طرفا التحويل؛ راجع نوع العملية وحسابيها.` }
  }
  return base
}

export const BANK_RECEIPT_PROMPT = `إيصالات البنوك: استخرج bankReceipt فقط عندما يكون المرفق إيصال عملية بنكية، وليس فاتورة مشتريات مكتوب فيها مدى أو بنك المورد. لا تحدد الحساب من اسم الرافع.
"bankReceipt":{"kind":"bank_receipt","bankName":"اسم البنك كما طبع","date":"YYYY-MM-DD","fromAccount":{"label":"عنوان حقل حساب المرسل كما طبع","number":"رقم الحساب أو الآيبان حرفيا"},"toAccount":{"label":"عنوان حقل حساب المستفيد كما طبع","number":"رقم الحساب أو الآيبان حرفيا"},"reference":"الرقم المرجعي كاملا كما طبع"}
الحقل غير الظاهر null؛ احتفظ بعلامات إخفاء الأرقام كما هي ولا تكملها. لا تضع الرقم المرجعي في خانة الحساب ولا تستنتج ملكية المستفيد من اسمه. كلمة تحويل داخلي في إيصال البنك تعني داخل البنك ولا تثبت أنه بين حسابين للمنشأة. البرنامج يطابق الأرقام الكاملة مع حسابات المنشأة ويحدد طرفي التحويل. دفع لطرف خارجي expense أو supplier_payment حسب الغرض المطبوع، لا transfer داخلي. اقتراح الرافع بديل عند غياب دليل الحساب فقط.`
