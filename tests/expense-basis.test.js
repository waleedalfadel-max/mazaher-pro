import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exactTotals, expenseBasisSuggestion, buildInvoicePayload } from '../src/lib/approvalV2.js'

const net = { type: 'expense', totalAmount: 230, vatAmount: 30, items: [{ amount: 80 }, { amount: 120 }] }

test('old reading suggests net basis without changing anything or allowing approval', () => {
  const before = structuredClone(net)
  assert.equal(expenseBasisSuggestion(net), 'exclusive')
  assert.equal(exactTotals(net).status, 'mismatch')
  assert.deepEqual(net, before)
  const accepted = { ...net, amountsBasis: 'exclusive' }
  assert.equal(exactTotals(accepted).status, 'match')
  const payload = buildInvoicePayload(accepted, { original: net, categories: [], transTypes: [] })
  assert.equal(payload.amountsBasis, 'exclusive')
  assert.deepEqual(payload.items.map(i => i.amount), [80, 120])
  assert.equal(payload.totalAmount, net.totalAmount)
  assert.equal(payload.vatAmount, net.vatAmount)
  assert.ok(payload.review_changes.some(s => s.includes('أساس المبالغ')))
})

test('gross basis is offered when tax would otherwise be added twice; explicit choice stays untouched', () => {
  const inv = { ...net, amountsBasis: 'exclusive', items: [{ amount: 92 }, { amount: 138 }] }
  assert.equal(expenseBasisSuggestion(inv), 'inclusive')
  assert.equal(inv.amountsBasis, 'exclusive')
  assert.equal(exactTotals(inv).status, 'mismatch')
  assert.equal(expenseBasisSuggestion({ ...inv, amountsBasis: 'inclusive' }), null)
})

test('discounts are included and even one unexplained halala still blocks approval', () => {
  const inv = { ...net, invoiceDiscount: 20, vatAmount: 27, totalAmount: 207 }
  assert.equal(expenseBasisSuggestion(inv), 'exclusive')
  assert.equal(exactTotals({ ...inv, amountsBasis: 'exclusive' }).status, 'match')
  assert.equal(expenseBasisSuggestion({ ...inv, totalAmount: 207.01 }), null)
  assert.equal(exactTotals({ ...inv, totalAmount: 207.01, amountsBasis: 'exclusive' }).status, 'mismatch')
})

test('missing, invalid, zero tax, no lines and non-expenses do not get a basis suggestion', () => {
  for (const patch of [
    { items: [] }, { items: [{ amount: 200 }, { amount: null }] },
    { items: [{ amount: 'bad' }] }, { totalAmount: '' }, { vatAmount: 0 },
    { vatAmount: -30 }, { invoiceDiscount: -1 }, { type: 'sales' }, { type: 'transfer' },
  ]) assert.equal(expenseBasisSuggestion({ ...net, ...patch }), null)
})

test('duplicated unit/net/total readings stay blocked; no automatic removal of repeated products', () => {
  const inv = { type: 'expense', totalAmount: 287.5, vatAmount: 37.5,
    items: [{ description: 'A', amount: 57.5 }, { description: 'B', amount: 115 },
      { description: 'B', amount: 200 }, { description: 'B', amount: 230 }] }
  const before = structuredClone(inv)
  assert.equal(expenseBasisSuggestion(inv), null)
  assert.equal(exactTotals(inv).status, 'mismatch')
  assert.deepEqual(inv, before)
  assert.equal(exactTotals({ ...inv, items: [inv.items[0], inv.items[3]] }).status, 'match')
  const repeated = { ...net, totalAmount: 184, vatAmount: 24, items: [{ description: 'A', amount: 92 }, { description: 'A', amount: 92 }] }
  const payload = buildInvoicePayload(repeated, { original: repeated, categories: [], transTypes: [] })
  assert.equal(payload.items.length, 2)
  assert.equal(exactTotals(payload).status, 'match')
})
