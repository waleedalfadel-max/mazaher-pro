import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { Button } from '../ui/components.jsx'

const bytesOf = async (data, isUrl) => isUrl
  ? new Uint8Array(await (await fetch(data)).arrayBuffer())
  : Uint8Array.from(atob(data), c => c.charCodeAt(0))

/**
 * ملف PDF في المراجعة (2026-10-30): عدد صفحاته ظاهر، وزر لكل صفحة يفتحها في عارض المتصفح، ليراجع المحاسب كل الصفحات قبل
 * الاعتماد. إن تعذّر عدّ الصفحات يبقى فتح الملف كاملًا متاحًا.
 */
export default function PdfPages({ data, isUrl, fileName }) {
  const [state, setState] = useState({ pages: null, url: null, failed: false })
  useEffect(() => {
    let on = true, made = null
    ;(async () => {
      try {
        const bytes = await bytesOf(data, isUrl)
        const { pdfPageCount } = await import('../lib/invoicePagesPdf.js')
        const pages = await pdfPageCount(bytes)
        made = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
        if (on) setState({ pages, url: made, failed: false }); else URL.revokeObjectURL(made)
      } catch { if (on) setState({ pages: null, url: null, failed: true }) }
    })()
    return () => { on = false; if (made) URL.revokeObjectURL(made) }
  }, [data, isUrl])
  const target = state.url || (isUrl ? data : null)
  const open = page => {
    if (target) window.open(page ? `${target}#page=${page}` : target, '_blank')
    else { const blob = new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: 'application/pdf' }); window.open(URL.createObjectURL(blob), '_blank') }
  }
  return (
    <div className="rp-pdf-pages" data-k="pdf-pages">
      <p className="rp-pdf-count">
        {state.pages ? <>ملف PDF من <strong className="ts-num" data-k="pdf-page-count">{state.pages}</strong> {state.pages === 1 ? 'صفحة' : 'صفحات'}{state.pages > 1 ? ' — راجع كل صفحة قبل الاعتماد.' : '.'}</>
          : state.failed ? 'ملف PDF — تعذّر عدّ صفحاته؛ افتحه وراجع كل صفحاته قبل الاعتماد.' : 'ملف PDF — جارٍ عدّ الصفحات…'}
      </p>
      <Button variant="primary" icon={FileText} onClick={() => open(0)}>فتح الملف كاملًا</Button>
      {state.pages > 1 && (
        <div className="rp-pdf-page-buttons">
          {Array.from({ length: state.pages }, (_, i) => (
            <Button key={i} size="sm" onClick={() => open(i + 1)} aria-label={`فتح الصفحة ${i + 1} من ${fileName || 'الملف'}`}>الصفحة {i + 1}</Button>
          ))}
        </div>
      )}
    </div>
  )
}
