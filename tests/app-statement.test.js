import test from 'node:test'
import assert from 'node:assert/strict'
import { attribution, appOf, kindOf, receivableBalances, unassignedEntries, buildAppStatement, statementComparison, comparisonText, balanceNote, preSystemNote } from '../src/lib/appStatement.js'
import { reportModel, sheetRows } from '../src/lib/reportExport.js'

// بيانات مصطنعة بالكامل
const E = (id, date, type, rin, rout, extra = {}) => ({ id, date, type, receivable_in: rin, receivable_out: rout, description: '', journal_number: 'QD-' + id, status: 'approved', branch: null, ...extra })
const rows = [
  E('01', '2026-10-10', '🍔 مبيعات هنقر ستيشن', 1000, 0, { branch: 'فرع أ' }),
  E('02', '2026-10-11', '🍔 مبيعات هنقر ستيشن', 900.50, 0, { branch: 'فرع ب' }),
  E('03', '2026-10-12', '🍔 مبيعات هنقر ستيشن', 1099.50, 0, { branch: 'فرع أ' }),
  E('04', '2026-10-15', '📥 تحصيل ذمم هنقر', 0, 10500),
  E('05', '2026-10-11', '🛵 مبيعات جاهز', 400, 0),
]

test('النسبة بلا تخمين: النوع أولًا، ثم وصف يذكر تطبيقًا واحدًا (عمولة بنوع مصروف)، والوصف بأكثر من تطبيق أو بلا تطبيق للمراجعة', () => {
  assert.equal(appOf(E('a', '2026-10-01', '🍔 مبيعات هنقر ستيشن', 10, 0)), 'hunger')
  assert.equal(appOf(E('b', '2026-10-01', '📥 تحصيل ذمم جاهز', 0, 10)), 'jahez')
  assert.deepEqual(attribution(E('c', '2026-10-01', '🛒 مصروفات تشغيلية', 0, 25, { description: 'عمولات هنقر ستيشن — 2026-10-01 إلى 2026-10-15' })), { app: 'hunger', by: 'description' })
  assert.deepEqual(attribution(E('d', '2026-10-01', '🛒 مصروفات تشغيلية', 0, 25, { description: 'عمولات هنقر وجاهز' })), { app: null, reason: 'الوصف يذكر أكثر من تطبيق' })
  assert.deepEqual(attribution(E('e', '2026-10-01', 'تسوية يدوية', 5, 0)), { app: null, reason: 'لا يذكر النوع ولا الوصف تطبيقًا' })
  assert.equal(appOf(E('f', '2026-10-01', '🛒 مصروفات تشغيلية', 0, 0, { description: 'عمولات هنقر' })), null)
  assert.equal(kindOf(E('g', '', '📥 تحصيل ذمم هنقر', 0, 1)), 'collection')
  assert.equal(kindOf(E('h', '', '🍔 مبيعات هنقر ستيشن', 1, 0)), 'sale')
  assert.equal(kindOf(E('i', '', '🛒 مصروفات تشغيلية', 0, 1, { description: 'عمولات هنقر' })), 'settlement')
})

test('التحصيل أكبر من المبيعات المسجلة: الرصيد السالب ظاهر بإشارته، وكل حركة في عمودها برصيدها بعدها', () => {
  const b = receivableBalances(rows)
  assert.equal(b.balances.hunger, -7500)
  assert.equal(b.balances.jahez, 400)
  assert.deepEqual(b.active, ['hunger', 'jahez'])
  const st = buildAppStatement(rows, 'hunger', { from: '2026-10-01', to: '2026-10-31' })
  assert.equal(st.opening, 0)
  assert.deepEqual(st.rows.map(r => r.balance), [1000, 1900.5, 3000, -7500])
  assert.deepEqual(st.rows.map(r => [r.sale, r.collection, r.settlement]), [[1000, null, null], [900.5, null, null], [1099.5, null, null], [null, 10500, null]])
  assert.deepEqual(st.totals, { sales: 3000, collections: 10500, settlements: 0 })
  assert.equal(st.closing, -7500)
  assert.equal(st.firstRecorded, '2026-10-10')
  assert.match(balanceNote(st.closing), /لا يُنشأ قيد أو رصيد افتتاحي تقديري/)
})

test('رصيد بداية الفترة من قيود تحسيب السابقة وحدها؛ وما قبل أول قيد غير معروف ولا يُفترض صفرًا', () => {
  const st = buildAppStatement([...rows, E('06', '2026-11-02', '🍔 مبيعات هنقر ستيشن', 500, 0), E('07', '2026-10-13', '🍔 مبيعات هنقر ستيشن', 999, 0, { status: 'cancelled' })], 'hunger', { from: '2026-10-12', to: '2026-10-31' })
  assert.equal(st.opening, 1900.5)
  assert.equal(st.previousCount, 2)
  assert.deepEqual(st.rows.map(r => r.id), ['03', '04'])
  assert.equal(st.closing, -7500)
  assert.match(preSystemNote(st.firstRecorded), /2026-10-10/)
  assert.match(preSystemNote(st.firstRecorded), /غير معروف من الدفتر، ولا يُفترض صفرًا/)
  const early = buildAppStatement(rows, 'hunger', { from: '2026-09-01', to: '2026-09-30' })
  assert.equal(early.opening, 0)
  assert.equal(early.rows.length, 0)
  assert.equal(early.firstRecorded, '2026-10-10')
})

test('العمولة المرتبطة بالتطبيق تسوية تُحتسب مرة واحدة؛ والملتبسة لا تدخل أي تطبيق وتظهر للمراجعة؛ والمجموع = كل الذمم', () => {
  const extra = [E('08', '2026-10-15', '🛒 مصروفات تشغيلية', 0, 120, { description: 'عمولات هنقر ستيشن — 2026-10-01 إلى 2026-10-15' }),
    E('09', '2026-10-16', '🛒 مصروفات تشغيلية', 0, 30, { description: 'عمولات هنقر وجاهز' }), E('10', '2026-10-16', 'تسوية يدوية', 0, 50)]
  const all = [...rows, ...extra]
  const st = buildAppStatement(all, 'hunger', { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(st.totals, { sales: 3000, collections: 10500, settlements: 120 })
  assert.equal(st.rows.filter(r => r.id === '08').length, 1)
  assert.equal(st.rows.find(r => r.id === '08').settlement, 120)
  assert.equal(buildAppStatement(all, 'jahez', { from: '2026-10-01', to: '2026-10-31' }).rows.some(r => r.id === '09'), false)
  const b = receivableBalances(all)
  assert.equal(b.balances.hunger, -7620)
  assert.equal(b.unassigned, -80)
  const total = all.reduce((s, e) => s + e.receivable_in - e.receivable_out, 0)
  assert.equal(Math.round((Object.values(b.balances).reduce((s, v) => s + v, 0) + b.unassigned) * 100) / 100, Math.round(total * 100) / 100)
  assert.deepEqual(unassignedEntries(all).map(u => [u.id, u.reason, u.amount]), [['09', 'الوصف يذكر أكثر من تطبيق', -30], ['10', 'لا يذكر النوع ولا الوصف تطبيقًا', -50]])
})

test('المقارنة مع كشف التطبيق: حتى تاريخ الكشف نفسه، بمصدره ومُدخله، بلا وصف «مطابق»، وتنبيه إن لم يغطِّ نهاية الفترة', () => {
  const cps = [
    { id: 'x', app: 'hunger', statement_date: '2026-10-12', statement_balance: '3000.00', reference: 'كشف تجريبي 1', created_by_name: 'محاسب', created_at: '2026-10-20T08:00:00Z' },
    { id: 'y', app: 'hunger', statement_date: '2026-10-15', statement_balance: '0.00', reference: 'كشف تجريبي 2', created_by_name: 'محاسب', created_at: '2026-10-20T09:00:00Z', voided_at: '2026-10-20T10:00:00Z' },
  ]
  const c = statementComparison(rows, cps, 'hunger', '2026-10-31')
  assert.equal(c.checkpoint.id, 'x')
  assert.deepEqual([c.statementBalance, c.bookBalance, c.difference, c.noDifference, c.coversPeriodEnd], [3000, 3000, 0, true, false])
  assert.match(comparisonText(c), /لا فرق في 2026-10-12/)
  assert.match(comparisonText(c), /«كشف تجريبي 1» الذي أدخله محاسب/)
  assert.match(comparisonText(c), /الحركات بعد هذا التاريخ لم تُقارن/)
  assert.doesNotMatch(comparisonText(c), /مطابق/)
  assert.equal(statementComparison(rows, cps, 'hunger', '2026-10-11'), null)
  const c2 = statementComparison(rows, [{ ...cps[0], statement_date: '2026-10-31', statement_balance: '1500.00' }], 'hunger', '2026-10-31')
  assert.deepEqual([c2.bookBalance, c2.difference, c2.noDifference, c2.coversPeriodEnd], [-7500, 9000, false, true])
  assert.match(comparisonText(c2), /فرق 9000\.00 في 2026-10-31/)
  assert.doesNotMatch(comparisonText(c2), /لم تُقارن/)
})

test('التصدير: الملف يحوي الملخص للمنشأة كاملة، وما قبل التسجيل، وكل حركة في عمودها برصيدها، وقيود المراجعة، بالأرقام نفسها', () => {
  const all = [...rows, E('09', '2026-10-16', '🛒 مصروفات تشغيلية', 0, 30, { description: 'عمولات هنقر وجاهز' })]
  const st = buildAppStatement(all, 'hunger', { from: '2026-10-01', to: '2026-10-31' })
  const model = reportModel({ tab: 'apps', org: 'منشأة تجريبية', from: '2026-10-01', to: '2026-10-31', branch: 'all', branches: ['أ', 'ب'], generatedAt: new Date('2026-10-23T10:00:00Z'),
    a: { app: 'hunger', label: 'هنقر ستيشن', statement: st, comparison: null, note: balanceNote(st.closing), preSystem: preSystemNote(st.firstRecorded), comparisonText: null, unassigned: unassignedEntries(all, '2026-10-31') } })
  assert.equal(model.title, 'كشف حساب التطبيقات')
  const mv = model.blocks.find(b => b.id === 'apps.movements')
  assert.deepEqual(mv.columns.map(c => c.label).slice(5), ['مبيعات', 'تحصيل', 'تسوية', 'الرصيد بعد الحركة'])
  assert.deepEqual(mv.rows.map(r => r[8]), [0, 1000, 1900.5, 3000, -7500])
  assert.deepEqual(mv.rows[4].slice(5), [null, 10500, null, -7500])
  assert.deepEqual(mv.foot[0].slice(5), [3000, 10500, null, -7500])
  assert.match(model.blocks.find(b => b.id === 'apps.summary').title, /المنشأة كاملة/)
  assert.match(model.blocks.find(b => b.id === 'apps.presystem').text, /لا يُفترض صفرًا/)
  assert.match(model.blocks.find(b => b.id === 'apps.match').text, /لم يُقارن بكشف التطبيق/)
  assert.deepEqual(model.blocks.find(b => b.id === 'apps.unassigned').rows.map(r => r[5]), [-30])
  const flat = JSON.stringify(sheetRows(model))
  assert.ok(flat.includes('-7500') && flat.includes('10500') && flat.includes('الرصيد بعد الحركة') && flat.includes('الوصف يذكر أكثر من تطبيق'))
})
