// مصدر الدفع المقترح لكل رافع بعينه (20261103120000): قاعدة المستخدم تسبق قاعدة الدور، والاسم والمصدر يظهران، والمحاسب يغيّر المصدر.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suggestInvoicePayment, uploaderPaymentRule, reviewedPayment } from '../src/lib/paymentWorkflow.js'
const accounts = [{ id: 'custody', name: 'Synthetic custody', branches: [] }, { id: 'main', name: 'Synthetic main', branches: [] }]
const settings = { expenses_scope: 'project', bank_workflow: { version: 1, network_by_branch: {}, accounts: {},
  uploaders: { purchasing: { source: 'bank', account_id: 'custody' }, owner: { source: 'bank', account_id: 'main' } },
  uploader_users: { 'user-cash': { source: 'cash' }, 'user-bank': { source: 'bank', account_id: 'custody' } } } }
const expense = { _id: 'inv', type: 'expense', paySource: '', amount: '20' }
const doc = (id, name, role = 'purchasing') => ({ created_by_role: role, created_by_user_id: id, created_by_name: name })

test('user rule beats the role rule: one purchaser cash, the other the custody bank account', () => {
  const cash = suggestInvoicePayment(expense, doc('user-cash', 'Synthetic Juma'), settings, accounts)
  assert.equal(cash.paySource, 'cash'); assert.equal(cash.bankAccountId, '')
  assert.match(cash._paymentSuggested, /Synthetic Juma \(مسؤول المشتريات\): الصندوق/)
  const bank = suggestInvoicePayment(expense, doc('user-bank', 'Synthetic Murtada'), settings, accounts)
  assert.equal(bank.paySource, 'bank'); assert.equal(bank.bankAccountId, 'custody')
  assert.match(bank._paymentSuggested, /Synthetic Murtada \(مسؤول المشتريات\): Synthetic custody/)
})

test('a user without a rule keeps the role rule; no policy means no suggestion', () => {
  const other = suggestInvoicePayment(expense, doc('user-new', 'Synthetic new'), settings, accounts)
  assert.equal(other.bankAccountId, 'custody')
  assert.equal(uploaderPaymentRule(doc('user-new', 'Synthetic new'), settings, accounts).scope, 'role')
  assert.equal(uploaderPaymentRule(doc('user-cash', 'Synthetic Juma'), {}, accounts), null)
})

test('the review line shows name, role and the source suggested for that user', () => {
  assert.deepEqual(uploaderPaymentRule(doc('user-cash', 'Synthetic Juma'), settings, accounts),
    { rule: { source: 'cash' }, scope: 'user', name: 'Synthetic Juma', roleLabel: 'مسؤول المشتريات', sourceLabel: 'الصندوق' })
  assert.equal(uploaderPaymentRule(doc('user-bank', 'Synthetic Murtada'), settings, accounts).sourceLabel, 'Synthetic custody')
})

test('the accountant changes the suggested source and the choice is kept', () => {
  const s = suggestInvoicePayment(expense, doc('user-cash', 'Synthetic Juma'), settings, accounts)
  const changed = reviewedPayment(s, { paySource: 'bank', bankAccountId: 'main' })
  assert.equal(changed.paySource, 'bank'); assert.equal(changed.bankAccountId, 'main'); assert.equal(changed._paymentSuggested, false)
  // a later render does not re-suggest over the accountant's choice
  assert.equal(suggestInvoicePayment(changed, doc('user-cash', 'Synthetic Juma'), settings, accounts).paySource, 'bank')
})

test('credit or payable invoices are not reassigned by a user rule', () => {
  for (const paySource of ['credit', 'payable'])
    assert.equal(suggestInvoicePayment({ ...expense, paySource }, doc('user-cash', 'Synthetic Juma'), settings, accounts).paySource, paySource)
})
