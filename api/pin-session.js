import { getSupabaseAdmin } from './_supabaseAdmin.js'
import { checkOrigin } from './_guard.js'

/**
 * المرحلة 2-أ — يمنح جلسة Supabase حقيقية (auth.uid()) بعد دخول PIN ناجح،
 * بلا أي تغيير على شاشة الدخول. يُستدعى إضافياً من AuthContext.login() بعد
 * مطابقة PIN محلياً — ويعيد التحقق من PIN هنا بنفسه (لا يثق بمطابقة العميل).
 *
 * الآلية: حساب Supabase Auth حقيقي لكل صف app_users (بريد اصطناعي لا يُستخدم
 * فعلياً)، رابط سحري (admin.generateLink) يبادله العميل بجلسة حقيقية عبر
 * auth.verifyOtp — بلا أي "كلمة مرور" مخترَعة أو مخزَّنة.
 */

export const config = {
  api: { bodyParser: { sizeLimit: '10kb' } },
}

const SYNTHETIC_DOMAIN = 'pin.internal.tahseeb.app'
const PIN_RE = /^\d{4,8}$/

// حد محاولات مخصص — يطابق قفل الواجهة بـLogin.jsx (3 محاولات / 5 دقائق)
// بدل محدِّد Claude العام (20/دقيقة) غير المناسب لمساحة PIN الصغيرة
const RATE_WINDOW_MS = 5 * 60 * 1000
const RATE_MAX = 3
const attempts = new Map()

function checkPinRateLimit(req, res) {
  const ip = (req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown'
  const now = Date.now()
  const rec = attempts.get(ip)

  if (!rec || now - rec.start > RATE_WINDOW_MS) {
    attempts.set(ip, { start: now, count: 1 })
  } else {
    rec.count++
    if (rec.count > RATE_MAX) {
      console.warn('[pin-session] تجاوز حد المحاولات:', ip)
      res.status(429).json({ error: 'RATE_LIMITED' })
      return true
    }
  }

  if (attempts.size > 500) {
    for (const [k, v] of attempts) if (now - v.start > RATE_WINDOW_MS) attempts.delete(k)
  }
  return false
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (checkOrigin(req, res)) return
  if (checkPinRateLimit(req, res)) return

  const { userId, pin } = req.body || {}
  if (typeof userId !== 'string' || !userId || typeof pin !== 'string' || !PIN_RE.test(pin)) {
    return res.status(400).json({ error: 'INVALID_REQUEST' })
  }

  let admin
  try {
    admin = getSupabaseAdmin()
  } catch (e) {
    console.error('[pin-session] غير مضبوط على الخادم:', e.message)
    return res.status(500).json({ error: 'SERVER_NOT_CONFIGURED' })
  }

  try {
    // إعادة التحقق من PIN بنفسه — لا نثق بمطابقة العميل وحدها
    const { data: row, error: rowErr } = await admin
      .from('app_users')
      .select('id, pin, auth_id')
      .eq('id', userId)
      .maybeSingle()

    if (rowErr || !row || row.pin !== pin) {
      console.warn('[pin-session] رفض — عدم تطابق PIN')
      return res.status(403).json({ error: 'PIN_MISMATCH' })
    }

    let email

    if (row.auth_id) {
      const { data: existing, error: getErr } = await admin.auth.admin.getUserById(row.auth_id)
      if (getErr || !existing?.user) {
        console.error('[pin-session] auth_id مربوط لكن الحساب غير موجود:', getErr?.message)
        return res.status(500).json({ error: 'AUTH_ACCOUNT_MISSING' })
      }
      email = existing.user.email
    } else {
      // أول جلسة لهذا الصف — إنشاء حساب اصطناعي وربطه
      email = `u-${row.id}@${SYNTHETIC_DOMAIN}`
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
      })
      if (createErr || !created?.user) {
        console.error('[pin-session] فشل إنشاء الحساب:', createErr?.message)
        return res.status(500).json({ error: 'ACCOUNT_CREATE_FAILED' })
      }
      const { error: updErr } = await admin
        .from('app_users')
        .update({ auth_id: created.user.id })
        .eq('id', row.id)
      if (updErr) {
        console.error('[pin-session] فشل ربط auth_id:', updErr.message)
        return res.status(500).json({ error: 'LINK_FAILED' })
      }
    }

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })
    const hashedToken = link?.properties?.hashed_token
    if (linkErr || !hashedToken) {
      console.error('[pin-session] فشل توليد الرابط:', linkErr?.message)
      return res.status(500).json({ error: 'LINK_GENERATE_FAILED' })
    }

    return res.status(200).json({ email, tokenHash: hashedToken })
  } catch (e) {
    console.error('[pin-session] خطأ غير متوقع:', e.message)
    return res.status(500).json({ error: 'INTERNAL_ERROR' })
  }
}
