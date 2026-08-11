/**
 * حارس مشترك لنقاط النهاية التي تستدعي Claude API.
 *
 * الغرض: منع استخدام النقطة كوكيل Claude مفتوح. تبني جسماً جديداً من الحقول
 * المسموحة فقط ولا تمرّر req.body إطلاقاً — أي حقل غير متوقع (tools, stream,
 * أو أي إضافة مستقبلية) يسقط تلقائياً بلا حاجة لتحديث قائمة منع.
 */

const DEFAULT_MODEL = (process.env.CLAUDE_MODEL || 'claude-opus-4-5').trim()

// النماذج المسموحة — النموذج المستخدم بالتطبيق فقط
const ALLOWED_MODELS = new Set([DEFAULT_MODEL])

// أعلى max_tokens يستخدمه التطبيق فعلاً (analyzeDocument و analyzeBankStatementPage)
const MAX_TOKENS_CAP = 4000

// أطول system بالتطبيق أقل من هذا بكثير — هامش واسع
const MAX_SYSTEM_LEN = 8000

// أقصى بنية فعلية: كتلة مستند/صورة + كتلة نص
const MAX_CONTENT_BLOCKS = 4
const ALLOWED_BLOCK_TYPES = new Set(['text', 'image', 'document'])

// حد طول النص داخل كتلة text — البرومبتات الحالية أقصر بكثير
const MAX_TEXT_LEN = 60000

const ALLOWED_ORIGINS = new Set([
  'https://mazaher.tahseeb.app',    // مستخدمو ديوانية مزاهر
  'https://tahseeb-pro.vercel.app', // مزوّد الخدمة (superadmin)
  'https://www.tahseeb.app',
  'https://tahseeb.app',
])

// وضع الرفض يُفعَّل بمتغيّر بيئة — بلا إعادة نشر.
// غير مضبوط ⇒ وضع مراقبة: يسجّل الـOrigin غير المعروف ويسمح بمروره.
const ENFORCE_ORIGIN = process.env.ENFORCE_ORIGIN === '1'

const IS_PROD = process.env.VERCEL_ENV === 'production'

function isAllowedOrigin(origin) {
  if (!origin) return false
  if (ALLOWED_ORIGINS.has(origin)) return true
  // التطوير المحلي فقط — لا يُسمح به بالإنتاج
  if (!IS_PROD && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true
  return false
}

/**
 * يفحص الـOrigin. يعيد true إذا كان يجب إيقاف الطلب (وقد كُتب الرد).
 */
export function checkOrigin(req, res) {
  const origin = req.headers?.origin || ''
  if (isAllowedOrigin(origin)) return false

  if (ENFORCE_ORIGIN) {
    console.warn('[guard] رُفض Origin:', origin || '(غائب)')
    res.status(403).json({ error: 'FORBIDDEN_ORIGIN' })
    return true
  }

  // وضع المراقبة — يُسجَّل فقط ليُراجَع قبل تفعيل الرفض
  console.warn('[guard][observe] Origin غير معروف (سُمح بمروره):', origin || '(غائب)')
  return false
}

// ── تحديد معدل خفيف داخل الذاكرة ──────────────────────────────────────────
// ⚠️ حدّه الحقيقي: دوال Vercel عديمة الحالة وتتعدد نسخها — العدّاد لا يُشارَك
// بين النسخ ويُصفَّر عند البرود. يوقف الاندفاع من مصدر واحد فقط، ولا يُعتمد
// عليه كحماية. التحديد الحقيقي يحتاج مخزناً مشتركاً (مؤجَّل عمداً).
const RATE_WINDOW_MS = 60_000
const RATE_MAX       = 20
const hits = new Map()

export function checkRateLimit(req, res) {
  const ip = (req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown'
  const now = Date.now()
  const rec = hits.get(ip)

  if (!rec || now - rec.start > RATE_WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 })
  } else {
    rec.count++
    if (rec.count > RATE_MAX) {
      console.warn('[guard] تجاوز حد المعدل:', ip, rec.count)
      res.status(429).json({ error: 'RATE_LIMITED' })
      return true
    }
  }

  // تنظيف دوري بسيط لمنع نمو الخريطة
  if (hits.size > 500) {
    for (const [k, v] of hits) if (now - v.start > RATE_WINDOW_MS) hits.delete(k)
  }
  return false
}

// ── تقييد شكل الطلب ───────────────────────────────────────────────────────

function bad(reason) {
  const e = new Error(reason)
  e.isValidation = true
  return e
}

/**
 * يبني جسماً نظيفاً من الحقول المسموحة فقط.
 * يرمي خطأ تحقق (isValidation) عند أي مخالفة بنيوية.
 */
export function buildSafeBody(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('BODY_NOT_OBJECT')

  // ── model ──
  const model = typeof raw.model === 'string' ? raw.model.trim() : DEFAULT_MODEL
  if (!ALLOWED_MODELS.has(model)) throw bad('MODEL_NOT_ALLOWED')

  // ── max_tokens — يُثبَّت على السقف بدل الرفض (تسامح) ──
  let maxTokens = Number(raw.max_tokens)
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) maxTokens = MAX_TOKENS_CAP
  maxTokens = Math.min(Math.floor(maxTokens), MAX_TOKENS_CAP)

  // ── messages ──
  if (!Array.isArray(raw.messages) || raw.messages.length !== 1) throw bad('MESSAGES_SHAPE')
  const msg = raw.messages[0]
  if (!msg || msg.role !== 'user') throw bad('MESSAGE_ROLE')
  if (!Array.isArray(msg.content) || msg.content.length === 0) throw bad('CONTENT_SHAPE')
  if (msg.content.length > MAX_CONTENT_BLOCKS) throw bad('TOO_MANY_BLOCKS')

  const content = msg.content.map(block => {
    if (!block || typeof block !== 'object') throw bad('BLOCK_SHAPE')
    if (!ALLOWED_BLOCK_TYPES.has(block.type)) throw bad('BLOCK_TYPE_NOT_ALLOWED')

    if (block.type === 'text') {
      if (typeof block.text !== 'string') throw bad('TEXT_SHAPE')
      if (block.text.length > MAX_TEXT_LEN) throw bad('TEXT_TOO_LONG')
      return { type: 'text', text: block.text }
    }

    // image / document — base64 فقط (لا url: يمنع جعل الخادم يجلب موارد خارجية)
    const src = block.source
    if (!src || typeof src !== 'object') throw bad('SOURCE_SHAPE')
    if (src.type !== 'base64')          throw bad('SOURCE_TYPE_NOT_ALLOWED')
    if (typeof src.media_type !== 'string' || typeof src.data !== 'string') throw bad('SOURCE_FIELDS')

    return {
      type: block.type,
      source: { type: 'base64', media_type: src.media_type, data: src.data },
    }
  })

  const safe = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content }],
  }

  // ── system — اختياري (نداء RoasterySales لا يرسله) ──
  if (raw.system != null) {
    if (typeof raw.system !== 'string')        throw bad('SYSTEM_SHAPE')
    if (raw.system.length > MAX_SYSTEM_LEN)    throw bad('SYSTEM_TOO_LONG')
    safe.system = raw.system
  }

  // أي حقل آخر بـraw (tools, stream, temperature…) يسقط هنا تلقائياً
  return safe
}

/**
 * غلاف كامل: Origin ثم المعدل ثم بناء الجسم الآمن.
 * يعيد الجسم الآمن، أو null إذا أُوقف الطلب (وقد كُتب الرد).
 */
export function guard(req, res) {
  if (checkOrigin(req, res))    return null
  if (checkRateLimit(req, res)) return null
  try {
    return buildSafeBody(req.body)
  } catch (e) {
    if (e.isValidation) {
      console.warn('[guard] رُفض شكل الطلب:', e.message)
      res.status(400).json({ error: 'INVALID_REQUEST', reason: e.message })
      return null
    }
    throw e
  }
}
