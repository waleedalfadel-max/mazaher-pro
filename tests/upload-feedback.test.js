import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// نختبر أزرار المكوّنين الفعليين وclaude.js؛ الشبكة والتخزين وReact hooks فقط محاكية.
// لا حسابات حقيقية ولا اتصالات خارجية. يُبنى JSX بالتبعية الموجودة أصلًا في المشروع.
const pages = ['InvoiceUpload', 'CashierDashboard']
const bundles = new Map()
const mocks = {
  react: `const r = globalThis.doubles.react; export default r;
    export const { useState, useRef, useEffect, useCallback } = r;`,
  supabase: 'export const supabase = globalThis.doubles.supabase;',
  AuthContext: 'export const useAuth = () => globalThis.doubles.identity;',
  storage: `export const uploadToStorage = (...args) => globalThis.doubles.uploadToStorage(...args);
    export const getSignedUrl = async () => 'test-path';`,
  imageCompress: 'export const compressImage = async file => file;',
  projectSettings: 'export const getProjectSettings = async () => ({ settings: {} });',
}
for (const page of pages) {
  const built = await build({
    entryPoints: [fileURLToPath(new URL(`../src/pages/${page}.jsx`, import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'cjs',
    define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'test-doubles', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        const name = args.path.split('/').pop().replace(/\.js$/, '')
        if (Object.hasOwn(mocks, name)) return { path: name, namespace: 'mock' }
      })
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }))
    } }],
  })
  bundles.set(page, built.outputFiles[0].text)
}

const success = { content: [{ text: JSON.stringify({ invoices: [{ total: 115, items: [] }] }) }] }
const session = { data: { session: { access_token: 'synthetic-token' } } }

function harness(page, { responses = [{ status: 200, body: success }], saveError = false, missingSavedRow = false, uploadError = false } = {}) {
  const states = [], documents = [], calls = []
  let cursor = 0, requestIndex = 0, uploadCount = 0
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }),
    Fragment: Symbol('Fragment'),
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useRef: () => ({ current: null }), useEffect() {}, useCallback: fn => fn,
  }
  const supabase = {
    auth: { getSession: async () => session },
    from(table) {
      assert.ok(['documents', 'categories'].includes(table), 'لا كتابة في الدفتر أو أي جدول آخر')
      let operation = 'read', row, id
      function result() {
        if (table === 'categories') return { data: [], error: null }
        if (operation === 'insert') {
          const doc = { ...row, id: `doc-${documents.length + 1}` }
          documents.push(doc)
          return { data: { id: doc.id }, error: null }
        }
        if (operation === 'update') {
          if (saveError) return { data: null, error: { message: 'PRIVATE_SAVE_ERROR' } }
          if (missingSavedRow) return { data: null, error: null }
          Object.assign(documents.find(doc => doc.id === id), row)
          return { data: { id }, error: null }
        }
        return { data: documents, error: null }
      }
      const query = {
        select() { return this }, order() { return this }, limit() { return this },
        eq(field, value) { if (field === 'id') id = value; return this },
        insert(value) { operation = 'insert'; row = value; return this },
        update(value) { operation = 'update'; row = value; return this },
        single: async () => result(),
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject) },
      }
      return query
    },
  }
  const doubles = {
    react, supabase,
    identity: { role: 'owner', userName: 'Test', projectId: 'test-project', projectName: 'Test' },
    uploadToStorage: async () => {
      uploadCount++
      if (uploadError) throw new Error('تعذّر رفع الملف')
      return 'test-path'
    },
  }
  const context = vm.createContext({
    module: { exports: {} }, doubles, console, setTimeout,
    FileReader: class {
      readAsDataURL() { this.onload({ target: { result: 'data:application/pdf;base64,JVBERi0=' } }) }
    },
    fetch: async (url, init) => {
      calls.push({ url, init })
      assert.equal(url, '/api/analyze')
      assert.equal(init.headers.authorization, 'Bearer synthetic-token')
      const next = responses[requestIndex++]
      assert.ok(next, 'لا إعادة طلب التحليل تلقائيًا')
      if (next.networkError) throw new TypeError('PRIVATE_NETWORK_ERROR')
      return new Response(JSON.stringify(next.body), { status: next.status })
    },
  })
  vm.runInContext(bundles.get(page), context)
  const render = () => { cursor = 0; return context.module.exports.default() }
  return {
    documents, calls, render, get uploadCount() { return uploadCount },
    async upload(count = 1) {
      const input = walk(render()).find(node => node.type === 'input' && node.props.type === 'file')
      const files = Array.from({ length: count }, (_, i) => ({ name: `test-${i}.pdf`, type: 'application/pdf', size: 100 }))
      input.props.onChange({ target: { files } })
      const button = walk(render()).find(node => node.type === 'button' && text(node).includes('⬆️ رفع'))
      assert.ok(button, 'زر الرفع الحقيقي موجود')
      await button.props.onClick()
      await new Promise(resolve => setImmediate(resolve))
      return render()
    },
  }
}

function walk(node) {
  if (!node || typeof node !== 'object') return []
  return [node, ...(node.props?.children || []).flatMap(walk)]
}
function text(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node !== 'object') return String(node)
  return (node.props?.children || []).map(text).join(' ')
}

const failures = [
  ['غياب مفتاح الخادم', { status: 500, body: { error: 'CLAUDE_API_KEY not configured on server' } }],
  ['تعذّر التحقق من العضوية', { status: 500, body: { error: 'AUTH_UNAVAILABLE' } }],
  ['حد الاستخدام', { status: 429, body: { error: 'RATE_LIMITED' } }],
  ['انقطاع الشبكة', { networkError: true }],
  ['رد غير قابل للتحليل', { status: 200, body: { error: 'JSON_PARSE_ERROR', rawText: 'PRIVATE_INVOICE', parseError: 'PRIVATE_PARSE_ERROR' } }],
  ['تحليل بلا فواتير', { status: 200, body: { content: [{ text: '{"invoices":[]}' }] } }],
]
for (const page of pages) {
  for (const [name, response] of failures) {
    test(`${page}: ${name} يحفظ المستند للمراجعة دون إظهار نجاح التحليل`, async () => {
      const app = harness(page, { responses: [response] })
      const output = text(await app.upload())
      assert.equal(app.uploadCount, 1)
      assert.equal(app.documents.length, 1)
      assert.equal(app.documents[0].status, 'uploaded')
      assert.equal(app.calls.length, 1)
      assert.match(output, /محفوظ للمراجعة/)
      assert.match(output, /لا حاجة لرفعه مرة أخرى/)
      assert.doesNotMatch(output, /تم التحليل|تم استلام الملخص|تعذّر حفظ المستندات|PRIVATE_|CLAUDE_API_KEY/)
    })
  }
  for (const option of ['saveError', 'missingSavedRow']) {
    test(`${page}: ${option} يمنع تأكيد نجاح لم يُحفظ`, async () => {
      const app = harness(page, { [option]: true })
      const output = text(await app.upload())
      assert.equal(app.documents[0].status, 'uploaded')
      assert.match(output, /محفوظ للمراجعة/)
      assert.doesNotMatch(output, /تم التحليل|تم استلام الملخص|PRIVATE_/)
    })
  }
  test(`${page}: التحليل المحفوظ ينجح`, async () => {
    const app = harness(page)
    const output = text(await app.upload())
    assert.equal(app.documents.length, 1)
    assert.equal(app.documents[0].status, 'analyzed')
    assert.match(output, page === 'InvoiceUpload' ? /تم التحليل/ : /تم استلام الملخص/)
    assert.doesNotMatch(output, /تعذّر إكمال التحليل التلقائي/)
  })
  test(`${page}: فشل الرفع لا يُدّعى معه حفظ المستند`, async () => {
    const app = harness(page, { uploadError: true })
    const output = text(await app.upload())
    assert.equal(app.documents.length, 0)
    assert.equal(app.calls.length, 0)
    assert.match(output, /تعذّر رفع الملف/)
    assert.doesNotMatch(output, /محفوظ للمراجعة|تم التحليل|تم استلام الملخص/)
  })
}

test('دفعة مختلطة تستمر بعد فشل التحليل وتعرض كل نتيجة دون تكرار الحفظ', async () => {
  const app = harness('InvoiceUpload', { responses: [failures[0][1], { status: 200, body: success }] })
  const output = text(await app.upload(2))
  assert.equal(app.uploadCount, 2)
  assert.deepEqual(app.documents.map(doc => doc.status), ['uploaded', 'analyzed'])
  assert.match(output, /محفوظ للمراجعة/)
  assert.match(output, /تم التحليل/)
  assert.match(output, /حُفظ 2 مستند للمراجعة/)
  assert.doesNotMatch(output, /لم يُحفظ|تعذّر حفظ المستندات/)
})
