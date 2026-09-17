import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { DOC_KINDS, REVIEW_STATUS, saleTotals } from '../lib/ledger.js'
import { Badge, Button, Card, Empty, Money, PageTitle, NAVY } from '../components/ui.jsx'

const FILTERS = [['pending', 'بانتظار المراجعة'], ['approved', 'معتمدة'], ['rejected', 'مرفوضة']]
const ICON = { sale: '🧾', payment: '💸', purchase: '🛒' }

function docAmount(d) {
  if (d.kind === 'sale') return saleTotals(d.fields).total
  if (d.kind === 'payment') return d.fields.amount || 0
  return (d.fields.net || 0) + (d.fields.vat || 0)
}

export default function Documents() {
  const { state } = useStore()
  const [filter, setFilter] = useState('pending')
  const docs = state.documents.filter(d => d.status === filter)
  const count = s => state.documents.filter(d => d.status === s).length
  const customerName = id => state.customers.find(c => c.id === id)?.name

  return (
    <div>
      <PageTitle title="المستندات والمراجعة" subtitle="لا يدخل أي مستند في الأرقام قبل اعتماده"
        action={<Link to="/upload"><Button>+ رفع</Button></Link>} />

      <div className="grid grid-cols-3 gap-1 p-1 rounded-xl mb-3" style={{ background: '#EEF4F3' }}>
        {FILTERS.map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className="py-2 rounded-lg text-xs sm:text-sm font-bold"
            style={filter === k ? { background: '#fff', color: NAVY, boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : { color: '#5A7A8A' }}>
            {label} ({count(k)})
          </button>
        ))}
      </div>

      <Card className="divide-y divide-border overflow-hidden">
        {docs.length === 0 && <Empty>لا مستندات</Empty>}
        {docs.map(d => (
          <Link key={d.id} to={`/documents/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface">
            <span className="text-2xl">{ICON[d.kind]}</span>
            <div className="flex-1 min-w-0">
              <div className="font-bold flex flex-wrap items-center gap-1.5" style={{ color: NAVY }}>
                {DOC_KINDS[d.kind]}
                <Badge tone={d.status}>{REVIEW_STATUS[d.status]}</Badge>
                {d.sample && d.status === 'pending' && <Badge tone="sample">بيانات تجريبية</Badge>}
              </div>
              <div className="text-xs truncate mt-0.5" style={{ color: '#8FAAAA' }}>
                {d.kind === 'purchase' ? d.fields.supplier : (customerName(d.fields.customerId) || 'العميل غير محدد')}
                {d.fields.number ? ` — ${d.fields.number}` : ''} — {d.file.name}
              </div>
            </div>
            <Money value={docAmount(d)} strong className="text-sm" />
          </Link>
        ))}
      </Card>
    </div>
  )
}
