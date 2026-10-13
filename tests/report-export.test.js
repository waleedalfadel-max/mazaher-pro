// تصدير التقارير (src/lib/reportExport.js): وصف القسم من الأرقام نفسها، وملف Excel صالح بأرقام قابلة للحساب.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'
import { reportModel, modelToXlsx, sheetRows, exportFileName, displayValue, zipStore } from '../src/lib/reportExport.js'
import { vatFigures } from '../src/lib/vatTreatment.js'

// قراءة zip (مخزَّن أو مضغوط) بلا مكتبة
export function unzip(buf) {
  const out = {}; let o = 0
  while (buf.readUInt32LE(o) === 0x04034b50) {
    const method = buf.readUInt16LE(o + 8), size = buf.readUInt32LE(o + 18), nameLen = buf.readUInt16LE(o + 26), extra = buf.readUInt16LE(o + 28)
    const name = buf.slice(o + 30, o + 30 + nameLen).toString('utf8'), start = o + 30 + nameLen + extra
    const data = buf.slice(start, start + size)
    out[name] = (method === 0 ? data : inflateRawSync(data)).toString('utf8')
    o = start + size
  }
  return out
}
const cellsOf = xml => [...xml.matchAll(/<row r="(\d+)">(.*?)<\/row>/g)].map(([, , r]) => [...r.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(.*?)<\/c>)/g)].map(([, col, attrs, inner]) => ({
  col, t: /t="inlineStr"/.test(attrs) ? 's' : inner ? 'n' : 'e', v: inner ? (inner.match(/<t[^>]*>(.*?)<\/t>/)?.[1] ?? inner.match(/<v>(.*?)<\/v>/)?.[1]) : null })))

const vatCtx = () => {
  const VAT = '🏛️ ضريبة القيمة المضافة'
  const entries = [
    { id: 'a', date: '2026-09-02', type: '🥩 تكلفة البضاعة المباعة', description: 'مورد & <ألبان>', custody_out: 1150, vat_amount: 150, status: 'approved' },
    { id: 'b', date: '2026-09-28', type: VAT, description: 'سداد ضريبة', bank_out: 5000, status: 'approved' },
    { id: 'c', date: '2026-09-25', type: VAT, description: 'ملتبس', custody_out: 230, vat_amount: 30, status: 'approved' },
  ]
  const vat = vatFigures({ entries, docItems: [], outputVat: 2100.456 })
  return { tab: 'vat', org: 'مطعم تجريبي', from: '2026-09-01', to: '2026-09-30', branch: 'all', branches: ['أ', 'ب'], generatedAt: new Date(2026, 9, 1, 21, 5),
    data: { totalSales: 16103.5, netSales: 14003.04, vat } }
}

test('وصف قسم الضريبة: المؤشرات والحساب والمدفوعات والملتبس من vatFigures نفسها، ووصف الأرقام', () => {
  const m = reportModel(vatCtx())
  assert.equal(m.title, 'تقرير ضريبة القيمة المضافة'); assert.equal(m.branchText, 'كل الفروع'); assert.equal(m.rangeText, '1 سبتمبر – 30 سبتمبر 2026')
  assert.equal(m.generatedText, '1 أكتوبر 2026، 21:05')
  const cards = m.blocks.find(b => b.id === 'vat.cards').items
  assert.deepEqual(cards.map(c => c.key), ['vat.output', 'vat.input', 'vat.net', 'vat.payments'])
  assert.equal(cards[1].value, 150); assert.equal(cards[3].value, 5000)
  assert.ok(Math.abs(cards[2].value - 1950.456) < 1e-9)
  assert.match(m.blocks.find(b => b.id === 'vat.notice').text, /للمتابعة الداخلية.*لا تُطرح/)
  assert.ok(!JSON.stringify(m).includes('يجب تحويل'))
  assert.equal(m.blocks.find(b => b.id === 'vat.review').rows.length, 1)
  assert.ok(m.scope.length >= 4)
})

test('Excel: zip صالح، ورقة من اليمين لليسار، والأرقام أرقام (بمنزلتين) والتواريخ تواريخ والنصوص محمية', () => {
  const m = reportModel(vatCtx())
  const files = unzip(Buffer.from(modelToXlsx(m)))
  assert.deepEqual(Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'])
  const sheet = files['xl/worksheets/sheet1.xml']
  assert.match(sheet, /rightToLeft="1"/)
  assert.ok(sheet.includes('مورد &amp; &lt;ألبان&gt;'))
  const rows = cellsOf(sheet)
  // الصفوف كما في sheetRows: كل خلية رقمية رقم مقرّب لمنزلتين
  const expected = sheetRows(m)
  assert.equal(rows.length, expected.length)
  const out = rows.find(r => r[0]?.v === 'ضريبة المخرجات')
  assert.equal(out[1].t, 'n'); assert.equal(out[1].v, '2100.46')
  const dateRow = rows.find(r => r.some(c => c.v === 'سداد ضريبة'))
  assert.equal(dateRow[0].t, 'n'); assert.equal(dateRow[0].v, String(Math.round((Date.UTC(2026, 8, 28) - Date.UTC(1899, 11, 30)) / 86400000)))
  // كل XML في الملف سليم البنية تقريبيًا: وسوم مغلقة
  for (const x of Object.values(files)) assert.equal((x.match(/</g) || []).length, (x.match(/>/g) || []).length)
})

test('اسم الملف والعرض', () => {
  const m = reportModel({ ...vatCtx(), branch: 'فرع العليا' })
  assert.equal(exportFileName(m, 'pdf'), 'تقرير-ضريبة-القيمة-المضافة-2026-09-01-2026-09-30-فرع-العليا.pdf')
  assert.equal(displayValue(-4678.664, 'money'), '-4,678.66'); assert.equal(displayValue(9.9, 'pct'), '9.9%'); assert.equal(displayValue(null, 'money'), '—')
  assert.equal(displayValue('2026-09-05', 'date'), '5 سبتمبر 2026')
})

test('zip: CRC صحيح يقرؤه zlib/unzip', () => {
  const z = Buffer.from(zipStore({ 'a.txt': 'مرحبا' }))
  assert.equal(unzip(z)['a.txt'], 'مرحبا')
  assert.equal(z.readUInt32LE(z.length - 22), 0x06054b50)
})
