import { cents } from './accountStatement.js'
import { isCounted } from './financeRules.js'

// Stable ledger types remain unchanged when a loan's display name changes.
export const LOAN_TYPES = [
  { key: 'car', label: '💳 قسط سيارة', type: '💳 قسط سيارة' },
  { key: 'land', label: '💳 قسط شراء أرض', type: '💳 قسط شراء أرض' },
  { key: 'loan1', label: '💳 قرض ١', type: '💳 قرض ١' },
  { key: 'loan2', label: '💳 قرض ٢', type: '💳 قرض ٢' },
]
export const cleanLoanLabel = s => String(s || '').replace(/^[^\p{L}\p{N}]+/u, '').trim()
const normalizedType = s => cleanLoanLabel(s).replace(/١/g, '1').replace(/٢/g, '2')
export const LOAN_ENTRY_TYPES = [...new Set(LOAN_TYPES.flatMap(l => [l.type, cleanLoanLabel(l.type), normalizedType(l.type), `💳 ${normalizedType(l.type)}`]))]
export const loanKey = type => LOAN_TYPES.find(l => normalizedType(l.type) === normalizedType(type))?.key
const items = settings => settings?.loan_balances?.version === 1 && Array.isArray(settings.loan_balances.items) ? settings.loan_balances.items : []
export function loanDisplayLabel(type, settings) {
  const checkpoint = items(settings).find(l => l?.key === loanKey(type))
  return typeof checkpoint?.label === 'string' && checkpoint.label.trim() || type
}
const money = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && Number.isSafeInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 0.000001
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v

/** A supplied closing balance already includes historical repayments.
 * Subtract only the change from the counted paid total captured with that balance.
 * This also handles same-day approvals, backdated payments and later cancellations.
 * Call with the complete project ledger through `to`, never a period-only slice.
 */
export function loanFigures(entries, settings, to) {
  const cfg = settings?.loan_balances, checkpoints = items(settings)
  const tracked = cfg != null
  const validConfig = !tracked || cfg.version === 1 && Array.isArray(cfg.items)
    && cfg.items.every(l => LOAN_TYPES.some(t => t.key === l?.key))
    && new Set(cfg.items.map(l => l.key)).size === cfg.items.length
  const loans = LOAN_TYPES.map(loan => {
    const baseline = checkpoints.find(l => l?.key === loan.key)
    const paid = (entries || []).filter(e => isCounted(e) && loanKey(e.type) === loan.key && (!to || e.date <= to))
      .reduce((sum, e) => sum + cents(e.cash_out) + cents(e.bank_out) + cents(e.custody_out), 0)
    const known = baseline && money(baseline.balance) && money(baseline.paid_at_baseline) && date(baseline.date) && (!to || baseline.date <= to)
    const change = known ? paid - cents(baseline.paid_at_baseline) : null
    const remaining = known ? Math.max(0, cents(baseline.balance) - change) / 100 : null
    return { ...loan, label: loanDisplayLabel(loan.type, settings), baseline, tracked: !!baseline, paid: paid / 100,
      change: change == null ? null : change / 100, remaining,
      excess: known ? Math.max(0, change - cents(baseline.balance)) / 100 : 0 }
  })
  const recorded = loans.filter(l => l.tracked)
  const knownTotal = recorded.reduce((sum, l) => sum + cents(l.remaining), 0) / 100
  return { loans, tracked, knownTotal, total: validConfig && recorded.every(l => l.remaining != null) ? knownTotal : null }
}
