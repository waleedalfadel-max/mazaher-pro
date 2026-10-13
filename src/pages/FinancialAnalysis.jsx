import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarDays, ChevronLeft, CircleAlert, Info, ListChecks, ListTree, RefreshCw, Store, Target, TrendingUp } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { resolvePeriods, todayIn, trendMonths, windowText, isValidIso, fetchRange } from '../lib/analysisPeriods.js'
import { windowFigures, referenceOf, buildAnalysis, contribsFor, money, fmtPct, STATUS_LABEL } from '../lib/financialAnalysis.js'
import { checkAccess, loadAnalysisRows, setTarget, ACCESS_MESSAGES, TARGET_MESSAGES } from '../lib/analysisData.js'
import { Button, DateInput, Dialog, Field, Input, Note, Panel, Segment, Select, Switch } from '../ui/components.jsx'
import { formatDate, formatNumber, formatTime, parseDecimal, plural } from '../ui/format.js'

// التحليل المالي: ماذا تغيّر في المبيعات والتكاليف والنتيجة المسجلة، وأي بنود تستحق المراجعة ولماذا، ومن أي قيود.
// الحساب في src/lib/financialAnalysis.js (خالص ومختبر)، والقراءة في src/lib/analysisData.js، وهنا العرض وحده.
// الصفحة تُبنى من جديد عند تبديل المنشأة (المفتاح في App.jsx)، ويُهمل أي رد متأخر لطلب أقدم أو لجلسة/منشأة سابقة.

const KINDS = [
  { value: 'last_month', label: 'آخر شهر مكتمل' },
  { value: 'mtd', label: 'الشهر الحالي' },
  { value: 'month', label: 'شهر محدد' },
  { value: 'custom', label: 'فترة مخصصة' },
]
const REFS = [
  { value: 'prev', label: 'الفترة السابقة' },
  { value: 'baseline', label: 'متوسط آخر 3 فترات' },
]
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
const PERIOD_ERRORS = { future: 'الفترة تتجاوز اليوم؛ لا تُحلَّل أيام لم تأت بعد.', reversed: 'تاريخ البداية بعد تاريخ النهاية.', bad_date: 'اكتب تاريخين صحيحين.', bad_month: 'اختر شهرًا صحيحًا.' }

// ذاكرة مؤقتة داخل النافذة فقط. مفتاحها هوية الجلسة (المستخدم والدور وعمر الجلسة sessionEpoch) والمنشأة والفرع والفترة والمقارنة.
// لا يُعرض منها شيء قبل أن يثبت الخادم صلاحية الجلسة نفسها (verifiedPrefix)؛ وتُمسح كلها مع آخر أرقام الاختبار عند الخروج أو الدخول
// بهوية أخرى أو رفض الصلاحية.
const cache = new Map()
let verifiedPrefix = null
const testHook = import.meta.env.MODE === 'localtest'   // window.__faLast لاختبارات البيئة المحلية وحدها
function resetAnalysisMemory() { cache.clear(); verifiedPrefix = null; if (typeof window !== 'undefined') delete window.__faLast }
function purgeCache(prefix) { for (const k of cache.keys()) if (!k.startsWith(prefix)) cache.delete(k); if (verifiedPrefix !== prefix) verifiedPrefix = null }
supabase.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' || event === 'USER_UPDATED') resetAnalysisMemory() })

const fmt = h => formatNumber((h || 0) / 100, 2)
const Amt = ({ h, k }) => (h == null ? <span className="fa-nil" data-k={k}>—</span> : <span className="ts-num" data-k={k}>{fmt(h)}</span>)
const Pct = ({ p, k }) => <span className={p == null ? 'fa-nil' : 'ts-num'} data-k={k}>{p == null ? 'غير متاح' : fmtPct(p)}</span>
function Signed({ v, unit = '', k, digits = 1, money: isMoney }) {
  if (v == null) return <span className="fa-nil" data-k={k}>—</span>
  const n = isMoney ? v / 100 : v
  const txt = isMoney ? formatNumber(Math.abs(n), 2) : Math.abs(n).toFixed(digits)
  return <span className="ts-num" data-k={k}>{n > 0 ? '+' : n < 0 ? '−' : ''}{txt}{unit}</span>
}

function initialSel(params) {
  const kind = KINDS.some(k => k.value === params.get('period')) ? params.get('period') : 'last_month'
  const t = todayIn()
  const sel = { kind, year: Number(params.get('y')) || Number(t.slice(0, 4)), month: Number(params.get('m')) || Number(t.slice(5, 7)),
    from: params.get('from') || t.slice(0, 8) + '01', to: params.get('to') || t }
  if (kind === 'custom' && !(isValidIso(sel.from) && isValidIso(sel.to))) return { ...sel, kind: 'last_month' }
  return sel
}

export default function FinancialAnalysis() {
  const { projectId, projectName, realRole, userName, sessionEpoch } = useAuth()
  const [params, setParams] = useSearchParams()
  const [sel, setSel] = useState(() => initialSel(params))
  const [branch, setBranch] = useState(params.get('branch') || 'all')
  const [refKind, setRefKind] = useState(params.get('ref') === 'baseline' ? 'baseline' : 'prev')
  const [state, setState] = useState({ status: 'loading' })   // loading | ok | denied | error | period
  const [data, setData] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [open, setOpen] = useState(() => new Set())
  const [detail, setDetail] = useState(null)
  const [targetDlg, setTargetDlg] = useState(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const seq = useRef(0)
  const alive = useRef(true)
  // يُعاد ضبطه عند كل إعداد (StrictMode في التطوير يعيد الإعداد بعد التنظيف)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  // الاختيار في العنوان (يبقى مع التحديث والرجوع)
  useEffect(() => {
    const next = new URLSearchParams()
    if (sel.kind !== 'last_month') next.set('period', sel.kind)
    if (sel.kind === 'month') { next.set('y', sel.year); next.set('m', sel.month) }
    if (sel.kind === 'custom') { next.set('from', sel.from); next.set('to', sel.to) }
    if (branch !== 'all') next.set('branch', branch)
    if (refKind !== 'prev') next.set('ref', refKind)
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
  }, [sel, branch, refKind])

  async function load() {
    const my = ++seq.current
    const current = () => alive.current && my === seq.current
    const today = todayIn()
    const p = resolvePeriods(sel, today)
    if (!p.ok) { setData(null); setState({ status: 'period', code: p.code }); return }
    const uid = (await supabase.auth.getSession()).data?.session?.user?.id || 'none'
    const prefix = `${uid}|${realRole}|${userName}|${sessionEpoch}|${projectId}|`
    purgeCache(prefix)
    const key = `${prefix}${branch}|${JSON.stringify(sel)}|${refKind}|${today}`
    // بيانات سابقة للمفتاح نفسه تُعرض موسومة بوقتها أثناء التحديث، فقط إن ثبتت صلاحية هذه الجلسة من الخادم من قبل
    const cached = verifiedPrefix === prefix ? cache.get(key) : null
    if (!current()) return
    setData(cached || null)
    setState({ status: 'loading' })
    let verified = false
    try {
      const access = await checkAccess(supabase, projectId)
      if (!current()) return
      if (!access.ok) { resetAnalysisMemory(); setData(null); setState({ status: 'denied', code: access.code }); return }
      verifiedPrefix = prefix; verified = true
      const trend = trendMonths(p.cur.to, today, 6)
      const { from, to } = fetchRange(p, trend)   // يغطي نافذة الاتجاه كاملة، والملخص مقيد بالفترة المختارة
      const raw = await loadAnalysisRows(supabase, { projectId, branch, from, to })
      if (!current()) return
      const opts = { docItems: raw.docItems, categoriesById: raw.categoriesById }
      const cur = windowFigures(raw.rows, p.cur, opts)
      const refWindows = refKind === 'baseline' ? p.baseline : [p.prev]
      const reference = referenceOf(refKind, refWindows.map(w => windowFigures(raw.rows, w, opts)), raw.dataStart)
      const analysis = buildAnalysis(cur, reference, { targets: raw.targets, branch, noBranchRows: raw.noBranchRows, pendingDocs: raw.pendingDocs })
      const trendRows = trend.map(w => {
        const f = windowFigures(raw.rows, w, opts)
        return { w, salesH: f.salesNetH, costsH: f.costsH, resultH: f.resultH, before: !raw.dataStart || w.to < raw.dataStart }
      })
      const next = { key, fetchedAt: new Date().toISOString(), p, cur, reference, analysis, trendRows, raw, access }
      cache.set(key, next)
      if (testHook) window.__faLast = next   // للاختبار المحلي وحده: الأرقام التي بُنيت منها الشاشة
      setData(next); setState({ status: 'ok' })
    } catch (e) {
      if (!current()) return
      // جلسة لم يثبت الخادم صلاحيتها قط (جديدة أو بعد خروج ودخول): لا يبقى شيء معروض. جلسة ثبتت صلاحيتها من قبل (verifiedPrefix)
      // وتعذّر الآن تحديثها أو إعادة تحققها لانقطاع: تبقى البيانات السابقة للمفتاح نفسه موسومة بوقتها. الرفض الصريح يمسحها (أعلاه).
      const knownSession = verified || verifiedPrefix === prefix
      if (!knownSession) setData(null)
      setState({ status: 'error', part: e?.part || 'الاتصال', unverified: !knownSession })
    }
  }

  useEffect(() => { if (projectId) load() }, [projectId, sessionEpoch, sel, branch, refKind])
  // العودة إلى النافذة بعد اعتماد أو تعديل في صفحة أخرى (آلية التحديث القائمة في التقارير)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible' && projectId) load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  })

  const a = data?.analysis
  const p = data?.p
  const branches = data?.raw?.branches || []
  const loading = state.status === 'loading'
  const refLabel = p ? (refKind === 'baseline' ? `متوسط ${p.baseline.map(windowText).join('، ')}` : windowText(p.prev)) : ''
  const notes = a ? (showAll ? a.notes : a.notes.slice(0, 5)) : []
  const thisYear = Number(todayIn().slice(0, 4))
  const branchText = branch === 'all' ? (branches.length > 1 ? 'كل الفروع' : 'المنشأة كاملة') : branch

  useEffect(() => () => { if (testHook) delete window.__faLast }, [])
  const toggle = k => setOpen(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  const reportsLink = p ? `/reports?period=custom&from=${p.cur.from}&to=${p.cur.to}${branch !== 'all' ? `&branch=${encodeURIComponent(branch)}` : ''}` : '/reports'

  return (
    <div className="fa-page" data-state={state.status}>
      <div className="ts-heading">
        <div>
          <h1>التحليل المالي</h1>
          <p className="fa-showing" data-cur-from={p?.cur.from} data-cur-to={p?.cur.to} data-branch={branch} data-ref={refKind}>
            <CalendarDays className="ts-icon--sm" aria-hidden="true" />
            <span>{p ? windowText(p.cur) : '—'}</span>
            {p && <><span className="fa-dot" aria-hidden="true">·</span><span>{plural(p.cur.days, 'يوم واحد', 'يومان', 'أيام', 'يومًا')}</span></>}
            <span className="fa-dot" aria-hidden="true">·</span>
            <Store className="ts-icon--sm" aria-hidden="true" /><span>{branchText}</span>
            {p && <><span className="fa-dot" aria-hidden="true">·</span><span>مقابل {refLabel}</span></>}
          </p>
          <p className="fa-updated" data-k="fetched">
            {data ? <>حتى آخر تحديث: {fetchedText(data.fetchedAt)}{loading ? ' — يُحدَّث الآن…' : state.status === 'error' ? ' (بيانات سابقة؛ فشل التحديث)' : ''}</> : loading ? 'جارٍ التحميل…' : ''}
          </p>
        </div>
        <div className="ts-heading-actions">
          <Button className="fa-mobile-only" icon={CalendarDays} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(v => !v)}>
            {filtersOpen ? 'إخفاء الفلاتر' : 'تغيير الفترة'}
          </Button>
          <Button icon={RefreshCw} onClick={load} disabled={loading} className={loading ? 'is-busy' : ''} aria-label="تحديث">
            <span className="ts-desktop-only">تحديث</span>
          </Button>
        </div>
      </div>

      <Panel className={`fa-filters${filtersOpen ? '' : ' is-collapsed'}`} title="الفترة والفرع والمقارنة" icon={CalendarDays}>
        <div className="ts-panel-body fa-filter-body">
          <Segment label="الفترة" value={sel.kind} onChange={k => setSel(s => ({ ...s, kind: k }))} options={KINDS} />
          <div className="fa-filter-row">
            {sel.kind === 'month' && <>
              <Field label="الشهر">
                <Select value={sel.month} onChange={e => setSel(s => ({ ...s, month: Number(e.target.value) }))} options={MONTHS_AR.map((m, i) => ({ value: i + 1, label: m }))} />
              </Field>
              <Field label="السنة">
                <Select value={sel.year} onChange={e => setSel(s => ({ ...s, year: Number(e.target.value) }))} options={[thisYear, thisYear - 1, thisYear - 2].map(y => ({ value: y, label: String(y) }))} />
              </Field>
            </>}
            {sel.kind === 'custom' && <>
              <Field label="من"><DateInput value={sel.from} onChange={iso => setSel(s => ({ ...s, from: iso }))} /></Field>
              <Field label="إلى"><DateInput value={sel.to} onChange={iso => setSel(s => ({ ...s, to: iso }))} /></Field>
            </>}
            {branches.length > 1 && (
              <Field label="الفرع">
                <Select value={branch} onChange={e => setBranch(e.target.value)} options={[{ value: 'all', label: 'كل الفروع' }, ...branches.map(b => ({ value: b, label: b }))]} />
              </Field>
            )}
          </div>
          <div className="fa-ref-row">
            <span className="fa-ref-label">المقارنة</span>
            <Segment label="المقارنة" value={refKind} onChange={setRefKind} options={REFS} />
          </div>
        </div>
      </Panel>

      {state.status === 'period' && <Note tone="warning" icon={CircleAlert} title="الفترة غير صالحة">{PERIOD_ERRORS[state.code] || 'اختر فترة أخرى.'}</Note>}
      {state.status === 'denied' && (
        <Note tone="error" icon={CircleAlert} title="لا صلاحية لعرض التحليل">{ACCESS_MESSAGES[state.code] || 'رفض الخادم الطلب.'}</Note>
      )}
      {state.status === 'error' && (
        <Note tone="error" icon={CircleAlert} title={`تعذّر تحميل ${state.part}`}
          action={<Button size="sm" icon={RefreshCw} onClick={load}>إعادة المحاولة</Button>}>
          لا تُعرض أرقام ناقصة ولا أصفار بدل البيانات.{data ? ` المعروض أدناه من تحديث سابق (${fetchedText(data.fetchedAt)}).` : ''}
        </Note>
      )}
      {loading && !data && <div className="fa-loading" role="status">جارٍ تحميل التحليل…</div>}

      {a && (
        <div className={`fa-body${state.status !== 'ok' ? ' is-stale' : ''}`}>
          {data.cur.n === 0 && <Note tone="info" icon={Info} title="لا بيانات في الفترة">لا قيود معتمدة في هذه الفترة لهذا الفرع حسب السجل.</Note>}
          <section className="fa-summary" aria-label="الملخص">
            <SummaryCard k="sales" label="صافي المبيعات" icon={TrendingUp} row={a.sales}
              foot={<>المتوسط اليومي <Amt h={a.sales.daily.curH} k="daily" /> مقابل <Amt h={a.sales.daily.refH} k="daily-ref" /></>} />
            <SummaryCard k="costs" label="التكاليف المسجلة" row={a.costs} ratio />
            <SummaryCard k="cogs" label="مشتريات المواد" row={a.cogs} ratio hint="مشتريات الفترة لا تكلفة الاستهلاك" />
            <SummaryCard k="result" label="النتيجة حسب القيود المسجلة" row={a.result} margin={a.margin}
              hint="المبيعات ناقص التكاليف المسجلة؛ ليست ربحًا محاسبيًا مكتملًا" />
          </section>

          {!a.refValid && (
            <Note tone="warning" icon={Info} title="مقارنة غير كافية">
              لا فترة مقارنة صالحة ({data.reference.windows.map(x => `${windowText(x.window)}: ${x.reasonText || 'صالحة'}`).join('، ')}). تُعرض الأرقام الوصفية ويؤجَّل الحكم.
            </Note>
          )}

          <Panel title="ملاحظات للمراجعة" icon={ListChecks}
            subtitle={a.refValid ? `${plural(a.notes.length, 'ملاحظة واحدة', 'ملاحظتان', 'ملاحظات', 'ملاحظة')}، منها ${a.adverseCount} بأثر سلبي. الترتيب بالفرق بالريال؛ حسب البيانات المسجلة، لا تشخيص نهائي.` : 'لا ملاحظات بلا مقارنة صالحة.'}>
            {a.notes.length === 0 && a.refValid && (
              <div className="ts-panel-body"><p className="fa-muted" data-k="no-notes">{a.allSame ? 'المبالغ والنسب كما في المرجع بالهللة حسب القيود المسجلة.' : 'لا ملاحظات بحسب معايير هذه الصفحة (تغيّر نسبة بند أو مبلغه، أو بند جديد أو غائب، أو تراجع المبيعات أو الهامش، أو تجاوز هدف).'} هذا لا يعني اكتمال التسجيل؛ راجع حدود البيانات أدناه.</p></div>
            )}
            <ol className="fa-notes" data-count={a.notes.length}>
              {notes.map((n, i) => (
                <NoteCard key={n.kind + n.lineKey} n={n} rank={i + 1} p={p} refLabel={refLabel} onDetails={() => setDetail({ keys: n.detailKeys || [n.lineKey], label: n.label, which: 'cur' })}
                  reportsLink={reportsLink} />
              ))}
            </ol>
            {a.notes.length > 5 && (
              <div className="fa-more"><Button size="sm" onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>{showAll ? 'عرض أهم خمس فقط' : `عرض الكل (${a.notes.length})`}</Button></div>
            )}
          </Panel>

          <Panel title="مقارنة البنود" icon={ListTree} clip
            subtitle="النسبة من صافي مبيعات كل فترة. الرئيسي مجموع بنوده ولا يُجمع معها. «فرق عن النسبة المرجعية» = مبلغ البند − (النسبة المرجعية × مبيعات الفترة)، وليس خسارة أو وفرًا مثبتًا.">
            <div className="fa-scroll">
              <table className="ts-table fa-table" data-table="lines">
                <thead><tr>
                  <th>البند</th><th className="ts-end">الفترة</th><th className="ts-end">{refKind === 'baseline' ? 'المتوسط المرجعي' : 'المقارنة'}</th>
                  <th className="ts-end">الفرق</th><th className="ts-end">التغير</th><th className="ts-end">من المبيعات</th><th className="ts-end">المرجع</th>
                  <th className="ts-end">بالنقاط</th><th className="ts-end">فرق عن النسبة المرجعية</th><th className="ts-end">الهدف</th>
                </tr></thead>
                <tbody>
                  {a.lines.map(line => {
                    const multi = !(line.children.length === 1 && line.children[0].leafOfMain)
                    const isOpen = open.has(line.key)
                    return (
                      <React.Fragment key={line.key}>
                        <tr className={`fa-main${line.uncategorized ? ' is-uncat' : ''}`} data-line={line.label}>
                          <th scope="row">
                            {multi ? (
                              <button type="button" className="fa-toggle" aria-expanded={isOpen} onClick={() => toggle(line.key)}>
                                <ChevronLeft className={`ts-icon--sm fa-chevron${isOpen ? ' is-open' : ''}`} aria-hidden="true" />{line.label}
                              </button>
                            ) : (
                              <button type="button" className="fa-linkish" onClick={() => setDetail({ keys: [line.children[0].key], label: line.label, which: 'cur' })}>{line.label}</button>
                            )}
                            {line.uncategorized && <small>غير مصنف</small>}
                            {line.settlement && <small>سداد آجل سابق</small>}
                            {line.unlinked && <small>غير مربوط بتصنيف</small>}
                          </th>
                          <LineCells r={line} target={line.targetEval} />
                        </tr>
                        {multi && isOpen && line.children.map(c => (
                          <tr key={c.key} className="fa-sub" data-line={c.label}>
                            <th scope="row"><button type="button" className="fa-linkish" onClick={() => setDetail({ keys: [c.key], label: `${c.label} (${line.label})`, which: 'cur' })}>{c.label}</button></th>
                            <LineCells r={c} target={c.targetEval} />
                          </tr>
                        ))}
                      </React.Fragment>
                    )
                  })}
                  {!a.lines.length && <tr><td colSpan={10}><span className="fa-muted">لا تكاليف مسجلة في الفترتين.</span></td></tr>}
                </tbody>
                <tfoot>
                  <tr data-line="total"><th scope="row">التكاليف المسجلة</th><LineCells r={a.costs} target={a.targetRows.find(t => t.itemKey === 'costs_total')} /></tr>
                </tfoot>
              </table>
            </div>
          </Panel>

          <TrendPanel rows={data.trendRows} />

          {data.access?.can_set_targets && (
            <TargetsPanel a={a} raw={data.raw} branch={branch} onAdd={() => setTargetDlg({})} />
          )}

          <Panel title="حدود البيانات" icon={Info}>
            <ul className="fa-limits ts-panel-body" data-k="limits">
              {a.limits.map(l => <li key={l.key} data-limit={l.key} className={l.tone ? `is-${l.tone}` : ''}>{l.text}</li>)}
              {data.raw.pendingDocs == null && <li data-limit="docs-unavailable">عدد المستندات بانتظار الاعتماد غير متاح الآن.</li>}
            </ul>
          </Panel>
        </div>
      )}

      <DetailDialog detail={detail} data={data} onClose={() => setDetail(null)} onWhich={which => setDetail(d => ({ ...d, which }))} />
      {targetDlg && <TargetDialog a={a} branch={branch} p={p} onClose={() => setTargetDlg(null)} onSaved={() => { setTargetDlg(null); load() }} />}
    </div>
  )
}

// وقت الجلب بتوقيت المنشأة (ساعة:دقيقة)
const fetchedText = iso => {
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
  return formatTime('0000-00-00T' + t)
}

function SummaryCard({ k, label, icon: Icon, row, ratio, margin, foot, hint }) {
  return (
    <div className="fa-card" data-card={k}>
      <div className="fa-card-top">{Icon && <Icon className="ts-icon--sm" aria-hidden="true" />}<span>{label}</span></div>
      <div className="fa-card-value"><Amt h={row.curH} k="cur" /> <small>ر.س</small></div>
      <div className="fa-card-line">المقارنة <Amt h={row.refH} k="ref" /> · الفرق <Signed v={row.diffH} money k="diff" />
        {row.rel != null && <> (<Signed v={row.rel * 100} unit="%" k="rel" />)</>}</div>
      {ratio && <div className="fa-card-line">من المبيعات <Pct p={row.curPct} k="pct" /> مقابل <Pct p={row.refPct} k="ref-pct" />
        {row.pp != null && <> (<Signed v={row.pp} unit=" نقطة" k="pp" />)</>}</div>}
      {margin && <div className="fa-card-line">الهامش <Pct p={margin.cur} k="margin" /> مقابل <Pct p={margin.ref} k="margin-ref" /></div>}
      {foot && <div className="fa-card-line">{foot}</div>}
      {hint && <div className="fa-card-hint">{hint}</div>}
    </div>
  )
}

function LineCells({ r, target }) {
  return <>
    <td className="ts-end"><Amt h={r.curH} k="cur" /></td>
    <td className="ts-end"><Amt h={r.refH} k="ref" /></td>
    <td className="ts-end"><Signed v={r.diffH} money k="diff" /></td>
    <td className="ts-end">{r.refH === 0 && r.curH > 0 ? <span className="fa-tag" data-k="rel">بند جديد</span> : r.rel == null ? <span className="fa-nil" data-k="rel">—</span> : <Signed v={r.rel * 100} unit="%" k="rel" />}</td>
    <td className="ts-end"><Pct p={r.curPct} k="pct" /></td>
    <td className="ts-end"><Pct p={r.refPct} k="ref-pct" /></td>
    <td className="ts-end"><Signed v={r.pp} k="pp" /></td>
    <td className="ts-end"><Signed v={r.gapH} money k="gap" /></td>
    <td className="ts-end" data-k="target">{target?.target ? <span className={target.exceeded ? 'fa-over' : ''}>{fmtPct(target.target.ratio)}{target.exceeded ? ' — تجاوز' : ''}</span>
      : target?.startsInside ? <span className="fa-muted">يبدأ داخل الفترة</span> : <span className="fa-nil">—</span>}</td>
  </>
}

const KIND_TAG = { ratio_up: 'ارتفاع نسبة', new: 'بند جديد', gone: 'غائب', ratio_down: 'انخفاض نسبة', amount_up: 'ارتفاع مبلغ', amount_down: 'انخفاض مبلغ',
  sales_down: 'المبيعات', margin_down: 'الهامش', target_exceeded: 'هدف المنشأة', amount_change: 'تغيّر مبلغ' }

function NoteCard({ n, rank, p, refLabel, onDetails, reportsLink }) {
  const r = n.row
  return (
    <li className={`fa-note${n.adverse ? ' is-adverse' : ''}`} data-kind={n.kind} data-line={n.lineKey}>
      <details>
        <summary>
          <span className="fa-rank ts-num" aria-hidden="true">{rank}</span>
          <span className="fa-note-title">{n.title}</span>
          <span className="fa-tag">{n.adverse ? 'أثر سلبي' : 'تغيّر'} · {KIND_TAG[n.kind]}</span>
          {n.impactH != null && <span className="fa-note-amt"><Signed v={n.impactH} money k="impact" /></span>}
        </summary>
        <div className="fa-note-body">
          {r && (
            <dl className="fa-facts">
              <div><dt>الفترة ({windowText(p.cur)})</dt><dd><Amt h={r.curH} k="cur" />{r.curPct != null && <> · <Pct p={r.curPct} k="pct" /></>}</dd></div>
              <div><dt>المرجع ({refLabel})</dt><dd><Amt h={r.refH} k="ref" />{r.refPct != null && <> · <Pct p={r.refPct} k="ref-pct" /></>}</dd></div>
              <div><dt>الفرق</dt><dd><Signed v={r.diffH} money k="diff" />{r.pp != null && <> · <Signed v={r.pp} unit=" نقطة مئوية" k="pp" /></>}</dd></div>
              {r.gapH != null && n.kind !== 'sales_down' && n.kind !== 'margin_down' && <div><dt>فرق عن النسبة المرجعية</dt><dd><Signed v={r.gapH} money k="gap" /></dd></div>}
            </dl>
          )}
          <p>{n.explain}</p>
          <p className="fa-action"><strong>إجراء مراجعة: </strong>{n.action}</p>
          {n.flags?.length > 0 && <ul className="fa-flags">{n.flags.map(f => <li key={f}>{f}</li>)}</ul>}
          <div className="fa-note-actions">
            {!n.detailKeys?.length
              ? <Link className="ts-btn ts-btn--sm" to={reportsLink}>فتح التقارير لنفس الفترة</Link>
              : <Button size="sm" onClick={onDetails}>عرض التفاصيل</Button>}
          </div>
        </div>
      </details>
    </li>
  )
}

function TrendPanel({ rows }) {
  const max = Math.max(1, ...rows.filter(r => !r.before).map(r => Math.max(r.salesH, r.costsH)))
  return (
    <Panel title="الاتجاه الشهري" icon={TrendingUp} subtitle="صافي المبيعات والتكاليف المسجلة لكل شهر متاح. الشهر الجزئي موسوم.">
      <div className="fa-trend ts-panel-body" aria-hidden="true">
        {rows.map(r => (
          <div key={r.w.from} className="fa-trend-col">
            <div className="fa-trend-bars">
              {r.before ? <span className="fa-trend-none">—</span> : <>
                <span className="fa-bar fa-bar--sales" style={{ height: `${Math.max(2, r.salesH / max * 100)}%` }} />
                <span className="fa-bar fa-bar--costs" style={{ height: `${Math.max(2, Math.max(0, r.costsH) / max * 100)}%` }} />
              </>}
            </div>
            <span className="fa-trend-label">{MONTHS_AR[Number(r.w.from.slice(5, 7)) - 1]}{r.w.partial ? '*' : ''}</span>
          </div>
        ))}
      </div>
      <div className="fa-legend ts-panel-body" aria-hidden="true"><span><i className="fa-key fa-key--sales" />المبيعات (عمود مصمت)</span><span><i className="fa-key fa-key--costs" />التكاليف (عمود مخطط)</span></div>
      <div className="fa-scroll">
        <table className="ts-table fa-table" data-table="trend">
          <caption className="ts-sr">القيم الشهرية للرسم</caption>
          <thead><tr><th>الشهر</th><th className="ts-end">صافي المبيعات</th><th className="ts-end">التكاليف المسجلة</th><th className="ts-end">النتيجة</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.w.from} data-month={r.w.month}>
                <th scope="row">{windowText(r.w)}{r.w.partial ? ' (جزئي)' : ''}</th>
                {r.before ? <td colSpan={3}><span className="fa-muted">قبل بداية السجل</span></td> : <>
                  <td className="ts-end"><Amt h={r.salesH} k="sales" /></td><td className="ts-end"><Amt h={r.costsH} k="costs" /></td><td className="ts-end"><Amt h={r.resultH} k="result" /></td>
                </>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function TargetsPanel({ a, raw, branch, onAdd }) {
  const scope = branch === 'all' ? null : branch
  const rows = raw.targets.filter(t => (t.branch || null) === scope)
  return (
    <Panel title="أهداف المنشأة" icon={Target} subtitle={`أهداف نسب يحددها المالك ${scope ? `لفرع ${scope}` : 'للمنشأة كاملة'}. لا أهداف جاهزة مفروضة؛ الهدف لا يغيّر تقييم فترة قبل سريانه.`}
      action={<Button size="sm" icon={Target} onClick={onAdd}>هدف جديد</Button>}>
      <div className="ts-panel-body">
        {!rows.length ? <p className="fa-muted">لا أهداف لهذا النطاق.</p> : (
          <ul className="fa-target-list" data-k="targets">
            {rows.slice().reverse().map(t => (
              <li key={t.id}><strong>{t.item_label}</strong>: {t.active ? `${fmtPct(Number(t.ratio), 2)} من المبيعات` : 'أُوقف'} — من {formatDate(t.effective_from, { year: true })}</li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}

function TargetDialog({ a, branch, p, onClose, onSaved }) {
  const items = useMemo(() => [
    { value: 'costs_total', label: 'التكاليف المسجلة' }, { value: 'cogs_total', label: 'مشتريات المواد' },
    ...a.lines.flatMap(l => [{ value: l.targetKey, label: l.label },
      ...l.children.filter(c => !c.leafOfMain && !c.noSub).map(c => ({ value: c.targetKey, label: `${c.label} (${l.label})` }))]),
  ], [a])
  const today = todayIn()
  const [form, setForm] = useState({ item: items[0].value, ratio: '', from: today.slice(0, 8) + '01', active: true })
  const [err, setErr] = useState(''); const [saving, setSaving] = useState(false)
  const ratio = parseDecimal(form.ratio)
  async function save() {
    if (saving) return
    if (form.active && !(ratio >= 0 && ratio <= 1000)) return setErr(TARGET_MESSAGES.ratio_invalid)
    if (!isValidIso(form.from)) return setErr(TARGET_MESSAGES.date_required)
    setSaving(true); setErr('')
    const res = await setTarget(supabase, { itemKey: form.item, itemLabel: items.find(i => i.value === form.item)?.label, branch, ratio, effectiveFrom: form.from, active: form.active })
    setSaving(false)
    if (res.ok) onSaved(); else setErr(TARGET_MESSAGES[res.code] || res.message || 'تعذّر الحفظ.')
  }
  return (
    <Dialog open title="هدف نسبة للمنشأة" description={`النطاق: ${branch === 'all' ? 'المنشأة كاملة' : `فرع ${branch}`}. يُحفظ صفًا جديدًا بتاريخ سريانه؛ الأهداف السابقة تبقى لفتراتها.`}
      onClose={onClose} footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ'}</Button></>}>
      <div className="fa-form">
        <Field label="البند"><Select value={form.item} onChange={e => setForm(f => ({ ...f, item: e.target.value }))} options={items} /></Field>
        <Switch label="إيقاف الهدف لهذا البند" hint="يلغي الهدف من تاريخ السريان، دون حذف السابق." checked={!form.active} onChange={v => setForm(f => ({ ...f, active: !v }))} />
        {form.active && <Field label="النسبة المستهدفة من صافي المبيعات (%)" hint="الصفر هدف صالح: أي مبلغ يتجاوزه.">
          <Input numeric value={form.ratio} onChange={e => setForm(f => ({ ...f, ratio: e.target.value }))} placeholder="مثال: 30" />
        </Field>}
        <Field label="يسري من"><DateInput value={form.from} onChange={iso => setForm(f => ({ ...f, from: iso }))} /></Field>
        {err && <p className="ts-field-error" role="alert">{err}</p>}
      </div>
    </Dialog>
  )
}

function DetailDialog({ detail, data, onClose, onWhich }) {
  if (!detail || !data) return null
  const { p, cur, reference } = data
  const groups = detail.which === 'cur'
    ? [{ w: p.cur, rows: detail.keys.flatMap(k => contribsFor(cur, k)), valid: true }]
    : reference.windows.map(x => ({ w: x.window, rows: detail.keys.flatMap(k => contribsFor(x.fig, k)), valid: x.valid, reason: x.reasonText }))
  return (
    <Dialog open title={`تفاصيل: ${detail.label}`} description="القيود المحتسبة في هذا البند بالفترة والفرع نفسيهما. القيد المتعدد البنود يظهر بحصة هذا البند من صافيه." onClose={onClose}>
      <Segment label="الفترة" value={detail.which} onChange={onWhich} options={[{ value: 'cur', label: 'الفترة' }, { value: 'ref', label: 'المرجع' }]} />
      {groups.map(g => {
        const totalH = g.rows.reduce((s, r) => s + Math.round(r.amount * 100), 0)
        return (
          <section key={g.w.from} className="fa-detail" data-window={g.w.from}>
            <h3>{windowText(g.w)}{!g.valid && ` — مستبعدة من المقارنة (${g.reason})`}</h3>
            {!g.rows.length ? <p className="fa-muted">لا قيود لهذا البند.</p> : (
              <div className="fa-scroll">
                <table className="ts-table fa-table" data-table="detail">
                  <thead><tr><th>التاريخ</th><th>رقم القيد</th><th>الوصف</th><th className="ts-end">المحتسب</th></tr></thead>
                  <tbody>
                    {g.rows.slice().sort((x, y) => x.date.localeCompare(y.date)).map((r, i) => (
                      <tr key={r.id + ':' + i} data-entry={r.id}>
                        <td>{formatDate(r.date)}</td><td className="ts-num">{r.jn || '—'}</td>
                        <td>{r.item ? <>{r.item}<small>{r.description}</small></> : r.description || r.type}{r.status !== 'approved' && <small>{STATUS_LABEL[r.status] || r.status}</small>}</td>
                        <td className="ts-end"><span className="ts-num" data-k="amount">{formatNumber(r.amount, 2)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={3}>المجموع</td><td className="ts-end"><span className="ts-num" data-k="total">{formatNumber(totalH / 100, 2)}</span></td></tr></tfoot>
                </table>
              </div>
            )}
          </section>
        )
      })}
    </Dialog>
  )
}
