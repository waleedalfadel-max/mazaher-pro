/**
 * التحقق من رمز الدخول ومنح الجلسة — المسار الوحيد، مشترك بين /api/pin-login و/api/pin-session.
 *
 * الحد في القاعدة (public.pin_login_attempt، 20261001000000): مشترك بين نسخ الخادم، يبقى بعد إعادة التشغيل، والمحاولة
 * تُحتسب قبل فحص الرمز. هنا لا عدّاد في الذاكرة.
 *
 * المصدر من معلومات يضعها الخادم الوسيط لا العميل: على Vercel العنوانان x-real-ip ثم x-vercel-forwarded-for (يكتبهما
 * Vercel فوق ما يرسله العميل)، وإلا عنوان الاتصال نفسه. لا يُقرأ x-forwarded-for من العميل. لا يُسجَّل أي رمز.
 */

const SYNTHETIC_DOMAIN = 'pin.internal.tahseeb.app'
export const PIN_RE = /^\d{4,8}$/

export function defaultSource(req) {
  const h = req.headers || {}
  const first = v => String(Array.isArray(v) ? v[0] : v || '').split(',')[0].trim()
  return first(h['x-real-ip']) || first(h['x-vercel-forwarded-for']) || req.socket?.remoteAddress || ''
}

/**
 * يتحقق من الرمز عبر القاعدة (بنطاق المطعم أو بمعرّف المستخدم) ثم يمنح الجلسة.
 * يعيد { status, body } جاهزين للرد. الرسائل عامة: رمز خاطئ، أو حساب معطّل، أو مستخدم غير موجود = INVALID.
 */
export async function verifyPinAndMint(admin, { source, subdomain = null, userId = null, pin }) {
  if (!source) return { status: 400, body: { error: 'INVALID_REQUEST' } }
  const { data, error } = await admin.rpc('pin_login_attempt', {
    p_source: source, p_subdomain: subdomain, p_user_id: userId, p_pin: pin,
  })
  if (error || !data) {
    console.error('[pin-auth] تعذّر التحقق:', error?.code || 'no-data')
    return { status: 500, body: { error: 'AUTH_UNAVAILABLE' } }
  }
  if (data.code === 'throttled') {
    return { status: 429, body: { error: 'THROTTLED', retryAfter: data.retry_after || 60 } }
  }
  if (!data.ok) {
    return { status: 403, body: { error: 'INVALID', tenantResolved: data.tenant_resolved !== false } }
  }

  const user = data.user
  const { data: row, error: rowErr } = await admin.from('app_users').select('id, auth_id').eq('id', user.id).maybeSingle()
  if (rowErr || !row) return { status: 500, body: { error: 'AUTH_UNAVAILABLE' } }

  let email
  if (row.auth_id) {
    const { data: existing, error: getErr } = await admin.auth.admin.getUserById(row.auth_id)
    if (getErr || !existing?.user) {
      console.error('[pin-auth] auth_id مربوط لكن الحساب غير موجود')
      return { status: 500, body: { error: 'AUTH_ACCOUNT_MISSING' } }
    }
    email = existing.user.email
  } else {
    // أول جلسة لهذا الصف — حساب اصطناعي يُربط به
    email = `u-${row.id}@${SYNTHETIC_DOMAIN}`
    const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, email_confirm: true })
    if (createErr || !created?.user) {
      console.error('[pin-auth] فشل إنشاء الحساب')
      return { status: 500, body: { error: 'ACCOUNT_CREATE_FAILED' } }
    }
    const { error: updErr } = await admin.from('app_users').update({ auth_id: created.user.id }).eq('id', row.id)
    if (updErr) {
      console.error('[pin-auth] فشل ربط auth_id')
      return { status: 500, body: { error: 'LINK_FAILED' } }
    }
  }

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = link?.properties?.hashed_token
  if (linkErr || !tokenHash) {
    console.error('[pin-auth] فشل توليد الرابط')
    return { status: 500, body: { error: 'LINK_GENERATE_FAILED' } }
  }
  return { status: 200, body: { user, tokenHash } }
}
