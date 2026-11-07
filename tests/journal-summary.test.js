import { test } from 'node:test'
import assert from 'node:assert/strict'
import { journalSummaries, summaryDays, loadJournalDay } from '../src/lib/journalSummary.js'
import { journalFixture, journalClient } from './fixtures/journal-detail.js'

const base = { project_id: 'p1', date: '2026-11-07', status: 'approved', branch: 'فرع أ' }
test('sales channels share one summary; different references, branches, dates, or unnumbered entries remain distinct', () => {
  const rows = [
    { ...base, id: '1', journal_number: 'J1', type: 'مبيعات كاش', cash_in: 20 },
    { ...base, id: '2', journal_number: 'J1', type: 'مبيعات شبكة', bank_in: 30 },
    { ...base, id: '3', journal_number: 'J1', type: 'مبيعات جاهز', receivable_in: 40 },
    { ...base, id: '4', journal_number: 'J2', type: 'مبيعات كاش', cash_in: 20, branch: 'فرع ب' },
    { ...base, id: '5', cash_in: 20 }, { ...base, id: '6', cash_in: 20 },
    { ...base, id: '7', journal_number: 'J1', date: '2026-11-06', cash_in: 20 },
  ], original = structuredClone(rows)
  const summaries = journalSummaries(rows)
  assert.equal(summaries.length, 5); assert.equal(summaries[0].title, 'مبيعات اليوم')
  assert.equal(summaries[0].incoming, 50); assert.equal(summaries[0].receivable, 40)
  assert.equal(summaries[0].branch, 'فرع أ'); assert.deepEqual(rows, original)
})

test('transfer legs stay one journal, purchase and supplier settlement stay separate; no duplicated cash or receivables', () => {
  const rows = [
    { ...base, id: '1', journal_number: 'TRANSFER', bank_out: 100, total_amount: 100 },
    { ...base, id: '2', journal_number: 'TRANSFER', bank_in: 100, total_amount: 100 },
    { ...base, id: '3', journal_number: 'INVOICE', document_id: 'd1', payable_in: 82, total_amount: 82 },
    { ...base, id: '4', journal_number: 'PAYMENT', document_id: 'd1', payable_out: 82, bank_out: 82, total_amount: 82 },
  ]
  const groups = journalSummaries(rows), day = summaryDays(groups)[0]
  assert.equal(groups.length, 3); assert.equal(groups[1].title, 'مشتريات آجلة')
  assert.equal(groups[0].incoming, 100); assert.equal(groups[0].outgoing, 100)
  assert.equal(groups[1].incoming, 0); assert.equal(groups[1].outgoing, 0); assert.equal(groups[1].payable, 82)
  assert.equal(day.incoming, 100); assert.equal(day.outgoing, 182)
})

test('filters mark a partial journal and scope amounts to the actual selected account', () => {
  const rows = [{ ...base, id: '1', journal_number: 'J1', bank_account_id: 'main', bank_in: 50 }, { ...base, id: '2', journal_number: 'J1', bank_account_id: 'other', bank_in: 70 }]
  const [group] = journalSummaries([rows[0]], rows, { account: 'bank:main' })
  assert.equal(group.partial, true); assert.equal(group.incoming, 50)
  assert.equal(journalSummaries(rows)[0].incoming, 120)
})

test('pending entries are visible separately but excluded from posted totals; cancellations are excluded; corrections retain their sign', () => {
  const rows = [
    { ...base, id: '1', journal_number: 'J1', bank_in: 0.1 },
    { ...base, id: '2', journal_number: 'J1', bank_in: 0.2 },
    { ...base, id: '3', journal_number: 'J2', bank_in: -53.58 },
    { ...base, id: '4', journal_number: 'J1', bank_in: 999, status: 'pending' },
    { ...base, id: '5', journal_number: 'J1', bank_in: 999, status: 'cancelled' },
  ]
  const groups = journalSummaries(rows)
  assert.equal(groups.length, 3); assert.equal(groups[0].incoming, 0.3)
  assert.equal(summaryDays(groups)[0].incoming, -53.28)
})

test('daily read is complete, date and tenant scoped, read-only, and fails closed on later-page errors', async () => {
  const fixture = journalFixture(), original = structuredClone(fixture)
  const client = (fail = false) => journalClient(fixture, { fail: q => fail && q.offset === 2 })
  const result = await loadJournalDay(client(), { projectId: 'p1', date: '2026-11-01' })
  assert.equal(result.error, null); assert.equal(result.data.length, 8)
  assert.ok(result.data.every(r => r.status !== 'cancelled'))
  assert.ok(result.data.every(r => r.project_id === 'p1' && r.date === '2026-11-01'))
  assert.equal((await loadJournalDay(client(true), { projectId: 'p1', date: '2026-11-01' })).data, null)
  assert.equal((await loadJournalDay(client(), { projectId: 'p1', date: '2026-02-30' })).error.message, 'invalid_date')
  assert.deepEqual(fixture, original)
})
