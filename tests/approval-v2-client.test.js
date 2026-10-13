import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allocateHalalas, approvalMessage, buildInvoicePayload, exactTotals, reviewChanges, toHalalas, salesCorrectionChanges, money } from '../src/lib/approvalV2.js'

test('الهللات بلا حساب عشري تقريبي، وأكثر من هللتين مرفوض', () => {
  assert.equal(toHalalas('172.5'), 17250)
  assert.equal(toHalalas(282.9), 28290)
  assert.equal(toHalalas('١٬٣٩١٫٥٠'), 139150)
  assert.equal(toHalalas(0.1 + 0.2), NaN)            // 0.30000000000000004 ليس مبلغًا بهللتين
  assert.ok(Number.isNaN(toHalalas('10.005')))
  assert.ok(Number.isNaN(toHalalas('12a')))
  assert.equal(toHalalas(''), null)
})

test('المطابقة على أساس المستند، بلا هامش', () => {
  assert.equal(exactTotals({ totalAmount: 694.6, vatAmount: 90.6, items: [{ amount: 172.5 }, { amount: 282.9 }, { amount: 239.2 }] }).status, 'match')
  const m = exactTotals({ totalAmount: 160, items: [{ amount: 100 }, { amount: 50 }] })
  assert.equal(m.status, 'mismatch'); assert.equal(m.diff, -1000)
  assert.equal(exactTotals({ totalAmount: 100, items: [{ amount: 100.01 }] }).status, 'mismatch')   // هللة واحدة فرق
  assert.equal(exactTotals({ amountsBasis: 'exclusive', totalAmount: 345, vatAmount: 45, items: [{ amount: 100 }, { amount: 200 }] }).status, 'match')
  assert.equal(exactTotals({ totalAmount: 345, vatAmount: 45, items: [{ amount: 100 }, { amount: 200 }] }).status, 'mismatch')
})

test('توزيع الضريبة بالباقي الأكبر يطابق الخادم', () => {
  assert.deepEqual(allocateHalalas([100, 100, 100], 10), [4, 3, 3])
  assert.deepEqual(allocateHalalas([17250, 28290, 23920], 9060), [2250, 3690, 3120])
  assert.equal(allocateHalalas([333, 333, 334], 100).reduce((a, b) => a + b, 0), 100)
})

test('كل بند يأخذ تصنيفه الأساسي ونوع قيده، وسجل التعديلات يوثّق الفرق عن القراءة', () => {
  const categories = [{ id: 1, name: 'تكلفة البضاعة المباعة', parent_id: null }, { id: 2, name: 'لحوم ودواجن', parent_id: 1 },
    { id: 3, name: 'مصروفات تشغيلية', parent_id: null }, { id: 4, name: 'صيانة ونظافة', parent_id: 3 }]
  const transTypes = ['🥩 تكلفة البضاعة المباعة', '🛒 مصروفات تشغيلية']
  const original = { description: 'مورد', totalAmount: 575, items: [{ description: 'دجاج', amount: 460, category_sub: 'لحوم ودواجن' }, { description: 'منظفات', amount: 115, category_sub: 'صيانة ونظافة' }] }
  const edited = { ...original, invoiceNumber: 'M-1', items: [original.items[0], { ...original.items[1], description: 'منظفات أرضيات' }] }
  const p = buildInvoicePayload(edited, { original, categories, transTypes, purchaseCategory: null })
  assert.deepEqual(p.items.map(i => [i.category_main, i.ledger_type]), [['تكلفة البضاعة المباعة', '🥩 تكلفة البضاعة المباعة'], ['مصروفات تشغيلية', '🛒 مصروفات تشغيلية']])
  assert.ok(p.review_changes.some(c => c.includes('رقم الفاتورة')))
  assert.ok(p.review_changes.some(c => c.includes('منظفات أرضيات')))
  assert.deepEqual(reviewChanges(original, original), [])
})

test('رسائل الخادم بالعربية، ومنها المرتبط والفرق', () => {
  assert.match(approvalMessage({ code: 'already_approved', journal_number: 'QD-2026-090' }), /اعتُمد.*QD-2026-090/)
  assert.match(approvalMessage({ code: 'amounts_mismatch', difference: -10 }), /10\.00/)
  assert.match(approvalMessage({ code: 'unexpected_x' }), /unexpected_x/)
})

test('الخصم على الإجمالي في المطابقة: شامل وقبل الضريبة، وبلا بنود أو أكبر منها غير صالح', () => {
  assert.equal(exactTotals({ totalAmount: 144, vatAmount: 18.78, invoiceDiscount: 16, items: [{ amount: 100 }, { amount: 60 }] }).status, 'match')
  assert.equal(exactTotals({ amountsBasis: 'exclusive', totalAmount: 310.5, vatAmount: 40.5, invoiceDiscount: 30, items: [{ amount: 200 }, { amount: 100 }] }).status, 'match')
  const m = exactTotals({ totalAmount: 150, invoiceDiscount: 16, items: [{ amount: 100 }, { amount: 60 }] })
  assert.equal(m.status, 'mismatch'); assert.equal(m.diff, -600)
  assert.equal(exactTotals({ totalAmount: 90, invoiceDiscount: 10, items: [] }).status, 'invalid')
  assert.equal(exactTotals({ totalAmount: 1, invoiceDiscount: 160, items: [{ amount: 100 }, { amount: 60 }] }).status, 'invalid')
  assert.equal(exactTotals({ totalAmount: 90, items: [{ amount: 100 }, { amount: -10 }] }).status, 'invalid')
})

test('تصحيح المبيعات: الرسالة تذكر القناة المتغيرة فقط، بمنزلتين', () => {
  assert.deepEqual(salesCorrectionChanges({ cash: 1184.35, network: 2436.5 }, { cash: 1250.35, network: 2436.5 }), ['النقدي من 1,184.35 إلى 1,250.35'])
  assert.equal(money(2436.5), '2,436.50')
})

test('رسالة الفرق: تطلب مطابقة المستند وخصوماته وضريبته، ولا تقترح بندًا يوازن الإجمالي', () => {
  const m = approvalMessage({ code: 'amounts_mismatch', difference: -12.5 })
  assert.match(m, /طابق مبالغ البنود وخصوماتها والضريبة مع المستند/)
  assert.doesNotMatch(m, /أضف بند/)
})
