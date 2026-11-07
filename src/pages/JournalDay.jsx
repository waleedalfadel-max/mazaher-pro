import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import { Printer, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { journalSummaries, summaryDays, loadJournalDay } from '../lib/journalSummary.js'
import JournalTable from '../components/JournalTable.jsx'
import { loadJournalAccounts } from '../lib/journalAccounts.js'
import { Button, Note } from '../ui/components.jsx'
import { formatDate } from '../ui/format.js'
import './JournalDetail.css'

function DayContent({ day, context, date, projectName, printing = false }) {
  return <div className="journal-detail-content" dir="rtl">
    <header className="journal-detail-header"><div><span className="journal-brand">تحسيب</span><h1>قيود اليومية</h1><p>{projectName}</p></div>
      <div><strong>{formatDate(date, { year: true })}</strong><p>{day.groups.length} قيود</p></div></header>
    <JournalTable groups={day.groups} context={context} printing={printing}/>
    {!day.groups.length && <p>لا توجد عمليات في هذا اليوم.</p>}
  </div>
}

export default function JournalDay() {
  const { projectId, sessionEpoch } = useAuth(), [params] = useSearchParams(), date = params.get('date') || ''
  return <DayPage key={`${projectId}:${sessionEpoch}:${date}`} projectId={projectId} date={date}/>
}
function DayPage({ projectId, date }) {
  const { projectName } = useAuth(), [day, setDay] = useState(null), [context, setContext] = useState({}), [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [printing, setPrinting] = useState(false)
  useEffect(() => {
    let active = true; setDay(null); setError('')
    loadJournalDay(supabase, { projectId, date }).then(async result => {
      if (!active) return
      if (result.error) setError(result.error.message === 'invalid_date' ? 'اختر تاريخًا صحيحًا.' : 'تعذّر تحميل اليوم كاملًا؛ أعد المحاولة.')
      else {
        const accounts = await loadJournalAccounts(supabase, projectId, result.data)
        if (!active) return
        if (accounts.error) { setError('تعذّر تحميل حسابات اليوم؛ أعد المحاولة.'); return }
        setContext(accounts.data); setDay(summaryDays(journalSummaries(result.data))[0] || { groups: [] })
      }
    })
    return () => { active = false }
  }, [projectId, date, attempt])
  async function print() {
    if (!day || printing) return
    setPrinting(true); const title = document.title
    try { await document.fonts?.ready; document.title = `قيود يوم ${date} — ${projectName}`; window.print() }
    finally { document.title = title; setPrinting(false) }
  }
  return <div className="journal-detail-page" data-k="journal-day">
    <div className="journal-detail-actions"><Link className="ts-btn" to="/operations">رجوع للسجل</Link><Button variant="primary" icon={Printer} disabled={!day || printing} onClick={print}>طباعة قيود اليوم</Button></div>
    {error ? <Note tone="error" action={<Button icon={RefreshCw} onClick={() => setAttempt(n => n + 1)}>إعادة المحاولة</Button>}>{error}</Note>
      : !day ? <p role="status">جارٍ تحميل اليوم…</p> : <><DayContent day={day} context={context} date={date} projectName={projectName}/>
        {createPortal(<div className="journal-print-root"><DayContent day={day} context={context} date={date} projectName={projectName} printing/></div>, document.body)}</>}
  </div>
}
