import test from 'node:test'
import assert from 'node:assert/strict'
import { journalPostings } from '../src/lib/journalPostings.js'
import { loadJournalAccounts } from '../src/lib/journalAccounts.js'
import { journalClient, journalFixture } from './fixtures/journal-detail.js'

const base = { id: 'r', project_id: 'p1', journal_number: 'J1', date: '2026-11-05', status: 'approved' }
const context = { banks: [{ id: 'main', name: 'الراجحي الرئيسي' }], suppliers: [{ id: 's1', name: 'بركات الربيع' }], settings: { onboarding: { tax: { status: 'مسجل' } } } }
const posting = (row, ctx = context) => journalPostings([{ ...base, ...row }], ctx)
const lines = p => p.segments.flatMap(s => s.lines).map(l => [l.account, l.debit, l.credit])

test('bread from custody: cost, recorded input VAT and custody credit; no double gross', () => {
  const p = posting({ type: '🥩 تكلفة البضاعة المباعة', category_main: 'الخبز', custody_out: 115, vat_amount: 15, total_amount: 115 })
  assert.deepEqual(lines(p), [['الخبز', 10000, 0], ['ضريبة المشتريات', 1500, 0], ['عهدة الموظفين', 0, 11500]])
  assert.equal(p.debit, 11500); assert.equal(p.credit, 11500); assert.equal(p.complete, true)
})
test('credit chicken purchase and later payment: supplier reverses, payment never books cost again', () => {
  const purchase = posting({ type: '🥩 تكلفة البضاعة المباعة', category_main: 'الدجاج', payable_in: 1150, vat_amount: 150, supplier_id: 's1' })
  assert.deepEqual(lines(purchase), [['الدجاج', 100000, 0], ['ضريبة المشتريات', 15000, 0], ['المورد — بركات الربيع', 0, 115000]])
  const payment = posting({ type: '🏪 سداد مورد', bank_out: 500, payable_out: 500, bank_account_id: 'main', supplier_id: 's1' })
  assert.deepEqual(lines(payment), [['المورد — بركات الربيع', 50000, 0], ['الراجحي الرئيسي', 0, 50000]])
  assert.equal(payment.complete, true)
  assert.equal(posting({ type: 'سداد مورد', bank_out: 500, payable_out: 200, bank_account_id: 'main', supplier_id: 's1' }).complete, false)
})
test('split payment, return and non-registered input tax preserve correct signs and gross', () => {
  const r = { type: '🛒 مصروفات تشغيلية', category_main: 'الكهرباء', cash_out: 50, bank_out: 65, bank_account_id: 'main', vat_amount: 15 }
  assert.equal(posting(r).debit, 11500)
  const back = posting({ ...r, cash_out: 0, bank_out: 0, payable_out: 115, supplier_id: 's1' })
  assert.deepEqual(lines(back), [['المورد — بركات الربيع', 11500, 0], ['الكهرباء', 0, 10000], ['ضريبة المشتريات', 0, 1500]])
  const notRegistered = posting(r, { ...context, settings: { onboarding: { tax: { status: 'غير مسجل' } } } })
  assert.ok(lines(notRegistered).some(l => l[0] === 'الكهرباء' && l[1] === 11500))
  assert.ok(!lines(notRegistered).some(l => l[0] === 'ضريبة المشتريات'))
})
test('sales use exact VAT including zero and corrections; historical estimate is explicitly labeled', () => {
  assert.deepEqual(lines(posting({ type: 'مبيعات كاش', cash_in: 115, output_vat_amount: 15 })), [['الصندوق', 11500, 0], ['المبيعات', 0, 10000], ['ضريبة المبيعات', 0, 1500]])
  assert.deepEqual(lines(posting({ type: 'مبيعات كاش', cash_in: 115, output_vat_amount: 0 })), [['الصندوق', 11500, 0], ['المبيعات', 0, 11500]])
  assert.ok(lines(posting({ type: 'مبيعات كاش', cash_in: 115 })).some(l => l[0] === 'ضريبة المبيعات (تقديرية)' && l[2] === 1500))
  assert.equal(posting({ type: 'مبيعات كاش', cash_in: -115, output_vat_amount: -15 }).complete, true)
  const taxOnly = posting({ type: 'مبيعات كاش', output_vat_amount: 15 })
  assert.deepEqual(lines(taxOnly), [['المبيعات', 1500, 0], ['ضريبة المبيعات', 0, 1500]])
  assert.equal(posting({ type: 'مبيعات كاش', cash_in: 100 }, { ...context, settings: {} }).complete, false)
})
test('transfer pairs only within its reference/date/status; missing legs are not invented', () => {
  const a = { ...base, type: 'تحويل داخلي', bank_out: 100, bank_account_id: 'main' }, b = { ...base, id: 'b', type: 'تحويل داخلي', custody_in: 100 }
  assert.deepEqual(lines(journalPostings([a, b], context)), [['عهدة الموظفين', 10000, 0], ['الراجحي الرئيسي', 0, 10000]])
  for (const changed of [{ journal_number: 'J2' }, { date: '2026-11-06' }, { status: 'pending' }]) assert.equal(journalPostings([a, { ...b, ...changed }], context).complete, false)
  assert.equal(journalPostings([a], context).complete, false)
  assert.equal(posting({ type: 'تحويل داخلي', total_amount: 100 }).complete, false)
})
test('unknown/beginning adjustments, missing bank/supplier and invalid tax stay visibly incomplete', () => {
  for (const row of [
    { type: 'تسوية رصيد بداية المتابعة', cash_in: 1989 }, { type: 'تسوية مطابقة بنكية', cash_in: 53.58 },
    { type: 'مشتريات', bank_out: 115 }, { type: 'مشتريات', payable_in: 115 },
    { type: 'مشتريات', cash_out: 100, vat_amount: 115 },
  ]) { const p = posting(row); assert.equal(p.complete, false); assert.ok(p.segments.some(s => s.issues.length)); }
  const cashError = posting({ type: 'حوالة واردة بالخطأ', cash_in: 54 })
  assert.deepEqual(lines(cashError), [['الصندوق', 5400, 0], ['مبالغ واجبة الرد', 0, 5400]])
})
test('pending/cancelled do not enter posted totals; source remains unchanged', () => {
  const rows = [{ ...base, type: 'مبيعات كاش', cash_in: .1, output_vat_amount: 0 }, { ...base, id: '2', type: 'مبيعات كاش', cash_in: .2, output_vat_amount: 0 },
    { ...base, id: '3', type: 'مبيعات كاش', cash_in: 999, output_vat_amount: 0, status: 'pending' }, { ...base, id: '4', status: 'cancelled', bank_out: 999 }]
  const before = structuredClone(rows), p = journalPostings(rows, context)
  assert.equal(p.debit, 30); assert.equal(p.credit, 30); assert.equal(p.complete, true); assert.deepEqual(rows, before)
})
test('account lookup includes both supplier lists, paginates and fails closed with tenant scope', async () => {
  const tables = journalFixture(), log = []
  tables.payable_suppliers = [{ id: 'ps1', project_id: 'p1', name: 'مورد آجل' }, { id: 'foreign', project_id: 'p2', name: 'secret' }]
  const rows = [{ supplier_id: 's1' }, { supplier_id: 'ps1' }, { supplier_id: 'foreign' }]
  const good = await loadJournalAccounts(journalClient(tables, { max: 1, log }), 'p1', rows)
  assert.equal(good.error, null); assert.equal(good.data.banks.length, 2); assert.deepEqual(good.data.suppliers.map(s => s.name), ['المورد التجريبي', 'مورد آجل'])
  assert.ok(log.every(q => q.filters.some(([op, k, v]) => op === 'eq' && k === 'project_id' && v === 'p1')))
  const bad = await loadJournalAccounts(journalClient(tables, { fail: q => q.table === 'payable_suppliers' }), 'p1', rows)
  assert.equal(bad.data, null); assert.ok(bad.error)
})
