// إيصالات سداد الموردين في «المستندات» (2026-10-20): اقتراح المورد، تصحيح النوع، فحص ما قبل الإرسال، الحمولة، والقراءة الآلية.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { balanceAfter, buildReceiptPayload, fromReceipt, normalizeReceiptReading, possibleDuplicates, rankPayments, receiptBlockReason,
  receiptHistoryNote, suggestSupplier, supplierOptions, toReceipt, withSuggestedSuppliers } from '../src/lib/supplierReceipts.js'

const opts = supplierOptions(
  [{ id: 's1', name: 'مؤسسة الدواجن الطازجة' }, { id: 's2', name: 'شركة الخضار' }, { id: 's3', name: 'مورد موقوف', is_active: false }],
  [{ id: 'p1', name: 'مخابز الفجر' }, { id: 'p2', name: 'مخابز الفجر الذهبية' }])
const receipt = (o = {}) => ({ _id: 'r1', type: 'supplier_payment', date: '2026-09-26', amount: '120.00', supplierKind: 'list', supplierId: 's1',
  paymentMode: 'new', paySource: 'cash', ...o })

test('موردو المنشأة: القائمة النشطة و«آجل — باسم المورد» بمفتاح ثابت، والموقوف لا يُعرض', () => {
  assert.deepEqual(opts.map(o => o.key), ['list:s1', 'list:s2', 'payable:p1', 'payable:p2'])
})

test('اقتراح المورد: مطابق وحيد مقترح، والمتعدد يعرض القائمة، ولا اقتراح بلا تشابه — ولا اختيار تلقائي', () => {
  const exact = suggestSupplier('الدواجن الطازجة', opts)   // كلمة «مؤسسة» لا تمنع التطابق
  assert.equal(exact.status, 'exact'); assert.equal(exact.candidates[0].key, 'list:s1')
  const amb = suggestSupplier('مخابز الفجر الذهب', opts)
  assert.equal(amb.status, 'ambiguous'); assert.ok(amb.candidates.length >= 2)
  assert.equal(suggestSupplier('محطة وقود', opts).status, 'none')
  assert.equal(suggestSupplier('', opts).status, 'none')
  const read = withSuggestedSuppliers({ invoices: [{ type: 'supplier_payment', beneficiary: 'شركة الخضار' }, { type: 'supplier_payment', beneficiary: 'مخابز الفجر الذهب' }] }, opts)
  assert.deepEqual(read.invoices[0].suggestedSupplier, { kind: 'list', id: 's2', name: 'شركة الخضار' })
  assert.equal(read.invoices[0].supplierId, undefined, 'الاقتراح لا يملأ المورد')
  assert.equal(read.invoices[1].suggestedSupplier, undefined, 'الملتبس لا يُقترح تلقائيًا')
})

test('تصحيح النوع: مصروف ← سداد مورد يأخذ المبلغ والمستفيد والمرجع بلا بنود، والعكس مصروف ببند واحد', () => {
  const r = toReceipt({ _id: 'x', type: 'expense', date: '2026-09-25', totalAmount: '60.00', description: 'حوالة لمورد', invoiceNumber: 'T-9',
    paySource: 'custody', items: [{ amount: 60 }], vatAmount: 0 })
  assert.equal(r.type, 'supplier_payment'); assert.equal(r.amount, '60.00'); assert.equal(r.reference, 'T-9'); assert.equal(r.beneficiary, 'حوالة لمورد')
  assert.equal(r.paySource, '', 'العهدة ليست مصدرًا لسداد مورد'); assert.equal(r.items, undefined); assert.equal(r.supplierId, null)
  const e = fromReceipt(receipt())
  assert.equal(e.type, 'expense'); assert.equal(e.totalAmount, '120.00'); assert.equal(e.items.length, 1)
})

test('منع قبل الإرسال: المورد والمبلغ والتاريخ، ومصدر الدفعة الجديدة، والدفعة المربوطة ومبلغها', () => {
  assert.match(receiptBlockReason(receipt({ supplierId: null })), /اختر المورد/)
  assert.match(receiptBlockReason(receipt({ amount: '0' })), /مبلغ/)
  assert.match(receiptBlockReason(receipt({ amount: '1.234' })), /مبلغ/)
  assert.match(receiptBlockReason(receipt({ date: '' })), /تاريخ/)
  assert.match(receiptBlockReason(receipt({ paySource: 'custody' })), /الصندوق أو البنك/)
  assert.equal(receiptBlockReason(receipt()), null)
  assert.match(receiptBlockReason(receipt({ paymentMode: 'link' })), /اختر الدفعة/)
  const ctx = { payments: [{ journal_number: 'J1', amount: 120, date: '2026-09-24' }, { journal_number: 'J2', amount: 50, date: '2026-09-01', document_id: 'd' }] }
  assert.equal(receiptBlockReason(receipt({ paymentMode: 'link', linkJournal: 'J1' }), ctx), null)
  assert.match(receiptBlockReason(receipt({ paymentMode: 'link', linkJournal: 'J2', amount: 50 }), ctx), /مرتبطة بإيصال آخر/)
  assert.match(receiptBlockReason(receipt({ paymentMode: 'link', linkJournal: 'J1', amount: 119 }), ctx), /لا يساوي مبلغ الدفعة/)
  // دفعة جديدة بمبلغ دفعة قائمة قريبة: تتوقف حتى الربط أو كتابة السبب
  assert.match(receiptBlockReason(receipt(), ctx), /اربط الإيصال بها/)
  assert.equal(receiptBlockReason(receipt({ newPaymentReason: 'دفعة لفاتورة أخرى' }), ctx), null)
  assert.equal(receiptBlockReason({ type: 'expense' }), null)
})

test('الدفعات للربط: غير المربوطة أولًا ثم المبلغ نفسه ثم الأقرب، والتشابه «مرجّح» لا مثبت', () => {
  const ranked = rankPayments([
    { journal_number: 'A', amount: 120, date: '2026-08-01' },
    { journal_number: 'B', amount: 120, date: '2026-09-25', document_id: 'd' },
    { journal_number: 'C', amount: 90, date: '2026-09-26' },
    { journal_number: 'D', amount: '120.00', date: '2026-09-24' },
  ], receipt())
  assert.deepEqual(ranked.map(p => p.journal_number), ['D', 'A', 'C', 'B'])
  assert.equal(ranked[0].likely, true); assert.equal(ranked[1].likely, false)
  assert.deepEqual(possibleDuplicates(ranked, receipt()).map(p => p.journal_number), ['D', 'B'])
})

test('الحمولة: حقول السداد وحدها؛ الدفعة الجديدة بمصدرها وحسابها، والربط بالدفعة وحدها؛ وسجل التعديلات عن القراءة', () => {
  const original = { type: 'expense', totalAmount: '120.00', description: 'حوالة', paySource: 'bank' }
  const p = buildReceiptPayload(receipt({ paySource: 'bank', bankAccountId: 'b1', items: [{ amount: 1 }], vatAmount: 5, transType: 'x', linkJournal: 'J9', reference: 'T-1' }), { original })
  assert.equal(p.paySource, 'bank'); assert.equal(p.bankAccountId, 'b1'); assert.equal(p.reference, 'T-1')
  for (const k of ['items', 'vatAmount', 'transType', 'linkJournal']) assert.equal(p[k], undefined, k)
  assert.ok(p.review_changes.some(c => c.startsWith('نوع المستند')))
  const l = buildReceiptPayload(receipt({ paymentMode: 'link', linkJournal: 'J1', paySource: 'bank', bankAccountId: 'b1', newPaymentReason: 'x' }), { original })
  assert.equal(l.linkJournal, 'J1'); assert.equal(l.paySource, undefined); assert.equal(l.bankAccountId, undefined); assert.equal(l.newPaymentReason, undefined)
  const c = buildReceiptPayload(receipt({ paySource: 'cash', bankAccountId: 'b1' }), { original })
  assert.equal(c.bankAccountId, undefined, 'لا حساب بنكي لدفعة من الصندوق')
})

test('القراءة الآلية: «سداد مورد» بدليل مطبوع وحده، وإلا يبقى مصروفًا؛ والإيصال بلا بنود', () => {
  const noEvidence = normalizeReceiptReading({ _id: 'q', type: 'supplier_payment', amount: 80, beneficiary: 'شركة الخضار', paySource: 'bank' })
  assert.equal(noEvidence.type, 'expense'); assert.equal(noEvidence.totalAmount, 80); assert.equal(noEvidence.paySource, 'bank')
  const ok = normalizeReceiptReading({ type: 'supplier_payment', amount: 80, paymentEvidence: 'سداد فاتورة 77', items: [{}], vatAmount: 3 })
  assert.equal(ok.type, 'supplier_payment'); assert.equal(ok.items, undefined); assert.equal(ok.vatAmount, undefined); assert.equal(ok.paymentMode, 'new')
  assert.deepEqual(normalizeReceiptReading({ type: 'sales', x: 1 }), { type: 'sales', x: 1 })
})

test('الرصيد بعد السداد للعرض، وسبب عودة الإيصال بعد حذف دفعته', () => {
  assert.equal(balanceAfter('300.00', receipt()), 180)
  assert.equal(balanceAfter(300, receipt({ paymentMode: 'link' })), 300)
  assert.equal(balanceAfter(null, receipt()), null)
  assert.match(receiptHistoryNote([{ event: 'payment_deleted', journal_number: 'QD-1', by_name: 'محاسبة', at: '2026-10-20T10:00:00Z' }]), /QD-1.*محاسبة.*2026-10-20/)
  assert.equal(receiptHistoryNote([]), null)
})
