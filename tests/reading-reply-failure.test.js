import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { build } from 'esbuild'
import { tryParseJSON } from '../api/_claudeProxy.js'
import { validRereading } from '../src/lib/documentReread.js'

// 2026-10-30: a reading reply that cannot be parsed (complete but invalid JSON, or cut off at the output limit) is never
// completed or partly used. The real request/response path of src/lib/claude.js runs against synthetic replies shaped
// exactly as api/_claudeProxy.js returns them; no network, no customer data.
const INVOICE = 'SYNTHETIC-INVOICE صنف تجريبي'
const valid = JSON.stringify({ rotation: 0, invoices: [{ type: 'expense', date: '2026-01-01', totalAmount: 136.5, vatAmount: 17.8, amountsBasis: 'inclusive',
  description: INVOICE, items: [{ description: INVOICE + ' 1', amount: 102 }, { description: INVOICE + ' 2', amount: 34.5 }] }] })
// The same reply with an unescaped double quote inside a product name, and the same reply cut off part way.
const quoted = valid.replace(`"${INVOICE} 2"`, `"${INVOICE} 250"مل"`)
const cut = valid.slice(0, Math.floor(valid.length * 0.7))

// What the server proxy sends to the browser for a provider reply (validateJson): the reply itself, or a content-free error.
function proxied(text, stop_reason = 'end_turn') {
  try { tryParseJSON(text); return { content: [{ type: 'text', text }], stop_reason } }
  catch (e) {
    const position = Number(String(e.message).match(/position (\d+)/)?.[1])
    return { error: 'JSON_PARSE_ERROR', reason: stop_reason === 'max_tokens' ? 'truncated' : 'invalid', stopReason: stop_reason,
      outputTokens: null, length: text.length, position: Number.isFinite(position) ? position : null }
  }
}

const bundle = await build({ entryPoints: ['src/lib/claude.js'], bundle: true, write: false, platform: 'node', format: 'cjs', define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'no-network', setup(b) {
    b.onLoad({ filter: /[\\/]lib[\\/]supabase\.js$/ }, () => ({ contents: 'export const supabase = {};', loader: 'js' }))
    b.onLoad({ filter: /[\\/]lib[\\/]analyzeRequest\.js$/ }, () => ({ contents: `
      export const createAnalyzeFetch = () => async init => {
        const body = JSON.parse(init.body); globalThis.requests.push({ max_tokens: body.max_tokens });
        const reply = globalThis.replies.shift();
        if (!reply) throw new Error('no more synthetic replies');
        return { ok: true, status: 200, json: async () => reply };
      };
      export const AUTH_ERROR_CODES = new Set(); export class AnalysisAuthError extends Error {}`, loader: 'js' }))
  } }] })

async function read(replies) {
  const context = vm.createContext({ TextEncoder, module: { exports: {} }, requests: [], replies })
  vm.runInContext(bundle.outputFiles[0].text, context)
  const { analyzeDocument, ReadingReplyError } = context.module.exports
  try { return { result: JSON.parse(JSON.stringify(await analyzeDocument('synthetic', 'image/png', 'fixture.png'))), requests: context.requests, ReadingReplyError } }
  catch (error) { return { error, requests: context.requests, ReadingReplyError } }
}

test('the server rejects both the unescaped-quote reply and the cut-off reply, without returning any reply text', () => {
  for (const [text, stop, reason] of [[quoted, 'end_turn', 'invalid'], [cut, 'max_tokens', 'truncated'], [cut, 'end_turn', 'invalid']]) {
    const body = proxied(text, stop)
    assert.equal(body.error, 'JSON_PARSE_ERROR')
    assert.equal(body.reason, reason)
    assert.ok(!JSON.stringify(body).includes('SYNTHETIC'))
  }
  assert.ok(proxied(valid).content)
})

test('one invalid reply is retried once and the next valid reply is used as read; nothing from the failed reply is kept', async () => {
  const { result, requests, error } = await read([proxied(quoted), proxied(valid)])
  assert.equal(error, undefined)
  assert.deepEqual(requests.map(r => r.max_tokens), [4000, 4000])
  assert.equal(validRereading(result), true)
  assert.deepEqual(result.invoices[0].items.map(i => i.amount), [102, 34.5])
  assert.ok(!JSON.stringify(result).includes('250"مل'))
})

test('a reply cut off at the length limit is retried once with a higher limit; it is never completed by guessing', async () => {
  const ok = await read([proxied(cut, 'max_tokens'), proxied(valid)])
  assert.deepEqual(ok.requests.map(r => r.max_tokens), [4000, 8000])
  assert.equal(validRereading(ok.result), true)
  const failed = await read([proxied(cut, 'max_tokens'), proxied(cut, 'max_tokens')])
  assert.ok(failed.error instanceof failed.ReadingReplyError)
  assert.equal(failed.result, undefined)
})

test('two failed replies stop after exactly one retry with a short Arabic message and content-free diagnostics', async () => {
  const { error, requests, result, ReadingReplyError } = await read([proxied(quoted), proxied(quoted), proxied(valid)])
  assert.equal(result, undefined)
  assert.ok(error instanceof ReadingReplyError)
  assert.equal(requests.length, 2)                                   // limited: the third (valid) reply is never requested
  assert.equal(error.message, 'وصل من خدمة القراءة رد غير صالح مرتين، ولم يُحفظ منه شيء.')
  assert.equal(error.attempts.length, 2)
  assert.ok(!/SYNTHETIC|مل|JSON|Unexpected|Expected/.test(error.message), error.message)
  assert.ok(!/SYNTHETIC|مل|Unexpected|Expected/.test(JSON.stringify(error.attempts)))     // field names only, no reply text
  assert.deepEqual(Object.keys(error.attempts[0]).sort(), ['length', 'outputTokens', 'position', 'reason', 'source', 'stopReason'])
})

test('a reply the server accepted but the browser cannot extract is treated the same way (one retry, nothing kept)', async () => {
  const noJson = { content: [{ type: 'text', text: 'تعذر القراءة' }], stop_reason: 'end_turn' }
  const recovered = await read([noJson, proxied(valid)])
  assert.equal(validRereading(recovered.result), true)
  const failed = await read([noJson, noJson])
  assert.ok(failed.error instanceof failed.ReadingReplyError)
  assert.equal(failed.error.attempts[0].source, 'client')
})

test('other reading errors are not retried', async () => {
  const { error, requests } = await read([{ error: 'CLAUDE_API_ERROR', claudeError: { message: 'Overloaded' }, status: 529 }, proxied(valid)])
  assert.match(error.message, /Overloaded/)
  assert.equal(requests.length, 1)
})
