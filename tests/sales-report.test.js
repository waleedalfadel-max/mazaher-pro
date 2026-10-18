// قراءة تقرير المبيعات (src/lib/salesReport.js): أسطر وسائل دفع مصطنعة بصيغ «توصيل» وتحويل ومرتجعات (أرقام وهمية).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyPaymentLabel, normalizeSalesReading, salesReportCheck, resolveUnknownPayment } from '../src/lib/salesReport.js'

// قبل المرتجعات: نقدي 120.00، شبكة 1,500.40، تحويل 9.00، هنقرستيشن 410.25، جاهز 150.00، مرسول 22.00 = 2,211.65
// المرتجعات: نقدي 7.25، شبكة 20.00 ⇒ الصافي 2,184.40
const READING = {
  type: 'sales', date: '2026-01-15',
  paymentLines: [
    { label: 'كاش', amount: 100 }, { label: 'كاش توصيل', amount: 12 }, { label: 'توصيل كاش', amount: 8 },
    { label: 'مدى', amount: '1,300.40' }, { label: 'مدى توصيل', amount: 150 }, { label: 'توصيل مدى', amount: 50 },
    { label: 'تحويل', amount: 9 }, { label: 'هنقرستيشن', amount: 410.25 }, { label: 'جاهز', amount: 150 }, { label: 'مرسول', amount: 22 },
    { label: 'توصيل', amount: 0 },
  ],
  returnLines: [{ label: 'مرتجع كاش', amount: 7.25 }, { label: 'مرتجع مدى', amount: 20 }],
  reportGrossTotal: 2211.65,
  // ما يكتبه المزوّد في الحقول القديمة (التحويل ساقط) يُستبدل بالحساب من الأسطر
  cashSales: 100, networkSales: 1300.4, transferSales: 0, totalSales: 2202.65,
}

test('«كاش توصيل» و«توصيل كاش» نقدي، و«مدى توصيل» و«توصيل مدى» شبكة، و«توصيل» وحدها ليست قناة', () => {
  for (const l of ['كاش', 'كاش توصيل', 'توصيل كاش', 'نقدي', 'الكاش', 'Cash']) assert.equal(classifyPaymentLabel(l), 'cash', l)
  for (const l of ['مدى', 'مدى توصيل', 'توصيل مدى', 'شبكة', 'mada', 'بطاقة مدى']) assert.equal(classifyPaymentLabel(l), 'network', l)
  for (const l of ['تحويل', 'تحويل بنكي', 'Transfer']) assert.equal(classifyPaymentLabel(l), 'transfer', l)
  assert.equal(classifyPaymentLabel('هنقرستيشن'), 'hunger'); assert.equal(classifyPaymentLabel('هنقر ستيشن'), 'hunger')
  assert.equal(classifyPaymentLabel('جاهز'), 'jahez'); assert.equal(classifyPaymentLabel('مرسول'), 'mrsool'); assert.equal(classifyPaymentLabel('كيتا'), 'keeta')
  assert.equal(classifyPaymentLabel('توصيل'), null)            // لا دليل على تطبيق
  assert.equal(classifyPaymentLabel('أبل باي'), null)          // غير معروفة ⇒ مراجعة
  assert.equal(classifyPaymentLabel('كاش مدى'), null)          // قناتان ⇒ مراجعة
  assert.equal(classifyPaymentLabel('مرتجع كاش'), null)        // مرتجع في أسطر الدفع ⇒ مراجعة
  assert.equal(classifyPaymentLabel('مرتجع كاش', { returns: true }), 'cash')
})

test('القنوات قبل المرتجعات، والتحويل الصغير لا يسقط، والمرتجعات تُخصم مرة واحدة', () => {
  const r = normalizeSalesReading(READING)
  const b = r.salesBreakdown
  assert.deepEqual(b.gross, { cash: 120, network: 1500.4, transfer: 9, hunger: 410.25, jahez: 150, keeta: 0, mrsool: 22 })
  assert.equal(b.grossTotal, 2211.65)
  assert.deepEqual(b.returns, { cash: 7.25, network: 20, transfer: 0, hunger: 0, jahez: 0, keeta: 0, mrsool: 0 })
  assert.equal(b.returnsTotal, 27.25)
  // المسجّل: الصافي في كل قناة (ما دخل الصندوق والحساب فعلًا)
  assert.equal(r.cashSales, 112.75); assert.equal(r.networkSales, 1480.4); assert.equal(r.transferSales, 9)
  assert.equal(r.hungerSales, 410.25); assert.equal(r.jahez, 150); assert.equal(r.mrsool, 22); assert.equal(r.keeta, 0)
  assert.equal(r.totalSales, 2184.4)                          // المطبوع قبل المرتجعات − المرتجعات
  assert.deepEqual(r.unknownPayments, [])
  const c = salesReportCheck(r)
  assert.equal(c.ok, true, c.reasons.join(' | ')); assert.equal(c.channels, 2184.4); assert.equal(c.diff, 0)
  // ثبات: إعادة التطبيع لا تخصم المرتجع مرة ثانية
  const again = normalizeSalesReading(r)
  assert.equal(again.cashSales, 112.75); assert.equal(again.totalSales, 2184.4)
})

test('الإجمالي الصافي المطبوع يُقدَّم على حساب الإجمالي قبل المرتجعات', () => {
  const r = normalizeSalesReading({ ...READING, reportGrossTotal: undefined, reportNetTotal: '2,184.40' })
  assert.equal(r.totalSales, 2184.4); assert.equal(salesReportCheck(r).ok, true)
})

test('بلا إجمالي مطبوع: لا totalSales (لا يُخترع)، والفحص لا يدّعي المطابقة', () => {
  const r = normalizeSalesReading({ ...READING, reportGrossTotal: undefined })
  assert.equal('totalSales' in r, false)
  const c = salesReportCheck(r); assert.equal(c.total, null); assert.equal(c.diff, null)
  // مراجعة a2f72ca: القراءة الجديدة بلا إجمالي مستقل لا تُعتمد (كان ok: true)
  assert.equal(r.salesReadingVersion, 2)
  assert.equal(c.ok, false); assert.match(c.reasons.join(' '), /إجمالي التقرير المطبوع/)
  // إدخال الإجمالي من التقرير يدويًا: يُطابق
  assert.equal(salesReportCheck({ ...r, totalSales: '2184.40' }).ok, true)
  assert.equal(salesReportCheck({ ...r, totalSales: '2184.50' }).ok, false)
  assert.equal(salesReportCheck({ ...r, totalSales: 'abc' }).ok, false)
})

test('مراجعة a2f72ca: سطر وسيلة دفع بمبلغ null لا يُحذف بصمت ويمنع الاعتماد حتى يُكتب مبلغه أو يُستبعد بسبب', () => {
  const r = normalizeSalesReading({ ...READING, paymentLines: [...READING.paymentLines, { label: 'شبكة توصيل', amount: null }] })
  assert.equal(r.salesBreakdown.unreadable, 1)
  assert.deepEqual(r.unknownPayments, [{ label: 'شبكة توصيل', amount: null, kind: 'payment', unreadable: true }])
  const c = salesReportCheck(r)
  assert.equal(c.ok, false); assert.match(c.reasons[0], /بلا مبلغ مقروء: «شبكة توصيل» \(وسيلة دفع\)/)
  // النسبة بلا مبلغ صالح لا تغيّر شيئًا؛ وبمبلغه من التقرير تُضاف إلى القناة
  assert.equal(resolveUnknownPayment(r, 0, 'network'), r)
  assert.equal(resolveUnknownPayment(r, 0, 'network', '', '0'), r)
  const fixed = resolveUnknownPayment(r, 0, 'network', '', '5.00')
  assert.equal(fixed.networkSales, 1485.4); assert.deepEqual(fixed.unknownPayments, [])
  assert.deepEqual(fixed.resolvedPayments, [{ label: 'شبكة توصيل', amount: '5.00', kind: 'payment', channel: 'network', unreadable: true }])
  assert.equal(salesReportCheck({ ...fixed, totalSales: 2189.4 }).ok, true)
  // الاستبعاد بلا سبب لا يُقبل؛ وبسبب موثّق يُسجَّل
  assert.equal(resolveUnknownPayment(r, 0, null, '  '), r)
  const excluded = resolveUnknownPayment(r, 0, null, 'سطر عنوان لا مبلغ له')
  assert.deepEqual(excluded.resolvedPayments, [{ label: 'شبكة توصيل', amount: null, kind: 'payment', channel: null, unreadable: true, reason: 'سطر عنوان لا مبلغ له' }])
  assert.equal(salesReportCheck(excluded).ok, true)
  // سجل استبعاد بلا سبب (من عميل لا يمر بالدالة) يمنع
  assert.equal(salesReportCheck({ ...excluded, resolvedPayments: [{ label: 'x', channel: null, reason: '' }] }).ok, false)
})

test('مراجعة a2f72ca: سطر مرتجع بمبلغ null يبقى للمراجعة، ولا يُحسب الإجمالي من «قبل المرتجعات» حتى يُعرف', () => {
  const r = normalizeSalesReading({ ...READING, returnLines: [...READING.returnLines, { label: 'مرتجع جاهز', amount: null }] })
  assert.equal(r.salesBreakdown.unreadable, 1)
  assert.deepEqual(r.unknownPayments, [{ label: 'مرتجع جاهز', amount: null, kind: 'return', unreadable: true }])
  assert.equal('totalSales' in r, false)                    // المرتجعات غير مكتملة ⇒ لا إجمالي محسوب
  const c = salesReportCheck(r)
  assert.equal(c.ok, false); assert.match(c.reasons.join(' '), /«مرتجع جاهز» \(مرتجع\)/); assert.match(c.reasons.join(' '), /إجمالي التقرير المطبوع/)
  const fixed = resolveUnknownPayment(r, 0, 'jahez', '', 30)   // يُطرح من جاهز
  assert.equal(fixed.jahez, 120)
  assert.equal(salesReportCheck({ ...fixed, totalSales: 2154.4 }).ok, true)
})

test('توافق المستندات القديمة: قراءة بلا أسطر (بلا salesReadingVersion) وبلا إجمالي تبقى كما كانت', () => {
  const old = { type: 'sales', cashSales: 10, networkSales: 5 }
  assert.equal(salesReportCheck(old).ok, true)
  assert.equal(salesReportCheck({ ...old, totalSales: 16 }).ok, false)   // والفرق إن وُجد إجمالي يمنع كما كان
})

test('وسيلة غير معروفة بمبلغ غير صفري لا تُهمل: تمنع الاعتماد حتى تُنسب أو تُستبعد بسبب', () => {
  const r = normalizeSalesReading({ ...READING, paymentLines: [...READING.paymentLines, { label: 'أبل باي', amount: 12 }], reportGrossTotal: 2223.65 })
  assert.deepEqual(r.unknownPayments, [{ label: 'أبل باي', amount: '12.00', kind: 'payment' }])
  const c = salesReportCheck(r)
  assert.equal(c.ok, false); assert.match(c.reasons[0], /أبل باي/); assert.equal(c.diff, -12)   // والإجمالي لا يطابق ما دامت خارج القنوات
  const fixed = resolveUnknownPayment(r, 0, 'network')
  assert.equal(fixed.networkSales, 1492.4); assert.deepEqual(fixed.unknownPayments, [])
  assert.deepEqual(fixed.resolvedPayments, [{ label: 'أبل باي', amount: '12.00', kind: 'payment', channel: 'network' }])
  assert.equal(salesReportCheck(fixed).ok, true)
  // الاستبعاد يُسجَّل بسببه، والفرق مع الإجمالي يبقى مانعًا إن كان المبلغ ضمنه
  const excluded = resolveUnknownPayment(r, 0, null, 'سطر عدد طلبات لا مبلغ')
  assert.equal(excluded.resolvedPayments[0].reason, 'سطر عدد طلبات لا مبلغ')
  assert.equal(salesReportCheck(excluded).ok, false)
})

test('فرق غير مفسّر بين وسائل الدفع والإجمالي يمنع الاعتماد، ومرتجع أكبر من قناته يُكشف', () => {
  const r = normalizeSalesReading({ ...READING, reportGrossTotal: 2213.65 })
  const c = salesReportCheck(r); assert.equal(c.ok, false); assert.equal(c.diff, -2)
  const neg = normalizeSalesReading({ ...READING, returnLines: [{ label: 'مرتجع تحويل', amount: 13 }] })
  assert.equal(neg.transferSales, -4)
  assert.match(salesReportCheck(neg).reasons.join(' '), /مرتجعات تحويل أكبر/)
})

test('مرتجع بوسيلة غير معروفة يبقى للمراجعة ولا يُخصم بصمت', () => {
  const r = normalizeSalesReading({ ...READING, returnLines: [{ label: 'مرتجع', amount: 10 }] })
  assert.deepEqual(r.unknownPayments, [{ label: 'مرتجع', amount: '-10.00', kind: 'return' }])
  assert.equal(r.cashSales, 120)                              // لم يُخصم من أي قناة
  assert.equal(r.totalSales, 2201.65)                         // المطبوع − كل المرتجعات
  assert.equal(salesReportCheck(resolveUnknownPayment(r, 0, 'cash')).ok, true)
})

test('قراءة قديمة بلا أسطر وسائل الدفع تبقى كما هي', () => {
  const old = { type: 'sales', cashSales: 10, networkSales: 5, totalSales: 15 }
  assert.equal(normalizeSalesReading(old), old)
  assert.equal(salesReportCheck(old).ok, true)
})
