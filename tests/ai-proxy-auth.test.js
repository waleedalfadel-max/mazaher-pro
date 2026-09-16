// اختبارات حماية نقاط Claude — بمزوّد وهمي وعميل Supabase وهمي، بلا أي شبكة
// ولا استهلاك مدفوع ولا بيانات حقيقية.
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.CLAUDE_MODEL = 'test-model'
delete process.env.ENFORCE_ORIGIN

const { createClaudeProxyHandler } = await import('../api/_claudeProxy.js')
const { authenticateRequest, extractBearerToken } = await import('../api/_auth.js')

const SERVER_KEY   = 'sk-test-SERVER-KEY-must-not-be-logged'
const GOOD_TOKEN   = 'good-session-token-must-not-be-logged'
const INVOICE_TEXT = 'SECRET-INVOICE مورد اللحوم 115.00'

// ── التقاط كل ما يُكتب للكونسول (الحارس يكتب مباشرة لا عبر logger) ──
let logs = []
const originals = {}
beforeEach(() => {
  logs = []
  for (const k of ['log', 'info', 'warn', 'error']) {
    originals[k] = console[k]
    console[k] = (...args) => logs.push(args.map(String).join(' '))
  }
})
afterEach(() => {
  for (const k of Object.keys(originals)) console[k] = originals[k]
})

function fakeAdmin({ memberId = 'app-1', member, getUserThrows = false, memberError = false } = {}) {
  const row = member === undefined ? { id: memberId, project_id: 'project-1', role: 'accountant' } : member
  return {
    auth: {
      async getUser(token) {
        if (getUserThrows) throw new Error('network down')
        if (token !== GOOD_TOKEN) return { data: { user: null }, error: { message: 'invalid JWT' } }
        return { data: { user: { id: 'auth-user-1' } }, error: null }
      },
    },
    from(table) {
      assert.equal(table, 'app_users')
      return {
        select: () => ({
          eq: (column, value) => {
            assert.equal(column, 'auth_id')
            return {
              maybeSingle: async () => memberError
                ? { data: null, error: { message: 'db down' } }
                : { data: value === 'auth-user-1' ? row : null, error: null },
            }
          },
        }),
      }
    },
  }
}

function makeProvider(payload, status = 200) {
  const body = payload ?? {
    content: [{ type: 'text', text: `{"invoices":[{"description":"${INVOICE_TEXT}"}]}` }],
    stop_reason: 'end_turn',
  }
  const calls = []
  return {
    calls,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { status, json: async () => body } },
  }
}

function makeHandler({ adminOpts, provider = makeProvider(), validateJson = true, getAdmin } = {}) {
  const handler = createClaudeProxyHandler({
    name: 'test',
    validateJson,
    authenticate: req => authenticateRequest(req, { getAdmin: getAdmin || (async () => fakeAdmin(adminOpts)) }),
    fetchImpl: provider.fetchImpl,
    getApiKey: () => SERVER_KEY,
  })
  return { handler, provider }
}

function validBody(extra = {}) {
  return {
    model: 'test-model',
    max_tokens: 100,
    messages: [{ role: 'user', content: [{ type: 'text', text: INVOICE_TEXT }] }],
    ...extra,
  }
}

function makeReq({ authorization = `Bearer ${GOOD_TOKEN}`, body = validBody() } = {}) {
  const headers = { origin: 'https://mazaher.tahseeb.app', 'x-forwarded-for': '203.0.113.7' }
  if (authorization !== null) headers.authorization = authorization
  return { method: 'POST', headers, body }
}

function makeRes() {
  const r = { statusCode: 200, body: undefined, headers: {} }
  r.status = code => { r.statusCode = code; return r }
  r.json = data => { r.body = data; return r }
  r.setHeader = (k, v) => { r.headers[k] = v }
  return r
}

async function run(handlerOpts = {}, reqOpts = {}) {
  const { handler, provider } = makeHandler(handlerOpts)
  const res = makeRes()
  await handler(makeReq(reqOpts), res)
  return { res, calls: provider.calls }
}

// ── الرفض لا يستدعي المزوّد إطلاقاً ──────────────────────────────────────

test('طلب بلا جلسة يُرفض ولا يستدعي المزوّد', async () => {
  const { res, calls } = await run({}, { authorization: null })
  assert.equal(res.statusCode, 401)
  assert.equal(res.body.error, 'AUTH_REQUIRED')
  assert.equal(calls.length, 0)
})

test('ترويسة Authorization بغير Bearer تُرفض', async () => {
  const { res, calls } = await run({}, { authorization: 'Basic dXNlcjpwYXNz' })
  assert.equal(res.statusCode, 401)
  assert.equal(calls.length, 0)
})

test('رمز جلسة مزوَّر يُرفض', async () => {
  const { res, calls } = await run({}, { authorization: 'Bearer forged-token' })
  assert.equal(res.statusCode, 401)
  assert.equal(res.body.error, 'INVALID_SESSION')
  assert.equal(calls.length, 0)
})

test('مستخدم موثّق بلا صف app_users (غير عضو) يُرفض', async () => {
  const { res, calls } = await run({ adminOpts: { member: null } })
  assert.equal(res.statusCode, 403)
  assert.equal(res.body.error, 'NOT_A_MEMBER')
  assert.equal(calls.length, 0)
})

test('الهوية تُفحص قبل شكل الجسم — لا يُكشف سبب التحقق لغير الموثّق', async () => {
  const { res, calls } = await run({}, { authorization: null, body: { junk: true } })
  assert.equal(res.statusCode, 401)
  assert.equal(calls.length, 0)
})

// ── فشل المصادقة لا يتحول إلى نجاح ────────────────────────────────────────

test('تعذّر التحقق من الجلسة (خطأ شبكة) يُرفض لا يُسمح', async () => {
  const { res, calls } = await run({ adminOpts: { getUserThrows: true } })
  assert.equal(res.statusCode, 500)
  assert.equal(res.body.error, 'AUTH_UNAVAILABLE')
  assert.equal(calls.length, 0)
})

test('تعذّر قراءة العضوية يُرفض لا يُسمح', async () => {
  const { res, calls } = await run({ adminOpts: { memberError: true } })
  assert.equal(res.statusCode, 500)
  assert.equal(calls.length, 0)
})

test('غياب مفتاح service_role على الخادم يُرفض لا يُسمح', async () => {
  const { res, calls } = await run({
    getAdmin: async () => { throw new Error('SUPABASE_SERVICE_ROLE_KEY (or URL) not configured on server') },
  })
  assert.equal(res.statusCode, 500)
  assert.equal(calls.length, 0)
})

// ── المستخدم الصحيح يعمل ─────────────────────────────────────────────────

test('المستخدم الصحيح يصل للمزوّد مرة واحدة بجسم نظيف', async () => {
  const { res, calls } = await run({}, {
    body: validBody({ role: 'owner', project_id: 'another-project', tools: [{ name: 'x' }] }),
  })
  assert.equal(res.statusCode, 200)
  assert.equal(calls.length, 1)

  const sent = JSON.parse(calls[0].init.body)
  assert.equal(sent.role, undefined, 'الدور من المتصفح لا يُمرَّر')
  assert.equal(sent.project_id, undefined, 'المشروع من المتصفح لا يُمرَّر')
  assert.equal(sent.tools, undefined)
  assert.equal(calls[0].init.headers['x-api-key'], SERVER_KEY)
  assert.ok(!JSON.stringify(calls[0].init.headers).includes(GOOD_TOKEN), 'رمز جلسة المستخدم لا يُمرَّر للمزوّد')
})

test('رد غير قابل للتحليل يُعاد كخطأ JSON_PARSE_ERROR للمستخدم الموثّق', async () => {
  const { res, calls } = await run({
    provider: makeProvider({ content: [{ type: 'text', text: `{"a": ${INVOICE_TEXT}}` }] }),
  })
  assert.equal(calls.length, 1)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.error, 'JSON_PARSE_ERROR')
})

test('نقطة chat تحمل نفس الاشتراط', async () => {
  const denied = await run({ validateJson: false }, { authorization: null })
  assert.equal(denied.res.statusCode, 401)
  assert.equal(denied.calls.length, 0)

  const allowed = await run({ validateJson: false })
  assert.equal(allowed.res.statusCode, 200)
  assert.equal(allowed.calls.length, 1)
})

// ── السجلات ────────────────────────────────────────────────────────────

test('السجلات لا تحتوي مفتاح الخادم ولا رمز الجلسة ولا نص الفاتورة', async () => {
  await run()                                                     // نجاح
  await run({ provider: makeProvider({ content: [{ type: 'text', text: `{"a": ${INVOICE_TEXT}}` }] }) }) // V8 يضمّن مقتطفاً برسالة JSON.parse
  await run({ provider: makeProvider({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 529) })
  await run({}, { authorization: 'Bearer forged-token' })
  await run({ provider: { calls: [], fetchImpl: async () => { throw new Error(`boom ${INVOICE_TEXT}`) } } })

  assert.ok(logs.length > 0, 'الالتقاط يعمل فعلاً')
  const all = logs.join('\n')
  // علامة الفاتورة قصيرة عمداً: مقتطف V8 برسالة JSON.parse يُقتطع بعد بضعة أحرف
  // من موضع الخطأ ("SECRET-I"...)، فبحثٌ عن نصّ أطول كان سيُفلت التسرّب فعلاً
  for (const secret of [SERVER_KEY, GOOD_TOKEN, 'SECRET']) {
    assert.ok(!all.includes(secret), `تسرّب إلى السجلات: ${secret}`)
  }
})

// ── حد المعدل ──────────────────────────────────────────────────────────

test('حد المعدل لكل مستخدم يوقف المزوّد بعد 20 طلباً بالدقيقة', async () => {
  const provider = makeProvider()
  const { handler } = makeHandler({ adminOpts: { memberId: 'app-rate-limit' }, provider })
  const statuses = []
  for (let i = 0; i < 21; i++) {
    const res = makeRes()
    await handler(makeReq(), res)
    statuses.push(res.statusCode)
  }
  assert.equal(statuses.filter(s => s === 200).length, 20)
  assert.equal(statuses[20], 429)
  assert.equal(provider.calls.length, 20)
})

// ── استخراج الرمز ──────────────────────────────────────────────────────

test('extractBearerToken', () => {
  assert.equal(extractBearerToken({ headers: { authorization: 'Bearer abc' } }), 'abc')
  assert.equal(extractBearerToken({ headers: { authorization: 'bearer abc' } }), 'abc')
  assert.equal(extractBearerToken({ headers: { authorization: 'Bearer' } }), null)
  assert.equal(extractBearerToken({ headers: { authorization: 'Bearer a b' } }), null)
  assert.equal(extractBearerToken({ headers: {} }), null)
  assert.equal(extractBearerToken({}), null)
})
