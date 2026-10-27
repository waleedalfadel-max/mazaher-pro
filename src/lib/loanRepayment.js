import { isOwnerWithdrawal, WITHDRAWAL_OPTION } from './ownerWithdrawal.js'
import { isDebt } from './financeRules.js'
import { toLatinNumber } from './amountInput.js'

// A review-screen choice over the existing transfer approval path, not a new loan balance model.
export const LOAN_OPTION = { value: 'loan_repayment', label: 'سداد قرض / قسط' }
export const loanTypes = types => (types || []).filter(isDebt)
export const isLoanRepayment = inv => inv?.type === 'transfer' && (inv.transferPurpose === LOAN_OPTION.value || isDebt(inv.transType))
export const reviewDocumentType = inv => isOwnerWithdrawal(inv) ? WITHDRAWAL_OPTION.value : isLoanRepayment(inv) ? LOAN_OPTION.value : inv?.type || ''
export const loanAmount = inv => inv?.totalAmount ?? inv?.amount ?? ''
export const LOAN_NOTE = 'هذا المسار لسداد أصل القرض أو القسط الرأسمالي. راجع كشف الجهة الممولة وافصل أرباح التمويل والرسوم إن وجدت في فاتورة مصروف مستقلة؛ لا يُستنتج توزيعها من إجمالي الخصم.'
export const LOAN_CONFIRMATION_LABEL = 'راجعت كشف التمويل وأؤكد أن المبلغ المحدد أصل قرض فقط، دون أرباح تمويل أو رسوم.'

/** External readings and restored drafts are data, never evidence of a current reviewer click.
 * Use only at review-entry boundaries; keep the original reading intact for the audit trail.
 */
export function withoutLoanPrincipalConfirmation(reading) {
  if (!reading || typeof reading !== 'object') return reading
  const copy = { ...reading }
  delete copy.loanPrincipalConfirmation
  if (Array.isArray(copy.invoices)) copy.invoices = copy.invoices.map(withoutLoanPrincipalConfirmation)
  return copy
}

/** Clear expense/supplier metadata only in the working copy. The server retains the original OCR. */
export function toLoanRepayment(inv) {
  return {
    _id: inv?._id, type: 'transfer', transferPurpose: LOAN_OPTION.value,
    date: inv?.date || '', description: inv?.description || inv?.beneficiary || '',
    invoiceNumber: inv?.invoiceNumber || inv?.reference || '',
    transType: isLoanRepayment(inv) ? inv.transType || '' : '',
    amount: loanAmount(inv), totalAmount: loanAmount(inv), vatAmount: inv?.vatAmount ?? 0,
    paySource: ['cash', 'bank', 'custody'].includes(inv?.paySource) ? inv.paySource : '',
    bankAccountId: inv?.bankAccountId || '', items: [],
  }
}

export function fromLoanRepayment(inv, type) {
  const next = { ...inv, type, transType: '', items: type === 'expense'
    ? [{ description: inv.description || '', amount: loanAmount(inv), category_main: '', category_sub: '' }] : [] }
  delete next.transferPurpose
  delete next.loanPrincipalConfirmation
  return next
}

const validMoney = v => /^\d+(?:\.\d{1,2})?$/.test(toLatinNumber(v)) && Number.isFinite(Number(toLatinNumber(v)))
/** Explicit reviewer assertion, bound to the visible loan, amount and tax; never inferred from OCR. */
export function loanPrincipalConfirmation(inv, checked) {
  if (!checked || !isLoanRepayment(inv) || !isDebt(inv.transType) || !validMoney(loanAmount(inv))
    || Number(toLatinNumber(loanAmount(inv))) <= 0 || Number(toLatinNumber(inv.vatAmount ?? 0)) !== 0) return null
  return { version: 1, confirmed: true, transType: inv.transType,
    amount: Number(toLatinNumber(loanAmount(inv))).toFixed(2), vatAmount: '0.00' }
}

export function hasLoanPrincipalConfirmation(inv) {
  const expected = loanPrincipalConfirmation(inv, true), saved = inv?.loanPrincipalConfirmation
  return !!expected && !!saved && Object.keys(expected).every(k => saved[k] === expected[k])
}

/** Display/payload validation; the existing server validates permissions, source, account and amount. */
export function loanBlockReason(inv, types) {
  if (!isLoanRepayment(inv)) return null
  if (!loanTypes(types).includes(inv.transType)) return 'اختر القرض أو القسط من الأنواع المسجلة للمنشأة؛ لا يُختار تلقائيًا.'
  if (!['cash', 'bank', 'custody'].includes(inv.paySource)) return 'اختر مصدر سداد القرض: الصندوق أو البنك أو العهدة.'
  if (!validMoney(loanAmount(inv)) || Number(toLatinNumber(loanAmount(inv))) <= 0) return 'راجع مبلغ سداد أصل القرض؛ يجب أن يكون أكبر من صفر وبمنزلتين عشريتين كحد أقصى.'
  if (inv.vatAmount != null && inv.vatAmount !== '' && (!validMoney(inv.vatAmount) || Number(toLatinNumber(inv.vatAmount)) !== 0)) return 'القراءة تحمل ضريبة: افصل أي رسوم وضريبتها عن أصل القرض، ثم صحح هذا الحقل إلى صفر بعد مراجعة المستند.'
  if (!hasLoanPrincipalConfirmation(inv)) return 'أكّد بعد مراجعة كشف التمويل أن المبلغ المحدد أصل قرض فقط، دون أرباح تمويل أو رسوم.'
  return null
}
