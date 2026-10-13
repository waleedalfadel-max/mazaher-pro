// فحص إصدار الواجهة المفتوحة مقابل المنشور (/version.json)، ومنع الحفظ من صفحة قديمة بعد اكتشاف إصدار أحدث.
// • لا إعادة تحميل تلقائية: تُعرض رسالة وزر تحديث (src/components/VersionNotice.jsx).
// • بعد اكتشاف الاختلاف تُرفض طلبات الكتابة إلى القاعدة والتخزين من هذه الصفحة برسالة عربية؛ القراءة وتجديد الجلسة كما هي.
//   المسودة المحلية للمستند لا تمر بالشبكة فتبقى متاحة.
// • تعذّر الفحص (شبكة أو خادم) لا يُعدّ تحديثًا ولا يمنع شيئًا؛ يُعاد لاحقًا.
// • حدّ معروف: صفحة فُتحت من نسخة لا تحتوي هذا الملف لا تفحص شيئًا؛ حمايتها من الخادم وحده.

export const STALE_MESSAGE = 'صدر إصدار أحدث من التطبيق، ولم يُحفظ هذا الطلب. حدّث الصفحة ثم أعد المحاولة.'

/** رقم إصدار هذه الصفحة كما كُتب فيها عند تحميلها. */
export function currentVersion(doc = typeof document !== 'undefined' ? document : null) {
  return doc?.querySelector?.('meta[name="app-version"]')?.getAttribute('content') || null
}

/** يقارن رقم الصفحة بالمنشور. { status: 'same' | 'changed' | 'unknown', remote } — لا يرمي. */
export async function checkVersion(fetchImpl, current, { url = '/version.json', timeoutMs = 8000 } = {}) {
  if (!current) return { status: 'unknown', remote: null }
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetchImpl(`${url}?t=${Date.now()}`, { cache: 'no-store', signal: ctrl?.signal })
    if (!res || res.status !== 200) return { status: 'unknown', remote: null }
    const body = await res.json()
    const remote = typeof body?.version === 'string' && body.version.trim() ? body.version.trim() : null
    if (!remote) return { status: 'unknown', remote: null }
    return { status: remote === current ? 'same' : 'changed', remote }
  } catch {
    return { status: 'unknown', remote: null }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// حالة «الصفحة قديمة» لهذه النافذة
let staleRemote = null
const listeners = new Set()
export const isStale = () => staleRemote !== null
export function markStale(remote) {
  if (staleRemote !== null) return
  staleRemote = remote || 'unknown'
  listeners.forEach(fn => { try { fn(staleRemote) } catch {} })
}
export function onStale(fn) { listeners.add(fn); return () => listeners.delete(fn) }
export function resetStaleForTests() { staleRemote = null }

// دوال القراءة (تُستدعى بـ POST لكنها لا تكتب، أو تجهّز العرض من الخادم نفسه): تبقى متاحة لتعرض الصفحة القديمة ما فيها حتى التحديث
const READ_RPCS = new Set(['approval_mode', 'approval_prepare', 'approval_sales_report_history', 'admin_project_users', 'admin_project_user_counts', 'admin_project_entry_counts', 'admin_view_project', 'analysis_access',
  'team_members', 'category_settings', 'get_purchase_entries', 'get_project_modules', 'get_project_branding'])
function isWrite(input, init) {
  const method = String(init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false
  const url = typeof input === 'string' ? input : input?.url || String(input)
  const rpc = url.match(/\/rest\/v1\/rpc\/([a-z_0-9]+)/)
  if (rpc) return !READ_RPCS.has(rpc[1])
  if (url.includes('/storage/v1/object/sign/')) return false   // رابط موقّع لعرض صورة مستند
  return url.includes('/rest/v1/') || url.includes('/storage/v1/object')
}

/** fetch لعميل Supabase: بعد اكتشاف إصدار أحدث تُرفض الكتابة إلى القاعدة والتخزين برد 409 ورسالة عربية، دون إرسالها. */
export function guardedFetch(baseFetch) {
  return (input, init) => {
    if (isStale() && isWrite(input, init)) {
      return Promise.resolve(new Response(JSON.stringify({ message: STALE_MESSAGE, code: 'APP_VERSION_STALE', details: null, hint: null }),
        { status: 409, headers: { 'content-type': 'application/json' } }))
    }
    return baseFetch(input, init)
  }
}
