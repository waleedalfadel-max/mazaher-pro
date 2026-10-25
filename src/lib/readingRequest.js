import { fitImageBase64 } from './imageCompress.js'

// Vercel accepts at most 4.5 MB per request, including base64 and UTF-8 instructions.
// Leave headroom. This applies to BOTH the original and the upright PNG request.
export const READING_REQUEST_LIMIT = 4_000_000
const utf8Size = value => new TextEncoder().encode(value).byteLength

export function readingSizeError() {
  return new Error('تعذّر إرسال المستند: حجم طلب القراءة أكبر من الحد المسموح (413). جرّب صورة أصغر واضحة للمستند كاملًا. لم تُحفظ قراءة جديدة.')
}

/** Prepare a transient reading copy only. Never modify the stored image or request object. */
export async function prepareReadingRequest(body, {
  maxBytes = READING_REQUEST_LIMIT,
  fitImage = fitImageBase64,
} = {}) {
  const original = JSON.stringify(body)
  if (utf8Size(original) <= maxBytes) return original

  const content = body.messages?.[0]?.content
  const index = content?.findIndex(block => block.type === 'image' && block.source?.type === 'base64') ?? -1
  if (index < 0) throw readingSizeError() // PDFs are not silently rasterized or truncated.
  const block = content[index]
  const replaceImage = source => ({ ...body, messages: body.messages.map((message, i) => i ? message : {
    ...message, content: content.map((entry, j) => j === index ? { ...entry, source } : entry),
  }) })
  const overhead = utf8Size(JSON.stringify(replaceImage({ ...block.source, data: '' })))
  // Four base64 characters carry three binary bytes. Reserve room for MIME changes too.
  const imageBytes = Math.floor((maxBytes - overhead - 1024) / 4) * 3
  if (imageBytes <= 0) throw readingSizeError()
  const fitted = await fitImage(block.source.data, block.source.media_type, imageBytes / (1024 * 1024), Infinity)
  const prepared = JSON.stringify(replaceImage({ ...block.source, data: fitted.base64, media_type: fitted.mime }))
  if (utf8Size(prepared) > maxBytes) throw readingSizeError()
  return prepared
}
