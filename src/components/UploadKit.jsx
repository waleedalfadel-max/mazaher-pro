// أجزاء مشتركة بين صفحتي الرفع والكاشير بالتصميم الجديد. العرض فقط: الرفع والقراءة والحذف
// تبقى في الصفحتين كما كانت.
import React, { useState } from 'react'
import { FileImage, FileText, History, Trash2, Upload } from 'lucide-react'
import { Button, Dialog, EmptyState, IconButton, Panel, Status } from '../ui/components.jsx'
import { formatDate, formatTime } from '../ui/format.js'

/** وقت الرفع بتوقيت الجهاز وبأرقام لاتينية: «27 سبتمبر 11:52 ص» */
export function uploadedAt(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString()
  return `${formatDate(local.slice(0, 10), { refYear: new Date().getFullYear() })} ${formatTime(local)}`
}

export const fileIcon = type => (type?.startsWith('image/') ? FileImage : FileText)

/** منطقة الإفلات والاختيار. الإدخال نفسه (accept/multiple/capture) كما كان في كل صفحة. */
export function DropZone({ inputRef, dragOver, setDragOver, onFiles, title, hint, formats, inputProps }) {
  return (
    <div className={`rp-drop${dragOver ? ' is-over' : ''}`} role="button" tabIndex={0}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files) }}
      onClick={() => inputRef.current.click()}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current.click() } }}>
      <span className="rp-drop-icon"><Upload className="ts-icon" aria-hidden="true" /></span>
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
      {formats && <small>{formats}</small>}
      <input ref={inputRef} type="file" className="hidden" onChange={e => onFiles(e.target.files)} {...inputProps} />
    </div>
  )
}

const DOC_STATUS = {
  approved: { label: 'معتمد', tone: 'success' },
  rejected: { label: 'مرفوض', tone: 'danger' },
  analyzed: { label: 'بانتظار المراجعة', tone: 'warning' },
  uploaded: { label: 'بانتظار القراءة', tone: 'neutral' },
}

/** آخر مستندات المستخدم. الحذف لغير المعتمد فقط، بتأكيد، كما كان. */
export function MyUploads({ docs, loading, onOpen, onDelete }) {
  const [confirming, setConfirming] = useState(null)
  return (
    <Panel title="آخر المستندات المرفوعة" icon={History} clip>
      {loading ? <div className="ts-empty">جارٍ التحميل…</div>
        : docs.length === 0 ? <EmptyState icon={FileText}>ما رفعت أي مستند بعد.</EmptyState>
        : (
          <ul className="rp-uploads">
            {docs.map(doc => {
              const Icon = fileIcon(doc.file_type)
              const st = DOC_STATUS[doc.status] || { label: doc.status, tone: 'neutral' }
              return (
                <li key={doc.id}>
                  <button type="button" className="rp-upload-open" onClick={() => onOpen(doc.file_url)}>
                    <span className="rp-doc-icon"><Icon className="ts-icon" aria-hidden="true" /></span>
                    <span className="rp-upload-name"><strong>{doc.file_name}</strong><small>{uploadedAt(doc.uploaded_at)}</small></span>
                  </button>
                  <Status tone={st.tone}>{st.label}</Status>
                  {doc.status !== 'approved' && (
                    <IconButton bare label={`حذف ${doc.file_name}`} icon={Trash2} onClick={() => setConfirming(doc)} />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      <Dialog open={!!confirming} onClose={() => setConfirming(null)} title="حذف المستند؟"
        description={confirming ? `«${confirming.file_name}» — لا يمكن التراجع.` : ''}
        footer={<>
          <Button variant="danger-solid" icon={Trash2} onClick={() => { const d = confirming; setConfirming(null); onDelete(d) }}>حذف</Button>
          <Button onClick={() => setConfirming(null)}>إلغاء</Button>
        </>} />
    </Panel>
  )
}
