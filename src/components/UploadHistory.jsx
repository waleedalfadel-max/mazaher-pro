import React, { useEffect, useState } from 'react'
import { FileText, History, RotateCcw, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Button, Dialog, EmptyState, Field, IconButton, Input, Note, Panel, Select, Status } from '../ui/components.jsx'
import { fileIcon } from './UploadKit.jsx'
import {
  UPLOAD_HISTORY_PAGE_SIZE, UPLOADER_ROLES, canDeleteOwnUpload, loadUploaderOptions,
  uploadDateBounds, uploadHistoryQuery, uploaderName, uploaderRole, uploadTimeSaudi,
} from '../lib/uploadHistory.js'

const STATES = {
  approved: { label: 'معتمد', tone: 'success' }, analyzed: { label: 'مقروء — بانتظار المراجعة', tone: 'warning' },
  uploaded: { label: 'بانتظار القراءة', tone: 'neutral' }, rejected: { label: 'مرفوض', tone: 'danger' },
}
const EMPTY_FILTERS = { from: '', to: '', uploader: '', uploaderRole: '', status: '' }

export default function UploadHistory({ projectId, role, userName, refreshKey, onOpen, onDelete }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [page, setPage] = useState(0)
  const [reload, setReload] = useState(0)
  const [result, setResult] = useState({ docs: [], count: 0, loading: true, error: '' })
  const [uploaders, setUploaders] = useState([])
  const [uploaderLoading, setUploaderLoading] = useState(true)
  const [uploaderError, setUploaderError] = useState('')
  const [viewerId, setViewerId] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      const authId = data?.session?.user?.id
      if (!authId) return
      const { data: user } = await supabase.from('app_users').select('id').eq('auth_id', authId).maybeSingle()
      if (active) setViewerId(user?.id || null)
    }).catch(() => {})
    return () => { active = false }
  }, [projectId, role, userName])

  useEffect(() => {
    const controller = new AbortController()
    setUploaderLoading(true); setUploaderError('')
    loadUploaderOptions(supabase, { projectId, role, userName, signal: controller.signal })
      .then(options => { if (!controller.signal.aborted) setUploaders(options) })
      .catch(() => { if (!controller.signal.aborted) setUploaderError('تعذّر تحميل أسماء الرافعين. أعد المحاولة بزر «تحديث».') })
      .finally(() => { if (!controller.signal.aborted) setUploaderLoading(false) })
    return () => controller.abort()
  }, [projectId, role, userName, refreshKey, reload])

  let dateError = ''
  try { uploadDateBounds(filters.from, filters.to) } catch (error) { dateError = error.message }
  const selectedUploader = uploaders.find(u => u.key === filters.uploader)
  useEffect(() => {
    const controller = new AbortController()
    setResult({ docs: [], count: 0, loading: !dateError, error: '' })
    if (dateError) return () => controller.abort()
    // Do not silently broaden a selected person to everybody while options reload.
    if (filters.uploader && !selectedUploader) {
      setResult({ docs: [], count: 0, loading: false, error: 'الرافع المحدد غير متاح؛ اختر رافعًا آخر أو امسح الفلاتر.' })
      return () => controller.abort()
    }
    async function load() {
      try {
        const { data, count, error } = await uploadHistoryQuery(supabase, {
          projectId, role, userName, ...filters, uploader: selectedUploader, page,
        }).abortSignal(controller.signal)
        if (controller.signal.aborted) return
        if (error) throw error
        // A deletion elsewhere can remove the last page; move back into range.
        if (page > 0 && page * UPLOAD_HISTORY_PAGE_SIZE >= count) {
          setPage(Math.max(0, Math.ceil(count / UPLOAD_HISTORY_PAGE_SIZE) - 1)); return
        }
        setResult({ docs: data || [], count: count || 0, loading: false, error: '' })
      } catch {
        if (!controller.signal.aborted) setResult({ docs: [], count: 0, loading: false, error: 'تعذّر تحميل المستندات. أعد المحاولة بزر «تحديث».' })
      }
    }
    load()
    return () => controller.abort()
  }, [projectId, role, userName, filters, selectedUploader, page, refreshKey, reload, dateError])

  function change(key, value) {
    setFilters(current => ({ ...current, [key]: value, ...(key === 'uploaderRole' ? { uploader: '' } : {}) }))
    setPage(0)
  }
  function refresh() { setPage(0); setReload(value => value + 1) }
  async function remove() {
    if (!canDeleteOwnUpload(confirming, viewerId, userName) || deleting) return
    setDeleting(true); setDeleteError('')
    try {
      const removed = await onDelete(confirming)
      if (removed !== false) { setConfirming(null); refresh() }
      else setDeleteError('تعذّر حذف المستند. أعد تحديث القائمة وتحقق من حالته.')
    } catch { setDeleteError('تعذّر حذف المستند. حاول مرة أخرى.') }
    finally { setDeleting(false) }
  }
  const visibleUploaders = uploaders.filter(u => !filters.uploaderRole || u.role === filters.uploaderRole)
  const pages = Math.max(1, Math.ceil(result.count / UPLOAD_HISTORY_PAGE_SIZE))
  return (
    <Panel title="المستندات المرفوعة" icon={History} clip action={<Button icon={RotateCcw} onClick={refresh}>تحديث</Button>}>
      <div className="rp-history-tools">
        <p>جميع مستندات المنشأة، بما فيها المقروءة والمعتمدة. التاريخ هو تاريخ الرفع بتوقيت السعودية.</p>
        <div className="rp-history-filters">
          <Field label="صفة الرافع"><Select value={filters.uploaderRole} onChange={e => change('uploaderRole', e.target.value)} options={[
            { value: '', label: 'جميع الصفات' }, ...Object.entries(UPLOADER_ROLES).map(([value, label]) => ({ value, label })),
          ]} /></Field>
          <Field label="الرافع"><Select value={filters.uploader} disabled={uploaderLoading} onChange={e => change('uploader', e.target.value)} options={[
            { value: '', label: uploaderLoading ? 'جارٍ تحميل الرافعين…' : 'جميع الرافعين' },
            ...visibleUploaders.map(u => ({ value: u.key, label: `${u.name} — ${UPLOADER_ROLES[u.role] || 'صفة غير مسجلة'}${u.legacy ? ' (سجل قديم)' : ''}` })),
          ]} /></Field>
          <Field label="رُفعت من تاريخ"><Input type="date" value={filters.from} onChange={e => change('from', e.target.value)} /></Field>
          <Field label="رُفعت حتى تاريخ"><Input type="date" value={filters.to} onChange={e => change('to', e.target.value)} /></Field>
          <Field label="حالة المستند"><Select value={filters.status} onChange={e => change('status', e.target.value)} options={[
            { value: '', label: 'جميع الحالات' }, ...Object.entries(STATES).map(([value, state]) => ({ value, label: state.label })),
          ]} /></Field>
          <Button onClick={() => { setFilters(EMPTY_FILTERS); setPage(0) }}>مسح الفلاتر</Button>
        </div>
        {uploaderError && <Note tone="error">{uploaderError}</Note>}
        {dateError && <Note tone="error">{dateError}</Note>}
        {result.error && <Note tone="error">{result.error}</Note>}
      </div>
      <div aria-live="polite" aria-busy={result.loading}>
        {result.loading ? <div className="ts-empty">جارٍ تحميل المستندات…</div>
          : !result.error && !dateError && (result.docs.length ? <ul className="rp-uploads rp-history-list">
            {result.docs.map(doc => {
              const Icon = fileIcon(doc.file_type)
              const state = STATES[doc.status] || { label: doc.status || 'غير محدد', tone: 'neutral' }
              return <li key={doc.id}>
                <button className="rp-upload-open" type="button" onClick={() => onOpen(doc.file_url)} aria-label={`فتح ${doc.file_name}`}>
                  <span className="rp-doc-icon"><Icon className="ts-icon" aria-hidden="true" /></span>
                  <span className="rp-upload-name"><strong>{doc.file_name}</strong>
                    <small>رفعه: {uploaderName(doc)} · {UPLOADER_ROLES[uploaderRole(doc)] || 'صفة غير مسجلة'}</small>
                    <small>{uploadTimeSaudi(doc.uploaded_at)}</small>
                  </span>
                </button>
                <Status tone={state.tone}>{state.label}</Status>
                {onDelete && canDeleteOwnUpload(doc, viewerId, userName) && <IconButton bare label={`حذف ${doc.file_name}`} icon={Trash2} onClick={() => { setDeleteError(''); setConfirming(doc) }} />}
              </li>
            })}
          </ul> : <EmptyState icon={FileText}>لا توجد مستندات مطابقة للفلاتر.</EmptyState>)}
      </div>
      {!result.loading && !result.error && !dateError && <div className="rp-history-pagination">
        <span>{result.count} مستند · الصفحة {page + 1} من {pages}</span>
        <div><Button disabled={page === 0} onClick={() => setPage(value => value - 1)}>السابق</Button>
          <Button disabled={page + 1 >= pages} onClick={() => setPage(value => value + 1)}>التالي</Button></div>
      </div>}
      <Dialog open={!!confirming} onClose={() => { if (!deleting) setConfirming(null) }} title="حذف المستند؟"
        description={confirming ? `«${confirming.file_name}» — لا يمكن التراجع.` : ''}
        footer={<><Button variant="danger-solid" disabled={deleting} onClick={remove}>{deleting ? 'جارٍ الحذف…' : 'حذف'}</Button>
          <Button disabled={deleting} onClick={() => setConfirming(null)}>إلغاء</Button></>}>
        {deleteError && <Note tone="error">{deleteError}</Note>}
      </Dialog>
    </Panel>
  )
}
