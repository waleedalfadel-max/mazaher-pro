// الآجل لكل فاتورة داخل الصورة متعددة الفواتير (2026-10-20): سياق المورد وقرار «باسم المورد» وحمولة الاعتماد.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInvoicePayload, invoiceSupplierContext, payableDecision, supplierBlockReason } from '../src/lib/approvalV2.js'

const doc = { _supplierId: 'doc-sup', _supplierName: 'اسم المستند', _supplierResolution: 'existing', _matchedSupplierId: 'doc-ps' }
const inv = (o = {}) => ({ type: 'expense', _id: 'i1', description: 'مورد الوصف', paySource: 'credit', totalAmount: 10, items: [{ description: 'x', amount: 10 }], ...o })

test('الصورة متعددة الفواتير: مورد الفاتورة وحده، ولا يتغلب عليه مورد المستند ولا يُرسل للمستند', () => {
  const c = invoiceSupplierContext(doc, inv({ supplier_id: 'inv-sup' }), true)
  assert.equal(c.supplierId, 'inv-sup'); assert.equal(c.documentSupplierId, null)
  const none = invoiceSupplierContext(doc, inv(), true)
  assert.equal(none.supplierId, null)                                  // بلا مورد للفاتورة: لا يُستعار مورد المستند
  assert.equal(invoiceSupplierContext(doc, inv({ paySource: 'payable', supplier_name: ' مورد ب ' }), true).name, 'مورد ب')
  assert.equal(invoiceSupplierContext(doc, inv({ paySource: 'payable' }), true).name, 'مورد الوصف')
  assert.equal(invoiceSupplierContext(doc, inv({ paySource: 'payable' }), true).resolution, null)   // قرار المستند لا يُستعار
})

test('الفاتورة المفردة: اختيار المستند كما كان', () => {
  const c = invoiceSupplierContext(doc, inv({ supplier_id: 'inv-sup' }), false)
  assert.equal(c.supplierId, 'doc-sup'); assert.equal(c.documentSupplierId, 'doc-sup'); assert.equal(c.name, 'اسم المستند'); assert.equal(c.resolution, 'existing')
  assert.equal(invoiceSupplierContext({}, inv({ supplier_id: 'inv-sup' }), false).supplierId, null)   // كما كان: الاختيار من المستند
})

test('حمولة الاعتماد: supplier_id للآجل من القائمة وحده، وعلامات التأكيد لا تُرسل', () => {
  const p = buildInvoicePayload(inv({ supplier_id: 'stale', _supplierResolution: 'new', _matchedSupplierId: 'm' }), { supplierId: 'inv-sup', categories: [] })
  assert.equal(p.supplier_id, 'inv-sup'); assert.equal('_supplierResolution' in p, false); assert.equal('_matchedSupplierId' in p, false)
  const cash = buildInvoicePayload(inv({ paySource: 'cash', supplier_id: 'left-over' }), { supplierId: null, categories: [] })
  assert.equal('supplier_id' in cash, false)                          // تغيّر مصدر الدفع إلى نقدي: لا يبقى مورد
})

test('قرار «آجل — باسم المورد»: مطابق ⇒ الموجود، مشابه بلا تأكيد ⇒ توقف، مؤكد ⇒ حسب التأكيد، وإلا جديد', () => {
  const ctx = r => ({ resolution: r, matchedId: r === 'existing' ? 'ps-1' : null })
  assert.deepEqual(payableDecision({ matchType: 'exact', supplier: { id: 'ps-9' } }, ctx(null)), { resolution: 'existing', supplier_id: 'ps-9' })
  assert.equal(payableDecision({ matchType: 'fuzzy', supplier: { id: 'ps-1' } }, ctx(null)), null)
  assert.deepEqual(payableDecision({ matchType: 'fuzzy', supplier: { id: 'ps-1' } }, ctx('existing')), { resolution: 'existing', supplier_id: 'ps-1' })
  assert.deepEqual(payableDecision({ matchType: 'fuzzy', supplier: { id: 'ps-1' } }, ctx('new')), { resolution: 'new' })
  assert.deepEqual(payableDecision({ matchType: 'none' }, ctx(null)), { resolution: 'new' })
})

test('مانع الاعتماد قبل الإرسال: مورد من القائمة غير مختار، أو اسم مشابه غير مؤكد؛ والنقدي والمبيعات بلا مانع', () => {
  assert.match(supplierBlockReason(inv(), { supplierId: null }, null), /اختر المورد/)
  assert.equal(supplierBlockReason(inv(), { supplierId: 's' }, null), null)
  const fuzzy = { matchType: 'fuzzy', supplier: { name: 'مورد الألبان' } }
  assert.match(supplierBlockReason(inv({ paySource: 'payable' }), { name: 'مورد الالبان', resolution: null }, fuzzy), /يشبه موردًا مسجلًا/)
  assert.equal(supplierBlockReason(inv({ paySource: 'payable' }), { name: 'مورد الالبان', resolution: 'new' }, fuzzy), null)
  assert.equal(supplierBlockReason(inv({ paySource: 'cash' }), { supplierId: null }, null), null)
  assert.equal(supplierBlockReason({ type: 'sales' }, { supplierId: null }, null), null)
})
