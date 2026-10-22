// Company-specific suggestions. They never approve a document or move money.
import { eligibleBankAccounts, expensesAtProjectLevel, bankAccountLabel } from './branchSetup.js'
import { isLoanRepayment } from './loanRepayment.js'

export const BANK_TRANSFER_TYPE = '🔄 تحويل داخلي — بين الحسابات البنكية'
export const UPLOADER_ROLES = { owner: 'المالك', purchasing: 'مسؤول المشتريات', cashier: 'الكاشير' }
export const paymentWorkflow = settings => settings?.bank_workflow?.version === 1 ? settings.bank_workflow : null
export const isBankTransfer = inv => inv?.type === 'transfer' && inv.transType === BANK_TRANSFER_TYPE
export const isAppCollection = inv => inv?.type === 'transfer' && /تحصيل ذمم/.test(inv.transType || '') && /هنقر|جاهز|مرسول|كيتا|نينجا/.test(inv.transType || '')
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k)
const PAYMENT_FIELDS = ['paySource', 'bankAccountId', 'bankAccounts', 'bankTransfer']

export function paymentBranch(doc, inv, settings) {
  return (inv?.type === 'expense' && expensesAtProjectLevel(settings)) || inv?.type === 'supplier_payment' || isBankTransfer(inv) || (paymentWorkflow(settings) && isAppCollection(inv))
    ? null : (inv?.branch || doc?.branch || null)
}

export function paymentChoice(inv) {
  return { type: inv.type, paymentMode: inv.paymentMode || null, transType: inv.transType || null,
    ...Object.fromEntries(PAYMENT_FIELDS.map(k => [k, inv[k] ?? (['bankAccounts', 'bankTransfer'].includes(k) ? {} : '')])) }
}

export function documentPaymentChoices(result, pendingIds = null) {
  const rows = result?.invoices || (result ? [result] : [])
  return Object.fromEntries(rows.filter(x => x?._id && (!pendingIds || pendingIds.has(x._id))).map(x => [x._id, paymentChoice(x)]))
}

/** Saved reviewer choices (including explicitly cleared fields) take priority over all defaults. */
export function suggestInvoicePayment(inv, doc, settings, accounts, saved = null) {
  if (!inv) return inv
  if (saved && saved.type === inv.type && (saved.paymentMode || null) === (inv.paymentMode || null) && (inv.type !== 'transfer' || saved.transType === inv.transType)) {
    return { ...inv, ...Object.fromEntries(PAYMENT_FIELDS.filter(k => own(saved, k)).map(k => [k, saved[k]])), _paymentSuggested: false }
  }
  const policy = paymentWorkflow(settings)
  if (!policy || inv._paymentInitialized) return inv
  if (inv.type === 'sales' && !inv.branch && !doc?.branch) return inv
  const next = { ...inv, _paymentInitialized: true }
  const available = eligibleBankAccounts(accounts, paymentBranch(doc, inv, settings))
  const valid = id => !!id && available.some(a => a.id === id)
  const role = doc?.created_by_role || doc?.uploaded_by
  const rule = policy.uploaders?.[role]

  if (inv.type === 'sales') {
    // Explicit channel accounts and historical/corrected report accounts always win.
    for (const [channel, field, rules] of [['network', 'networkSales', policy.network_by_branch], ['transfer', 'transferSales', policy.transfer_by_branch]]) {
      const id = rules?.[inv.branch || doc?.branch || '']
      if (!inv.bankAccounts?.[channel] && !inv.bankAccountId && valid(id) && Number(inv[field]) > 0) {
        next.bankAccounts = { ...next.bankAccounts, [channel]: id }
        next._paymentSuggested = 'حساب كل قناة مقترح للفرع؛ راجع الشبكة والتحويل قبل الاعتماد.'
      }
    }
  } else if (inv.type === 'transfer' && !isLoanRepayment(inv)) {
    // An app collection is a receivable settlement, not a new sale.
    if (isAppCollection(inv)) next.paySource = 'bank'
    if (isAppCollection(inv) && !inv.bankAccountId && valid(policy.apps_collection_account)) {
      next.bankAccountId = policy.apps_collection_account
      next._paymentSuggested = 'حساب تحصيل حوالات التطبيقات المقترح؛ راجع الحساب قبل الاعتماد.'
    }
    // Bank transfers always require both accounts explicitly; uploader rules do not apply.
  } else if ((inv.type === 'expense' && !['credit', 'payable'].includes(inv.paySource))
      || (inv.type === 'supplier_payment' && inv.paymentMode !== 'link') || isLoanRepayment(inv)) {
    if (rule?.source === 'cash') {
      next.paySource = 'cash'; next.bankAccountId = ''
      next._paymentSuggested = `المصدر المقترح لأن الرافع ${UPLOADER_ROLES[role] || role}: الصندوق. أكّده أو عدّله.`
    } else if (rule?.source === 'bank' && valid(rule.account_id)) {
      next.paySource = 'bank'; next.bankAccountId = rule.account_id
      next._paymentSuggested = `المصدر المقترح لأن الرافع ${UPLOADER_ROLES[role] || role}: ${bankAccountLabel(available.find(a => a.id === rule.account_id))}. أكّده أو عدّله.`
    }
  }
  return next
}

export function suggestDocumentPayments(result, doc, settings, accounts, saved = {}, pendingIds = null) {
  if (!result) return result
  const map = inv => pendingIds && !pendingIds.has(inv?._id) ? inv : suggestInvoicePayment(inv, doc, settings, accounts, saved?.[inv?._id])
  return Array.isArray(result.invoices) ? { ...result, invoices: result.invoices.map(map) } : map(result)
}

/** When a reviewer changes type/source/account, do not silently re-suggest on a later render. */
export function reviewedPayment(inv, patch) {
  const sourceChanged = own(patch, 'paySource') && patch.paySource !== inv?.paySource
  const changesPayment = Object.keys(patch).some(k => PAYMENT_FIELDS.includes(k) || ['type', 'paymentMode', 'transType'].includes(k))
  const next = { ...inv, ...patch, ...(changesPayment ? { _paymentInitialized: true } : {}) }
  if (patch.transType === BANK_TRANSFER_TYPE) { next.paySource = 'bank'; next.bankAccountId = '' }
  if (sourceChanged && patch.paySource !== 'bank') next.bankAccountId = ''
  if (changesPayment) next._paymentSuggested = false
  return next
}

export function bankOperationalNote(settings, id) {
  const rule = paymentWorkflow(settings)?.accounts?.[id]
  if (!rule) return ''
  return [rule.operating_available === false ? 'هذا الحساب غير متاح للصرف التشغيلي.' : '', rule.purpose || ''].filter(Boolean).join(' ')
}

/** Booked balances only. Restricted, inactive and unassigned funds are never advertised as spendable. */
export function operatingBankFigures(accounts, byAccount = {}, settings) {
  const policy = paymentWorkflow(settings)
  if (!policy) return null
  let available = 0, restricted = 0, overdrafts = 0
  const rows = (accounts || []).map(a => {
    const cents = Number(byAccount[a.id] || 0)
    const blocked = a.is_active === false || policy.accounts?.[a.id]?.operating_available === false
    if (blocked) restricted += cents
    else if (cents > 0) available += cents
    if (cents < 0) overdrafts += cents
    return { id: a.id, label: bankAccountLabel(a), value: cents / 100, blocked, purpose: policy.accounts?.[a.id]?.purpose || '' }
  })
  return { available: available / 100, restricted: restricted / 100, overdrafts: overdrafts / 100,
    unassigned: Number(byAccount[''] || 0) / 100, rows }
}

export function operatingBankRows(accounts, byAccount, settings) {
  const f = operatingBankFigures(accounts, byAccount, settings)
  if (!f) return []
  return [
    { label: 'أرصدة بنكية موجبة متاحة للتشغيل حسب الدفتر', value: f.available, strong: true },
    { label: 'صافي حسابات غير متاحة للتشغيل', value: f.restricted },
    { label: 'الأرصدة البنكية السالبة (ضمن الأرصدة أعلاه)', value: f.overdrafts },
    ...(f.unassigned ? [{ label: 'رصيد بلا حساب محدد — خارج المتاح للتشغيل', value: f.unassigned }] : []),
  ]
}

export const OPERATING_BALANCE_NOTE = 'المتاح للتشغيل هو مجموع الأرصدة الدفترية الموجبة للحسابات المتاحة فقط. يستبعد الحسابات المخصصة للالتزامات والموقوفة والحركات بلا حساب. لا يثبت الرصيد القابل للسحب في البنك؛ يُراجع مع كشف الحساب. لا تُنشأ تسديدات تلقائية من هذه الأرقام.'
