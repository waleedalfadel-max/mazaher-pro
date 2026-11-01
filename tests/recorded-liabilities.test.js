import test from 'node:test'
import assert from 'node:assert/strict'
import { recordedLiabilities } from '../src/lib/recordedLiabilities.js'
import { suppliersOutstanding, liabilityFigures } from '../src/lib/accountStatement.js'

test('recorded liabilities retain supplier dues without offsetting another supplier credit or counting loan repayments', () => {
  const entries = [
    { status: 'approved', date: '2026-10-02', supplier_id: 'credit', payable_in: 80, payable_out: 10 },
    { status: 'pending', date: '2026-10-02', supplier_id: 'credit', payable_in: 500 },
    { status: 'approved', date: '2026-11-02', supplier_id: 'credit', payable_in: 900 },
    { status: 'approved', date: '2026-10-02', type: '💳 قرض ١', bank_out: 200 },
  ]
  const suppliers = [{ id: 'due', opening_balance: 100 }, { id: 'overpaid', opening_balance: -20 }]
  const transactions = [{ supplier_id: 'due', type: 'payment', amount: 40, date: '2026-10-03' }]
  const to = '2026-10-31'
  const amount = suppliersOutstanding(suppliers, transactions, entries, to)
  assert.equal(recordedLiabilities(amount, liabilityFigures(entries, {}, to)).total, 130)
})

test('adds a documented remaining obligation once, with exact halalah arithmetic', () => {
  assert.equal(recordedLiabilities(0.1, { accountId: 'debt', remaining: 0.2 }).total, 0.3)
  assert.equal(recordedLiabilities(125, { accountId: 'debt', remaining: 0 }).total, 125)
})

test('a configured obligation with an unknown balance never becomes zero or a partial total', () => {
  assert.deepEqual(recordedLiabilities(125, { accountId: 'debt', remaining: null }), { total: null, knownTotal: 125, otherTracked: true })
  assert.equal(recordedLiabilities(null).total, null)
  assert.equal(recordedLiabilities(NaN).total, null)
})

test('absence of a separate obligation is distinct from an unknown configured one', () => {
  assert.equal(recordedLiabilities(0, liabilityFigures([], {}, '2026-10-31')).total, 0)
  assert.equal(recordedLiabilities(125, { baseline: { balance: 50 }, remaining: 50 }).total, 175)
})
