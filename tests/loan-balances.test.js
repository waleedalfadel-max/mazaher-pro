import test from 'node:test'
import assert from 'node:assert/strict'
import { loanFigures, loanDisplayLabel, loanKey, LOAN_ENTRY_TYPES } from '../src/lib/loanBalances.js'
import { recordedLiabilities } from '../src/lib/recordedLiabilities.js'
import { loanPrincipalConfirmation, loanBlockReason } from '../src/lib/loanRepayment.js'

// Synthetic amounts only; customer balances belong in project settings, never source control.
const day = '2026-10-12'
const settings = { loan_balances: { version: 1, items: [
  { key: 'land', label: 'قرض الأرض', balance: 4200.25, paid_at_baseline: 900.10, date: day },
  { key: 'car', label: 'قرض السيارة', balance: 800, paid_at_baseline: 150, date: day },
  { key: 'loan1', label: 'القرض الشخصي', balance: 300, paid_at_baseline: 100, date: day },
] } }
const row = (type, bank_out, patch = {}) => ({ type, bank_out, status: 'approved', date: day, ...patch })
const history = [row('💳 قسط شراء أرض', 900.10), row('💳 قسط سيارة', 150), row('💳 قرض ١', 100)]
const get = (rows = history, to = day, cfg = settings) => loanFigures(rows, cfg, to)
const balance = (r, key) => r.loans.find(l => l.key === key).remaining

test('historical paid totals are already included; aggregate adds recorded principal exactly once', () => {
  const before = structuredClone(history), result = get()
  assert.equal(result.total, 5300.25)
  assert.equal(balance(result, 'loan2'), null)
  assert.equal(recordedLiabilities(125.50, {}, result).total, 5425.75)
  assert.deepEqual(history, before)
})

test('same-day and backdated approvals after capture reduce the loan, pending/rejected/cancelled do not', () => {
  const rows = [...history, row('قرض 1', 25), row('💳 قرض ١', 10, {date: '2026-10-01'}),
    ...['pending', 'rejected', 'cancelled', null].map(status => row('💳 قرض ١', 999, {status})),
    row('💳 قرض ١', 999, {date: '2026-10-13'})]
  assert.equal(balance(get(rows), 'loan1'), 265)
  assert.equal(balance(get([...history, row('قرض ١', 0, {cash_out: 0.10, custody_out: 0.20, status: 'auto'})]), 'loan1'), 299.70)
})

test('cancelling an included repayment restores its liability; overpayment cannot offset another loan', () => {
  assert.equal(balance(get(history.slice(0, 2)), 'loan1'), 400)
  const result = get([...history, row('💳 قرض ١', 350)])
  assert.equal(balance(result, 'loan1'), 0)
  assert.equal(result.loans.find(l => l.key === 'loan1').excess, 50)
  assert.equal(result.total, 5000.25)
})

test('periods before a checkpoint and malformed checkpoints give unknown totals, never false zero', () => {
  assert.equal(get([], '2026-10-11').total, null)
  assert.equal(recordedLiabilities(25, {}, get([], '2026-10-11')).total, null)
  for (const loan_balances of [{version: 2, items: []}, {version: 1, items: [null]},
    {version: 1, items: [{...settings.loan_balances.items[0], balance: null}]},
    {version: 1, items: [{...settings.loan_balances.items[0], date: '2026-02-30'}]},
    {version: 1, items: [settings.loan_balances.items[0], settings.loan_balances.items[0]]}]) {
    assert.equal(get(history, day, {loan_balances}).total, null)
  }
  assert.equal(get(history, day, {}).tracked, false)
  assert.equal(recordedLiabilities(25, {}, get(history, day, {})).total, 25)
})

test('renaming is a project-specific display alias; repayment classification and payload keep the stable ledger type', () => {
  const type = '💳 قرض ١'
  assert.equal(loanDisplayLabel(type, settings), 'القرض الشخصي')
  assert.equal(loanDisplayLabel(type, {}), type)
  for (const t of LOAN_ENTRY_TYPES) assert.ok(loanKey(t))
  assert.equal(loanKey('مصروفات تشغيلية'), undefined)
  const invoice = {type:'transfer',transferPurpose:'loan_repayment',transType:type,paySource:'bank',amount:50,vatAmount:0}
  invoice.loanPrincipalConfirmation = loanPrincipalConfirmation(invoice, true)
  assert.equal(loanBlockReason(invoice, [type]), null)
  assert.equal(invoice.loanPrincipalConfirmation.transType, type)
})
