import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { usesSimplifiedHome } from '../lib/businessPresentation.js'
import { Segment } from '../ui/components.jsx'
import Accounts from './Accounts.jsx'
import JournalLedger from './JournalLedger.jsx'

// Keep the established routes and their authorization, deep links and account filters.
// This combines navigation only; each view retains its existing accounting rules.
export default function FinancialRecord({ view }) {
  const { projectName } = useAuth()
  const location = useLocation(), navigate = useNavigate()
  const combined = usesSimplifiedHome(projectName)
  const content = view === 'accounts' ? <Accounts embedded={combined} /> : <JournalLedger unified embedded={combined} />
  if (!combined) return content
  const statementSearch = view === 'accounts' ? location.search : location.state?.statementSearch || ''
  function changeView(next) {
    if (next === view) return
    navigate({ pathname: next === 'accounts' ? '/accounts' : '/operations', search: next === 'accounts' ? statementSearch : '' },
      { state: { statementSearch } })
  }
  return <div data-k="financial-record">
    <div className="ts-heading">
      <h1>السجل المالي</h1>
      <Segment label="عرض السجل المالي" value={view} onChange={changeView}
        options={[{ value: 'operations', label: 'العمليات' }, { value: 'accounts', label: 'كشف حساب' }]} />
    </div>
    {content}
  </div>
}
