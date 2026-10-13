import React, { useEffect, useState, useMemo, useRef } from 'react'
import { BookOpen, CalendarDays, Info, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { getOrCreateJournalNumber } from '../lib/journalNumber'
import { getTransactionTypes } from '../lib/projectSettings'
import { fetchEveryRow } from '../lib/fetchAll'
import { deleteSupplierPayment, isSupplierPaymentType, SUPPLIER_PAYMENT_EDIT_MSG, SUPPLIER_PAYMENT_ONLY_MSG } from '../lib/supplierPayments'
import { Button, DateInput, Dialog, EmptyState, Field, IconButton, Input, Panel, Segment, Select, Status } from '../ui/components.jsx'
import { formatDate, formatNumber, parseAmount } from '../ui/format.js'

// سجل الدفتر بالهوية الجديدة. الأرصدة الجارية والفلترة والحذف النهائي كما كانت حرفيًا؛ جدول بأعمدة مجمّعة على الكمبيوتر وبطاقات
// على الجوال، وحوارات الهوية، ورسالة عند فشل الحفظ أو الحذف. مقارنة الصفوف والأرقام قبل وبعد: local-test/ledger-figures.mjs.
// بعد مراجعة 6c7ebb1 (local-test/ledger-fixes.mjs): تحميل كل القيود بترتيب ثابت أو خطأ صريح بإعادة محاولة؛ والتاريخ والمبالغ يُتحقق
// منها قبل أي طلب (ومنه حجز رقم القيد)؛ وتعديل القيد اليدوي يحدّث إجماليه بقاعدة الإضافة، وقيد المستند يبقى إجماليه.

const STATUS_TONE = { approved: 'success', auto: 'info', pending: 'warning', cancelled: 'danger', modified: 'neutral' }
const STATUS_LABEL = {
  approved:  'معتمد',
  auto:      'تلقائي',
  pending:   'معلق',
  cancelled: 'ملغي',
  modified:  'معدَّل',
}

const QUICK_PERIODS = [
  { value: 'month',     label: 'الشهر الحالي' },
  { value: 'lastMonth', label: 'الشهر الماضي' },
  { value: 'year',      label: 'السنة الحالية' },
  { value: 'custom',    label: 'فترة أخرى' },
]

// الحسابات الأربعة وأعمدتها بالترتيب السابق نفسه
const ACCOUNTS = [
  { key: 'cash',       label: 'الصندوق', bal: '_cashBal' },
  { key: 'bank',       label: 'البنك',   bal: '_bankBal' },
  { key: 'custody',    label: 'العهدة',  bal: '_custodyBal' },
  { key: 'receivable', label: 'الذمم',   bal: '_receivableBal' },
]
const AMOUNT_KEYS = ['cash_out','cash_in','bank_out','bank_in','custody_out','custody_in','receivable_out','receivable_in']
const AMOUNT_LABEL = { cash_out:'خرج صندوق', cash_in:'دخل صندوق', bank_out:'خرج بنك', bank_in:'دخل بنك', custody_out:'خرج عهدة', custody_in:'دخل عهدة', receivable_out:'خرج ذمم', receivable_in:'دخل ذمم' }

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getRange(type) {
  const n = new Date()
  const to = fmtDate(n)
  if (type === 'lastMonth') {
    const lm  = new Date(n.getFullYear(), n.getMonth() - 1, 1)
    const lme = new Date(n.getFullYear(), n.getMonth(), 0)
    return { from: fmtDate(lm), to: fmtDate(lme) }
  }
  const from = type === 'year'
    ? `${n.getFullYear()}-01-01`
    : `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`
  return { from, to }
}

// سبب فشل الحفظ أو الحذف بالعربية: انقطاع الاتصال برسالة واضحة، وغيره برسالة الخادم كما هي
const reason = error => (/failed to fetch|network|load failed/i.test(error?.message || '') ? 'تعذّر الاتصال بالخادم؛ تحقق من الاتصال ثم أعد المحاولة.' : (error?.message || 'خطأ غير معروف'))
const cleanLabel = s => String(s || '').replace(/^[^\p{L}\p{N}]+/u, '').trim() || String(s || '')
const fmt = v => (v != null && v !== 0 ? formatNumber(v, 2) : '—')
const fmtBal = v => (v != null ? formatNumber(v, 2) : '—')

// حركة الحساب في خلية واحدة: الخرج بالأحمر مسبوقًا بـ«−» والدخل بالأخضر مسبوقًا بـ«+» (والاثنان معًا إن وُجدا)
function MoveCell({ r, acc }) {
  const out = r[`${acc}_out`], inn = r[`${acc}_in`]
  return (
    <td className="ts-end ldg-move">
      {out > 0 && <span className="is-out" data-k={`${acc}_out`}><span className="ts-num">−{fmt(out)}</span></span>}
      {inn > 0 && <span className="is-in" data-k={`${acc}_in`}><span className="ts-num">+{fmt(inn)}</span></span>}
      {!(out > 0) && !(inn > 0) && <span className="ldg-nil">—</span>}
    </td>
  )
}
function BalCell({ v, k }) {
  return <td className={`ts-end ldg-bal${v == null ? ' is-nil' : v < 0 ? ' is-neg' : ''}`} data-k={k}><span className="ts-num">{fmtBal(v)}</span></td>
}

// التحقق قبل أي طلب: التاريخ كما هو على الشاشة (لا القيمة السابقة المخفية حين يُمسح الحقل أو يُكتب تاريخ غير صحيح)، وكل مبلغ
// يُقرأ بدقة أو يُرفض (الفارغ صفر). لا يغيّر شيئًا في المدخلات.
const DATE_ERROR = 'التاريخ فارغ أو غير صحيح. اكتبه يوم/شهر/سنة، مثل 05/10/2026.'
const AMOUNT_ERROR = 'مبلغ غير صالح'
function validateEntry(row) {
  const errors = {}, amounts = {}
  if (!row.date || row._dateInvalid) errors.date = DATE_ERROR
  for (const k of AMOUNT_KEYS) {
    const n = parseAmount(row[k])
    if (Number.isNaN(n)) errors[k] = AMOUNT_ERROR
    else amounts[k] = n
  }
  const bad = AMOUNT_KEYS.filter(k => errors[k])
  const summary = [errors.date && 'التاريخ فارغ أو غير صحيح', bad.length && `المبلغ غير صالح في: ${bad.map(k => AMOUNT_LABEL[k]).join('، ')} (اكتب رقمًا فقط، مثل 230 أو 1,230.50)`].filter(Boolean)
  return { ok: !summary.length, errors, amounts, summary: summary.length ? `لم يُحفظ: ${summary.join('؛ ')}.` : '' }
}

// قيد بشكل ما تُنشئه الإضافة من هذه الصفحة: بلا مستند ولا ملف ولا ذمم دائنة ولا ضريبة ولا مورد. هذا وحده يُعاد احتساب إجماليه عند
// التعديل بقاعدة الإضافة (أكبر المبالغ الثمانية). قيود المستندات إجماليها إجمالي الفاتورة (والآجل منها مبلغه في الذمم الدائنة، خارج
// هذه المبالغ)، فيبقى كما هو. لا إعادة احتساب جماعية لأي قيد سابق.
const isManualShape = r => !r.document_id && !r.document_invoice_id && !r.file_url && !r.supplier_id
  && !Number(r.payable_in) && !Number(r.payable_out) && !Number(r.vat_amount)

// نموذج الحركة (الإضافة والتعديل): الحقول نفسها كما كانت، والمبالغ مجمّعة حسب الحساب
function EntryForm({ row, setRow, types, placeholderDesc, errors = {} }) {
  return (
    <div className="ldg-form">
      <div className="ts-form-grid">
        <Field label="التاريخ" error={errors.date}>
          <DateInput value={row.date || ''} onChange={iso => setRow(r => ({ ...r, date: iso }))}
            onValidityChange={ok => setRow(r => (r._dateInvalid === !ok ? r : { ...r, _dateInvalid: !ok }))} />
        </Field>
        <Field label="النوع">
          <Select value={row.type || ''} onChange={e => setRow(r => ({ ...r, type: e.target.value }))} placeholder="— اختر —"
            options={types.map(t => ({ value: t, label: t }))} />
        </Field>
        <Field label="الوصف" span>
          <Input value={row.description || ''} placeholder={placeholderDesc} onChange={e => setRow(r => ({ ...r, description: e.target.value }))} />
        </Field>
      </div>
      <div className="ldg-form-amounts">
        {ACCOUNTS.map(a => (
          <fieldset key={a.key} className="ldg-form-account">
            <legend>{a.label}</legend>
            {['out', 'in'].map(dir => {
              const k = `${a.key}_${dir}`
              return (
                <Field key={k} label={dir === 'out' ? 'خرج' : 'دخل'} error={errors[k]}>
                  <Input numeric value={row[k] || ''} placeholder="0" aria-label={AMOUNT_LABEL[k]} data-amount={k}
                    onChange={e => setRow(r => ({ ...r, [k]: e.target.value }))} />
                </Field>
              )
            })}
          </fieldset>
        ))}
      </div>
    </div>
  )
}

export default function Ledger() {
  const { canEdit, projectId } = useAuth()
  const [allRows, setAllRows]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [types, setTypes]           = useState([])
  const [editRow, setEditRow]       = useState(null)
  const [activePeriod, setActivePeriod] = useState('month')
  const [filter, setFilter]         = useState({ ...getRange('month'), type: '' })
  const [newRow, setNewRow]           = useState(null)
  const [saving, setSaving]           = useState(false)
  const [deleting, setDeleting]       = useState(null)   // الحركة المطلوب حذفها (تأكيد داخل التطبيق بدل نافذة المتصفح)
  const [actionError, setActionError] = useState('')
  const [loadError, setLoadError]     = useState('')     // فشل تحميل أي جزء: لا صفوف ولا أرصدة تُعرض حتى تنجح إعادة المحاولة
  const [tried, setTried]             = useState(false)  // بعد أول محاولة حفظ تظهر أخطاء الحقول وتتحدث مع الكتابة
  const loadSeq = useRef(0)

  useEffect(() => {
    if (!projectId) return
    getTransactionTypes(projectId).then(setTypes)
    load(projectId)
  }, [projectId])

  // كل القيود بلا حد للعدد، بترتيب ثابت (التاريخ ثم وقت الإنشاء ثم المعرّف) فلا يتكرر صف ولا يسقط بين الصفحات. فشل أي صفحة خطأ
  // صريح لا بيانات ناقصة، لأن الأرصدة الجارية تُجمع من أول قيد. نتيجة تحميل أقدم من آخر طلب تُهمل.
  async function load(pid) {
    const seq = ++loadSeq.current
    setLoading(true); setLoadError('')
    const { data, error } = await fetchEveryRow(() => supabase.from('ledger_entries')
      .select('*')
      .eq('project_id', pid)
      .order('date', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }))
    if (seq !== loadSeq.current) return
    if (error) { setAllRows([]); setLoadError(reason(error)) } else setAllRows(data)
    setLoading(false)
  }

  // Compute running balances for all non-cancelled entries (ascending order)
  const enriched = useMemo(() => {
    let cash = 0, bank = 0, custody = 0, receivable = 0
    return allRows.map(r => {
      if (r.status !== 'cancelled') {
        cash       += (r.cash_in       || 0) - (r.cash_out       || 0)
        bank       += (r.bank_in       || 0) - (r.bank_out       || 0)
        custody    += (r.custody_in    || 0) - (r.custody_out    || 0)
        receivable += (r.receivable_in || 0) - (r.receivable_out || 0)
        return { ...r, _cashBal: cash, _bankBal: bank, _custodyBal: custody, _receivableBal: receivable }
      }
      return { ...r, _cashBal: null, _bankBal: null, _custodyBal: null, _receivableBal: null }
    })
  }, [allRows])

  // Apply date + type filters, then reverse for newest-first display
  const filteredRows = useMemo(() => {
    let rows = enriched
    if (filter.from) rows = rows.filter(r => r.date >= filter.from)
    if (filter.to)   rows = rows.filter(r => r.date <= filter.to)
    if (filter.type) rows = rows.filter(r => r.type === filter.type)
    return [...rows].reverse()
  }, [enriched, filter])

  async function saveEdit() {
    if (!editRow) return
    setActionError(''); setTried(true)
    const v = validateEntry(editRow)
    if (!v.ok) return
    // تحويل قيد إلى «سداد مورد» يرفضه الخادم (20261013120000): الرسالة قبل الطلب
    if (isSupplierPaymentType(editRow.type)) { setActionError(SUPPLIER_PAYMENT_EDIT_MSG); return }
    setSaving(true)
    const a = v.amounts
    const patch = {
      date:           editRow.date,
      type:           editRow.type,
      description:    editRow.description,
      cash_out:       a.cash_out,
      cash_in:        a.cash_in,
      bank_out:       a.bank_out,
      bank_in:        a.bank_in,
      custody_out:    a.custody_out,
      custody_in:     a.custody_in,
      receivable_out: a.receivable_out,
      receivable_in:  a.receivable_in,
    }
    if (isManualShape(editRow)) patch.total_amount = Math.max(...AMOUNT_KEYS.map(k => a[k]))
    const { error } = await supabase.from('ledger_entries').update(patch).eq('id', editRow.id)
    setSaving(false)
    if (error) { setActionError('تعذّر حفظ التعديل: ' + reason(error)); return }
    setEditRow(null)
    load(projectId)
  }

  // الحذف كما كان: حذف نهائي للصف بعد التأكيد (لا قيد عكسي). قيد «سداد مورد» يُحذف بدالة الخادم مع حركة المورد معًا
  async function cancelEntry(entry) {
    setSaving(true); setActionError('')
    let msg = null
    if (isSupplierPaymentType(entry.type)) msg = await deleteSupplierPayment(supabase, entry).catch(e => e?.message || 'خطأ غير معروف')
    else {
      const { error } = await supabase.from('ledger_entries').delete().eq('id', entry.id)
      if (error) msg = error.message || 'خطأ غير معروف'
    }
    setSaving(false)
    if (msg) { setActionError('فشل الحذف: ' + reason({ message: msg })); return }
    setDeleting(null)
    load(projectId)
  }

  async function saveNew() {
    if (!newRow || !projectId) return
    setActionError(''); setTried(true)
    // التحقق قبل حجز رقم القيد: المدخل المرفوض لا يستهلك رقمًا ولا يرسل التاريخ السابق المخفي
    const v = validateEntry(newRow)
    if (!v.ok) return
    // «سداد مورد» من «الموردين» وحدها (الخادم يرفضه هنا): لا يُحجز رقم قيد ولا يُرسل طلب
    if (isSupplierPaymentType(newRow.type)) { setActionError(SUPPLIER_PAYMENT_ONLY_MSG); return }
    setSaving(true)
    let jn
    try { jn = await getOrCreateJournalNumber(projectId, newRow.date) } catch (e) { setSaving(false); setActionError(e.message); return }
    const a = v.amounts
    const total = Math.max(...AMOUNT_KEYS.map(k => a[k]))
    const { error } = await supabase.from('ledger_entries').insert({
      project_id:     projectId,
      date:           newRow.date,
      type:           newRow.type,
      description:    newRow.description,
      cash_in:        a.cash_in,
      cash_out:       a.cash_out,
      bank_in:        a.bank_in,
      bank_out:       a.bank_out,
      custody_in:     a.custody_in,
      custody_out:    a.custody_out,
      receivable_in:  a.receivable_in,
      receivable_out: a.receivable_out,
      total_amount:   total,
      status:         'approved',
      file_url:       '',
      journal_number: jn,
    })
    setSaving(false)
    if (!error) { setNewRow(null); load(projectId) }
    else setActionError('تعذّر حفظ القيد: ' + reason(error))
  }

  const openNew = () => { setActionError(''); setTried(false); setNewRow({ date: fmtDate(new Date()), type:'', description:'', cash_in:'', cash_out:'', bank_in:'', bank_out:'', custody_in:'', custody_out:'', receivable_in:'', receivable_out:'' }) }
  const choosePeriod = key => {
    setActivePeriod(key)
    if (key !== 'custom') setFilter(f => ({ ...getRange(key), type: f.type }))
  }
  const refYear = Number((filter.to || fmtDate(new Date())).slice(0, 4))
  const day = iso => (iso ? formatDate(iso, { refYear }) : '—')
  const rangeText = filter.from && filter.to
    ? (filter.from === filter.to ? formatDate(filter.from, { year: true }) : `${formatDate(filter.from, { year: filter.from.slice(0, 4) !== filter.to.slice(0, 4) })} – ${formatDate(filter.to, { year: true })}`)
    : 'كل التواريخ'

  const openEdit = r => { setActionError(''); setTried(false); setEditRow({ ...r }) }
  const newCheck = newRow && tried ? validateEntry(newRow) : null
  const editCheck = editRow && tried ? validateEntry(editRow) : null

  const actions = r => canEdit && r.status !== 'cancelled' && (
    <div className="ldg-actions">
      {!isSupplierPaymentType(r.type) && <Button size="sm" variant="quiet" icon={Pencil} onClick={() => openEdit(r)}>تعديل</Button>}
      <Button size="sm" variant="quiet" className="ldg-del" icon={Trash2} onClick={() => { setActionError(''); setDeleting(r) }}>حذف</Button>
    </div>
  )

  const iconActions = r => canEdit && r.status !== 'cancelled' && (
    <div className="ldg-actions">
      {!isSupplierPaymentType(r.type) && <IconButton bare label="تعديل" icon={Pencil} onClick={() => openEdit(r)} />}
      <IconButton bare label="حذف" icon={Trash2} className="ldg-del" onClick={() => { setActionError(''); setDeleting(r) }} />
    </div>
  )

  return (
    <div className="ldg-page">
      <div className="ts-heading">
        <div>
          <h1>سجل الدفتر</h1>
          <p className="ldg-showing" data-shown-from={filter.from} data-shown-to={filter.to} data-shown-type={filter.type}>
            <CalendarDays className="ts-icon--sm" aria-hidden="true" />
            <span>{rangeText}</span>
            <span aria-hidden="true">·</span>
            <span>{filter.type ? cleanLabel(filter.type) : 'كل الأنواع'}</span>
          </p>
        </div>
        {canEdit && <Button variant="primary" icon={Plus} disabled={loading || !!loadError} onClick={openNew}>إضافة قيد</Button>}
      </div>

      <Panel className="ldg-filters" title="الفترة والنوع" icon={CalendarDays}>
        <div className="ts-panel-body ldg-filter-body">
          <Segment label="الفترة" value={activePeriod} onChange={choosePeriod} options={QUICK_PERIODS} />
          <div className="ldg-filter-row">
            <Field label="من"><DateInput value={filter.from} onChange={iso => { setActivePeriod('custom'); setFilter(f => ({ ...f, from: iso })) }} /></Field>
            <Field label="إلى"><DateInput value={filter.to} onChange={iso => { setActivePeriod('custom'); setFilter(f => ({ ...f, to: iso })) }} /></Field>
            <Field label="النوع">
              <Select value={filter.type} onChange={e => setFilter(f => ({ ...f, type: e.target.value }))}
                options={[{ value: '', label: 'الكل' }, ...types.map(t => ({ value: t, label: t }))]} />
            </Field>
          </div>
        </div>
      </Panel>

      {loading ? (
        <Panel><div className="ldg-loading" aria-busy="true">جارٍ تحميل الحركات…</div></Panel>
      ) : loadError ? (
        <div className="ts-note ts-note--error ldg-load-error" data-k="ledger.loadError" role="alert">
          <Info className="ts-icon" aria-hidden="true" />
          <div className="ts-note-body">
            <strong>تعذّر تحميل حركات الدفتر كاملة، فلم تُعرض الحركات ولا الأرصدة.</strong>
            الأرصدة تُجمع من أول قيد، فعرضها من بيانات ناقصة يعطي أرقامًا خاطئة. {loadError}
            <div className="ts-note-action"><Button size="sm" variant="primary" icon={RefreshCw} onClick={() => load(projectId)}>إعادة المحاولة</Button></div>
          </div>
        </div>
      ) : (
        <>
          {/* الكمبيوتر: جدول بأعمدة مجمّعة حسب الحساب، ثم الأرصدة الجارية بعد كل حركة */}
          <Panel className="ldg-table-panel" clip>
            <div className="ldg-scroll">
              <table className="ts-table ldg-table" data-table="ledger.rows">
                <thead>
                  <tr className="ldg-group">
                    <th rowSpan={2}>التاريخ</th><th rowSpan={2}>النوع</th><th rowSpan={2}>الوصف</th>
                    <th colSpan={4} className="ldg-acc">الحركة <small>الخرج <span className="ts-num">−</span> والدخل <span className="ts-num">+</span></small></th>
                    <th colSpan={4} className="ldg-acc ldg-bal-head">الرصيد بعد الحركة</th>
                    <th rowSpan={2}>الحالة</th><th rowSpan={2}><span className="ts-sr">إجراءات</span></th>
                  </tr>
                  <tr>
                    {ACCOUNTS.map(a => <th key={a.key} className="ts-end">{a.label}</th>)}
                    {ACCOUNTS.map(a => <th key={a.key} className="ts-end ldg-bal-head">{a.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 && (
                    <tr><td colSpan={13}><EmptyState icon={BookOpen}>لا توجد حركات في هذه الفترة{filter.type ? ' لهذا النوع' : ''}.</EmptyState></td></tr>
                  )}
                  {filteredRows.map(r => (
                    <tr key={r.id} data-id={r.id} className={r.status === 'cancelled' ? 'is-cancelled' : ''}>
                      <td data-k="date" data-iso={r.date || ''} className="ldg-date">{day(r.date)}</td>
                      <td data-k="type" className="ldg-type">{cleanLabel(r.type) || '—'}</td>
                      <td data-k="desc" className="ldg-desc" title={r.description || ''}>{r.description || '—'}</td>
                      {ACCOUNTS.map(a => <MoveCell key={a.key} r={r} acc={a.key} />)}
                      {ACCOUNTS.map(a => <BalCell key={a.key} v={r[a.bal]} k={a.bal} />)}
                      <td data-k="status"><Status tone={STATUS_TONE[r.status] || 'neutral'}>{STATUS_LABEL[r.status] || r.status}</Status></td>
                      <td>{iconActions(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* الجوال: بطاقة لكل حركة */}
          <div className="ldg-cards" data-cards="ledger.rows">
            {filteredRows.length === 0 && <Panel><EmptyState icon={BookOpen}>لا توجد حركات في هذه الفترة{filter.type ? ' لهذا النوع' : ''}.</EmptyState></Panel>}
            {filteredRows.map(r => {
              const moves = AMOUNT_KEYS.filter(k => r[k] > 0)
              return (
                <article key={r.id} className={`ldg-card${r.status === 'cancelled' ? ' is-cancelled' : ''}`} data-id={r.id}>
                  <div className="ldg-card-head">
                    <span className="ldg-card-date">{day(r.date)}</span>
                    <Status tone={STATUS_TONE[r.status] || 'neutral'}>{STATUS_LABEL[r.status] || r.status}</Status>
                  </div>
                  <div className="ldg-card-type">{cleanLabel(r.type) || '—'}</div>
                  {r.description && <div className="ldg-card-desc">{r.description}</div>}
                  <dl className="ldg-card-moves">
                    {moves.length === 0 && <div><dt>الحركة</dt><dd>—</dd></div>}
                    {moves.map(k => <div key={k} className={k.endsWith('_out') ? 'is-out' : 'is-in'}><dt>{AMOUNT_LABEL[k]}</dt><dd className="ts-num">{fmt(r[k])}</dd></div>)}
                  </dl>
                  <dl className="ldg-card-bals">
                    {ACCOUNTS.map(a => <div key={a.key} className={r[a.bal] != null && r[a.bal] < 0 ? 'is-neg' : ''}><dt>{a.label}</dt><dd className="ts-num">{fmtBal(r[a.bal])}</dd></div>)}
                  </dl>
                  {actions(r)}
                </article>
              )
            })}
          </div>

          {filteredRows.length > 0 && (
            <p className="ldg-count" data-k="ledger.count">{filteredRows.length} صف معروض من {allRows.length} إجمالي</p>
          )}
        </>
      )}

      {/* إضافة حركة */}
      <Dialog open={!!newRow} onClose={() => !saving && setNewRow(null)} title="إضافة حركة جديدة"
        description="تُسجَّل الحركة معتمدة برقم قيد جديد. أدخل المبلغ في خانة الحساب الذي تحرك."
        footer={<>
          <Button variant="primary" disabled={saving || !newRow?.date || !newRow?.type} onClick={saveNew}>{saving ? 'جارٍ الحفظ…' : 'حفظ القيد'}</Button>
          <Button onClick={() => setNewRow(null)} disabled={saving}>رجوع</Button>
        </>}>
        {newRow && <EntryForm row={newRow} setRow={setNewRow} types={types} placeholderDesc="اختياري" errors={newCheck?.errors} />}
        {newCheck && !newCheck.ok && <p className="ts-field-error" role="alert" data-k="ledger.formError">{newCheck.summary}</p>}
        {newRow && actionError && <p className="ts-field-error" role="alert">{actionError}</p>}
      </Dialog>

      {/* تعديل حركة */}
      <Dialog open={!!editRow} onClose={() => !saving && setEditRow(null)} title="تعديل الحركة"
        footer={<>
          <Button variant="primary" disabled={saving} onClick={saveEdit}>{saving ? 'جارٍ الحفظ…' : 'حفظ'}</Button>
          <Button onClick={() => setEditRow(null)} disabled={saving}>رجوع</Button>
        </>}>
        {editRow && !isManualShape(editRow) && (
          <div className="ts-note ldg-total-kept" data-k="ledger.totalKept">
            <Info className="ts-icon" aria-hidden="true" />
            <div className="ts-note-body">هذا القيد ناتج عن مستند (فيه ملف أو ضريبة أو ذمم دائنة أو مورد)، فيبقى إجماليه المسجَّل <span className="ts-num">{formatNumber(editRow.total_amount)}</span> كما هو، ولا يُعاد احتسابه من المبالغ عند التعديل.</div>
          </div>
        )}
        {editRow && <EntryForm row={editRow} setRow={setEditRow} types={types} errors={editCheck?.errors} />}
        {editCheck && !editCheck.ok && <p className="ts-field-error" role="alert" data-k="ledger.formError">{editCheck.summary}</p>}
        {editRow && actionError && <p className="ts-field-error" role="alert">{actionError}</p>}
      </Dialog>

      {/* تأكيد الحذف (الحذف نفسه كما كان: نهائي) */}
      <Dialog open={!!deleting} onClose={() => !saving && setDeleting(null)} title="حذف الحركة نهائيًا؟"
        description="يُحذف الصف من الدفتر ولا يمكن التراجع، وتتغير الأرصدة بعده."
        footer={<>
          <Button variant="danger-solid" icon={Trash2} disabled={saving} onClick={() => cancelEntry(deleting)}>{saving ? 'جارٍ الحذف…' : 'حذف نهائي'}</Button>
          <Button onClick={() => setDeleting(null)} disabled={saving}>رجوع</Button>
        </>}>
        {deleting && (
          <dl className="ldg-del-facts">
            <div><dt>التاريخ</dt><dd>{day(deleting.date)}</dd></div>
            <div><dt>النوع</dt><dd>{cleanLabel(deleting.type) || '—'}</dd></div>
            {deleting.description && <div><dt>الوصف</dt><dd>{deleting.description}</dd></div>}
            {AMOUNT_KEYS.filter(k => deleting[k] > 0).map(k => <div key={k}><dt>{AMOUNT_LABEL[k]}</dt><dd className="ts-num">{fmt(deleting[k])}</dd></div>)}
            {deleting.journal_number && <div><dt>رقم القيد</dt><dd className="ts-num">{deleting.journal_number}</dd></div>}
          </dl>
        )}
        {deleting && actionError && <p className="ts-field-error" role="alert">{actionError}</p>}
      </Dialog>
    </div>
  )
}
