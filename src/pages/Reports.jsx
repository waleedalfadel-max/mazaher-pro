import React, { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarCheck, CalendarDays, ChevronDown, ChevronLeft, FileSpreadsheet, FileText, HandCoins, Info, Landmark, ListTree, Percent, Receipt,
  RefreshCw, ShoppingBasket, Smartphone, Store, TrendingUp, Trophy, Wallet } from 'lucide-react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { fetchEveryRow, fetchByChunks } from '../lib/fetchAll.js'
import { useAuth } from '../contexts/AuthContext'
import { getProjectSettings, isCorrupted } from '../lib/projectSettings'
import { getFinancialSummary, isSales, salesAmountNet } from '../lib/financialEngine'
import { isCounted, uncountedText } from '../lib/financeRules.js'
import { fmtDate, salesFigures, expenseFigures } from '../lib/reportFigures.js'
import { vatFigures } from '../lib/vatTreatment.js'
import { SCOPE, TITLES, exportFileName, modelToXlsx, reportModel } from '../lib/reportExport.js'
import { downloadBlob } from '../lib/reportPdf.js'
import { Button, DateInput, EmptyState, Field, Metric, Money, Panel, Segment, Select, Tabs } from '../ui/components.jsx'
import { formatDate, formatNumber, plural } from '../ui/format.js'

// صفحة التقارير بالهوية الجديدة. الحسابات منقولة كما هي من الصفحة السابقة (الدوال salesFigures وexpenseFigures
// وload)، والتغيير في العرض: الفترة والفرع ظاهران، والاختيار في العنوان (يبقى مع التحديث والرجوع)، والجداول تتمرر على الجوال.
// المبالغ تُعرض بمنزلتين عشريتين (كانت تظهر أحيانًا بثلاث). مقارنة الأرقام قبل التصميم وبعده: local-test/reports-figures.mjs.


const PERIODS = [
  { value: 'month',        label: 'الشهر الحالي' },
  { value: 'lastMonth',    label: 'الشهر الماضي' },
  { value: 'year',         label: 'السنة الحالية' },
  { value: 'month-picker', label: 'شهر محدد' },
  { value: 'custom',       label: 'فترة أخرى' },
]
const PRESETS = ['month', 'lastMonth', 'year']

const TABS = [
  { value: 'sales',     label: 'المبيعات' },
  { value: 'purchases', label: 'المصروفات' },
  { value: 'vat',       label: 'الضريبة' },
  { value: 'balance',   label: 'الأرصدة' },
]

const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']
const ISO = /^\d{4}-\d{2}-\d{2}$/

function getPeriodRange(key) {
  const n  = new Date()
  const to = fmtDate(n)
  if (key === 'month')
    return { from: `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-01`, to }
  if (key === 'lastMonth') {
    const s = new Date(n.getFullYear(), n.getMonth() - 1, 1)
    const e = new Date(n.getFullYear(), n.getMonth(), 0)
    return { from: fmtDate(s), to: fmtDate(e) }
  }
  if (key === 'quarter') {
    const q = Math.floor(n.getMonth() / 3)
    return { from: fmtDate(new Date(n.getFullYear(), q * 3, 1)), to }
  }
  return { from: `${n.getFullYear()}-01-01`, to }
}

function monthRange(year, month) {
  const last = new Date(year, month, 0).getDate()
  return { from: `${year}-${String(month).padStart(2,'0')}-01`, to: `${year}-${String(month).padStart(2,'0')}-${last}` }
}

// الاختيار من العنوان: الفترات الجاهزة تُحسب من تاريخ اليوم عند الفتح؛ الشهر المحدد والفترة الأخرى بتاريخيهما
function initialFilters(params) {
  const tab = TABS.some(t => t.value === params.get('tab')) ? params.get('tab') : 'sales'
  const branch = params.get('branch') || 'all'
  let period = PERIODS.some(p => p.value === params.get('period')) ? params.get('period') : 'month'
  let from = params.get('from'), to = params.get('to')
  if (PRESETS.includes(period)) ({ from, to } = getPeriodRange(period))
  else if (!ISO.test(from || '') || !ISO.test(to || '')) { period = 'month'; ({ from, to } = getPeriodRange('month')) }
  return { tab, branch, period, from, to }
}

// اسم التصنيف أو النوع بلا الرمز التعبيري في أوله (للعرض فقط)
const cleanLabel = s => String(s || '').replace(/^[^\p{L}\p{N}]+/u, '').trim() || String(s || '')

// ── عناصر العرض ─────────────────────────────────────────────────────────────

const fmt = v => formatNumber(v, 2)
const Num = ({ v, k, className }) => <span className={`ts-num${className ? ' ' + className : ''}`} data-k={k}>{fmt(v)}</span>
const Cell = ({ v, k, label }) => <td className="ts-end" data-label={label}>{v ? <Num v={v} k={k} /> : <span className="rpt-nil" data-k={k}>—</span>}</td>

// وصف الأرقام: النص نفسه في الشاشة والملفين (SCOPE في src/lib/reportExport.js)
function Scope({ tab }) {
  return (
    <details className="rp-scope rpt-scope">
      <summary><Info className="ts-icon--sm" aria-hidden="true" />ما الذي تشمله هذه الأرقام؟<ChevronDown className="ts-icon--sm" aria-hidden="true" /></summary>
      <div className="rp-scope-list">
        {SCOPE[tab].map(([t, x]) => t ? <div key={t}><strong>{t}: </strong>{x}</div> : <div key={x} className="rp-scope-wide">{x}</div>)}
      </div>
    </details>
  )
}

// صفوف حساب (عنوان ومبلغ) بدل IncomeRow السابق
function CalcRows({ rows, k }) {
  return (
    <dl className="rpt-calc" data-k={k}>
      {rows.map(r => (
        <div key={r.label} className={`${r.strong ? 'is-strong' : ''}${r.line ? ' has-line' : ''}${r.tone ? ' is-' + r.tone : ''}`} data-row={r.label}>
          <dt>{r.label}</dt>
          <dd><Num v={r.value} k="value" /></dd>
        </div>
      ))}
    </dl>
  )
}

// صف قابل للفتح في تفصيل المصروفات
function TreeRow({ level, label, sub, amount, pct, pctText, open, onToggle, bar, kind }) {
  const Tag = onToggle ? 'button' : 'div'
  return (
    <Tag type={onToggle ? 'button' : undefined} className={`rpt-tree-row rpt-tree-row--${level}${onToggle ? ' is-toggle' : ''}`}
      aria-expanded={onToggle ? !!open : undefined} onClick={onToggle} data-node={kind} data-label={label}>
      {onToggle ? <ChevronLeft className={`ts-icon--sm rpt-chevron${open ? ' is-open' : ''}`} aria-hidden="true" /> : <span className="rpt-chevron-space" aria-hidden="true" />}
      <span className="rpt-tree-label">{cleanLabel(label)}{sub && <small>{sub}</small>}</span>
      {pctText != null && <span className="rpt-tree-pct" data-k="pct">{pctText}</span>}
      <span className="rpt-tree-amount"><Num v={amount} k="amount" /></span>
      {bar != null && <span className="rpt-bar" aria-hidden="true"><span style={{ width: `${Math.min(Number(bar) || 0, 100)}%` }} /></span>}
    </Tag>
  )
}

// ── الصفحة ──────────────────────────────────────────────────────────────────

export default function Reports() {
  const { projectId, projectName, sessionEpoch } = useAuth()
  const [params, setParams] = useSearchParams()
  const init = useRef(initialFilters(params)).current
  const [from, setFrom]                 = useState(init.from)
  const [to,   setTo]                   = useState(init.to)
  const [activePeriod, setActivePeriod] = useState(init.period)
  const [activeTab,    setActiveTab]    = useState(init.tab)
  const [data,     setData]     = useState(null)
  const [entries,  setEntries]  = useState([])
  const [balances, setBalances] = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [loadError, setLoadError] = useState(null)   // ما تعذّر تحميله؛ لا أرقام تُعرض ولا تُصدَّر حتى تنجح إعادة المحاولة
  const [exporting,  setExporting]  = useState(null)   // 'pdf' | 'xlsx' أثناء إنشاء الملف
  const [exportError, setExportError] = useState('')
  const [branches,        setBranches]        = useState([])
  const [selectedBranch,  setSelectedBranch]  = useState(init.branch)
  const [branchEntries,   setBranchEntries]   = useState([])
  const [purchaseDocs,    setPurchaseDocs]    = useState([])
  const [docItems,        setDocItems]        = useState([])
  const [categoriesById,  setCategoriesById]  = useState({})
  const [allBranchSales,  setAllBranchSales]  = useState([])
  const [expandedCats,    setExpandedCats]    = useState(new Set())
  const [engineSummary,   setEngineSummary]   = useState(null)
  const [pickerYear,      setPickerYear]      = useState(init.period === 'month-picker' ? Number(init.from.slice(0, 4)) : new Date().getFullYear())
  const [pickerMonth,     setPickerMonth]     = useState(init.period === 'month-picker' ? Number(init.from.slice(5, 7)) : new Date().getMonth() + 1)
  const [prevPeriodSales, setPrevPeriodSales] = useState(null)
  const [prevEntries,     setPrevEntries]     = useState([])
  const [filtersOpen, setFiltersOpen] = useState(false)   // على الجوال: الفلاتر مطوية خلف «تغيير»، والاختيار ظاهر في العنوان
  const loadSeq  = useRef(0)

  const liveRef = useRef({ from: init.from, to: init.to, branch: init.branch })
  useEffect(() => { liveRef.current = { from, to, branch: selectedBranch } }, [from, to, selectedBranch])

  // الاختيار في العنوان: يبقى مع التحديث والرجوع (بلا إضافة إلى سجل المتصفح)
  useEffect(() => {
    const next = new URLSearchParams()
    if (activeTab !== 'sales') next.set('tab', activeTab)
    if (activePeriod !== 'month') next.set('period', activePeriod)
    if (!PRESETS.includes(activePeriod)) { next.set('from', from); next.set('to', to) }
    if (selectedBranch !== 'all') next.set('branch', selectedBranch)
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
  }, [activeTab, activePeriod, from, to, selectedBranch])

  useEffect(() => {
    if (projectId) {
      getProjectSettings(projectId).then(async s => {
        const raw = s?.settings?.branches || []
        const anyCorrupted = raw.length > 0 && raw.some(b => isCorrupted(b))
        if (raw.length > 0 && !anyCorrupted) {
          setBranches(raw)
        } else {
          // أسماء الفروع فاسدة أو غير موجودة — اجلبها من بيانات فعلية
          const { data } = await supabase.from('ledger_entries')
            .select('branch').eq('project_id', projectId)
            .not('branch', 'is', null).neq('branch', '')
          const unique = [...new Set((data || []).map(r => r.branch).filter(Boolean))]
          setBranches(unique.sort())
        }
      })
      const { from: f, to: t, branch: b } = liveRef.current
      load(f, t, b)
    }
  }, [projectId, sessionEpoch])

  // إعادة الجلب تلقائياً عند العودة للتبويب
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const { from: f, to: t, branch: b } = liveRef.current
      load(f, t, b)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  function choosePeriod(key) {
    if (PRESETS.includes(key)) {
      setActivePeriod(key)
      const r = getPeriodRange(key)
      setFrom(r.from); setTo(r.to)
      load(r.from, r.to)
    } else if (key === 'month-picker') {
      applyMonth(pickerYear, pickerMonth)
    } else {
      setActivePeriod('custom')   // التاريخان الحاليان يبقيان، ويُعدَّلان من الحقلين
    }
  }

  function applyMonth(year, month) {
    const r = monthRange(year, month)
    setPickerYear(year); setPickerMonth(month)
    setFrom(r.from); setTo(r.to)
    setActivePeriod('month-picker')
    load(r.from, r.to)
  }

  function changeDate(field, iso) {
    const f = field === 'from' ? iso : from, t = field === 'to' ? iso : to
    setFrom(f); setTo(t); setActivePeriod('custom')
    load(f, t)
  }

  function changeBranch(b) {
    setSelectedBranch(b)
    load(from, to, b)
  }

  // الحسابات كما كانت؛ الإضافة الوحيدة: يُهمل رد طلب أقدم إن وصل بعد طلب أحدث (تغيير سريع للفترة أو الفرع)
  async function load(fromDate = from, toDate = to, branchFilter = selectedBranch) {
    if (!projectId) return
    const seq = ++loadSeq.current
    const stale = () => seq !== loadSeq.current
    setLoading(true)

    const applyBranch = q => branchFilter !== 'all' ? q.eq('branch', branchFilter) : q

    const periodDaysLoad = Math.max(1, Math.round((new Date(toDate) - new Date(fromDate)) / 86400000) + 1)
    const [fy, fm, fd]   = fromDate.split('-').map(Number)
    const [ty, tm, td]   = toDate.split('-').map(Number)
    const prevFromD      = fmtDate(new Date(fy, fm - 2, fd))
    const prevToD        = fmtDate(new Date(ty, tm - 2, td))

    // الطلبات التي تُبنى عليها الأرقام تُجلب كاملة بترتيب ثابت (src/lib/fetchAll.js)، وأي خطأ فيها يوقف العرض برسالة
    // وإعادة محاولة بدل عرض أرقام ناقصة أو أصفار (والتصدير لا يعمل بلا أرقام)
    setLoadError(null)
    const [
      { data: ledgerFull, error: ledgerError },
      { data: allTime, error: allTimeError },
      { data: allBranchEntries },
      { data: purchaseDocsData },
      { data: allBranchSalesData },
      { data: prevEntriesData, error: prevError },
      engineResult,
    ] = await Promise.all([
      fetchEveryRow(() => applyBranch(supabase.from('ledger_entries').select('id,date,type,description,status,cash_in,bank_in,custody_in,cash_out,bank_out,custody_out,receivable_out,payable_in,payable_out,total_amount,vat_amount,journal_number,category_main,category_sub,category_id,financial_class')
        .eq('project_id', projectId).or('status.is.null,status.neq.cancelled').gte('date', fromDate).lte('date', toDate).order('date').order('id'))),
      fetchEveryRow(() => applyBranch(supabase.from('ledger_entries').select('cash_in,cash_out,bank_in,bank_out,custody_in,custody_out,payable_in,payable_out,supplier_id')
        .eq('project_id', projectId).lte('date', toDate).neq('status', 'cancelled').order('id'))),
      fetchAllRows(() => supabase.from('ledger_entries').select('branch,type,cash_in,bank_in,receivable_in,custody_in,cash_out,bank_out,custody_out')
        .eq('project_id', projectId).neq('status', 'cancelled').gte('date', fromDate).lte('date', toDate)),
      supabase.rpc('get_purchase_entries', {
        p_project_id: projectId,
        p_from:       fromDate,
        p_to:         toDate,
      }),
      fetchAllRows(() => supabase.from('sales').select('branch,cash_sales,network_sales,hunger_sales,jahez_sales,keeta_sales')
        .eq('project_id', projectId).gte('date', fromDate).lte('date', toDate)),
      fetchEveryRow(() => applyBranch(supabase.from('ledger_entries').select('type,date,status,cash_in,bank_in,receivable_in')
        .eq('project_id', projectId).neq('status','cancelled')
        .gte('date', prevFromD).lte('date', prevToD).order('id'))),
      getFinancialSummary(projectId, fromDate, toDate, branchFilter),
    ])
    if (stale()) return
    const fail = what => { if (stale()) return; setLoadError(what); setData(null); setBalances(null); setLoading(false) }
    if (ledgerError || allTimeError || prevError || !engineResult) return fail('القيود')

    // بنود التصنيف التفصيلية لكل حركة (لتفصيل المصروفات ولتمييز سداد الضريبة) — عبر journal_number، كاملة ولو تجاوزت الألف
    const jnSet = [...new Set((ledgerFull||[]).filter(e => e.journal_number).map(e => e.journal_number))]
    const { data: docItemsData, error: itemsError } = await fetchByChunks(jnSet, 100, chunk => fetchEveryRow(() => supabase
      .from('document_items')
      .select('id,journal_number,ledger_entry_id,category_id,subcategory_id,description,amount,category_main,category_sub')
      .eq('project_id', projectId)
      .in('journal_number', chunk)
      .order('id')))
    if (stale()) return
    if (itemsError) return fail('بنود المستندات')
    // التصنيفات بمعرّفها: الاسم الحالي للعرض والرمز المالي للمعالجة
    // كاملة بترتيب ثابت ولو تجاوزت حد الخادم (كما في التحليل): وإلا رجعت بنود ما بعد الصفحة الأولى لأسمائها المحفوظة
    const { data: catRows, error: catError } = await fetchEveryRow(() => supabase.from('categories').select('id,name,parent_id,financial_class').eq('project_id', projectId).order('id'))
    if (stale()) return
    if (catError) return fail('التصنيفات')

    setEngineSummary(engineResult)
    setBranchEntries(allBranchEntries || [])
    setAllBranchSales(allBranchSalesData || [])
    setPurchaseDocs(purchaseDocsData || [])

    // المبيعات من financialEngine حصرياً — مصدر الحقيقة الواحد (ledger_entries):
    // يشمل مبيعات التطبيقات (receivable_in) التي كان جدول sales يُسقطها كلياً
    // المحرّك يُعيد المبيعات صافية الآن، والإجمالي الشامل منفصلاً — فلا تُشتقّ
    // الضريبة هنا مرة أخرى (قسمة الصافي على 1.15 كانت ستُنقصه مرتين)
    const grossSales   = engineResult?.grossSales || 0
    const netSales     = engineResult?.totalSales || 0
    const totalSales   = grossSales                                                         // شامل الضريبة — لعرض تبويب الضريبة
    // حركة الفترة في تبويب الأرصدة كما كانت (كل ما له حالة غير «ملغى»)، لا مؤشر مبيعات أو مصروفات
    const moved        = (ledgerFull||[]).filter(r => r.status != null)
    const totalIn      = moved.reduce((s,r) => s+(r.cash_in||0)+(r.bank_in||0)+(r.custody_in||0), 0)
    const totalOut     = moved.reduce((s,r) => s+(r.cash_out||0)+(r.bank_out||0)+(r.custody_out||0), 0)

    setEntries(ledgerFull || [])
    setDocItems(docItemsData)
    setCategoriesById(Object.fromEntries((catRows || []).map(c => [c.id, c])))

    // ضريبة القيمة المضافة (src/lib/vatTreatment.js): المدخلات من الضريبة المسجلة على قيود غير ضريبية؛ سداد الضريبة للهيئة
    // واسترداده منفصلان لا يدخلان المدخلات ولا يُطرحان من صافي الفترة؛ وما لا يثبت معناه يُعرض لتأكيد المحاسب.
    // البنود هنا كاملة (وإلا توقف التحميل أعلاه)، فغياب بند عن قيد يعني فعلًا أنه بلا بنود.
    const vat = vatFigures({ entries: ledgerFull || [], docItems: docItemsData, outputVat: engineResult?.outputVat || 0 })
    setData({ totalSales, totalIn, totalOut, outputVat: vat.outputVat, netSales, inputVat: vat.inputVat, netVat: vat.netBeforePayment, vat })

    const at = allTime || []
    setBalances({
      cash:    at.reduce((s,r) => s+(r.cash_in||0)-(r.cash_out||0), 0),
      bank:    at.reduce((s,r) => s+(r.bank_in||0)-(r.bank_out||0), 0),
      custody: at.reduce((s,r) => s+(r.custody_in||0)-(r.custody_out||0), 0),
    })
    const prevSalesTotal = (prevEntriesData || [])
      .filter(e => isCounted(e) && isSales(e.type))
      .reduce((s, e) => s + salesAmountNet(e), 0)
    setPrevPeriodSales({ total: prevSalesTotal, days: periodDaysLoad, prevFrom: prevFromD, prevTo: prevToD })
    setPrevEntries(prevEntriesData || [])

    setLoading(false)
  }

  // تصدير القسم المختار بالفترة والفرع نفسيهما، من أرقام الشاشة نفسها (src/lib/reportExport.js)
  function currentModel() {
    const ctx = { tab: activeTab, org: projectName, from, to, branch: selectedBranch, branches, generatedAt: new Date(), engineSummary,
      prevEntriesCount: prevEntries.length, data, balances }
    if (activeTab === 'sales') ctx.s = salesFigures({ engineSummary, selectedBranch, branches, from, to, prevEntries })
    if (activeTab === 'purchases') ctx.x = expenseFigures({ entries, docItems, categoriesById, engineSummary, data })
    return reportModel(ctx)
  }
  async function exportAs(kind) {
    if (!data || loading || loadError || exporting) return
    setExporting(kind); setExportError('')
    try {
      const model = currentModel()
      window.__rptLastExport = model   // للاختبار: الوصف الذي بُني منه الملف
      if (kind === 'xlsx') {
        downloadBlob(new Blob([modelToXlsx(model)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), exportFileName(model, 'xlsx'))
      } else {
        const { modelToPdf } = await import('../lib/reportPdf.js')
        downloadBlob(await modelToPdf(model, { keep: !!window.__rptKeepPrint }), exportFileName(model, 'pdf'))
      }
    } catch (e) {
      console.error(e); setExportError('تعذّر إنشاء الملف. أعد المحاولة.')
    } finally { setExporting(null) }
  }

  const toggleCat = cat => setExpandedCats(prev => {
    const next = new Set(prev)
    next.has(cat) ? next.delete(cat) : next.add(cat)
    return next
  })

  const refYear = Number(to.slice(0, 4))
  const day = iso => formatDate(iso, { refYear })
  const dayWithName = iso => formatDate(iso, { day: true, refYear })
  // في الجدول اليومي: اسم اليوم يُخفى على الجوال ليتسع الجدول للأعمدة الأربعة
  const dayCell = iso => <><span className="rpt-dayname">{formatDate(iso, { day: true }).split(' ')[0]} </span>{day(iso)}</>
  const periodDaysShown = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1)
  const rangeText = from === to ? formatDate(from, { year: true }) : `${formatDate(from, { year: from.slice(0, 4) !== to.slice(0, 4) })} – ${formatDate(to, { year: true })}`
  const branchText = selectedBranch === 'all' ? (branches.length > 1 ? 'كل الفروع' : 'المنشأة كاملة') : selectedBranch
  const thisYear = new Date().getFullYear()
  const badRange = from > to

  return (
    <div className="rpt-page">
      <div className="ts-heading">
        <div>
          <h1>التقارير</h1>
          <p className="rpt-showing" data-shown-from={from} data-shown-to={to} data-shown-branch={selectedBranch}>
            <CalendarDays className="ts-icon--sm" aria-hidden="true" />
            <span>{rangeText}</span>
            <span className="rpt-dot" aria-hidden="true">·</span>
            <span>{plural(periodDaysShown, 'يوم واحد', 'يومان', 'أيام', 'يومًا')}</span>
            <span className="rpt-dot" aria-hidden="true">·</span>
            <Store className="ts-icon--sm" aria-hidden="true" />
            <span>{branchText}</span>
          </p>
        </div>
        <div className="ts-heading-actions">
          <Button className="rpt-mobile-only" icon={CalendarDays} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(v => !v)}>
            {filtersOpen ? 'إخفاء الفلاتر' : 'تغيير الفترة'}
          </Button>
          <Button icon={RefreshCw} onClick={() => load(from, to, selectedBranch)} disabled={loading} className={loading ? 'is-busy' : ''} aria-label="تحديث">
            <span className="ts-desktop-only">تحديث</span>
          </Button>
        </div>
      </div>

      {/* الفترة والفرع */}
      <Panel className={`rpt-filters${filtersOpen ? '' : ' is-collapsed'}`} title="الفترة والفرع" icon={CalendarDays}>
        <div className="ts-panel-body rpt-filter-body">
          <Segment label="الفترة" value={activePeriod} onChange={choosePeriod} options={PERIODS} />
          <div className="rpt-filter-row">
            {activePeriod === 'month-picker' && (
              <>
                <Field label="الشهر">
                  <Select value={pickerMonth} onChange={e => applyMonth(pickerYear, Number(e.target.value))}
                    options={MONTHS_AR.map((m, i) => ({ value: i + 1, label: m }))} />
                </Field>
                <Field label="السنة">
                  <Select value={pickerYear} onChange={e => applyMonth(Number(e.target.value), pickerMonth)}
                    options={[thisYear, thisYear - 1, thisYear - 2].map(y => ({ value: y, label: String(y) }))} />
                </Field>
              </>
            )}
            <Field label="من"><DateInput value={from} onChange={iso => changeDate('from', iso)} /></Field>
            <Field label="إلى"><DateInput value={to} onChange={iso => changeDate('to', iso)} /></Field>
            {branches.length > 1 && (
              <Field label="الفرع">
                <Select value={selectedBranch} onChange={e => changeBranch(e.target.value)}
                  options={[{ value: 'all', label: 'كل الفروع' }, ...branches.map(b => ({ value: b, label: b }))]} />
              </Field>
            )}
          </div>
          {badRange && <p className="ts-field-error">تاريخ البداية بعد تاريخ النهاية؛ لن تظهر أرقام لهذه الفترة.</p>}
          {selectedBranch !== 'all' && (
            <p className="ts-field-hint">عند اختيار فرع تُحسب قيود ذلك الفرع وحده؛ القيود غير المنسوبة لفرع (مثل الإيجار) لا تدخل.</p>
          )}
        </div>
      </Panel>

      <div className="rpt-tabs">
        <Tabs label="التقارير" tabs={TABS} value={activeTab} onChange={setActiveTab} />
        <div className="rpt-export" role="group" aria-label="تصدير هذا القسم">
          <span className="ts-muted">تصدير {TITLES[activeTab].replace('تقرير ', '')} بالفترة والفرع المعروضين:</span>
          <Button size="sm" icon={FileText} disabled={!data || loading || !!loadError || !!exporting} onClick={() => exportAs('pdf')}>{exporting === 'pdf' ? 'جارٍ إنشاء PDF…' : 'PDF'}</Button>
          <Button size="sm" icon={FileSpreadsheet} disabled={!data || loading || !!loadError || !!exporting} onClick={() => exportAs('xlsx')}>{exporting === 'xlsx' ? 'جارٍ إنشاء Excel…' : 'Excel'}</Button>
        </div>
      </div>
      {exportError && <p className="ts-field-error" role="alert">{exportError}</p>}

      {loading && (
        <div className="ts-metrics" aria-busy="true" aria-label="جارٍ التحميل">
          {[0, 1, 2].map(i => <div key={i} className="ts-metric rp-skeleton-card" />)}
        </div>
      )}

      {loadError && !loading && (
        <div className="ts-note ts-note--error rpt-load-error" data-k="load-error" role="alert">
          <Info className="ts-icon" aria-hidden="true" />
          <div className="ts-note-body">
            <strong>تعذّر تحميل {loadError} لهذه الفترة، فلم تُعرض الأرقام ولا يمكن تصديرها.</strong>
            عرض أرقام من بيانات ناقصة قد يصنّف قيدًا خطأً (مثل سداد الضريبة). تحقّق من الاتصال ثم أعد المحاولة.
            <div className="ts-note-action"><Button size="sm" variant="primary" icon={RefreshCw} onClick={() => load(from, to, selectedBranch)}>إعادة المحاولة</Button></div>
          </div>
        </div>
      )}

      {data && !loading && !loadError && (
        <div className="rpt-body" data-tab={activeTab}>
          {activeTab !== 'balance' && uncountedText(engineSummary?.uncounted) && (
            <div className="ts-note ts-note--warning" data-k="uncounted"><Info className="ts-icon" aria-hidden="true" /><div className="ts-note-body">{uncountedText(engineSummary.uncounted)}</div></div>
          )}

          {/* ══════════ المبيعات ══════════ */}
          {activeTab === 'sales' && (() => {
            const s = salesFigures({ engineSummary, selectedBranch, branches, from, to, prevEntries })
            const growthText = s.growth === null ? null : `${s.growth >= 0 ? '↑' : '↓'} ${Math.abs(s.growth).toFixed(1)}%`
            return (
              <>
                {engineSummary && (
                  <div className="ts-metrics" data-k="sales.cards">
                    <Metric label="المبيعات" icon={Wallet} tag="قبل الضريبة"
                      foot={growthText ? <><span className={s.growth >= 0 ? 'rpt-up' : 'rpt-down'}>{growthText}</span> عن الفترة نفسها من الشهر السابق</> : 'بلا مقارنة بالشهر السابق'}>
                      <span data-k="sales.total"><Money value={s.curSales} /></span>
                    </Metric>
                    <Metric label="متوسط يومي" icon={CalendarDays} foot={<>لكل يوم خلال <span className="ts-num" data-k="periodDays">{s.periodDays}</span> يوم</>}>
                      <span data-k="sales.avgDaily"><Money value={s.dailyAvg} /></span>
                    </Metric>
                    <Metric label="أعلى يوم" icon={Trophy} foot={s.bestDayEntry ? <span data-k="sales.bestDayDate" data-iso={s.bestDayEntry.date}>{dayWithName(s.bestDayEntry.date)}</span> : 'لا مبيعات'}>
                      {s.bestDayEntry ? <span data-k="sales.bestDayTotal"><Money value={s.bestDayEntry.total} /></span> : <span data-k="sales.bestDayTotal">—</span>}
                    </Metric>
                    <Metric label="أيام التشغيل" icon={CalendarCheck} foot={<>من أصل <span className="ts-num">{s.periodDays}</span> يوم</>}>
                      <span className="ts-num" data-k="sales.activeDays">{s.activeDays}</span> <small className="rpt-unit">يوم</small>
                    </Metric>
                  </div>
                )}

                {prevEntries.length > 0 && (
                  <Panel title="نمو المبيعات" icon={TrendingUp} subtitle="من بداية الفترة حتى آخر يوم فيه مبيعات، مقابل الأيام نفسها من الشهر السابق">
                    <div className="ts-panel-body rpt-growth" data-k="sales.growth" data-ranges={`${from}|${s.actualLastDate}|${s.actualPrevFromD}|${s.actualPrevToD}`}>
                      <div><span>الفترة الحالية</span><strong><Num v={s.curSales} k="cur" /></strong><small>{day(from)} – {day(s.actualLastDate)}</small></div>
                      <div><span>الفترة السابقة</span><strong><Num v={s.prevSales} k="prev" /></strong><small>{day(s.actualPrevFromD)} – {day(s.actualPrevToD)}</small></div>
                      <div><span>النمو</span>
                        <strong data-k="growth" className={s.growth === null ? '' : s.growth >= 0 ? 'rpt-up' : 'rpt-down'}>{growthText ? <span className="ts-num">{growthText}</span> : '—'}</strong>
                        <small>{s.growth === null ? 'لا مبيعات في الفترة السابقة' : s.growth >= 0 ? 'زيادة' : 'انخفاض'}</small>
                      </div>
                    </div>
                  </Panel>
                )}

                {branches.length > 1 && s.branchRows.length > 0 && (
                  <Panel title="أداء الفروع" icon={Store} subtitle="المبيعات قبل الضريبة" clip>
                    <div className="rpt-scroll">
                      <table className="ts-table rpt-table" data-table="sales.branches">
                        <thead><tr><th>الفرع</th><th className="ts-end">المبيعات</th><th className="ts-end">النسبة</th><th className="ts-end">متوسط يومي</th><th>أعلى يوم</th></tr></thead>
                        <tbody>
                          {s.branchRows.map(r => (
                            <tr key={r.branch}>
                              <td data-k="branch"><strong>{r.branch}</strong></td>
                              <td className="ts-end"><Num v={r.sales} k="sales" /></td>
                              <td className="ts-end"><span className="ts-num" data-k="share">{r.share}%</span></td>
                              <td className="ts-end"><Num v={r.daily} k="daily" /></td>
                              <td data-k="top" data-iso={r.topDate || ''}>{r.topDate ? <>{day(r.topDate)} <small><Num v={r.topAmt} k="topAmt" /></small></> : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr><td>الإجمالي</td><td className="ts-end"><Num v={s.totalSalesAll} k="sales" /></td><td className="ts-end"><span className="ts-num">100%</span></td><td className="ts-end"><Num v={s.totalSalesAll / s.periodDays} k="daily" /></td><td /></tr>
                        </tfoot>
                      </table>
                    </div>
                  </Panel>
                )}

                {s.hasAppSales && (
                  <Panel title={`مبيعات التطبيقات${branches.length > 1 ? ' لكل فرع' : ''}`} icon={Smartphone} subtitle="قبل الضريبة" clip>
                    <div className="rpt-scroll">
                      <table className="ts-table rpt-table" data-table="sales.apps">
                        <thead><tr>
                          {branches.length > 1 && <th>الفرع</th>}
                          <th className="ts-end">هنقر</th><th className="ts-end">جاهز</th><th className="ts-end">كيتا</th><th className="ts-end">مرسول</th><th className="ts-end">نينجا</th>
                          <th className="ts-end">إجمالي التطبيقات</th><th className="ts-end">% من المبيعات</th>
                        </tr></thead>
                        <tbody>
                          {(s.appBranches.length > 0 ? s.appBranches : Object.keys(s.appMap)).map(b => {
                            const v        = s.appMap[b] || { hunger: 0, jahez: 0, keeta: 0, mrsool: 0, ninja: 0 }
                            const appTotal = v.hunger + v.jahez + v.keeta + v.mrsool + v.ninja
                            const brTotal  = s.branchSalesMap[b]?.sales || 0
                            const pct      = brTotal > 0 ? (appTotal / brTotal * 100).toFixed(1) : '—'
                            return (
                              <tr key={b}>
                                {branches.length > 1 && <td data-k="branch"><strong>{b}</strong></td>}
                                <Cell v={v.hunger > 0 ? v.hunger : 0} k="hunger" /><Cell v={v.jahez > 0 ? v.jahez : 0} k="jahez" /><Cell v={v.keeta > 0 ? v.keeta : 0} k="keeta" />
                                <Cell v={v.mrsool > 0 ? v.mrsool : 0} k="mrsool" /><Cell v={v.ninja > 0 ? v.ninja : 0} k="ninja" />
                                <td className="ts-end"><strong><Num v={appTotal} k="total" /></strong></td>
                                <td className="ts-end"><span className="ts-num" data-k="pct">{pct !== '—' ? `${pct}%` : '—'}</span></td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                )}

                {s.dailyRows.length > 0 && (
                  <Panel title="المبيعات اليومية" icon={CalendarDays} subtitle="قبل الضريبة، الأحدث أولًا" clip>
                    <div className="rpt-scroll">
                      <table className="ts-table rpt-table" data-table="sales.daily">
                        <thead><tr><th>التاريخ</th><th className="ts-end">كاش</th><th className="ts-end">شبكة</th><th className="ts-end">تطبيقات</th><th className="ts-end">الإجمالي</th></tr></thead>
                        <tbody>
                          {s.dailyRows.map(r => {
                            const total = r.cash + r.bank + r.apps
                            const isTop = total === s.maxDaySales && total > 0
                            return (
                              <tr key={r.date} className={isTop ? 'rpt-top' : ''}>
                                <td data-k="date" data-iso={r.date} data-top={isTop ? '1' : ''}>
                                  {dayCell(r.date)}{isTop && <span className="ts-status rpt-top-tag">الأعلى</span>}
                                </td>
                                <Cell v={r.cash > 0 ? r.cash : 0} k="cash" /><Cell v={r.bank > 0 ? r.bank : 0} k="bank" /><Cell v={r.apps > 0 ? r.apps : 0} k="apps" />
                                <td className="ts-end"><strong><Num v={total} k="total" /></strong></td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td>الإجمالي (<span className="ts-num" data-k="days">{s.dailyRows.length}</span> يوم)</td>
                            <td className="ts-end"><Num v={s.dailyRows.reduce((t,r) => t+r.cash, 0)} k="cash" /></td>
                            <td className="ts-end"><Num v={s.dailyRows.reduce((t,r) => t+r.bank, 0)} k="bank" /></td>
                            <td className="ts-end"><Num v={s.dailyRows.reduce((t,r) => t+r.apps, 0)} k="apps" /></td>
                            <td className="ts-end"><Num v={s.dailyRows.reduce((t,r) => t+r.cash+r.bank+r.apps, 0)} k="total" /></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </Panel>
                )}

                {!engineSummary && <Panel><EmptyState icon={Wallet}>لا توجد بيانات في هذه الفترة</EmptyState></Panel>}
                {engineSummary && s.dailyRows.length === 0 && <Panel><EmptyState icon={Wallet}>لا مبيعات معتمدة في هذه الفترة{selectedBranch !== 'all' ? ' لهذا الفرع' : ''}.</EmptyState></Panel>}

                <Scope tab="sales" />
              </>
            )
          })()}

          {/* ══════════ المصروفات ══════════ */}
          {activeTab === 'purchases' && (() => {
            const x = expenseFigures({ entries, docItems, categoriesById, engineSummary, data })
            const pctOf = v => (x._sales > 0 ? ((v / x._sales) * 100).toFixed(1) : 0)
            const allKeys = [
              ...x.cogsBySubRows.map(sub => `__cogs__${sub.cat}`),
              ...x.opexRows.flatMap(r => [r.cat, ...r.subs.map(sub => `${r.cat}__${sub.cat}`)]),
              '__withdrawals__', '__debts__',
            ]
            const allOpen = allKeys.length > 0 && allKeys.every(k => expandedCats.has(k))
            const oblGroups = [
              { title: 'المسحوبات', total: x.totalW, groups: x.wGroups, key: '__withdrawals__' },
              { title: 'الأقساط والقروض', total: x.totalD, groups: x.dGroups, key: '__debts__' },
            ].filter(g => g.groups.length)
            return (
              <>
                {(x.mainRows.length > 0 || x.hasObligations) && (
                  <div className="rpt-toolbar">
                    <span className="ts-muted">المبالغ قبل الضريبة، والنسبة من المبيعات قبل الضريبة.</span>
                    <Button size="sm" variant="quiet" icon={ListTree} onClick={() => setExpandedCats(allOpen ? new Set() : new Set(allKeys))}>
                      {allOpen ? 'طي التفاصيل' : 'فتح كل التفاصيل'}
                    </Button>
                  </div>
                )}

                {x.cogsRows.length > 0 && (
                  <Panel title="تكلفة البضاعة المباعة" icon={ShoppingBasket} clip className="rpt-tree" subtitle="حسب التصنيف الفرعي"
                    action={<div className="rpt-tree-total" data-node="cogs" data-label="تكلفة البضاعة المباعة">
                      <Num v={x.cogsTotal} k="amount" />{x._sales > 0 && <small data-k="pct">{x.cogsPct}% من المبيعات</small>}
                    </div>}>
                    {x.cogsBySubRows.map(sub => {
                      const subKey = `__cogs__${sub.cat}`
                      const subOpen = expandedCats.has(subKey)
                      return (
                        <div key={sub.cat} className="rpt-tree-group">
                          <TreeRow level={2} kind="cogs-sub" label={sub.isUncat ? 'غير مصنف' : sub.label} sub={sub.mainLabel || null}
                            amount={sub.total} pctText={x._sales > 0 ? `${(sub.total / x._sales * 100).toFixed(1)}%` : null}
                            open={subOpen} onToggle={() => toggleCat(subKey)} />
                          {subOpen && sub.rows.map((row, ri) => <TreeRow key={ri} level={3} kind="row" label={row.label || '—'} amount={row.amount} />)}
                        </div>
                      )
                    })}
                  </Panel>
                )}

                {x.opexRows.length > 0 && (
                  <Panel title="المصروفات حسب التصنيف" icon={Receipt} clip className="rpt-tree" subtitle="التصنيفات الرئيسية من الأكبر">
                    {x.opexRows.map(r => {
                      const pct  = pctOf(r.total)
                      const open = expandedCats.has(r.cat)
                      return (
                        <div key={r.cat} className="rpt-tree-group">
                          <TreeRow level={1} kind="opex-main" label={r.label} amount={r.total} pctText={`${pct}%`} bar={pct}
                            open={open} onToggle={() => toggleCat(r.cat)} />
                          {open && r.subs.map(sub => {
                            const subKey  = `${r.cat}__${sub.cat}`
                            const subOpen = expandedCats.has(subKey)
                            return (
                              <div key={sub.cat} className="rpt-tree-group">
                                <TreeRow level={2} kind="opex-sub" label={sub.isUncat ? 'غير مصنف' : sub.label} amount={sub.total}
                                  pctText={x._sales > 0 ? `${pctOf(sub.total)}%` : null} open={subOpen} onToggle={() => toggleCat(subKey)} />
                                {subOpen && sub.rows.map((row, ri) => <TreeRow key={ri} level={3} kind="row" label={row.label || '—'} amount={row.amount} />)}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </Panel>
                )}

                {x.mainRows.length === 0 && !x.hasObligations && (
                  <Panel><EmptyState icon={Receipt}>لا توجد فواتير مشتريات مصنّفة في هذه الفترة<small className="rpt-empty-hint">تظهر البيانات بعد اعتماد فواتير مسؤول المشتريات</small></EmptyState></Panel>
                )}

                {x.hasObligations && (
                  <Panel title="المسحوبات والالتزامات" icon={HandCoins} clip className="rpt-tree rpt-obligations" subtitle="لا تدخل في الربح"
                    action={(x.totalW + x.totalD) > 0 ? <div className="rpt-tree-total" data-node="obl-total" data-label="إجمالي المسحوبات والالتزامات"><Num v={x.totalW + x.totalD} k="amount" /></div> : null}>
                    {oblGroups.map(g => {
                      const open = expandedCats.has(g.key)
                      return (
                        <div key={g.key} className="rpt-tree-group">
                          <TreeRow level={1} kind="obl-group" label={g.title} amount={g.total} open={open} onToggle={() => toggleCat(g.key)} />
                          {open && g.groups.map((it, i) => <TreeRow key={i} level={3} kind="obl-item" label={it.type} amount={it.total} />)}
                        </div>
                      )
                    })}
                  </Panel>
                )}

                {x.taxEntries.length > 0 && (
                  <div className="ts-note ts-note--info" data-k="purchases.taxNote">
                    <Landmark className="ts-icon" aria-hidden="true" />
                    <div className="ts-note-body">
                      {plural(x.taxEntries.length, 'قيد ضريبي واحد', 'قيدان ضريبيان', 'قيود ضريبية', 'قيدًا ضريبيًا')} بمبلغ <Num v={x.taxEntries.reduce((t, e) => t + (Number(e.cash_out) || 0) + (Number(e.bank_out) || 0) + (Number(e.custody_out) || 0), 0)} k="amount" /> لا {x.taxEntries.length === 1 ? 'يدخل' : 'تدخل'} المصروفات (كما في لوحة التحكم): سداد الضريبة للهيئة وما يحتاج تأكيد المحاسب.
                      {' '}<button type="button" className="rpt-link" onClick={() => setActiveTab('vat')}>تفاصيلها في تبويب الضريبة</button>
                    </div>
                  </div>
                )}

                <Scope tab="purchases" />
              </>
            )
          })()}

          {/* ══════════ الضريبة ══════════ */}
          {activeTab === 'vat' && (() => {
            const v = data.vat
            const due = v.netBeforePayment >= 0
            const moves = [...v.payments, ...v.refunds].sort((p, q) => String(p.date).localeCompare(String(q.date)))
            return (
            <>
              <div className="ts-metrics" data-k="vat.cards">
                <Metric label="ضريبة المخرجات" icon={Percent} foot="المبيعات ÷ 1.15 × 15%"><span data-k="vat.output"><Money value={v.outputVat} /></span></Metric>
                <Metric label="ضريبة المدخلات" icon={Receipt} foot="المسجلة على فواتير المشتريات"><span data-k="vat.input"><Money value={v.inputVat} /></span></Metric>
                <Metric label="صافي ضريبة الفترة قبل السداد" icon={Landmark}
                  foot={<span data-k="vat.netDir">{due ? 'المخرجات أكبر: مستحق للهيئة عن الفترة' : 'المدخلات أكبر: فائض لصالح المنشأة'}</span>}>
                  <span data-k="vat.net"><Money value={Math.abs(v.netBeforePayment)} /></span>
                </Metric>
                <Metric label="مدفوعات الضريبة خلال الفترة" icon={HandCoins}
                  foot={<span data-k="vat.paymentsFoot">{v.payments.length ? `${plural(v.payments.length, 'دفعة واحدة', 'دفعتان', 'دفعات', 'دفعة')}؛ لا تُطرح من صافي الفترة` : 'لا سداد مسجّل في الفترة'}{v.refunds.length ? `، ومستردات ${fmt(v.refundsTotal)}` : ''}</span>}>
                  <span data-k="vat.payments"><Money value={v.paymentsTotal} /></span>
                </Metric>
              </div>

              <Panel title="تفاصيل حساب الضريبة" icon={Landmark}>
                <div className="ts-panel-body">
                  <CalcRows k="vat.calc" rows={[
                    { label: 'إجمالي المبيعات (شامل الضريبة)', value: data.totalSales },
                    { label: 'المبيعات الصافية (÷ 1.15)', value: data.netSales },
                    { label: 'ضريبة المخرجات (15%)', value: v.outputVat, strong: true, line: true },
                    { label: 'ضريبة المدخلات (من الفواتير)', value: -v.inputVat, strong: true },
                    { label: 'صافي ضريبة الفترة قبل السداد', value: v.netBeforePayment, strong: true, line: true, tone: due ? 'due' : 'refund' },
                  ]} />
                  <div className="ts-note ts-note--info rpt-vat-note" data-k="vat.notice">
                    <Info className="ts-icon" aria-hidden="true" />
                    <div className="ts-note-body">
                      <strong>حساب للمتابعة الداخلية، يراجعه المحاسب قبل الإقرار والسداد.</strong>
                      صافي ضريبة الفترة قبل السداد <Num v={Math.abs(v.netBeforePayment)} k="amount" /> {due ? '(مستحق عن الفترة)' : '(فائض لصالح المنشأة)'}.
                      {' '}مدفوعات الضريبة المسجلة خلال الفترة لا تُطرح منه، لأن السداد قد يخص فترة سابقة ولا يحدد القيد الفترة التي يخصها.
                    </div>
                  </div>
                </div>
              </Panel>

              {moves.length > 0 && (
                <Panel title="مدفوعات ومستردات الضريبة خلال الفترة" icon={HandCoins} clip subtitle="قيود بنوع «ضريبة القيمة المضافة»: لا تدخل المصروفات ولا ضريبة المدخلات، وأثرها في الأرصدة">
                  <div className="rpt-scroll">
                    <table className="ts-table rpt-table rpt-table--stack" data-table="vat.payments">
                      <thead><tr><th>التاريخ</th><th>الوصف</th><th>الحركة</th><th>من / إلى</th><th className="ts-end">المبلغ</th></tr></thead>
                      <tbody>
                        {moves.map((r, i) => (
                          <tr key={r.id || i}>
                            <td data-label="التاريخ" data-k="date" data-iso={r.date || ''}>{r.date ? day(r.date) : '—'}</td>
                            <td data-label="الوصف" data-k="desc" className="rpt-desc">{r.description || '—'}</td>
                            <td data-label="الحركة" data-k="kind">{r.kind === 'payment' ? 'سداد' : 'استرداد'}</td>
                            <td data-label="من / إلى" data-k="source">{r.source}</td>
                            <td data-label="المبلغ" className="ts-end"><Num v={r.amount} k="amount" /></td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr><td colSpan={4}>إجمالي المدفوعات</td><td className="ts-end"><Num v={v.paymentsTotal} k="amount" /></td></tr>
                        {v.refunds.length > 0 && <tr><td colSpan={4}>إجمالي المستردات</td><td className="ts-end"><Num v={v.refundsTotal} k="amount" /></td></tr>}
                      </tfoot>
                    </table>
                  </div>
                </Panel>
              )}

              {v.review.length > 0 && (
                <Panel title={`قيود ضريبية تحتاج تأكيد المحاسب (${v.review.length})`} icon={Info} clip className="rpt-review"
                  subtitle="لم تُحسب في المصروفات ولا في ضريبة المدخلات ولا في المدفوعات، ولم يُعدَّل أي قيد">
                  <div className="rpt-scroll">
                    <table className="ts-table rpt-table rpt-table--stack" data-table="vat.review">
                      <thead><tr><th>التاريخ</th><th>النوع</th><th>الوصف</th><th className="ts-end">خارج</th><th className="ts-end">داخل</th><th className="ts-end">ضريبة مسجلة</th><th>ما يحتاج تأكيدًا</th></tr></thead>
                      <tbody>
                        {v.review.map((r, i) => (
                          <tr key={r.id || i}>
                            <td data-label="التاريخ" data-k="date" data-iso={r.date || ''}>{r.date ? day(r.date) : '—'}</td>
                            <td data-label="النوع" data-k="type">{cleanLabel(r.type)}</td>
                            <td data-label="الوصف" data-k="desc" className="rpt-desc">{r.description || '—'}</td>
                            <Cell v={r.out} k="out" label="خارج" /><Cell v={r.in} k="in" label="داخل" /><Cell v={r.vat} k="vat" label="ضريبة مسجلة" />
                            <td data-label="ما يحتاج تأكيدًا" data-k="reason" className="rpt-reason">{r.reasonText}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              )}

              {v.inputVatEntries.length > 0 && (
                <Panel title={`فواتير المشتريات — ضريبة المدخلات (${v.inputVatEntries.length})`} icon={Receipt} clip
                  action={<span className="rpt-panel-total"><Num v={v.inputVat} k="vat.entriesHead" /></span>}>
                  <div className="rpt-scroll">
                    <table className="ts-table rpt-table" data-table="vat.entries">
                      <thead><tr><th>التاريخ</th><th>البند</th><th>الوصف</th><th className="ts-end">المبلغ الإجمالي</th><th className="ts-end">الضريبة</th></tr></thead>
                      <tbody>
                        {v.inputVatEntries.map((e, i) => {
                          const total = e.signedGross   // بإشارة القيد: الآجل موجبًا والمرتجع سالبًا (vatFigures)
                          return (
                            <tr key={e.id || i}>
                              <td data-k="date" data-iso={e.date || ''}>{e.date ? day(e.date) : '—'}</td>
                              <td data-k="type">{cleanLabel(e.type) || '—'}</td>
                              <td data-k="desc" className="rpt-desc">{e.description || '—'}</td>
                              <td className="ts-end"><Num v={total} k="total" /></td>
                              <td className="ts-end"><strong><Num v={e.signedVat} k="vat" /></strong></td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={3}>إجمالي ضريبة المدخلات</td>
                          <td className="ts-end"><Num v={v.inputVatEntries.reduce((s, e) => s + e.signedGross, 0)} k="total" /></td>
                          <td className="ts-end"><Num v={v.inputVat} k="vat" /></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Panel>
              )}

              {v.inputVatEntries.length === 0 && (
                <Panel><EmptyState icon={Receipt}>لا توجد فواتير مشتريات تحتوي ضريبة في هذه الفترة</EmptyState></Panel>
              )}

              <Scope tab="vat" />
            </>
            )
          })()}

          {/* ══════════ الأرصدة ══════════ */}
          {activeTab === 'balance' && balances && (
            <>
              <div className="ts-metrics" data-k="balance.cards">
                {[
                  { label: 'رصيد الصندوق', k: 'balance.cash',    value: balances.cash },
                  { label: 'رصيد البنك',   k: 'balance.bank',    value: balances.bank },
                  { label: 'رصيد العهدة',  k: 'balance.custody', value: balances.custody },
                ].map(c => (
                  <Metric key={c.k} label={c.label} icon={Wallet} tone={c.value < 0 ? 'bad' : undefined}
                    foot={c.value < 0 ? <span className="rpt-down">رصيد سالب</span> : <>حتى {day(to)}</>}>
                    <span data-k={c.k}><Money value={c.value} /></span>
                  </Metric>
                ))}
              </div>

              <Panel title="ملخص الفترة" icon={Landmark} subtitle={`${rangeText}`}>
                <div className="ts-panel-body">
                  <CalcRows k="balance.calc" rows={[
                    { label: 'إجمالي المدين (الدخل)', value: data.totalIn, strong: true },
                    { label: 'إجمالي الدائن (الخروج)', value: data.totalOut, strong: true },
                    { label: 'صافي الفترة', value: data.totalIn - data.totalOut, strong: true, line: true },
                    { label: 'إجمالي الأرصدة النقدية', value: balances.cash + balances.bank + balances.custody, strong: true, line: true },
                  ]} />
                </div>
              </Panel>

              <Scope tab="balance" />
            </>
          )}
        </div>
      )}

    </div>
  )
}
