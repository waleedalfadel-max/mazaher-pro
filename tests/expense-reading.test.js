import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { build } from 'esbuild'
import { exactTotals } from '../src/lib/approvalV2.js'

// Exercise the real request and response path. Synthetic OCR replies only; no network or customer image.
const bundle = await build({ entryPoints: ['src/lib/claude.js'], bundle: true, write: false,
  platform: 'node', format: 'cjs', define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'no-network', setup(b) {
    b.onLoad({ filter: /[\\/]lib[\\/]supabase\.js$/ }, () => ({ contents: 'export const supabase = {};', loader: 'js' }))
    b.onLoad({ filter: /[\\/]lib[\\/]analyzeRequest\.js$/ }, () => ({ contents: `
      export const createAnalyzeFetch = () => async init => {
        globalThis.requests.push(JSON.parse(init.body));
        return {ok:true,json:async()=>({content:[{text:JSON.stringify(globalThis.reply)}]})};
      };`, loader: 'js' }))
  } }] })

for (const basis of ['exclusive', 'inclusive']) test(`actual expense request preserves ${basis} amounts and printed totals`, async () => {
  const invoice = { type: 'expense', amountsBasis: basis, totalAmount: 230, vatAmount: 30,
    items: [{ description: 'Product A', amount: basis === 'exclusive' ? 80 : 92 },
      { description: 'Product B', amount: basis === 'exclusive' ? 120 : 138 }] }
  const context = vm.createContext({ TextEncoder, module: { exports: {} }, requests: [], reply: { rotation: 0, invoices: [invoice] } })
  vm.runInContext(bundle.outputFiles[0].text, context)
  const output = JSON.parse(JSON.stringify(await context.module.exports.analyzeDocument('synthetic', 'image/png', 'fixture.png')))
  assert.deepEqual(output.invoices[0], invoice)
  assert.equal(exactTotals(output.invoices[0]).status, 'match')
  assert.equal(context.requests.length, 1)
  const prompt = context.requests[0].messages[0].content.find(c => c.type === 'text').text
  assert.match(prompt, /"amountsBasis"/)
  assert.match(prompt, /لا لكل سطر نصي أو رقمي/)
  assert.match(prompt, /لا تغيّر الأرقام لتغطية فرق/)
  assert.doesNotMatch(prompt, /قسّم المبلغ الإجمالي تقديرياً|كل مبلغ بند يشمل ضريبته الخاصة/)
})

async function captureReading(uploadedBy, settings, invoices = [{ type: 'expense', paySource: 'custody' }]) {
  const context = vm.createContext({ TextEncoder, module: { exports: {} }, requests: [], reply: { rotation: 0, invoices } })
  vm.runInContext(bundle.outputFiles[0].text, context)
  const result = await context.module.exports.analyzeDocument('synthetic', 'image/png', 'fixture.png', uploadedBy, [], 'Test company', [], false, settings)
  assert.equal(context.requests.length, 1)
  return { result: JSON.parse(JSON.stringify(result)),
    prompt: context.requests[0].messages[0].content.find(c => c.type === 'text').text }
}

test('legacy companies send the production uploader rule for every role, including omitted settings', async () => {
  const roles = [
    ['cashier', 'cash (الكاشير يدفع من الصندوق دائماً)'],
    ['purchasing', 'custody (مسؤول المشتريات يدفع من العهدة دائماً)'],
    ['owner', 'bank (المالك يدفع من البنك دائماً)'],
    ['accountant', 'custody'], ['', 'custody'],
  ]
  for (const settings of [undefined, {}]) for (const [role, source] of roles) {
    const { prompt } = await captureReading(role, settings)
    assert.ok(prompt.includes(`- paySource: ثابت حسب من رفع المستند — ${source} — لا تغيّره حتى لو ذُكر غيره في المستند (عدا سداد المورد: paySource من الإيصال نفسه — حوالة أو تحويل بنكي = bank، سند صرف نقدي = cash)`), role)
    assert.doesNotMatch(prompt, /paySource: اقتراح مبدئي/)
  }
})

test('a missing or unsupported workflow cannot opt a company into suggested reading sources', async () => {
  for (const settings of [null, { bank_workflow: {} }, { bank_workflow: { version: 2 } }, { account_dashboard: { enabled: true } }]) {
    const { prompt } = await captureReading('purchasing', settings)
    assert.match(prompt, /paySource: ثابت حسب من رفع المستند — custody/)
    assert.doesNotMatch(prompt, /paySource: اقتراح مبدئي/)
  }
})

test('version 1 workflow keeps configured suggestions with and without the new dashboard', async () => {
  for (const enabled of [false, true]) {
    const settings = { bank_workflow: { version: 1, uploaders: { purchasing: { source: 'bank' }, owner: { source: 'cash' } } },
      account_dashboard: { enabled } }
    for (const [role, source] of [['purchasing', 'bank'], ['owner', 'cash'], ['cashier', 'cash']]) {
      const { prompt } = await captureReading(role, settings)
      assert.ok(prompt.includes(`paySource: اقتراح مبدئي من إعداد الرافع = ${source}. المراجع يؤكده أو يغيره.`))
      assert.match(prompt, /لا تحوّل فاتورة آجلة إلى مدفوعة بسبب الاقتراح/)
      assert.doesNotMatch(prompt, /paySource: ثابت حسب من رفع المستند/)
    }
  }
})

test('the scoped prompt preserves supplier-payment exceptions and does not overwrite extracted sources', async () => {
  const invoices = [
    { type: 'expense', paySource: 'credit', description: 'Synthetic credit purchase' },
    { type: 'supplier_payment', paySource: 'bank', amount: 12, paymentEvidence: 'payment to supplier' },
    { type: 'supplier_payment', paySource: 'cash', amount: 5, paymentEvidence: 'cash payment to supplier' },
  ]
  for (const settings of [{}, { bank_workflow: { version: 1, uploaders: { purchasing: { source: 'bank' } } } }]) {
    const { prompt, result } = await captureReading('purchasing', settings, invoices)
    assert.match(prompt, /سداد المورد: paySource من الإيصال نفسه — حوالة أو تحويل بنكي = bank، سند صرف نقدي = cash/)
    assert.deepEqual(result.invoices.map(i => i.paySource), ['credit', 'bank', 'cash'])
  }
})

test('multiline receipt evidence uses the printed full-quantity total without inventing a missing item', async () => {
  const invoice = { type: 'expense', totalAmount: 92, vatAmount: 12, amountsBasis: 'inclusive',
    items: [{ description: 'Synthetic product', quantity: 3, unitPrice: 23, amount: 23,
      printedLineTotal: 69, printedLineBasis: 'inclusive' }] }
  const { result, prompt } = await captureReading('purchasing', {}, [invoice])
  assert.equal(result.invoices[0].items[0].amount, '69.00')
  assert.equal(result.invoices[0].items[0].readingAmount, 23)
  assert.equal(result.invoices[0].items.length, 1)
  assert.equal(result.invoices[0].totalAmount, 92)
  assert.equal(exactTotals(result.invoices[0]).status, 'mismatch')
  assert.match(prompt, /مفتاح الأعمدة/)
  assert.match(prompt, /لا تنشئ صنفًا من فرق الإجمالي/)
  assert.match(prompt, /لا تقلب اليوم والسنة/)
})

test('three-row products: the reading path keeps printed inclusive line totals that match the invoice and asks for every row', async () => {
  // Synthetic: nets plus invoice VAT are one halala over; the printed inclusive line totals match exactly.
  const item = d => ({ description: d, quantity: 1, unitPrice: 10, amount: 8.7, lineNet: 8.7, lineVat: 1.3, printedLineTotal: 10, printedLineBasis: 'inclusive' })
  const invoice = { type: 'expense', totalAmount: 30, vatAmount: 3.91, amountsBasis: 'exclusive', items: ['P1', 'P2', 'P3'].map(item) }
  const { result, prompt } = await captureReading('purchasing', {}, [invoice])
  const out = result.invoices[0]
  assert.equal(out.amountsBasis, 'inclusive')
  assert.deepEqual(out.items.map(i => [i.amount, i.readingAmount]), [['10.00', 8.7], ['10.00', 8.7], ['10.00', 8.7]])
  assert.equal(out.readingBasis, 'exclusive')
  assert.equal(exactTotals(out).status, 'match')
  assert.match(prompt, /"lineNet":null,"lineVat":null/)
  assert.match(prompt, /لا تصف الصافي قبل الضريبة بأنه شامل/)
  assert.match(prompt, /lineNet \+ lineVat = printedLineTotal/)
  assert.match(prompt, /لا تعدّل رقمًا ليتحقق الفحص/)
  assert.match(prompt, /"unitPriceBasis":null/)
  assert.match(prompt, /"printedItemCount":null,"printedQuantityTotal":null/)
  assert.match(prompt, /لا تضع أحدهما مكان الآخر/)
  assert.match(prompt, /لا تستنتجه من نتيجة الضرب/)
})
