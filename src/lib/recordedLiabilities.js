import { cents } from './accountStatement.js'

// Display only: recorded supplier dues, loan balances and a documented separate obligation.
// Loan repayments are not outstanding principal. Never net debts against cash or receivables.
export function recordedLiabilities(supplierBalance, other = {}, loans = {}) {
  const suppliersKnown = Number.isFinite(supplierBalance) && supplierBalance >= 0
  const otherTracked = !!other.accountId || !!other.baseline
  const otherKnown = !otherTracked || Number.isFinite(other.remaining) && other.remaining >= 0
  const loansKnown = !loans.tracked || Number.isFinite(loans.total) && loans.total >= 0
  const knownTotal = ((suppliersKnown ? cents(supplierBalance) : 0) + (otherTracked && otherKnown ? cents(other.remaining) : 0) + (loans.tracked && loansKnown ? cents(loans.total) : 0)) / 100
  return { total: suppliersKnown && otherKnown && loansKnown ? knownTotal : null, knownTotal, otherTracked }
}
