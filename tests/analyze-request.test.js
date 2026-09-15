// اختبارات جانب المتصفح: نداء /api/analyze يحمل الجلسة الحقيقية أو يفشل صراحةً
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAnalyzeFetch, AnalysisAuthError } from '../src/lib/analyzeRequest.js'

const noSleep = async () => {}

function fakeResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, clone: () => ({ json: async () => body }), json: async () => body }
}

function sessionWith(token) {
  return { data: { session: token ? { access_token: token } : null } }
}

test('بلا جلسة: لا نداء للخادم، وخطأ مصادقة صريح بعد الانتظار', async () => {
  let calls = 0, reads = 0
  const analyzeFetch = createAnalyzeFetch({
    getSession: async () => { reads++; return sessionWith(null) },
    fetchImpl: async () => { calls++; return fakeResponse(200, {}) },
    sleep: noSleep,
  })
  await assert.rejects(
    () => analyzeFetch({ method: 'POST', body: '{}' }),
    e => e instanceof AnalysisAuthError && e.isAuthError && e.code === 'NO_SESSION',
  )
  assert.equal(calls, 0)
  assert.ok(reads > 1, 'ينتظر وصول جلسة PIN قبل الحكم بغيابها')
})

test('جلسة تصل متأخرة (مستخدم PIN) تُستخدم', async () => {
  let reads = 0, sentAuth = null
  const analyzeFetch = createAnalyzeFetch({
    getSession: async () => sessionWith(++reads >= 3 ? 'late-token' : null),
    fetchImpl: async (url, init) => { sentAuth = init.headers.authorization; return fakeResponse(200, {}) },
    sleep: noSleep,
  })
  const res = await analyzeFetch({ method: 'POST' })
  assert.equal(res.status, 200)
  assert.equal(sentAuth, 'Bearer late-token')
})

test('الجلسة تُرسل كـBearer مع الإبقاء على الترويسات الأصلية', async () => {
  let seen
  const analyzeFetch = createAnalyzeFetch({
    getSession: async () => sessionWith('tok'),
    fetchImpl: async (url, init) => { seen = { url, init }; return fakeResponse(200, {}) },
    sleep: noSleep,
  })
  await analyzeFetch({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"x":1}' })
  assert.equal(seen.url, '/api/analyze')
  assert.equal(seen.init.headers.authorization, 'Bearer tok')
  assert.equal(seen.init.headers['content-type'], 'application/json')
  assert.equal(seen.init.body, '{"x":1}')
})

test('401 من الخادم يصبح خطأ مصادقة لا نجاحاً', async () => {
  const analyzeFetch = createAnalyzeFetch({
    getSession: async () => sessionWith('expired'),
    fetchImpl: async () => fakeResponse(401, { error: 'INVALID_SESSION' }),
    sleep: noSleep,
  })
  await assert.rejects(() => analyzeFetch({}), e => e.isAuthError && e.code === 'INVALID_SESSION')
})

test('403 NOT_A_MEMBER يصبح خطأ مصادقة برسالة واضحة', async () => {
  const analyzeFetch = createAnalyzeFetch({
    getSession: async () => sessionWith('tok'),
    fetchImpl: async () => fakeResponse(403, { error: 'NOT_A_MEMBER' }),
    sleep: noSleep,
  })
  await assert.rejects(() => analyzeFetch({}), e => e.isAuthError && e.code === 'NOT_A_MEMBER' && /غير مرتبط/.test(e.message))
})

test('500 AUTH_UNAVAILABLE يُظهر فشل التحقق المؤقت لشاشات الرفع', async () => {
  const analyzeFetch = createAnalyzeFetch({
    getSession: async () => sessionWith('tok'),
    fetchImpl: async () => fakeResponse(500, { error: 'AUTH_UNAVAILABLE' }),
    sleep: noSleep,
  })
  await assert.rejects(
    () => analyzeFetch({}),
    e => e instanceof AnalysisAuthError && e.isAuthError && e.code === 'AUTH_UNAVAILABLE'
      && /بعد قليل/.test(e.message) && !/سجّل الخروج/.test(e.message),
  )
})

test('500 لسبب آخر يُعاد دون استهلاك جسم الرد أو اعتباره فشل دخول', async () => {
  const response = fakeResponse(500, { error: 'UPSTREAM_FAILED' })
  const analyzeFetch = createAnalyzeFetch({
    getSession: async () => sessionWith('tok'),
    fetchImpl: async () => response,
    sleep: noSleep,
  })
  const res = await analyzeFetch({})
  assert.equal(res, response)
  assert.deepEqual(await res.json(), { error: 'UPSTREAM_FAILED' })
})

test('403 لسبب غير المصادقة (FORBIDDEN_ORIGIN) يُعاد كما هو للمعالجة المعتادة', async () => {
  const analyzeFetch = createAnalyzeFetch({
    getSession: async () => sessionWith('tok'),
    fetchImpl: async () => fakeResponse(403, { error: 'FORBIDDEN_ORIGIN' }),
    sleep: noSleep,
  })
  const res = await analyzeFetch({})
  assert.equal(res.status, 403)
})

test('تعذّر قراءة الجلسة لا يتحول إلى نداء غير موثّق', async () => {
  let calls = 0
  const analyzeFetch = createAnalyzeFetch({
    getSession: async () => { throw new Error('storage blocked') },
    fetchImpl: async () => { calls++; return fakeResponse(200, {}) },
    sleep: noSleep,
  })
  await assert.rejects(() => analyzeFetch({}), e => e.code === 'NO_SESSION')
  assert.equal(calls, 0)
})
