import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyPaymentLabel, normalizeSalesReading, resolveUnknownPayment, salesReportCheck } from '../src/lib/salesReport.js'
import { buildInvoicePayload } from '../src/lib/approvalV2.js'

// Synthetic POS report, not customer figures. A payment-summary Bank row is card revenue;
// an explicitly named Bank Transfer must retain its separate transfer channel.
const reading = {
  type: 'sales', date: '2026-01-05',
  paymentLines: [{ label: 'بنك - Bank', amount: '624.75' }, { label: 'كاش - Cash', amount: 125.25 }],
  returnLines: [], reportNetTotal: 750,
}

test('POS Bank payment labels map to network, including bilingual labels', () => {
  for (const label of ['Bank', 'BANK', 'بنك', 'البنك', 'بنك - Bank', 'Bank / بنك', 'بَنْك — Bank', 'Bank Card', 'مدى Bank']) {
    assert.equal(classifyPaymentLabel(label), 'network', label)
  }
})

test('an explicit bank transfer remains transfer; mixed or unfamiliar bank labels still require review', () => {
  for (const label of ['Bank Transfer', 'تحويل بنك', 'تحويل بنكي - Bank Transfer']) {
    assert.equal(classifyPaymentLabel(label), 'transfer', label)
  }
  for (const label of ['Bank Cash', 'بنك نقدي', 'Bank Jahez', 'Bank Deposit', 'Bank Card Transfer', 'بنك غير معروف', 'Refund Bank']) {
    assert.equal(classifyPaymentLabel(label), null, label)
  }
})

test('new reading retains printed total and sends the bank row as network with its chosen account', () => {
  const before = structuredClone(reading)
  const invoice = normalizeSalesReading(reading)
  assert.equal(invoice.networkSales, 624.75)
  assert.equal(invoice.cashSales, 125.25)
  assert.equal(invoice.transferSales, 0)
  assert.equal(invoice.totalSales, 750)
  assert.deepEqual(invoice.unknownPayments, [])
  assert.equal(salesReportCheck(invoice).diff, 0)
  assert.equal(salesReportCheck(invoice).ok, true)
  const payload = buildInvoicePayload({ ...invoice, bankAccounts: { network: 'chosen-bank' } }, { original: reading })
  assert.equal(payload.networkSales, 624.75)
  assert.equal(payload.bankAccounts.network, 'chosen-bank')
  assert.deepEqual(reading, before)
})

test('Bank returns reduce the card channel exactly once, with transfer returns kept separate', () => {
  const invoice = normalizeSalesReading({ ...reading,
    paymentLines: [...reading.paymentLines, { label: 'Bank Transfer', amount: 50 }],
    returnLines: [{ label: 'مرتجع بنك - Bank', amount: 20 }, { label: 'Bank Transfer Refund', amount: 5 }],
    reportNetTotal: 775,
  })
  assert.equal(invoice.networkSales, 604.75)
  assert.equal(invoice.transferSales, 45)
  assert.equal(salesReportCheck(invoice).ok, true)
  assert.deepEqual(normalizeSalesReading(invoice), invoice)
})

test('recognising Bank does not bypass a missing amount, missing printed total or genuine mismatch', () => {
  const missingAmount = normalizeSalesReading({ ...reading, paymentLines: [{ label: 'بنك - Bank', amount: null }] })
  assert.equal(missingAmount.unknownPayments[0].unreadable, true)
  assert.equal(salesReportCheck(missingAmount).ok, false)
  assert.equal(salesReportCheck(normalizeSalesReading({ ...reading, reportNetTotal: null })).ok, false)
  const mismatch = salesReportCheck(normalizeSalesReading({ ...reading, reportNetTotal: 751 }))
  assert.equal(mismatch.ok, false)
  assert.equal(mismatch.diff, -1)
})

test('previously saved unknown Bank can be assigned once, without overwriting the original reading', () => {
  const saved = { type: 'sales', salesReadingVersion: 2, cashSales: 125.25, networkSales: 0,
    totalSales: 750, unknownPayments: [{ label: 'بنك - Bank', amount: '624.75', kind: 'payment' }] }
  const before = structuredClone(saved)
  assert.equal(salesReportCheck(saved).ok, false)
  const reviewed = resolveUnknownPayment(saved, 0, 'network')
  assert.equal(reviewed.networkSales, 624.75)
  assert.equal(salesReportCheck(reviewed).ok, true)
  assert.deepEqual(resolveUnknownPayment(reviewed, 0, 'network'), reviewed)
  assert.equal(reviewed.resolvedPayments[0].channel, 'network')
  assert.deepEqual(saved, before)
})
