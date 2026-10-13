// جولة المراجعة الثانية للتحليل المالي (ملاحظات ChatGPT 2026-10-10): كل حالة تكشف الخطأ قبل التصحيح وتنجح بعده.
// البنود: 1 القيود المحتسبة، 2 دورة الشراء الآجل (المبالغ)، 3 التوزيع بالهللة، 4 تفاصيل ملاحظة الهدف، 5 نطاق الزمن، 6 معيار الملاحظات،
// 8 جلب التصنيفات كاملة. (البند 7 في اختبار الواجهة، والبند 2 كاملًا في local-test/credit-cycle.test.sql واختبار الواجهة.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as rules from '../src/lib/financeRules.js'
import { summarizeEntries } from '../src/lib/financeSummary.js'
import { allocateEntry } from '../src/lib/expenseBreakdown.js'
import { expenseFigures } from '../src/lib/reportFigures.js'
import { vatFigures } from '../src/lib/vatTreatment.js'
import { windowFigures, referenceOf, buildAnalysis, leavesOf, contribsFor } from '../src/lib/financialAnalysis.js'
import * as periods from '../src/lib/analysisPeriods.js'
import { loadAnalysisRows } from '../src/lib/analysisData.js'

let n = 0
const id = () => `r${++n}`
const sale = (date, gross, status = 'approved') => ({ id: id(), date, type: '💵 مبيعات كاش', cash_in: gross, status })
const cost = (date, gross, extra = {}) => ({ id: id(), date, type: '🛒 مصروفات تشغيلية', bank_out: gross, vat_amount: 0, status: 'approved', ...extra })
const W = (from, to) => ({ from, to, days: Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1, label: `${from}..${to}` })
const AUG = W('2026-08-01', '2026-08-31'), SEP = W('2026-09-01', '2026-09-30')
const H = v => Math.round(v * 100)

// ── 1) قاعدة مركزية للحالات المحتسبة ────────────────────────────────────────
const mixed = [
  sale('2026-09-02', 1150), sale('2026-09-03', 230, 'auto'), sale('2026-09-04', 575, 'pending'), sale('2026-09-05', 115, 'rejected'), sale('2026-09-06', 46, null),
  cost('2026-09-02', 100), cost('2026-09-03', 50, { status: 'auto' }), cost('2026-09-04', 500, { status: 'pending' }), cost('2026-09-05', 700, { status: 'rejected' }),
  cost('2026-09-06', 30, { status: null }),
]
test('1) قاعدة الحالات المحتسبة معلنة في مكان واحد: المعتمد والتلقائي فقط، وNULL غير محتسب', () => {
  assert.deepEqual(rules.COUNTED_STATUSES, ['approved', 'auto'])
  assert.equal(rules.isCounted({ status: 'approved' }), true)
  assert.equal(rules.isCounted({ status: 'auto' }), true)
  for (const s of ['pending', 'rejected', null, undefined, 'cancelled']) assert.equal(rules.isCounted({ status: s }), false)
})
test('1) المحرك (لوحة التحكم والتقارير) = التحليل بالهللة على قيود مختلطة الحالات، وغير المحتسب يُعاد منفصلًا', () => {
  const s = summarizeEntries(mixed)
  const f = windowFigures(mixed, SEP)
  assert.equal(H(s.totalSales), f.salesNetH); assert.equal(H(s.totalSales), 120000)
  assert.equal(H(s.totalExpenses), f.costsH); assert.equal(H(s.totalExpenses), 15000)
  assert.equal(s.uncounted.n, 6)
  assert.equal(s.uncounted.byStatus.pending.n, 2); assert.equal(s.uncounted.byStatus.rejected.n, 2); assert.equal(s.uncounted.byStatus.null.n, 2)
})
test('1) تفصيل المصروفات والضريبة في التقارير والتصدير يتجاهلان غير المحتسب', () => {
  const x = expenseFigures({ entries: mixed, docItems: [], categoriesById: {}, engineSummary: summarizeEntries(mixed), data: null })
  assert.equal(H(x.mainRows.reduce((t, r) => t + r.total, 0)), 15000)
  const v = vatFigures({ entries: [...mixed, cost('2026-09-07', 115, { vat_amount: 15, status: 'pending' }), cost('2026-09-07', 23, { vat_amount: 3 })], docItems: [], outputVat: 0 })
  assert.equal(v.inputVat, 3)
})

// ── 2) دورة الشراء الآجل: مبلغ القيد ─────────────────────────────────────────
test('2) الشراء الآجل 115/15 = 100؛ سداده (خروج 115 ينقص الالتزام payable_out 115) = 0؛ سداد جزئي ثم الباقي = 0', () => {
  assert.equal(rules.expenseAmountNet({ payable_in: 115, vat_amount: 15 }), 100)
  assert.equal(rules.expenseAmountNet({ bank_out: 115, payable_out: 115 }), 0)
  assert.equal(rules.expenseAmountNet({ bank_out: 40, payable_out: 40 }) + rules.expenseAmountNet({ cash_out: 75, payable_out: 75 }), 0)
})
test('2) سداد يغطي جزءًا من فواتير تاريخية لم تدخل الدفتر: الجزء غير المسجل وحده تكلفة', () => {
  assert.equal(rules.expenseAmountNet({ bank_out: 115, payable_out: 15 }), 100)
})
test('2) مرتجع شراء آجل ينقص الالتزام (payable_out بلا خروج) = −الصافي', () => {
  assert.equal(rules.expenseAmountNet({ payable_out: 115, vat_amount: 15 }), -100)
})
test('2) الدورة كاملة بالمحرك: فاتورة في أغسطس وسداد جزئي في سبتمبر والباقي في أكتوبر: 100 مرة واحدة في أغسطس', () => {
  const inv = { id: id(), date: '2026-08-20', type: '🥩 تكلفة البضاعة المباعة', payable_in: 115, vat_amount: 15, status: 'approved' }
  const p1 = { id: id(), date: '2026-09-03', type: '🏪 سداد مورد', bank_out: 50, payable_out: 50, status: 'approved' }
  const p2 = { id: id(), date: '2026-10-03', type: '🏪 سداد مورد', cash_out: 65, payable_out: 65, status: 'approved' }
  const rows = [inv, p1, p2]
  assert.equal(windowFigures(rows, AUG).costsH, 10000)
  assert.equal(windowFigures(rows, SEP).costsH, 0)
  assert.equal(windowFigures(rows, W('2026-10-01', '2026-10-31')).costsH, 0)
  assert.equal(H(summarizeEntries(rows).totalExpenses), 10000)
  assert.equal(H(summarizeEntries(rows).payableBalance), 0)
})

// ── 3) التوزيع بالهللة ─────────────────────────────────────────────────────
const sum = a => a.reduce((t, r) => t + H(r.amount), 0)
test('3) 100 على ثلاثة بنود متساوية: الحصص بالهللة ومجموعها 100.00 بالضبط (والمرتجع −100.00)', () => {
  const e = { id: 'x', journal_number: 'J1', type: '🛒 مصروفات تشغيلية' }
  const items = [1, 2, 3].map(i => ({ id: 'i' + i, journal_number: 'J1', amount: 10, category_main: 'م' }))
  const pos = allocateEntry(e, 100, items)
  assert.deepEqual(pos.map(r => H(r.amount)), [3334, 3333, 3333]); assert.equal(sum(pos), 10000)
  assert.ok(pos.every(r => Number.isInteger(Math.round(r.amount * 100)) && Math.abs(r.amount * 100 - Math.round(r.amount * 100)) < 1e-6))
  const neg = allocateEntry(e, -100, items)
  assert.equal(sum(neg), -10000)
})
test('3) حصص متفاوتة، وهللة واحدة، وأكثر من فاتورة في البند: التفاصيل = الفرعي = الرئيسي = الإجمالي بالهللة', () => {
  const e = { id: 'y', journal_number: 'J2', type: '🛒 مصروفات تشغيلية' }
  const items = [7, 11, 13].map((a, i) => ({ id: 'k' + i, journal_number: 'J2', amount: a, category_main: 'م' }))
  assert.equal(sum(allocateEntry(e, 77.77, items)), 7777)
  assert.equal(sum(allocateEntry(e, 0.01, items)), 1)
  const cats = { m: { id: 'm', name: 'مصروفات تشغيلية' }, s: { id: 's', name: 'نظافة', parent_id: 'm' } }
  const mk = (jn, gross) => ({ e: { ...cost('2026-09-05', gross), journal_number: jn, category_id: 'm' },
    it: [1, 2, 3].map(i => ({ id: jn + i, journal_number: jn, category_id: 'm', subcategory_id: 's', amount: 1 })) })
  const a = mk('A', 100), b = mk('B', 50), c = mk('C', 0.02)
  const f = windowFigures([a.e, b.e, c.e, sale('2026-09-01', 1150)], SEP, { docItems: [...a.it, ...b.it, ...c.it], categoriesById: cats })
  const leaf = leavesOf(f).find(l => l.label === 'نظافة')
  const details = contribsFor(f, leaf.key).reduce((t, r) => t + H(r.amount), 0)
  assert.equal(details, leaf.h); assert.equal(leaf.h, 15002); assert.equal(f.mains[0].h, 15002); assert.equal(f.costsH, 15002)
})

// ── 4) تفاصيل ملاحظة تجاوز الهدف ───────────────────────────────────────────
test('4) ملاحظة تجاوز هدف رئيسي (بلا فرعي، وبفرعيات) وهدف فرعي: التفاصيل تجد قيود البند', () => {
  const cats = { m: { id: 'm', name: 'مصروفات تشغيلية', financial_class: 'opex' }, s1: { id: 's1', name: 'غاز', parent_id: 'm' }, s2: { id: 's2', name: 'كهرباء', parent_id: 'm' },
    q: { id: 'q', name: 'صيانة', financial_class: 'opex' } }
  const e1 = { ...cost('2026-09-02', 50, { financial_class: 'opex' }), journal_number: 'A', category_id: 'm' }
  const e2 = { ...cost('2026-09-03', 30, { financial_class: 'opex' }), journal_number: 'B', category_id: 'm' }
  const e3 = { ...cost('2026-09-04', 20, { financial_class: 'opex' }), journal_number: 'C', category_id: 'q' }
  const items = [{ id: 'a', journal_number: 'A', ledger_entry_id: e1.id, category_id: 'm', subcategory_id: 's1', amount: 50 },
    { id: 'b', journal_number: 'B', ledger_entry_id: e2.id, category_id: 'm', subcategory_id: 's2', amount: 30 }]
  const rows = [e1, e2, e3, sale('2026-09-01', 1150), sale('2026-08-01', 1150)]
  const t = (item_key) => ({ id: id(), item_key, branch: null, ratio: 0, active: true, effective_from: '2026-01-01', created_at: '2026-01-01' })
  const opts = { docItems: items, categoriesById: cats }
  const a = buildAnalysis(windowFigures(rows, SEP, opts), referenceOf('prev', [windowFigures(rows, AUG, opts)], '2026-01-01'),
    { targets: [t('id:m'), t('id:q'), t('id:m>id:s2')] })
  const cur = windowFigures(rows, SEP, opts)
  const rowsOf = note => note.detailKeys.flatMap(k => contribsFor(cur, k))
  const main = a.notes.find(x => x.kind === 'target_exceeded' && x.lineKey === 'id:m')
  const solo = a.notes.find(x => x.kind === 'target_exceeded' && x.lineKey === 'id:q')
  const sub = a.notes.find(x => x.kind === 'target_exceeded' && x.lineKey === 'id:m>id:s2')
  assert.equal(rowsOf(main).length, 2); assert.equal(rowsOf(main).reduce((s, r) => s + H(r.amount), 0), 8000)
  assert.equal(rowsOf(solo).length, 1); assert.equal(rowsOf(solo).reduce((s, r) => s + H(r.amount), 0), 2000)
  assert.equal(rowsOf(sub).length, 1); assert.equal(rowsOf(sub).reduce((s, r) => s + H(r.amount), 0), 3000)
})

// ── 5) نطاق الزمن ──────────────────────────────────────────────────────────
test('5أ) القيود بلا فرع تُعدّ داخل الفترة الحالية وحدها', () => {
  const nb = [{ date: '2026-08-15', total_amount: 900 }, { date: '2026-09-10', total_amount: 100 }]
  const a = buildAnalysis(windowFigures([sale('2026-09-01', 1150)], SEP), referenceOf('prev', [windowFigures([], AUG)], '2026-01-01'),
    { branch: 'أ', noBranchRows: nb })
  const l = a.limits.find(x => x.key === 'nobranch')
  assert.ok(l); assert.match(l.text, /^1 قيد/); assert.match(l.text, /100\.00/); assert.doesNotMatch(l.text, /1,000\.00/)
})
test('5ب) مدى الجلب يغطي نافذة الاتجاه كاملة: فترة 1–15 سبتمبر واليوم 10 أكتوبر ← الجلب حتى 30 سبتمبر', () => {
  const p = periods.resolvePeriods({ kind: 'custom', from: '2026-09-01', to: '2026-09-15' }, '2026-10-10')
  const r = periods.fetchRange(p, periods.trendMonths(p.cur.to, p.today, 6))
  assert.equal(r.to, '2026-09-30'); assert.ok(r.from <= p.baseline[2].from)
})

// ── 6) معيار الملاحظات ونص غيابها ───────────────────────────────────────────
test('6) تغيّر متناسب (النسبة ثابتة والمبلغ تضاعف): ملاحظة تغيّر مبلغ، والنص لا يدّعي ثبات المبالغ', () => {
  const rows = [sale('2026-08-01', 115000), cost('2026-08-02', 20000), sale('2026-09-01', 230000), cost('2026-09-02', 40000)]
  const a = buildAnalysis(windowFigures(rows, SEP), referenceOf('prev', [windowFigures(rows, AUG)], '2026-01-01'))
  const n = a.notes.find(x => x.label === 'مصروفات تشغيلية')
  assert.ok(n); assert.equal(n.row.diffH, 2000000)
  assert.equal(a.allSame, false)
})
test('6) تغيّر أقل من 0.05 نقطة بأثر مالي: ملاحظة ارتفاع نسبة، والقرار قبل التقريب', () => {
  const rows = [sale('2026-08-01', 115000), cost('2026-08-02', 20000), sale('2026-09-01', 115000), cost('2026-09-02', 20040)]
  const a = buildAnalysis(windowFigures(rows, SEP), referenceOf('prev', [windowFigures(rows, AUG)], '2026-01-01'))
  const n = a.notes.find(x => x.label === 'مصروفات تشغيلية')
  assert.ok(n); assert.equal(n.kind, 'ratio_up'); assert.equal(n.impactH, 4000)
})
test('6) ثبات حقيقي: لا ملاحظات، و«allSame» صحيح', () => {
  const rows = [sale('2026-08-01', 115000), cost('2026-08-02', 20000), sale('2026-09-01', 115000), cost('2026-09-02', 20000)]
  const a = buildAnalysis(windowFigures(rows, SEP), referenceOf('prev', [windowFigures(rows, AUG)], '2026-01-01'))
  assert.equal(a.notes.length, 0); assert.equal(a.allSame, true)
})

// ── 8) التصنيفات كاملة فوق حد الخادم ───────────────────────────────────────
test('8) التصنيفات تُجلب كاملة بترتيب ثابت فوق حد الخادم، والفشل خطأ ظاهر', async () => {
  const cats = Array.from({ length: 1305 }, (_, i) => ({ id: 'c' + String(i).padStart(4, '0'), name: 'تصنيف ' + i, parent_id: i > 1200 ? 'c0001' : null, financial_class: 'opex' }))
  const fake = (failCats) => ({
    rpc: async () => ({ data: { ok: true }, error: null }),
    from: table => {
      const st = { head: false }
      const b = {
        select: (_c, o) => { st.head = !!o?.head; return b }, eq: () => b, gte: () => b, lte: () => b, or: () => b, in: () => b, order: () => b,
        limit: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        range: (a, z) => Promise.resolve(table === 'categories' ? (failCats && a > 0 ? { data: null, error: { message: 'x' } } : { data: cats.slice(a, Math.min(z + 1, a + 500)), error: null }) : { data: [], error: null }),
        // طلب بلا range (كما كان): الخادم يقص عند حده
        then: (res, rej) => Promise.resolve(st.head ? { count: 0, error: null } : { data: table === 'categories' ? cats.slice(0, 500) : [], error: null }).then(res, rej),
      }
      return b
    },
  })
  const d = await loadAnalysisRows(fake(false), { projectId: 'p', from: '2026-09-01', to: '2026-09-30' })
  assert.equal(Object.keys(d.categoriesById).length, 1305)
  assert.ok(d.categoriesById.c1300)
  await assert.rejects(loadAnalysisRows(fake(true), { projectId: 'p', from: '2026-09-01', to: '2026-09-30' }), e => e.part === 'التصنيفات')
})
