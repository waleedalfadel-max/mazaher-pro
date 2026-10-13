// عزل نموذج التصميم: شجرة استيراده الفعلية (من esbuild) لا تصل إلى Supabase ولا /api ولا القراءة
// الآلية ولا أي ملف من التطبيق الحالي، والمتصفح نفسه ممنوع من الاتصال خارج الخادم المحلي.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/prototype/main.jsx'],
  bundle: true, write: false, metafile: true, outdir: 'unused', format: 'esm',
  packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent',
})
const inputs = Object.keys(result.metafile.inputs)
const externals = new Set(Object.values(result.metafile.outputs).flatMap(o => o.imports.filter(i => i.external).map(i => i.path)))
const ALLOWED_PACKAGES = /^(react|react-dom(\/client)?|react-router-dom|lucide-react|@fontsource(-variable)?\/[\w-]+\/[\w.-]+\.css)$/

test('كل ملف محلي في شجرة النموذج من src/prototype أو src/ui فقط', () => {
  assert.ok(inputs.length > 5)
  const outside = inputs.filter(p => !p.startsWith('src/prototype/') && !p.startsWith('src/ui/'))
  assert.deepEqual(outside, [])
})

test('الحزم الخارجية من قائمة محددة، وليس بينها Supabase', () => {
  const unexpected = [...externals].filter(p => !ALLOWED_PACKAGES.test(p))
  assert.deepEqual(unexpected, [])
  assert.ok(![...externals].some(p => /supabase/i.test(p)))
})

test('لا نص في كود النموذج يتصل بخادم أو يقرأ متغيرات البيئة', () => {
  for (const file of inputs.filter(p => /\.(js|jsx)$/.test(p))) {
    const text = readFileSync(root + file, 'utf8')
    assert.ok(!/supabase\s*[.(]|createClient|@supabase/.test(text), `${file}: Supabase`)
    // الحارس وحده يذكر /api والطلبات، لأنه هو الذي يمنعها
    const guard = file.endsWith('networkGuard.js')
    if (!guard) assert.ok(!/['"`]\/api\//.test(text), `${file}: /api`)
    assert.ok(!/import\.meta\.env/.test(text), `${file}: متغيرات البيئة`)
    assert.ok(!/serviceWorker/.test(text), `${file}: عامل خدمة`)
    if (!guard) assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon/.test(text), `${file}: طلب شبكة`)
  }
})

test('سياسة المحتوى تمنع أي اتصال خارج الخادم المحلي', () => {
  const html = readFileSync(root + 'prototype/index.html', 'utf8')
  const csp = html.match(/Content-Security-Policy"\s+content="([^"]+)"/)?.[1] || ''
  assert.match(csp, /default-src 'self'/)
  const connect = csp.match(/connect-src ([^;]+)/)?.[1] || ''
  assert.deepEqual(connect.trim().split(/\s+/).filter(s => s !== "'self'" && !/^ws:\/\/(127\.0\.0\.1|localhost):5192$/.test(s)), [])
  assert.ok(!/https?:/.test(csp), 'لا مصدر http(s) خارجي في السياسة')
})

test('إعداد الخادم لا يكشف متغيرات VITE_ ولا ملفات public', () => {
  const config = readFileSync(root + 'vite.prototype.config.js', 'utf8')
  assert.match(config, /envPrefix: 'PROTOTYPE_'/)
  assert.match(config, /publicDir: false/)
})

test('خادم النموذج لا يقدّم التطبيق الحقيقي', async () => {
  const { prototypeServerGuard, isAppPath } = await import('../prototype/server-guard.js')
  const config = readFileSync(root + 'vite.prototype.config.js', 'utf8')
  assert.ok(config.includes('plugins: [react(), prototypeServerGuard()]'), 'الحارس مفعّل في إعداد الخادم')
  let handler
  prototypeServerGuard().configureServer({ middlewares: { use: fn => { handler = fn } } })
  const call = url => new Promise(resolve => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, end() { resolve({ status: this.statusCode, location: this.headers.Location }) } }
    handler({ url }, res, () => resolve({ status: 'next' }))
  })
  assert.deepEqual(await call('/'), { status: 302, location: '/prototype/' })
  for (const url of ['/index.html', '/src/main.jsx', '/src/lib/supabase.js', '/src/pages/Login.jsx', '/src/contexts/AuthContext.jsx', '/api/analyze', '/sw.js']) {
    assert.equal((await call(url)).status, 403, url)
  }
  for (const url of ['/prototype/', '/src/prototype/main.jsx', '/src/ui/theme.css', '/@vite/client', '/node_modules/.vite/deps/react.js']) {
    assert.equal((await call(url)).status, 'next', url)
  }
  assert.equal(isAppPath('/src/ui/components.jsx'), false)
})

test('حارس بيئة الاختبار يرفض قاعدتي مزاهر وتتميرا وأي عنوان غير محلي', async () => {
  const { checkLocalTarget, assertLocalEnv } = await import('../local-test/guard.js')
  assert.equal(checkLocalTarget('http://127.0.0.1:54321'), null)
  assert.ok(checkLocalTarget('https://dnuxevxxgmgptptmuzdy.supabase.co'))
  assert.ok(checkLocalTarget('https://wqiregwcnknjyjhhwrww.supabase.co'))
  assert.ok(checkLocalTarget('https://example.supabase.co'))
  assert.ok(checkLocalTarget('http://10.0.0.5:54321'))
  assert.throws(() => assertLocalEnv({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', OTHER: 'x-dnuxevxxgmgptptmuzdy' }))
  assert.throws(() => assertLocalEnv({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', CLAUDE_API_KEY: 'k' }))
  assert.equal(assertLocalEnv({ VITE_SUPABASE_URL: 'http://localhost:54321' }), true)
})

test('بديل القراءة المحلي لا يتصل بشيء ويعيد شكل رد المزوّد', async () => {
  const src = readFileSync(root + 'local-test/api-middleware.js', 'utf8')
  assert.ok(!/\bfetch\(|https?:\/\/(?!local['"])/i.test(src), 'لا طلب شبكة ولا عنوان خارجي في البديل')
  const { stubReading } = await import('../local-test/api-middleware.js')
  // تُختار القراءة باسم الملف الذي يضعه التطبيق في نص الطلب
  const ask = name => ({ messages: [{ role: 'user', content: [{ type: 'text', text: `أنت مساعد محاسبي خبير. اسم الملف: ${name}\nالتعليمات…` }] }] })
  const r = JSON.parse((await stubReading(ask('upload-drinks.png'))).content[0].text)
  assert.equal(r._localStub, true)
  assert.equal(r.description, 'مورد المشروبات')
  assert.equal(r.totalAmount, Math.round(r.items.reduce((s, i) => s + i.amount, 0) * 100) / 100)
  const unknown = JSON.parse((await stubReading(ask('other.png'))).content[0].text)
  assert.equal(unknown._localStub, true)
  assert.deepEqual(unknown.items, [])
})
