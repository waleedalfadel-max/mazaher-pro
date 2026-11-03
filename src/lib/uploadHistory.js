export const UPLOAD_HISTORY_PAGE_SIZE = 25
export const UPLOADER_ROLES = {
  owner: 'المالك', accountant: 'المحاسب', purchasing: 'مسؤول المشتريات',
  cashier: 'الكاشير', superadmin: 'مدير المنصة',
}
export const canViewAllUploads = role => ['owner', 'accountant', 'superadmin'].includes(role)
export const uploaderName = doc => doc.created_by_name || doc.uploaded_by_name || 'رافع غير مسجل'
export const uploaderRole = doc => doc.created_by_role || doc.uploaded_by || ''
export const uploaderKey = doc => doc.created_by_user_id
  ? `user:${doc.created_by_user_id}`
  : `legacy:${JSON.stringify([uploaderName(doc), uploaderRole(doc)])}`

// Identity is the stamped user ID, never the display name. Unattributed old records
// remain separate rather than being assigned to a current employee by guesswork.
export function uploaderOptions(rows) {
  const options = new Map()
  for (const doc of rows) {
    const key = uploaderKey(doc)
    if (!options.has(key)) options.set(key, {
      key, id: doc.created_by_user_id || null, name: uploaderName(doc),
      role: uploaderRole(doc), legacy: !doc.created_by_user_id,
    })
  }
  return [...options.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar') || a.key.localeCompare(b.key))
}

// All filter days are upload days in Saudi Arabia, including the entire last day.
export function uploadDateBounds(from = '', to = '') {
  for (const day of [from, to].filter(Boolean)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) {
      throw new Error('أدخل تاريخًا صحيحًا.')
    }
  }
  if (from && to && from > to) throw new Error('تاريخ البداية يجب أن يسبق تاريخ النهاية أو يساويه.')
  return {
    from: from ? new Date(`${from}T00:00:00+03:00`).toISOString() : null,
    until: to ? new Date(Date.parse(`${to}T00:00:00+03:00`) + 86400000).toISOString() : null,
  }
}

// PostgREST raw OR values must be quoted, including names containing commas/quotes.
const quoted = value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
function scope(client, projectId, role, columns, count = false) {
  if (!projectId || !canViewAllUploads(role)) throw new Error('لا يمكن عرض سجل المنشأة بهذا الحساب.')
  return client.from('documents').select(columns, count ? { count: 'exact' } : undefined).eq('project_id', projectId)
}

export function uploadHistoryQuery(client, { projectId, role, from, to, uploader, uploaderRole: roleFilter, status, page = 0 }) {
  const bounds = uploadDateBounds(from, to)
  let query = scope(client, projectId, role,
    'id,file_name,file_type,file_url,status,uploaded_at,uploaded_by,uploaded_by_name,created_by_user_id,created_by_name,created_by_role', true)
  if (bounds.from) query = query.gte('uploaded_at', bounds.from)
  if (bounds.until) query = query.lt('uploaded_at', bounds.until)
  if (roleFilter) {
    if (!Object.hasOwn(UPLOADER_ROLES, roleFilter)) throw new Error('صفة الرافع غير صحيحة.')
    query = query.or(`created_by_role.eq.${roleFilter},and(created_by_role.is.null,uploaded_by.eq.${roleFilter})`)
  }
  if (uploader?.id) query = query.eq('created_by_user_id', uploader.id)
  else if (uploader) {
    query = query.is('created_by_user_id', null)
    if (uploader.name === 'رافع غير مسجل') query = query.is('created_by_name', null).is('uploaded_by_name', null)
    else query = query.or(`created_by_name.eq.${quoted(uploader.name)},and(created_by_name.is.null,uploaded_by_name.eq.${quoted(uploader.name)})`)
    if (uploader.role) query = query.or(`created_by_role.eq.${quoted(uploader.role)},and(created_by_role.is.null,uploaded_by.eq.${quoted(uploader.role)})`)
  }
  if (status) query = query.eq('status', status)
  const start = Math.max(0, Math.floor(page)) * UPLOAD_HISTORY_PAGE_SIZE
  return query.order('uploaded_at', { ascending: false }).order('id', { ascending: false })
    .range(start, start + UPLOAD_HISTORY_PAGE_SIZE - 1)
}

// Only lightweight attribution fields, not files or OCR contents. Walk every page
// so uploaders of older documents (including deactivated staff) remain selectable.
export async function loadUploaderOptions(client, { projectId, role, signal }) {
  const rows = []
  for (let start = 0; ; start += 500) {
    if (signal?.aborted) return []
    const query = scope(client, projectId, role,
      'created_by_user_id,created_by_name,created_by_role,uploaded_by_name,uploaded_by')
      .order('uploaded_at', { ascending: false }).order('id', { ascending: false })
      .range(start, start + 499)
    const { data, error } = await (signal ? query.abortSignal(signal) : query)
    if (error) throw error
    rows.push(...(data || []))
    if ((data || []).length < 500) return uploaderOptions(rows)
  }
}

export function canDeleteOwnUpload(doc, viewerId, userName) {
  if (!doc || doc.status === 'approved') return false
  if (doc.created_by_user_id) return !!viewerId && doc.created_by_user_id === viewerId
  return !!userName && doc.uploaded_by_name === userName
}

export function uploadTimeSaudi(timestamp) {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return '—'
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(timestamp))
}
