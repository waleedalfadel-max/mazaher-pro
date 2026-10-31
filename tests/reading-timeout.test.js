// مهلة القراءة (2026-10-31): فاتورة صفحتين فشلت بـ504 لأن الاستضافة قطعت api/analyze.js عند 30 ثانية (سجل Vercel:
// "Task timed out after 30 seconds"). المهلات الثلاث منسّقة: الاستضافة 300 ثانية، والمزوّد 270، والمتصفح 320.
// انتهاء المهلة لا يُعاد تلقائيًا، ولا يعيد شيئًا جزئيًا، ويصل برسالة عربية. بيانات تركيبية فقط ولا اتصال خارجي.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.CLAUDE_MODEL = 'test-model'
delete process.env.ENFORCE_ORIGIN
const { createClaudeProxyHandler, READING_HOST_LIMIT_MS, READING_UPSTREAM_TIMEOUT_MS } = await import('../api/_claudeProxy.js')
const { createAnalyzeFetch, ReadingTimeoutError, BROWSER_READING_TIMEOUT_MS } = await import('../src/lib/analyzeRequest.js')
const { savedDocumentWarning } = await import('../src/lib/analysisFeedback.js')

const INVOICE_TEXT = 'SYNTHETIC-INVOICE فاتورة تركيبية 115.00'
const reply = { content: [{ type: 'text', text: `{"invoices":[{"description":"${INVOICE_TEXT}"}]}` }], stop_reason: 'end_turn' }

function makeRes() {
  const r = { statusCode: 200, body: undefined, headers: {} }
  r.status = code => { r.statusCode = code; return r }
  r.json = data => { r.body = data; return r }
  r.setHeader = (k, v) => { r.headers[k] = v }
  return r
}
let ip = 0
const makeReq = () => ({ method: 'POST', headers: { origin: 'https://mazaher.tahseeb.app', 'x-forwarded-for': `198.51.100.${++ip}` },
  body: { model: 'test-model', max_tokens: 100, messages: [{ role: 'user', content: [{ type: 'text', text: INVOICE_TEXT }] }] } })
// مزوّد تركيبي يرد بعد delay، ويحترم إشارة القطع كما يفعل fetch الحقيقي
function provider(delay) {
  const calls = []
  return { calls, fetchImpl: (url, init) => new Promise((resolve, reject) => {
    const call = { aborted: false }; calls.push(call)
    const t = delay == null ? null : setTimeout(() => resolve({ status: 200, json: async () => reply }), delay)
    init.signal?.addEventListener('abort', () => { call.aborted = true; clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
  }) }
}
function proxy(p, upstreamTimeoutMs, logs = []) {
  const logger = { info: (...a) => logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')), warn: (...a) => logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')), error: (...a) => logs.push(a.join(' ')) }
  return createClaudeProxyHandler({ name: 'analyze', validateJson: true, authenticate: async () => ({ ok: true, user: { appUserId: 'u' + ip } }),
    fetchImpl: p.fetchImpl, getApiKey: () => 'sk-test', logger, upstreamTimeoutMs })
}

test('المهلات منسّقة: المزوّد < الاستضافة (بهامش) < المتصفح، والاستضافة كما في vercel.json وضمن حد الخطة', () => {
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  assert.equal(cfg.functions['api/analyze.js'].maxDuration * 1000, READING_HOST_LIMIT_MS)
  assert.ok(READING_HOST_LIMIT_MS <= 300_000, 'حد الخطة الحالية (Hobby مع Fluid) 300 ثانية')
  assert.ok(READING_UPSTREAM_TIMEOUT_MS <= READING_HOST_LIMIT_MS - 20_000, 'هامش للتحقق من الدخول وإرسال الرد')
  assert.ok(READING_UPSTREAM_TIMEOUT_MS > 30_000 * 4, 'تتسع لقراءة فاتورة متعددة الصفحات')
  assert.ok(BROWSER_READING_TIMEOUT_MS > READING_HOST_LIMIT_MS, 'المتصفح لا يقطع قبل رد الخادم')
  assert.equal(cfg.functions['api/chat.js'].maxDuration, 30, 'المحادثة لم تتغير')
  assert.match(readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8'), /upstreamTimeoutMs: READING_UPSTREAM_TIMEOUT_MS/)
})

test('رد صحيح يتأخر (ضمن المهلة) يصل كاملًا', async () => {
  const p = provider(120), res = makeRes(), logs = []
  await proxy(p, 400, logs)(makeReq(), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, reply)
  assert.equal(p.calls[0].aborted, false)
  assert.ok(logs.some(l => l.includes('مدة المزوّد')))
  assert.ok(!logs.join(' ').includes('SYNTHETIC-INVOICE'), 'السجل بلا محتوى الفاتورة')
})

test('انتهاء مهلة المزوّد: قطع النداء ورد READING_TIMEOUT (504) بلا محتوى وبنداء واحد', async () => {
  const p = provider(null), res = makeRes(), logs = []
  const t0 = Date.now()
  await proxy(p, 150, logs)(makeReq(), res)
  assert.ok(Date.now() - t0 < 1500)
  assert.equal(res.statusCode, 504)
  assert.deepEqual(res.body, { error: 'READING_TIMEOUT' })
  assert.equal(p.calls.length, 1)
  assert.equal(p.calls[0].aborted, true, 'النداء قُطع فعلًا ولم يُترك يعمل')
  assert.ok(logs.some(l => l.includes('انتهت مهلة المزوّد')))
  assert.ok(!logs.join(' ').includes('SYNTHETIC-INVOICE') && !logs.join(' ').includes('sk-test'))
})

test('المحادثة بلا مهلة جديدة: سلوكها كما كان', async () => {
  const p = provider(30), res = makeRes()
  await createClaudeProxyHandler({ name: 'chat', authenticate: async () => ({ ok: true, user: { appUserId: 'c' } }), fetchImpl: p.fetchImpl, getApiKey: () => 'k', logger: { info() {}, warn() {}, error() {} } })(makeReq(), res)
  assert.equal(res.statusCode, 200)
})

const session = async () => ({ data: { session: { access_token: 'tok' } } })
test('المتصفح: READING_TIMEOUT من الخادم ⇒ خطأ مهلة عربي', async () => {
  const f = createAnalyzeFetch({ getSession: session, fetchImpl: async () => new Response(JSON.stringify({ error: 'READING_TIMEOUT' }), { status: 504 }) })
  await assert.rejects(f({}), e => e instanceof ReadingTimeoutError && e.source === 'server' && /أطول من المسموح/.test(e.message) && /بكل صفحاته/.test(e.message))
})

test('المتصفح: قطع الاستضافة (504 بنص غير JSON كما ترده Vercel) ⇒ خطأ مهلة لا «Claude API error 504»', async () => {
  const f = createAnalyzeFetch({ getSession: session, fetchImpl: async () => new Response('An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT', { status: 504 }) })
  await assert.rejects(f({}), e => e instanceof ReadingTimeoutError && e.source === 'host' && !/Claude|API|504/.test(e.message))
})

test('المتصفح: اتصال معلّق يُقطع عند مهلته ⇒ خطأ مهلة، بنداء واحد', async () => {
  let calls = 0, aborted = false
  const f = createAnalyzeFetch({ getSession: session, timeoutMs: 80, fetchImpl: (url, init) => new Promise((_, reject) => {
    calls++; init.signal.addEventListener('abort', () => { aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
  }) })
  await assert.rejects(f({}), e => e instanceof ReadingTimeoutError && e.source === 'browser')
  assert.equal(calls, 1); assert.equal(aborted, true)
})

test('المتصفح: جسم رد يتوقف في منتصفه يُقطع ولا يُعاد ناقصًا', async () => {
  const f = createAnalyzeFetch({ getSession: session, timeoutMs: 80, fetchImpl: async (url, init) => {
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"content":[{"type":"text","text":"{\\"invoi')) ; init.signal.addEventListener('abort', () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' }))) } })
    return new Response(body, { status: 200 })
  } })
  await assert.rejects(f({}), e => e instanceof ReadingTimeoutError)
})

test('المتصفح: رد صحيح يُعاد كاملًا بحالته', async () => {
  const f = createAnalyzeFetch({ getSession: session, fetchImpl: async () => new Response(JSON.stringify(reply), { status: 200 }) })
  const res = await f({})
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), reply)
})

test('رسالة الرفع عند انتهاء المهلة: المستند محفوظ ويُقرأ من «مستندات جديدة» دون رفع جديد', () => {
  const msg = savedDocumentWarning(new ReadingTimeoutError('host'))
  assert.match(msg, /^حُفظ المستند للمراجعة/)
  assert.match(msg, /«مستندات جديدة»/); assert.match(msg, /«قراءة المستند»/); assert.match(msg, /لا حاجة لرفعه مرة أخرى/)
  assert.doesNotMatch(msg, /Claude|API|504/)
  assert.equal(savedDocumentWarning(new Error('Claude API error 500: x')), 'حُفظ المستند للمراجعة — تعذّر إكمال التحليل التلقائي. لا حاجة لرفعه مرة أخرى.')
})
