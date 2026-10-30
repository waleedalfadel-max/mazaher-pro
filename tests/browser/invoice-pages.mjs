// Real upload page and review card in a browser, with the real image compression, PDF building and reading module.
// Storage, database and the reading service are synthetic in-page stubs; every outbound request is blocked.
// Run: node tests/browser/invoice-pages.mjs (Playwright required).
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
const require = createRequire(import.meta.url)
let playwright
try { playwright = require('playwright') } catch {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw new Error('Install Playwright.')
  playwright = createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, '../package.json'))('playwright')
}

// PNG of a given size; noise=true makes it barely compressible (to exceed the reading limit honestly).
function png(width, height, seed = 1, noise = false) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
  let s = seed
  const rows = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3)
    for (let x = 0; x < width * 3; x++) { s = (s * 1103515245 + 12345) & 0x7fffffff; row[1 + x] = noise ? s >> 16 & 255 : 255 - ((x + y + seed * 40) % 50) }
    rows.push(row)
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}

const temp = await mkdtemp(path.join(tmpdir(), 'invoice-pages-'))
const bundle = path.join(temp, 'app.js')
const stubs = {
  supabase: `const db = () => window.db
    class Q { constructor(t) { this.t = t; this.f = [] } select() { return this } eq(k, v) { this.f.push([k, v]); return this } order() { return this } limit() { return this }
      insert(row) { this.op = 'insert'; this.row = row; return this } update(p) { this.op = 'update'; this.patch = p; return this } delete() { this.op = 'delete'; return this } single() { this.one = true; return this }
      then(ok, ko) { return Promise.resolve(this.run()).then(ok, ko) }
      run() { const rows = db()[this.t] || (db()[this.t] = [])
        if (this.op === 'insert') { const r = { id: 'doc-' + (rows.length + 1), ...this.row }; rows.push(r); return { data: { id: r.id }, error: null } }
        const hit = rows.filter(r => this.f.every(([k, v]) => r[k] === v))
        if (this.op === 'update') { hit.forEach(r => Object.assign(r, this.patch)); return { data: hit[0] ? { id: hit[0].id } : null, error: null } }
        if (this.op === 'delete') { db()[this.t] = rows.filter(r => !hit.includes(r)); window.deleted.push(...hit.map(r => r.id)); return { data: null, error: null } }
        return { data: this.one ? hit[0] || null : hit, error: null } } }
    export const supabase = { from: t => new Q(t), rpc: async () => ({ data: { ok: true, readings: [] }, error: null }), auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic' } } }) } }`,
  storage: `export const uploadToStorage = async file => { const b = new Uint8Array(await file.arrayBuffer()); let s = ''; for (const x of b) s += String.fromCharCode(x)
    window.stored.push({ name: file.name, type: file.type, size: file.size, base64: btoa(s) }); return 'synthetic://' + window.stored.length }
    export const getSignedUrl = async () => null; export const fetchAsBase64 = async () => ({})`,
  auth: `export const useAuth = () => ({ role: 'purchasing', userName: 'Synthetic buyer', projectId: 'p1', projectName: 'Synthetic Co', branch: null })`,
  settings: `export const getProjectSettings = async () => ({ settings: {} }); export const getTransactionTypes = async () => ['🛒 مصروفات تشغيلية']`,
  analyze: `export const createAnalyzeFetch = () => async init => { const body = JSON.parse(init.body); window.readings.push(body)
    const queued = window.replies && window.replies.shift(); if (queued) return { ok: true, status: 200, json: async () => queued }
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(window.reply) }], stop_reason: 'end_turn' }) } }
    export const AUTH_ERROR_CODES = new Set(); export class AnalysisAuthError extends Error {}`,
}
await build({ stdin: { contents: `
  import React from 'react'; import { createRoot } from 'react-dom/client'
  import Upload from './src/pages/InvoiceUpload.jsx'
  import { DocCard, DocImagePanel } from './src/pages/PendingDocuments.jsx'
  import './src/ui/theme.css'; import './src/ui/app.css'
  const root = createRoot(document.getElementById('root'))
  window.mountUpload = () => { window.db = { documents: [], categories: [] }; window.stored = []; window.readings = []; window.deleted = []; root.render(<Upload key={Math.random()} />) }
  window.mountCard = (doc, invoices) => root.render(<><DocImagePanel key={Math.random()} doc={doc} isImage={doc.file_type?.startsWith('image/')} onOpenFile={() => {}} /><DocCard key={Math.random()} doc={{ status: 'analyzed', ...doc, analysis_result: { invoices } }}
    v2={{ version: 1, mode: 'active', invoices: invoices.map(r => ({ id: r._id, status: 'pending' })) }} categories={[]} transTypes={['🛒 مصروفات تشغيلية']} branches={[]} suppliers={[]} payableSuppliers={[]}
    setup={{ settings: {}, bankAccounts: [] }} onEdit={() => {}} onEditInvoice={() => {}} onEditItem={() => {}} onDeleteItem={() => {}} onReplaceInvoice={() => {}}
    onApprove={() => { window.approved = true }} onApproveInvoice={() => { window.approved = true }} /></>)
`, resolveDir: process.cwd(), sourcefile: 'pages-ui.jsx', loader: 'jsx' },
  outfile: bundle, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.woff2': 'dataurl', '.woff': 'dataurl' },
  define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'synthetic', setup(b) {
    b.onLoad({ filter: /[\\/]lib[\\/]supabase\.js$/ }, () => ({ contents: stubs.supabase, loader: 'js' }))
    b.onLoad({ filter: /[\\/]lib[\\/]storage\.js$/ }, () => ({ contents: stubs.storage, loader: 'js' }))
    b.onLoad({ filter: /[\\/]contexts[\\/]AuthContext\.jsx$/ }, () => ({ contents: stubs.auth, loader: 'js' }))
    b.onLoad({ filter: /[\\/]lib[\\/]projectSettings\.js$/ }, () => ({ contents: stubs.settings, loader: 'js' }))
    b.onLoad({ filter: /[\\/]lib[\\/]analyzeRequest\.js$/ }, () => ({ contents: stubs.analyze, loader: 'js' }))
    b.onLoad({ filter: /[\\/]pages[\\/]PendingDocuments\.jsx$/ }, async a => ({ contents: (await (await import('node:fs/promises')).readFile(a.path, 'utf8')) + '\nexport {DocCard, DocImagePanel};', loader: 'jsx' }))
  } }], logLevel: 'warning' })

const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 390, height: 900 } })
page.setDefaultTimeout(20000)
const errors = [], network = [], passed = []
page.on('pageerror', e => errors.push(String(e)))
page.on('popup', p => p.close())
await page.route('**/*', r => { const u = r.request().url(); if (u === 'http://fixture.local/') return r.fulfill({ contentType: 'text/html', body: '<html dir="rtl"><body><div id="root"></div></body></html>' }); if (u.startsWith('blob:') || u.startsWith('data:')) return r.continue(); network.push(u); return r.abort() })
const check = name => { passed.push(name); console.log('PASS ' + name) }
const reply = invoices => page.evaluate(r => { window.reply = r }, { rotation: 0, invoices })
const oneInvoice = { type: 'expense', description: 'Synthetic Supplies Co', invoiceNumber: 'INV-42', date: '2026-10-20', totalAmount: 281.75, vatAmount: 36.75, amountsBasis: 'inclusive', paySource: 'custody', transType: '🛒 مصروفات تشغيلية',
  items: [['Cups', 92], ['Lids', 46], ['Napkins', 57.5], ['Bags', 51.75], ['Gloves', 34.5]].map(([description, amount]) => ({ description, amount })) }
const files = list => list.map(([name, buffer]) => ({ name, mimeType: 'image/png', buffer }))
const pdfSizes = async base64 => (await PDFDocument.load(Buffer.from(base64, 'base64'))).getPages().map(p => [p.getWidth(), p.getHeight()])

try {
  await page.goto('http://fixture.local/'); await page.addScriptTag({ path: bundle })

  // 1. Default: separate files, unchanged behaviour (one document and one reading per file).
  await page.evaluate(() => window.mountUpload()); await reply([oneInvoice])
  const mode = page.getByRole('group', { name: 'طريقة الرفع' })
  assert.equal(await mode.getByRole('button', { name: 'ملفات مستقلة — كل ملف فاتورة' }).getAttribute('aria-pressed'), 'true')
  await page.locator('input[type=file]').setInputFiles(files([['a.png', png(500, 700, 1)], ['b.png', png(500, 700, 2)]]))
  await page.getByRole('button', { name: 'رفع 2 مستندات' }).click()
  await page.getByText('حُفظ 2 مستند للمراجعة').waitFor()
  let state = await page.evaluate(() => ({ docs: window.db.documents.map(d => [d.file_type, d.status]), stored: window.stored.length, readings: window.readings.length }))
  assert.deepEqual(state, { docs: [['image/png', 'analyzed'], ['image/png', 'analyzed']], stored: 2, readings: 2 })
  check('default stays separate files: two photos, two documents, two readings')

  // 2. Pages of one invoice: preview, reorder, delete before upload; one PDF document, one reading, pages in the chosen order.
  await page.evaluate(() => window.mountUpload()); await reply([oneInvoice])
  await page.getByRole('group', { name: 'طريقة الرفع' }).getByRole('button', { name: 'صور صفحات فاتورة واحدة' }).click()
  await page.locator('input[type=file]').setInputFiles(files([['p1.png', png(600, 800, 1)], ['p2.png', png(620, 820, 2)], ['p3.png', png(640, 840, 3)]]))
  const list = page.locator('[data-k="invoice-pages"] li')
  assert.equal(await list.count(), 3)
  assert.equal(await page.locator('[data-k="invoice-pages"] img').evaluateAll(xs => xs.every(x => x.complete && x.naturalWidth > 0)), true)
  await page.getByRole('button', { name: 'نقل الصفحة 3 للأعلى' }).click()                 // p1, p3, p2
  assert.deepEqual(await list.locator('small').allInnerTexts(), ['p1.png', 'p3.png', 'p2.png'])
  await page.getByRole('button', { name: 'حذف الصفحة 3' }).click()                        // p1, p3
  assert.deepEqual(await list.locator('small').allInnerTexts(), ['p1.png', 'p3.png'])
  check('pages are previewed, reordered and removed before upload')
  await page.getByRole('button', { name: 'رفع الفاتورة (2 صفحات)' }).click()
  await page.getByText('حُفظ 1 مستند للمراجعة').waitFor()
  state = await page.evaluate(() => ({ docs: window.db.documents.map(d => [d.file_type, d.status, d.file_name]), stored: window.stored.map(s => [s.type, s.name]), readings: window.readings.length,
    block: window.readings[0].messages[0].content.map(x => x.type), pdf: window.stored[0].base64, sent: window.readings[0].messages[0].content[0].source.data }))
  assert.deepEqual(state.docs, [['application/pdf', 'analyzed', 'فاتورة من 2 صفحات - p1.pdf']])
  assert.equal(state.stored.length, 1); assert.equal(state.readings, 1); assert.deepEqual(state.block, ['document', 'text'])
  assert.equal(state.sent, state.pdf)
  assert.deepEqual(await pdfSizes(state.pdf), [[600, 800], [640, 840]])                    // chosen order, full photo size
  assert.match(await page.locator('.rp-uploads').first().innerText(), /2 صفحات في ملف واحد/)
  check('one PDF document and one reading; pages in the chosen order at full photo size; the stored file is the file read')

  // 3. A split reading of grouped pages is kept for review with a warning (not deleted as a multi-invoice photo).
  await page.evaluate(() => window.mountUpload())
  await reply([{ ...oneInvoice, items: oneInvoice.items.slice(0, 3), totalAmount: null, vatAmount: 0 }, { ...oneInvoice, items: oneInvoice.items.slice(3) }])
  await page.getByRole('group', { name: 'طريقة الرفع' }).getByRole('button', { name: 'صور صفحات فاتورة واحدة' }).click()
  await page.locator('input[type=file]').setInputFiles(files([['p1.png', png(600, 800, 1)], ['p2.png', png(600, 800, 2)]]))
  await page.getByRole('button', { name: 'رفع الفاتورة (2 صفحات)' }).click()
  await page.getByText('حُفظ 1 مستند للمراجعة').waitFor()
  assert.match(await page.locator('.rp-uploads').first().innerText(), /قُرئت صفحات الفاتورة كـ2 فواتير — سيراجعها المحاسب مع الصفحات، ولن يُدمج شيء تلقائيًا/)
  assert.deepEqual(await page.evaluate(() => [window.deleted.length, window.db.documents.length, window.db.documents[0].analysis_result.invoices.length]), [0, 1, 2])
  check('grouped pages read as two invoices: kept for review with a clear warning, nothing deleted or merged')

  // 4. Too large to read: refused before anything is uploaded or read.
  await page.evaluate(() => window.mountUpload()); await reply([oneInvoice])
  await page.getByRole('group', { name: 'طريقة الرفع' }).getByRole('button', { name: 'صور صفحات فاتورة واحدة' }).click()
  // Random-pixel photos (incompressible) generated in the page: about 1 MB each after the usual upload compression
  await page.evaluate(async () => {
    const input = document.querySelector('input[type=file]'), dt = new DataTransfer()
    for (let i = 1; i <= 3; i++) {
      const c = document.createElement('canvas'); c.width = 1000; c.height = 1300
      const ctx = c.getContext('2d'), img = ctx.createImageData(c.width, c.height)
      for (let o = 0; o < img.data.length; o += 65536) crypto.getRandomValues(img.data.subarray(o, Math.min(o + 65536, img.data.length)))
      for (let k = 3; k < img.data.length; k += 4) img.data[k] = 255
      ctx.putImageData(img, 0, 0)
      const blob = await new Promise(r => c.toBlob(r, 'image/png'))
      dt.items.add(new File([blob], `n${i}.png`, { type: 'image/png' }))
    }
    input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.getByRole('button', { name: 'رفع الفاتورة (3 صفحات)' }).click()
  await page.getByText('لم تُرفع الفاتورة').waitFor({ timeout: 60000 })
  assert.match(await page.locator('.ts-note--error').innerText(), /طلب قراءة هذه الصفحات .* ميجابايت، والحد .* لم يُرفع شيء\./)
  assert.deepEqual(await page.evaluate(() => [window.stored.length, window.db.documents.length, window.readings.length]), [0, 0, 0])
  assert.equal(await page.locator('[data-k="invoice-pages"] li').count(), 3)              // pages kept so the user can remove some
  check('pages whose reading request would exceed the limit are refused before upload; nothing stored or read')
  // A sixth page is not added.
  await page.evaluate(() => window.mountUpload())
  await page.getByRole('group', { name: 'طريقة الرفع' }).getByRole('button', { name: 'صور صفحات فاتورة واحدة' }).click()
  await page.locator('input[type=file]').setInputFiles(files([1, 2, 3, 4, 5, 6].map(i => [`s${i}.png`, png(200, 300, i)])))
  assert.equal(await page.locator('[data-k="invoice-pages"] li').count(), 5)
  assert.match(await page.locator('.ts-note--error').innerText(), /الحد 5 صفحات للفاتورة الواحدة؛ لم تُضف 1 صورة/)
  check('at most five pages')

  // 6. Together with the reading-failure fix (#35): an invalid reply twice while uploading grouped pages or separate files
  //    stores each document exactly once, saves no reading, shows no reply text, and the retry is a single extra request.
  const bad = { error: 'JSON_PARSE_ERROR', reason: 'invalid', stopReason: 'end_turn', outputTokens: 200, length: 990, position: 992 }
  await page.evaluate(() => window.mountUpload()); await page.evaluate(b => { window.replies = [b, b] }, bad)
  await page.getByRole('group', { name: 'طريقة الرفع' }).getByRole('button', { name: 'صور صفحات فاتورة واحدة' }).click()
  await page.locator('input[type=file]').setInputFiles(files([['p1.png', png(600, 800, 1)], ['p2.png', png(600, 800, 2)]]))
  await page.getByRole('button', { name: 'رفع الفاتورة (2 صفحات)' }).click()
  await page.getByText('حُفظ 1 مستند للمراجعة').waitFor()
  let fail = await page.evaluate(() => ({ docs: window.db.documents.map(d => [d.file_type, d.status, d.analysis_result ?? null]), stored: window.stored.length, readings: window.readings.length, deleted: window.deleted.length, text: document.body.innerText }))
  assert.deepEqual(fail.docs, [['application/pdf', 'uploaded', null]]); assert.equal(fail.stored, 1); assert.equal(fail.readings, 2); assert.equal(fail.deleted, 0)
  assert.match(fail.text, /محفوظ للمراجعة/); assert.doesNotMatch(fail.text, /JSON|النص الخام|position/)
  await page.evaluate(() => window.mountUpload()); await page.evaluate(b => { window.replies = [b, b, b, b] }, bad)
  await page.locator('input[type=file]').setInputFiles(files([['a.png', png(500, 700, 1)], ['b.png', png(500, 700, 2)]]))
  await page.getByRole('button', { name: 'رفع 2 مستندات' }).click(); await page.getByText('حُفظ 2 مستند للمراجعة').waitFor()
  fail = await page.evaluate(() => ({ docs: window.db.documents.map(d => [d.status, d.analysis_result ?? null]), stored: window.stored.length, readings: window.readings.length }))
  assert.deepEqual(fail, { docs: [['uploaded', null], ['uploaded', null]], stored: 2, readings: 4 })
  check('with #35: invalid replies store each document once, save no reading, show no reply text; one retry per reading')

  // 5. Review card: page count with a button per page; split suspicion warning; VAT counted twice blocks approval.
  const pdf = state.pdf
  await page.evaluate(([p, inv]) => window.mountCard({ file_name: 'فاتورة من 2 صفحات.pdf', file_type: 'application/pdf', _imageData: p, _isUrl: false, _showImage: true },
    [{ ...inv, _id: 'i1', items: inv.items.slice(0, 3), totalAmount: null, vatAmount: 0 }, { ...inv, _id: 'i2', items: inv.items.slice(3) }]), [pdf, oneInvoice])
  await page.locator('[data-k="pdf-page-count"]').waitFor()
  assert.equal(await page.locator('[data-k="pdf-page-count"]').innerText(), '2')
  assert.deepEqual(await page.locator('[data-k="pdf-pages"] button').allInnerTexts(), ['فتح الملف كاملًا', 'الصفحة 1', 'الصفحة 2'])
  await page.evaluate(() => { window.opened = []; window.open = u => { window.opened.push(u); return null } })
  await page.getByRole('button', { name: /فتح الصفحة 2/ }).click(); await page.getByRole('button', { name: 'فتح الملف كاملًا' }).click()
  const opened = await page.evaluate(() => window.opened)
  assert.match(opened[0], /^blob:.*#page=2$/); assert.match(opened[1], /^blob:[^#]*$/)
  assert.match(await page.locator('[data-k="split-suspicion"]').innerText(), /قد تكون هذه صفحات فاتورة واحدة قُسّمت إلى عدة فواتير[\s\S]*لا يُدمج شيء تلقائيًا/)
  check('review shows the page count, opens each page, and warns about a suspected split without merging')
  await page.evaluate(inv => window.mountCard({ file_name: 'x.png', file_type: 'image/png' }, [{ ...inv, _id: 'i1', vatAmount: 73.5 }]), oneInvoice)
  await page.locator('[data-k="vat-excess"]').waitFor()
  assert.equal(await page.getByRole('button', { name: 'اعتماد', exact: true }).isDisabled(), true)
  await page.evaluate(inv => window.mountCard({ file_name: 'x.png', file_type: 'image/png' }, [{ ...inv, _id: 'i1' }]), oneInvoice)
  assert.equal(await page.locator('[data-k="vat-excess"]').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'اعتماد', exact: true }).isDisabled(), false)
  check('VAT above what 15% of the total allows blocks approval; the correct VAT does not')

  assert.deepEqual(errors, []); assert.deepEqual(network, [])
  check('no page errors or outbound requests')
  console.log(JSON.stringify({ passed: passed.length, failed: 0 }))
} catch (e) { console.log('DIAGNOSTIC ' + JSON.stringify({ errors, body: (await page.locator('body').innerText().catch(() => '?')).slice(0, 1500), state: await page.evaluate(() => ({ stored: window.stored?.length, docs: window.db?.documents?.length, readings: window.readings?.length })).catch(() => null) })); throw e }
 finally { await browser.close(); await rm(temp, { recursive: true, force: true }) }
