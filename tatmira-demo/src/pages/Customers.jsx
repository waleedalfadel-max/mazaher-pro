import React, { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { customerSummary } from '../lib/ledger.js'
import { displayWhatsapp } from '../lib/whatsapp.js'
import { Badge, Button, Card, Empty, Money, PageTitle, TextInput, NAVY } from '../components/ui.jsx'
import CustomerForm from '../components/CustomerForm.jsx'
import { can } from '../lib/permissions.js'

export default function Customers() {
  const { state, actor } = useStore()
  const financials = can(actor, 'viewFinancials') || can(actor, 'review')
  const canManage = can(actor, 'manageCustomers')
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [adding, setAdding] = useState(false)

  const rows = useMemo(() => state.customers
    .filter(c => showArchived ? c.archived : !c.archived)
    .filter(c => {
      const term = q.trim()
      const digits = term.replace(/\D/g, '')
      return !term || c.name.includes(term) || (digits !== '' && (c.whatsapp || '').includes(digits))
    })
    .map(c => ({ c, s: financials ? customerSummary(state, c.id) : null })), [state, q, showArchived, financials])

  const archivedCount = state.customers.filter(c => c.archived).length
  const customerLabel = state.lab.customerLabel || 'عميل'

  return (
    <div>
      <PageTitle title="العملاء" subtitle={financials ? `${customerLabel} يشتري بالآجل ويظهر له كشف حساب` : 'بيانات العملاء وأرقام التواصل'}
        action={canManage ? <Button onClick={() => setAdding(true)}>+ عميل</Button> : null} />

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <TextInput value={q} onChange={e => setQ(e.target.value)} placeholder="ابحث بالاسم أو الرقم" />
        <div className="flex gap-1.5 shrink-0">
          {[['نشطون', false], [`مؤرشفون (${archivedCount})`, true]].map(([label, v]) => (
            <button key={label} onClick={() => setShowArchived(v)}
              className="px-3 py-2 rounded-xl text-xs font-bold border"
              style={showArchived === v ? { background: NAVY, color: '#fff', borderColor: NAVY } : { background: '#fff', color: NAVY, borderColor: '#D4E8E6' }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <Card className="divide-y divide-border overflow-hidden">
        {rows.length === 0 && <Empty>لا يوجد عملاء</Empty>}
        {rows.map(({ c, s }) => (
          <Link key={c.id} to={`/customers/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface active:bg-surface-2">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-lg" style={{ background: '#E8F5F4' }}>🏪</div>
            <div className="flex-1 min-w-0">
              <div className="font-bold truncate" style={{ color: NAVY }}>{c.name}</div>
              <div className="text-xs mt-0.5 truncate" style={{ color: '#8FAAAA' }}>
                {c.whatsapp ? <span className="num">{displayWhatsapp(c.whatsapp)}</span> : 'لا يوجد رقم واتساب'}
              </div>
            </div>
            {financials && <div className="text-left shrink-0">
              {s.credit > 0
                ? <><Money value={s.credit} strong className="text-emerald-700" /><div className="text-[11px] text-emerald-700">رصيد دائن</div></>
                : <><Money value={s.balance} strong className={s.balance > 0 ? 'text-red-600' : ''} /><div className="text-[11px]" style={{ color: '#8FAAAA' }}>{s.balance > 0 ? 'مستحق' : 'لا مستحقات'}</div></>}
            </div>}
            {c.archived && <Badge>مؤرشف</Badge>}
          </Link>
        ))}
      </Card>

      <CustomerForm open={adding} onClose={() => setAdding(false)} onSaved={id => navigate(`/customers/${id}`)} />
    </div>
  )
}
