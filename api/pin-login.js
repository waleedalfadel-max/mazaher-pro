import { getSupabaseAdmin } from './_supabaseAdmin.js'
import { checkOrigin } from './_guard.js'
import { PIN_RE, defaultSource, verifyPinAndMint } from './_pinAuth.js'

/**
 * دخول الرمز من شاشة الدخول: { subdomain, pin } ← المستخدم وجلسة Supabase حقيقية (tokenHash للرابط السحري).
 * يحل محل استدعاء login_with_pin من المتصفح (لم يعد متاحًا له) ثم /api/pin-session. الحد في القاعدة قبل فحص الرمز.
 */
export const config = {
  api: { bodyParser: { sizeLimit: '10kb' } },
}

export function createPinLoginHandler({ getAdmin = getSupabaseAdmin, getSource = defaultSource } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    if (checkOrigin(req, res)) return
    const { subdomain, pin } = req.body || {}
    if (typeof subdomain !== 'string' || subdomain.length > 100 || typeof pin !== 'string' || !PIN_RE.test(pin)) {
      return res.status(400).json({ error: 'INVALID_REQUEST' })
    }
    let admin
    try { admin = getAdmin() } catch {
      console.error('[pin-login] غير مضبوط على الخادم')
      return res.status(500).json({ error: 'SERVER_NOT_CONFIGURED' })
    }
    try {
      const r = await verifyPinAndMint(admin, { source: getSource(req), subdomain, pin })
      if (r.status === 429) res.setHeader?.('retry-after', String(r.body.retryAfter))
      return res.status(r.status).json(r.body)
    } catch {
      console.error('[pin-login] خطأ غير متوقع')
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  }
}

export default createPinLoginHandler()
