import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInitialState, ownerDashboard } from '../tatmira-demo/src/lib/ledger.js'
import { expenseReport } from '../tatmira-demo/src/lib/expenses.js'
import { can } from '../tatmira-demo/src/lib/permissions.js'
import { executeCommand, projectLedger } from '../tatmira-accounts/server/finance-model.js'
import { isAccountSuccess, isFinanceSuccess, resultOrError } from '../tatmira-accounts/src/api-result.js'
import { createMutationCoordinator } from '../tatmira-accounts/src/mutation-coordinator.js'
import { createAmbiguousRequestCache } from '../tatmira-accounts/src/request-id-cache.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = path => readFileSync(join(root, path), 'utf8')

test('preview root builds the integrated Tatmira UI and never redirects to accounts', () => {
  const build = source('scripts/build-tatmira-preview.mjs')
  const config = source('vite.tatmira-accounts.config.js')
  const vercel = JSON.parse(source('vercel.json'))
  assert.match(build, /cpSync\("dist-tatmira-accounts", "dist-tatmira-preview"/)
  assert.doesNotMatch(build, /redirect\.html/)
  assert.match(build, /dist-tatmira-preview\/demo/)
  assert.match(config, /base:\s*"\/"/)
  assert.equal(vercel.outputDirectory, 'dist-tatmira-preview')
  assert.ok(vercel.rewrites.every(rule => rule.source.startsWith('/accounts')), 'rewrites must not intercept root assets or /demo')
  const securityHeaders = Object.fromEntries(vercel.headers[0].headers.map(header => [header.key, header.value]))
  assert.equal(securityHeaders['Content-Security-Policy'], "frame-ancestors 'none'")
  assert.equal(securityHeaders['X-Frame-Options'], 'DENY')
  assert.doesNotMatch(source('tatmira-accounts/index.html'), /http-equiv=["']refresh|\/accounts\//i)
})
test('recovery hash is captured before HashRouter and cleared into a normal hash route', () => {
  const main = source('tatmira-accounts/src/main.jsx')
  assert.ok(main.indexOf('const recoveryAtBoot') < main.indexOf('<HashRouter>'))
  assert.match(main, /type=\(\?:recovery\|invite\)/)
  assert.match(main, /history\.replaceState\(null, '', `\$\{location\.pathname\}\$\{location\.search\}#\/`\)/)
  assert.match(main, /if \(!identity \|\| recovery\)[\s\S]+return <HashRouter>/)
})

test('owner can request a password reset back to the exact integrated root', () => {
  const main = source('tatmira-accounts/src/main.jsx')
  assert.match(main, /resetPasswordForEmail\(ownerEmail/)
  assert.match(main, /redirectTo: `\$\{location\.origin\}\$\{location\.pathname\}`/)
  assert.match(main, /نسيت كلمة المرور؟/)
  assert.match(main, /إن كان الحساب مسجلًا/)
})

test('successful API responses must be valid JSON with the action-specific shape', async () => {
  const messages = { FINANCE_UNAVAILABLE: 'finance unavailable', AUTH_UNAVAILABLE: 'auth unavailable' }
  const finance = (body, operation = 'mutate', payload = { command: { type: 'LAB_UPDATE' } }) => resultOrError(
    new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    { unavailableCode: 'FINANCE_UNAVAILABLE', messages, validate: result => isFinanceSuccess(operation, payload, result) },
  )
  await assert.rejects(() => finance(''), error => error.code === 'FINANCE_UNAVAILABLE')
  await assert.rejects(() => finance('{}'), error => error.code === 'FINANCE_UNAVAILABLE')
  await assert.rejects(() => finance('{"ok":true,"revision":"1","documentId":null}'), error => error.code === 'FINANCE_UNAVAILABLE')
  assert.equal((await finance('{"ok":true,"revision":1,"documentId":null}')).revision, 1)
  await assert.rejects(
    () => finance('{"ok":true,"revision":1,"documentId":null}', 'mutate', { command: { type: 'DOC_ADD' } }),
    error => error.code === 'FINANCE_UNAVAILABLE',
  )
  assert.equal((await finance('{"revision":2,"actor":{},"data":{}}', 'read', {})).revision, 2)

  const employee = { id: 'employee', name: 'موظف', role: 'employee', active: true, grants: [], version: 1 }
  const account = (action, value) => resultOrError(
    new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    { unavailableCode: 'AUTH_UNAVAILABLE', messages, validate: result => isAccountSuccess(action, result) },
  )
  assert.deepEqual((await account('employees', { employees: [employee] })).employees, [employee])
  assert.equal((await account('save_employee', { employee })).employee.version, 1)
  await assert.rejects(() => account('save_employee', {}), error => error.code === 'AUTH_UNAVAILABLE')
})

test('employee activation retry keeps its request id only after an ambiguous outage', () => {
  let next = 0
  const cache = createAmbiguousRequestCache(() => `request-${++next}`)
  const key = 'employee|3|false'
  assert.equal(cache.requestId(key), 'request-1')
  cache.settle(key, 'AUTH_UNAVAILABLE')
  assert.equal(cache.requestId(key), 'request-1')
  cache.settle(key, 'CONFLICT')
  assert.equal(cache.requestId(key), 'request-2')
  cache.settle(key)
  assert.equal(cache.requestId(key), 'request-3')
})

test('background snapshots do not overwrite in-progress review, customer or lab drafts', () => {
  const review = source('tatmira-demo/src/pages/ReviewDocument.jsx')
  const customer = source('tatmira-demo/src/components/CustomerForm.jsx')
  const settings = source('tatmira-demo/src/pages/Settings.jsx')
  assert.match(review, /\[remote, doc\?\.id\]/)
  assert.doesNotMatch(review, /\[remote, id, doc\?\.fields\]/)
  assert.match(customer, /\[open, customer\?\.id\]/)
  assert.doesNotMatch(customer, /\[open, customer\]/)
  assert.match(settings, /if \(!dirty\) setLab\(state\.lab\)/)
  assert.match(settings, /setDirty\(true\)/)
})

test('shared navigation capabilities come only from owner status or actor grants', () => {
  const employee = { role: 'employee', active: true, grants: ['upload_expense', 'view_reports'] }
  assert.equal(can(employee, 'upload', 'purchase'), true)
  assert.equal(can(employee, 'upload', 'sale'), false)
  assert.equal(can(employee, 'viewFinancials'), true)
  assert.equal(can(employee, 'review'), false)
  assert.equal(can(employee, 'manageSettings'), false)
  assert.equal(can({ role: 'owner', active: true }, 'manageSettings'), true)
})

test('an active employee without grants keeps own-document navigation only', () => {
  const employee = { id: 'revoked', role: 'employee', active: true, grants: [] }
  assert.equal(can(employee, 'ownDocuments'), true)
  assert.equal(can(employee, 'review'), false)
  assert.equal(can(employee, 'upload', 'sale'), false)
  const app = source('tatmira-demo/src/App.jsx')
  assert.match(app, /const documents = can\(actor, 'ownDocuments'\)/)
  assert.match(app, /item\.to === '\/documents'\) return can\(actor, 'ownDocuments'\)/)
  assert.match(app, /documents \? '\/documents' : customers/)
})

function projectedFixture() {
  const state = createInitialState({ today: '2026-09-19' })
  state.documents = [
    { id: 'own', kind: 'payment', uploadedBy: 'staff', uploadedAt: '2026-09-19T00:00:00Z', status: 'pending', file: { id: 'secret/org/own.pdf', name: 'own.pdf', type: 'application/pdf', size: 10 }, fields: { customerId: 'cust-1', date: '2026-09-19', amount: 9900, accountId: 'acc-bank', reference: 'private', allocations: [{ target: 'opening', amount: 9900 }] } },
    { id: 'approved', kind: 'purchase', uploadedBy: 'other', uploadedAt: '2026-09-18T00:00:00Z', status: 'approved', file: { id: 'secret/org/approved.pdf', name: 'approved.pdf', type: 'application/pdf', size: 11 }, fields: { payee: 'مورد', number: 'P-1', date: '2026-09-18', accountId: 'acc-bank', lines: [{ desc: 'تمور', categoryId: 'cat-dates', net: 1000, vat: 150 }] } },
  ]
  state.purchases = [{ id: 'purchase-approved', docId: 'approved', payee: 'مورد', number: 'P-1', date: '2026-09-18', accountId: 'acc-bank', net: 1000, vat: 150, total: 1150, lines: [{ desc: 'تمور', categoryId: 'cat-dates', categoryName: 'تمور', groupId: 'grp-direct', groupName: 'المواد المباشرة', categoryKind: 'direct', net: 1000, vat: 150, expenseAmount: 1150, separatedVat: 0 }] }]
  return state
}

test('finance projection is least-privileged and exposes only opaque document ids', () => {
  const state = projectedFixture()
  const uploader = projectLedger(state, { id: 'staff', role: 'employee', active: true, grants: ['upload_expense'] })
  assert.deepEqual(uploader.documents.map(d => d.id), ['own'])
  assert.equal(uploader.documents[0].file.documentId, 'own')
  assert.equal('id' in uploader.documents[0].file, false)
  assert.deepEqual(uploader.documents[0].fields, { customerId: 'cust-1' })
  for (const sensitive of ['amount', 'lines', 'accountId', 'allocations', 'reference', 'date']) {
    assert.equal(sensitive in uploader.documents[0].fields, false, `${sensitive} leaked to upload-only employee`)
  }
  assert.equal('invoices' in uploader, false)
  assert.equal(uploader.accounts.length, 0)

  const customerManager = projectLedger(state, { id: 'manager', role: 'employee', active: true, grants: ['manage_customers'] })
  assert.ok(customerManager.customers.length > 0)
  assert.equal('openingBalance' in customerManager.customers[0], false)
  assert.equal('invoices' in customerManager, false)

  const reviewer = projectLedger(state, { id: 'accountant', role: 'employee', active: true, grants: ['review'] })
  assert.equal(reviewer.documents.length, 2)
  assert.ok(Array.isArray(reviewer.invoices))
  assert.equal('dashboard' in reviewer, false)

  const reports = projectLedger(state, { id: 'director', role: 'employee', active: true, grants: ['view_reports'] })
  assert.deepEqual(reports.documents.map(d => d.id), ['approved'])
  assert.ok(reports.dashboard)
  assert.ok(Array.isArray(reports.purchases))
  assert.ok(reports.accounts.length > 0)
  assert.ok(reports.categories.length > 0)
  assert.ok(reports.expenseGroups.length > 0)
  assert.ok(reports.taxSettings.length > 0)
  assert.equal('vatNumber' in reports.taxSettings[0], false)
  assert.equal(expenseReport(reports, { from: '2026-09-01', to: '2026-09-30' }).direct.total, 1150)
  assert.equal(ownerDashboard(reports, { from: '2026-09-01', to: '2026-09-30' }).direct, 1150)
})

test('duplicate invoice confirmation crosses the server whitelist and remains typed', () => {
  const state = createInitialState({ today: '2026-09-19' })
  const customerId = state.customers[0].id
  state.invoices = [{ id: 'existing', docId: 'old', customerId, number: 'DUP-1', date: '2026-09-18', lines: [{ desc: 'قديم', qty: 1, price: 1000 }], net: 1000, vat: 0, total: 1000, taxProfile: { mode: 'disabled', rateBps: 1500, vatNumber: '' }, approvedSeq: 1 }]
  state.documents = [{ id: 'new-doc', kind: 'sale', uploadedBy: 'owner', uploadedAt: '2026-09-19T00:00:00Z', status: 'pending', file: { id: 'org/new.pdf', name: 'new.pdf', type: 'application/pdf', size: 10 }, fields: { customerId, number: 'DUP-1', date: '2026-09-19', lines: [{ desc: 'جديد', qty: 1, price: 2000 }] } }]
  const actor = { id: 'owner', name: 'المالك', role: 'owner', active: true }
  const options = { requestId: '00000000-0000-4000-8000-000000000001', file: null, now: '2026-09-19T10:00:00Z' }
  assert.equal(executeCommand(state, actor, { type: 'DOC_APPROVE', id: 'new-doc' }, options).code, 'DUPLICATE_NUMBER')
  const approved = executeCommand(state, actor, { type: 'DOC_APPROVE', id: 'new-doc', confirmDuplicate: true }, options)
  assert.equal(approved.error, undefined)
  assert.equal(approved.state.invoices.length, 2)
  assert.equal(executeCommand(state, actor, { type: 'DOC_APPROVE', id: 'new-doc', confirmDuplicate: 'yes' }, options).code, 'INVALID_REQUEST')
})

test('mutation coordinator serializes revisions and coalesces double-submit', async () => {
  let revision = 0
  let release
  const gate = new Promise(resolve => { release = resolve })
  const sent = []
  const refreshes = []
  const coordinator = createMutationCoordinator({
    getRevision: () => revision,
    setRevision: next => { revision = next },
    randomUUID: (() => { let n = 0; return () => `request-${++n}` })(),
    send: async descriptor => { sent.push({ ...descriptor }); await gate; return { revision: descriptor.revision + 1, documentId: descriptor.requestId } },
    refresh: async reason => { refreshes.push(reason) },
  })
  const command = { type: 'CUSTOMER_ADD', name: 'عميل', whatsapp: '' }
  const first = coordinator.dispatch(command)
  const duplicate = coordinator.dispatch(command)
  assert.equal(first, duplicate)
  release()
  await first
  assert.equal(sent.length, 1)
  assert.equal(refreshes.length, 1)

  await Promise.all([coordinator.dispatch({ type: 'CUSTOMER_UPDATE', id: 'a', name: 'أ' }), coordinator.dispatch({ type: 'CUSTOMER_UPDATE', id: 'b', name: 'ب' })])
  assert.deepEqual(sent.slice(1).map(x => x.revision), [1, 2])
})

test('ambiguous retry reuses request id and conflict refreshes before returning', async () => {
  let revision = 4
  const ids = []
  const refreshes = []
  let attempt = 0
  const command = { type: 'DOC_APPROVE', id: 'doc' }
  const coordinator = createMutationCoordinator({
    getRevision: () => revision,
    setRevision: next => { revision = next },
    randomUUID: () => 'stable-request',
    send: async descriptor => {
      ids.push(descriptor.requestId)
      attempt++
      if (attempt === 1) throw Object.assign(new Error('network'), { code: 'FINANCE_UNAVAILABLE' })
      if (attempt === 3) throw Object.assign(new Error('conflict'), { code: 'CONFLICT' })
      return { revision: 5, documentId: 'doc' }
    },
    refresh: async reason => { refreshes.push(reason) },
  })
  assert.equal((await coordinator.dispatch(command)).code, 'FINANCE_UNAVAILABLE')
  assert.equal((await coordinator.dispatch(command)).error, undefined)
  assert.deepEqual(ids.slice(0, 2), ['stable-request', 'stable-request'])
  assert.equal((await coordinator.dispatch({ type: 'DOC_REJECT', id: 'other' })).code, 'CONFLICT')
  assert.ok(refreshes.includes('conflict'))
})
