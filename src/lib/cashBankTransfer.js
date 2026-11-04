export const CASH_DEPOSIT = '🏧 تحويل داخلي — إيداع نقدي'
export const CASH_WITHDRAWAL = '🏧 تحويل داخلي — سحب نقدي'

export function cashBankDirection(type) {
  const label = String(type || '').replace(/^🏧\s*/u, '').trim()
  if (label === 'تحويل داخلي — إيداع نقدي') return 'deposit'
  if (label === 'تحويل داخلي — سحب نقدي') return 'withdrawal'
  return null
}

export const isCashBankInvoice = invoice => invoice?.type === 'transfer' && !!cashBankDirection(invoice.transType)
export const cashBankLabel = type => ({ deposit: 'من الصندوق إلى البنك', withdrawal: 'من البنك إلى الصندوق' })[cashBankDirection(type)] || type

export function cashBankMovement(type, amount) {
  const direction = cashBankDirection(type)
  if (!direction) throw new Error('اختر اتجاه التحويل')
  const deposit = direction === 'deposit'
  return { cash_in: deposit ? 0 : amount, cash_out: deposit ? amount : 0, bank_in: deposit ? amount : 0, bank_out: deposit ? 0 : amount,
    custody_in: 0, custody_out: 0, receivable_in: 0, receivable_out: 0 }
}
