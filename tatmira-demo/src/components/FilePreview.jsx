import React from 'react'
import { useFileUrl } from '../store.jsx'
import { downloadBlob } from '../lib/files.js'
import { Button } from './ui.jsx'

export default function FilePreview({ file, compact }) {
  const { url, blob, missing } = useFileUrl(file?.id)
  if (!file) return null
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  const isImage = file.type?.startsWith('image/')

  return (
    <div className="rounded-2xl border border-border bg-surface overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white border-b border-border">
        <span className="text-xs font-bold truncate" title={file.name}>{isPdf ? '📄' : '🖼️'} {file.name}</span>
        {blob && (
          <div className="flex gap-1.5 shrink-0">
            <a href={url} target="_blank" rel="noopener" className="px-2.5 py-1 rounded-lg text-xs font-bold" style={{ background: '#EEF4F3', color: '#1B3A5C' }}>فتح</a>
            <Button variant="secondary" className="!px-2.5 !py-1 !text-xs" onClick={() => downloadBlob(blob, file.name)}>تنزيل</Button>
          </div>
        )}
      </div>
      {missing && <div className="p-4 text-sm text-center text-slate-500">الملف غير متاح على هذا الجهاز</div>}
      {url && isImage && <img src={url} alt="معاينة المستند" className={`w-full object-contain bg-white ${compact ? 'max-h-60' : 'max-h-[70vh]'}`} />}
      {url && isPdf && (
        <object data={url} type="application/pdf" className={`w-full bg-white ${compact ? 'h-60' : 'h-[70vh]'}`}>
          <div className="p-4 text-sm text-center text-slate-600">المتصفح لا يعرض PDF هنا — استخدم «فتح»</div>
        </object>
      )}
    </div>
  )
}
