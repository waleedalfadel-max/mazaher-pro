// ضريبة المخرجات لقيد مبيعات بلا ضريبة محفوظة: قاعدة واحدة (financeRules.salesVatBasis) بحسب حالة التسجيل الضريبي للمنشأة،
// تستعملها لوحة التحكم والتقارير والتصدير والتحليل المالي والقيود اليومية. بيانات اصطناعية فقط.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { salesVatBasis, salesVatOf, salesAmountNet, netSalesChannels, taxStatusOf, salesVatUndetermined, salesVatUndeterminedText,
  TAX_REGISTERED, TAX_UNREGISTERED } from '../src/lib/financeRules.js'
import { summarizeEntries } from '../src/lib/financeSummary.js'
import { salesFigures } from '../src/lib/reportFigures.js'
import { windowFigures, referenceOf, buildAnalysis } from '../src/lib/financialAnalysis.js'
import { journalPostings } from '../src/lib/journalPostings.js'
import { reportModel } from '../src/lib/reportExport.js'
import { loadAnalysisRows, AnalysisLoadError } from '../src/lib/analysisData.js'

const REG = TAX_REGISTERED, UNREG = TAX_UNREGISTERED
const settingsFor = status => (status === undefined ? {} : { onboarding: { tax: { status } } })
const base = { project_id: 'p1', date: '2026-09-05', status: 'approved', branch: 'الفرع' }
let seq = 0
const sale = (extra = {}) => ({ ...base, id: 's' + (++seq), journal_number: 'J' + seq, type: '💵 مبيعات كاش', cash_in: 1150, ...extra })
const r2 = n => Math.round(n * 100) / 100
const SEP = { from: '2026-09-01', to: '2026-09-30', days: 30, label: 'سبتمبر' }
const journalLines = (rows, status) => journalPostings(rows.map(r => (r.bank_in ? { ...r, bank_account_id: 'main' } : r)),
  { banks: [{ id: 'main', name: 'البنك' }], settings: settingsFor(status) })
const salesCredit = p => p.segments.flatMap(s => s.lines).filter(l => l.account === 'المبيعات').reduce((n, l) => n + l.credit - l.debit, 0)
const vatCredit = p => p.segments.flatMap(s => s.lines).filter(l => l.account.startsWith('ضريبة المبيعات')).reduce((n, l) => n + l.credit - l.debit, 0)

test('taxStatusOf: only the two known values; missing settings or any other value is unknown (null)', () => {
  assert.equal(taxStatusOf(settingsFor(REG)), REG)
  assert.equal(taxStatusOf(settingsFor(UNREG)), UNREG)
  for (const s of [undefined, null, {}, { onboarding: {} }, settingsFor(''), settingsFor('registered'), settingsFor('مسجّل'), settingsFor(null)])
    assert.equal(taxStatusOf(s), null)
})

test('salesVatBasis: no stored VAT → estimate only for registered, zero for unregistered, no estimate for unknown', () => {
  const row = sale({ output_vat_amount: null })
  const est = salesVatBasis(row, REG)
  assert.equal(est.basis, 'estimate'); assert.equal(r2(est.vat), 150)
  assert.equal(salesAmountNet(row, REG), 1150 / 1.15)
  assert.deepEqual(salesVatBasis(row, UNREG), { vat: 0, basis: 'unregistered' })
  assert.equal(salesAmountNet(row, UNREG), 1150)
  for (const unknown of [null, undefined, 'registered']) {
    assert.deepEqual(salesVatBasis(row, unknown), { vat: 0, basis: 'unknown' })
    assert.equal(salesAmountNet(row, unknown), 1150)
  }
  // غياب الحقل كليًا مثل NULL
  const { output_vat_amount, ...missing } = row
  assert.equal(salesVatBasis(missing, REG).basis, 'estimate'); assert.equal(salesVatBasis(missing, UNREG).basis, 'unregistered')
})

test('explicit output_vat_amount wins under every status: positive, explicit 0 and a negative correction', () => {
  for (const status of [REG, UNREG, null]) {
    assert.deepEqual(salesVatBasis(sale({ output_vat_amount: 120 }), status), { vat: 120, basis: 'explicit' })
    assert.equal(salesAmountNet(sale({ output_vat_amount: 120 }), status), 1030)
    // صفر مراجَع: ليس «بلا ضريبة» ولا يُستبدل بتقدير حتى للمنشأة المسجلة
    assert.deepEqual(salesVatBasis(sale({ output_vat_amount: 0 }), status), { vat: 0, basis: 'explicit' })
    assert.equal(salesAmountNet(sale({ output_vat_amount: 0 }), status), 1150)
    assert.equal(salesVatOf(sale({ cash_in: -115, output_vat_amount: -15 }), status), -15)
    assert.equal(salesAmountNet(sale({ cash_in: -115, output_vat_amount: -15 }), status), -100)
    // نص رقمي من القاعدة (numeric) يُقرأ رقمًا
    assert.deepEqual(salesVatBasis(sale({ output_vat_amount: '0' }), status), { vat: 0, basis: 'explicit' })
  }
  // تصحيح ضريبة بلا حركة نقدية يغيّر الصافي في قناته
  assert.deepEqual(netSalesChannels(sale({ type: '🏦 مبيعات شبكة', cash_in: 0, output_vat_amount: -12 }), UNREG), { cash: 0, bank: 12, apps: 0 })
})

test('netSalesChannels follows the status: registered estimates, unregistered and unknown keep the full amount', () => {
  const row = sale({ cash_in: 115, bank_in: 230, receivable_in: 345 })
  const reg = netSalesChannels(row, REG)
  assert.deepEqual([r2(reg.cash), r2(reg.bank), r2(reg.apps)], [100, 200, 300])
  assert.deepEqual(netSalesChannels(row, UNREG), { cash: 115, bank: 230, apps: 345 })
  assert.deepEqual(netSalesChannels(row, null), { cash: 115, bank: 230, apps: 345 })
})

// مجموعة واحدة تمر بكل المسارات: قيد بلا ضريبة، وقيد بضريبة صريحة، وقيد بصفر صريح، وقيد معلق لا يُحتسب
const mixed = () => [
  sale({ cash_in: 1150 }),
  sale({ type: '🏦 مبيعات شبكة', cash_in: 0, bank_in: 2300, output_vat_amount: 300 }),
  sale({ type: '🍔 مبيعات هنقر ستيشن', cash_in: 0, receivable_in: 575, output_vat_amount: 0 }),
  sale({ cash_in: 999, status: 'pending' }),
]
// المتوقع لكل حالة (بالهللات): الإجمالي 4,025؛ الصريح 300 + 0 دائمًا؛ والقيد بلا ضريبة يتبع الحالة
const EXPECTED = {
  [REG]: { net: 402500 - 30000 - 15000, vat: 30000 + 15000, undetermined: { n: 0, h: 0 } },
  [UNREG]: { net: 402500 - 30000, vat: 30000, undetermined: { n: 0, h: 0 } },
  unknown: { net: 402500 - 30000, vat: 30000, undetermined: { n: 1, h: 115000 } },
}

for (const status of [REG, UNREG, null]) {
  const key = status ?? 'unknown', exp = EXPECTED[key]
  test(`every path agrees for status ${key}: dashboard/report summary, report tab, export, analysis and journal`, () => {
    const rows = mixed()
    // لوحة التحكم والتقارير (getFinancialSummary → summarizeEntries)
    const sum = summarizeEntries(rows, { taxStatus: status })
    assert.equal(Math.round(sum.grossSales * 100), 402500)
    assert.equal(Math.round(sum.totalSales * 100), exp.net)
    assert.equal(Math.round(sum.outputVat * 100), exp.vat)
    assert.equal(sum.taxStatus, status)
    assert.deepEqual(sum.salesVatUndetermined, exp.undetermined)
    // تبويب المبيعات في التقارير (الفروع واليومي) من ملخص المحرك نفسه
    const s = salesFigures({ engineSummary: sum, selectedBranch: 'all', branches: ['الفرع'], from: SEP.from, to: SEP.to, prevEntries: [] })
    assert.equal(Math.round(s.curSales * 100), exp.net)
    assert.equal(Math.round(s.branchRows[0].sales * 100), exp.net)
    const d = s.dailyRows[0]
    assert.equal(Math.round((d.cash + d.bank + d.apps) * 100), exp.net)
    // التحليل المالي
    const f = windowFigures(rows, SEP, { taxStatus: status })
    assert.equal(f.salesGrossH, 402500); assert.equal(f.salesNetH, exp.net)
    assert.deepEqual(f.salesVatUndetermined, exp.undetermined)
    // القيود اليومية: المرحَّل منها يطابق الصافي والضريبة؛ غير المحددة تبقى بتنبيه ولا تُرحَّل
    const p = journalLines(rows, status)
    if (key === 'unknown') {
      const flagged = p.segments.filter(x => x.issues.includes('ضريبة المبيعات غير محددة'))
      assert.equal(flagged.length, 2)   // القيد المحتسب بلا ضريبة، والمعلق بلا ضريبة
      assert.ok(flagged.every(x => !x.lines.some(l => l.account.startsWith('المبيعات') || l.account.startsWith('ضريبة المبيعات'))))
      assert.equal(p.complete, false)
      // المرحَّل: الشبكة بضريبتها الصريحة (2,000 + 300) والتطبيق بصفرها الصريح (575)
      assert.equal(salesCredit(p), 200000 + 57500)
      assert.equal(vatCredit(p), 30000)
    } else {
      // المعلق لا يدخل أرقام المحرك؛ يُقارن المحتسب وحده
      const counted = journalLines(rows.filter(r => r.status === 'approved'), status)
      assert.equal(counted.complete, true)
      assert.equal(salesCredit(counted), exp.net)
      assert.equal(vatCredit(counted), exp.vat)
    }
  })
}

test('unknown status is never silent: visible note on dashboard/report text, export and analysis limits', () => {
  const rows = mixed()
  const sum = summarizeEntries(rows)   // بلا حالة = غير محددة
  const text = salesVatUndeterminedText(sum.salesVatUndetermined)
  assert.match(text, /ضريبة المبيعات غير محددة في 1 قيد مبيعات بإجمالي 1,150\.00/)
  assert.match(text, /حالة التسجيل الضريبي للمنشأة غير محددة/)
  assert.equal(salesVatUndeterminedText(summarizeEntries(rows, { taxStatus: REG }).salesVatUndetermined), null)
  assert.equal(salesVatUndeterminedText(summarizeEntries(rows, { taxStatus: UNREG }).salesVatUndetermined), null)
  const model = reportModel({ tab: 'sales', org: 'اصطناعي', from: SEP.from, to: SEP.to, branch: 'all', branches: [], engineSummary: sum,
    s: salesFigures({ engineSummary: sum, selectedBranch: 'all', branches: ['الفرع'], from: SEP.from, to: SEP.to, prevEntries: [] }) })
  assert.ok(JSON.stringify(model).includes('ضريبة المبيعات غير محددة'))
  const f = windowFigures(rows, SEP)
  const a = buildAnalysis(f, referenceOf('prev', [windowFigures([], { ...SEP, from: '2026-08-01', to: '2026-08-31' })], '2026-01-01'))
  assert.ok(a.limits.some(l => l.key === 'salesvat' && l.tone === 'warning'))
  assert.ok(!buildAnalysis(windowFigures(rows, SEP, { taxStatus: UNREG }), referenceOf('prev', [], '2026-01-01')).limits.some(l => l.key === 'salesvat'))
})

test('salesVatUndetermined counts only counted, non-excluded sales rows without stored VAT', () => {
  const rows = [sale(), sale({ status: 'pending' }), sale({ output_vat_amount: 0 }), sale({ type: '📥 تحصيل ذمم هنقر', cash_in: 500 }),
    { ...base, id: 'x', type: '🛒 مصروفات تشغيلية', cash_out: 50 }]
  assert.deepEqual(salesVatUndetermined(rows, null), { n: 1, h: 115000 })
  assert.deepEqual(salesVatUndetermined(rows, REG), { n: 0, h: 0 })
})

test('analysis load reads the tax status with the data and stops on a settings read failure (no silent unknown)', async () => {
  const fake = ({ settings = { data: { settings: settingsFor(UNREG) }, error: null } } = {}) => {
    const q = () => {
      const b = { select: () => b, eq: () => b, gte: () => b, lte: () => b, or: () => b, in: () => b, order: () => b,
        limit: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () => Promise.resolve(settings),
        range: () => Promise.resolve({ data: [], error: null }),
        then: (res, rej) => Promise.resolve({ data: [], count: 0, error: null }).then(res, rej) }
      return b
    }
    return { from: q }
  }
  assert.equal((await loadAnalysisRows(fake(), { projectId: 'p', from: SEP.from, to: SEP.to })).taxStatus, UNREG)
  assert.equal((await loadAnalysisRows(fake({ settings: { data: null, error: null } }), { projectId: 'p', from: SEP.from, to: SEP.to })).taxStatus, null)
  await assert.rejects(loadAnalysisRows(fake({ settings: { data: null, error: { message: 'down' } } }), { projectId: 'p', from: SEP.from, to: SEP.to }),
    e => e instanceof AnalysisLoadError && e.part === 'الإعدادات')
})

// حارس مصدر: لا مسار يحسب ضريبة المبيعات بلا حالة التسجيل، ولا تقدير 15% خارج القاعدة الواحدة
test('source guard: every sales-VAT call passes the tax status; no 1.15 estimate outside financeRules', () => {
  const files = []
  const walk = dir => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) { if (n !== 'prototype') walk(p) } else if (/\.(js|jsx)$/.test(n)) files.push(p) } }
  walk('src')
  const bad = []
  for (const p of files) {
    const src = readFileSync(p, 'utf8')
    for (const m of src.matchAll(/\b(salesAmountNet|salesVatOf|netSalesChannels|salesVatBasis|summarizeEntries)\(([^()]*)\)/g)) {
      if (/^export function/.test(src.slice(src.lastIndexOf('\n', m.index) + 1, m.index + m[0].length).trim())) continue
      if (!m[2].includes(',')) bad.push(`${p}: ${m[0]}`)
    }
    // استخراج ضريبة من إجمالي شامل بالقسمة على 1.15 (حدود ضريبة المشتريات net × 0.15 ليست تقديرًا للمبيعات)
    if (!p.endsWith('financeRules.js') && /\/\s*1\.15\b|\/\s*\(1 \+ VAT_RATE\)/.test(src)) bad.push(`${p}: 15% estimate outside financeRules`)
  }
  assert.deepEqual(bad, [])
})
