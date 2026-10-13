// حارس الشبكة للنموذج. سياسة المحتوى في prototype/index.html تمنع أي طلب خارج هذا الخادم المحلي؛
// وهذا الحارس يمنع كذلك مسارات /api المحلية وأي عنوان فيه supabase، ويعدّ كل محاولة لتظهر في الشريط.
const attempts = []
const listeners = new Set()

function isForbidden(url) {
  try {
    const u = new URL(String(url), location.href)
    return u.origin !== location.origin || u.pathname.startsWith('/api/') || /supabase/i.test(u.href)
  } catch {
    return true
  }
}

function record(kind, url) {
  attempts.push({ kind, url: String(url) })
  listeners.forEach(fn => fn(attempts.length))
  console.warn('[نموذج التصميم] طلب ممنوع:', kind, String(url))
}

export function installNetworkGuard() {
  const realFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url
    if (isForbidden(url)) {
      record('fetch', url)
      return Promise.reject(new TypeError('نموذج التصميم لا يتصل بأي خادم'))
    }
    return realFetch(input, init)
  }
  const realOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (isForbidden(url)) {
      record('xhr', url)
      throw new Error('نموذج التصميم لا يتصل بأي خادم')
    }
    return realOpen.call(this, method, url, ...rest)
  }
  if (navigator.sendBeacon) navigator.sendBeacon = url => { record('beacon', url); return false }
  const RealWebSocket = window.WebSocket
  window.WebSocket = function (url, protocols) {
    const u = new URL(String(url), location.href)
    if (u.hostname !== location.hostname) {
      record('websocket', url)
      throw new Error('نموذج التصميم لا يتصل بأي خادم')
    }
    return new RealWebSocket(url, protocols)
  }
}

export const blockedCount = () => attempts.length
export function onBlocked(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
