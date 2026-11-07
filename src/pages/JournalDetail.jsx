import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ArrowRight, ExternalLink, Printer, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { getSignedUrl } from '../lib/storage'
import { loadJournalDetail, journalAccountMovements } from '../lib/journalDetail.js'
import { Button, Note, Status } from '../ui/components.jsx'
import { formatDate, formatNumber } from '../ui/format.js'
import './JournalDetail.css'

const statuses = { approved: ['معتمد', 'success'], auto: ['تلقائي', 'info'], pending: ['معلق', 'warning'], cancelled: ['ملغي', 'danger'], modified: ['معدّل', 'neutral'] }
const amount = value => <bdi className="ts-num">{formatNumber(value)} ر.س</bdi>
const clean = value => String(value || '').replace(/^[^\p{L}\p{N}]+/u, '').trim()

// One content component serves both the screen and the printable document.
export function JournalDetailContent({ detail, projectName, onOpenFile, printing = false }) {
  const dates = [...new Set(detail.rows.map(r => r.date))]
  return <div className="journal-detail-content" dir="rtl">
    <header className="journal-detail-header">
      <div><span className="journal-brand">تحسيب</span><h1>تفاصيل القيد</h1><p>{projectName}</p></div>
      <div><strong><bdi>{detail.journalNumber || 'قيد بدون رقم'}</bdi></strong><p>{dates.map(d => formatDate(d, { year: true })).join('، ')}</p><span>{detail.rows.length} عمليات</span></div>
    </header>
    {detail.rows.map((row, index) => {
      const movements = journalAccountMovements(row, detail), status = statuses[row.status] || [row.status || 'غير محدد', 'neutral']
      return <section key={row.id} className="journal-operation" data-entry-id={row.id}>
        <div className="journal-operation-heading"><h2>{index + 1}. {clean(row.type) || 'حركة مالية'}</h2><Status tone={status[1]}>{status[0]}</Status></div>
        <dl className="journal-meta">
          <div><dt>التاريخ</dt><dd>{formatDate(row.date, { year: true })}</dd></div>
          {row.branch && <div><dt>الفرع</dt><dd>{row.branch}</dd></div>}
          <div><dt>المبلغ المسجل</dt><dd>{amount(row.total_amount)}</dd></div>
          {!!Number(row.vat_amount) && <div><dt>ضريبة المشتريات المسجلة</dt><dd>{amount(row.vat_amount)}</dd></div>}
          {!!Number(row.output_vat_amount) && <div><dt>ضريبة المبيعات المسجلة</dt><dd>{amount(row.output_vat_amount)}</dd></div>}
          {row.created_by_name && <div><dt>المنفذ</dt><dd>{row.created_by_name}</dd></div>}
        </dl>
        {row.description && <p className="journal-description">{row.description}</p>}
        {movements.length > 0 && <table className="journal-movements"><caption>حركات الحسابات</caption><thead><tr><th>الحساب</th><th>زيادة</th><th>نقص</th></tr></thead><tbody>
          {movements.map(m => <tr key={m.key}><td>{m.label}</td><td>{m.increase !== 0 ? amount(m.increase) : '—'}</td><td>{m.decrease !== 0 ? amount(m.decrease) : '—'}</td></tr>)}
        </tbody></table>}
      </section>
    })}
    {detail.items.length > 0 && <section className="journal-items"><h2>بنود المستند</h2><table className="journal-movements"><thead><tr><th>البند</th><th>التصنيف</th><th>المبلغ</th><th>الضريبة</th></tr></thead><tbody>
      {detail.items.map(item => <tr key={item.id}><td>{item.description || '—'}</td><td>{[item.category_main, item.category_sub].filter(Boolean).join(' / ') || '—'}</td><td>{amount(item.amount)}</td><td>{amount(item.vat_amount)}</td></tr>)}
    </tbody></table></section>}
    {detail.files.length > 0 && <section className="journal-files"><h2>المستندات والمرفقات</h2><ul>
      {detail.files.map(file => <li key={file.file_url}><span>{file.file_name || 'مستند القيد'}</span>{!printing && <Button size="sm" variant="quiet" icon={ExternalLink} onClick={() => onOpenFile(file.file_url)}>فتح</Button>}</li>)}
    </ul></section>}
  </div>
}

export default function JournalDetail() {
  const { entryId } = useParams(), { projectId, sessionEpoch } = useAuth()
  return <DetailPage key={`${projectId}:${sessionEpoch}:${entryId}`} projectId={projectId} entryId={entryId} />
}

function DetailPage({ projectId, entryId }) {
  const { projectName } = useAuth(), location = useLocation()
  const [detail, setDetail] = useState(null), [error, setError] = useState(''), [fileError, setFileError] = useState('')
  const [attempt, setAttempt] = useState(0), [printing, setPrinting] = useState(false)
  const returnTo = /^\/(accounts|operations|ledger|journal|daily-journal)(\?|$)/.test(location.state?.returnTo || '') ? location.state.returnTo : '/operations'
  useEffect(() => {
    let active = true
    setDetail(null); setError(''); setFileError('')
    loadJournalDetail(supabase, { projectId, entryId }).then(result => {
      if (!active) return
      if (result.error) setError(result.error.message === 'not_found' ? 'القيد غير موجود أو غير متاح في هذه المنشأة.' : `تعذّر تحميل ${result.part} كاملًا. أعد المحاولة.`)
      else setDetail(result.data)
    })
    return () => { active = false }
  }, [projectId, entryId, attempt])

  async function print() {
    if (!detail || printing) return
    setPrinting(true)
    const previousTitle = document.title
    try { await document.fonts?.ready; document.title = `قيد ${detail.journalNumber || entryId} — ${projectName}`; window.print() }
    finally { document.title = previousTitle; setPrinting(false) }
  }
  async function openFile(url) {
    setFileError('')
    const win = window.open('', '_blank')
    if (!win) { setFileError('اسمح بفتح النوافذ لعرض المستند.'); return }
    win.opener = null
    try {
      const signed = await getSignedUrl(url)
      if (!signed) throw new Error('file')
      win.location.replace(signed)
    } catch { win.close(); setFileError('تعذّر فتح المستند؛ أعد المحاولة.') }
  }
  return <div className="journal-detail-page" data-k="journal-detail">
    <div className="journal-detail-actions"><Link className="ts-btn" to={returnTo}><ArrowRight className="ts-icon"/>رجوع للسجل</Link>
      <Button variant="primary" icon={Printer} disabled={!detail || printing} onClick={print}>طباعة القيد</Button>
    </div>
    {error ? <Note tone="error" action={<Button icon={RefreshCw} onClick={() => setAttempt(n => n + 1)}>إعادة المحاولة</Button>}>{error}</Note>
      : !detail ? <p role="status">جارٍ تحميل القيد…</p> : <>
        {fileError && <Note tone="error">{fileError}</Note>}
        <JournalDetailContent detail={detail} projectName={projectName} onOpenFile={openFile}/>
        {createPortal(<div className="journal-print-root"><JournalDetailContent detail={detail} projectName={projectName} printing/></div>, document.body)}
      </>}
  </div>
}
