import test from 'node:test'
import assert from 'node:assert/strict'
import { canEditLedger, operatesBusiness } from '../src/lib/adminAccess.js'

test('platform admin can edit only in a server-verified business', () => {
  assert.equal(canEditLedger('superadmin', 'business-a', 'ok'), true)
  assert.equal(canEditLedger('superadmin', null, 'ok'), false)
  for (const state of ['none', 'checking', 'error', undefined]) {
    assert.equal(canEditLedger('superadmin', 'business-a', state), false)
  }
})

test('accountant access and other tenant roles stay unchanged', () => {
  assert.equal(canEditLedger('accountant', 'business-a', 'none'), true)
  for (const role of ['owner', 'cashier', 'purchasing', null, 'unknown']) {
    assert.equal(canEditLedger(role, 'business-a', 'ok'), false)
    assert.equal(operatesBusiness(role, 'business-a', 'ok'), false)
  }
})
