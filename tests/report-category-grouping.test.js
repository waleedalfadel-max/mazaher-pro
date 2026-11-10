import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expenseFigures } from '../src/lib/reportFigures.js'
import { windowFigures } from '../src/lib/financialAnalysis.js'
import { allocateEntry } from '../src/lib/expenseBreakdown.js'
import { reportModel } from '../src/lib/reportExport.js'

const categoriesById = {
  food: { id: 'food', name: 'تكلفة البضاعة المباعة', financial_class: 'cogs' },
  operating: { id: 'operating', name: 'مصروفات تشغيلية', financial_class: 'opex' },
  fixed: { id: 'fixed', name: 'مصروفات ثابتة', financial_class: 'fixed' },
  government: { id: 'government', name: 'مصروفات حكومية', financial_class: 'fixed' },
}
const entry = (id, type, amount, extra = {}) => ({ id, journal_number: `J-${id}`, date: '2026-01-02', status: 'approved', type, cash_out: amount, total_amount: amount, ...extra })
const figures = (entries, docItems = [], cats = categoriesById) => expenseFigures({ entries, docItems, categoriesById: cats })

test('old and new entries form one expense row per category in reports, analysis and exports', () => {
  const entries = [
    entry('a', '💰 مصروفات ثابتة', 100, { category_id: 'fixed' }),
    entry('b', '💰 مصروفات ثابتة', 200, { category_id: 'fixed', financial_class: 'fixed' }),
    entry('c', '🛒 مصروفات تشغيلية', 30, { category_id: 'operating' }),
    entry('d', '🛒 مصروفات تشغيلية', 40),
    entry('e', '💰 مصروفات ثابتة', 50, { category_id: 'government' }),
    entry('f', '💰 مصروفات ثابتة', 60, { category_id: 'government', financial_class: 'fixed' }),
  ]
  const expected = { 'مصروفات ثابتة': 300, 'مصروفات حكومية': 110, 'مصروفات تشغيلية': 70 }
  for (const rows of [entries, [...entries].reverse()]) {
    const x = figures(rows)
    assert.equal(x.mainRows.length, 3)
    assert.deepEqual(Object.fromEntries(x.mainRows.map(r => [r.label, r.total])), expected)
    const a = windowFigures(rows, { from: '2026-01-01', to: '2026-01-31' }, { categoriesById })
    assert.deepEqual(Object.fromEntries(a.mains.map(r => [r.label, r.h / 100])), expected)
    assert.equal(a.costsH, 48000)
    assert.equal(a.mains.find(r => r.label === 'مصروفات ثابتة').cls, 'fixed')
    const model = reportModel({ tab: 'purchases', from: '2026-01-01', to: '2026-01-31', x })
    const expenseTable = model.blocks.find(b => b.id === 'purchases.opex')
    assert.equal(expenseTable.rows.filter((_, i) => expenseTable.levels[i] === 0).length, 3)
  }
})

test('a corrected ledger category takes precedence over stale reading text for the same linked category', () => {
  const entries = [
    entry('food', '🥩 تكلفة البضاعة المباعة', 90, { category_id: 'food' }),
    entry('ride', '🛒 مصروفات تشغيلية', 20, { category_id: 'operating' }),
  ]
  const docItems = [
    { id: 'i1', ledger_entry_id: 'food', journal_number: 'J-food', category_id: 'food', category_main: 'مصروفات تشغيلية', amount: 90 },
    { id: 'i2', ledger_entry_id: 'ride', journal_number: 'J-ride', category_id: 'operating', category_main: 'تكلفة البضاعة المباعة', category_sub: 'مواصلات', amount: 20 },
  ]
  const x = figures(entries, docItems)
  assert.deepEqual(x.cogsRows.map(r => [r.label, r.total]), [['تكلفة البضاعة المباعة', 90]])
  assert.deepEqual(x.opexRows.map(r => [r.label, r.total]), [['مصروفات تشغيلية', 20]])
  assert.equal(x.mainRows.reduce((s, r) => s + r.total, 0), 110)
})

test('mixed legacy invoices retain other categories and returns without reusing the full invoice amount', () => {
  const e = entry('mixed', '🥩 تكلفة البضاعة المباعة', 120, { category_id: 'food' })
  const items = [
    { journal_number: 'J-mixed', category_id: 'food', category_main: 'مصروفات تشغيلية', amount: 90 },
    { journal_number: 'J-mixed', category_id: 'operating', category_main: 'مصروفات تشغيلية', amount: 30 },
  ]
  assert.deepEqual(allocateEntry(e, 120, items, categoriesById).map(r => [r.cls, r.amount]), [['cogs', 90], ['opex', 30]])
  assert.deepEqual(allocateEntry(e, -120, items, categoriesById).map(r => [r.cls, r.amount]), [['cogs', -90], ['opex', -30]])
})

test('unique name links only affect grouping; saved treatment survives renaming or category class changes', () => {
  const e = entry('old', '🛒 مصروفات تشغيلية', 25)
  const cats = { operating: { ...categoriesById.operating, financial_class: 'cogs' } }
  assert.deepEqual(allocateEntry(e, 25, [], cats).map(r => [r.key, r.cls]), [['id:operating', 'opex']])
  const ambiguous = { ...cats, duplicate: { ...cats.operating, id: 'duplicate' } }
  assert.equal(allocateEntry(e, 25, [], ambiguous)[0].key, null)
  const explicit = { ...e, category_id: 'operating', financial_class: 'opex' }
  const renamed = { operating: { ...cats.operating, name: 'اسم جديد' } }
  assert.equal(allocateEntry(explicit, 25, [], renamed)[0].cls, 'opex')
})
