import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, CircleAlert, FileText, Trash2, Upload } from 'lucide-react'
import { Button, IconButton, Note, Panel } from '../ui/components.jsx'
import { DropZone } from './UploadKit.jsx'
import { compressImage } from '../lib/imageCompress'
import { MAX_INVOICE_PAGES, movePage, pagesProblem, removePage } from '../lib/invoicePages.js'

const ACCEPT = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
const MAX_FILE_MB = 10
// هامش فوق حجم الطلب المقيس لاختلاف حد الطول عند إعادة المحاولة وما شابهه
const REQUEST_MARGIN = 4096
const mb = bytes => (bytes / (1024 * 1024)).toFixed(1)
const toBase64 = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(e.target.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(file) })

// ضغط الرفع المعتاد نفسه لكل صفحة (src/lib/imageCompress.js)؛ صيغة غير JPEG/PNG تُحوَّل إلى JPEG بأبعادها كاملة.
async function pageImage(file) {
  const out = await compressImage(file)
  if (['image/jpeg', 'image/png'].includes(out.type)) return out
  const url = URL.createObjectURL(out)
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('تعذّر فتح الصورة؛ أرسل PNG أو JPEG')); i.src = url })
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0)
    const blob = await new Promise((ok, fail) => canvas.toBlob(b => b ? ok(b) : fail(new Error('تعذّر تجهيز الصورة')), 'image/jpeg', 0.93))
    return new File([blob], file.name, { type: 'image/jpeg' })
  } finally { URL.revokeObjectURL(url) }
}

/**
 * صور صفحات فاتورة واحدة: معاينة وترتيب وحذف قبل الرفع، ثم تجميعها في PDF واحد. قبل الرفع يُقاس طلب القراءة الفعلي بالتعليمات
 * نفسها (measure)؛ ما يتجاوز الحد لا يُقبل ولا يُرفع.
 */
export default function InvoicePagesComposer({ disabled, measure, onSubmit }) {
  const [pages, setPages] = useState([])            // [{ id, file, url }]
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef()
  const nextId = useRef(0)
  const live = useRef(pages); live.current = pages
  useEffect(() => () => live.current.forEach(p => URL.revokeObjectURL(p.url)), [])

  function add(list) {
    setError('')
    const chosen = [...list]
    const bad = chosen.filter(f => !ACCEPT.includes(f.type))
    const images = chosen.filter(f => ACCEPT.includes(f.type))
    const room = MAX_INVOICE_PAGES - pages.length
    const taken = images.slice(0, Math.max(room, 0))
    setPages(prev => [...prev, ...taken.map(file => ({ id: ++nextId.current, file, url: URL.createObjectURL(file) }))])
    if (bad.length) setError('صفحات الفاتورة صور فقط (JPG أو PNG أو WEBP). ملف PDF يُرفع من «ملفات مستقلة».')
    else if (images.length > taken.length) setError(`الحد ${MAX_INVOICE_PAGES} صفحات للفاتورة الواحدة؛ لم تُضف ${images.length - taken.length} صورة.`)
  }
  function remove(i) { URL.revokeObjectURL(pages[i].url); setPages(removePage(pages, i)); setError('') }

  async function submit() {
    const problem = pagesProblem(pages.map(p => ({ type: ['image/jpeg', 'image/png'].includes(p.file.type) ? p.file.type : 'image/jpeg' })))
    if (problem) { setError(problem); return }
    setBusy(true); setError('')
    try {
      const prepared = []
      for (const p of pages) { const img = await pageImage(p.file); prepared.push({ bytes: new Uint8Array(await img.arrayBuffer()), type: img.type }) }
      const { buildPagesPdf } = await import('../lib/invoicePagesPdf.js')
      const pdf = await buildPagesPdf(prepared)
      const name = `فاتورة من ${pages.length} صفحات - ${pages[0].file.name.replace(/\.[^.]+$/, '')}.pdf`
      const file = new File([pdf], name, { type: 'application/pdf' })
      if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`حجم الفاتورة بعد التجهيز ${mb(file.size)} ميجابايت، والحد ${MAX_FILE_MB}. قلّل عدد الصفحات. لم يُرفع شيء.`)
      const { requestBytes, limit } = await measure(await toBase64(file), name)
      if (requestBytes > limit - REQUEST_MARGIN) throw new Error(`طلب قراءة هذه الصفحات ${mb(requestBytes)} ميجابايت، والحد ${mb(limit)}. قلّل عدد الصفحات أو صوّرها أقرب بدقة أقل. لم يُرفع شيء.`)
      await onSubmit(file, pages.length)
      pages.forEach(p => URL.revokeObjectURL(p.url)); setPages([])
    } catch (e) { setError(e.message || 'تعذّر تجهيز صفحات الفاتورة. لم يُرفع شيء.') }
    finally { setBusy(false) }
  }

  const locked = disabled || busy
  return <>
    {!locked && pages.length < MAX_INVOICE_PAGES && (
      <DropZone inputRef={inputRef} dragOver={dragOver} setDragOver={setDragOver} onFiles={add}
        title={pages.length ? 'أضف الصفحة التالية: اسحبها هنا أو اضغط للاختيار' : 'اختر صور صفحات الفاتورة بالترتيب'}
        hint={`صفحات فاتورة واحدة فقط — حتى ${MAX_INVOICE_PAGES} صفحات`}
        formats="JPG · PNG · WEBP"
        inputProps={{ accept: ACCEPT.join(','), multiple: true }} />
    )}
    {pages.length > 0 && (
      <Panel title={`صفحات الفاتورة (${pages.length})`} icon={FileText} clip>
        <ol className="rp-pages" data-k="invoice-pages">
          {pages.map((p, i) => (
            <li key={p.id} className="rp-page">
              <img src={p.url} alt={`الصفحة ${i + 1}`} className="rp-page-thumb" />
              <span className="rp-page-name"><strong>الصفحة {i + 1}</strong><small>{p.file.name}</small></span>
              <span className="rp-page-actions">
                <IconButton label={`نقل الصفحة ${i + 1} للأعلى`} icon={ArrowUp} disabled={locked || i === 0} onClick={() => setPages(movePage(pages, i, i - 1))} />
                <IconButton label={`نقل الصفحة ${i + 1} للأسفل`} icon={ArrowDown} disabled={locked || i === pages.length - 1} onClick={() => setPages(movePage(pages, i, i + 1))} />
                <IconButton label={`حذف الصفحة ${i + 1}`} icon={Trash2} disabled={locked} onClick={() => remove(i)} />
              </span>
            </li>
          ))}
        </ol>
      </Panel>
    )}
    {error && <Note tone="error" icon={CircleAlert} title="لم تُرفع الفاتورة">{error}</Note>}
    {pages.length > 0 && (
      <Button variant="primary" full icon={Upload} className="rp-upload-go" disabled={locked || pages.length < 2} onClick={submit}>
        {busy ? 'جارٍ تجهيز الصفحات…' : `رفع الفاتورة (${pages.length} صفحات)`}
      </Button>
    )}
    {pages.length === 1 && !busy && <p className="ts-field-hint">أضف الصفحة الثانية على الأقل، أو ارفع الصورة من «ملفات مستقلة».</p>}
  </>
}
