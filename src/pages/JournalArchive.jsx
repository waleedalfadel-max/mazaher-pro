import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, CalendarDays, ChevronDown, Download, FileText, Info, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { getSignedUrl } from '../lib/storage'
import { loadPeriodEntries } from '../lib/journalEntries.js'
import { exportDayPdf } from '../lib/dayPdf.js'
import { Button, DateInput, EmptyState, Field, IconButton, Panel, SearchBox, Segment } from '../ui/components.jsx'
import { formatDate, formatNumber } from '../ui/format.js'

// أرشيف الحركات اليومية بالهوية الجديدة. الحسابات كما كانت حرفيًا: القيود غير الملغاة في الفترة (الأحدث يومًا أولًا، وداخل اليوم بترتيب
// الإنشاء)، مجمّعة يومًا يومًا بعنوان أول رقم قيد فيه، وطرفا كل حركة (getEntryAccounts) ومبلغها، ومجموع المدين والدائن والميزان لليوم
// (يشمل الذمم)، والبحث في التاريخ ورقم الحركة والبيان والنوع، وفتح المستند، وتصدير اليوم PDF (بعد 06455b4: صفحات متعددة، src/lib/dayPdf.js).
// التغيير: التحميل كامل بترتيب ثابت (src/lib/journalEntries.js) وفشل أي جزء رسالة بإعادة محاولة بلا أيام؛ والفلاتر ظاهرة أثناء التحميل؛
// وجدول القيد بصفّين على الكمبيوتر وقائمة على الجوال. المقارنة قبل وبعد: local-test/journals-figures.mjs.

// اسم الحساب النقدي المرتبط بالحركة
function getCashAccount(r) {
  if ((r.cash_in       || 0) > 0 || (r.cash_out       || 0) > 0) return 'الصندوق النقدي'
  if ((r.bank_in       || 0) > 0 || (r.bank_out       || 0) > 0) return 'الحساب البنكي'
  if ((r.custody_in    || 0) > 0 || (r.custody_out    || 0) > 0) return 'العهدة'
  if ((r.receivable_in || 0) > 0 || (r.receivable_out || 0) > 0) return 'ذمم مدينة'
  return '—'
}

// حساب طرفَي القيد (مدين / دائن)
function getEntryAccounts(r) {
  const d = (r.cash_in||0)+(r.bank_in||0)+(r.custody_in||0)+(r.receivable_in||0)
  const c = (r.cash_out||0)+(r.bank_out||0)+(r.custody_out||0)+(r.receivable_out||0)
  const amount     = d > 0 ? d : c
  const cashAcc    = getCashAccount(r)
  const typeLabel  = r.type || '—'
  const isIncome   = d > 0

  return {
    amount,
    isIncome,
    // طرف مدين
    debitAccount  : isIncome ? cashAcc   : typeLabel,
    // طرف دائن
    creditAccount : isIncome ? typeLabel : cashAcc,
  }
}

// ── تصدير اليوم PDF: صفحات A4 متعددة عند الحاجة (src/lib/dayPdf.js) بالحسابات نفسها، وباسم الملف نفسه ─────────
async function exportGroupPdf(group, fmt) {
  await exportDayPdf(group, fmt, getEntryAccounts)
}

const QUICK_PERIODS = [
  { value: 'month',     label: 'الشهر الحالي' },
  { value: 'lastMonth', label: 'الشهر الماضي' },
  { value: 'year',      label: 'السنة الحالية' },
  { value: 'custom',    label: 'فترة أخرى' },
]
const COLUMNS = 'id,date,type,description,cash_in,bank_in,custody_in,cash_out,bank_out,custody_out,receivable_in,receivable_out,total_amount,status,journal_number,file_url,created_at'

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

const reason = error => (/failed to fetch|network|load failed/i.test(error?.message || '') ? 'تعذّر الاتصال بالخادم؛ تحقق من الاتصال ثم أعد المحاولة.' : (error?.message || 'خطأ غير معروف'))
const cleanLabel = s => String(s || '').replace(/^[^\p{L}\p{N}]+/u, '').trim() || String(s || '')

async function openFile(fileUrl) {
  const win = window.open('', '_blank')
  const url = await getSignedUrl(fileUrl)
  if (win) { if (url) win.location.href = url; else win.close() }
}

// ── الصفحة ──────────────────────────────────────────────────────────
export default function JournalArchive() {
  const { projectId } = useAuth()
  const [entries,      setEntries]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [loadError,    setLoadError]    = useState('')
  const [openDates,    setOpenDates]    = useState({})
  const [search,       setSearch]       = useState('')
  const [exporting,    setExporting]    = useState({})
  const [exportError,  setExportError]  = useState('')
  const [activePeriod, setActivePeriod] = useState('month')
  const [filter,       setFilter]       = useState(getRange('month'))
  const loadSeq = useRef(0)

  useEffect(() => { if (projectId) init(projectId, filter) }, [projectId])

  // القيود وروابط المستندات كاملة؛ أي فشل ← رسالة بلا أيام. نتيجة أقدم من آخر طلب تُهمل.
  async function init(pid, f) {
    const seq = ++loadSeq.current
    setLoading(true); setLoadError('')
    const res = await loadPeriodEntries(supabase, { projectId: pid, from: f?.from, to: f?.to, columns: COLUMNS, dateAscending: false })
    if (seq !== loadSeq.current) return
    if (res.error) { setEntries([]); setLoadError(`${res.part}: ${reason(res.error)}`) }
    else setEntries(res.data)
    setLoading(false)
  }

  function choosePeriod(type) {
    setActivePeriod(type)
    if (type === 'custom') return
    const f = getRange(type)
    setFilter(f)
    if (projectId) init(projectId, f)
  }
  function setDate(key, iso) {
    setActivePeriod('custom')
    const f = { ...filter, [key]: iso }; setFilter(f); init(projectId, f)
  }

  const groups = useMemo(() => {
    const map = {}
    entries.forEach(r => {
      const key = r.date || 'غير محدد'
      if (!map[key]) map[key] = { date: key, rows: [], journalNumber: null }
      if (!map[key].journalNumber && r.journal_number) map[key].journalNumber = r.journal_number
      map[key].rows.push(r)
    })
    return Object.values(map).sort((a, b) => b.date.localeCompare(a.date))
  }, [entries])

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups
    const s = search.trim().toLowerCase()
    return groups.filter(g =>
      g.date.includes(s) ||
      (g.journalNumber || '').toLowerCase().includes(s) ||
      g.rows.some(r =>
        (r.description || '').toLowerCase().includes(s) ||
        (r.type        || '').toLowerCase().includes(s)
      )
    )
  }, [groups, search])

  function toggleDate(date) {
    setOpenDates(prev => ({ ...prev, [date]: !prev[date] }))
  }

  // تنسيق PDF كما كان (حتى 3 منازل)؛ والشاشة بمنزلتين كبقية الهوية
  const fmtPdf = v => v ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'
  const fmt = v => (v ? formatNumber(v, 2) : '—')

  function dayTotals(rows) {
    const debit  = rows.reduce((s,r) => s+(r.cash_in||0)+(r.bank_in||0)+(r.custody_in||0)+(r.receivable_in||0), 0)
    const credit = rows.reduce((s,r) => s+(r.cash_out||0)+(r.bank_out||0)+(r.custody_out||0)+(r.receivable_out||0), 0)
    return { debit, credit, balance: debit - credit }
  }

  async function handleExport(group) {
    setExporting(p => ({ ...p, [group.date]: true })); setExportError('')
    try { await exportGroupPdf(group, fmtPdf) } catch (err) { console.error(err); setExportError(`تعذّر إنشاء ملف PDF ليوم ${group.date}.`) }
    setExporting(p => ({ ...p, [group.date]: false }))
  }

  const refYear = Number((filter.to || fmtDate(new Date())).slice(0, 4))
  const rangeText = filter.from && filter.to
    ? (filter.from === filter.to ? formatDate(filter.from, { year: true }) : `${formatDate(filter.from, { year: filter.from.slice(0, 4) !== filter.to.slice(0, 4) })} – ${formatDate(filter.to, { year: true })}`)
    : 'كل التواريخ'
  const dayText = iso => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? formatDate(iso, { refYear, day: true }) : iso)

  return (
    <div className="ldg-page jar-page">
      <div className="ts-heading">
        <div>
          <h1>أرشيف الحركات اليومية</h1>
          <p className="ldg-showing">
            <CalendarDays className="ts-icon--sm" aria-hidden="true" />
            <span>{rangeText}</span>
            <span aria-hidden="true">·</span>
            <span data-k="ja.count">{loading || loadError ? '—' : `${filteredGroups.length} يوم — ${entries.length} حركة`}</span>
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
              <span className="ts-field-label">بحث بالتاريخ أو رقم الحركة أو البيان</span>
              <SearchBox label="بحث بالتاريخ أو رقم الحركة أو البيان" value={search} onChange={setSearch} placeholder="فاتورة كهرباء أو QD-..." />
            </div>
            <Button icon={RefreshCw} onClick={() => init(projectId, filter)} disabled={loading}>تحديث</Button>
          </div>
        </div>
      </Panel>

      {exportError && <p className="ts-field-error" role="alert">{exportError}</p>}

      {loading ? (
        <Panel><div className="ldg-loading" aria-busy="true">جارٍ تحميل الحركات…</div></Panel>
      ) : loadError ? (
        <div className="ts-note ts-note--error ldg-load-error" data-k="ja.loadError" role="alert">
          <Info className="ts-icon" aria-hidden="true" />
          <div className="ts-note-body">
            <strong>تعذّر تحميل حركات هذه الفترة كاملة، فلم تُعرض الأيام ولا مجاميعها.</strong>
            عرض جزء منها كأنه كامل يعطي مجاميع وموازين خاطئة. {loadError}
            <div className="ts-note-action"><Button size="sm" variant="primary" icon={RefreshCw} onClick={() => init(projectId, filter)}>إعادة المحاولة</Button></div>
          </div>
        </div>
      ) : filteredGroups.length === 0 ? (
        <Panel><EmptyState icon={Archive}>{search ? 'لا توجد نتائج.' : 'لا توجد قيود في هذه الفترة.'}</EmptyState></Panel>
      ) : (
        <div className="jar-days">
          {filteredGroups.map(g => {
            const { debit, credit, balance } = dayTotals(g.rows)
            const isOpen   = !!openDates[g.date]
            const label    = g.journalNumber || g.date
            const isPdfing = !!exporting[g.date]
            const bodyId   = `jar-day-${g.date}`
            return (
              <section key={g.date} className={`jar-day${isOpen ? ' is-open' : ''}`} data-group={g.date}>
                <div className="jar-day-head">
                  <button type="button" className="jar-toggle" data-k="toggle" aria-expanded={isOpen} aria-controls={bodyId} onClick={() => toggleDate(g.date)}>
                    <ChevronDown className="ts-icon jar-chev" aria-hidden="true" />
                    <span className="jar-day-title">
                      <strong className="ts-num" data-k="label">{label}</strong>
                      <span data-k="date" data-iso={g.date}>{dayText(g.date)}</span>
                    </span>
                    <span className="jar-day-count" data-k="count">{g.rows.length} حركة</span>
                    <span className="jar-day-sums">
                      {debit  > 0 && <span className="is-in"><small>مدين</small> <span className="ts-num" data-k="debit">{fmt(debit)}</span></span>}
                      {credit > 0 && <span className="is-out"><small>دائن</small> <span className="ts-num" data-k="credit">{fmt(credit)}</span></span>}
                    </span>
                  </button>
                  <Button size="sm" icon={isPdfing ? RefreshCw : Download} data-k="pdf" disabled={isPdfing} onClick={() => handleExport(g)}>{isPdfing ? 'جارٍ…' : 'PDF'}</Button>
                </div>

                {isOpen && (
                  <div id={bodyId} className="jar-day-body">
                    {/* الكمبيوتر: القيد بالطريقة المحاسبية، صفّان لكل حركة */}
                    <div className="jar-table-wrap">
                      <table className="ts-table jar-table" data-table="ja.rows">
                        <thead>
                          <tr><th className="jar-n">#</th><th>البيان</th><th className="ts-end">مدين</th><th className="ts-end">دائن</th><th className="jrl-c">مستند</th></tr>
                        </thead>
                        {g.rows.map((r, i) => {
                          const { amount, debitAccount, creditAccount } = getEntryAccounts(r)
                          const desc = r.description && r.description !== r.type ? r.description : null
                          return (
                            <tbody key={r.id} data-id={r.id}>
                              <tr className="jar-dr">
                                <td className="jar-n ts-num" rowSpan={2} data-k="n">{i + 1}</td>
                                <td><span className="jar-from">من ح/ <span data-k="debitAcc">{cleanLabel(debitAccount)}</span></span></td>
                                <td className="ts-end"><span className="ts-num is-in" data-k="dAmt">{fmt(amount)}</span></td>
                                <td className="ts-end"><span className="ldg-nil">—</span></td>
                                <td className="jrl-c" rowSpan={2} data-k="doc">
                                  {r.file_url ? <IconButton bare label={r._doc_name ? `فتح المستند: ${r._doc_name}` : 'فتح المستند'} icon={FileText} className="jrl-doc" onClick={() => openFile(r.file_url)} /> : <span className="ldg-nil">—</span>}
                                </td>
                              </tr>
                              <tr className="jar-cr">
                                <td>
                                  <span className="jar-to">إلى ح/ <span data-k="creditAcc">{cleanLabel(creditAccount)}</span></span>
                                  {desc && <span className="jar-desc" data-k="desc">{desc}</span>}
                                </td>
                                <td className="ts-end"><span className="ldg-nil">—</span></td>
                                <td className="ts-end"><span className="ts-num is-out" data-k="cAmt">{fmt(amount)}</span></td>
                              </tr>
                            </tbody>
                          )
                        })}
                        <tfoot>
                          <tr className="jar-total">
                            <td colSpan={2}>الإجمالي — <span data-k="footCount">{g.rows.length}</span> حركة</td>
                            <td className="ts-end ts-num is-in" data-k="debitTotal">{debit > 0 ? fmt(debit) : '—'}</td>
                            <td className="ts-end ts-num is-out" data-k="creditTotal">{credit > 0 ? fmt(credit) : '—'}</td>
                            <td />
                          </tr>
                          <tr className={`jar-balance${balance === 0 ? ' is-even' : ''}`}>
                            <td colSpan={2}>الميزان</td>
                            <td colSpan={2} className="ts-end">
                              <span className="ts-num" data-k="balance">{fmt(Math.abs(balance))}</span>{' '}
                              <span className="jar-side" data-k="balanceSide">{balance > 0 ? '(مدين)' : balance < 0 ? '(دائن)' : '✓ متوازن'}</span>
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* الجوال: قائمة الحركات بطرفيها */}
                    <ol className="jar-moves" data-cards="ja.rows">
                      {g.rows.map((r, i) => {
                        const { amount, debitAccount, creditAccount } = getEntryAccounts(r)
                        const desc = r.description && r.description !== r.type ? r.description : null
                        return (
                          <li key={r.id} data-id={r.id}>
                            <div className="jar-move-line"><span>من ح/ {cleanLabel(debitAccount)}</span><span className="ts-num is-in">{fmt(amount)}</span></div>
                            <div className="jar-move-line is-to"><span>إلى ح/ {cleanLabel(creditAccount)}</span><span className="ts-num is-out">{fmt(amount)}</span></div>
                            {desc && <div className="jar-desc">{desc}</div>}
                            {r.file_url && <Button size="sm" variant="quiet" icon={FileText} onClick={() => openFile(r.file_url)}>المستند</Button>}
                          </li>
                        )
                      })}
                      <li className="jar-move-total">
                        <div className="jar-move-line"><span>مدين</span><span className="ts-num is-in">{debit > 0 ? fmt(debit) : '—'}</span></div>
                        <div className="jar-move-line"><span>دائن</span><span className="ts-num is-out">{credit > 0 ? fmt(credit) : '—'}</span></div>
                        <div className="jar-move-line"><span>الميزان</span><span className="ts-num">{fmt(Math.abs(balance))} {balance > 0 ? '(مدين)' : balance < 0 ? '(دائن)' : '✓ متوازن'}</span></div>
                      </li>
                    </ol>
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
