import React, { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { customerSummary, hasMovements, invoiceView, PAY_STATUS, OPENING } from '../lib/ledger.js'
import { displayWhatsapp } from '../lib/whatsapp.js'
import { Badge, Button, Card, Empty, Money, Notice, NAVY } from '../components/ui.jsx'
import CustomerForm from '../components/CustomerForm.jsx'
import InvoiceActions from '../components/InvoiceActions.jsx'
import Statement from '../components/Statement.jsx'

const TABS = [['invoices', 'الفواتير'], ['payments', 'الدفعات'], ['statement', 'كشف الحساب']]

export default function CustomerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { state, dispatch } = useStore()
  const [tab, setTab] = useState('invoices')
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState(null)

  const customer = state.customers.find(c => c.id === id)
  const summary = useMemo(() => customer && customerSummary(state, customer.id), [state, customer])
  const invoices = useMemo(() => state.invoices.filter(i => i.customerId === id).map(i => invoiceView(state, i))
    .sort((a, b) => b.date.localeCompare(a.date) || b.approvedSeq - a.approvedSeq), [state, id])
  const payments = useMemo(() => state.payments.filter(p => p.customerId === id)
    .sort((a, b) => b.date.localeCompare(a.date) || b.approvedSeq - a.approvedSeq), [state, id])
  const pendingDocs = state.documents.filter(d => d.status === 'pending' && d.fields?.customerId === id)

  if (!customer) {
    return <Card className="p-6 text-center">العميل غير موجود — <Link to="/customers" className="underline">العودة للعملاء</Link></Card>
  }

  const canDelete = !hasMovements(state, customer.id)
  const accountName = accId => state.accounts.find(a => a.id === accId)?.name || '—'
  const targetLabel = t => t === OPENING ? 'رصيد افتتاحي' : `فاتورة ${state.invoices.find(i => i.id === t)?.number || ''}`

  function toggleArchive() {
    const r = dispatch({ type: 'CUSTOMER_ARCHIVE', id: customer.id, archived: !customer.archived })
    setMessage(r.error ? { tone: 'error', text: r.error } : { tone: 'success', text: customer.archived ? 'أُعيد العميل للنشطين' : 'أُرشف العميل — تبقى حركاته محفوظة' })
  }

  function remove() {
    if (!confirm(`حذف ${customer.name}؟`)) return
    const r = dispatch({ type: 'CUSTOMER_DELETE', id: customer.id })
    if (r.error) return setMessage({ tone: 'error', text: r.error })
    navigate('/customers')
  }

  return (
    <div>
      <div className="no-print">
        <Link to="/customers" className="text-sm font-bold" style={{ color: '#4A9E97' }}>→ العملاء</Link>

        <Card className="p-4 mt-2 mb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold flex items-center gap-2" style={{ color: NAVY }}>
                {customer.name} {customer.archived && <Badge>مؤرشف</Badge>}
              </h1>
              <div className="text-sm mt-1" style={{ color: '#5A7A8A' }}>
                واتساب: {customer.whatsapp ? <span className="num">{displayWhatsapp(customer.whatsapp)}</span> : <span>غير مسجّل</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button variant="secondary" className="!py-2" onClick={() => setEditing(true)}>✏️ تعديل</Button>
              <Button variant="secondary" className="!py-2" onClick={toggleArchive}>{customer.archived ? 'إلغاء الأرشفة' : 'أرشفة'}</Button>
              {canDelete && <Button variant="danger" className="!py-2" onClick={remove}>حذف</Button>}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-4">
            <div className="rounded-xl p-2.5" style={{ background: '#F4F8F7' }}>
              <div className="text-[11px] font-bold" style={{ color: '#5A7A8A' }}>الفواتير</div>
              <Money value={summary.invoiced} strong className="text-sm" />
            </div>
            <div className="rounded-xl p-2.5" style={{ background: '#F4F8F7' }}>
              <div className="text-[11px] font-bold" style={{ color: '#5A7A8A' }}>المدفوع</div>
              <Money value={summary.paid} strong className="text-sm text-emerald-700" />
            </div>
            <div className="rounded-xl p-2.5" style={{ background: summary.credit ? '#F0FDF4' : '#FDECEC' }}>
              <div className="text-[11px] font-bold" style={{ color: '#5A7A8A' }}>{summary.credit ? 'رصيد دائن' : 'الرصيد المستحق'}</div>
              <Money value={summary.credit || summary.due} strong className={`text-sm ${summary.credit ? 'text-emerald-700' : 'text-red-600'}`} />
            </div>
          </div>
          {summary.opening > 0 && (
            <div className="text-[11px] mt-2" style={{ color: '#92400E' }}>
              يشمل رصيداً افتتاحياً تجريبياً <Money value={summary.opening} /> بتاريخ <span className="num">{customer.openingDate}</span> — ليس مبيعات
            </div>
          )}
          {!canDelete && <div className="text-[11px] mt-1" style={{ color: '#8FAAAA' }}>لا يمكن حذف عميل لديه حركات — يمكن أرشفته</div>}
        </Card>

        {message && <Notice tone={message.tone} className="mb-3">{message.text}</Notice>}
        {pendingDocs.length > 0 && (
          <Link to="/documents"><Notice tone="warning" className="mb-3">{pendingDocs.length} مستند لهذا العميل بانتظار المراجعة — لا يدخل في الرصيد بعد</Notice></Link>
        )}

        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl mb-3" style={{ background: '#EEF4F3' }}>
          {TABS.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className="py-2 rounded-lg text-sm font-bold"
              style={tab === k ? { background: '#fff', color: NAVY, boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : { color: '#5A7A8A' }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'invoices' && (
        <div className="space-y-2">
          {invoices.length === 0 && <Card><Empty>لا فواتير معتمدة</Empty></Card>}
          {invoices.map(inv => (
            <Card key={inv.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold num text-right" style={{ color: NAVY }}>{inv.number}</div>
                  <div className="text-xs num text-right" style={{ color: '#8FAAAA' }}>{inv.date}</div>
                </div>
                <div className="text-left">
                  <Money value={inv.total} strong />
                  <div className="mt-1"><Badge tone={inv.payStatus}>{PAY_STATUS[inv.payStatus]}</Badge></div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs mt-2" style={{ color: '#5A7A8A' }}>
                <div>الصافي<br /><Money value={inv.net} /></div>
                <div>الضريبة<br /><Money value={inv.vat} /></div>
                <div>المتبقي<br /><Money value={inv.remaining} strong className={inv.remaining ? 'text-red-600' : 'text-emerald-700'} /></div>
              </div>
              <div className="mt-3"><InvoiceActions invoice={inv} customer={customer} /></div>
            </Card>
          ))}
        </div>
      )}

      {tab === 'payments' && (
        <div className="space-y-2">
          {payments.length === 0 && <Card><Empty>لا دفعات معتمدة</Empty></Card>}
          {payments.map(p => (
            <Card key={p.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold" style={{ color: NAVY }}>سداد إلى {accountName(p.accountId)}</div>
                  <div className="text-xs num text-right" style={{ color: '#8FAAAA' }}>{p.date}{p.reference ? ` — ${p.reference}` : ''}</div>
                </div>
                <Money value={p.amount} strong className="text-emerald-700" />
              </div>
              <div className="mt-2 space-y-1 text-xs" style={{ color: '#5A7A8A' }}>
                {p.allocations.map(a => (
                  <div key={a.target} className="flex justify-between"><span>{targetLabel(a.target)}</span><Money value={a.amount} /></div>
                ))}
                {p.unallocated > 0 && (
                  <div className="flex justify-between font-bold text-emerald-700"><span>غير موزع — رصيد دائن</span><Money value={p.unallocated} /></div>
                )}
              </div>
              {state.documents.find(d => d.id === p.docId) && (
                <Link to={`/documents/${p.docId}`} className="inline-block mt-2 text-xs font-bold underline" style={{ color: '#4A9E97' }}>عرض إثبات السداد</Link>
              )}
            </Card>
          ))}
        </div>
      )}

      {tab === 'statement' && <Statement customer={customer} />}

      <CustomerForm open={editing} customer={customer} onClose={() => setEditing(false)}
        onSaved={() => setMessage({ tone: 'success', text: 'حُفظت بيانات العميل' })} />
    </div>
  )
}
