import React, { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Banknote, CircleAlert, FileSearch, FileText, Receipt, ShoppingBasket, TriangleAlert, Upload } from 'lucide-react'
import { Button, Chip, DateInput, EmptyState, Money, Panel, SearchBox, Select, Status, Tabs } from '../../ui/components.jsx'
import { formatAgo, formatDate, plural } from '../../ui/format.js'
import { useStore } from '../store.jsx'
import { useSheets } from '../Shell.jsx'
import { DATE_FILTERS, KINDS, STATUSES, TODAY, docTotals, filterDocuments, reviewAlerts } from '../model.js'

const PAGE = 20
const KIND_ICON = { purchase: ShoppingBasket, expense: Receipt, sales: Banknote }
const STATUS_TABS = [
  { value: 'all', label: 'الكل' },
  { value: 'pending', label: 'للمراجعة' },
  { value: 'reading', label: 'قيد القراءة' },
  { value: 'approved', label: 'معتمد' },
  { value: 'rejected', label: 'مرفوض' },
]

export function DocStatus({ status }) {
  const s = STATUSES[status]
  return <Status tone={s.tone} busy={s.busy}>{s.label}</Status>
}

function AlertCount({ alerts }) {
  const shown = alerts.filter(a => a.type !== 'machine')
  if (!shown.length) return null
  const error = shown.some(a => a.tone === 'error')
  return (
    <span className={`rp-alert-count${error ? ' rp-alert-count--error' : ''}`} title={shown.map(a => a.title).join('، ')}>
      {error ? <CircleAlert className="ts-icon--sm" aria-hidden="true" /> : <TriangleAlert className="ts-icon--sm" aria-hidden="true" />}
      {shown.length === 1 ? shown[0].title : `${shown.length} تنبيهات`}
    </span>
  )
}

const amountOf = (d, totals) => (d.status === 'reading' || (!totals.total && totals.printed == null) ? null : totals.printed ?? totals.total)
/** المبلغ كما هو معروف؛ شرطة فقط إن لم يُعرف. المرفوض لا يدخل الإجماليات المعتمدة. */
function Amount({ d, totals }) {
  const value = amountOf(d, totals)
  if (value == null) return <span className="ts-muted" title="المبلغ غير معروف">—</span>
  if (d.status !== 'rejected') return <Money value={value} />
  return <span className="rp-amount-out"><Money value={value} /><small>لا يدخل الإجماليات</small></span>
}
const partyOf = d => (d.status === 'reading' ? 'مستند جديد' : d.party || 'جهة غير مقروءة')

export default function Documents() {
  const { state } = useStore()
  const { openUpload } = useSheets()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  // عدد المعروض في العنوان: الرجوع من مستند يعيد القائمة نفسها وموضعها
  const limit = Math.max(PAGE, Number(params.get('n')) || PAGE)
  const setLimit = fn => { const next = new URLSearchParams(params); const n = typeof fn === 'function' ? fn(limit) : fn; if (n > PAGE) next.set('n', n); else next.delete('n'); setParams(next, { replace: true }) }
  const filters = {
    q: params.get('q') || '', status: params.get('status') || 'all', kind: params.get('kind') || 'all',
    date: params.get('date') || 'all', from: params.get('from') || '', to: params.get('to') || '',
  }
  const set = (key, value) => {
    const next = new URLSearchParams(params)
    if (!value || value === 'all') next.delete(key); else next.set(key, value)
    next.delete('n')
    setParams(next, { replace: true })
  }
  const { rows, counts } = useMemo(() => filterDocuments(state.documents, filters, TODAY), [state, params])
  const withAlerts = useMemo(() => rows.slice(0, limit).map(d => ({ doc: d, totals: docTotals(d), alerts: d.status === 'pending' ? reviewAlerts(d, state) : [] })), [rows, limit, state])
  const filtered = filters.q || filters.kind !== 'all' || filters.date !== 'all' || filters.status !== 'all'

  return (
    <div>
      <div className="ts-heading">
        <div>
          <h1>المستندات</h1>
          <p>كل ما رُفع من فواتير ومصروفات وتقارير إغلاق، وحالة مراجعته.</p>
        </div>
        <div className="ts-heading-actions"><Button variant="primary" icon={Upload} onClick={openUpload}>رفع مستند</Button></div>
      </div>

      <Panel clip>
        <div className="rp-toolbar">
          <Tabs label="حالة المستند" value={filters.status} onChange={v => set('status', v)}
            tabs={STATUS_TABS.map(t => ({ ...t, count: counts[t.value] }))} />
          <div className="rp-filters">
            <SearchBox label="بحث في المستندات" value={filters.q} onChange={v => set('q', v)} placeholder="المورد، رقم الفاتورة، المبلغ…" />
            <Select aria-label="نوع المستند" value={filters.kind} onChange={e => set('kind', e.target.value)}
              options={[{ value: 'all', label: 'كل الأنواع' }, ...Object.entries(KINDS).map(([value, k]) => ({ value, label: k.label }))]} />
            <Select aria-label="التاريخ" value={filters.date} onChange={e => set('date', e.target.value)} options={DATE_FILTERS} />
            {filters.date === 'custom' && (
              <div className="rp-date-custom">
                <DateInput aria-label="من تاريخ" value={filters.from} max={TODAY} onChange={v => set('from', v)} />
                <span>إلى</span>
                <DateInput aria-label="إلى تاريخ" value={filters.to} max={TODAY} onChange={v => set('to', v)} />
              </div>
            )}
          </div>
          <div className="rp-results" aria-live="polite">
            <span><strong className="ts-num">{rows.length}</strong> {rows.length === 1 ? 'نتيجة' : rows.length === 2 ? 'نتيجتان' : rows.length <= 10 ? 'نتائج' : 'نتيجة'}</span>
            {filtered && <Button variant="quiet" size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>مسح الفلاتر</Button>}
            <span className="rp-vat-note">المبالغ شاملة الضريبة</span>
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={FileSearch}>لا مستندات تطابق البحث والفلاتر.</EmptyState>
        ) : (
          <>
            <table className="ts-table rp-table">
              <thead>
                <tr>
                  <th>المستند</th><th>النوع</th><th>تاريخ المستند</th><th className="ts-end">الإجمالي</th><th>الحالة</th><th>رفعه</th><th>تنبيهات</th>
                </tr>
              </thead>
              <tbody>
                {withAlerts.map(({ doc: d, totals, alerts }) => {
                  const Icon = KIND_ICON[d.kind] || FileText
                  const open = () => navigate(`/documents/${d.id}`)
                  return (
                    <tr key={d.id} className="is-link" onClick={open}>
                      <td>
                        <div className="rp-doc-main">
                          <span className="rp-doc-icon"><Icon className="ts-icon" aria-hidden="true" /></span>
                          <div>
                            <Link to={`/documents/${d.id}`} onClick={e => e.stopPropagation()} style={{ textDecoration: 'none' }}><strong>{partyOf(d)}</strong></Link>
                            <small>مستند <span className="ts-num">{d.seq}</span>{d.invoiceNo ? <> · رقم <span className="ts-num">{d.invoiceNo}</span></> : ''}</small>
                          </div>
                        </div>
                      </td>
                      <td>{d.status === 'reading' ? <span className="ts-muted">—</span> : <Chip>{KINDS[d.kind].label}</Chip>}</td>
                      <td>{d.invoiceDate ? formatDate(d.invoiceDate) : <span className="ts-muted">—</span>}</td>
                      <td className="ts-end"><Amount d={d} totals={totals} /></td>
                      <td><DocStatus status={d.status} /></td>
                      <td><span>{d.uploadedBy.split(' (')[0]}</span><small>{formatAgo(d.uploadedAt, TODAY)}</small></td>
                      <td><AlertCount alerts={alerts} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <ul className="rp-cards">
              {withAlerts.map(({ doc: d, totals, alerts }) => (
                <li key={d.id}>
                  <Link className="rp-card" to={`/documents/${d.id}`}>
                    <div className="rp-card-top"><strong>{partyOf(d)}</strong><DocStatus status={d.status} /></div>
                    <div className="rp-card-meta">
                      {d.status !== 'reading' && <Chip>{KINDS[d.kind].label}</Chip>}
                      {d.invoiceDate && <span>{formatDate(d.invoiceDate)}</span>}
                      {d.invoiceNo && <span>رقم <span className="ts-num">{d.invoiceNo}</span></span>}
                    </div>
                    <div className="rp-card-bottom">
                      {d.status === 'reading' ? <span className="ts-muted">تُقرأ بياناته الآن</span> : <Amount d={d} totals={totals} />}
                      <AlertCount alerts={alerts} />
                    </div>
                    <div className="rp-card-meta">رفعه {d.uploadedBy.split(' (')[0]} · {formatAgo(d.uploadedAt, TODAY)}</div>
                  </Link>
                </li>
              ))}
            </ul>

            <div className="rp-table-foot">
              <span>عرض <span className="ts-num">{Math.min(limit, rows.length)}</span> من <span className="ts-num">{rows.length}</span></span>
              {rows.length > limit && <Button size="sm" onClick={() => setLimit(l => l + PAGE)}>عرض المزيد</Button>}
            </div>
          </>
        )}
      </Panel>
      <p className="ts-field-hint" style={{ marginTop: 10 }}>{plural(counts.pending, 'مستند واحد', 'مستندان', 'مستندات', 'مستندًا')} بانتظار المراجعة ضمن الفلاتر الحالية.</p>
    </div>
  )
}
