import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createInitialState, reduce, ownerDashboard, customerSummary, invoiceView, statement,
  suggestAllocations, hasMovements, duplicateInvoiceNumber, accountBalances, OPENING,
  availableCredit, migrate, invalidInputs,
} from '../tatmira-demo/src/lib/ledger.js'
import {
  toHalalas, toQuantity, moneyFieldValue, quantityFieldValue, isValidMoneyField, isValidQuantityField,
} from '../tatmira-demo/src/lib/money.js'
import { normalizeWhatsapp, invoiceMessage, whatsappUrl } from '../tatmira-demo/src/lib/whatsapp.js'
import { INITIAL_EFFECTIVE_FROM } from '../tatmira-demo/src/lib/tax.js'

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

function withTax(state, mode = 'exclusive', { effectiveFrom = INITIAL_EFFECTIVE_FROM, rateBps = 1500 } = {}) {
  return must(state, { type: 'TAX_SETTING_SAVE', mode, rateBps, vatNumber: 'DEMO', effectiveFrom })
}

function withInvoice(state, { id = 'd1', customerId = CUST, number = 'A-1', date = TODAY } = {}) {
  state = withTax(state, 'exclusive')
  state = must(state, { type: 'DOC_ADD', id, kind: 'sale', file: file(id) })
  state = must(state, { type: 'DOC_UPDATE_FIELDS', id, fields: {
    customerId, number, date,
    lines: [{ id: 'l1', desc: 'معمول', qty: 20, price: toHalalas(50) }],
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
  assert.equal(s.taxSettings[0].mode, 'disabled', 'تتميرا تبدأ بدون ضريبة')
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
  s = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'nv', fields: { customerId: CUST } })
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
  s = must(s, { type: 'CUSTOMER_UPDATE', id: 'new', whatsapp: '0500000001' })
  assert.equal(s.customers.find(c => c.id === 'new').whatsapp, '966500000001')
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
  s = withTax(s, 'exclusive')
  s = must(s, { type: 'DOC_ADD', id: 'm', kind: 'purchase', file: file('m') })
  s = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'm', fields: { accountId: 'acc-cash', lines: [{ categoryId: 'cat-dates', net: 30000, vat: 4500 }] } })
  s = must(s, { type: 'DOC_APPROVE', id: 'm' })
  s = must(s, { type: 'DOC_ADD', id: 'o', kind: 'purchase', file: file('o') })
  s = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'o', fields: { accountId: 'acc-bank', lines: [{ categoryId: 'cat-power', net: 10000, vat: 0 }] } })
  s = must(s, { type: 'DOC_APPROVE', id: 'o' })
  const d = ownerDashboard(s)
  assert.equal(d.direct, 30000)
  assert.equal(d.operating, 10000)
  assert.equal(d.inputVat, 4500)
  assert.equal(d.estimatedProfit, 100000 - 30000 - 10000)
  assert.equal(d.accounts.find(a => a.id === 'acc-cash').balance, -34500)
})

// ── ملاحظات المراجعة ──────────────────────────────────────────────────────

test('فاتورة مشتريات واحدة تجمع مواد مباشرة ومصروفات تشغيلية بتصنيف لكل بند', () => {
  let s = createInitialState({ today: TODAY })
  s = withTax(s, 'exclusive')
  s = must(s, { type: 'DOC_ADD', id: 'mix', kind: 'purchase', file: file('mix') })
  s = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'mix', fields: { accountId: 'acc-bank', lines: [
    { desc: 'تمور', categoryId: 'cat-dates', net: 40000, vat: 6000 },
    { desc: 'تغليف', categoryId: 'cat-pack', net: 10000, vat: 1500 },
    { desc: 'توصيل', categoryId: 'cat-deliver', net: 5000, vat: 0 },
  ] } })
  s = must(s, { type: 'DOC_APPROVE', id: 'mix' })
  const p = s.purchases[0]
  assert.equal(p.lines.length, 3)
  assert.equal(p.total, 62500)
  const d = ownerDashboard(s)
  assert.equal(d.direct, 50000)
  assert.equal(d.operating, 5000)
  assert.equal(d.inputVat, 7500)
  assert.equal(d.accounts.find(a => a.id === 'acc-bank').balance, -62500, 'الحساب يُخصم بإجمالي الفاتورة مرة واحدة')

  const bad = run(must(createInitialState({ today: TODAY }), { type: 'DOC_ADD', id: 'b', kind: 'purchase', file: file('b') }),
    { type: 'DOC_APPROVE', id: 'b', })
  assert.equal(bad.error, undefined, 'البيانات التجريبية الافتراضية صالحة للاعتماد')
  let t = must(createInitialState({ today: TODAY }), { type: 'DOC_ADD', id: 'c', kind: 'purchase', file: file('c') })
  t = must(t, { type: 'DOC_UPDATE_FIELDS', id: 'c', fields: { lines: [{ desc: 'بلا تصنيف', categoryId: '', net: 1000, vat: 0 }] } })
  assert.equal(run(t, { type: 'DOC_APPROVE', id: 'c' }).code, 'CATEGORY_REQUIRED')
})

test('نوع التصنيف يُثبَّت وقت الاعتماد: تعديل الإعدادات أو أرشفتها لا يغيّر التقارير السابقة', () => {
  let s = createInitialState({ today: TODAY })
  s = must(s, { type: 'DOC_ADD', id: 'k', kind: 'purchase', file: file('k') })
  s = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'k', fields: { accountId: 'acc-bank', lines: [{ desc: 'تمور', categoryId: 'cat-dates', net: 20000, vat: 0 }] } })
  s = must(s, { type: 'DOC_APPROVE', id: 'k' })
  const before = ownerDashboard(s)
  assert.equal(before.direct, 20000)

  // نقل التصنيف لمجموعة تشغيلية، وتغيير نوع مجموعته الأصلية، ثم أرشفته
  s = must(s, { type: 'CATEGORY_SAVE', id: 'cat-dates', name: 'تمور (معدّل)', groupId: 'grp-other' })
  s = must(s, { type: 'GROUP_SAVE', id: 'grp-direct', name: 'المواد المباشرة', kind: 'operating' })
  s = must(s, { type: 'CATEGORY_ARCHIVE', id: 'cat-dates', archived: true })
  const after = ownerDashboard(s)
  assert.equal(after.direct, 20000, 'بقيت مواد مباشرة')
  assert.equal(after.operating, 0)
  assert.equal(s.purchases[0].lines[0].categoryName, 'تمور')
  assert.equal(s.purchases[0].lines[0].categoryKind, 'direct')
  assert.equal(s.purchases[0].lines[0].groupId, 'grp-direct')
})

test('ترقية بيانات الجهاز القديمة: مشتريات بتصنيف واحد تتحول لبند مثبّت النوع', () => {
  const v1 = {
    version: 1,
    lab: { name: 'معمل تتميرا' },
    customers: createInitialState({ today: TODAY }).customers,
    accounts: createInitialState({ today: TODAY }).accounts,
    categories: [
      { id: 'cat-dates', name: 'تمور', kind: 'direct', archived: false },
      { id: 'cat-power', name: 'كهرباء وماء', kind: 'operating', archived: false },
    ],
    invoices: [], payments: [], counters: { sample: 1, approved: 1 },
    purchases: [{ id: 'pur-old', docId: 'old', supplier: 'مورد', number: '', date: TODAY, categoryId: 'cat-power', description: 'كهرباء', net: 10000, vat: 1500, total: 11500, accountId: 'acc-bank', approvedSeq: 1 }],
    documents: [{ id: 'pend', kind: 'purchase', status: 'pending', file: file('pend'), fields: { supplier: 'x', date: TODAY, categoryId: 'cat-dates', description: 'تمر', net: 500, vat: 75, accountId: 'acc-bank' } }],
  }
  const s = migrate(v1, TODAY)
  assert.equal(s.version, 4)
  assert.deepEqual(s.creditApplications, [])
  assert.equal(s.purchases[0].lines[0].categoryKind, 'operating')
  assert.equal(s.purchases[0].lines[0].groupId, 'grp-utilities')
  assert.equal(s.purchases[0].payee, 'مورد')
  assert.equal(ownerDashboard(s).operating, 10000)
  assert.equal(s.documents[0].fields.lines[0].categoryId, 'cat-dates')
  assert.equal(s.documents[0].fields.categoryId, undefined)
  assert.equal(s.documents[0].fields.payee, 'x')
})

test('استخدام الرصيد المتاح يسوّي فاتورة لاحقة دون إيراد أو تحصيل جديد، ولا يتكرر', () => {
  let s = withInvoice(createInitialState({ today: TODAY }), { id: 'i1', number: 'C-1', date: '2026-09-01' })
  s = withPayment(s, { id: 'pp', amount: toHalalas(1300), date: '2026-09-02' }).state // زائد 150
  assert.equal(availableCredit(s, CUST), 15000)
  s = withInvoice(s, { id: 'i2', number: 'C-2', date: '2026-09-10' })
  const inv2 = () => invoiceView(s, s.invoices.find(i => i.number === 'C-2'))
  assert.equal(inv2().remaining, 115000)

  const before = ownerDashboard(s)
  const bankBefore = accountBalances(s).find(a => a.id === 'acc-bank').balance
  const balanceBefore = customerSummary(s, CUST).balance
  const allocations = suggestAllocations(s, CUST, availableCredit(s, CUST))
  assert.deepEqual(allocations, [{ target: 'inv-i2', amount: 15000 }])

  s = must(s, { type: 'CREDIT_APPLY', id: 'ca1', customerId: CUST, allocations })
  assert.equal(inv2().remaining, 100000)
  assert.equal(inv2().payStatus, 'partial')
  assert.equal(availableCredit(s, CUST), 0)
  const after = ownerDashboard(s)
  assert.equal(after.salesNet, before.salesNet, 'لا إيراد جديد')
  assert.equal(after.salesVat, before.salesVat)
  assert.equal(after.collected, before.collected, 'لا تحصيل جديد')
  assert.equal(after.paymentsCount, before.paymentsCount)
  assert.equal(accountBalances(s).find(a => a.id === 'acc-bank').balance, bankBefore, 'لا حركة على البنك')
  assert.equal(customerSummary(s, CUST).balance, balanceBefore, 'رصيد العميل الإجمالي لا يتغير')

  // منع التكرار: نفس العملية مرة ثانية، أو عملية جديدة بعد نفاد الرصيد
  const again = run(s, { type: 'CREDIT_APPLY', id: 'ca1', customerId: CUST, allocations })
  assert.equal(again.code, 'ALREADY_APPLIED')
  assert.equal(again.state.creditApplications.length, 1)
  assert.equal(run(s, { type: 'CREDIT_APPLY', id: 'ca2', customerId: CUST, allocations }).code, 'CREDIT_EXCEEDS')

  // كشف الحساب: سطر توضيحي بلا أثر على الرصيد
  const st = statement(s, CUST)
  const row = st.rows.find(r => r.kind === 'credit')
  assert.equal(row.debit + row.credit, 0)
  assert.equal(row.info, 15000)
  assert.equal(st.closing, customerSummary(s, CUST).balance)
})

test('استخدام الرصيد: لا يتجاوز المتبقي ولا يُطبَّق على عميل آخر ولا بلا رصيد', () => {
  let s = withInvoice(createInitialState({ today: TODAY }), { id: 'x', number: 'X-1' })
  s = withPayment(s, { id: 'xp', amount: toHalalas(1200) }).state // زائد 50
  s = withInvoice(s, { id: 'o', customerId: OTHER, number: 'O-9' })
  assert.equal(run(s, { type: 'CREDIT_APPLY', id: 'n1', customerId: CUST, allocations: [{ target: 'inv-o', amount: 5000 }] }).code, 'ALLOCATION_OTHER_CUSTOMER')
  assert.equal(run(s, { type: 'CREDIT_APPLY', id: 'n2', customerId: OTHER, allocations: [{ target: 'inv-o', amount: 5000 }] }).code, 'CREDIT_EXCEEDS', 'العميل الآخر لا رصيد له')
  assert.equal(run(s, { type: 'CREDIT_APPLY', id: 'n3', customerId: CUST, allocations: [] }).code, 'AMOUNT_REQUIRED')
  s = withInvoice(s, { id: 'y', number: 'X-2' })
  assert.equal(run(s, { type: 'CREDIT_APPLY', id: 'n4', customerId: CUST, allocations: [{ target: 'inv-y', amount: 6000 }] }).code, 'CREDIT_EXCEEDS')
})

test('الكمية تقبل الأرقام العربية والإنجليزية والفاصلة العشرية العربية', () => {
  assert.equal(toQuantity('١٢'), 12)
  assert.equal(toQuantity('12'), 12)
  assert.equal(toQuantity('٢٫٥'), 2.5)
  assert.equal(toQuantity('۳'), 3)
  assert.ok(Number.isNaN(toQuantity('١٢أ')))
  assert.equal(toHalalas('١٬١٥٠٫٥٠'), 115050)

  let s = createInitialState({ today: TODAY })
  s = must(s, { type: 'DOC_ADD', id: 'q', kind: 'sale', file: file('q') })
  s = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'q', fields: {
    customerId: CUST, number: 'Q-1', vatMode: 'none',
    lines: [{ desc: 'معمول', qty: '٢٠', price: toHalalas(50) }, { desc: 'كعك', qty: '2.5', price: toHalalas(40) }],
  } })
  s = must(s, { type: 'DOC_APPROVE', id: 'q' })
  assert.equal(s.invoices[0].net, 100000 + 10000)
  assert.deepEqual(s.invoices[0].lines.map(l => l.qty), [20, 2.5])
})

test('واتساب: لا أرقام عشوائية، ورسالة تشمل الرقم والتاريخ والإجمالي', () => {
  assert.equal(normalizeWhatsapp(''), '')
  assert.equal(normalizeWhatsapp('+966 50 000 0001'), '966500000001')
  assert.equal(normalizeWhatsapp('٠٥٠٠٠٠٠٠٠١'), '966500000001')
  assert.equal(normalizeWhatsapp('0123'), null)
  const text = invoiceMessage({ labName: 'معمل تتميرا', customerName: 'نقطة بيع 1', invoice: { number: 'A-1', date: TODAY, total: 115000 } })
  assert.match(text, /A-1/)
  assert.match(text, /2026-09-17/)
  assert.match(text, /1,150\.00/)
  assert.match(text, /نموذج تجريبي — ليس فاتورة ضريبية/)
  assert.ok(whatsappUrl('966500000001', text).startsWith('https://wa.me/966500000001?text='))
})

// ── الإدخال غير الصالح ────────────────────────────────────────────────────
// الحقول تستخدم moneyFieldValue وquantityFieldValue لتحويل ما يُكتب إلى ما يُخزَّن،
// فنحاكي بهما تعديل المستخدم لقيمة صحيحة إلى نص غير صالح.

test('حقل المبلغ والكمية: النص غير الصالح يُخزَّن كما هو ولا تبقى القيمة السابقة', () => {
  assert.equal(moneyFieldValue('50'), 5000)
  assert.equal(moneyFieldValue('٥٠٫٥'), 5050)
  assert.equal(moneyFieldValue(''), 0)
  assert.equal(moneyFieldValue('50x'), '50x')
  assert.equal(moneyFieldValue('5.0.0'), '5.0.0')
  assert.equal(isValidMoneyField(moneyFieldValue('50x')), false)
  assert.equal(quantityFieldValue('١٢'), 12)
  assert.equal(quantityFieldValue('١٢أ'), '١٢أ')
  assert.equal(isValidQuantityField(quantityFieldValue('١٢أ')), false)
  assert.equal(isValidQuantityField('٢٠'), true)
})

test('فاتورة بيع: تعديل السعر والكمية إلى نص غير صالح يمنع الاعتماد، والتصحيح يسمح به', () => {
  let s = createInitialState({ today: TODAY })
  s = withTax(s, 'exclusive')
  s = must(s, { type: 'DOC_ADD', id: 'bad', kind: 'sale', file: file('bad') })
  s = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'bad', fields: {
    customerId: CUST, number: 'B-1',
    lines: [{ id: 'l1', desc: 'معمول', qty: quantityFieldValue('20'), price: moneyFieldValue('50') }],
  } })
  // المستخدم يعدّل السعر الصحيح 50 إلى «50x» والكمية إلى «٢٠أ»
  const line = s.documents[0].fields.lines[0]
  s = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'bad', fields: { lines: [{ ...line, price: moneyFieldValue('50x'), qty: quantityFieldValue('٢٠أ') }] } })
  assert.deepEqual(invalidInputs('sale', s.documents[0].fields), ['كمية البند 1', 'سعر البند 1'])

  const blocked = run(s, { type: 'DOC_APPROVE', id: 'bad' })
  assert.equal(blocked.code, 'INVALID_INPUT')
  assert.match(blocked.error, /سعر البند 1/)
  assert.match(blocked.error, /كمية البند 1/)
  assert.equal(blocked.state.invoices.length, 0, 'لم تُعتمد بالقيمة السابقة 50')
  assert.equal(blocked.state.documents[0].status, 'pending')
  assert.equal(ownerDashboard(blocked.state).salesNet, 0)

  // التصحيح
  s = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'bad', fields: { lines: [{ ...line, price: moneyFieldValue('٥٠'), qty: quantityFieldValue('٢٠') }] } })
  assert.deepEqual(invalidInputs('sale', s.documents[0].fields), [])
  s = must(s, { type: 'DOC_APPROVE', id: 'bad' })
  assert.equal(s.invoices.length, 1)
  assert.equal(s.invoices[0].net, 100000)
  assert.equal(s.invoices[0].total, 115000)
})

test('السداد: مبلغ أو توزيع غير صالح يمنع الاعتماد ولا يُسقط التوزيع بصمت', () => {
  let s = withInvoice(createInitialState({ today: TODAY }))
  s = must(s, { type: 'DOC_ADD', id: 'pb', kind: 'payment', file: file('pb') })
  s = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'pb', fields: { customerId: CUST, accountId: 'acc-bank', amount: moneyFieldValue('600'), allocations: [{ target: 'inv-d1', amount: moneyFieldValue('600') }] } })

  let t = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'pb', fields: { amount: moneyFieldValue('6OO') } })
  let r = run(t, { type: 'DOC_APPROVE', id: 'pb' })
  assert.equal(r.code, 'INVALID_INPUT')
  assert.match(r.error, /مبلغ السداد/)
  assert.equal(r.state.payments.length, 0)

  t = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'pb', fields: { allocations: [{ target: 'inv-d1', amount: moneyFieldValue('600,,x') }] } })
  r = run(t, { type: 'DOC_APPROVE', id: 'pb' })
  assert.equal(r.code, 'INVALID_INPUT')
  assert.match(r.error, /مبالغ التوزيع/)
  assert.equal(r.state.payments.length, 0)

  r = run(s, { type: 'DOC_APPROVE', id: 'pb' })
  assert.equal(r.error, undefined)
  assert.equal(invoiceView(r.state, r.state.invoices[0]).remaining, 55000)
})

test('المشتريات: مبلغ بند غير صالح يمنع الاعتماد، والتصحيح يسمح به', () => {
  let s = createInitialState({ today: TODAY })
  s = must(s, { type: 'DOC_ADD', id: 'mb', kind: 'purchase', file: file('mb') })
  const lines = s.documents[0].fields.lines
  s = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'mb', fields: { lines: [{ ...lines[0], net: moneyFieldValue('200ر') }, lines[1]] } })
  const r = run(s, { type: 'DOC_APPROVE', id: 'mb' })
  assert.equal(r.code, 'INVALID_INPUT')
  assert.match(r.error, /مبلغ البند 1/)
  assert.equal(r.state.purchases.length, 0)
  s = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'mb', fields: { lines: [{ ...lines[0], net: moneyFieldValue('200') }, lines[1]] } })
  s = must(s, { type: 'DOC_APPROVE', id: 'mb' })
  assert.equal(s.purchases[0].net, 25000)
})

test('استخدام الرصيد: مبلغ تسوية غير صالح يمنع التأكيد ولا يُسقط بصمت، والتصحيح يسمح به', () => {
  let s = withInvoice(createInitialState({ today: TODAY }), { id: 'c1', number: 'K-1' })
  s = withPayment(s, { id: 'cp', amount: toHalalas(1300) }).state
  s = withInvoice(s, { id: 'c2', number: 'K-2' })
  const bad = run(s, { type: 'CREDIT_APPLY', id: 'op', customerId: CUST, allocations: [{ target: 'inv-c2', amount: moneyFieldValue('150x') }] })
  assert.equal(bad.code, 'INVALID_INPUT')
  assert.equal(bad.state.creditApplications.length, 0)
  const good = run(s, { type: 'CREDIT_APPLY', id: 'op', customerId: CUST, allocations: [{ target: 'inv-c2', amount: moneyFieldValue('150') }] })
  assert.equal(good.error, undefined)
  assert.equal(invoiceView(good.state, good.state.invoices.find(i => i.number === 'K-2')).remaining, 100000)
})
