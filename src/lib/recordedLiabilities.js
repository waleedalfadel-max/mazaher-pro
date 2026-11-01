import { cents } from './accountStatement.js'

// Display only: recorded supplier dues plus a documented separate obligation.
// Loan repayments are not outstanding principal. Never net debts against cash or receivables.
export function recordedLiabilities(supplierBalance, other = {}) {
  const suppliersKnown = Number.isFinite(supplierBalance) && supplierBalance >= 0
  const otherTracked = !!other.accountId || !!other.baseline
  const otherKnown = !otherTracked || Number.isFinite(other.remaining) && other.remaining >= 0
  const knownTotal = ((suppliersKnown ? cents(supplierBalance) : 0) + (otherTracked && otherKnown ? cents(other.remaining) : 0)) / 100
  return { total: suppliersKnown && otherKnown ? knownTotal : null, knownTotal, otherTracked }
}
