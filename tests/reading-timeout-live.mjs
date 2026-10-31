// اختبار محلي بالوقت الحقيقي وبالمهلات المنشورة نفسها (لا مهلات مصغّرة): خادم HTTP محلي يشغّل وكيل القراءة الحقيقي
// (createClaudeProxyHandler بإعداد api/analyze.js) أمام مزوّد تركيبي محلي، ونداء المتصفح الحقيقي (createAnalyzeFetch) عبر fetch.
//  1) رد صحيح يتأخر 35 ثانية (أطول من الحد القديم 30) يصل كاملًا.
//  2) مزوّد لا يرد أبدًا: الوكيل يقطع النداء عند 270 ثانية ويرد READING_TIMEOUT قبل حد الاستضافة (300)، والمتصفح يرى خطأ مهلة عربيًا،
//     بنداء واحد للمزوّد (لا إعادة تلقائية) وبلا أي جزء من رد.
// التشغيل: node tests/reading-timeout-live.mjs  (قرابة خمس دقائق). لا اتصال خارج الجهاز، والمفتاح تركيبي.
import http from 'node:http'
import assert from 'node:assert/strict'
process.env.CLAUDE_MODEL = 'test-model'
delete process.env.ENFORCE_ORIGIN
const { createClaudeProxyHandler, READING_UPSTREAM_TIMEOUT_MS, READING_HOST_LIMIT_MS } = await import('../api/_claudeProxy.js')
const { createAnalyzeFetch, ReadingTimeoutError, BROWSER_READING_TIMEOUT_MS } = await import('../src/lib/analyzeRequest.js')

const reply = { content: [{ type: 'text', text: '{"invoices":[{"type":"expense","description":"فاتورة تركيبية من صفحتين","totalAmount":115}]}' }], stop_reason: 'end_turn', usage: { output_tokens: 40 } }
let mode = 'slow', providerCalls = 0, providerClosed = 0
const servers = []
const listen = server => new Promise(r => { servers.push(server); server.listen(0, '127.0.0.1', () => r(server.address().port)) })
// المزوّد التركيبي
const providerPort = await listen(http.createServer((req, res) => {
  providerCalls++
  req.resume()
  res.on('close', () => { if (!res.writableEnded) providerClosed++ })
  if (mode === 'slow') setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(reply)) }, 35_000)
  // mode === 'hang': لا رد
}))
const logs = []
const handler = createClaudeProxyHandler({ name: 'analyze', validateJson: true, upstreamTimeoutMs: READING_UPSTREAM_TIMEOUT_MS,
  authenticate: async () => ({ ok: true, user: { appUserId: 'synthetic' } }), getApiKey: () => 'sk-synthetic',
  fetchImpl: (url, init) => fetch(`http://127.0.0.1:${providerPort}/v1/messages`, init),
  logger: { info: (...a) => logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')), warn: (...a) => logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')), error: (...a) => logs.push(a.join(' ')) } })
// خادم القراءة المحلي بشكل طلب/رد Vercel (status/json/setHeader)
const apiPort = await listen(http.createServer((req, res) => {
  let raw = ''
  req.on('data', d => raw += d).on('end', async () => {
    const vreq = { method: req.method, headers: { ...req.headers, origin: 'https://mazaher.tahseeb.app', 'x-forwarded-for': '198.51.100.9' }, body: JSON.parse(raw) }
    const vres = { status(c) { res.statusCode = c; return vres }, setHeader: (k, v) => res.setHeader(k, v), json(d) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(d)); return vres } }
    await handler(vreq, vres)
  })
}))
const analyzeFetch = createAnalyzeFetch({ getSession: async () => ({ data: { session: { access_token: 'synthetic' } } }),
  fetchImpl: (url, init) => fetch(`http://127.0.0.1:${apiPort}${url}`, init) })
const body = JSON.stringify({ model: 'test-model', max_tokens: 4000, messages: [{ role: 'user', content: [{ type: 'text', text: 'synthetic' }] }] })
const out = { limits: { hostMs: READING_HOST_LIMIT_MS, upstreamMs: READING_UPSTREAM_TIMEOUT_MS, browserMs: BROWSER_READING_TIMEOUT_MS }, cases: [] }
try {
  let t0 = Date.now()
  const res = await analyzeFetch({ method: 'POST', headers: { 'content-type': 'application/json' }, body })
  const ms = Date.now() - t0, data = await res.json()
  assert.equal(res.status, 200); assert.deepEqual(data, reply); assert.ok(ms >= 35_000 && ms < 40_000, String(ms)); assert.equal(providerCalls, 1)
  out.cases.push({ name: 'رد صحيح بعد 35 ثانية يصل كاملًا', ms, status: res.status, providerCalls })
  console.log('PASS رد صحيح بعد', ms, 'ms')

  mode = 'hang'; providerCalls = 0; t0 = Date.now()
  let err
  try { await analyzeFetch({ method: 'POST', headers: { 'content-type': 'application/json' }, body }) } catch (e) { err = e }
  const ms2 = Date.now() - t0
  assert.ok(err instanceof ReadingTimeoutError, String(err)); assert.equal(err.source, 'server')
  assert.ok(ms2 >= READING_UPSTREAM_TIMEOUT_MS && ms2 < READING_HOST_LIMIT_MS, String(ms2))
  await new Promise(r => setTimeout(r, 200))
  assert.equal(providerCalls, 1); assert.equal(providerClosed, 1, 'نداء المزوّد قُطع فعلًا')
  assert.ok(logs.some(l => l.includes('انتهت مهلة المزوّد')))
  out.cases.push({ name: 'مزوّد بلا رد: قطع عند مهلة الخادم قبل حد الاستضافة', ms: ms2, error: err.name, source: err.source, message: err.message, providerCalls, providerClosed })
  console.log('PASS انتهاء المهلة بعد', ms2, 'ms —', err.message)
  out.logs = logs
  out.result = 'PASS'
} catch (e) { out.result = 'FAIL ' + e.message; console.log('FAIL', e.message); process.exitCode = 1 }
finally { console.log(JSON.stringify(out)); for (const s of servers) { s.closeAllConnections(); s.close() } }
