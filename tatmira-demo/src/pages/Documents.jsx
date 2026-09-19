import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { DOC_KINDS, REVIEW_STATUS, purchaseTotals, saleTotals } from '../lib/ledger.js'
import { can, documentsFor, findEmployee, isOwner } from '../lib/permissions.js'
import { Badge, Button, Card, Empty, Money, PageTitle, NAVY } from '../components/ui.jsx'

const FILTERS = [['pending', 'بانتظار المراجعة'], ['approved', 'معتمدة'], ['rejected', 'مرفوضة']]
const ICON = { sale: '🧾', payment: '💸', purchase: '📑' }

function docAmount(d) {
  if (d.kind === 'sale') return saleTotals(d.fields).total
  if (d.kind === 'payment') return d.fields.amount || 0
  return purchaseTotals(d.fields).total
}

export default function Documents() {
  const { state, actor, remote } = useStore()
  const owner = isOwner(actor)
  const reviewer = can(actor, 'review')
  const financials = can(actor, 'viewFinancials')
  const canUpload = ['sale', 'payment', 'purchase'].some(kind => can(actor, 'upload', kind))
  const canSeeAmounts = owner || reviewer || financials
  const [filter, setFilter] = useState(reviewer || !financials ? 'pending' : 'approved')
  const visible = documentsFor(state, actor)
  const docs = visible.filter(d => d.status === filter)
  const count = s => visible.filter(d => d.status === s).length
  const customerName = id => state.customers.find(c => c.id === id)?.name

  return (
    <div>
      <PageTitle
        title={reviewer ? 'المستندات والمراجعة' : financials ? 'المستندات المعتمدة' : 'مستنداتي'}
        subtitle={reviewer ? 'لا يدخل أي مستند في الأرقام قبل اعتماده' : financials ? 'مستندات معتمدة تدعم الأرقام والتقارير' : 'حالة المستندات التي رفعتها — يراجعها صاحب الصلاحية ويعتمدها'}
        action={canUpload ? <Link to="/upload"><Button>+ رفع</Button></Link> : null} />

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
                {!remote && owner && d.sample && d.status === 'pending' && <Badge tone="sample">بيانات تجريبية</Badge>}
              </div>
              <div className="text-xs truncate mt-0.5" style={{ color: '#8FAAAA' }}>
                {d.kind === 'purchase' ? (d.fields.payee || 'بدون جهة') : (customerName(d.fields.customerId) || 'العميل غير محدد')}
                {canSeeAmounts && d.fields.number ? ` — ${d.fields.number}` : ''} — {d.file.name}
                {reviewer && d.uploadedBy && d.uploadedBy !== actor.id && ` — رفعه: ${d.uploaderName || findEmployee(state, d.uploadedBy)?.name || 'موظف'}`}
              </div>
            </div>
            {/* الموظف المحدود لا يرى المبالغ */}
            {canSeeAmounts && <Money value={docAmount(d)} strong className="text-sm" />}
          </Link>
        ))}
      </Card>
    </div>
  )
}
