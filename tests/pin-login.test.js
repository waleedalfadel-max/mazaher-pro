// دخول الرمز عبر /api/pin-login: تحويل ردود الخادم إلى حالات الشاشة، بلا شبكة.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pinLogin, throttleMessage } from '../src/lib/pinLogin.js'
import { waitText } from '../src/lib/waitText.js'
import { createStaff, setStaffPin } from '../src/lib/staffCredentials.js'

const fake = (status, body) => async () => ({ status, json: async () => body })

test('الطلب: المسار والجسم (النطاق والرمز فقط)', async () => {
  const calls = []
  await pinLogin(async (url, init) => { calls.push([url, JSON.parse(init.body)]); return { status: 403, json: async () => ({ error: 'INVALID' }) } }, { subdomain: '__dev__', pin: '12345' })
  assert.deepEqual(calls, [['/api/pin-login', { subdomain: '__dev__', pin: '12345' }]])
})

test('النجاح يتطلب المستخدم وtokenHash معًا', async () => {
  assert.equal((await pinLogin(fake(200, { user: { id: 'u1', role: 'owner' }, tokenHash: 'h' }), { subdomain: 'x', pin: '12345' })).kind, 'ok')
  assert.equal((await pinLogin(fake(200, { user: { id: 'u1' } }), { subdomain: 'x', pin: '12345' })).kind, 'error')
  assert.equal((await pinLogin(fake(200, { tokenHash: 'h' }), { subdomain: 'x', pin: '12345' })).kind, 'error')
})

test('الرفض والحد وفشل الشبكة', async () => {
  assert.deepEqual(await pinLogin(fake(403, { error: 'INVALID', tenantResolved: false }), { subdomain: 'x', pin: '1' }), { kind: 'invalid', tenantResolved: false })
  assert.deepEqual(await pinLogin(fake(429, { error: 'THROTTLED', retryAfter: 300 }), { subdomain: 'x', pin: '1' }), { kind: 'throttled', retryAfter: 300 })
  assert.equal((await pinLogin(fake(500, {}), { subdomain: 'x', pin: '1' })).kind, 'error')
  assert.equal((await pinLogin(async () => { throw new Error('down') }, { subdomain: 'x', pin: '1' })).kind, 'error')
})

test('رسالة الحد بالمدة وحدها، بلا تفاصيل أخرى', () => {
  assert.match(throttleMessage(900), /15 دقيقة/)
  assert.match(throttleMessage(60), /دقيقة/)
  assert.match(throttleMessage(120), /دقيقتين/)
  assert.doesNotMatch(throttleMessage(900), /\d{5}/)
})

test('المدة تطابق retry_after: دقائق حتى 59 ثم ساعات، مقرّبة للأعلى', () => {
  assert.equal(waitText(2640), '44 دقيقة')
  assert.equal(waitText(3599), 'ساعة')
  assert.equal(waitText(3600), 'ساعة')
  assert.equal(waitText(3601), 'ساعتين')
  assert.equal(waitText(75420), '21 ساعة')
  assert.equal(waitText(600), '10 دقائق')
  assert.match(throttleMessage(3600), /حاول بعد ساعة\./)
})

test('حد إدارة الموظفين: الرسالة بمدة الخادم، وبلا مدة رسالة عامة', async () => {
  const r = await setStaffPin({ rpc: async () => ({ data: { ok: false, code: 'try_later', retry_after: 1200 } }) }, 'target', '930002')
  assert.equal(r.ok, false)
  assert.match(r.message, /بعد 20 دقيقة\./)
  const r2 = await createStaff({ rpc: async () => ({ data: { ok: false, code: 'try_later' } }) }, { name: 'x', role: 'cashier', pin: '930003' })
  assert.match(r2.message, /انتظر قليلًا/)
})
