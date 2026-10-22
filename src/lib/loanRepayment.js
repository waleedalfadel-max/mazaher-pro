import { isDebt } from './financeRules.js'
import { toLatinNumber } from './amountInput.js'

// A review-screen choice over the existing transfer approval path, not a new loan balance model.
export const LOAN_OPTION = { value: 'loan_repayment', label: 'سداد قرض / قسط' }
export const loanTypes = types => (types || []).filter(isDebt)
export const isLoanRepayment = inv => inv?.type === 'transfer' && (inv.transferPurpose === LOAN_OPTION.value || isDebt(inv.transType))
export const reviewDocumentType = inv => isLoanRepayment(inv) ? LOAN_OPTION.value : inv?.type || ''
export const loanAmount = inv => inv?.totalAmount ?? inv?.amount ?? ''
export const LOAN_NOTE = 'هذا المسار لسداد أصل القرض أو القسط الرأسمالي. راجع كشف الجهة الممولة وافصل أرباح التمويل والرسوم إن وجدت في فاتورة مصروف مستقلة؛ لا يُستنتج توزيعها من إجمالي الخصم.'

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
  return next
}

const validMoney = v => /^\d+(?:\.\d{1,2})?$/.test(toLatinNumber(v)) && Number.isFinite(Number(toLatinNumber(v)))
/** Display/payload validation; the existing server validates permissions, source, account and amount. */
export function loanBlockReason(inv, types) {
  if (!isLoanRepayment(inv)) return null
  if (!loanTypes(types).includes(inv.transType)) return 'اختر القرض أو القسط من الأنواع المسجلة للمنشأة؛ لا يُختار تلقائيًا.'
  if (!['cash', 'bank', 'custody'].includes(inv.paySource)) return 'اختر مصدر سداد القرض: الصندوق أو البنك أو العهدة.'
  if (!validMoney(loanAmount(inv)) || Number(toLatinNumber(loanAmount(inv))) <= 0) return 'راجع مبلغ سداد أصل القرض؛ يجب أن يكون أكبر من صفر وبمنزلتين عشريتين كحد أقصى.'
  if (inv.vatAmount != null && inv.vatAmount !== '' && (!validMoney(inv.vatAmount) || Number(toLatinNumber(inv.vatAmount)) !== 0)) return 'القراءة تحمل ضريبة: افصل أي رسوم وضريبتها عن أصل القرض، ثم صحح هذا الحقل إلى صفر بعد مراجعة المستند.'
  return null
}
