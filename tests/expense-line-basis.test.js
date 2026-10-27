import { test } from 'node:test'
import assert from 'node:assert/strict'
import { approvalMessage, buildInvoicePayload, callError, exactTotals, expenseBasisNearMatch, expenseBasisSuggestion } from '../src/lib/approvalV2.js'
import { basisConfirmed, confirmExpenseBasis, confirmExpenseRounding, normalizeExpenseReading } from '../src/lib/expenseReading.js'

// Synthetic receipts only. Each product is printed on three rows: net before tax, its tax, and the inclusive line total.
// The store computes VAT once on the invoice total, so the printed nets plus invoice VAT miss the total by one halala.
const line = (description, net, vat, total, extra = {}) => ({ description, quantity: 1, unitPrice: total, lineNet: net, lineVat: vat,
  printedLineTotal: total, printedLineBasis: 'inclusive', ...extra })
const three = [line('Synthetic A', 8.7, 1.3, 10), line('Synthetic B', 8.7, 1.3, 10), line('Synthetic C', 8.7, 1.3, 10)]
const receipt = (patch = {}) => ({ type: 'expense', totalAmount: 30, vatAmount: 3.91, ...patch })

test('an invoice that already matches is returned exactly as read, on either basis', () => {
  const inclusive = receipt({ amountsBasis: 'inclusive', items: three.map(it => ({ ...it, amount: it.printedLineTotal })) })
  assert.equal(exactTotals(inclusive).status, 'match')
  assert.deepEqual(normalizeExpenseReading(structuredClone(inclusive)), inclusive)
  const exclusive = { type: 'expense', totalAmount: 230, vatAmount: 30, amountsBasis: 'exclusive',
    items: [{ description: 'Synthetic net 1', amount: 80, lineNet: 80, lineVat: 12, printedLineTotal: 92, printedLineBasis: 'inclusive' },
      { description: 'Synthetic net 2', amount: 120, lineNet: 120, lineVat: 18, printedLineTotal: 138, printedLineBasis: 'inclusive' }] }
  assert.equal(exactTotals(exclusive).status, 'match')
  assert.deepEqual(normalizeExpenseReading(structuredClone(exclusive)), exclusive)
})

test('printed inclusive line totals win over nets when they match the invoice total; first reading is kept', () => {
  const raw = receipt({ amountsBasis: 'exclusive', items: three.map(it => ({ ...it, amount: it.lineNet })) })
  assert.equal(exactTotals(raw).diff, 1)            // nets + invoice VAT: one halala over, not proof of rounding
  const before = structuredClone(raw)
  const out = normalizeExpenseReading(raw)
  assert.deepEqual(raw, before)
  assert.equal(out.amountsBasis, 'inclusive')
  assert.equal(out.readingBasis, 'exclusive')
  assert.equal(out.lineBasisReading, 'inclusive')
  assert.deepEqual(out.items.map(i => i.amount), ['10.00', '10.00', '10.00'])
  assert.deepEqual(out.items.map(i => i.readingAmount), [8.7, 8.7, 8.7])
  assert.equal(out.items.length, 3)
  assert.equal(out.totalAmount, 30)
  assert.equal(out.vatAmount, 3.91)
  assert.equal(exactTotals(out).status, 'match')
  assert.equal(out.roundingReview, undefined)
})

test('tax is never counted twice: inclusive totals labelled as net are switched to inclusive, VAT unchanged', () => {
  const raw = receipt({ amountsBasis: 'exclusive', items: three.map(it => ({ ...it, amount: it.printedLineTotal })) })
  assert.equal(exactTotals(raw).diff, 391)
  const out = normalizeExpenseReading(raw)
  assert.equal(out.amountsBasis, 'inclusive')
  assert.deepEqual(out.items.map(i => i.amount), [10, 10, 10])
  assert.ok(out.items.every(i => !('readingAmount' in i)))
  const payload = buildInvoicePayload(out, { original: out, categories: [], transTypes: [] })
  assert.equal(exactTotals(payload).status, 'match')
  assert.equal(payload.totalAmount, 30)
  assert.equal(payload.vatAmount, 3.91)
})

test('invoice discount and a VAT-exempt product survive unchanged', () => {
  const raw = { type: 'expense', totalAmount: 32, vatAmount: 2.87, invoiceDiscount: 1, amountsBasis: 'exclusive',
    items: [line('Synthetic taxable', 20, 3, 23, { amount: 20, discount: 0.5 }),
      line('Synthetic exempt', 10, 0, 10, { amount: 10 })] }
  const out = normalizeExpenseReading(raw)
  assert.equal(out.amountsBasis, 'inclusive')
  assert.equal(out.invoiceDiscount, 1)
  assert.equal(out.items[0].amount, '23.00')
  assert.equal(out.items[0].discount, 0.5)
  assert.equal(out.items[1], raw.items[1])           // exempt line already equal: same object, nothing recorded
  assert.equal(exactTotals(out).status, 'match')
})

test('printed nets are used only when they, plus printed VAT, match exactly', () => {
  const raw = { type: 'expense', totalAmount: 230, vatAmount: 30, amountsBasis: 'inclusive',
    items: [{ description: 'Synthetic X', amount: 40, quantity: 2, unitPrice: 40, lineNet: 80 },
      { description: 'Synthetic Y', amount: 60, quantity: 2, unitPrice: 60, lineNet: 120 }] }
  const out = normalizeExpenseReading(raw)
  assert.equal(out.amountsBasis, 'exclusive')
  assert.equal(out.readingBasis, 'inclusive')
  assert.deepEqual(out.items.map(i => [i.amount, i.readingAmount]), [['80.00', 40], ['120.00', 60]])
  assert.equal(exactTotals(out).status, 'match')
})

test('incomplete or inconsistent printed evidence leaves the reading untouched and blocked', () => {
  const missing = receipt({ amountsBasis: 'exclusive', items: three.map((it, i) => ({ ...it, amount: it.lineNet, printedLineTotal: i ? it.printedLineTotal : null })) })
  assert.deepEqual(normalizeExpenseReading(structuredClone(missing)), missing)
  const wrong = receipt({ totalAmount: 30.05, amountsBasis: 'exclusive', items: three.map(it => ({ ...it, amount: it.lineNet })) })
  const out = normalizeExpenseReading(structuredClone(wrong))
  assert.deepEqual(out, wrong)
  assert.equal(out.items.length, 3)
  assert.equal(exactTotals(out).status, 'mismatch')
})

test('a basis that leaves a small residual is guidance only, never called rounding or applied', () => {
  // Old-style reading: nets copied and labelled inclusive (the reported failure).
  const read = receipt({ amountsBasis: 'inclusive', items: three.map(it => ({ description: it.description, amount: it.lineNet,
    printedLineTotal: it.lineNet, printedLineBasis: 'inclusive' })) })
  const out = normalizeExpenseReading(read)
  assert.deepEqual(out, read)
  assert.equal(expenseBasisSuggestion(out), null)
  assert.deepEqual(expenseBasisNearMatch(out), { basis: 'exclusive', diff: 1 })
  assert.equal(out.amountsBasis, 'inclusive')
  assert.equal(expenseBasisNearMatch({ ...out, totalAmount: 30.04 }), null)                       // 3+ halalas: no hint
  assert.equal(expenseBasisNearMatch({ ...out, items: out.items.map(i => ({ ...i, amount: 10 })), amountsBasis: 'exclusive' }), null) // exact suggestion instead
})

test('small difference correction needs an explicit basis confirmation first and keeps the original', () => {
  const read = receipt({ amountsBasis: 'inclusive', items: three.map(it => ({ description: it.description, amount: it.lineNet })) })
  const switched = { ...read, amountsBasis: 'exclusive' }
  assert.equal(exactTotals(switched).diff, 1)
  assert.equal(basisConfirmed(switched), false)
  assert.equal(confirmExpenseRounding(switched, 2, 'Checked image'), null)
  const confirmed = confirmExpenseBasis(read, 'exclusive')
  assert.deepEqual(confirmed.basisReview, { basis: 'exclusive', from: 'inclusive' })
  assert.deepEqual(confirmed.items, read.items)
  assert.equal(basisConfirmed(confirmed), true)
  assert.equal(basisConfirmed({ ...confirmed, amountsBasis: 'inclusive' }), false)                  // basis changed again: gate closes
  assert.equal(confirmExpenseRounding(confirmed, 2, '  '), null)
  const fixed = confirmExpenseRounding(confirmed, 2, 'Checked image')
  assert.deepEqual(fixed.roundingReview, { line: 2, basis: 'exclusive', from: '8.70', to: '8.69', difference: '-0.01', reason: 'Checked image' })
  assert.equal(exactTotals(fixed).status, 'match')
  assert.equal(read.items[2].amount, 8.7)
  const changes = buildInvoicePayload(fixed, { original: read, categories: [], transTypes: [] }).review_changes
  assert.ok(changes.some(s => s.includes('أكد المراجع أساس مبالغ البنود من الصورة: قبل الضريبة')))
  assert.ok(changes.some(s => s.includes('تسوية فرق صغير أكدها المراجع للبند 3: 8.70 ← 8.69؛ Checked image')))
  assert.ok(!changes.some(s => s.includes('تقريب')))
})

test('replaced-reading rejection (P0023) is explained on every action path; other codes unchanged', () => {
  assert.deepEqual(callError({ code: 'P0023', message: 'reading_replaced' }), { code: 'reading_replaced' })
  const text = approvalMessage(callError({ code: 'P0023' }))
  assert.match(text, /استُبدلت قراءة هذا المستند/)
  assert.match(text, /لم يُسجَّل شيء/)
  assert.doesNotMatch(text, /الاتصال|الشبكة/)
  assert.deepEqual(callError({ code: 'APP_VERSION_STALE' }), { code: 'app_version_stale' })
  assert.deepEqual(callError({ code: '57014' }), { code: 'network' })
  assert.deepEqual(callError(null), { code: 'network' })
})
