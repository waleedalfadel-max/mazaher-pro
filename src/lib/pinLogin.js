// دخول الرمز عبر /api/pin-login: الخادم يتحقق (بحد محاولات مشترك في القاعدة) ويعيد المستخدم وجلسة حقيقية معًا.
// وحدة خالصة (تُختبر بلا متصفح). لا تحتفظ بالرمز ولا تسجّله.
import { waitText } from './waitText.js'

export async function pinLogin(fetchImpl, { subdomain, pin }) {
  let res
  try {
    res = await fetchImpl('/api/pin-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subdomain: subdomain || '', pin }),
    })
  } catch {
    return { kind: 'error' }
  }
  let body = null
  try { body = await res.json() } catch {}
  if (res.status === 200 && body?.user?.id && typeof body.tokenHash === 'string') {
    return { kind: 'ok', user: body.user, tokenHash: body.tokenHash }
  }
  if (res.status === 429) return { kind: 'throttled', retryAfter: Number(body?.retryAfter) || 60 }
  if (res.status === 403) return { kind: 'invalid', tenantResolved: body?.tenantResolved !== false }
  return { kind: 'error' }
}

/** رسالة الحد: عامة، بالمدة وحدها (مدة retry_after التي يعيدها الخادم). */
export function throttleMessage(seconds) {
  return `محاولات دخول كثيرة. حاول بعد ${waitText(seconds)}.`
}
