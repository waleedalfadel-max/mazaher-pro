import { getSupabaseAdmin } from './_supabaseAdmin.js'
import { checkOrigin } from './_guard.js'
import { PIN_RE, defaultSource, verifyPinAndMint } from './_pinAuth.js'

/**
 * جلسة Supabase حقيقية لمستخدم معروف المعرّف: { userId, pin } ← tokenHash للرابط السحري.
 * كان يُستدعى بعد login_with_pin من المتصفح؛ شاشة الدخول الجديدة تستعمل /api/pin-login. يبقى للتوافق، ويمر بالتحقق نفسه:
 * الحد المشترك في القاعدة (public.pin_login_attempt) قبل فحص الرمز، بلا عدّاد في الذاكرة، والرد عام.
 */
export const config = {
  api: { bodyParser: { sizeLimit: '10kb' } },
}

export function createPinSessionHandler({ getAdmin = getSupabaseAdmin, getSource = defaultSource } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    if (checkOrigin(req, res)) return
    const { userId, pin } = req.body || {}
    if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId) || typeof pin !== 'string' || !PIN_RE.test(pin)) {
      return res.status(400).json({ error: 'INVALID_REQUEST' })
    }
    let admin
    try { admin = getAdmin() } catch {
      console.error('[pin-session] غير مضبوط على الخادم')
      return res.status(500).json({ error: 'SERVER_NOT_CONFIGURED' })
    }
    try {
      const r = await verifyPinAndMint(admin, { source: getSource(req), userId, pin })
      if (r.status === 429) res.setHeader?.('retry-after', String(r.body.retryAfter))
      // الرد القديم كان { email, tokenHash }؛ tokenHash وحده يكفي العميل
      return res.status(r.status).json(r.status === 200 ? { tokenHash: r.body.tokenHash } : r.body)
    } catch {
      console.error('[pin-session] خطأ غير متوقع')
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  }
}

export default createPinSessionHandler()
