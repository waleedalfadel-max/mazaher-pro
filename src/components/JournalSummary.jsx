import { Link } from 'react-router-dom'
import { Printer } from 'lucide-react'
import JournalEntryLink from './JournalEntryLink.jsx'
import { formatDate, formatNumber } from '../ui/format.js'
import { Status } from '../ui/components.jsx'
import './JournalSummary.css'

const statuses = { approved: ['معتمد', 'success'], auto: ['تلقائي', 'info'], pending: ['معلق', 'warning'], modified: ['معدّل', 'neutral'] }
const money = value => <bdi className="ts-num">{formatNumber(value)} ر.س</bdi>

export function JournalSummaryRows({ groups, printing = false }) {
  return <div className="journal-summary-rows">
    {groups.map(group => {
      const status = statuses[group.status] || [group.status || 'غير محدد', 'neutral']
      return <article className="journal-summary-row" key={group.key} data-journal={group.entry.journal_number || group.entry.id}>
        <div className="journal-summary-label"><strong>{group.title}{group.branch ? ` — ${group.branch}` : ''}</strong>
          {group.description && <small>{group.description}</small>}
          <span>{printing ? <bdi>{group.entry.journal_number || 'بدون رقم'}</bdi> : <JournalEntryLink entry={group.entry}/>}
            {group.partial && <small> · حسب التصفية</small>}</span>
        </div>
        <div className="journal-summary-values">
          {group.incoming !== 0 && <span>داخل {money(group.incoming)}</span>}
          {group.outgoing !== 0 && <span>خارج {money(group.outgoing)}</span>}
          {group.receivable !== 0 && <span>{group.receivable > 0 ? 'زيادة مستحقات لنا' : 'نقص مستحقات لنا'} {money(Math.abs(group.receivable))}</span>}
          {group.payable !== 0 && <span>{group.payable > 0 ? 'زيادة مستحقات علينا' : 'نقص مستحقات علينا'} {money(Math.abs(group.payable))}</span>}
        </div>
        <Status tone={status[1]}>{status[0]}</Status>
      </article>
    })}
  </div>
}

export function JournalDayTotals({ day }) {
  return <div className="journal-day-totals"><span>داخل للحسابات {money(day.incoming)}</span><span>خارج من الحسابات {money(day.outgoing)}</span></div>
}

export default function JournalSummary({ days }) {
  if (!days.length) return <p>لا توجد عمليات في الاختيار الحالي.</p>
  return <div className="daily-journals">{days.map(day => <section className="journal-summary-day" key={day.date}>
    <header><div><h3>{formatDate(day.date, { year: true })}</h3><span>{day.groups.length} قيود</span></div>
      <Link className="ts-btn ts-btn--quiet" to={'/daily-journal?date=' + day.date}><Printer className="ts-icon"/>ملخص اليوم وطباعته</Link>
    </header>
    <JournalSummaryRows groups={day.groups}/>
  </section>)}</div>
}
