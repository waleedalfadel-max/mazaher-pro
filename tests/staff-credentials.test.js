import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStaff, setStaffPin } from '../src/lib/staffCredentials.js'

test('create sends only requested fields, never client identity or tenant', async () => {
  const calls = []
  const client = { rpc: async (...args) => { calls.push(args); return { data: { ok: true, id: 'employee-id' } } } }
  assert.deepEqual(await createStaff(client, { name: ' موظف ', role: 'cashier', pin: '930001', projectId: 'forged', actor: 'forged' }), { ok: true, id: 'employee-id' })
  assert.deepEqual(calls, [['staff_create', { p_name: 'موظف', p_role: 'cashier', p_pin: '930001' }]])
})

test('reset uses its RPC with target and newly supplied PIN only', async () => {
  const calls = []
  const client = { rpc: async (...args) => { calls.push(args); return { data: { ok: true, id: 'target' } } } }
  assert.deepEqual(await setStaffPin(client, 'target', '930002'), { ok: true, id: 'target' })
  assert.deepEqual(calls, [['staff_set_pin', { p_user_id: 'target', p_pin: '930002' }]])
})

test('permission and duplicate refusals never look like success', async () => {
  for (const code of ['no_session', 'forbidden', 'not_found', 'invalid_pin', 'invalid_name', 'pin_in_use', 'save_failed']) {
    const result = await setStaffPin({ rpc: async () => ({ data: { ok: false, code } }) }, 'target', '930002')
    assert.equal(result.ok, false)
    assert.ok(result.message)
  }
})

test('malformed responses fail closed', async () => {
  for (const data of [null, {}, { ok: false, id: 'target' }, { ok: 'true', id: 'target' }, { ok: true }]) {
    assert.equal((await setStaffPin({ rpc: async () => ({ data }) }, 'target', '930002')).ok, false)
  }
})

test('raw errors and unknown codes are not exposed in UI messages', async () => {
  const sensitive = 'unexpected server row content'
  for (const response of [{ error: { message: sensitive } }, { data: { ok: false, code: sensitive } }]) {
    const result = await setStaffPin({ rpc: async () => response }, 'target', '930002')
    assert.equal(result.ok, false)
    assert.ok(!result.message.includes(sensitive))
  }
})

test('network exceptions return an uncertain-save message without exception text', async () => {
  const result = await setStaffPin({ rpc: async () => { throw Error('internal transport detail') } }, 'target', '930002')
  assert.equal(result.ok, false)
  assert.match(result.message, /تأكيد الحفظ/)
  assert.ok(!result.message.includes('internal'))
})

test('successful response is restricted to id and status', async () => {
  const result = await setStaffPin({ rpc: async () => ({ data: { ok: true, id: 'target', unwanted: 'extra' } }) }, 'target', '930002')
  assert.deepEqual(result, { ok: true, id: 'target' })
})
