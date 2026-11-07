import { Link, useLocation } from 'react-router-dom'
import { journalDetailHref } from '../lib/journalDetail.js'

export default function JournalEntryLink({ entry, children }) {
  const location = useLocation()
  return <Link className="journal-entry-link" to={journalDetailHref(entry)}
    state={{ returnTo: location.pathname + location.search }} aria-label={`عرض القيد ${entry.journal_number || ''}`.trim()}>
    {children || entry.journal_number || 'عرض القيد'}
  </Link>
}
