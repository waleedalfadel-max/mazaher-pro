import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allocateEntry } from '../src/lib/expenseBreakdown.js'

const sumBy = rows => rows.reduce((m, r) => (m[r.main] = Math.round(((m[r.main] || 0) + r.amount) * 100) / 100, m), {})

test('فاتورة بتصنيفين (قيدان برقم قيد واحد): كل قيد يتوزع على بنوده فقط، ولا يُحتسب شيء مرتين', () => {
  const entries = [
    { id: 'e1', journal_number: 'QD-2026-120', type: '🥩 تكلفة البضاعة المباعة', net: 400 },
    { id: 'e2', journal_number: 'QD-2026-120', type: '🛒 مصروفات تشغيلية', net: 100 },
  ]
  const items = [
    { ledger_entry_id: 'e1', journal_number: 'QD-2026-120', amount: 460, category_main: 'تكلفة البضاعة المباعة' },
    { ledger_entry_id: 'e2', journal_number: 'QD-2026-120', amount: 115, category_main: 'مصروفات تشغيلية' },
  ]
  const rows = entries.flatMap(e => allocateEntry(e, e.net, items))
  assert.deepEqual(sumBy(rows), { 'تكلفة البضاعة المباعة': 400, 'مصروفات تشغيلية': 100 })
})

test('البيانات القديمة (قيد واحد، بنود بلا ربط): المطابقة برقم القيد كما كانت', () => {
  const e = { id: 'old', journal_number: 'QD-2026-050', type: '🥩 تكلفة البضاعة المباعة' }
  const items = [
    { journal_number: 'QD-2026-050', amount: 230, category_main: 'تكلفة البضاعة المباعة' },
    { journal_number: 'QD-2026-050', amount: 172.5, category_main: 'مواد تعبئة وتغليف' },
  ]
  const rows = allocateEntry(e, 350, items)
  assert.equal(rows.length, 2)
  assert.equal(Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100, 350)
})

test('قيد بلا بنود: كامل مبلغه بتصنيفه', () => {
  assert.deepEqual(allocateEntry({ id: 'x', journal_number: 'QD-1', type: 'إيجار', description: 'إيجار' }, 100, []).map(r => [r.main, r.amount]), [['إيجار', 100]])
})

test('إعادة تسمية التصنيف لا تنقل المبلغ بين المشتريات والمصروفات: التجميع بالمعرّف والمعالجة بالرمز', () => {
  const entry = { id: 'e1', journal_number: 'QD-2026-130', type: '🥩 تكلفة البضاعة المباعة', category_id: 'c1', financial_class: 'cogs' }
  const items = [{ ledger_entry_id: 'e1', journal_number: 'QD-2026-130', amount: 460, category_id: 'c1', category_main: 'تكلفة البضاعة المباعة' }]
  const before = allocateEntry(entry, 400, items, { c1: { id: 'c1', name: 'تكلفة البضاعة المباعة', financial_class: 'cogs' } })
  const after = allocateEntry(entry, 400, items, { c1: { id: 'c1', name: 'مشتريات المطبخ', financial_class: 'cogs' } })
  assert.deepEqual(before.map(r => [r.key, r.cls, r.amount]), after.map(r => [r.key, r.cls, r.amount]))
  assert.equal(after[0].main, 'مشتريات المطبخ')          // يُعرض بالاسم الحالي
  assert.equal(after[0].cls, 'cogs')                     // «مشتريات المطبخ» لا يطابق أي نوع بالاسم، والمعالجة ثابتة
})

test('البيانات السابقة بلا معرّف: التصنيف والمعالجة كما كانا', () => {
  const rows = allocateEntry({ id: 'o', journal_number: 'QD-1', type: '🛒 مصروفات تشغيلية' }, 50,
    [{ journal_number: 'QD-1', amount: 57.5, category_main: 'مواد تعبئة وتغليف' }])
  assert.deepEqual(rows.map(r => [r.key, r.main, r.cls]), [[null, 'مواد تعبئة وتغليف', 'cogs']])
})

test('بيانات سابقة رُبطت بمعرّفها ثم أُعيدت تسمية التصنيف: صف واحد، والمبلغ والمعالجة كما كانا', () => {
  const cats = { c1: { id: 'c1', name: 'مشتريات المطبخ', financial_class: 'cogs' } }
  const oldLinked = allocateEntry({ id: 'o', journal_number: 'QD-1', type: '🥩 تكلفة البضاعة المباعة', category_id: 'c1' }, 200,
    [{ journal_number: 'QD-1', amount: 230, category_id: 'c1', category_main: 'تكلفة البضاعة المباعة' }], cats)
  const fresh = allocateEntry({ id: 'n', journal_number: 'QD-2', type: '🥩 تكلفة البضاعة المباعة', category_id: 'c1', financial_class: 'cogs' }, 100,
    [{ ledger_entry_id: 'n', journal_number: 'QD-2', amount: 115, category_id: 'c1', category_main: 'مشتريات المطبخ' }], cats)
  assert.deepEqual([...new Set([...oldLinked, ...fresh].map(r => r.key))], ['id:c1'])
  assert.deepEqual([...oldLinked, ...fresh].map(r => [r.main, r.cls, r.amount]), [['مشتريات المطبخ', 'cogs', 200], ['مشتريات المطبخ', 'cogs', 100]])
})

test('تغيير الرمز المالي للتصنيف لاحقًا لا يعيد تصنيف قيود سابقة', () => {
  const cats = { c2: { id: 'c2', name: 'مصروفات تشغيلية', financial_class: 'cogs' } }   // غُيّر بعد الاعتماد
  const v2 = allocateEntry({ id: 'e', journal_number: 'QD-3', type: '🛒 مصروفات تشغيلية', category_id: 'c2', financial_class: 'opex' }, 80, [], cats)
  const legacy = allocateEntry({ id: 'l', journal_number: 'QD-4', type: '🛒 مصروفات تشغيلية', category_id: 'c2' }, 90, [], cats)
  assert.deepEqual([v2[0].cls, legacy[0].cls], ['opex', 'opex'])
})
