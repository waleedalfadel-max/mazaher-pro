import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ExternalLink, FileText, Info, NotebookText, Paperclip, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { uploadToStorage, getSignedUrl } from '../lib/storage'
import { loadAttachmentCounts, loadPeriodEntries } from '../lib/journalEntries.js'
import { deleteSupplierPayment, isSupplierPaymentType } from '../lib/supplierPayments'
import { Button, DateInput, Dialog, EmptyState, Field, IconButton, Panel, SearchBox, Segment, Status } from '../ui/components.jsx'
import { formatDate, formatNumber } from '../ui/format.js'

// سجل الحركات اليومية بالهوية الجديدة. الحسابات كما كانت حرفيًا: القيود غير الملغاة في الفترة بترتيب التاريخ، والمدين = دخل الصندوق
// والبنك والعهدة، والدائن = خرجها، والإجمالي على قيود الفترة كلها، والبحث في البيان والنوع ورقم القيد كما هو، ورقم «#ترتيب» للقيد بلا
// رقم، ورابط المستند (ملف القيد أو مستند برقم القيد)، والمرفقات الإضافية (عرض ورفع وحذف)، والحذف النهائي بعد التأكيد.
// التغيير: التحميل كامل بترتيب ثابت (src/lib/journalEntries.js) وفشل أي جزء رسالة بإعادة محاولة بلا صفوف؛ وجدول على الكمبيوتر وبطاقات
// على الجوال؛ وحوارات الهوية بدل نافذة المتصفح ورسالة عند فشل الحذف أو المرفق. المقارنة قبل وبعد: local-test/journals-figures.mjs.

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
const COLUMNS = 'id,date,type,description,cash_in,bank_in,custody_in,cash_out,bank_out,custody_out,total_amount,status,journal_number,created_at,file_url,document_id'
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
function AttachDialog({ entry, projectId, role, onClose, onChanged }) {
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
    if (!file) return
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
        <label className={`ts-btn ts-btn--primary jrl-upload${uploading ? ' is-busy' : ''}`}>
          {uploading ? <RefreshCw className="ts-icon" aria-hidden="true" /> : <Upload className="ts-icon" aria-hidden="true" />}
          {uploading ? 'جارٍ الرفع…' : 'إضافة مرفق جديد'}
          <input ref={fileRef} type="file" className="ts-sr" accept="image/*,.pdf" onChange={handleUpload} disabled={uploading} />
        </label>
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
                {['owner', 'accountant', 'superadmin'].includes(role) && (
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
export default function JournalLedger() {
  const { role, projectId, isSuperAdmin } = useAuth()
  const canEdit = role === 'accountant' || role === 'owner' || isSuperAdmin
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
  const loadSeq = useRef(0)

  useEffect(() => { if (projectId) load(projectId, filter) }, [projectId])

  // القيود والمستندات والمرفقات كاملة؛ أي فشل ← رسالة بلا صفوف. نتيجة أقدم من آخر طلب تُهمل.
  async function load(pid, f) {
    const seq = ++loadSeq.current
    setLoading(true); setLoadError('')
    const pidOk = pid || projectId
    const entries = await loadPeriodEntries(supabase, { projectId: pidOk, from: f.from, to: f.to, columns: COLUMNS, dateAscending: true })
    const counts = entries.error ? null : await loadAttachmentCounts(supabase, { projectId: pidOk, journalNumbers: entries.data.map(r => r.journal_number) })
    if (seq !== loadSeq.current) return
    const failed = entries.error ? entries : counts.error ? counts : null
    if (failed) { setRows([]); setAttachCounts({}); setLoadError(`${failed.part}: ${reason(failed.error)}`) }
    else { setRows(entries.data); setAttachCounts(counts.data) }
    setLoading(false)
  }

  // الحذف كما كان: حذف نهائي للصف بعد التأكيد. قيد «سداد مورد» يُحذف بدالة الخادم مع حركة المورد معًا (20261013120000)
  async function handleDelete(entry) {
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

  const totals = useMemo(() => {
    const debit   = rows.reduce((s, r) => s + (r.cash_in  || 0) + (r.bank_in  || 0) + (r.custody_in  || 0), 0)
    const credit  = rows.reduce((s, r) => s + (r.cash_out || 0) + (r.bank_out || 0) + (r.custody_out || 0), 0)
    return { debit, credit }
  }, [rows])

  const visibleRows = useMemo(() => {
    if (!search.trim()) return rows
    const s = search.trim().toLowerCase()
    return rows.filter(r =>
      (r.description    || '').toLowerCase().includes(s) ||
      (r.type           || '').toLowerCase().includes(s) ||
      (r.journal_number || '').toString().includes(s)
    )
  }, [rows, search])

  const refYear = Number((filter.to || fmtDate(new Date())).slice(0, 4))
  const day = iso => (iso ? formatDate(iso, { refYear }) : '—')
  const rangeText = filter.from && filter.to
    ? (filter.from === filter.to ? formatDate(filter.from, { year: true }) : `${formatDate(filter.from, { year: filter.from.slice(0, 4) !== filter.to.slice(0, 4) })} – ${formatDate(filter.to, { year: true })}`)
    : 'كل التواريخ'
  const countText = `${visibleRows.length} حركة${search && rows.length !== visibleRows.length ? ` (من ${rows.length})` : ''}`

  const view = rows.length ? visibleRows : []
  const jnLabel = (r, idx) => r.journal_number || `#${idx + 1}`
  const canAttachOf = r => ['approved', 'auto'].includes(r.status) && r.journal_number
  const docButton = r => r.file_url
    ? <IconButton bare label={r._doc_name ? `فتح المستند: ${r._doc_name}` : 'فتح المستند'} icon={FileText} className="jrl-doc" onClick={() => openFile(r.file_url)} />
    : <span className="ldg-nil">—</span>
  const attButton = r => {
    const n = r.journal_number ? (attachCounts[r.journal_number] || 0) : 0
    return canAttachOf(r)
      ? <Button size="sm" variant={n > 0 ? 'primary' : 'quiet'} icon={n > 0 ? Paperclip : Plus} className="jrl-att" aria-label={n > 0 ? `المرفقات (${n})` : 'إضافة مرفق'} onClick={() => setModalEntry(r)}>{n > 0 ? <span className="ts-num">{n}</span> : null}</Button>
      : <span className="ldg-nil">—</span>
  }

  return (
    <div className="ldg-page jrl-page">
      <div className="ts-heading">
        <div>
          <h1>سجل الحركات اليومية</h1>
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
          <div className="jx-totals" data-k="jl.totals">
            <div><span>مدين الفترة</span><strong className="ts-num is-in" data-k="jl.totalDebit">{fmt(totals.debit)}</strong></div>
            <div><span>دائن الفترة</span><strong className="ts-num is-out" data-k="jl.totalCredit">{fmt(totals.credit)}</strong></div>
            <div><span>قيود الفترة</span><strong className="ts-num" data-k="jl.totalCount">{rows.length}</strong></div>
          </div>

          {/* الكمبيوتر */}
          <Panel className="ldg-table-panel" clip>
            <div className="ldg-scroll">
              <table className="ts-table ldg-table jrl-table" data-table="jl.rows">
                <thead>
                  <tr>
                    <th>رقم القيد</th><th>التاريخ</th><th>نوع الحركة</th><th>البيان</th>
                    <th className="ts-end">مدين</th><th className="ts-end">دائن</th><th>الحالة</th>
                    <th className="jrl-c">مستند</th><th className="jrl-c">مرفقات</th>
                    {canEdit && <th><span className="ts-sr">حذف</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {view.length === 0 && (
                    <tr><td colSpan={canEdit ? 10 : 9}><EmptyState icon={NotebookText}>{search ? 'لا توجد نتائج للبحث.' : 'لا توجد قيود في هذه الفترة.'}</EmptyState></td></tr>
                  )}
                  {view.map((r, idx) => (
                    <tr key={r.id} data-id={r.id}>
                      <td data-k="jn" className="jrl-jn ts-num">{jnLabel(r, idx)}</td>
                      <td data-k="date" data-iso={r.date || ''} className="ldg-date">{day(r.date)}</td>
                      <td data-k="type" className="ldg-type" title={r.type || ''}>{cleanLabel(r.type) || '—'}</td>
                      <td data-k="desc" className="ldg-desc" title={r.description || ''}>{r.description || '—'}</td>
                      <td data-k="debit" className="ts-end ldg-move">{debitOf(r) > 0 ? <span className="is-in ts-num">{fmt(debitOf(r))}</span> : <span className="ldg-nil">—</span>}</td>
                      <td data-k="credit" className="ts-end ldg-move">{creditOf(r) > 0 ? <span className="is-out ts-num">{fmt(creditOf(r))}</span> : <span className="ldg-nil">—</span>}</td>
                      <td data-k="status"><Status tone={STATUS_TONE[r.status] || 'neutral'}>{STATUS_LABEL[r.status] || r.status}</Status></td>
                      <td data-k="doc" className="jrl-c">{docButton(r)}</td>
                      <td data-k="att" className="jrl-c" data-count={attachCounts[r.journal_number] || 0}>{attButton(r)}</td>
                      {canEdit && (
                        <td>{r.status !== 'cancelled' && <IconButton bare label="حذف" icon={Trash2} className="ldg-del" onClick={() => { setActionError(''); setDeleting(r) }} />}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* الجوال */}
          <div className="ldg-cards" data-cards="jl.rows">
            {view.length === 0 && <Panel><EmptyState icon={NotebookText}>{search ? 'لا توجد نتائج للبحث.' : 'لا توجد قيود في هذه الفترة.'}</EmptyState></Panel>}
            {view.map((r, idx) => (
              <article key={r.id} className="ldg-card jrl-card" data-id={r.id}>
                <div className="ldg-card-head">
                  <span><span className="ts-num jrl-jn">{jnLabel(r, idx)}</span> · {day(r.date)}</span>
                  <Status tone={STATUS_TONE[r.status] || 'neutral'}>{STATUS_LABEL[r.status] || r.status}</Status>
                </div>
                <div className="ldg-card-type">{cleanLabel(r.type) || '—'}</div>
                {r.description && <div className="ldg-card-desc">{r.description}</div>}
                <dl className="ldg-card-moves">
                  <div className="is-in"><dt>مدين</dt><dd className="ts-num">{fmt(debitOf(r))}</dd></div>
                  <div className="is-out"><dt>دائن</dt><dd className="ts-num">{fmt(creditOf(r))}</dd></div>
                </dl>
                <div className="jrl-card-actions">
                  {r.file_url && <Button size="sm" variant="quiet" icon={FileText} onClick={() => openFile(r.file_url)}>المستند</Button>}
                  {canAttachOf(r) && <Button size="sm" variant="quiet" icon={Paperclip} onClick={() => setModalEntry(r)}>المرفقات ({attachCounts[r.journal_number] || 0})</Button>}
                  {canEdit && r.status !== 'cancelled' && <Button size="sm" variant="quiet" className="ldg-del" icon={Trash2} onClick={() => { setActionError(''); setDeleting(r) }}>حذف</Button>}
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {modalEntry && (
        <AttachDialog entry={modalEntry} projectId={projectId} role={role} onClose={() => setModalEntry(null)} onChanged={() => load(projectId, filter)} />
      )}

      {/* تأكيد الحذف (الحذف نفسه كما كان: نهائي) */}
      <Dialog open={!!deleting} onClose={() => !busy && setDeleting(null)} title="حذف الحركة نهائيًا؟"
        description="يُحذف الصف من الدفتر ولا يمكن التراجع عن هذا الإجراء."
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
            {debitOf(deleting) > 0 && <div><dt>مدين</dt><dd className="ts-num">{fmt(debitOf(deleting))}</dd></div>}
            {creditOf(deleting) > 0 && <div><dt>دائن</dt><dd className="ts-num">{fmt(creditOf(deleting))}</dd></div>}
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
