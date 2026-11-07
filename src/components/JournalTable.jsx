import JournalEntryLink from './JournalEntryLink.jsx'
import { journalPostings } from '../lib/journalPostings.js'
import { formatNumber } from '../ui/format.js'
import './JournalTable.css'

const money = cents => cents ? <bdi className="ts-num">{formatNumber(cents / 100, 2)}</bdi> : '—'
const status = { approved: '', auto: '', pending: 'معلّق', cancelled: 'ملغى', modified: 'معدّل', rejected: 'مرفوض' }

export default function JournalTable({ groups, context = {}, printing = false, showReferences = true }) {
  const journals = groups.map(group => ({ group, ...journalPostings(group.rows, context) }))
  const debit = journals.reduce((n, j) => n + j.debit, 0), credit = journals.reduce((n, j) => n + j.credit, 0)
  const complete = journals.every(j => j.complete)
  return <div className="accounting-journal-wrap"><table className="accounting-journal" data-k="accounting-journal">
    <colgroup><col className="aj-account"/><col className="aj-description"/><col className="aj-amount"/><col className="aj-amount"/></colgroup>
    <thead><tr><th>الحساب</th><th>البيان</th><th className="aj-number">مدين</th><th className="aj-number">دائن</th></tr></thead>
    {journals.map(({ group, segments }) => <tbody key={group.key} data-journal={group.entry.journal_number || group.entry.id}>
      {showReferences && <tr className="aj-reference"><td colSpan={4}>{printing ? <bdi>{group.entry.journal_number || 'بدون رقم'}</bdi> : <JournalEntryLink entry={group.entry}/>}{group.branch && <span> · {group.branch}</span>}{status[group.status] && <span> · {status[group.status]}</span>}</td></tr>}
      {segments.map(({ row, lines, issues, cancelled }) => <Rows key={row.id} row={row} lines={lines} issues={issues} cancelled={cancelled} showStatus={!showReferences || group.status !== row.status}/>)}
    </tbody>)}
    <tfoot><tr><th colSpan={2}>الإجمالي — المعتمد</th><td className="aj-number" data-k="posting-debit">{money(debit)}</td><td className="aj-number" data-k="posting-credit">{money(credit)}</td></tr>
      {!complete && <tr><td colSpan={4} className="aj-incomplete">العرض غير مكتمل؛ راجع العمليات المشار إليها.</td></tr>}
    </tfoot>
  </table></div>
}
function Rows({ row, lines, issues, cancelled, showStatus }) {
  if (cancelled) return <tr className="aj-cancelled" data-entry-id={row.id}><td colSpan={4}>ملغى — {row.type || 'حركة مالية'}</td></tr>
  return <>{showStatus && status[row.status] && <tr className="aj-reference"><td colSpan={4}>{status[row.status]}</td></tr>}{lines.map((l, i) => <tr key={i} data-entry-id={row.id} className={i === 0 ? 'aj-first' : ''}>
    <td>{l.account}<small className="aj-mobile-description">{l.description}</small></td>{i === 0 && <td className="aj-description-cell" rowSpan={lines.length}>{lines.find(line => line.description)?.description || '—'}</td>}<td className="aj-number">{money(l.debit)}</td><td className="aj-number">{money(l.credit)}</td>
  </tr>)}{issues.length > 0 && <tr data-entry-id={row.id} className="aj-issue"><td colSpan={4}>{issues.join(' · ')}</td></tr>}</>
}
