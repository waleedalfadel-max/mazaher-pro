import { checkOrigin, checkRateLimit, parseSafeBody } from './_guard.js'
import { authenticateRequest } from './_auth.js'

/**
 * وكيل Claude المشترك بين analyze و chat.
 *
 * الترتيب مقصود: الطريقة ← Origin ← **الهوية** ← المعدل (لكل مستخدم) ← المفتاح
 * ← شكل الجسم ← المزوّد. فطلب بلا مستخدم موثّق لا يصل لفحص الجسم ولا للمزوّد
 * المدفوع إطلاقاً.
 *
 * السجلات لا تحتوي نصّاً من الطلب ولا من الرد: كلاهما محتوى فواتير عملاء.
 * ولا تُسجَّل رسائل أخطاء JSON.parse — V8 يضمّن فيها مقتطفاً من النص المُحلَّل.
 */

export function tryParseJSON(text) {
  // تنظيف: BOM + control characters + markdown fences
  const cleaned = text
    .replace(/^﻿/, '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()

  // محاولة parse مباشر أولاً
  try { return JSON.parse(cleaned) } catch {}

  // brace counting — يدعم { و [
  let start = cleaned.indexOf('{')
  const startArr = cleaned.indexOf('[')
  if (start === -1 || (startArr !== -1 && startArr < start)) start = startArr
  if (start === -1) throw new Error('No JSON object found')

  let depth = 0, inStr = false, esc = false

  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (esc)               { esc = false; continue }
    if (c === '\\' && inStr) { esc = true; continue }
    if (c === '"')           { inStr = !inStr; continue }
    if (inStr)               continue
    if (c === '{' || c === '[') depth++
    if (c === '}' || c === ']') {
      depth--
      if (depth === 0) {
        const slice = cleaned.slice(start, i + 1)
        try {
          return JSON.parse(slice)
        } catch (e) {
          // محاولة تصحيح شائعة
          const fixed = slice
            .replace(/[\x00-\x1F\x7F]/g, ' ')
            .replace(/,(\s*[}\]])/g, '$1')
            .replace(/([{,]\s*)([A-Za-z_]\w*)(\s*:)/g, '$1"$2"$3')
          try { return JSON.parse(fixed) } catch {}
          throw new Error('JSON parse failed: ' + e.message)
        }
      }
    }
  }
  throw new Error('No JSON object found')
}

/**
 * وصف رد غير قابل للتحليل دون أي نص منه: هل انقطع عند حد الطول (stop_reason=max_tokens) أم وصل كاملًا لكنه JSON غير صالح،
 * وطوله وموضع الخطأ (رقم فقط؛ رسائل V8 قد تضمّن مقتطفًا من النص فلا تُعاد).
 */
export function replyDiagnostic(data, rawText, parseError) {
  const position = Number(String(parseError?.message || '').match(/position (\d+)/)?.[1])
  return {
    reason: data?.stop_reason === 'max_tokens' ? 'truncated' : 'invalid',
    stopReason: typeof data?.stop_reason === 'string' ? data.stop_reason : null,
    outputTokens: Number.isFinite(data?.usage?.output_tokens) ? data.usage.output_tokens : null,
    length: rawText.length,
    position: Number.isFinite(position) ? position : null,
  }
}

/**
 * مهلة القراءة على الخادم: حد الاستضافة لـ api/analyze.js في vercel.json هو 300 ثانية (أقصى ما تسمح به الخطة).
 * ينتظر الوكيل المزوّد حتى 270 ثانية ثم يقطع النداء ويرد برمز READING_TIMEOUT، فيبقى هامش للتحقق من الدخول وإرسال
 * الرد قبل أن تقطع الاستضافة الطلب (رد 504 بلا تفاصيل). المتصفح ينتظر أطول من حد الاستضافة (src/lib/analyzeRequest.js).
 * لا إعادة محاولة عند انتهاء المهلة: السبب نفسه يتكرر، والتكلفة تتضاعف.
 */
export const READING_HOST_LIMIT_MS = 300_000
export const READING_UPSTREAM_TIMEOUT_MS = 270_000

function readApiKey() {
  return (process.env.CLAUDE_API_KEY || '').replace(/^﻿/, '').trim()
}

export function createClaudeProxyHandler({
  name,
  validateJson = false,
  authenticate = authenticateRequest,
  fetchImpl = (...args) => fetch(...args),
  getApiKey = readApiKey,
  logger = console,
  upstreamTimeoutMs = null,
  now = () => Date.now(),
} = {}) {
  const tag = `[${name}]`

  return async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    if (checkOrigin(req, res)) return

    const auth = await authenticate(req)
    if (!auth?.ok) {
      logger.warn(`${tag} رُفض طلب غير موثّق:`, auth?.code || 'AUTH_FAILED')
      return res.status(auth?.status || 401).json({ error: auth?.code || 'AUTH_FAILED' })
    }

    if (checkRateLimit(req, res, `user:${auth.user.appUserId}`)) return

    const apiKey = getApiKey()
    if (!apiKey) {
      return res.status(500).json({ error: 'CLAUDE_API_KEY not configured on server' })
    }

    const body = parseSafeBody(req, res)
    if (!body) return

    // المهلة تشمل انتظار الرد وقراءة جسمه كاملًا؛ عند انقضائها يُقطع النداء ولا يُعاد شيء جزئي
    const controller = upstreamTimeoutMs ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), upstreamTimeoutMs) : null
    const started = now()
    try {
      const upstream = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key':          apiKey,
          'anthropic-version':  '2023-06-01',
          'content-type':       'application/json',
        },
        body: JSON.stringify(body),
        ...(controller ? { signal: controller.signal } : {}),
      })

      const data = await upstream.json()
      if (timer) clearTimeout(timer)
      // مدة المزوّد بلا أي محتوى: تكفي لمعرفة مصدر أي بطء لاحق
      if (controller) logger.info?.(`${tag} مدة المزوّد`, { ms: now() - started, status: upstream.status })

      // كشف أخطاء Claude API (overloaded, invalid_request, etc.) — يُسجَّل نوعها فقط
      if (data?.type === 'error' || data?.error) {
        logger.warn(`${tag} خطأ من المزوّد:`, upstream.status, data?.error?.type || 'unknown')
        if (!validateJson) return res.status(upstream.status).json(data)
        return res.status(200).json({
          error: 'CLAUDE_API_ERROR',
          claudeError: data.error || data,
          status: upstream.status,
        })
      }

      if (validateJson) {
        const rawText = String(data?.content?.[0]?.text || '')
        try {
          tryParseJSON(rawText)
        } catch (parseError) {
          // بيانات تشخيص بلا أي نص من الرد (محتوى فاتورة عميل): لا يُعاد الرد الخام للشاشة ولا يُسجَّل
          const diagnostic = replyDiagnostic(data, rawText, parseError)
          logger.warn(`${tag} رد المزوّد غير قابل للتحليل كـJSON`, diagnostic)
          return res.status(200).json({ error: 'JSON_PARSE_ERROR', ...diagnostic })
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
      }

      return res.status(upstream.status).json(data)
    } catch (err) {
      if (timer) clearTimeout(timer)
      if (controller?.signal.aborted) {
        logger.warn(`${tag} انتهت مهلة المزوّد`, { ms: now() - started, limitMs: upstreamTimeoutMs })
        return res.status(504).json({ error: 'READING_TIMEOUT' })
      }
      logger.error(`${tag} فشل نداء المزوّد:`, err?.name || 'Error')
      return res.status(500).json({ error: 'UPSTREAM_FAILED' })
    }
  }
}
