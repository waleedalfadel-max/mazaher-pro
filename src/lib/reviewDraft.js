// مسودة مراجعة المستند قبل الاعتماد — محلية في نافذة المتصفح (sessionStorage) لا في قاعدة البيانات.
//
// العزل: المفتاح يجمع المنشأة والمستخدم (هوية الجلسة الفعلية) والمستند، فلا يرى مستخدم آخر
// على الجهاز نفسه مسودة غيره، ولا تنتقل مسودة منشأة إلى أخرى.
// الصلاحية: تُحفظ مع المسودة حالة المستند وبصمة نتيجة قراءته؛ إن تغيّر أيهما (قُرئ من جديد،
// أو تغيّرت حالته) لا تُطبَّق وتُحذف. وتُحذف بعد الاعتماد أو الرفض.
//
// وحدة خالصة: التخزين يُمرَّر، فتُختبر بلا متصفح.

const PREFIX = 'tahseeb:review-draft:v1:'

/** البصمة: تجزئة ثابتة لنص JSON بمفاتيح مرتبة — تكفي لكشف التغيّر، لا للأمان. */
export function fingerprint(value) {
  const stable = v => Array.isArray(v) ? v.map(stable)
    : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => (o[k] = stable(v[k]), o), {})
    : v
  const text = JSON.stringify(stable(value ?? null))
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** @param {{ projectId?: string|null, userId: string }} scope */
export function draftKey(scope, docId) {
  if (!scope?.userId || !docId) return null
  return `${PREFIX}${scope.projectId || 'all'}:${scope.userId}:${docId}`
}

const baseOf = doc => ({ status: doc.status, base: fingerprint(doc.analysis_result) })

/** يحفظ نسخة التعديل وما يرافقها (الفرع، المورد…) مع حالة المستند وبصمة قراءته وقت الحفظ. */
export function saveDraft(storage, scope, doc, edit, extras = {}, now = Date.now()) {
  const key = draftKey(scope, doc?.id)
  if (!key) return false
  try {
    storage.setItem(key, JSON.stringify({ ...baseOf(doc), savedAt: now, edit, extras }))
    return true
  } catch { return false }
}

/**
 * @returns {null | { stale: true } | { edit: object, extras: object, savedAt: number }}
 *   stale: كانت هناك مسودة لكن المستند تغيّر بعدها — حُذفت ولم تُطبَّق.
 */
export function loadDraft(storage, scope, doc) {
  const key = draftKey(scope, doc?.id)
  if (!key) return null
  let saved = null
  try { saved = JSON.parse(storage.getItem(key) || 'null') } catch { saved = null }
  if (!saved || typeof saved !== 'object' || !saved.edit) return null
  const now = baseOf(doc)
  if (saved.status !== now.status || saved.base !== now.base) {
    try { storage.removeItem(key) } catch {}
    return { stale: true }
  }
  return { edit: saved.edit, extras: saved.extras || {}, savedAt: saved.savedAt || 0 }
}

export function clearDraft(storage, scope, docId) {
  const key = draftKey(scope, docId)
  if (!key) return
  try { storage.removeItem(key) } catch {}
}

/** يحذف مسودات هذا المستخدم في هذه المنشأة لمستندات لم تعد بانتظار المراجعة (اعتُمدت أو رُفضت). */
export function purgeDrafts(storage, scope, liveDocIds) {
  const head = draftKey(scope, 'x')?.slice(0, -1)
  if (!head) return 0
  const live = new Set(liveDocIds)
  let removed = 0
  try {
    const keys = []
    for (let i = 0; i < storage.length; i++) keys.push(storage.key(i))
    for (const k of keys) {
      if (k && k.startsWith(head) && !live.has(k.slice(head.length))) { storage.removeItem(k); removed++ }
    }
  } catch {}
  return removed
}

/** مسودات النسخة السابقة (مفتاح بالمستند وحده، بلا منشأة ولا مستخدم) تُحذف ولا تُطبَّق. */
export function dropLegacyDrafts(storage) {
  try {
    const keys = []
    for (let i = 0; i < storage.length; i++) keys.push(storage.key(i))
    keys.filter(k => k && k.startsWith('pd-draft-')).forEach(k => storage.removeItem(k))
  } catch {}
}
