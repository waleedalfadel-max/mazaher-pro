import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suggestInvoicePayment, suggestDocumentPayments, reviewedPayment, uploaderPaymentRule } from '../src/lib/paymentWorkflow.js'
import { buildInvoicePayload } from '../src/lib/approvalV2.js'
import { saveDraft, loadDraft } from '../src/lib/reviewDraft.js'

const banks = [{ id: 'bank', name: 'Test bank', is_active: true, branches: [] }]
const doc = { id: 'doc', status: 'analyzed', created_by_role: 'purchasing', created_by_name: 'Test purchaser' }
const invoice = { _id: 'invoice', type: 'expense', date: '2026-11-11', paySource: 'bank', bankAccountId: 'bank', totalAmount: 48, vatAmount: 6.26,
  amountsBasis: 'inclusive', items: [{ description: 'Milk', amount: 48, lineNet: 41.74, lineVat: 6.26 }] }

test('a bank reading for a legacy purchaser proposes custody and submits it without changing invoice values', () => {
  const proposed = suggestInvoicePayment(invoice, doc, {}, banks)
  const payload = buildInvoicePayload(proposed, { categories: [], transTypes: [], original: invoice })
  assert.equal(payload.paySource, 'custody')
  assert.equal(payload.bankAccountId, '')
  assert.equal(payload.totalAmount, 48)
  assert.equal(payload.vatAmount, 6.26)
  assert.deepEqual(payload.items.map(x => x.amount), [48])
  assert.equal(invoice.paySource, 'bank', 'original OCR remains unchanged')
  assert.match(proposed._paymentSuggested, /Test purchaser.*العهدة/)
})

test('legacy cashier and owner defaults use uploader identity; unknown users have no guessed source', () => {
  for (const [role, expected] of [['cashier', 'cash'], ['owner', 'bank'], ['purchasing', 'custody']]) {
    const proposed = suggestInvoicePayment(invoice, { created_by_role: role, uploaded_by: 'accountant' }, {}, banks)
    assert.equal(proposed.paySource, expected)
    if (expected !== 'bank') assert.equal(proposed.bankAccountId, '')
  }
  assert.equal(suggestInvoicePayment(invoice, { created_by_role: 'accountant' }, {}, banks), invoice)
  assert.equal(uploaderPaymentRule({}, {}, banks), null)
})

test('reviewed bank or cleared source survives resuggestion and saved draft reload', () => {
  const proposed = suggestInvoicePayment(invoice, doc, {}, banks)
  const storageMap = new Map()
  const storage = { getItem: k => storageMap.get(k), setItem: (k, v) => storageMap.set(k, v), removeItem: k => storageMap.delete(k) }
  const scope = { projectId: 'project', userId: 'reviewer' }
  const original = { ...doc, analysis_result: { invoices: [invoice] } }
  for (const patch of [{ paySource: 'bank', bankAccountId: 'bank' }, { paySource: '' }]) {
    const changed = reviewedPayment(proposed, patch)
    assert.equal(suggestInvoicePayment(changed, doc, {}, banks).paySource, patch.paySource)
    assert(saveDraft(storage, scope, original, { invoices: [changed] }))
    const restored = loadDraft(storage, scope, original).edit
    assert.equal(suggestDocumentPayments(restored, doc, {}, banks).invoices[0].paySource, patch.paySource)
  }
})

test('credit, payable, receipts, sales, transfers and decided invoices keep their sources', () => {
  for (const special of [
    { ...invoice, paySource: 'credit' }, { ...invoice, paySource: 'payable' },
    { ...invoice, type: 'supplier_payment', paymentMode: 'new' }, { ...invoice, type: 'sales' },
    { ...invoice, type: 'transfer', transType: 'تحصيل ذمم عميل' },
  ]) assert.equal(suggestInvoicePayment(special, doc, {}, banks).paySource, special.paySource)
  const result = suggestDocumentPayments({ invoices: [invoice] }, doc, {}, banks, {}, new Set())
  assert.equal(result.invoices[0].paySource, 'bank')
})

test('configured user and role bank policies still take precedence over legacy custody', () => {
  const settings = { bank_workflow: { version: 1, uploaders: { purchasing: { source: 'bank', account_id: 'bank' } } } }
  assert.equal(suggestInvoicePayment(invoice, doc, settings, banks).paySource, 'bank')
  assert.equal(suggestInvoicePayment(invoice, doc, settings, banks).bankAccountId, 'bank')
})
