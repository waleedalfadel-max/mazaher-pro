import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { build } from 'esbuild'
import { expenseReadingIssues, verifiedExpenseReading } from '../src/lib/expenseReadingCheck.js'

const line = (description, amount) => ({ description, amount })
const original = { type: 'expense', date: '2026-01-01', invoiceNumber: 'TEST-1', description: 'Synthetic supplier',
  paySource: 'cash', amountsBasis: 'inclusive', totalAmount: 110, vatAmount: 0, printedItemCount: 2,
  items: [line('Product A', 30), line('Continuation A', 30), line('Product B', 80)] }
const corrected = { ...original, items: [line('Product A continuation', 30), line('Product B', 80)] }

test('a second reading can correct duplicate continuation rows with preserved summary and original evidence', () => {
  assert.equal(expenseReadingIssues(original).length, 2)
  const next = verifiedExpenseReading(original, { ...corrected, paySource: 'bank' })
  assert.deepEqual(next.items, corrected.items)
  assert.equal(next.paySource, 'cash')
  assert.deepEqual(next.readingVerification.previous, original)
  assert.equal(expenseReadingIssues(next).length, 0)
})

test('balancing by invented discounts, deleted tax, a lump total or a different invoice is rejected', () => {
  for (const patch of [{ invoiceDiscount: 30, items: original.items }, { totalAmount: 140, items: original.items },
    { items: [line('Total', 110)], printedItemCount: 1 }, { vatAmount: 1 }, { invoiceNumber: 'OTHER' }, { date: '2026-01-02' }])
    assert.equal(verifiedExpenseReading(original, { ...corrected, ...patch }), null)
  const tax = { ...original, vatAmount: 10, items: original.items.map(it => ({ ...it, lineVat: 3 })) }
  assert.equal(verifiedExpenseReading(tax, { ...corrected, vatAmount: 10 }), null)
})

test('equal invoice and item totals still reveal an incorrect sum of printed line taxes', () => {
  const invoice = { type: 'expense', amountsBasis: 'inclusive', totalAmount: 230, vatAmount: 30,
    items: [{ amount: 115, lineNet: 100.1, lineVat: 14.9, printedLineTotal: 115 },
      { amount: 115, lineNet: 100, lineVat: 15, printedLineTotal: 115 }] }
  assert.match(expenseReadingIssues(invoice).join(' '), /0.10/)
  const rounding = { type: 'expense', amountsBasis: 'inclusive', totalAmount: 30, vatAmount: 3.91,
    items: [1, 2, 3].map(() => ({ amount: 10, lineNet: 8.7, lineVat: 1.3, printedLineTotal: 10 })) }
  assert.deepEqual(expenseReadingIssues(rounding), [])
})

const bundle = await build({ entryPoints: ['src/lib/claude.js'], bundle: true, write: false,
  platform: 'node', format: 'cjs', define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'synthetic-readings', setup(b) {
    b.onLoad({ filter: /[\\/]lib[\\/]supabase\.js$/ }, () => ({ contents: 'export const supabase = {};', loader: 'js' }))
    b.onLoad({ filter: /[\\/]lib[\\/]analyzeRequest\.js$/ }, () => ({ contents: `
      export const createAnalyzeFetch = () => async init => {
        globalThis.requests.push(JSON.parse(init.body));
        const reply = globalThis.replies.shift();
        if (!reply) throw new Error('Verification unavailable');
        return {ok:true,json:async()=>({content:[{text:JSON.stringify(reply)}]})};
      };`, loader: 'js' }))
  } }] })

async function read(replies) {
  const context = vm.createContext({ TextEncoder, module: { exports: {} }, requests: [], replies })
  vm.runInContext(bundle.outputFiles[0].text, context)
  const result = await context.module.exports.analyzeDocument('synthetic', 'image/png', 'fixture.png')
  return { result: JSON.parse(JSON.stringify(result)), requests: context.requests }
}
const wrap = invoices => ({ rotation: 0, invoices })

test('real request path rechecks an inconsistent invoice once, preserving other receipts', async () => {
  const receipt = { type: 'transfer', amount: 50, description: 'Payment receipt', paySource: 'bank' }
  const { result, requests } = await read([wrap([original, receipt]), wrap([corrected, { ...receipt, amount: 500 }])])
  assert.equal(requests.length, 2)
  assert.deepEqual(result.invoices[0].items, corrected.items)
  assert.deepEqual(result.invoices[1], receipt)
  assert.match(requests[1].messages[0].content[1].text, /إعادة فحص من الصورة الأصلية/)
  assert.deepEqual(requests[1].messages[0].content[0], requests[0].messages[0].content[0])
})

test('a failed or still inconsistent second look retains the first reading without a retry loop', async () => {
  for (const replies of [[wrap([original])], [wrap([original]), wrap([original])], [wrap([original]), wrap([])]]) {
    const { result, requests } = await read(replies)
    assert.equal(requests.length, 2)
    assert.deepEqual(result.invoices[0].items, original.items)
    assert.equal(result.invoices[0].totalAmount, 110)
    assert.equal(result.invoices[0].readingVerification.status, 'needs_review')
  }
})

test('consistent invoices and payment-only receipts need no second request', async () => {
  const receipt = { type: 'expense', totalAmount: 50, vatAmount: 0, amountsBasis: 'inclusive',
    items: [line('Payment receipt', 50)], readingWarnings: ['إيصال دفع دون تفاصيل'] }
  const { result, requests } = await read([wrap([corrected, receipt])])
  assert.equal(requests.length, 1)
  assert.deepEqual(result.invoices[1], receipt)
})
