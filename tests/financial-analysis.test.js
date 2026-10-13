// اختبارات قبول التحليل المالي — الحسابات الخالصة بقيود وهمية (src/lib/financialAnalysis.js وanalysisPeriods.js وanalysisData.js).
// الأرقام للاختبار فقط. أرقام الحالات 1–12 من ملف المواصفات.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { windowFigures, referenceOf, buildAnalysis, leavesOf, targetFor, ratioOf, fmtPct, COUNTED_STATUSES } from '../src/lib/financialAnalysis.js'
import { resolvePeriods, todayIn, trendMonths } from '../src/lib/analysisPeriods.js'
import { loadAnalysisRows, checkAccess, AnalysisLoadError } from '../src/lib/analysisData.js'

let seq = 0
const id = () => `e${++seq}`
// مبيعات بصافي معلوم: المقبوض = الصافي × 1.15 (افتراض المحرك)
const sale = (date, net, extra = {}) => ({ id: id(), date, type: '💵 مبيعات كاش', cash_in: Math.round(net * 115) / 100, status: 'approved', ...extra })
const cost = (date, net, { type = '🛒 مصروفات تشغيلية', vat = 0, pay = 'bank_out', ...extra } = {}) =>
  ({ id: id(), date, type, [pay]: net + vat, vat_amount: vat, status: 'approved', ...extra })
const W = (from, to, extra = {}) => ({ from, to, days: Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1, label: `${from}..${to}`, ...extra })
const AUG = W('2026-08-01', '2026-08-31'), SEP = W('2026-09-01', '2026-09-30')
const leaf = (fig, label) => leavesOf(fig).find(l => l.label === label)
const row = (a, label) => a.lines.flatMap(l => l.children.map(c => ({ ...c, main: l.label }))).find(c => c.label === label || (c.leafOfMain && c.main === label))
const prevAnalysis = (rows, cur = SEP, prev = AUG, opts = {}) => {
  const c = windowFigures(rows, cur, opts), p = windowFigures(rows, prev, opts)
  return buildAnalysis(c, referenceOf('prev', [p], '2026-01-01'), opts)
}
// لا NaN ولا Infinity في أي رقم من النتيجة
const finite = (o, path = '') => {
  if (typeof o === 'number') assert.ok(Number.isFinite(o), `رقم غير صالح في ${path}: ${o}`)
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (k !== 'engine') finite(v, path + '.' + k)
}

test('1) تكلفة 20,000 من 100,000 ثم 27,000 من 100,000: 20% ثم 27%، +7 نقاط، +35%، فرق عن النسبة المرجعية +7,000', () => {
  const a = prevAnalysis([sale('2026-08-10', 100000), cost('2026-08-12', 20000, { type: '🥩 تكلفة البضاعة المباعة' }),
    sale('2026-09-10', 100000), cost('2026-09-12', 27000, { type: '🥩 تكلفة البضاعة المباعة' })])
  const r = row(a, 'تكلفة البضاعة المباعة')
  assert.equal(r.refPct, 20); assert.equal(r.curPct, 27); assert.equal(r.pp, 7)
  assert.equal(r.diffH, 700000); assert.equal(Math.round(r.rel * 100), 35); assert.equal(r.gapH, 700000)
  const n = a.notes[0]
  assert.equal(n.kind, 'ratio_up'); assert.equal(n.impactH, 700000)
  assert.match(n.title, /ارتفعت نسبة تكلفة البضاعة المباعة إلى المبيعات/)
})

test('2) رواتب ثابتة 20,000 والمبيعات من 100,000 إلى 80,000: +5 نقاط وفرق مبلغ صفر، والتفسير انخفاض المبيعات', () => {
  const pay = d => cost(d, 20000, { type: '💰 مصروفات ثابتة', category_sub: 'رواتب' })
  const a = prevAnalysis([sale('2026-08-05', 100000), pay('2026-08-27'), sale('2026-09-05', 80000), pay('2026-09-27')])
  const r = row(a, 'رواتب')
  assert.equal(r.refPct, 20); assert.equal(r.curPct, 25); assert.equal(r.pp, 5); assert.equal(r.diffH, 0)
  assert.equal(r.gapH, 400000)   // 20,000 − 20% × 80,000
  const n = a.notes.find(x => x.lineKey === r.key)
  assert.equal(n.kind, 'ratio_up')
  assert.match(n.explain, /المبلغ لم يتغيّر/); assert.match(n.explain, /صافي المبيعات انخفض/)
  assert.doesNotMatch(n.explain, /زاد المبلغ/)
  assert.ok(n.flags.some(f => f.includes('تكلفة دورية')))
})

test('3) خط الأساس = مجموع البند ÷ مجموع المبيعات (33,000 ÷ 200,000 = 16.5%) لا متوسط 10% و50% و20%', () => {
  const M = [W('2026-06-01', '2026-06-30'), W('2026-07-01', '2026-07-31'), W('2026-08-01', '2026-08-31')]
  const rows = [sale('2026-06-10', 100000), cost('2026-06-11', 10000), sale('2026-07-10', 10000), cost('2026-07-11', 5000),
    sale('2026-08-10', 90000), cost('2026-08-11', 18000), sale('2026-09-10', 100000), cost('2026-09-11', 16500)]
  const ref = referenceOf('baseline', M.map(w => windowFigures(rows, w)), '2026-01-01')
  assert.equal(ref.n, 3); assert.equal(ref.salesH, 20000000)
  const a = buildAnalysis(windowFigures(rows, SEP), ref)
  const r = row(a, 'مصروفات تشغيلية')
  assert.equal(r.refPct, 16.5); assert.equal(r.curPct, 16.5); assert.equal(r.pp, 0)
  assert.equal(r.refH, 1100000)   // متوسط المبلغ للفترة = 33,000 ÷ 3
  assert.equal(a.notes.filter(n => n.lineKey === r.key && n.kind === 'ratio_up').length, 0)
})

test('4) شراء آجل 115 منه ضريبة 15: صافي 100 مرة واحدة بتاريخ الفاتورة؛ وسداد حساب المورد يُحتسب مرة واحدة ظاهرًا ومعلَّمًا', () => {
  // المسار الأول: «آجل — باسم المورد» (قيد payable_in في الدفتر). لا مسار في التطبيق يسدده بقيد مصروف ثانٍ.
  const credit = cost('2026-08-20', 100, { type: '🥩 تكلفة البضاعة المباعة', vat: 15, pay: 'payable_in' })
  const aug = windowFigures([credit], AUG)
  assert.equal(aug.costsH, 10000); assert.equal(aug.cogsH, 10000)
  assert.equal(leaf(aug, 'تكلفة البضاعة المباعة').h, 10000)
  assert.equal(windowFigures([credit], SEP).costsH, 0)
  // المسار الثاني: فاتورة في حساب المورد (لا تدخل الدفتر) ثم «🏪 سداد مورد» من البنك: يُحتسب عند السداد مرة واحدة، بإجماليه
  const settle = { id: id(), date: '2026-09-03', type: '🏪 سداد مورد', bank_out: 115, vat_amount: 0, status: 'approved', journal_number: 'QD-1' }
  const sep = windowFigures([credit, settle], SEP)
  assert.equal(sep.costsH, 11500); assert.equal(sep.settlementH, 11500)
  const m = sep.mains.find(x => x.settlement)
  assert.ok(m); assert.equal(m.h, 11500)
  const a = buildAnalysis(sep, referenceOf('prev', [aug], '2026-01-01'))
  assert.ok(a.limits.some(l => l.key === 'settle'))
})

test('5) فاتورة مختلطة: البنود توزَّع ومجموعها = صافي القيد، بلا مضاعفة؛ وغير المصنف يبقى ظاهرًا', () => {
  const cats = { m1: { id: 'm1', name: 'تكلفة البضاعة المباعة', financial_class: 'cogs' }, s1: { id: 's1', name: 'لحوم ودواجن', parent_id: 'm1' },
    m2: { id: 'm2', name: 'مصروفات تشغيلية', financial_class: 'opex' }, s2: { id: 's2', name: 'نظافة', parent_id: 'm2' } }
  // المسار السابق: قيد واحد ببنوده عبر رقم القيد
  const legacy = { ...cost('2026-09-02', 200, { vat: 30 }), journal_number: 'QD-9' }
  const items = [
    { id: 'i1', journal_number: 'QD-9', category_id: 'm1', subcategory_id: 's1', amount: 115, description: 'لحم', category_main: 'تكلفة البضاعة المباعة' },
    { id: 'i2', journal_number: 'QD-9', category_id: 'm2', subcategory_id: 's2', amount: 115, description: 'منظفات', category_main: 'مصروفات تشغيلية' },
  ]
  // الاعتماد الجديد: قيد لكل تصنيف أساسي برقم القيد نفسه، وكل بند مربوط بقيده
  const v2a = { ...cost('2026-09-04', 50, { vat: 7.5, financial_class: 'cogs' }), journal_number: 'QD-10', category_id: 'm1' }
  const v2b = { ...cost('2026-09-04', 30, { vat: 4.5, financial_class: 'opex' }), journal_number: 'QD-10', category_id: 'm2' }
  items.push({ id: 'i3', journal_number: 'QD-10', ledger_entry_id: v2a.id, category_id: 'm1', subcategory_id: 's1', amount: 57.5 },
             { id: 'i4', journal_number: 'QD-10', ledger_entry_id: v2b.id, category_id: 'm2', subcategory_id: 's2', amount: 34.5 })
  const uncat = cost('2026-09-05', 40, { type: '' })
  const f = windowFigures([legacy, v2a, v2b, uncat, sale('2026-09-01', 1000)], SEP, { docItems: items, categoriesById: cats })
  assert.equal(f.costsH, 32000)   // 200 + 50 + 30 + 40، لا إجمالي الفاتورة مرة ومجموع بنودها مرة
  assert.equal(leaf(f, 'لحوم ودواجن').h, 15000)
  assert.equal(leaf(f, 'نظافة').h, 13000)
  assert.equal(f.mains.reduce((s, m) => s + m.h, 0), f.costsH)
  assert.equal(f.uncategorizedH, 4000)
  assert.ok(f.mains.find(m => m.uncategorized))
  // الربط بالمعرّف الثابت: إعادة تسمية التصنيف لا تفصل البند
  const renamed = { ...cats, s1: { ...cats.s1, name: 'لحوم' } }
  const g = windowFigures([legacy, v2a], SEP, { docItems: items, categoriesById: renamed })
  assert.equal(leaf(g, 'لحوم').h, 15000)
})

test('6) التحصيل والتحويل والمسحوبات وأصل القرض لا ترفع المبيعات ولا التكاليف؛ المرتجع ينقص بنده؛ المرفوض والمعلق غير محتسبين', () => {
  const rows = [sale('2026-09-01', 1000),
    { id: id(), date: '2026-09-02', type: '📥 تحصيل ذمم هنقر', bank_in: 500, status: 'approved' },
    { id: id(), date: '2026-09-02', type: '🔄 تحويل داخلي — صرف عهدة', bank_out: 300, custody_in: 300, status: 'approved' },
    { id: id(), date: '2026-09-03', type: 'مسحوبات الشركاء', cash_out: 200, status: 'approved' },
    { id: id(), date: '2026-09-04', type: '💳 قرض ١', bank_out: 700, status: 'approved' },
    cost('2026-09-05', 100, { type: '🥩 تكلفة البضاعة المباعة', vat: 15 }),
    { id: id(), date: '2026-09-06', type: '🥩 تكلفة البضاعة المباعة', cash_in: 23, vat_amount: 3, status: 'approved' },   // مرتجع
    { ...cost('2026-09-07', 900), status: 'rejected' },
    { ...sale('2026-09-07', 900), status: 'pending' },
    { ...cost('2026-09-08', 50), status: null }]
  const f = windowFigures(rows, SEP)
  assert.equal(f.salesNetH, 100000)
  assert.equal(f.costsH, 8000)   // 100 − 20 مرتجع
  assert.equal(f.withdrawalsH, 20000); assert.equal(f.debtsH, 70000)
  assert.equal(f.uncounted.rejected.n, 1); assert.equal(f.uncounted.pending.n, 1); assert.equal(f.uncounted.null.n, 1)
  assert.equal(f.n, 7)
  // المحتسب يطابق المحرك نفسه على القيود المعتمدة
  assert.equal(Math.round(f.engine.totalSales * 100), f.salesNetH)
  assert.equal(Math.round(f.engine.totalExpenses * 100), f.costsH)
  const a = buildAnalysis(f, referenceOf('prev', [windowFigures(rows, AUG)], '2026-01-01'))
  assert.ok(a.limits.some(l => l.key === 'status' && /مرفوض/.test(l.text) && /معلّق/.test(l.text)))
  assert.ok(a.limits.some(l => l.key === 'finance' && /رسوم التمويل/.test(l.text)))
})

test('7) بلا مخزون: «مشتريات المواد» لا تكلفة استهلاك ولا هدر؛ دفعة إيجار سنوية لا تتوزع', () => {
  const rent = cost('2026-09-01', 120000, { type: '💰 مصروفات ثابتة', category_sub: 'إيجار' })
  const rows = [sale('2026-08-05', 100000), cost('2026-08-06', 30000, { type: '🥩 تكلفة البضاعة المباعة' }),
    sale('2026-09-05', 100000), cost('2026-09-06', 31000, { type: '🥩 تكلفة البضاعة المباعة' }), rent]
  const a = prevAnalysis(rows)
  assert.equal(row(a, 'إيجار').curH, 12000000)
  assert.ok(a.notes.find(n => n.label.startsWith('إيجار')).flags.some(f => f.includes('لا توزيع على الأشهر')))
  assert.ok(a.limits.some(l => l.key === 'inventory'))
  const all = JSON.stringify(a.notes)
  assert.doesNotMatch(all, /هدر|سرقة|استهلاك فعلي/)
  assert.ok(a.notes.find(n => n.label === 'تكلفة البضاعة المباعة').flags.some(f => f.includes('لا تكلفة استهلاك')))
})

test('8) الضريبة: الخاضع بصافيه، وغير الخاضع بكامله، وسداد الضريبة للهيئة خارج التكاليف، والافتراض ظاهر', () => {
  const rows = [sale('2026-09-01', 1000),
    cost('2026-09-02', 100, { vat: 15 }), cost('2026-09-03', 80, { vat: 0 }),
    { id: id(), date: '2026-09-04', type: '🏛️ ضريبة القيمة المضافة', bank_out: 500, vat_amount: 0, status: 'approved' }]
  const f = windowFigures(rows, SEP)
  assert.equal(f.salesGrossH, 115000); assert.equal(f.salesNetH, 100000)
  assert.equal(f.costsH, 18000); assert.equal(f.taxOutH, 50000)
  const a = buildAnalysis(f, referenceOf('prev', [windowFigures(rows, AUG)], '2026-01-01'))
  assert.ok(a.limits.some(l => l.key === 'vat' && /افتراض/.test(l.text)))
})

test('9) مبيعات صفر أو سالبة، مرجع صفر، خسارة إلى ربح، بيانات ناقصة: لا NaN/Infinity ولا ملاحظة مضللة', () => {
  // مبيعات صفر في الفترة الحالية
  const z = prevAnalysis([sale('2026-08-05', 1000), cost('2026-08-06', 100), cost('2026-09-06', 150)])
  finite(z)
  assert.equal(z.costs.curPct, null); assert.equal(fmtPct(z.costs.curPct), 'غير متاح')
  assert.equal(ratioOf(100, 0), null); assert.equal(ratioOf(100, -5), null)
  assert.ok(z.notes.some(n => n.kind === 'amount_up'))
  // بند جديد: مرجع صفر → لا نسبة نمو
  const nw = prevAnalysis([sale('2026-08-05', 1000), sale('2026-09-05', 1000), cost('2026-09-06', 50, { type: '🧽 نظافة' })])
  const r = row(nw, 'نظافة')
  assert.equal(r.rel, null); assert.equal(nw.notes.find(n => n.lineKey === r.key).kind, 'new'); finite(nw)
  // خسارة ثم ربح: لا نسبة تغير للنتيجة، ولا ملاحظة انخفاض هامش
  const lp = prevAnalysis([sale('2026-08-05', 1000), cost('2026-08-06', 1500), sale('2026-09-05', 1000), cost('2026-09-06', 500)])
  assert.equal(lp.result.rel, null); assert.ok(!lp.notes.some(n => n.kind === 'margin_down')); finite(lp)
  // ربح ثم خسارة: ملاحظة بالقيم لا بنسبة
  const pl = prevAnalysis([sale('2026-08-05', 1000), cost('2026-08-06', 500), sale('2026-09-05', 1000), cost('2026-09-06', 1500)])
  assert.equal(pl.result.rel, null); assert.match(pl.notes.find(n => n.kind === 'margin_down').explain, /لا تُحسب نسبة تغيّر/)
  // بيانات ناقصة: المقارنة قبل بداية السجل → لا ملاحظات ولا «لا توجد مشكلات»
  const cur = windowFigures([sale('2026-09-05', 1000), cost('2026-09-06', 900)], SEP)
  const none = buildAnalysis(cur, referenceOf('prev', [windowFigures([], AUG)], '2026-09-05'))
  assert.equal(none.refValid, false); assert.equal(none.notes.length, 0)
  assert.ok(none.limits.some(l => l.key === 'ref' && /قبل بداية السجل/.test(l.text)))
  // مبيعات سالبة (قيد مبيعات بمبلغ سالب): نسبة غير متاحة
  const neg = windowFigures([{ id: id(), date: '2026-09-02', type: '💵 مبيعات كاش', cash_in: -115, status: 'approved' }, cost('2026-09-03', 10)], SEP)
  const na = buildAnalysis(neg, referenceOf('prev', [windowFigures([sale('2026-08-02', 100)], AUG)], '2026-01-01'))
  assert.equal(na.costs.curPct, null); finite(na)
})

test('10) الفترات: شهر جزئي بأيام مقابلة، فبراير والسنة الكبيسة، فترة تعبر السنة، توقيت المنشأة، ولا أيام مستقبلية', () => {
  const m = resolvePeriods({ kind: 'mtd' }, '2026-10-10')
  assert.deepEqual([m.cur.from, m.cur.to, m.prev.from, m.prev.to], ['2026-10-01', '2026-10-10', '2026-09-01', '2026-09-10'])
  const leap = resolvePeriods({ kind: 'mtd' }, '2024-03-30')
  assert.deepEqual([leap.prev.from, leap.prev.to, leap.prev.clipped], ['2024-02-01', '2024-02-29', 1])
  const nonLeap = resolvePeriods({ kind: 'mtd' }, '2025-03-31')
  assert.deepEqual([nonLeap.prev.to, nonLeap.prev.clipped], ['2025-02-28', 3])
  const feb = resolvePeriods({ kind: 'last_month' }, '2024-03-10')
  assert.deepEqual([feb.cur.from, feb.cur.to, feb.cur.days, feb.prev.days], ['2024-02-01', '2024-02-29', 29, 31])
  const jan = resolvePeriods({ kind: 'last_month' }, '2026-01-15')
  assert.deepEqual([jan.cur.from, jan.prev.from, jan.baseline.map(b => b.from)], ['2025-12-01', '2025-11-01', ['2025-11-01', '2025-10-01', '2025-09-01']])
  const cross = resolvePeriods({ kind: 'custom', from: '2025-12-20', to: '2026-01-05' }, '2026-02-01')
  assert.deepEqual([cross.prev.from, cross.prev.to, cross.prev.days, cross.cur.days], ['2025-12-03', '2025-12-19', 17, 17])
  for (const p of [m, leap, feb, jan, cross]) {
    assert.ok(p.prev.to < p.cur.from, 'لا تداخل بين الفترتين')
    for (const b of p.baseline) assert.ok(b.to < p.cur.from && b.to <= p.today, 'خط الأساس قبل الفترة ولا أيام مستقبلية')
  }
  assert.equal(resolvePeriods({ kind: 'custom', from: '2026-10-01', to: '2026-10-11' }, '2026-10-10').code, 'future')
  assert.equal(resolvePeriods({ kind: 'custom', from: '2026-10-05', to: '2026-10-01' }, '2026-10-10').code, 'reversed')
  assert.equal(resolvePeriods({ kind: 'month', year: 2026, month: 11 }, '2026-10-10').code, 'future')
  assert.equal(resolvePeriods({ kind: 'month', year: 2026, month: 10 }, '2026-10-10').cur.to, '2026-10-10')
  // منتصف الليل: 21:30 بتوقيت غرينتش يوم 30 سبتمبر = 1 أكتوبر في الرياض
  assert.equal(todayIn('Asia/Riyadh', new Date('2026-09-30T21:30:00Z')), '2026-10-01')
  assert.equal(todayIn('Asia/Riyadh', new Date('2026-09-30T20:59:00Z')), '2026-09-30')
  const t = trendMonths('2026-10-10', '2026-10-10', 6)
  assert.equal(t.length, 6); assert.equal(t.at(-1).to, '2026-10-10'); assert.equal(t.at(-1).partial, true)
})

test('11) كل الفروع من المجاميع لا متوسط نسب الفروع', () => {
  const rows = [sale('2026-09-01', 100000, { branch: 'أ' }), cost('2026-09-02', 10000, { branch: 'أ' }),
    sale('2026-09-01', 10000, { branch: 'ب' }), cost('2026-09-02', 5000, { branch: 'ب' })]
  const f = windowFigures(rows, SEP)
  const a = buildAnalysis(f, referenceOf('prev', [windowFigures(rows, AUG)], '2026-01-01'))
  assert.equal(a.costs.curPct, 13.64)   // 15,000 ÷ 110,000، لا (10% + 50%) ÷ 2
})

test('11ب) الجلب يكمل ما فوق حد الصفحة وحد الخادم الأصغر، والفشل خطأ باسمه لا بيانات ناقصة', async () => {
  const many = Array.from({ length: 2345 }, (_, i) => ({ id: 'r' + i, date: '2026-09-01', type: '💵 مبيعات كاش', cash_in: 1.15, status: 'approved', journal_number: null }))
  const fake = ({ cap = 1000, failTable } = {}) => {
    const q = table => {
      const st = { table, head: false }
      const b = {
        select: (_c, o) => { st.head = !!o?.head; return b }, eq: () => b, gte: () => b, lte: () => b, or: () => b, in: () => b, order: () => b,
        limit: () => Promise.resolve(failTable === table ? { error: { message: 'x' } } : { data: table === 'ledger_entries' ? [{ date: '2026-09-01' }] : [], error: null }),
        maybeSingle: () => Promise.resolve({ data: { settings: { branches: ['أ'] } }, error: null }),
        range: (a, z) => Promise.resolve(failTable === table ? { data: null, error: { message: 'down' } }
          : { data: table === 'ledger_entries' ? many.slice(a, Math.min(z + 1, a + cap)) : [], error: null }),
        then: (res, rej) => Promise.resolve(failTable === table ? { error: { message: 'x' } } : st.head ? { count: 3, error: null } : { data: [], error: null }).then(res, rej),
      }
      return b
    }
    return { from: q, rpc: async () => ({ data: { ok: true }, error: null }) }
  }
  const d = await loadAnalysisRows(fake({ cap: 400 }), { projectId: 'p', from: '2026-09-01', to: '2026-09-30' })
  assert.equal(d.rows.length, 2345); assert.equal(d.pendingDocs, 3); assert.equal(d.dataStart, '2026-09-01')
  assert.equal(windowFigures(d.rows, SEP).salesNetH, 234500)
  await assert.rejects(loadAnalysisRows(fake({ failTable: 'ledger_entries' }), { projectId: 'p', from: '2026-09-01', to: '2026-09-30' }),
    e => e instanceof AnalysisLoadError && e.part === 'القيود')
  await assert.rejects(loadAnalysisRows(fake({ failTable: 'categories' }), { projectId: 'p', from: '2026-09-01', to: '2026-09-30' }),
    e => e instanceof AnalysisLoadError && e.part === 'التصنيفات')
  await assert.rejects(checkAccess({ rpc: async () => ({ data: null, error: { message: 'Failed to fetch' } }) }, 'p'), AnalysisLoadError)
})

test('12) الهدف لا يُطبَّق قبل سريانه، والصفر هدف يختلف عن عدم الضبط، والتعطيل يلغيه من تاريخه، والفرع نطاق مستقل', () => {
  const t = (over) => ({ id: id(), item_key: 'costs_total', branch: null, ratio: 30, active: true, effective_from: '2026-09-01', created_at: '2026-09-01T00:00:00Z', ...over })
  assert.equal(targetFor([t({ effective_from: '2026-09-15' })], 'costs_total', 'all', SEP).target, null)
  assert.ok(targetFor([t({ effective_from: '2026-09-15' })], 'costs_total', 'all', SEP).startsInside)
  assert.equal(targetFor([t({})], 'costs_total', 'all', SEP).target.ratio, 30)
  assert.equal(targetFor([], 'costs_total', 'all', SEP).target, null)
  assert.equal(targetFor([t({}), t({ active: false, ratio: null, effective_from: '2026-09-01', created_at: '2026-09-02T00:00:00Z' })], 'costs_total', 'all', SEP).target, null)
  assert.equal(targetFor([t({}), t({ ratio: 25, effective_from: '2026-10-01' })], 'costs_total', 'all', SEP).target.ratio, 30, 'هدف لاحق لا يغير فترة سابقة')
  assert.equal(targetFor([t({ branch: 'أ' })], 'costs_total', 'all', SEP).target, null)
  assert.equal(targetFor([t({ branch: 'أ' })], 'costs_total', 'أ', SEP).target.ratio, 30)
  const rows = [sale('2026-08-05', 1000), cost('2026-08-06', 100), sale('2026-09-05', 1000), cost('2026-09-06', 100)]
  const zero = prevAnalysis(rows, SEP, AUG, { targets: [t({ ratio: 0 })] })
  const z = zero.notes.find(n => n.kind === 'target_exceeded' && n.lineKey === 'costs_total')
  assert.ok(z); assert.match(z.title, /تجاوز الهدف المحدد للمنشأة/); assert.equal(z.impactH, 10000)
  assert.doesNotMatch(JSON.stringify(zero.notes), /المعدل الطبيعي|القطاع/)
  const unset = prevAnalysis(rows)
  assert.ok(!unset.notes.some(n => n.kind === 'target_exceeded')); assert.equal(unset.targetRows.length, 0)
})

test('الترتيب: الأثر السلبي أولًا بالريال، ثم بقية التغيرات؛ الأب لا يُحسب فوق أبنائه', () => {
  const rows = [sale('2026-08-05', 100000), sale('2026-09-05', 100000),
    cost('2026-08-06', 1000, { type: '🛒 مصروفات تشغيلية', category_sub: 'غاز' }), cost('2026-09-06', 3000, { type: '🛒 مصروفات تشغيلية', category_sub: 'غاز' }),
    cost('2026-08-06', 5000, { type: '🛒 مصروفات تشغيلية', category_sub: 'كهرباء' }), cost('2026-09-06', 9000, { type: '🛒 مصروفات تشغيلية', category_sub: 'كهرباء' }),
    cost('2026-08-07', 4000, { type: '🧰 صيانة' }), cost('2026-09-07', 1000, { type: '🧰 صيانة' })]
  const a = prevAnalysis(rows)
  const lineNotes = a.notes.filter(n => n.kind !== 'margin_down')
  assert.deepEqual(lineNotes.map(n => n.label), ['كهرباء (مصروفات تشغيلية)', 'غاز (مصروفات تشغيلية)', 'صيانة'])
  assert.deepEqual(lineNotes.map(n => n.adverse), [true, true, false])
  assert.ok(a.notes.findIndex(n => n.kind === 'margin_down') < a.notes.findIndex(n => !n.adverse), 'الهامش ضمن الأثر السلبي')
  assert.ok(!a.notes.some(n => n.label === 'مصروفات تشغيلية'), 'لا ملاحظة للأب مع أبنائه')
  assert.match(lineNotes[2].explain, /لا يثبت تحسنًا/)
  assert.ok(COUNTED_STATUSES.includes('approved'))
})

test('الفرعي المحفوظ بالاسم في قيد سابق يُربط بمعرّف الفرعي الوحيد بالاسم نفسه تحت رئيسيه (صف واحد)', () => {
  const cats = { m1: { id: 'm1', name: 'تكلفة البضاعة المباعة', financial_class: 'cogs' }, s1: { id: 's1', name: 'خضار وفواكه', parent_id: 'm1' } }
  const v2 = { ...cost('2026-09-02', 100, { financial_class: 'cogs' }), journal_number: 'QD-1', category_id: 'm1' }
  const items = [{ id: 'i1', journal_number: 'QD-1', ledger_entry_id: v2.id, category_id: 'm1', subcategory_id: 's1', amount: 100 }]
  const legacy = { ...cost('2026-09-03', 50, { type: '🥩 تكلفة البضاعة المباعة', financial_class: 'cogs' }), category_id: 'm1', category_sub: '🥬 خضار وفواكه' }
  const f = windowFigures([v2, legacy], SEP, { docItems: items, categoriesById: cats })
  const subs = f.mains.find(m => m.key === 'id:m1|cogs').subs
  assert.equal(subs.length, 1); assert.equal(subs[0].label, 'خضار وفواكه'); assert.equal(subs[0].h, 15000)
})
