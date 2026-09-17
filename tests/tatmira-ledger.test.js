import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createInitialState, reduce, ownerDashboard, customerSummary, invoiceView, statement,
  suggestAllocations, hasMovements, duplicateInvoiceNumber, accountBalances, OPENING,
} from '../tatmira-demo/src/lib/ledger.js'
import { toHalalas } from '../tatmira-demo/src/lib/money.js'
import { normalizeWhatsapp, invoiceMessage, whatsappUrl } from '../tatmira-demo/src/lib/whatsapp.js'

const TODAY = '2026-09-17'

function run(state, action) {
  const r = reduce(state, { today: TODAY, at: '2026-09-17T10:00:00.000Z', ...action })
  return r
}
function must(state, action) {
  const r = run(state, action)
  assert.equal(r.error, undefined, `unexpected error: ${r.code} ${r.error}`)
  return r.state
}
const file = id => ({ id: `file-${id}`, name: `${id}.pdf`, type: 'application/pdf', size: 1000 })

// عميل بلا رصيد افتتاحي لعزل الأرقام
const CUST = 'cust-5'
const OTHER = 'cust-6'

function withInvoice(state, { id = 'd1', customerId = CUST, number = 'A-1', date = TODAY } = {}) {
  state = must(state, { type: 'DOC_ADD', id, kind: 'sale', file: file(id) })
  state = must(state, { type: 'DOC_UPDATE_FIELDS', id, fields: {
    customerId, number, date,
    lines: [{ id: 'l1', desc: 'معمول', qty: 20, price: toHalalas(50) }],
    vatMode: 'standard', vat: toHalalas(150),
  } })
  return must(state, { type: 'DOC_APPROVE', id })
}

function withPayment(state, { id = 'p1', customerId = CUST, amount, allocations, date = TODAY }) {
  state = must(state, { type: 'DOC_ADD', id, kind: 'payment', file: file(id) })
  state = must(state, { type: 'DOC_UPDATE_FIELDS', id, fields: {
    customerId, date, amount, accountId: 'acc-bank',
    allocations: allocations ?? suggestAllocations(state, customerId, amount),
  } })
  return run(state, { type: 'DOC_APPROVE', id })
}

test('البذرة: عشر نقاط بيع بأرقام واتساب فارغة', () => {
  const s = createInitialState({ today: TODAY })
  assert.equal(s.customers.length, 10)
  assert.deepEqual(s.customers.map(c => c.name), Array.from({ length: 10 }, (_, i) => `نقطة بيع ${i + 1}`))
  assert.ok(s.customers.every(c => c.whatsapp === ''))
})

test('فاتورة 1,150 = صافي 1,000 + ضريبة 150، واعتمادها يرفع المبيعات والرصيد لا البنك', () => {
  let s = createInitialState({ today: TODAY })
  s = withInvoice(s)
  const inv = s.invoices[0]
  assert.equal(inv.net, 100000)
  assert.equal(inv.vat, 15000)
  assert.equal(inv.total, 115000)
  const d = ownerDashboard(s)
  assert.equal(d.salesNet, 100000)
  assert.equal(d.collected, 0)
  assert.equal(customerSummary(s, CUST).balance, 115000)
  assert.ok(accountBalances(s).every(a => a.balance === 0), 'اعتماد البيع لا يغيّر النقد أو البنك')
  assert.equal(invoiceView(s, inv).payStatus, 'unpaid')
})

test('دفعة 600 تجعل المتبقي 550 والمبيعات تظل 1,000، وإكمال السداد لا يكرر الإيراد', () => {
  const baseDue = ownerDashboard(createInitialState({ today: TODAY })).due // الأرصدة الافتتاحية التجريبية
  let s = withInvoice(createInitialState({ today: TODAY }))
  let r = withPayment(s, { amount: toHalalas(600) })
  assert.equal(r.error, undefined)
  s = r.state
  let inv = invoiceView(s, s.invoices[0])
  assert.equal(inv.remaining, 55000)
  assert.equal(inv.payStatus, 'partial')
  let d = ownerDashboard(s)
  assert.equal(d.salesNet, 100000)
  assert.equal(d.salesVat, 15000)
  assert.equal(d.collected, 60000)
  assert.equal(d.due - baseDue, 55000)
  assert.equal(customerSummary(s, CUST).due, 55000)
  assert.equal(accountBalances(s).find(a => a.id === 'acc-bank').balance, 60000)

  r = withPayment(s, { id: 'p2', amount: toHalalas(550) })
  assert.equal(r.error, undefined)
  s = r.state
  inv = invoiceView(s, s.invoices[0])
  assert.equal(inv.remaining, 0)
  assert.equal(inv.payStatus, 'paid')
  d = ownerDashboard(s)
  assert.equal(d.salesNet, 100000, 'المبيعات لا تتكرر مع السداد')
  assert.equal(d.salesVat, 15000, 'الضريبة لا تتكرر مع السداد')
  assert.equal(d.collected, 115000)
  assert.equal(d.due - baseDue, 0)
  assert.equal(customerSummary(s, CUST).due, 0)
  assert.equal(s.invoices.length, 1)
})

test('المستند غير المعتمد لا يؤثر في التقارير', () => {
  let s = createInitialState({ today: TODAY })
  const before = ownerDashboard(s)
  s = must(s, { type: 'DOC_ADD', id: 'x1', kind: 'sale', file: file('x1') })
  s = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'x1', fields: { customerId: CUST } })
  s = must(s, { type: 'DOC_ADD', id: 'x2', kind: 'payment', file: file('x2') })
  s = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'x2', fields: { customerId: CUST, amount: 50000 } })
  s = must(s, { type: 'DOC_ADD', id: 'x3', kind: 'purchase', file: file('x3') })
  s = must(s, { type: 'DOC_ADD', id: 'x4', kind: 'purchase', file: file('x4') })
  s = must(s, { type: 'DOC_REJECT', id: 'x4' })
  const after = ownerDashboard(s)
  for (const k of ['salesNet', 'salesVat', 'collected', 'due', 'credit', 'direct', 'operating', 'estimatedProfit']) {
    assert.equal(after[k], before[k], k)
  }
  assert.equal(after.pendingDocs, 3)
  assert.equal(customerSummary(s, CUST).balance, 0)
  assert.equal(statement(s, CUST).rows.length, 0)
})

test('تكرار الضغط لا يكرر الفاتورة أو السداد أو إضافة المستند', () => {
  let s = withInvoice(createInitialState({ today: TODAY }))
  const again = run(s, { type: 'DOC_APPROVE', id: 'd1' })
  assert.equal(again.code, 'ALREADY_APPROVED')
  assert.equal(again.state.invoices.length, 1)

  s = withPayment(s, { amount: 60000 }).state
  const payAgain = run(s, { type: 'DOC_APPROVE', id: 'p1' })
  assert.equal(payAgain.state.payments.length, 1)
  assert.equal(ownerDashboard(payAgain.state).collected, 60000)

  const addAgain = run(s, { type: 'DOC_ADD', id: 'p1', kind: 'payment', file: file('p1') })
  assert.equal(addAgain.state.documents.length, s.documents.length)
})

test('لا يمكن توزيع دفعة على فاتورة عميل آخر', () => {
  let s = withInvoice(createInitialState({ today: TODAY }), { customerId: OTHER, number: 'O-1' })
  const otherInvoice = s.invoices[0].id
  const r = withPayment(s, { customerId: CUST, amount: 10000, allocations: [{ target: otherInvoice, amount: 10000 }] })
  assert.equal(r.code, 'ALLOCATION_OTHER_CUSTOMER')
  assert.equal(r.state.payments.length, 0)
  assert.equal(invoiceView(r.state, r.state.invoices[0]).remaining, 115000)
  assert.equal(suggestAllocations(s, CUST, 10000).length, 0, 'الاقتراح لا يعرض فواتير عميل آخر')
})

test('الدفعة الموزعة على عدة فواتير، والزائد يبقى رصيداً دائناً لا فاتورة سالبة', () => {
  let s = createInitialState({ today: TODAY })
  s = withInvoice(s, { id: 'a', number: 'A-1', date: '2026-09-01' })
  s = withInvoice(s, { id: 'b', number: 'A-2', date: '2026-09-10' })
  const suggested = suggestAllocations(s, CUST, toHalalas(1500))
  assert.deepEqual(suggested.map(a => a.amount), [115000, 35000], 'الاقتراح على الأقدم أولاً')

  // المستخدم يعدّل التوزيع قبل الاعتماد
  const r = withPayment(s, { amount: toHalalas(2500), allocations: [
    { target: 'inv-a', amount: 115000 }, { target: 'inv-b', amount: 115000 },
  ] })
  assert.equal(r.error, undefined)
  s = r.state
  assert.equal(s.payments[0].unallocated, 20000)
  assert.ok(s.invoices.every(i => invoiceView(s, i).remaining === 0))
  const sum = customerSummary(s, CUST)
  assert.equal(sum.balance, -20000)
  assert.equal(sum.credit, 20000)
  assert.equal(sum.due, 0)
  assert.equal(ownerDashboard(s).credit, 20000)

  const over = withPayment(s, { id: 'p9', amount: 1000, allocations: [{ target: 'inv-a', amount: 1000 }] })
  assert.equal(over.code, 'ALLOCATION_CLOSED', 'لا توزيع على فاتورة مسددة')
})

test('التوزيع لا يتجاوز المتبقي ولا مبلغ الدفعة', () => {
  let s = withInvoice(createInitialState({ today: TODAY }))
  assert.equal(withPayment(s, { amount: 200000, allocations: [{ target: 'inv-d1', amount: 120000 }] }).code, 'ALLOCATION_EXCEEDS')
  assert.equal(withPayment(s, { amount: 10000, allocations: [{ target: 'inv-d1', amount: 20000 }] }).code, 'ALLOCATION_OVER_AMOUNT')
})

test('السداد يحتاج مستنداً وحساباً مستلماً', () => {
  const s = createInitialState({ today: TODAY })
  assert.equal(run(s, { type: 'DOC_ADD', id: 'n', kind: 'payment' }).code, 'FILE_REQUIRED')
  let t = must(s, { type: 'DOC_ADD', id: 'n', kind: 'payment', file: file('n') })
  t = must(t, { type: 'DOC_UPDATE_FIELDS', id: 'n', fields: { customerId: CUST, amount: 1000, accountId: '' } })
  assert.equal(run(t, { type: 'DOC_APPROVE', id: 'n' }).code, 'ACCOUNT_REQUIRED')
})

test('تنبيه تكرار رقم الفاتورة ويحتاج تأكيداً صريحاً', () => {
  let s = withInvoice(createInitialState({ today: TODAY }), { number: 'INV-7' })
  s = must(s, { type: 'DOC_ADD', id: 'dup', kind: 'sale', file: file('dup') })
  s = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'dup', fields: { customerId: CUST, number: ' inv-7 ' } })
  assert.equal(duplicateInvoiceNumber(s, 'inv-7', { excludeDocId: 'dup' }).where, 'approved')
  assert.equal(run(s, { type: 'DOC_APPROVE', id: 'dup' }).code, 'DUPLICATE_NUMBER')
  const confirmed = run(s, { type: 'DOC_APPROVE', id: 'dup', confirmDuplicate: true })
  assert.equal(confirmed.error, undefined)
  assert.equal(confirmed.state.invoices.length, 2)
})

test('فاتورة بلا ضريبة تُحتسب صافياً كاملاً', () => {
  let s = createInitialState({ today: TODAY })
  s = must(s, { type: 'DOC_ADD', id: 'nv', kind: 'sale', file: file('nv') })
  s = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'nv', fields: { customerId: CUST, vatMode: 'none', vat: 99999 } })
  s = must(s, { type: 'DOC_APPROVE', id: 'nv' })
  assert.equal(s.invoices[0].vat, 0)
  assert.equal(s.invoices[0].total, s.invoices[0].net)
  assert.equal(ownerDashboard(s).invoicesWithoutVat, 1)
})

test('كشف الحساب: رصيد افتتاحي ليس مبيعات، ورصيد سابق للفترة، ورصيد بعد كل حركة', () => {
  let s = createInitialState({ today: TODAY })
  const c1 = 'cust-1' // رصيده الافتتاحي 2,500 بتاريخ 2026-08-01
  s = withInvoice(s, { id: 'e', customerId: c1, number: 'S-1', date: '2026-08-20' })
  s = withPayment(s, { id: 'q', customerId: c1, amount: 100000, date: '2026-09-05' }).state
  s = withInvoice(s, { id: 'f', customerId: c1, number: 'S-2', date: '2026-09-12' })

  assert.equal(ownerDashboard(s).salesNet, 200000, 'الافتتاحي لا يدخل المبيعات')

  const all = statement(s, c1)
  assert.deepEqual(all.rows.map(r => r.kind), ['opening', 'invoice', 'payment', 'invoice'])
  assert.deepEqual(all.rows.map(r => r.balance), [250000, 365000, 265000, 380000])
  assert.equal(all.closing, customerSummary(s, c1).balance)

  const sep = statement(s, c1, { from: '2026-09-01', to: '2026-09-30' })
  assert.equal(sep.prior, 365000)
  assert.deepEqual(sep.rows.map(r => r.balance), [265000, 380000])
  assert.equal(sep.closing, 380000)

  // اقتراح التوزيع يبدأ بالافتتاحي (الأقدم)
  assert.equal(s.payments[0].allocations[0].target, OPENING)
})

test('العملاء: إضافة وتعديل واتساب وأرشفة، ولا حذف لمن لديه حركات', () => {
  let s = createInitialState({ today: TODAY })
  s = must(s, { type: 'CUSTOMER_ADD', id: 'new', name: 'نقطة بيع 11', whatsapp: '' })
  assert.equal(run(s, { type: 'CUSTOMER_ADD', id: 'new', name: 'نقطة بيع 11' }).state.customers.length, 11, 'ضغط مكرر')
  s = must(s, { type: 'CUSTOMER_UPDATE', id: 'new', whatsapp: '0551234567' })
  assert.equal(s.customers.find(c => c.id === 'new').whatsapp, '966551234567')
  assert.equal(run(s, { type: 'CUSTOMER_UPDATE', id: 'new', whatsapp: '12' }).code, 'BAD_WHATSAPP')
  s = must(s, { type: 'CUSTOMER_UPDATE', id: 'new', name: 'نقطة العليا' })
  s = must(s, { type: 'CUSTOMER_ARCHIVE', id: 'new', archived: true })
  assert.equal(s.customers.find(c => c.id === 'new').archived, true)

  s = withInvoice(s)
  assert.equal(hasMovements(s, CUST), true)
  assert.equal(run(s, { type: 'CUSTOMER_DELETE', id: CUST }).code, 'HAS_MOVEMENTS')
  assert.equal(run(s, { type: 'CUSTOMER_DELETE', id: 'cust-1' }).code, 'HAS_MOVEMENTS', 'الرصيد الافتتاحي حركة')
  const del = run(s, { type: 'CUSTOMER_DELETE', id: 'new' })
  assert.equal(del.error, undefined)
  assert.equal(del.state.customers.some(c => c.id === 'new'), false)
})

test('المشتريات مدفوعة مباشرة: تخفض الحساب وتُفصل مواد مباشرة عن تشغيلية، والربحية تقديرية', () => {
  let s = withInvoice(createInitialState({ today: TODAY }))
  s = must(s, { type: 'DOC_ADD', id: 'm', kind: 'purchase', file: file('m') })
  s = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'm', fields: { categoryId: 'cat-dates', net: 30000, vat: 4500, accountId: 'acc-cash' } })
  s = must(s, { type: 'DOC_APPROVE', id: 'm' })
  s = must(s, { type: 'DOC_ADD', id: 'o', kind: 'purchase', file: file('o') })
  s = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'o', fields: { categoryId: 'cat-power', net: 10000, vat: 0, accountId: 'acc-bank' } })
  s = must(s, { type: 'DOC_APPROVE', id: 'o' })
  const d = ownerDashboard(s)
  assert.equal(d.direct, 30000)
  assert.equal(d.operating, 10000)
  assert.equal(d.inputVat, 4500)
  assert.equal(d.estimatedProfit, 100000 - 30000 - 10000)
  assert.equal(d.accounts.find(a => a.id === 'acc-cash').balance, -34500)
})

test('واتساب: لا أرقام عشوائية، ورسالة تشمل الرقم والتاريخ والإجمالي', () => {
  assert.equal(normalizeWhatsapp(''), '')
  assert.equal(normalizeWhatsapp('+966 55 123 4567'), '966551234567')
  assert.equal(normalizeWhatsapp('٠٥٥١٢٣٤٥٦٧'), '966551234567')
  assert.equal(normalizeWhatsapp('0123'), null)
  const text = invoiceMessage({ labName: 'معمل تتميرا', customerName: 'نقطة بيع 1', invoice: { number: 'A-1', date: TODAY, total: 115000 } })
  assert.match(text, /A-1/)
  assert.match(text, /2026-09-17/)
  assert.match(text, /1,150\.00/)
  assert.match(text, /نموذج تجريبي — ليس فاتورة ضريبية/)
  assert.ok(whatsappUrl('966551234567', text).startsWith('https://wa.me/966551234567?text='))
})
