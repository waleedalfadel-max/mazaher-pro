import { test } from 'node:test'
import assert from 'node:assert/strict'
import { approvalMessage, buildInvoicePayload, callError, exactTotals, expenseBasisNearMatch, expenseBasisSuggestion } from '../src/lib/approvalV2.js'
import { basisConfirmed, confirmExpenseBasis, confirmExpenseRounding, normalizeExpenseReading, validExpenseReviews, withoutReviewConfirmations } from '../src/lib/expenseReading.js'
import { resetReplacedReview } from '../src/lib/documentReread.js'

// Synthetic receipts only. Each product is printed on three rows: net before tax, its tax, and the inclusive line total.
// The store computes VAT once on the invoice total, so the printed nets plus invoice VAT miss the total by one halala.
const line = (description, net, vat, total, extra = {}) => ({ description, quantity: 1, unitPrice: total, lineNet: net, lineVat: vat,
  printedLineTotal: total, printedLineBasis: 'inclusive', ...extra })
const three = [line('Synthetic A', 8.7, 1.3, 10), line('Synthetic B', 8.7, 1.3, 10), line('Synthetic C', 8.7, 1.3, 10)]
const receipt = (patch = {}) => ({ type: 'expense', totalAmount: 30, vatAmount: 3.91, ...patch })

test('an invoice that already matches is returned exactly as read, on either basis', () => {
  const inclusive = receipt({ amountsBasis: 'inclusive', items: three.map(it => ({ ...it, amount: it.printedLineTotal })) })
  assert.equal(exactTotals(inclusive).status, 'match')
  assert.deepEqual(normalizeExpenseReading(structuredClone(inclusive)), inclusive)
  const exclusive = { type: 'expense', totalAmount: 230, vatAmount: 30, amountsBasis: 'exclusive',
    items: [{ description: 'Synthetic net 1', amount: 80, lineNet: 80, lineVat: 12, printedLineTotal: 92, printedLineBasis: 'inclusive' },
      { description: 'Synthetic net 2', amount: 120, lineNet: 120, lineVat: 18, printedLineTotal: 138, printedLineBasis: 'inclusive' }] }
  assert.equal(exactTotals(exclusive).status, 'match')
  assert.deepEqual(normalizeExpenseReading(structuredClone(exclusive)), exclusive)
})

test('printed inclusive line totals win over nets when they match the invoice total; first reading is kept', () => {
  const raw = receipt({ amountsBasis: 'exclusive', items: three.map(it => ({ ...it, amount: it.lineNet })) })
  assert.equal(exactTotals(raw).diff, 1)            // nets + invoice VAT: one halala over, not proof of rounding
  const before = structuredClone(raw)
  const out = normalizeExpenseReading(raw)
  assert.deepEqual(raw, before)
  assert.equal(out.amountsBasis, 'inclusive')
  assert.equal(out.readingBasis, 'exclusive')
  assert.deepEqual(out.readingCorrection, { rule: 'printed_line_column', from: { basis: 'exclusive', field: 'amount' },
    to: { basis: 'inclusive', field: 'printedLineTotal' }, lines: [0, 1, 2].map(line => ({ line, from: 8.7, to: '10.00' })) })
  assert.deepEqual(out.items.map(i => i.amount), ['10.00', '10.00', '10.00'])
  assert.deepEqual(out.items.map(i => i.readingAmount), [8.7, 8.7, 8.7])
  assert.equal(out.items.length, 3)
  assert.equal(out.totalAmount, 30)
  assert.equal(out.vatAmount, 3.91)
  assert.equal(exactTotals(out).status, 'match')
  assert.equal(out.roundingReview, undefined)
})

test('tax is never counted twice: inclusive totals labelled as net are switched to inclusive, VAT unchanged', () => {
  const raw = receipt({ amountsBasis: 'exclusive', items: three.map(it => ({ ...it, amount: it.printedLineTotal })) })
  assert.equal(exactTotals(raw).diff, 391)
  const out = normalizeExpenseReading(raw)
  assert.equal(out.amountsBasis, 'inclusive')
  assert.deepEqual(out.items.map(i => i.amount), [10, 10, 10])
  assert.ok(out.items.every(i => !('readingAmount' in i)))
  const payload = buildInvoicePayload(out, { original: out, categories: [], transTypes: [] })
  assert.equal(exactTotals(payload).status, 'match')
  assert.equal(payload.totalAmount, 30)
  assert.equal(payload.vatAmount, 3.91)
})

test('invoice discount and a VAT-exempt product survive unchanged', () => {
  const raw = { type: 'expense', totalAmount: 32, vatAmount: 2.87, invoiceDiscount: 1, amountsBasis: 'exclusive',
    items: [line('Synthetic taxable', 20, 3, 23, { amount: 20, discount: 0.5 }),
      line('Synthetic exempt', 10, 0, 10, { amount: 10 })] }
  const out = normalizeExpenseReading(raw)
  assert.equal(out.amountsBasis, 'inclusive')
  assert.equal(out.invoiceDiscount, 1)
  assert.equal(out.items[0].amount, '23.00')
  assert.equal(out.items[0].discount, 0.5)
  assert.deepEqual(out.items[1], raw.items[1])       // exempt line already equal: unchanged, no readingAmount recorded
  assert.equal(exactTotals(out).status, 'match')
})

test('printed nets are used only when they, plus printed VAT, match exactly', () => {
  const raw = { type: 'expense', totalAmount: 230, vatAmount: 30, amountsBasis: 'inclusive',
    items: [{ description: 'Synthetic X', amount: 40, quantity: 2, unitPrice: 40, lineNet: 80 },
      { description: 'Synthetic Y', amount: 60, quantity: 2, unitPrice: 60, lineNet: 120 }] }
  const out = normalizeExpenseReading(raw)
  assert.equal(out.amountsBasis, 'exclusive')
  assert.equal(out.readingBasis, 'inclusive')
  assert.deepEqual(out.items.map(i => [i.amount, i.readingAmount]), [['80.00', 40], ['120.00', 60]])
  assert.equal(exactTotals(out).status, 'match')
})

test('incomplete or inconsistent printed evidence leaves the reading untouched and blocked', () => {
  const missing = receipt({ amountsBasis: 'exclusive', items: three.map((it, i) => ({ ...it, amount: it.lineNet, printedLineTotal: i ? it.printedLineTotal : null })) })
  assert.deepEqual(normalizeExpenseReading(structuredClone(missing)), missing)
  const wrong = receipt({ totalAmount: 30.05, amountsBasis: 'exclusive', items: three.map(it => ({ ...it, amount: it.lineNet })) })
  const out = normalizeExpenseReading(structuredClone(wrong))
  assert.deepEqual(out, wrong)
  assert.equal(out.items.length, 3)
  assert.equal(exactTotals(out).status, 'mismatch')
})

test('a basis that leaves a small residual is guidance only, never called rounding or applied', () => {
  // Old-style reading: nets copied and labelled inclusive (the reported failure).
  const read = receipt({ amountsBasis: 'inclusive', items: three.map(it => ({ description: it.description, amount: it.lineNet,
    printedLineTotal: it.lineNet, printedLineBasis: 'inclusive' })) })
  const out = normalizeExpenseReading(read)
  assert.deepEqual(out, read)
  assert.equal(expenseBasisSuggestion(out), null)
  assert.deepEqual(expenseBasisNearMatch(out), { basis: 'exclusive', diff: 1 })
  assert.equal(out.amountsBasis, 'inclusive')
  assert.equal(expenseBasisNearMatch({ ...out, totalAmount: 30.04 }), null)                       // 3+ halalas: no hint
  assert.equal(expenseBasisNearMatch({ ...out, items: out.items.map(i => ({ ...i, amount: 10 })), amountsBasis: 'exclusive' }), null) // exact suggestion instead
})

test('small difference correction needs an explicit basis confirmation first and keeps the original', () => {
  const read = receipt({ amountsBasis: 'inclusive', items: three.map(it => ({ description: it.description, amount: it.lineNet })) })
  const switched = { ...read, amountsBasis: 'exclusive' }
  assert.equal(exactTotals(switched).diff, 1)
  assert.equal(basisConfirmed(switched), false)
  assert.equal(confirmExpenseRounding(switched, 2, 'Checked image'), null)
  const confirmed = confirmExpenseBasis(read, 'exclusive')
  assert.equal(confirmed.basisReview.basis, 'exclusive')
  assert.equal(confirmed.basisReview.from, 'inclusive')
  assert.deepEqual(confirmed.items, read.items)
  assert.equal(basisConfirmed(confirmed), true)
  assert.equal(basisConfirmed({ ...confirmed, amountsBasis: 'inclusive' }), false)                  // basis changed again: gate closes
  assert.equal(confirmExpenseRounding(confirmed, 2, '  '), null)
  const fixed = confirmExpenseRounding(confirmed, 2, 'Checked image')
  const { key, ...rounding } = fixed.roundingReview
  assert.deepEqual(rounding, { line: 2, basis: 'exclusive', from: '8.70', to: '8.69', difference: '-0.01', reason: 'Checked image' })
  assert.equal(key, fixed.basisReview.key)
  assert.equal(basisConfirmed(fixed), true)                 // the reviewer's own correction keeps the confirmation
  assert.equal(exactTotals(fixed).status, 'match')
  assert.equal(read.items[2].amount, 8.7)
  const changes = buildInvoicePayload(fixed, { original: read, categories: [], transTypes: [] }).review_changes
  assert.ok(changes.some(s => s.includes('أكد المراجع أساس مبالغ البنود من الصورة: قبل الضريبة')))
  assert.ok(changes.some(s => s.includes('تسوية فرق صغير أكدها المراجع للبند 3: 8.70 ← 8.69؛ Checked image')))
  assert.ok(!changes.some(s => s.includes('تقريب')))
})

test('replaced-reading rejection (P0023) is explained on every action path; other codes unchanged', () => {
  assert.deepEqual(callError({ code: 'P0023', message: 'reading_replaced' }), { code: 'reading_replaced' })
  const text = approvalMessage(callError({ code: 'P0023' }))
  assert.match(text, /استُبدلت قراءة هذا المستند/)
  assert.match(text, /لم يُسجَّل شيء/)
  assert.doesNotMatch(text, /الاتصال|الشبكة/)
  assert.deepEqual(callError({ code: 'APP_VERSION_STALE' }), { code: 'app_version_stale' })
  assert.deepEqual(callError({ code: '57014' }), { code: 'network' })
  assert.deepEqual(callError(null), { code: 'network' })
})

// ── 2026-10-28 review round: confirmations are tied to what was confirmed, never taken from a reading ──
const nets = () => receipt({ amountsBasis: 'inclusive', items: three.map(it => ({ description: it.description, amount: it.lineNet })) })

test('a basis confirmation lapses when basis, any amount, VAT, total or discount changes; stale ones are not sent', () => {
  const confirmed = confirmExpenseBasis(nets(), 'exclusive')
  assert.equal(basisConfirmed(confirmed), true)
  const changed = {
    basis: { ...confirmed, amountsBasis: 'inclusive' },
    amount: { ...confirmed, items: confirmed.items.map((it, i) => i ? it : { ...it, amount: '8.71' }) },
    vat: { ...confirmed, vatAmount: 3.9 },
    total: { ...confirmed, totalAmount: 30.01 },
    discount: { ...confirmed, invoiceDiscount: 0.01 },
    removedLine: { ...confirmed, items: confirmed.items.slice(1) },
  }
  for (const [name, inv] of Object.entries(changed)) {
    assert.equal(basisConfirmed(inv), false, name)
    assert.equal(confirmExpenseRounding(inv, 0, 'Checked image'), null, name)
    assert.equal(validExpenseReviews(inv).basisReview, undefined, name)
  }
  assert.equal(basisConfirmed({ ...confirmed, items: confirmed.items.map(it => ({ ...it, amount: Number(it.amount) })) }), true) // same value, other format
  // A correction made, then amounts edited afterwards: neither the confirmation nor the correction survives into the payload.
  const fixed = confirmExpenseRounding(confirmed, 2, 'Checked image')
  const edited = { ...fixed, items: fixed.items.map((it, i) => i === 0 ? { ...it, amount: '8.69' } : i === 2 ? { ...it, amount: '8.70' } : it) }
  assert.equal(exactTotals(edited).status, 'match')
  const payload = buildInvoicePayload(edited, { original: nets(), categories: [], transTypes: [] })
  assert.equal(payload.basisReview, undefined)
  assert.equal(payload.roundingReview, undefined)
  assert.ok(!payload.review_changes.some(s => s.includes('تسوية فرق') || s.includes('أكد المراجع أساس')))
  assert.ok(payload.review_changes.some(s => s.includes('بند 1 — المبلغ')))   // the amount edits themselves stay in the trail
  const kept = buildInvoicePayload(fixed, { original: nets(), categories: [], transTypes: [] })
  assert.equal(kept.roundingReview.reason, 'Checked image')
  // Re-confirming after a change starts again and drops the old correction.
  assert.equal(confirmExpenseBasis(fixed, 'exclusive').roundingReview, undefined)
})

test('confirmations supplied by a reading are discarded, at read time and when the review copy is made', () => {
  const confirmed = confirmExpenseRounding(confirmExpenseBasis(nets(), 'exclusive'), 2, 'Model says rounding')
  const fromModel = { ...confirmed, readingCorrection: { rule: 'printed_line_column' }, readingBasis: 'inclusive',
    items: confirmed.items.map(it => ({ ...it, readingAmount: 1 })) }
  const out = normalizeExpenseReading(fromModel)
  for (const k of ['basisReview', 'roundingReview', 'readingCorrection', 'readingBasis']) assert.equal(k in out, false, k)
  assert.ok(out.items.every(it => !('readingAmount' in it)))
  assert.equal(basisConfirmed(out), false)
  const stored = { invoices: [confirmed, { ...confirmed, _id: 'second' }] }
  const review = withoutReviewConfirmations(stored)
  assert.ok(review.invoices.every(inv => !inv.basisReview && !inv.roundingReview))
  assert.ok(stored.invoices.every(inv => inv.basisReview))        // the stored reading itself is not modified
})

test('a replaced reading drops every earlier confirmation from the working copy', () => {
  const doc = { id: 'd', status: 'analyzed', analysis_result: { invoices: [nets()] },
    _edit: { invoices: [confirmExpenseRounding(confirmExpenseBasis(nets(), 'exclusive'), 2, 'Checked image')] }, _draftSavedAt: 'x' }
  const next = resetReplacedReview(doc, { _readingId: 'new', invoices: [nets()] })
  assert.equal(next._edit, undefined)
  assert.equal(next._readingReviewRequired, true)
  assert.ok(next.analysis_result.invoices.every(inv => !inv.basisReview && !inv.roundingReview))
})

test('each invoice in an image needs its own confirmation', () => {
  const a = nets(), b = receipt({ totalAmount: 60, vatAmount: 7.82, amountsBasis: 'inclusive', items: [17.4, 17.4, 17.4].map((amount, i) => ({ description: 'Other ' + i, amount })) })
  const confirmedA = confirmExpenseBasis(a, 'exclusive')
  assert.equal(basisConfirmed({ ...b, amountsBasis: 'exclusive', basisReview: confirmedA.basisReview }), false)
  assert.equal(confirmExpenseRounding({ ...b, amountsBasis: 'exclusive', basisReview: confirmedA.basisReview }, 0, 'copied'), null)
  assert.equal(basisConfirmed({ ...b, amountsBasis: 'exclusive' }), false)
  assert.equal(basisConfirmed(confirmExpenseBasis(b, 'exclusive')), true)
})

test('printed totals: the invoice discount is deducted once and the source of old and new numbers is kept', () => {
  const items = [line('Synthetic taxable', 20, 3, 23, { amount: 20 }), line('Synthetic exempt', 10, 0, 10, { amount: 10 })]
  const once = normalizeExpenseReading({ type: 'expense', totalAmount: 32, vatAmount: 2.87, invoiceDiscount: 1, amountsBasis: 'exclusive', items })
  assert.equal(once.amountsBasis, 'inclusive')
  assert.equal(exactTotals(once).itemsTotal - exactTotals(once).discount, 3200)
  assert.deepEqual(once.readingCorrection.lines, [{ line: 0, from: 20, to: '23.00' }])
  assert.equal(once.readingCorrection.from.field, 'amount')
  assert.equal(once.readingCorrection.to.field, 'printedLineTotal')
  const changes = buildInvoicePayload(once, { original: once, categories: [], transTypes: [] }).review_changes
  assert.ok(changes.some(s => s.includes('صحّح التطبيق القراءة الأولى') && s.includes('البند 1: 20 ← 23.00')))
  // A total that would only match if the discount were taken twice is not accepted.
  const twice = { type: 'expense', totalAmount: 31, vatAmount: 2.87, invoiceDiscount: 1, amountsBasis: 'exclusive', items }
  assert.deepEqual(normalizeExpenseReading(structuredClone(twice)), twice)
})

test('a matching sum is not enough: every line must be backed by its own printed rows, and the printed item count must agree', () => {
  const base = { type: 'expense', totalAmount: 30, vatAmount: 3.91, amountsBasis: 'exclusive' }
  // Line totals with no net/VAT rows and no quantity x unit price: unproven, left as read.
  const bare = { ...base, items: three.map(it => ({ description: it.description, amount: it.lineNet, printedLineTotal: 10, printedLineBasis: 'inclusive' })) }
  assert.deepEqual(normalizeExpenseReading(structuredClone(bare)), bare)
  // A line whose own rows disagree (net + VAT is not its total) blocks the correction even though the sum matches.
  const inconsistent = { ...base, items: three.map((it, i) => ({ ...it, amount: it.lineNet, unitPrice: null, quantity: null, lineVat: i ? 1.3 : 1.2 })) }
  assert.deepEqual(normalizeExpenseReading(structuredClone(inconsistent)), inconsistent)
  // Quantity x unit price backs a line without net/VAT rows (weighed item, one halala of rounding).
  const weighed = { ...base, items: [line('Synthetic A', 8.7, 1.3, 10, { amount: 8.7 }), line('Synthetic B', 8.7, 1.3, 10, { amount: 8.7 }),
    { description: 'Synthetic weighed', amount: 8.7, quantity: 0.8, unitPrice: 12.49, printedLineTotal: 10, printedLineBasis: 'inclusive' }] }
  assert.equal(normalizeExpenseReading(weighed).amountsBasis, 'inclusive')
  // One line repeated and another missing: the printed item count catches it; nothing is changed, a warning is shown.
  const repeated = { ...base, printedItemCount: 4, items: three.map(it => ({ ...it, amount: it.lineNet })) }
  const out = normalizeExpenseReading(structuredClone(repeated))
  assert.equal(out.amountsBasis, 'exclusive')
  assert.deepEqual(out.items, repeated.items)
  assert.match(out.readingWarnings.join(' '), /عدد الأصناف المطبوع 4 لا يساوي عدد البنود المقروءة 3/)
  // Genuinely repeated purchases with a count of lines or of pieces are accepted.
  assert.equal(normalizeExpenseReading({ ...repeated, printedItemCount: 3 }).amountsBasis, 'inclusive')
  assert.equal(normalizeExpenseReading({ ...repeated, printedItemCount: 6, items: repeated.items.map(it => ({ ...it, quantity: 2 })) }).amountsBasis, 'inclusive')
})
