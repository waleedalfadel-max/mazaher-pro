import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadJournalDetail, journalAccountMovements } from '../src/lib/journalDetail.js'
import { journalFixture, journalClient } from './fixtures/journal-detail.js'

test('loads every journal row across pagination, including noncash and cancelled movements, excluding other invoices and tenants', async () => {
  const tables = journalFixture(), original = structuredClone(tables), log = []
  const { data, error } = await loadJournalDetail(journalClient(tables, { log }), { projectId: 'p1', entryId: 'bank' })
  assert.equal(error, null); assert.equal(data.rows.length, 6)
  assert.deepEqual(new Set(data.rows.map(r => r.id)), new Set(['bank', 'cash', 'delivery', 'credit', 'transfer', 'cancelled']))
  assert.equal(data.items.length, 1); assert.equal(data.files.length, 2)
  assert.ok(log.filter(q => q.table === 'ledger_entries' && !q.single).length > 3)
  assert.deepEqual(tables, original, 'read only')
})

test('cross-tenant and missing anchors do not query associated data', async () => {
  for (const entryId of ['foreign', 'missing']) {
    const log = [], result = await loadJournalDetail(journalClient(journalFixture(), { log }), { projectId: 'p1', entryId })
    assert.equal(result.data, null); assert.equal(log.length, 1)
  }
})

test('unnumbered entries never group other unnumbered entries or their documents', async () => {
  const { data } = await loadJournalDetail(journalClient(journalFixture()), { projectId: 'p1', entryId: 'no-number' })
  assert.deepEqual(data.rows.map(r => r.id), ['no-number']); assert.equal(data.files.length, 0)
})

test('page, lookup, item and attachment failures return no partial printable detail', async () => {
  for (const target of ['ledger_entries', 'bank_accounts', 'project_settings', 'suppliers', 'document_items', 'documents', 'attachments']) {
    const result = await loadJournalDetail(journalClient(journalFixture(), { fail: q => q.table === target && (target !== 'ledger_entries' || q.offset === 2) }), { projectId: 'p1', entryId: 'bank' })
    assert.equal(result.data, null, target); assert.ok(result.error, target)
  }
})

test('actual account effects preserve transfers, supplier balances, signed corrections, and configured bank names', async () => {
  const { data } = await loadJournalDetail(journalClient(journalFixture()), { projectId: 'p1', entryId: 'cash' })
  const movements = id => journalAccountMovements(data.rows.find(r => r.id === id), data)
  assert.deepEqual(movements('bank'), [{ key: 'bank', label: 'الراجحي الرئيسي', increase: 230, decrease: 0 }])
  assert.deepEqual(movements('transfer').map(m => [m.label, m.increase, m.decrease]), [['الصندوق', 0, 50], ['حساب المشتريات', 50, 0]])
  assert.deepEqual(movements('credit'), [{ key: 'payable', label: 'مستحقات المورد — المورد التجريبي', increase: 82, decrease: 0 }])
  assert.deepEqual(movements('delivery'), [{ key: 'receivable', label: 'ذمم مدينة', increase: 34.5, decrease: 0 }])
  assert.equal(journalAccountMovements({ bank_in: -53.58 })[0].increase, -53.58)
})

test('legacy document fallback is scoped and repeated source URLs appear only once', async () => {
  const t = journalFixture(); t.ledger_entries.filter(r => r.journal_number === 'QD-2026-100').forEach(r => { r.document_id = null })
  t.documents.push({ ...t.documents[0], id: 'foreign-doc', project_id: 'p2', file_url: 'https://example.invalid/foreign.pdf' })
  t.attachments.push({ ...t.attachments[0], id: 'copy', file_url: t.documents[0].file_url })
  const { data } = await loadJournalDetail(journalClient(t), { projectId: 'p1', entryId: 'bank' })
  assert.equal(data.files.length, 2); assert.ok(data.files.every(f => !f.file_url.includes('foreign')))
})
