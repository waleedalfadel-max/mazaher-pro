// Real React pages, synthetic data only, no outbound network. Native print CSS
// is exercised by Chromium's PDF output as well as the actual print button.
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { journalFixture } from '../fixtures/journal-detail.js'
import { PDFDocument } from 'pdf-lib'

const require = createRequire(import.meta.url)
let playwright
try { playwright = require('playwright') } catch { playwright = createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, '../package.json'))('playwright') }
const dir = await mkdtemp(path.join(tmpdir(), 'journal-detail-ui-'))
const bundle = path.join(dir, 'app.js'), tables = journalFixture(), errors = [], queries = []
let failure = '', delay = 0
const stub = `class Q{constructor(table){this.table=table;this.filters=[];this.orders=[]}select(c){this.columns=c;return this}eq(k,v){this.filters.push(['eq',k,v]);return this}in(k,v){this.filters.push(['in',k,v]);return this}not(k,op,v){this.filters.push(['not',k,v,op]);return this}gte(k,v){this.filters.push(['gte',k,v]);return this}lte(k,v){this.filters.push(['lte',k,v]);return this}order(k,o){this.orders.push([k,o?.ascending!==false]);return this}single(){this.one=true;return this}maybeSingle(){this.one=true;return this}range(a,b){this.offset=a;this.limit=b-a+1;return this}then(resolve,reject){return window.query(JSON.parse(JSON.stringify(this))).then(resolve,reject)}}export const supabase={from:t=>new Q(t)};`
await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route}from'react-router-dom';import JournalDetail from './src/pages/JournalDetail.jsx';import JournalDay from './src/pages/JournalDay.jsx';import JournalLedger from './src/pages/JournalLedger.jsx';import Accounts from './src/pages/Accounts.jsx';import './src/ui/fonts.js';import './src/ui/theme.css';import './src/ui/frame.css';import './src/ui/app.css';const root=createRoot(document.getElementById('root'));let n=0;window.mount=(route,reset=true)=>root.render(<MemoryRouter key={reset?++n:n} initialEntries={[route]}><Routes><Route path='/operations' element={<JournalLedger unified/>}/><Route path='/accounts' element={<Accounts/>}/><Route path='/journal-entry/:entryId' element={<JournalDetail/>}/><Route path='/daily-journal' element={<JournalDay/>}/></Routes></MemoryRouter>);`, resolveDir: process.cwd(), loader: 'jsx' }, outfile: bundle, bundle: true, format: 'iife', jsx: 'automatic', loader: { '.woff2': 'dataurl', '.woff': 'dataurl' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'synthetic', setup(b) {
  b.onLoad({ filter: /\/lib\/supabase\.js$/ }, () => ({ contents: stub, loader: 'js' }))
  b.onLoad({ filter: /\/contexts\/AuthContext\.jsx$/ }, () => ({ contents: 'export const useAuth=()=>window.auth', loader: 'js' }))
} }], logLevel: 'warning' })
const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(String(error)))
  await page.route('**/*', route => route.abort())
  await page.setContent('<html dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root" style="padding:20px"></div></body></html>')
  await page.exposeFunction('query', async q => {
    queries.push(q)
    const wait = delay; if (wait) await new Promise(r => setTimeout(r, wait))
    if (failure === q.table) return { data: null, error: { message: 'fixture_failure' } }
    const rows = (tables[q.table] || []).filter(r => q.filters.every(([op, k, v, sub]) => op === 'in' ? v.includes(r[k]) : op === 'not' ? sub === 'is' ? r[k] != null : r[k] !== v : op === 'gte' ? r[k] >= v : op === 'lte' ? r[k] <= v : r[k] === v)).sort((a, b) => {
      for (const [k, asc] of q.orders) { if (a[k] < b[k]) return asc ? -1 : 1; if (a[k] > b[k]) return asc ? 1 : -1 } return 0
    })
    return { data: q.one ? rows[0] || null : rows.slice(q.offset || 0, (q.offset || 0) + Math.min(q.limit || 2, 2)), error: null }
  })
  await page.addStyleTag({ path: dir + '/app.css' }); await page.addScriptTag({ path: bundle })
  await page.evaluate(() => { window.auth = { projectId: 'p1', projectName: 'منشأة تجريبية', role: 'owner', viewState: 'ok', sessionEpoch: 1 }; window.printCalls = 0; window.print = () => { window.printCalls++ } })
  const mount = route => page.evaluate(route => window.mount(route), route)
  const operations = page.locator('#root .journal-operation')
  await mount('/accounts?account=bank:main&from=2026-11-01&to=2026-11-01')
  await page.locator('[data-k="account-movements"] tbody tr').first().waitFor()
  await page.locator('[data-k="account-movements"] a[href="/journal-entry/bank"]').click()
  await page.waitForFunction(() => document.querySelectorAll('#root .journal-operation').length === 6)
  const text = await page.locator('#root').innerText()
  for (const marker of ['CASH-MOVEMENT', 'BANK-MOVEMENT', 'DELIVERY-MOVEMENT', 'CREDIT-MOVEMENT', 'TRANSFER-MOVEMENT', 'ملغي', 'الراجحي الرئيسي', 'المورد التجريبي', 'الفاتورة الأصلية.pdf', 'سند السداد.pdf']) assert.ok(text.includes(marker), marker)
  assert.ok(!text.includes('FOREIGN-SECRET') && !text.includes('OTHER-INVOICE-SECRET') && !text.includes('OTHER-INVOICE-ITEM'))
  assert.equal(await page.getByRole('link', { name: 'رجوع للسجل' }).getAttribute('href'), '/accounts?account=bank:main&from=2026-11-01&to=2026-11-01')
  assert.equal(await operations.locator('button').count(), 0, 'details cannot mutate transactions')
  console.log('PASS account-filtered link opens all journal movements, names, items, attachments; exact return URL')

  await page.getByRole('button', { name: 'طباعة القيد', exact: true }).click()
  assert.equal(await page.evaluate(() => window.printCalls), 1)
  await page.emulateMedia({ media: 'print' })
  assert.equal(await page.locator('#root').isVisible(), false)
  assert.equal(await page.locator('.journal-print-root').isVisible(), true)
  assert.equal(await page.locator('.journal-print-root .journal-operation').count(), 6)
  assert.equal(await page.locator('.journal-print-root button').count(), 0)
  const pdf = await page.pdf({ path: dir + '/journal.pdf', preferCSSPageSize: true, printBackground: true })
  assert.ok((await PDFDocument.load(pdf)).getPageCount() >= 2)
  console.log('PASS print button invokes print; output contains only full journal, with multipage A4 PDF')
  await page.emulateMedia({ media: 'screen' }); await page.screenshot({ path: dir + '/desktop.png', fullPage: true })
  await page.setViewportSize({ width: 375, height: 900 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile overflow')
  await page.screenshot({ path: dir + '/mobile.png', fullPage: true })
  console.log('PASS 375px mobile layout has no horizontal overflow')

  await page.clock.setFixedTime(new Date('2026-11-07T10:00:00Z'))
  await mount('/operations')
  await page.waitForFunction(() => document.querySelectorAll('.daily-journals .journal-summary-row').length === 4)
  assert.equal(await page.locator('.daily-journals [data-journal="QD-2026-100"]').count(), 1)
  assert.equal(await page.locator('[data-table="jl.rows"]').count(), 0, 'detail is hidden by default')
  await page.getByRole('searchbox', { name: 'بحث بالبيان أو رقم القيد' }).fill('BANK-MOVEMENT')
  assert.equal(await page.locator('.daily-journals .journal-summary-row').count(), 1)
  assert.ok((await page.locator('.daily-journals').innerText()).includes('حسب التصفية'))
  await page.getByRole('link', { name: 'ملخص اليوم وطباعته' }).click()
  await page.waitForFunction(() => document.querySelectorAll('#root [data-k="journal-day"] .journal-summary-row').length === 4)
  assert.ok((await page.locator('#root').innerText()).includes('جميع حسابات اليوم'))
  assert.ok(!(await page.locator('#root').innerText()).includes('ملغي'))
  await page.getByRole('button', { name: 'طباعة ملخص اليوم' }).click()
  assert.equal(await page.evaluate(() => window.printCalls), 2)
  await page.emulateMedia({ media: 'print' })
  assert.equal(await page.locator('#root').isVisible(), false)
  assert.equal(await page.locator('.journal-print-root .journal-summary-row').count(), 4)
  await page.pdf({ path: dir + '/daily-summary.pdf', preferCSSPageSize: true, printBackground: true })
  await page.emulateMedia({ media: 'screen' })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'daily mobile overflow')
  await page.screenshot({ path: dir + '/daily-mobile.png', fullPage: true })
  await page.locator('#root a[href="/journal-entry/bank"]').click()
  await page.waitForFunction(() => document.querySelectorAll('#root .journal-operation').length === 6)
  assert.equal(await page.getByRole('link', { name: 'رجوع للسجل' }).getAttribute('href'), '/daily-journal?date=2026-11-01')
  console.log('PASS one summary per journal, scoped search, full-day print without duplicate postings, and return to daily summary')
  await mount('/operations')
  await page.getByText('خيارات العرض والتصفية', { exact: true }).click()
  await page.getByRole('button', { name: 'تفصيلي', exact: true }).click()
  await page.getByRole('searchbox', { name: 'بحث بالبيان أو رقم القيد' }).fill('BANK-MOVEMENT')
  await page.locator('.ldg-cards a[href="/journal-entry/bank"]').click()
  await page.waitForFunction(() => document.querySelectorAll('#root .journal-operation').length === 6)
  assert.equal(await page.getByRole('link', { name: 'رجوع للسجل' }).getAttribute('href'), '/operations')
  console.log('PASS filtered operations list opens full journal from mobile entry number')

  failure = 'attachments'; await mount('/journal-entry/cash')
  await page.getByRole('alert').waitFor()
  assert.equal(await operations.count(), 0); assert.equal(await page.locator('.journal-print-root').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'طباعة القيد', exact: true }).isDisabled(), true)
  failure = ''; await page.getByRole('button', { name: 'إعادة المحاولة' }).click()
  await page.waitForFunction(() => document.querySelectorAll('#root .journal-operation').length === 6)
  console.log('PASS missing associated data blocks partial view and printing; retry restores full journal')

  await mount('/journal-entry/foreign'); await page.getByRole('alert').waitFor(); assert.equal(await operations.count(), 0)
  await mount('/journal-entry/no-number'); await operations.waitFor(); assert.equal(await operations.count(), 1)
  delay = 30; await mount('/journal-entry/cash')
  await page.evaluate(() => { window.auth = { ...window.auth, projectId: 'p2', projectName: 'Other', sessionEpoch: 2 }; window.mount('/journal-entry/cash', false) })
  await page.getByRole('alert').waitFor(); delay = 0
  assert.equal(await operations.count(), 0); assert.equal(await page.locator('.journal-print-root').count(), 0)
  console.log('PASS foreign/unnumbered journals and tenant switch do not expose unrelated or stale data')

  await page.evaluate(() => { window.auth = { ...window.auth, projectId: 'p1', projectName: 'منشأة تجريبية', sessionEpoch: 3 } })
  const base = tables.ledger_entries[0]
  for (let n = 0; n < 36; n++) tables.ledger_entries.push({ ...base, id: 'long' + n, journal_number: 'QD-LONG', description: `PRINT-MOVEMENT-${n}`, document_id: null, file_url: 'https://example.invalid/original.pdf' })
  await mount('/journal-entry/long0'); await page.waitForFunction(() => document.querySelectorAll('#root .journal-operation').length === 36)
  await page.emulateMedia({ media: 'print' })
  const longPdf = await page.pdf({ path: dir + '/long-journal.pdf', preferCSSPageSize: true, printBackground: true })
  assert.ok((await PDFDocument.load(longPdf)).getPageCount() >= 6)
  assert.deepEqual(errors, []); console.log('PASS long journal prints across multiple pages; no React runtime errors')
  console.log(JSON.stringify({ artifacts: dir, queries: queries.length }))
} finally { await browser.close() }
