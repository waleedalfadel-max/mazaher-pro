import { test } from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import vm from 'node:vm'
import { build } from 'esbuild'
import { PDFDocument } from 'pdf-lib'
import { MAX_INVOICE_PAGES, movePage, pagesProblem, removePage, splitSuspicion } from '../src/lib/invoicePages.js'
import { buildPagesPdf, pdfPageCount } from '../src/lib/invoicePagesPdf.js'
import { exactTotals, vatExcess } from '../src/lib/approvalV2.js'
import { READING_REQUEST_LIMIT } from '../src/lib/readingRequest.js'

// 2026-10-30: photos of the pages of ONE invoice become one PDF document; separate files stay the default. Synthetic data only.

// A valid solid-colour PNG of any size (no image library needed).
function png(width, height, rgb = [255, 255, 255]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())])
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

test('page list: reorder and remove return new lists; limits and types are enforced before upload', () => {
  const pages = ['a', 'b', 'c']
  assert.deepEqual(movePage(pages, 2, 0), ['c', 'a', 'b'])
  assert.deepEqual(movePage(pages, 0, 1), ['b', 'a', 'c'])
  assert.equal(movePage(pages, 0, 5), pages)
  assert.deepEqual(removePage(pages, 1), ['a', 'c'])
  assert.deepEqual(pages, ['a', 'b', 'c'])
  const img = { type: 'image/jpeg' }
  assert.match(pagesProblem([img]), /صفحتين على الأقل/)
  assert.equal(pagesProblem([img, img]), null)
  assert.equal(MAX_INVOICE_PAGES, 5)
  assert.match(pagesProblem(Array(6).fill(img)), /الحد 5 صفحات/)
  assert.match(pagesProblem([img, { type: 'application/pdf' }]), /صور فقط/)
})

test('one PDF, one page per photo in the chosen order, each page exactly the photo size (no crop, no extra scaling)', async () => {
  const sizes = [[300, 500], [320, 480], [280, 600]]
  const pdf = await buildPagesPdf(sizes.map(([w, h], i) => ({ bytes: png(w, h, [i * 60, 0, 0]), type: 'image/png' })))
  const doc = await PDFDocument.load(pdf)
  assert.equal(doc.getPageCount(), 3)
  assert.equal(await pdfPageCount(pdf), 3)
  assert.deepEqual(doc.getPages().map(p => [p.getWidth(), p.getHeight()]), sizes)
  // reordered by the reviewer before upload: the PDF follows the new order
  const moved = movePage(sizes, 2, 0)
  const pdf2 = await PDFDocument.load(await buildPagesPdf(moved.map(([w, h]) => ({ bytes: png(w, h), type: 'image/png' }))))
  assert.deepEqual(pdf2.getPages().map(p => [p.getWidth(), p.getHeight()]), moved)
  await assert.rejects(buildPagesPdf([{ bytes: png(10, 10), type: 'image/png' }]), /صفحتين على الأقل/)
})

// The real reading module: measuring the request must give exactly the size of the request that would be sent.
const bundle = await build({ entryPoints: ['src/lib/claude.js'], bundle: true, write: false, platform: 'node', format: 'cjs', define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'no-network', setup(b) {
    b.onLoad({ filter: /[\\/]lib[\\/]supabase\.js$/ }, () => ({ contents: 'export const supabase = {};', loader: 'js' }))
    b.onLoad({ filter: /[\\/]lib[\\/]analyzeRequest\.js$/ }, () => ({ contents: `export const createAnalyzeFetch = () => async init => { globalThis.sent.push(init.body);
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{"rotation":0,"invoices":[{"type":"expense","totalAmount":1,"items":[{"amount":1}]}]}' }] }) } };
      export const AUTH_ERROR_CODES = new Set(); export class AnalysisAuthError extends Error {}`, loader: 'js' }))
  } }] })
const reading = () => { const c = vm.createContext({ TextEncoder, TextDecoder, module: { exports: {} }, sent: [] }); vm.runInContext(bundle.outputFiles[0].text, c); return c }

test('the request size is measured with the real instructions before upload, and nothing is sent while measuring', async () => {
  const pdf = Buffer.from(await buildPagesPdf([{ bytes: png(400, 600), type: 'image/png' }, { bytes: png(400, 600), type: 'image/png' }])).toString('base64')
  const args = ['purchasing', [{ id: 'c1', name: 'Synthetic', parent_id: null, type: 'expense', is_active: true }], 'Synthetic Co', ['🛒 مصروفات تشغيلية'], false, {}]
  const c = reading()
  const measured = await c.module.exports.analyzeDocument(pdf, 'application/pdf', 'pages.pdf', ...args, { measureOnly: true })
  assert.equal(c.sent.length, 0)
  assert.equal(measured.limit, READING_REQUEST_LIMIT)
  await c.module.exports.analyzeDocument(pdf, 'application/pdf', 'pages.pdf', ...args)
  assert.equal(c.sent.length, 1)
  assert.equal(measured.requestBytes, new TextEncoder().encode(c.sent[0]).byteLength)
  const body = JSON.parse(c.sent[0])
  assert.deepEqual(body.messages[0].content.map(x => x.type), ['document', 'text'])
  assert.equal(await pdfPageCount(Buffer.from(body.messages[0].content[0].source.data, 'base64')), 2)
})

test('instructions separate a continued invoice from independent invoices', async () => {
  const c = reading()
  await c.module.exports.analyzeDocument('synthetic', 'image/png', 'x.png')
  const prompt = JSON.parse(c.sent[0]).messages[0].content.find(x => x.type === 'text').text
  for (const rule of [/مستند من عدة صفحات/, /تطابق رقم الفاتورة وحده لا يكفي/, /المورد نفسه، ومعه علامة استمرار/, /«المجموع المرحّل» أو «المنقول» أو «إجمالي الصفحة» ليس بندًا ولا يُجمع/,
    /إن تكرر الإجمالي أو الضريبة في كل صفحة فلا تجمعهما/, /صفحة مكررة .* لا تُقرأ مرتين/, /صفحة ناقصة .* ولا تخترع بنودها/, /صفحات لمورد آخر، أو بترويسة فاتورة جديدة برقم مختلف/,
    /صفحات الفاتورة الواحدة ليست فواتير منفصلة/]) assert.match(prompt, rule)
})

// ── What the application does with each multi-page reading (synthetic readings). It never merges or adds anything. ──
const item = (d, amount) => ({ description: d, amount })
const inv = (patch) => ({ type: 'expense', description: 'Synthetic Supplies Co', invoiceNumber: 'INV-42', amountsBasis: 'inclusive', totalAmount: 281.75, vatAmount: 36.75, ...patch })
const all = [item('Cups', 92), item('Lids', 46), item('Napkins', 57.5), item('Bags', 51.75), item('Gloves', 34.5)]

test('total on the last page only: one invoice with both pages matches once; a split reading is flagged and blocked', () => {
  const one = inv({ items: all })
  assert.equal(exactTotals(one).status, 'match'); assert.equal(vatExcess(one), null); assert.equal(splitSuspicion([one]), null)
  const split = [inv({ items: all.slice(0, 3), totalAmount: null, vatAmount: 0 }), inv({ items: all.slice(3) })]
  assert.deepEqual(splitSuspicion(split), { invoices: [0, 1] })
  assert.deepEqual(split.map(x => exactTotals(x).status), ['mismatch', 'mismatch'])
})

test('total and VAT printed on every page: counting them twice is blocked (items mismatch, or VAT above what 15% allows)', () => {
  assert.equal(exactTotals(inv({ items: all, totalAmount: 563.5 })).status, 'mismatch')       // total summed twice
  const vatTwice = inv({ items: all, vatAmount: 73.5 })                                      // items and total right, VAT twice
  assert.equal(exactTotals(vatTwice).status, 'match')                                        // the item check alone would pass it
  assert.deepEqual(vatExcess(vatTwice), { vat: 7350, max: 3675 + 5 })
  assert.equal(vatExcess(inv({ items: all, vatAmount: 36.75 })), null)
  // exclusive basis: VAT twice breaks the items check as well
  const net = all.map(x => item(x.description, Math.round(x.amount / 1.15 * 100) / 100))
  assert.equal(exactTotals(inv({ amountsBasis: 'exclusive', items: net, vatAmount: 73.5 })).status, 'mismatch')
})

test('carried-forward subtotal read as an item, a duplicated page, or a missing page: the totals do not match and approval is blocked', () => {
  assert.equal(exactTotals(inv({ items: [...all.slice(0, 3), item('Carried forward', 195.5), ...all.slice(3)] })).status, 'mismatch')
  assert.equal(exactTotals(inv({ items: [...all.slice(0, 3), ...all.slice(0, 3), ...all.slice(3)] })).status, 'mismatch')
  assert.equal(exactTotals(inv({ items: all.slice(3), readingWarnings: ['missing page 1'] })).status, 'mismatch')
})

test('two different invoices in one PDF stay separate, are not flagged as a split, and each is checked on its own', () => {
  const a = inv({ items: all }), b = inv({ description: 'Other Trading Est', invoiceNumber: 'B-7', totalAmount: 23, vatAmount: 3, items: [item('Tape', 23)] })
  assert.equal(splitSuspicion([a, b]), null)
  assert.deepEqual([a, b].map(x => exactTotals(x).status), ['match', 'match'])
  // same supplier, different numbers, both complete: two genuine invoices, no warning
  assert.equal(splitSuspicion([a, inv({ invoiceNumber: 'INV-43', totalAmount: 23, vatAmount: 3, items: [item('Tape', 23)] })]), null)
  // same supplier and number: warning even if both have totals; other document types are ignored
  assert.deepEqual(splitSuspicion([a, inv({ items: [item('Tape', 23)], totalAmount: 23, vatAmount: 3 })]), { invoices: [0, 1] })
  assert.equal(splitSuspicion([{ ...a, type: 'sales' }, { ...a, type: 'sales' }]), null)
})
