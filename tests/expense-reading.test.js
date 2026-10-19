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
  const context = vm.createContext({ module: { exports: {} }, requests: [], reply: { rotation: 0, invoices: [invoice] } })
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
