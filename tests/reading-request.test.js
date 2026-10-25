import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareReadingRequest, READING_REQUEST_LIMIT } from '../src/lib/readingRequest.js'

const request = (data, text = 'تعليمات تجريبية', type = 'image') => ({
  model: 'synthetic', max_tokens: 4000, system: 'نص', messages: [{ role: 'user', content: [
    { type, source: { type: 'base64', media_type: type === 'image' ? 'image/png' : 'application/pdf', data } },
    { type: 'text', text },
  ] }],
})

test('within-budget request preserves the stored bytes, including PNG/PDF, without decoding', async () => {
  for (const type of ['image', 'document']) {
    const body = request('YWJj', 'نص الاختبار', type)
    const output = await prepareReadingRequest(body, { fitImage: () => assert.fail('unnecessary recompression') })
    assert.equal(output, JSON.stringify(body))
  }
})

test('oversized image budget includes Arabic UTF-8 instructions and base64 expansion', async () => {
  const body = request('A'.repeat(5_000_000), 'تعليمات '.repeat(9000)), snapshot = JSON.stringify(body)
  let fits = 0
  const output = await prepareReadingRequest(body, { fitImage: async (data, mime, maxMB, width) => {
    fits++
    assert.equal(data, body.messages[0].content[0].source.data)
    assert.equal(mime, 'image/png')
    assert.equal(width, Infinity) // Keep resolution; only encode when the byte budget requires it.
    const bytes = Math.floor(maxMB * 1024 * 1024)
    return { base64: Buffer.alloc(bytes).toString('base64'), mime: 'image/jpeg' }
  } })
  assert.equal(fits, 1)
  assert.ok(Buffer.byteLength(output) <= READING_REQUEST_LIMIT)
  assert.equal(JSON.stringify(body), snapshot)
  const after = JSON.parse(output)
  assert.equal(after.messages[0].content[1].text, body.messages[0].content[1].text)
  assert.equal(after.messages[0].content[0].source.media_type, 'image/jpeg')
})

test('UTF-8 size, not string character count, triggers fitting', async () => {
  const body = request('A'.repeat(4000), 'ع'.repeat(2000))
  assert.ok(JSON.stringify(body).length < 7500)
  let fitted = false
  const output = await prepareReadingRequest(body, { maxBytes: 7500, fitImage: async () => {
    fitted = true; return { base64: 'YWJj', mime: 'image/jpeg' }
  } })
  assert.equal(fitted, true)
  assert.ok(Buffer.byteLength(output) <= 7500)
})

test('no request can leave oversized, even if encoding fails to reduce it', async () => {
  const body = request('A'.repeat(8000))
  await assert.rejects(prepareReadingRequest(body, { maxBytes: 7000,
    fitImage: async () => ({ base64: body.messages[0].content[0].source.data, mime: 'image/png' }) }), /413/)
})

test('oversized PDF or instructions fail explicitly without truncation or image work', async () => {
  for (const body of [request('A'.repeat(10000), '', 'document'), request('abc', 'ن'.repeat(10000))]) {
    await assert.rejects(prepareReadingRequest(body, { maxBytes: 7000,
      fitImage: () => assert.fail('should stop before encoding') }), /413/)
  }
})
