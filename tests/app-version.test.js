// فحص إصدار الواجهة ومنع الكتابة من صفحة قديمة، بلا شبكة.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { checkVersion, currentVersion, guardedFetch, isStale, markStale, onStale, resetStaleForTests, STALE_MESSAGE } from '../src/lib/appVersion.js'

beforeEach(() => resetStaleForTests())
const json = (status, body) => async () => ({ status, json: async () => body })

test('رقم الصفحة من وسم app-version', () => {
  assert.equal(currentVersion({ querySelector: () => ({ getAttribute: () => 'abc123' }) }), 'abc123')
  assert.equal(currentVersion({ querySelector: () => null }), null)
})

test('المقارنة: نفسه، ومختلف، وطلب بلا تخزين مؤقت وبمعامل يمنع الذاكرة', async () => {
  const calls = []
  const f = async (url, init) => { calls.push([url, init.cache]); return { status: 200, json: async () => ({ version: 'v1' }) } }
  assert.deepEqual(await checkVersion(f, 'v1'), { status: 'same', remote: 'v1' })
  assert.deepEqual(await checkVersion(f, 'v0'), { status: 'changed', remote: 'v1' })
  assert.match(calls[0][0], /^\/version\.json\?t=\d+$/); assert.equal(calls[0][1], 'no-store')
})

test('تعذّر الفحص لا يُعدّ تحديثًا: شبكة، وخطأ خادم، ورد غير صالح، وبلا رقم للصفحة', async () => {
  assert.equal((await checkVersion(async () => { throw new TypeError('Failed to fetch') }, 'v1')).status, 'unknown')
  assert.equal((await checkVersion(json(503, null), 'v1')).status, 'unknown')
  assert.equal((await checkVersion(async () => ({ status: 200, json: async () => { throw new SyntaxError('bad') } }), 'v1')).status, 'unknown')
  assert.equal((await checkVersion(json(200, { version: '' }), 'v1')).status, 'unknown')
  assert.equal((await checkVersion(json(200, { version: 'v2' }), null)).status, 'unknown')
})

test('قبل اكتشاف التحديث: كل الطلبات تمر', async () => {
  const sent = []
  const f = guardedFetch(async (u, i) => { sent.push([u, i?.method]); return { status: 201 } })
  await f('http://x/rest/v1/rpc/approval_approve', { method: 'POST' })
  await f('http://x/storage/v1/object/documents/a.png', { method: 'POST' })
  assert.equal(sent.length, 2); assert.equal(isStale(), false)
})

test('بعد اكتشافه: الكتابة إلى القاعدة والتخزين تُرفض دون إرسال برسالة عربية؛ القراءة والجلسة والمسارات الأخرى تمر', async () => {
  const sent = []
  const f = guardedFetch(async (u, i) => { sent.push([u, i?.method || 'GET']); return { status: 200 } })
  let notified = null
  onStale(r => { notified = r })
  markStale('v2')
  assert.equal(isStale(), true); assert.equal(notified, 'v2')
  for (const [u, m] of [['http://x/rest/v1/rpc/approval_approve', 'POST'], ['http://x/rest/v1/documents?id=eq.1', 'PATCH'], ['http://x/rest/v1/documents?id=eq.1', 'DELETE'],
                        ['http://x/storage/v1/object/documents/a.png', 'POST']]) {
    const r = await f(u, { method: m })
    assert.equal(r.status, 409)
    const b = await r.json(); assert.equal(b.code, 'APP_VERSION_STALE'); assert.equal(b.message, STALE_MESSAGE)
  }
  await f('http://x/rest/v1/documents?select=id', { method: 'GET' })
  await f('http://x/rest/v1/documents?select=id', { method: 'HEAD' })
  await f('http://x/auth/v1/token?grant_type=refresh_token', { method: 'POST' })
  await f('http://x/storage/v1/object/sign/documents/a.png', { method: 'POST' })   // رابط موقّع لعرض الصورة
  await f('http://x/rest/v1/rpc/approval_mode', { method: 'POST' })                  // دالة قراءة
  await f('http://x/rest/v1/rpc/approval_prepare', { method: 'POST' })               // تجهيز العرض
  assert.deepEqual(sent.map(s => s[1]), ['GET', 'HEAD', 'POST', 'POST', 'POST', 'POST'])
  for (const fn of ['next_journal_number', 'staff_set_pin', 'category_create', 'approval_correct_sales_report', 'team_set_active']) {
    assert.equal((await f('http://x/rest/v1/rpc/' + fn, { method: 'POST' })).status, 409, fn)
  }
  assert.match(STALE_MESSAGE, /حدّث الصفحة/)
})
