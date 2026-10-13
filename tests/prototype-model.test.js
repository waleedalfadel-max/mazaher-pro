import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockState } from '../src/prototype/data/mock.js'
import {
  applyApproval, applyRejection, applySave, approvalState, docTotals, expenseBreakdown, filterDocuments, inRange,
  needsAction, normalizeRef, periodRange, reviewAlerts, round2, summarize,
} from '../src/prototype/model.js'

const month = periodRange('month')
const pendingBy = (state, pred) => state.documents.find(d => d.status === 'pending' && pred(d))

test('كل مستند معتمد يدخل بطاقة واحدة فقط: المشتريات لا تتكرر داخل المصروفات', () => {
  const state = createMockState()
  for (const range of [periodRange('month'), periodRange('last-month'), periodRange('week')]) {
    const s = summarize(state, range)
    const approved = state.documents.filter(d => d.status === 'approved' && inRange(d.invoiceDate, range))
    const purchases = approved.filter(d => d.kind === 'purchase')
    const expenses = approved.filter(d => d.kind === 'expense')
    assert.equal(purchases.filter(d => expenses.includes(d)).length, 0)
    assert.equal(s.purchases.amount, round2(purchases.reduce((t, d) => t + docTotals(d).subtotal, 0)))
    assert.equal(s.expenses.amount, round2(expenses.reduce((t, d) => t + docTotals(d).subtotal, 0)))
    assert.equal(expenseBreakdown(state, range).total, s.expenses.amount, 'ملخص المصروفات يطابق بطاقتها')
  }
})

test('غير المعتمد لا يدخل أي رقم، والانتظار يُعد من كل التواريخ', () => {
  const state = createMockState()
  const before = summarize(state, month)
  const doc = pendingBy(state, d => d.kind === 'expense' && reviewAlerts(d, state).every(a => !a.blocking && !a.needsConfirm))
  const { state: rejected } = applyRejection(state, doc.id, { reason: 'unclear' })
  const after = summarize(rejected, month)
  assert.equal(after.expenses.amount, before.expenses.amount)
  assert.equal(after.waiting.count, before.waiting.count - 1)
  assert.equal(summarize(state, periodRange('today')).waiting.count, before.waiting.count)
})

test('تقرير الإغلاق يُحسب في المبيعات بعد اعتماده، ومرة واحدة', () => {
  const state = createMockState()
  const z = pendingBy(state, d => d.kind === 'sales')
  const before = summarize(state, month).sales.amount
  const first = applyApproval(state, z.id)
  assert.equal(first.error, null)
  assert.equal(summarize(first.state, month).sales.amount, round2(before + docTotals(z).subtotal))
  const second = applyApproval(first.state, z.id)
  assert.equal(second.error, 'NOT_PENDING')
  assert.equal(summarize(second.state, month).sales.amount, summarize(first.state, month).sales.amount)
})

test('الاعتماد يُمنع مع نقص البيانات أو فرق المطبوع، والمكرر يحتاج تأكيدًا', () => {
  const state = createMockState()
  const missing = pendingBy(state, d => !d.invoiceNo)
  assert.equal(applyApproval(state, missing.id).error, 'BLOCKED')
  const mismatch = pendingBy(state, d => Math.abs(docTotals(d).difference) > 0)
  assert.equal(applyApproval(state, mismatch.id).error, 'BLOCKED')
  const dup = pendingBy(state, d => reviewAlerts(d, state).some(a => a.type === 'duplicate'))
  assert.equal(applyApproval(state, dup.id).error, 'BLOCKED')
  assert.equal(applyApproval(state, dup.id, { duplicateConfirmed: true }).error, null)
})

test('تصحيح البند الناقص يرفع مانع الفرق', () => {
  const state = createMockState()
  const doc = pendingBy(state, d => Math.abs(docTotals(d).difference) > 0)
  const fixed = applySave(state, doc.id, { lines: doc.image.lines.map(l => ({ ...l })) })
  const updated = fixed.state.documents.find(d => d.id === doc.id)
  assert.equal(docTotals(updated).difference, 0)
  assert.equal(approvalState(updated, reviewAlerts(updated, fixed.state)).can, true)
  assert.ok(!updated.machineFields.includes('lines'), 'البنود المعدّلة لم تعد «مقروءة آليًا»')
  assert.ok(updated.machineFields.includes('party'), 'الحقول غير المعدّلة تبقى معلّمة')
})

test('لا تعديل ولا رفض بعد الاعتماد', () => {
  const state = createMockState()
  const doc = state.documents.find(d => d.status === 'approved')
  assert.equal(applySave(state, doc.id, { party: 'غيره' }).error, 'NOT_PENDING')
  assert.equal(applyRejection(state, doc.id, { reason: 'unclear' }).error, 'NOT_PENDING')
})

test('الرفض يتطلب سببًا، و«سبب آخر» يتطلب نصًا', () => {
  const state = createMockState()
  const doc = pendingBy(state, () => true)
  assert.equal(applyRejection(state, doc.id, {}).error, 'REASON_REQUIRED')
  assert.equal(applyRejection(state, doc.id, { reason: 'other', note: '  ' }).error, 'NOTE_REQUIRED')
  const done = applyRejection(state, doc.id, { reason: 'other', note: 'الصفحة الثانية ناقصة' })
  assert.equal(done.error, null)
  assert.equal(done.state.documents.find(d => d.id === doc.id).rejection.reason, 'الصفحة الثانية ناقصة')
})

test('رقم الفاتورة يُقارن بعد توحيد الأرقام والرموز', () => {
  assert.equal(normalizeRef('٤٤١٤'), '4414')
  assert.equal(normalizeRef('۴۴۱۴'), '4414')
  assert.equal(normalizeRef('a-0571'), 'A0571')
  assert.equal(normalizeRef('00571'), '571')
})

test('الفترات: الأسبوع يبدأ الأحد، والشهر الماضي يعبر السنة', () => {
  assert.deepEqual(periodRange('week', '2026-09-26'), { from: '2026-09-20', to: '2026-09-26' })
  assert.deepEqual(periodRange('last-month', '2026-01-15'), { from: '2025-12-01', to: '2025-12-31' })
  assert.deepEqual(periodRange('custom', '2026-09-26', { from: '2026-09-10', to: '2026-09-01' }), { from: '2026-09-01', to: '2026-09-10' })
})

test('الفلاتر وعدد النتائج', () => {
  const state = createMockState()
  const all = filterDocuments(state.documents, {})
  assert.equal(all.rows.length, state.documents.length)
  const pending = filterDocuments(state.documents, { status: 'pending' })
  assert.equal(pending.rows.length, all.counts.pending)
  const q = filterDocuments(state.documents, { q: 'مورد اللحوم' })
  assert.ok(q.rows.length > 0)
  assert.ok(q.rows.every(d => d.party === 'مورد اللحوم والدواجن'))
})

test('قائمة «يحتاج إجراء» تبدأ بالانتظار ثم التنبيهات', () => {
  const items = needsAction(createMockState())
  assert.equal(items[0].key, 'pending')
  assert.ok(items.some(i => i.key.startsWith('dup-')))
  assert.ok(items.some(i => i.key.startsWith('mis-')))
})

test('البيانات مصطنعة بالكامل', () => {
  const text = JSON.stringify(createMockState())
  for (const name of ['مزاهر', 'تتميرا', 'ديوانية', 'محمصة']) assert.ok(!text.includes(name), `لا اسم منشأة حقيقية: ${name}`)
})

test('حقل التاريخ يقبل الأرقام العربية ويرفض التواريخ المستحيلة', async () => {
  const { dayTextToIso, isoToDayText } = await import('../src/ui/format.js')
  assert.equal(dayTextToIso('٢٥/٠٩/٢٠٢٦'), '2026-09-25')
  assert.equal(dayTextToIso('5/9/2026'), '2026-09-05')
  assert.equal(dayTextToIso('31/02/2026'), null)
  assert.equal(dayTextToIso('2026-09-25'), null)
  assert.equal(isoToDayText('2026-09-05'), '05/09/2026')
})
