import { Link } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { formatDate } from '../ui/format.js'
import JournalTable from './JournalTable.jsx'
import './JournalSummary.css'

export default function JournalSummary({ days, context }) {
  if (!days.length) return <p>لا توجد عمليات في الاختيار الحالي.</p>
  return <div className="daily-journals">{days.map(day => <section className="journal-summary-day" key={day.date}>
    <header><div><h3>{formatDate(day.date, { year: true })}</h3><span>{day.groups.length} قيود</span></div>
      <Link className="ts-btn ts-btn--quiet" to={'/daily-journal?date=' + day.date}><Printer className="ts-icon"/>عرض اليوم وطباعته</Link>
    </header>
    <JournalTable groups={day.groups} context={context}/>
  </section>)}</div>
}
