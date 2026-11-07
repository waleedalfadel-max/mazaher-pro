import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expenseVatRounding } from '../src/lib/expenseVatRounding.js'
import { exactTotals } from '../src/lib/approvalV2.js'

// Synthetic receipt amounts, no customer identifiers or images.
export const roundingInvoice = () => ({ type: 'expense', amountsBasis: 'inclusive', totalAmount: 82, vatAmount: 10.7,
  items: [{ amount: 52, lineNet: 45.22, lineVat: 6.78, printedLineTotal: 52 },
    { amount: 30, lineNet: 26.09, lineVat: 3.91, printedLineTotal: 30 }] })

test('document rounding: preserves source and exact gross total; allocated VAT equals invoice tax', () => {
  const inv = roundingInvoice(), before = structuredClone(inv), out = expenseVatRounding(inv)
  assert.equal(exactTotals(inv).status, 'match')
  assert.deepEqual(out, { printed: 1069, invoice: 1070, difference: 1, vats: [679, 391], lines: [{ line: 1, from: 678, to: 679 }] })
  assert.deepEqual(inv, before)
})

test('explicit zero stays zero; exclusive basis uses its own taxable base', () => {
  const inv = roundingInvoice()
  inv.items.push({ amount: 20, lineNet: 20, lineVat: 0, printedLineTotal: 20 }); inv.totalAmount = 102
  assert.deepEqual(expenseVatRounding(inv).vats, [679, 391, 0])
  inv.amountsBasis = 'exclusive'; inv.items = inv.items.map(it => ({ ...it, amount: it.lineNet })); inv.totalAmount = 102.01
  assert.deepEqual(expenseVatRounding(inv).vats, [679, 391, 0])
})

test('rounding down and many lines are explained by group arithmetic, never a blanket tolerance', () => {
  const it = { amount: 1, lineNet: .87, lineVat: .13, printedLineTotal: 1 }
  const inv = { type: 'expense', amountsBasis: 'inclusive', totalAmount: 100, vatAmount: 13.04, items: Array.from({ length: 100 }, () => ({ ...it })) }
  const out = expenseVatRounding(inv)
  assert.equal(out.difference, 4); assert.equal(out.vats.reduce((a, b) => a + b), 1304)
  const down = { type: 'expense', amountsBasis: 'inclusive', totalAmount: .1, vatAmount: .01,
    items: [1, 2].map(() => ({ amount: .05, lineNet: .04, lineVat: .01, printedLineTotal: .05 })) }
  assert.deepEqual(expenseVatRounding(down).vats, [1, 0])
})

test('real mismatches, missing evidence, edits, discounts and corrections do not qualify', () => {
  const cases = [
    inv => { inv.vatAmount = 10.68 },
    inv => { inv.vatAmount = 10.71 },
    inv => { inv.totalAmount = 82.01 },
    inv => { delete inv.items[0].lineVat },
    inv => { inv.items[0].lineVat = '6.78' },
    inv => { inv.items[0].lineNet = 45.21 },
    inv => { inv.items[0].lineNet = 45.23; inv.items[0].lineVat = 6.77 },
    inv => { inv.items[0].amount = 51; inv.items[1].amount = 31 },
    inv => { inv.invoiceDiscount = 1; inv.totalAmount = 81 },
    inv => { inv.items[0].vatCorrection = { value: 6.78 } },
    inv => { inv.items[0].lineVat = 0; inv.items[0].lineNet = 52 },
    inv => { inv.type = 'sales' },
  ]
  for (const change of cases) { const inv = roundingInvoice(); change(inv); assert.equal(expenseVatRounding(inv), null, change.toString()) }
  const exact = roundingInvoice(); exact.vatAmount = 10.69
  assert.equal(expenseVatRounding(exact), null, 'matching printed tax keeps original allocation')
})
