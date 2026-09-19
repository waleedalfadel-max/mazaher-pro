import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createInitialState, ownerDashboard, reduce,
} from '../tatmira-demo/src/lib/ledger.js'
import { expenseReport } from '../tatmira-demo/src/lib/expenses.js'
import {
  INITIAL_EFFECTIVE_FROM, expenseAmounts, ratePercentToBps, saleAmounts, taxSettingForDate,
} from '../tatmira-demo/src/lib/tax.js'

const TODAY = '2026-09-17'
const CUST = 'cust-5'
const file = id => ({ id: `file-${id}`, name: `${id}.pdf`, type: 'application/pdf', size: 1000 })
const run = (state, action) => reduce(state, { today: TODAY, at: `${TODAY}T10:00:00.000Z`, ...action })
function must(state, action) {
  const r = run(state, action)
  assert.equal(r.error, undefined, `${r.code}: ${r.error}`)
  return r.state
}
function setTax(state, mode, effectiveFrom = INITIAL_EFFECTIVE_FROM, rateBps = 1500) {
  return must(state, { type: 'TAX_SETTING_SAVE', mode, rateBps, vatNumber: mode === 'disabled' ? '' : 'DEMO', effectiveFrom })
}
function approveSale(state, id, date = TODAY) {
  state = must(state, { type: 'DOC_ADD', id, kind: 'sale', file: file(id) })
  state = must(state, { type: 'DOC_UPDATE_FIELDS', id, fields: {
    customerId: CUST, number: id.toUpperCase(), date,
    lines: [{ id: 'l1', desc: 'منتج تجريبي', qty: 20, price: 5000 }],
  } })
  return must(state, { type: 'DOC_APPROVE', id })
}
function approveExpense(state, id, date = TODAY) {
  state = must(state, { type: 'DOC_ADD', id, kind: 'purchase', file: file(id) })
  state = must(state, { type: 'DOC_UPDATE_FIELDS', id, fields: {
    date, accountId: 'acc-bank',
    lines: [{ id: 'p1', desc: 'مواد', categoryId: 'cat-dates', net: 10000, vat: 1500 }],
  } })
  return must(state, { type: 'DOC_APPROVE', id })
}

test('الحسابات الثلاثة: بدون ضريبة، شامل الضريبة، وقبل الضريبة', () => {
  assert.deepEqual(saleAmounts(100000, { mode: 'disabled', rateBps: 1500 }), { net: 100000, vat: 0, total: 100000 })
  assert.deepEqual(saleAmounts(115000, { mode: 'inclusive', rateBps: 1500 }), { net: 100000, vat: 15000, total: 115000 })
  assert.deepEqual(saleAmounts(100000, { mode: 'exclusive', rateBps: 1500 }), { net: 100000, vat: 15000, total: 115000 })
  assert.deepEqual(expenseAmounts(10000, 1500, { mode: 'disabled', rateBps: 1500 }), { expenseAmount: 11500, separatedVat: 0 })
  assert.deepEqual(expenseAmounts(10000, 1500, { mode: 'exclusive', rateBps: 1500 }), { expenseAmount: 10000, separatedVat: 1500 })
})

test('نسبة الضريبة تقبل الأرقام العربية ويحكم الإعداد تاريخ المستند', () => {
  assert.equal(ratePercentToBps('١٥'), 1500)
  assert.equal(ratePercentToBps('٥٫٥'), 550)
  assert.ok(Number.isNaN(ratePercentToBps('15x')))

  let s = createInitialState({ today: TODAY })
  s = setTax(s, 'exclusive', '2026-10-01')
  s = setTax(s, 'inclusive', '2027-01-01', 500)
  assert.equal(taxSettingForDate(s, '2026-09-30').mode, 'disabled')
  assert.equal(taxSettingForDate(s, '2026-10-01').mode, 'exclusive')
  assert.equal(taxSettingForDate(s, '2027-02-01').mode, 'inclusive')
  assert.equal(taxSettingForDate(s, '2027-02-01').rateBps, 500)
})

test('فاتورة البيع تحفظ لقطة الإعداد ولا تتغير عند تعديل إعداد المنشأة', () => {
  let s = setTax(createInitialState({ today: TODAY }), 'exclusive')
  s = approveSale(s, 'old')
  assert.deepEqual([s.invoices[0].net, s.invoices[0].vat, s.invoices[0].total], [100000, 15000, 115000])
  assert.equal(s.invoices[0].taxProfile.mode, 'exclusive')

  s = setTax(s, 'disabled', TODAY)
  const before = structuredClone(s.invoices[0])
  s = approveSale(s, 'new')
  assert.deepEqual(s.invoices[0], before, 'الفاتورة المعتمدة القديمة لم تتغير')
  assert.deepEqual([s.invoices[1].net, s.invoices[1].vat, s.invoices[1].total], [100000, 0, 100000])
  assert.equal(s.invoices[1].taxProfile.mode, 'disabled')
})

test('غير المسجل يحتسب ضريبة المورد تكلفةً، والمسجل يفصلها، والدفع النقدي يبقى بالإجمالي', () => {
  let s = createInitialState({ today: TODAY })
  s = approveExpense(s, 'gross', '2026-09-01')
  let report = expenseReport(s)
  assert.equal(report.direct.total, 11500)
  assert.equal(report.vat, 0)
  assert.equal(s.purchases[0].lines[0].expenseAmount, 11500)
  assert.equal(s.purchases[0].lines[0].separatedVat, 0)

  s = setTax(s, 'exclusive', '2026-09-10')
  s = approveExpense(s, 'net', '2026-09-10')
  report = expenseReport(s)
  assert.equal(report.direct.total, 21500)
  assert.equal(report.vat, 1500)
  assert.equal(ownerDashboard(s).accounts.find(a => a.id === 'acc-bank').outflow, 23000)
  assert.equal(s.purchases[1].taxProfile.mode, 'exclusive')
})

test('الموظف المحدود لا يستطيع تغيير إعداد الضريبة', () => {
  const s = createInitialState({ today: TODAY })
  const r = run(s, {
    type: 'TAX_SETTING_SAVE', actorId: 'emp-purchasing', mode: 'exclusive', rateBps: 1500,
    vatNumber: 'DEMO', effectiveFrom: TODAY,
  })
  assert.equal(r.code, 'FORBIDDEN')
  assert.equal(r.state.taxSettings[0].mode, 'disabled')
})

