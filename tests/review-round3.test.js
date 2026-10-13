// جولة المراجعة الثالثة (ChatGPT، مراجعة الجولة 2): R2-02 ضريبة المرتجع، R2-04 نطاق الهدف وتفاصيله.
// (R2-01 وR2-03 في local-test/credit-cycle.test.sql وpayment-concurrency.mjs وold-client-payment.mjs؛ R2-05 وR2-06 في اختبارات الواجهة؛ R2-07 في history-inventory.test.sql)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { vatFigures } from '../src/lib/vatTreatment.js'
import { summarizeEntries } from '../src/lib/financeSummary.js'
import { windowFigures, referenceOf, buildAnalysis, contribsFor } from '../src/lib/financialAnalysis.js'

let n = 0
const id = () => `x${++n}`
const H = v => Math.round(v * 100)
const ent = (date, o) => ({ id: id(), date, type: '🥩 تكلفة البضاعة المباعة', status: 'approved', ...o })
const W = (from, to) => ({ from, to, days: Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1, label: from })
const AUG = W('2026-08-01', '2026-08-31'), SEP = W('2026-09-01', '2026-09-30')
const vatIn = rows => H(vatFigures({ entries: rows, docItems: [], outputVat: 0 }).inputVat)
const cost = rows => H(summarizeEntries(rows).totalExpenses)
const liab = rows => H(summarizeEntries(rows).payableBalance)

// ── R2-02: ضريبة المرتجع تُعكس مع تكلفته ─────────────────────────────────────
test('R2-02 شراء آجل 115/15 ثم مرتجع كامل في الشهر نفسه: التكلفة 0 والالتزام 0 وضريبة المدخلات 0', () => {
  const rows = [ent('2026-09-02', { payable_in: 115, vat_amount: 15 }), ent('2026-09-20', { payable_out: 115, vat_amount: 15 })]
  assert.equal(cost(rows), 0); assert.equal(liab(rows), 0); assert.equal(vatIn(rows), 0)
})
test('R2-02 مرتجع جزئي 57.50/7.50: التكلفة 50 والالتزام 57.50 وضريبة المدخلات 7.50', () => {
  const rows = [ent('2026-09-02', { payable_in: 115, vat_amount: 15 }), ent('2026-09-20', { payable_out: 57.5, vat_amount: 7.5 })]
  assert.equal(cost(rows), 5000); assert.equal(liab(rows), 5750); assert.equal(vatIn(rows), 750)
})
test('R2-02 مرتجع في شهر لاحق: الشهر الأول 100/15، والثاني −100/−15، وتفاصيل الضريبة بإشارتها', () => {
  const buy = ent('2026-08-20', { payable_in: 115, vat_amount: 15 }), back = ent('2026-09-05', { payable_out: 115, vat_amount: 15 })
  assert.equal(cost([buy]), 10000); assert.equal(vatIn([buy]), 1500)
  assert.equal(cost([back]), -10000); assert.equal(vatIn([back]), -1500)
  const v = vatFigures({ entries: [back], docItems: [], outputVat: 0 })
  assert.equal(v.inputVatEntries.length, 1); assert.equal(H(v.inputVatEntries[0].signedVat), -1500); assert.equal(H(v.inputVatEntries[0].signedGross), -11500)
})
test('R2-02 مرتجع نقدي (دخول 115 منه 15): التكلفة −100 وضريبة المدخلات −15', () => {
  const rows = [ent('2026-09-05', { cash_in: 115, vat_amount: 15 })]
  assert.equal(cost(rows), -10000); assert.equal(vatIn(rows), -1500)
})
test('R2-02 ضريبة على قيد بلا أي مبلغ: لا تُخمَّن (لا تدخل المدخلات وتُعرض للمراجعة)', () => {
  const v = vatFigures({ entries: [ent('2026-09-05', { vat_amount: 15 })], docItems: [], outputVat: 0 })
  assert.equal(H(v.inputVat), 0); assert.equal(v.review.length, 1); assert.equal(v.review[0].reason, 'vat_no_amount')
})
test('R2-02 الشراء العادي كما كان: نقدي 115/15 ← مدخلات 15، وآجل ← 15', () => {
  assert.equal(vatIn([ent('2026-09-02', { cash_out: 115, vat_amount: 15 })]), 1500)
  assert.equal(vatIn([ent('2026-09-02', { payable_in: 115, vat_amount: 15 })]), 1500)
})

// ── R2-04: الهدف للبند مرة واحدة ولو تعدّدت معالجته المالية المحفوظة ─────────────
test('R2-04 بند واحد بقيود cogs 300 وopex 200، مبيعات 1,000 وهدف 10%: ملاحظة واحدة 50% وفارق 400، وتفاصيلها 500', () => {
  const cats = { m: { id: 'm', name: 'لحوم', financial_class: 'opex' } }
  const rows = [
    ent('2026-09-02', { cash_out: 300, financial_class: 'cogs', category_id: 'm' }),
    ent('2026-09-03', { cash_out: 200, financial_class: 'opex', category_id: 'm', type: '🛒 مصروفات تشغيلية' }),
    ent('2026-09-01', { type: '💵 مبيعات كاش', cash_in: 1150 }), ent('2026-08-01', { type: '💵 مبيعات كاش', cash_in: 1150 }),
  ]
  const opts = { categoriesById: cats, docItems: [] }
  const cur = windowFigures(rows, SEP, opts)
  const a = buildAnalysis(cur, referenceOf('prev', [windowFigures(rows, AUG, opts)], '2026-01-01'),
    { targets: [{ id: 't', item_key: 'id:m', branch: null, ratio: 10, active: true, effective_from: '2020-01-01', created_at: '2020-01-01' }] })
  const notes = a.notes.filter(x => x.kind === 'target_exceeded')
  assert.equal(notes.length, 1)
  assert.equal(notes[0].impactH, 40000)
  assert.match(notes[0].explain, /50\.0%/)
  assert.equal(notes[0].detailKeys.flatMap(k => contribsFor(cur, k)).reduce((t, r) => t + H(r.amount), 0), 50000)
  assert.equal(new Set(a.notes.map(x => x.kind + '|' + x.lineKey)).size, a.notes.length, 'مفاتيح الملاحظات فريدة')
  const tr = a.targetRows.filter(t => t.itemKey === 'id:m')
  assert.equal(tr.length, 1); assert.equal(tr[0].curPct, 50)
})
test('R2-04 الفرعي بمعالجتين: هدف الفرعي يقيّم مجموعه مرة واحدة', () => {
  const cats = { m: { id: 'm', name: 'لحوم', financial_class: 'opex' }, s: { id: 's', name: 'غنم', parent_id: 'm' } }
  const e1 = ent('2026-09-02', { cash_out: 300, financial_class: 'cogs', category_id: 'm', journal_number: 'J1' })
  const e2 = ent('2026-09-03', { cash_out: 200, financial_class: 'opex', category_id: 'm', journal_number: 'J2' })
  const items = [{ id: 'i1', journal_number: 'J1', ledger_entry_id: e1.id, category_id: 'm', subcategory_id: 's', amount: 300 },
    { id: 'i2', journal_number: 'J2', ledger_entry_id: e2.id, category_id: 'm', subcategory_id: 's', amount: 200 }]
  const rows = [e1, e2, ent('2026-09-01', { type: '💵 مبيعات كاش', cash_in: 1150 }), ent('2026-08-01', { type: '💵 مبيعات كاش', cash_in: 1150 })]
  const opts = { categoriesById: cats, docItems: items }
  const cur = windowFigures(rows, SEP, opts)
  const a = buildAnalysis(cur, referenceOf('prev', [windowFigures(rows, AUG, opts)], '2026-01-01'),
    { targets: [{ id: 't', item_key: 'id:m>id:s', branch: null, ratio: 10, active: true, effective_from: '2020-01-01', created_at: '2020-01-01' }] })
  const notes = a.notes.filter(x => x.kind === 'target_exceeded')
  assert.equal(notes.length, 1); assert.equal(notes[0].impactH, 40000)
  assert.equal(notes[0].detailKeys.flatMap(k => contribsFor(cur, k)).reduce((t, r) => t + H(r.amount), 0), 50000)
})
