// نداء /api/analyze بجلسة Supabase الحقيقية.
// منفصل عن claude.js ولا يستورد supabase ولا import.meta — ليُختبَر بلا متصفح.
import { ReadingTimeoutError } from './readingTimeout.js'
export { ReadingTimeoutError }

export const AUTH_ERROR_CODES = new Set(['AUTH_REQUIRED', 'INVALID_SESSION', 'NOT_A_MEMBER', 'AUTH_UNAVAILABLE'])

const MESSAGES = {
  NO_SESSION:      'تعذّر التحليل: لم تصل جلسة الدخول الموثّقة بعد. انتظر لحظات ثم أعد المحاولة، وإن تكرر فسجّل الخروج وادخل من جديد.',
  AUTH_REQUIRED:   'تعذّر التحليل: جلسة الدخول منتهية أو غير مقبولة. سجّل الخروج ثم ادخل من جديد.',
  INVALID_SESSION: 'تعذّر التحليل: جلسة الدخول منتهية أو غير مقبولة. سجّل الخروج ثم ادخل من جديد.',
  NOT_A_MEMBER:    'تعذّر التحليل: حسابك غير مرتبط بمستخدم في هذه المنشأة. تواصل مع مزوّد الخدمة.',
  AUTH_UNAVAILABLE: 'لم نتمكن من التحقق من دخولك الآن. حاول مرة أخرى بعد قليل.',
}

export class AnalysisAuthError extends Error {
  constructor(code) {
    super(MESSAGES[code] || MESSAGES.NO_SESSION)
    this.name = 'AnalysisAuthError'
    this.code = code
    this.isAuthError = true
  }
}

// ينتظر المتصفح أطول من حد الاستضافة (300 ثانية، api/_claudeProxy.js) فيصله رد الخادم دائمًا قبل أن يقطع هو؛
// القطع هنا حماية من اتصال معلّق فقط.
export const BROWSER_READING_TIMEOUT_MS = 320_000

// مستخدم PIN تصله الجلسة الحقيقية بعد الدخول بثوانٍ (mintPinSession يعيد المحاولة)،
// فننتظر قليلاً قبل الحكم بغيابها — ثم نفشل صراحةً بدل نداء غير موثّق
export const DEFAULT_SESSION_WAITS_MS = [0, 500, 1000, 1500, 2000]

export function createAnalyzeFetch({
  getSession,
  fetchImpl = (...args) => fetch(...args),
  waitsMs = DEFAULT_SESSION_WAITS_MS,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  timeoutMs = BROWSER_READING_TIMEOUT_MS,
}) {
  async function getAccessToken() {
    for (const ms of waitsMs) {
      if (ms) await sleep(ms)
      try {
        const { data } = await getSession()
        const token = data?.session?.access_token
        if (token) return token
      } catch {
        // تعذّر قراءة الجلسة يُعامَل كغيابها — المحاولة التالية أو الفشل الصريح
      }
    }
    return null
  }

  return async function analyzeFetch(init = {}) {
    const token = await getAccessToken()
    if (!token) throw new AnalysisAuthError('NO_SESSION')

    // المهلة تشمل قراءة جسم الرد: يُقرأ كاملًا هنا قبل إعادته، فلا يُعاد رد ناقص
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res
    try {
      res = await fetchImpl('/api/analyze', {
        ...init,
        headers: { ...(init.headers || {}), authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      const body = await res.text()
      res = new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
    } catch (e) {
      if (controller.signal.aborted) throw new ReadingTimeoutError('browser')
      throw e
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) {
      let code = ''
      try { code = (await res.clone().json())?.error || '' } catch { /* جسم غير JSON */ }
      // تعذّر التحقق قد يُرجع 500؛ أخطاء الدخول المعروفة فقط تحمل isAuthError.
      // باقي الأخطاء تُعاد كما هي دون استهلاك جسم الرد الأصلي.
      if (AUTH_ERROR_CODES.has(code)) throw new AnalysisAuthError(code)
      // مهلة الخادم (READING_TIMEOUT) أو قطع الاستضافة (504 بلا جسم JSON)
      if (code === 'READING_TIMEOUT' || res.status === 504) throw new ReadingTimeoutError(code ? 'server' : 'host')
    }

    return res
  }
}
