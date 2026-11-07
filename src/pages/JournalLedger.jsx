import { groupCreditInvoices } from '../lib/creditInvoicePresentation.js'
import CreditInvoiceSummary from '../components/CreditInvoiceSummary.jsx'
import EntryDescription from '../components/EntryDescription.jsx'
import JournalEntryLink from '../components/JournalEntryLink.jsx'
import JournalSummary from '../components/JournalSummary.jsx'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ExternalLink, FileText, Info, NotebookText, Paperclip, PencilLine, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { uploadToStorage, getSignedUrl } from '../lib/storage'
import { loadAttachmentCounts, loadPeriodEntries } from '../lib/journalEntries.js'
import { deleteSupplierPayment, isSupplierPaymentType } from '../lib/supplierPayments'
import { Button, DateInput, Dialog, EmptyState, Field, IconButton, Panel, SearchBox, Segment, Select, Status } from '../ui/components.jsx'
import { statementAccountOptions, accountMovement } from '../lib/accountStatement.js'
import { journalSummaries, summaryDays, summaryMovement } from '../lib/journalSummary.js'
import { isCounted } from '../lib/financeRules.js'
import { loadJournalAccounts } from '../lib/journalAccounts.js'
import { canEditLedger } from '../lib/adminAccess.js'
import { formatDate, formatNumber } from '../ui/format.js'

// العرض الموحد جدول مدين/دائن من الأثر والتصنيف المسجلين، والتفاصيل عند الطلب.
// عرض حركات الحسابات يبقى داخل/خارج؛ لا يُخلط بالمبالغ المحاسبية. الإجماليات للمعتمد والتلقائي.
// التجميع للعرض والطباعة بلا إنشاء قيود. الطرف المجهول ظاهر للمراجعة، وفشل التحميل لا يعرض نتائج جزئية.

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const STATUS_TONE = { approved: 'success', auto: 'info', pending: 'warning', cancelled: 'danger', modified: 'neutral' }
const STATUS_LABEL = {
  approved: 'معتمد', auto: 'تلقائي', pending: 'معلق', cancelled: 'ملغي', modified: 'معدَّل',
}
const QUICK_PERIODS = [
  { value: 'month',     label: 'الشهر الحالي' },
  { value: 'lastMonth', label: 'الشهر الماضي' },
  { value: 'year',      label: 'السنة الحالية' },
  { value: 'custom',    label: 'فترة أخرى' },
]
const COLUMNS = 'id,date,type,description,cash_in,bank_in,custody_in,cash_out,bank_out,custody_out,total_amount,status,journal_number,created_at,file_url,document_id,bank_account_id,receivable_in,receivable_out,project_id,document_invoice_id,supplier_id,payable_in,payable_out,vat_amount,category_main,category_sub,branch,financial_class,output_vat_amount'
const ROLE_AR = { owner: 'المالك', accountant: 'المحاسب', purchasing: 'مسؤول المشتريات', cashier: 'الكاشير', superadmin: 'إدارة تحسيب' }

function getRange(type) {
  const n = new Date()
  let from, to = fmtDate(n)
  if (type === 'month') from = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`
  else if (type === 'lastMonth') {
    const lm = new Date(n.getFullYear(), n.getMonth() - 1, 1)
    const lme = new Date(n.getFullYear(), n.getMonth(), 0)
    from = fmtDate(lm); to = fmtDate(lme)
  } else { from = `${n.getFullYear()}-01-01` }
  return { from, to }
}

const reason = error => (/failed to fetch|network|load failed/i.test(error?.message || '') ? 'تعذّر الاتصال بالخادم؛ تحقق من الاتصال ثم أعد المحاولة.' : (error?.message || 'خطأ غير معروف'))
const cleanLabel = s => String(s || '').replace(/^[^\p{L}\p{N}]+/u, '').trim() || String(s || '')
const fmt = v => (v ? formatNumber(v, 2) : '—')
const debitOf  = r => (r.cash_in  || 0) + (r.bank_in  || 0) + (r.custody_in  || 0)
const creditOf = r => (r.cash_out || 0) + (r.bank_out || 0) + (r.custody_out || 0)

// يفتح الملف برابط موقَّع مؤقت (كما كان: نافذة تُفتح فورًا ثم يوضع الرابط فيها)
async function openFile(fileUrl) {
  const win = window.open('', '_blank')
  const url = await getSignedUrl(fileUrl)
  if (win) { if (url) win.location.href = url; else win.close() }
}

// ── المرفقات الإضافية للقيد (عرض ورفع وحذف) ─────────────────────────
function AttachDialog({ entry, projectId, role, onClose, onChanged, readOnly = false }) {
  const [attachments, setAttachments] = useState(null)
  const [uploading, setUploading]     = useState(false)
  const [error, setError]             = useState('')
  const fileRef = useRef()

  useEffect(() => { loadAttachments() }, [])

  async function loadAttachments() {
    if (!entry.journal_number) return
    const { data, error: e } = await supabase
      .from('attachments')
      .select('id,file_name,file_url,uploaded_by,uploaded_at')
      .eq('journal_number', entry.journal_number)
      .eq('project_id', projectId)
      .order('uploaded_at')
    if (e) { setError('تعذّر تحميل المرفقات: ' + reason(e)); return }
    setAttachments(data || [])
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file || readOnly) return
    setUploading(true); setError('')
    try {
      const fileUrl = await uploadToStorage(file, projectId)
      const { error: insErr } = await supabase.from('attachments').insert({
        project_id:     projectId,
        journal_number: entry.journal_number,
        file_url:       fileUrl,
        file_name:      file.name,
        uploaded_by:    role,
      })
      if (insErr) throw insErr
      await loadAttachments()
      onChanged()
    } catch (err) { setError('تعذّر رفع المرفق: ' + reason(err)) }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleDelete(id) {
    if (readOnly) return
    setError('')
    const { error: delErr } = await supabase.from('attachments').delete().eq('id', id)
    if (delErr) { setError('تعذّر حذف المرفق: ' + reason(delErr)); return }
    await loadAttachments()
    onChanged()
  }

  const day = d => (d ? new Date(d).toLocaleDateString('en-GB') : '')
  return (
    <Dialog open title="مرفقات القيد" description={`${entry.journal_number} — ${formatDate(entry.date, { year: true })}`} onClose={onClose}
      footer={<Button onClick={onClose}>إغلاق</Button>}>
      <div className="jrl-attach">
        {!readOnly && <label className={`ts-btn ts-btn--primary jrl-upload${uploading ? ' is-busy' : ''}`}>
          {uploading ? <RefreshCw className="ts-icon" aria-hidden="true" /> : <Upload className="ts-icon" aria-hidden="true" />}
          {uploading ? 'جارٍ الرفع…' : 'إضافة مرفق جديد'}
          <input ref={fileRef} type="file" className="ts-sr" accept="image/*,.pdf" onChange={handleUpload} disabled={uploading} />
        </label>}
        {error && <p className="ts-field-error" role="alert">{error}</p>}
        {attachments === null && !error && <p className="ts-field-hint" aria-busy="true">جارٍ تحميل المرفقات…</p>}
        {attachments && attachments.length === 0 && <EmptyState icon={Paperclip}>لا توجد مرفقات بعد.</EmptyState>}
        {attachments && attachments.length > 0 && (
          <ul className="jrl-attach-list" data-k="jl.attachments">
            {attachments.map(a => (
              <li key={a.id}>
                <FileText className="ts-icon" aria-hidden="true" />
                <div className="jrl-attach-name">
                  <strong>{a.file_name}</strong>
                  <span>{ROLE_AR[a.uploaded_by] || a.uploaded_by} — <span className="ts-num">{day(a.uploaded_at)}</span></span>
                </div>
                <Button size="sm" variant="quiet" icon={ExternalLink} onClick={() => openFile(a.file_url)}>فتح</Button>
                {!readOnly && ['owner', 'accountant', 'superadmin'].includes(role) && (
                  <Button size="sm" variant="quiet" className="jrl-del" icon={Trash2} onClick={() => handleDelete(a.id)}>حذف</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}

// ── الصفحة ──────────────────────────────────────────────────────────
export default function JournalLedger({ unified = false, embedded = false }) {
  const { projectId, sessionEpoch } = useAuth()
  return <JournalLedgerPage key={`${projectId}:${sessionEpoch}`} unified={unified} embedded={embedded}/>
}
function JournalLedgerPage({ unified, embedded }) {
  const { role, projectId, isSuperAdmin, viewState } = useAuth()
  const canEdit = unified ? canEditLedger(role, projectId, viewState) : role === 'accountant' || role === 'owner' || isSuperAdmin
  // قيد فاتورة معتمدة (اعتماد جديد): لا يُحذف من هنا، بل تُصحَّح الفاتورة كلها (CorrectInvoice.jsx). دفعات الموردين تبقى بمسارها.
  const navigate = useNavigate()
  const canCorrect = canEdit && (role === 'accountant' || isSuperAdmin)
  const docLocked = r => !!r?.document_invoice_id && !isSupplierPaymentType(r.type)
  const goCorrect = r => navigate(`/correct/${r.document_id}/${r.document_invoice_id}`)
  const [rows, setRows]                 = useState([])
  const [loading, setLoading]           = useState(true)
  const [loadError, setLoadError]       = useState('')
  const [filter, setFilter]             = useState(getRange('month'))
  const [activePeriod, setActivePeriod] = useState('month')
  const [search, setSearch]             = useState('')
  const [attachCounts, setAttachCounts] = useState({})   // journal_number → count
  const [modalEntry, setModalEntry]     = useState(null)
  const [deleting, setDeleting]         = useState(null)
  const [busy, setBusy]                 = useState(false)
  const [actionError, setActionError]   = useState('')
  const [banks, setBanks] = useState([])
  const [settings, setSettings] = useState({})
  const [suppliers, setSuppliers] = useState([])
  const [account, setAccount] = useState('all')
  const [entryType, setEntryType] = useState('')
  const [view, setView] = useState(unified ? 'days' : 'list')
  const loadSeq = useRef(0)

  useEffect(() => { setAccount('all'); setEntryType(''); setSearch(''); setModalEntry(null); setDeleting(null); setRows([]); setBanks([]); if (projectId) load(projectId, filter) }, [projectId])

  // القيود والمستندات والمرفقات كاملة؛ أي فشل ← رسالة بلا صفوف. نتيجة أقدم من آخر طلب تُهمل.
  async function load(pid, f) {
    const seq = ++loadSeq.current
    setLoading(true); setLoadError('')
    const pidOk = pid || projectId
    const entries = await loadPeriodEntries(supabase, { projectId: pidOk, from: f.from, to: f.to, columns: COLUMNS, dateAscending: true })
    const [counts, accounts] = entries.error ? [null, null] : await Promise.all([
      loadAttachmentCounts(supabase, { projectId: pidOk, journalNumbers: entries.data.map(r => r.journal_number) }),
      unified ? loadJournalAccounts(supabase, pidOk, entries.data) : Promise.resolve({ data: { banks: [], settings: {}, suppliers: [] }, error: null }),
    ])
    if (seq !== loadSeq.current) return
    const failed = entries.error ? entries : counts.error ? counts : accounts.error ? { error: accounts.error, part: 'الحسابات' } : null
    if (failed) { setRows([]); setAttachCounts({}); setLoadError(`${failed.part}: ${reason(failed.error)}`) }
    else { setRows(entries.data); setAttachCounts(counts.data); setBanks(accounts.data.banks); setSettings(accounts.data.settings); setSuppliers(accounts.data.suppliers) }
    setLoading(false)
  }

  // الحذف كما كان: حذف نهائي للصف بعد التأكيد. قيد «سداد مورد» يُحذف بدالة الخادم مع حركة المورد معًا (20261013120000)
  async function handleDelete(entry) {
    if (!canEdit || entry?._creditRows) return
    setBusy(true); setActionError('')
    let msg = null
    if (isSupplierPaymentType(entry.type)) msg = await deleteSupplierPayment(supabase, entry).catch(e => e?.message || 'خطأ غير معروف')
    else {
      const { error } = await supabase.from('ledger_entries').delete().eq('id', entry.id)
      if (error) msg = error.message || 'خطأ غير معروف'
    }
    setBusy(false)
    if (msg) { setActionError('فشل الحذف: ' + reason({ message: msg })); return }
    setDeleting(null)
    load(projectId, filter)
  }

  function choosePeriod(type) {
    setActivePeriod(type)
    if (type === 'custom') return
    const f = getRange(type); setFilter(f)
    if (projectId) load(projectId, f)
  }
  function setDate(key, iso) {
    setActivePeriod('custom')
    const f = { ...filter, [key]: iso }; setFilter(f); load(projectId, f)
  }



  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      const m = accountMovement(r, account, settings, banks)
      return (!unified || ((account === 'all' || m.incoming || m.outgoing) && (!entryType || r.type === entryType))) &&
        (!q || [r.description, r.type, r.journal_number, r.date].some(v => String(v || '').toLowerCase().includes(q)))
    })
  }, [rows, search, unified, account, entryType, settings, banks])
  const scopedMovement = r => summaryMovement(r, unified ? account : 'all', settings, banks)
  const shownDebit = r => scopedMovement(r).incoming / 100
  const shownCredit = r => scopedMovement(r).outgoing / 100
  const totals = useMemo(() => {
    const posted = (unified ? visibleRows : rows).filter(isCounted)
    return { debit: posted.reduce((s, r) => s + scopedMovement(r).incoming, 0) / 100,
      credit: posted.reduce((s, r) => s + scopedMovement(r).outgoing, 0) / 100 }
  }, [rows, visibleRows, unified, account, settings, banks])
  const displayRows = useMemo(() => unified ? groupCreditInvoices(visibleRows, rows) : visibleRows, [visibleRows, rows, unified])
  const creditPurchases = displayRows.filter(r => r._creditRows).reduce((n,r) => n + Math.round(r.payable_in * 100), 0) / 100
  const summaries = useMemo(() => {
    const selected = new Set(journalSummaries(visibleRows).map(g => g.key))
    // Selecting an account or matching a description must never remove the
    // counterpart of a journal in the accounting view.
    return journalSummaries(rows).filter(g => selected.has(g.key))
  }, [visibleRows, rows])
  const groups = useMemo(() => summaryDays(summaries), [summaries])

  const refYear = Number((filter.to || fmtDate(new Date())).slice(0, 4))
  const day = iso => (iso ? formatDate(iso, { refYear }) : '—')
  const rangeText = filter.from && filter.to
    ? (filter.from === filter.to ? formatDate(filter.from, { year: true }) : `${formatDate(filter.from, { year: filter.from.slice(0, 4) !== filter.to.slice(0, 4) })} – ${formatDate(filter.to, { year: true })}`)
    : 'كل التواريخ'
  const countText = unified ? `${summaries.length} قيود` : `${visibleRows.length} حركة${search && rows.length !== visibleRows.length ? ` (من ${rows.length})` : ''}`

  const rowView = rows.length ? displayRows : []
  const jnLabel = (r, idx) => r.journal_number || `#${idx + 1}`
  const canAttachOf = r => ['approved', 'auto'].includes(r.status) && r.journal_number
  const docButton = r => r.file_url
    ? <IconButton bare label={r._doc_name ? `فتح المستند: ${r._doc_name}` : 'فتح المستند'} icon={FileText} className="jrl-doc" onClick={() => openFile(r.file_url)} />
    : <span className="ldg-nil">—</span>
  const attButton = r => {
    const n = r.journal_number ? (attachCounts[r.journal_number] || 0) : 0
    return canAttachOf(r) && (canEdit || n > 0)
      ? <Button size="sm" variant={n > 0 ? 'primary' : 'quiet'} icon={n > 0 ? Paperclip : Plus} className="jrl-att" aria-label={n > 0 ? `المرفقات (${n})` : 'إضافة مرفق'} onClick={() => setModalEntry(r)}>{n > 0 ? <span className="ts-num">{n}</span> : null}</Button>
      : <span className="ldg-nil">—</span>
  }

  return (
    <div className="ldg-page jrl-page">
      <div className="ts-heading">
        <div>
          {embedded ? <h2>العمليات</h2> : <><h1>{unified ? 'سجل العمليات' : 'سجل الحركات اليومية'}</h1><Link className="ts-btn" to="/suspense">الفروقات</Link></>}
          <p className="ldg-showing">
            <CalendarDays className="ts-icon--sm" aria-hidden="true" />
            <span>{rangeText}</span>
            <span aria-hidden="true">·</span>
            <span data-k="jl.count">{loading || loadError ? '—' : countText}</span>
          </p>
        </div>
      </div>

      <Panel className="ldg-filters jx-filters" title="الفترة والبحث" icon={CalendarDays}>
        <div className="ts-panel-body ldg-filter-body">
          <Segment label="الفترة" value={activePeriod} onChange={choosePeriod} options={QUICK_PERIODS} />
          {unified && <div className="journal-extra-filters" role="group" aria-label="خيارات العرض والتصفية"><div className="ts-form-grid">
            <Field label="الحساب"><Select value={account} onChange={e => setAccount(e.target.value)} options={[{value:'all',label:'جميع الحسابات'}, ...statementAccountOptions(banks, settings)]} /></Field>
            <Field label="نوع العملية"><Select value={entryType} onChange={e => setEntryType(e.target.value)} options={[{value:'',label:'كل الأنواع'}, ...[...new Set(rows.map(r => r.type).filter(Boolean))].sort().map(v => ({value:v,label:cleanLabel(v)}))]} /></Field>
            <div className="ts-field"><span className="ts-field-label">طريقة العرض</span><Segment label="طريقة العرض" value={view} onChange={setView} options={[{value:'days',label:'قيود محاسبية'},{value:'list',label:'حركات الحسابات'}]} /></div>
          </div></div>}
          <div className="ldg-filter-row jx-filter-row">
            <Field label="من"><DateInput value={filter.from} onChange={iso => setDate('from', iso)} /></Field>
            <Field label="إلى"><DateInput value={filter.to} onChange={iso => setDate('to', iso)} /></Field>
            <div className="ts-field jx-search">
              <span className="ts-field-label">بحث بالبيان أو رقم القيد</span>
              <SearchBox label="بحث بالبيان أو رقم القيد" value={search} onChange={setSearch} placeholder="فاتورة كهرباء أو QD-..." />
            </div>
            <Button icon={RefreshCw} onClick={() => load(projectId, filter)} disabled={loading}>تحديث</Button>
          </div>
        </div>
      </Panel>

      {loading ? (
        <Panel><div className="ldg-loading" aria-busy="true">جارٍ تحميل الحركات…</div></Panel>
      ) : loadError ? (
        <div className="ts-note ts-note--error ldg-load-error" data-k="jl.loadError" role="alert">
          <Info className="ts-icon" aria-hidden="true" />
          <div className="ts-note-body">
            <strong>تعذّر تحميل حركات هذه الفترة كاملة، فلم تُعرض الحركات ولا الإجماليات.</strong>
            عرض جزء منها كأنه كامل يعطي إجماليات خاطئة. {loadError}
            <div className="ts-note-action"><Button size="sm" variant="primary" icon={RefreshCw} onClick={() => load(projectId, filter)}>إعادة المحاولة</Button></div>
          </div>
        </div>
      ) : (
        <>
          {(!unified || view === 'list') && <div className="jx-totals" data-k="jl.totals">
            <div><span>داخل للحسابات — المعتمد</span><strong className="ts-num is-in" data-k="jl.totalDebit">{fmt(totals.debit)}</strong></div>
            <div><span>خارج من الحسابات — المعتمد</span><strong className="ts-num is-out" data-k="jl.totalCredit">{fmt(totals.credit)}</strong></div>
            <div><span>{unified ? 'القيود المعروضة' : 'الحركات المعروضة'}</span><strong className="ts-num" data-k="jl.totalCount">{unified ? summaries.length : visibleRows.length}</strong></div>
          </div>}

          {unified && view === 'list' && creditPurchases > 0 && <div className="ts-note ts-note--info" data-k="credit-purchases-total">مشتريات آجلة معروضة: <strong className="ts-num">{fmt(creditPurchases)}</strong> · أُضيفت لمستحقات الموردين، ولا تدخل في الوارد والصادر النقدي أعلاه.</div>}
          {unified && view === 'days' && <JournalSummary days={groups} context={{ banks, settings, suppliers }}/>}
          {(!unified || view === 'list') && <>
          {/* الكمبيوتر */}
          <Panel className="ldg-table-panel" clip>
            <div className="ldg-scroll">
              <table className="ts-table ldg-table jrl-table" data-table="jl.rows">
                <thead>
                  <tr>
                    <th>رقم القيد</th><th>التاريخ</th><th>نوع الحركة</th><th>البيان</th>
                    <th className="ts-end">داخل</th><th className="ts-end">خارج</th><th>الحالة</th>
                    <th className="jrl-c">مستند</th><th className="jrl-c">مرفقات</th>
                    {canEdit && <th><span className="ts-sr">حذف</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {rowView.length === 0 && (
                    <tr><td colSpan={canEdit ? 10 : 9}><EmptyState icon={NotebookText}>{search ? 'لا توجد نتائج للبحث.' : 'لا توجد قيود في هذه الفترة.'}</EmptyState></td></tr>
                  )}
                  {rowView.map((r, idx) => (
                    <tr key={r.id} data-id={r.id}>
                      <td data-k="jn" className="jrl-jn ts-num"><JournalEntryLink entry={r}>{jnLabel(r, idx)}</JournalEntryLink></td>
                      <td data-k="date" data-iso={r.date || ''} className="ldg-date">{day(r.date)}</td>
                      <td data-k="type" className="ldg-type" title={r.type || ''}>{cleanLabel(r.type) || '—'}</td>
                      <td data-k="desc" className="ldg-desc"><EntryDescription row={r}/><CreditInvoiceSummary row={r} onDelete={canEdit ? setDeleting : undefined} onCorrect={canCorrect ? goCorrect : undefined}/></td>
                      <td data-k="debit" className="ts-end ldg-move">{shownDebit(r) !== 0 ? <span className="is-in ts-num">{fmt(shownDebit(r))}</span> : <span className="ldg-nil">—</span>}</td>
                      <td data-k="credit" className="ts-end ldg-move">{shownCredit(r) !== 0 ? <span className="is-out ts-num">{fmt(shownCredit(r))}</span> : <span className="ldg-nil">—</span>}</td>
                      <td data-k="status"><Status tone={STATUS_TONE[r.status] || 'neutral'}>{STATUS_LABEL[r.status] || r.status}</Status></td>
                      <td data-k="doc" className="jrl-c">{docButton(r)}</td>
                      <td data-k="att" className="jrl-c" data-count={attachCounts[r.journal_number] || 0}>{attButton(r)}</td>
                      {canEdit && (
                        <td>{!r._creditRows && r.status !== 'cancelled' && (docLocked(r) ? (canCorrect && <IconButton bare label="تصحيح الفاتورة" icon={PencilLine} data-k="jl-correct" onClick={() => goCorrect(r)} />)
                          : <IconButton bare label="حذف" icon={Trash2} className="ldg-del" onClick={() => { setActionError(''); setDeleting(r) }} />)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* الجوال */}
          <div className="ldg-cards" data-cards="jl.rows">
            {rowView.length === 0 && <Panel><EmptyState icon={NotebookText}>{search ? 'لا توجد نتائج للبحث.' : 'لا توجد قيود في هذه الفترة.'}</EmptyState></Panel>}
            {rowView.map((r, idx) => (
              <article key={r.id} className="ldg-card jrl-card" data-id={r.id}>
                <div className="ldg-card-head">
                  <span><span className="ts-num jrl-jn"><JournalEntryLink entry={r}>{jnLabel(r, idx)}</JournalEntryLink></span> · {day(r.date)}</span>
                  <Status tone={STATUS_TONE[r.status] || 'neutral'}>{STATUS_LABEL[r.status] || r.status}</Status>
                </div>
                <div className="ldg-card-type">{cleanLabel(r.type) || '—'}</div>
                {r.description && <div className="ldg-card-desc"><EntryDescription row={r}/></div>}<CreditInvoiceSummary row={r} onDelete={canEdit ? setDeleting : undefined} onCorrect={canCorrect ? goCorrect : undefined}/>
                <dl className="ldg-card-moves">
                  <div className="is-in"><dt>داخل</dt><dd className="ts-num">{fmt(shownDebit(r))}</dd></div>
                  <div className="is-out"><dt>خارج</dt><dd className="ts-num">{fmt(shownCredit(r))}</dd></div>
                </dl>
                <div className="jrl-card-actions">
                  {r.file_url && <Button size="sm" variant="quiet" icon={FileText} onClick={() => openFile(r.file_url)}>المستند</Button>}
                  {canAttachOf(r) && <Button size="sm" variant="quiet" icon={Paperclip} onClick={() => setModalEntry(r)}>المرفقات ({attachCounts[r.journal_number] || 0})</Button>}
                  {canEdit && !r._creditRows && r.status !== 'cancelled' && (docLocked(r) ? (canCorrect && <Button size="sm" variant="quiet" icon={PencilLine} onClick={() => goCorrect(r)}>تصحيح الفاتورة</Button>)
                    : <Button size="sm" variant="quiet" className="ldg-del" icon={Trash2} onClick={() => { setActionError(''); setDeleting(r) }}>حذف</Button>)}
                </div>
              </article>
            ))}
          </div>
          </>}
        </>
      )}

      {modalEntry && (
        <AttachDialog readOnly={unified && !canEdit} entry={modalEntry} projectId={projectId} role={role} onClose={() => setModalEntry(null)} onChanged={() => load(projectId, filter)} />
      )}

      {/* تأكيد الحذف (الحذف نفسه كما كان: نهائي) */}
      <Dialog open={!!deleting} onClose={() => !busy && setDeleting(null)} title="حذف الحركة نهائيًا؟"
        description={deleting && isSupplierPaymentType(deleting.type) ? 'تُحذف دفعة المورد كاملة مع جميع أجزائها من الحسابات، ويعود إيصالها للمراجعة.' : 'يُحذف الصف من الدفتر ولا يمكن التراجع عن هذا الإجراء.'}
        footer={<>
          <Button variant="danger-solid" icon={Trash2} disabled={busy} onClick={() => handleDelete(deleting)}>{busy ? 'جارٍ الحذف…' : 'حذف نهائي'}</Button>
          <Button onClick={() => setDeleting(null)} disabled={busy}>رجوع</Button>
        </>}>
        {deleting && (
          <dl className="ldg-del-facts">
            {deleting.journal_number && <div><dt>رقم القيد</dt><dd className="ts-num">{deleting.journal_number}</dd></div>}
            <div><dt>التاريخ</dt><dd>{day(deleting.date)}</dd></div>
            <div><dt>النوع</dt><dd>{cleanLabel(deleting.type) || '—'}</dd></div>
            {deleting.description && <div><dt>البيان</dt><dd>{deleting.description}</dd></div>}
            {debitOf(deleting) > 0 && <div><dt>داخل</dt><dd className="ts-num">{fmt(debitOf(deleting))}</dd></div>}
            {creditOf(deleting) > 0 && <div><dt>خارج</dt><dd className="ts-num">{fmt(creditOf(deleting))}</dd></div>}
          </dl>
        )}
        {deleting && isSupplierPaymentType(deleting.type) && deleting.document_id && (
          <p className="ts-field-hint" data-k="delete-receipt-note">هذه الدفعة مرتبطة بإيصال في «المستندات». حذفها يعيد الإيصال إلى «مستندات جديدة» بانتظار اعتماده من جديد أو استبعاده، فلا يبقى معتمدًا بلا دفعة.</p>
        )}
        {deleting && actionError && <p className="ts-field-error" role="alert">{actionError}</p>}
      </Dialog>
    </div>
  )
}
