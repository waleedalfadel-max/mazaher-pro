import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { getProjectSettings, isCorrupted } from '../lib/projectSettings'
import { getFinancialSummary, isSales, isExcluded, isCOGS, isWithdrawal, isDebt } from '../lib/financialEngine'
import { aggregateSupplierBalances } from '../lib/payableBalances'

const NAVY = '#1B3A5C'
const GOLD = '#6EB7B0'

const ROLE_AR = { owner: 'المالك', accountant: 'المحاسب', purchasing: 'مسؤول المشتريات', cashier: 'الكاشير' }

const QUICK_PERIODS = [
  { key: 'month',     label: 'الشهر الحالي' },
  { key: 'lastMonth', label: 'الشهر الماضي' },
  { key: 'year',      label: 'السنة الحالية' },
]

const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

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

function cleanFileName(name) {
  return (name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
}

function KpiCard({ label, value, icon, positive, neutral }) {
  const fmt = v => Math.abs(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })
  const neg  = !neutral && value < 0
  const color = neutral ? NAVY : neg ? '#dc2626' : positive ? '#16a34a' : NAVY
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm flex flex-col items-center gap-2 text-center"
      style={{ border: `1px solid #e8e5dc` }}>
      <div className="flex flex-col items-center gap-1">
        <span className="text-xl">{icon}</span>
        <span className="text-xs font-semibold text-slate-500">{label}</span>
      </div>
      <div className="text-xl font-bold font-mono tabular-nums" style={{ color }}>
        {fmt(value)}
      </div>
      {neg && <div className="text-xs text-red-500 font-semibold">⚠️ رصيد سالب</div>}
    </div>
  )
}

function IncomeRow({ label, value, bold, indent, color, line }) {
  const fmt = v => (v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })
  return (
    <>
      {line && <div className="border-t my-2" style={{ borderColor: '#e8e5dc' }} />}
      <div className="py-2" style={{ display: 'grid', gridTemplateColumns: '1fr 7.5rem' }}>
        <span className={`text-sm text-right ${bold ? 'font-bold' : 'font-medium'}`}
          style={{ color: color || (bold ? NAVY : '#4b5563') }}>
          {label}
        </span>
        <span className={`text-sm font-mono tabular-nums ${bold ? 'font-bold' : ''}`}
          style={{ color: color || (bold ? NAVY : '#6b7280'), direction: 'ltr', textAlign: 'left' }}>
          {fmt(value)}
        </span>
      </div>
    </>
  )
}

const ALL_TABS = [
  { key: 'sales',     label: 'المبيعات',    icon: '💵' },
  { key: 'purchases', label: 'المصروفات',   icon: '🛒' },
  { key: 'vat',       label: 'الضريبة',     icon: '🏛️' },
  { key: 'balance',   label: 'الأرصدة',     icon: '⚖️' },
  { key: 'payables',  label: 'الذمم',       icon: '🧾' },
]

export default function Reports() {
  const { projectId, role, projectName } = useAuth()
  const navigate = useNavigate()
  const isOwner = role === 'owner'
  const isBaAsal = (projectName || '').includes('بـ عسل')
  const init = getPeriodRange('month')
  const [from, setFrom]                 = useState(init.from)
  const [to,   setTo]                   = useState(init.to)
  const [activePeriod, setActivePeriod] = useState('month')
  const [activeTab,    setActiveTab]    = useState('sales')
  const [data,     setData]     = useState(null)
  const [entries,  setEntries]  = useState([])
  const [docs,     setDocs]     = useState([])
  const [balances, setBalances] = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [exporting,  setExporting]  = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [branches,        setBranches]        = useState([])
  const [selectedBranch,  setSelectedBranch]  = useState('all')
  const [branchEntries,   setBranchEntries]   = useState([])
  const [purchaseDocs,    setPurchaseDocs]    = useState([])
  const [allBranchSales,  setAllBranchSales]  = useState([])
  const [expandedCats,    setExpandedCats]    = useState(new Set())
  const [engineSummary,   setEngineSummary]   = useState(null)
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const [pickerYear,      setPickerYear]      = useState(new Date().getFullYear())
  const [pickerMonth,     setPickerMonth]     = useState(new Date().getMonth() + 1)
  const [prevPeriodSales, setPrevPeriodSales] = useState(null)
  const [payableBalance,     setPayableBalance]     = useState(0)
  const [payableSupplierRows, setPayableSupplierRows] = useState([])
  const [prevEntries,     setPrevEntries]     = useState([])
  const pdfRef          = useRef()
  const docsRowRefs     = useRef([])
  const monthPickerRef  = useRef()

  const liveRef = useRef({ from: init.from, to: init.to, branch: 'all' })
  useEffect(() => { liveRef.current = { from, to, branch: selectedBranch } }, [from, to, selectedBranch])

  useEffect(() => {
    function onOutside(e) {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target)) setShowMonthPicker(false)
    }
    if (showMonthPicker) document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [showMonthPicker])

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
      load(init.from, init.to)
    }
  }, [projectId])

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

  function applyPreset(key) {
    setActivePeriod(key)
    setShowMonthPicker(false)
    const r = getPeriodRange(key)
    setFrom(r.from); setTo(r.to)
    load(r.from, r.to)
  }

  function applyMonthPicker() {
    const last = new Date(pickerYear, pickerMonth, 0).getDate()
    const from = `${pickerYear}-${String(pickerMonth).padStart(2,'0')}-01`
    const to   = `${pickerYear}-${String(pickerMonth).padStart(2,'0')}-${last}`
    setFrom(from); setTo(to)
    setActivePeriod('month-picker')
    setShowMonthPicker(false)
    load(from, to)
  }

  async function load(fromDate = from, toDate = to, branchFilter = selectedBranch) {
    if (!projectId) return
    setLoading(true)

    const applyBranch = q => branchFilter !== 'all' ? q.eq('branch', branchFilter) : q

    const periodDaysLoad = Math.max(1, Math.round((new Date(toDate) - new Date(fromDate)) / 86400000) + 1)
    const [fy, fm, fd]   = fromDate.split('-').map(Number)
    const [ty, tm, td]   = toDate.split('-').map(Number)
    const prevFromD      = fmtDate(new Date(fy, fm - 2, fd))
    const prevToD        = fmtDate(new Date(ty, tm - 2, td))

    const [
      { data: sales },
      { data: ledger },
      { data: ledgerFull },
      { data: documents },
      { data: allTime },
      { data: allBranchEntries },
      { data: purchaseDocsData },
      { data: allBranchSalesData },
      { data: prevEntriesData },
      { data: payableSuppliersData },
      engineResult,
    ] = await Promise.all([
      applyBranch(supabase.from('sales').select('cash_sales,network_sales')
        .eq('project_id', projectId).gte('date', fromDate).lte('date', toDate)),
      applyBranch(supabase.from('ledger_entries').select('type,cash_out,bank_out,custody_out,cash_in,bank_in,custody_in,vat_amount')
        .eq('project_id', projectId).neq('status', 'cancelled').gte('date', fromDate).lte('date', toDate)),
      applyBranch(supabase.from('ledger_entries').select('id,date,type,description,cash_in,bank_in,custody_in,cash_out,bank_out,custody_out,total_amount,vat_amount,journal_number,category_main,category_sub')
        .eq('project_id', projectId).neq('status', 'cancelled').gte('date', fromDate).lte('date', toDate).order('date')),
      supabase.from('documents').select('file_name,uploaded_by,uploaded_at,analysis_result,journal_number,file_url')
        .eq('project_id', projectId).eq('status','approved')
        .gte('uploaded_at', fromDate).lte('uploaded_at', toDate + 'T23:59:59').order('uploaded_at'),
      applyBranch(supabase.from('ledger_entries').select('cash_in,cash_out,bank_in,bank_out,custody_in,custody_out,payable_in,payable_out,supplier_id')
        .eq('project_id', projectId).lte('date', toDate).neq('status', 'cancelled')),
      supabase.from('ledger_entries').select('branch,type,cash_in,bank_in,receivable_in,custody_in,cash_out,bank_out,custody_out')
        .eq('project_id', projectId).neq('status', 'cancelled').gte('date', fromDate).lte('date', toDate),
      supabase.rpc('get_purchase_entries', {
        p_project_id: projectId,
        p_from:       fromDate,
        p_to:         toDate,
      }),
      supabase.from('sales').select('branch,cash_sales,network_sales,hunger_sales,jahez_sales,keeta_sales')
        .eq('project_id', projectId).gte('date', fromDate).lte('date', toDate),
      applyBranch(supabase.from('ledger_entries').select('type,date,cash_in,bank_in,receivable_in')
        .eq('project_id', projectId).neq('status','cancelled')
        .gte('date', prevFromD).lte('date', prevToD)),
      supabase.from('payable_suppliers').select('id,name').eq('project_id', projectId).order('name'),
      getFinancialSummary(projectId, fromDate, toDate),
    ])
    setEngineSummary(engineResult)
    setBranchEntries(allBranchEntries || [])
    setAllBranchSales(allBranchSalesData || [])
    setPurchaseDocs(purchaseDocsData || [])

    const sum    = (list, field) => (list||[]).reduce((s,r) => s+(Number(r[field])||0), 0)
    const sumOut = (list, types) => (list||[]).filter(r=>types.includes(r.type))
      .reduce((s,r) => s+(r.cash_out||0)+(r.bank_out||0)+(r.custody_out||0), 0)

    const cashSales    = sum(sales,'cash_sales')
    const networkSales = sum(sales,'network_sales')
    const totalSales   = cashSales + networkSales
    const opEx         = sumOut(ledger, ['🛒 مصروفات تشغيلية'])
    const fixEx        = sumOut(ledger, ['💰 مصروفات ثابتة'])
    const loans        = sumOut(ledger, ['💳 قسط سيارة','💳 قسط شراء أرض','💳 قرض ١','💳 قرض ٢'])
    const draws        = sumOut(ledger, ['💼 مسحوبات سليمان','💼 مسحوبات فايز'])
    const grossProfit  = totalSales - opEx - fixEx
    const netProfit    = grossProfit - loans
    const netFlow      = netProfit - draws
    const margin       = totalSales > 0 ? (netProfit / totalSales * 100).toFixed(1) : 0
    const totalIn      = (ledgerFull||[]).reduce((s,r) => s+(r.cash_in||0)+(r.bank_in||0)+(r.custody_in||0), 0)
    const totalOut     = (ledgerFull||[]).reduce((s,r) => s+(r.cash_out||0)+(r.bank_out||0)+(r.custody_out||0), 0)

    // حسابات ضريبة القيمة المضافة
    const outputVat    = totalSales / 1.15 * 0.15                                          // ضريبة المخرجات من المبيعات
    const netSales     = totalSales - outputVat                                             // المبيعات الصافية بدون ضريبة

    // ضريبة المدخلات: من حقل vat_amount (فواتير عادية) + قيود نوعها "ضريبة القيمة المضافة"
    const inputVatFromField   = (ledger||[])
      .filter(r => !r.type?.includes('ضريبة القيمة المضافة'))
      .reduce((s,r) => s + (Number(r.vat_amount)||0), 0)
    const inputVatFromEntries = (ledger||[])
      .filter(r => r.type?.includes('ضريبة القيمة المضافة'))
      .reduce((s,r) => s + (Number(r.cash_out)||0) + (Number(r.bank_out)||0) + (Number(r.custody_out)||0), 0)
    const inputVat     = inputVatFromField + inputVatFromEntries

    const netVat       = outputVat - inputVat                                               // الصافي المستحق لهيئة الزكاة

    // تفصيل فواتير المشتريات التي تحتوي ضريبة (من vat_amount + قيود منفصلة)
    const vatEntries = [
      ...(ledgerFull||[]).filter(r => (r.vat_amount||0) > 0 && !r.type?.includes('ضريبة القيمة المضافة')),
      ...(ledgerFull||[])
        .filter(r => r.type?.includes('ضريبة القيمة المضافة'))
        .map(r => ({ ...r, vat_amount: (r.cash_out||0) + (r.bank_out||0) + (r.custody_out||0) }))
        .filter(r => r.vat_amount > 0),
    ]

    setData({ cashSales, networkSales, totalSales, opEx, fixEx, loans, draws, grossProfit, netProfit, netFlow, margin, totalIn, totalOut, outputVat, netSales, inputVat, netVat, vatEntries })
    setEntries(ledgerFull || [])
    setDocs(documents || [])

    const at = allTime || []
    setBalances({
      cash:    at.reduce((s,r) => s+(r.cash_in||0)-(r.cash_out||0), 0),
      bank:    at.reduce((s,r) => s+(r.bank_in||0)-(r.bank_out||0), 0),
      custody: at.reduce((s,r) => s+(r.custody_in||0)-(r.custody_out||0), 0),
    })
    setPayableBalance(at.reduce((s,r) => s+(r.payable_in||0)-(r.payable_out||0), 0))
    setPayableSupplierRows(
      aggregateSupplierBalances(payableSuppliersData || [], at)
        .sort((a, b) => b.balance - a.balance)
    )
    const prevSalesTotal = (prevEntriesData || [])
      .filter(e => isSales(e.type))
      .reduce((s, e) => s + (Number(e.cash_in)||0) + (Number(e.bank_in)||0) + (Number(e.receivable_in)||0), 0)
    setPrevPeriodSales({ total: prevSalesTotal, days: periodDaysLoad, prevFrom: prevFromD, prevTo: prevToD })
    setPrevEntries(prevEntriesData || [])

    setLoading(false)
  }

  const trialBalance = useMemo(() => {
    const map = {}
    entries.forEach(e => {
      const key = e.type || '— غير محدد'
      if (!map[key]) map[key] = { type: key, debit: 0, credit: 0 }
      map[key].debit  += (e.cash_in||0)  + (e.bank_in||0)  + (e.custody_in||0)
      map[key].credit += (e.cash_out||0) + (e.bank_out||0) + (e.custody_out||0)
    })
    return Object.values(map).sort((a, b) => (b.debit + b.credit) - (a.debit + a.credit))
  }, [entries])

  async function exportPdf() {
    if (!data || !pdfRef.current) return
    setExporting(true)
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'), import('html2canvas'),
      ])
      const el = pdfRef.current
      el.style.display = 'block'
      await new Promise(r => setTimeout(r, 150))
      const containerRect = el.getBoundingClientRect()
      const containerH    = el.offsetHeight || containerRect.height
      const linkData = docsRowRefs.current
        .map((rowEl, i) => {
          if (!rowEl || !docs[i]?.file_url) return null
          const rowRect = rowEl.getBoundingClientRect()
          return { url: docs[i].file_url, topRatio: (rowRect.top - containerRect.top) / containerH, heightRatio: rowRect.height / containerH }
        }).filter(Boolean)
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' })
      el.style.display = 'none'
      const imgData = canvas.toDataURL('image/png')
      const pdf   = new jsPDF('p', 'mm', 'a4')
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const imgH  = (canvas.height * pageW) / canvas.width
      let yOffset = 0, remaining = imgH
      while (remaining > 0) {
        pdf.addImage(imgData, 'PNG', 0, -yOffset, pageW, imgH)
        remaining -= pageH; yOffset += pageH
        if (remaining > 0) pdf.addPage()
      }
      const totalPages = Math.ceil(imgH / pageH)
      linkData.forEach(({ url, topRatio, heightRatio }) => {
        const pdfYTotal = topRatio * imgH
        const pageNum   = Math.floor(pdfYTotal / pageH)
        if (pageNum < totalPages) {
          pdf.setPage(pageNum + 1)
          pdf.link(0, pdfYTotal - pageNum * pageH, pageW, Math.max(heightRatio * imgH, 5), { url })
        }
      })
      pdf.save(`تقرير-${from}-${to}.pdf`)
    } catch(e) { console.error(e) }
    setExporting(false)
  }

  async function previewPdf() {
    if (!data || !pdfRef.current) return
    setPreviewing(true)
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'), import('html2canvas'),
      ])
      const el = pdfRef.current
      el.style.display = 'block'
      await new Promise(r => setTimeout(r, 150))
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, allowTaint: true })
      el.style.display = 'none'
      const imgData = canvas.toDataURL('image/png')
      const pdf   = new jsPDF('p', 'mm', 'a4')
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const imgH  = (canvas.height * pageW) / canvas.width
      let yOffset = 0, remaining = imgH
      while (remaining > 0) {
        pdf.addImage(imgData, 'PNG', 0, -yOffset, pageW, imgH)
        remaining -= pageH; yOffset += pageH
        if (remaining > 0) pdf.addPage()
      }
      const blobUrl = pdf.output('bloburl')
      window.open(blobUrl, '_blank')
    } catch(e) { console.error(e) }
    setPreviewing(false)
  }

  const fmt  = v => (v||0).toLocaleString('en-US', { minimumFractionDigits: 2 })
  const fmtD = d => d ? new Date(d).toLocaleDateString('en-GB') : ''

  let legacySeq = 0
  const entriesDisplay = entries.map(e => ({
    ...e, _displayNum: e.journal_number || `OLD-${String(++legacySeq).padStart(3,'0')}`,
  }))

  const cardBorder = { border: '1px solid #e8e5dc' }

  return (
    <div className="space-y-5">

      {/* ── رأس الصفحة ── */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold" style={{ color: NAVY }}>التقارير المالية</h1>
        <button
          onClick={() => load(from, to, selectedBranch)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all shrink-0"
          style={{ background: '#f5f4f0', color: NAVY, border: '1px solid #e8e5dc' }}
          title="إعادة تحميل البيانات"
        >
          <span className={loading ? 'animate-spin inline-block' : ''}>🔄</span>
          <span className="hidden sm:inline">تحديث</span>
        </button>
      </div>

      {/* ── فلتر الفترة ── */}
      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3" style={cardBorder}>
        <div className="text-sm font-bold uppercase tracking-wider text-center" style={{ color: '#8a7a5a' }}>الفترة الزمنية</div>
        <div className="flex flex-wrap gap-2 justify-center">
          {QUICK_PERIODS.map(p => (
            <button key={p.key} onClick={() => applyPreset(p.key)}
              className="px-3 py-1.5 text-xs rounded-xl font-semibold transition-all"
              style={activePeriod === p.key
                ? { background: GOLD, color: NAVY }
                : { background: '#f5f4f0', color: '#4b5563' }
              }>
              {p.label}
            </button>
          ))}
          {/* زر شهر محدد */}
          <div className="relative" ref={monthPickerRef}>
            <button
              onClick={() => setShowMonthPicker(v => !v)}
              className="px-3 py-1.5 text-xs rounded-xl font-semibold transition-all"
              style={activePeriod === 'month-picker'
                ? { background: GOLD, color: NAVY }
                : { background: '#f5f4f0', color: '#4b5563' }
              }>
              {activePeriod === 'month-picker'
                ? `${MONTHS_AR[pickerMonth - 1]} ${pickerYear} ▼`
                : 'شهر محدد ▼'}
            </button>
            {showMonthPicker && (
              <div className="absolute top-full mt-1 z-50 bg-white rounded-2xl shadow-xl p-3 min-w-[190px]"
                style={{ borderColor: '#e8e5dc', border: '1px solid #e8e5dc', direction: 'rtl', left: 0 }}>
                <div className="text-xs font-bold text-slate-500 mb-2">اختر الشهر والسنة</div>
                <div className="flex gap-2 mb-2">
                  <select value={pickerMonth} onChange={e => setPickerMonth(Number(e.target.value))}
                    className="flex-1 border rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                    style={{ borderColor: '#d1c9b8' }}>
                    {MONTHS_AR.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                  <select value={pickerYear} onChange={e => setPickerYear(Number(e.target.value))}
                    className="w-20 border rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                    style={{ borderColor: '#d1c9b8' }}>
                    {[new Date().getFullYear(), new Date().getFullYear()-1, new Date().getFullYear()-2].map(y =>
                      <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <button onClick={applyMonthPicker}
                  className="w-full py-1.5 rounded-xl text-xs font-bold"
                  style={{ background: NAVY, color: '#fff' }}>
                  تطبيق
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-3 items-end justify-center">
          <div>
            <label className="text-xs text-slate-500 block mb-1 text-center">من</label>
            <input type="date" value={from}
              onChange={e => { setFrom(e.target.value); setActivePeriod('custom'); load(e.target.value, to) }}
              className="border rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: '#d1c9b8' }} />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1 text-center">إلى</label>
            <input type="date" value={to}
              onChange={e => { setTo(e.target.value); setActivePeriod('custom'); load(from, e.target.value) }}
              className="border rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: '#d1c9b8' }} />
          </div>
          {branches.length > 1 && (
            <div>
              <label className="text-xs text-slate-500 block mb-1 text-center">الفرع</label>
              <select value={selectedBranch}
                onChange={e => { setSelectedBranch(e.target.value); load(from, to, e.target.value) }}
                className="border rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#d1c9b8' }}>
                <option value="all">جميع الفروع</option>
                {branches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* ── تحميل ── */}
      {loading && (
        <div className="flex justify-center py-16">
          <div className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: GOLD, borderTopColor: 'transparent' }}/>
        </div>
      )}

      {data && !loading && (
        <>
          {/* ── تبويبات ── */}
          {(() => {
            const visibleTabs = ALL_TABS.filter(t => t.key !== 'payables' || isBaAsal)
            return (
              <div className="flex flex-row w-full gap-1 p-1 rounded-2xl" style={{ background: '#e8e5dc' }}>
                {visibleTabs.map(t => (
                  <button key={t.key} onClick={() => setActiveTab(t.key)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-2 text-xs font-bold rounded-xl transition-all"
                    style={activeTab === t.key
                      ? { background: '#fff', color: NAVY, boxShadow: '0 1px 4px rgba(15,36,68,0.1)' }
                      : { color: '#6b7280' }
                    }>
                    <span>{t.icon}</span> {t.label}
                  </button>
                ))}
              </div>
            )
          })()}

          {/* ══════════════════ TAB: المبيعات (المالك فقط) ══════════════════ */}
          {activeTab === 'sales' && (() => {
            const salesEntries = (engineSummary?.entries || [])
              .filter(e => isSales(e.type))
              .filter(e => selectedBranch === 'all' || !selectedBranch || e.branch === selectedBranch)
            const periodDays   = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1)

            // القسم 1: أداء الفروع
            const branchSalesMap = {}
            salesEntries.forEach(e => {
              const b = e.branch || '— غير محدد'
              if (!branchSalesMap[b]) branchSalesMap[b] = { sales: 0, byDate: {} }
              const amt = (Number(e.cash_in)||0) + (Number(e.bank_in)||0) + (Number(e.receivable_in)||0)
              branchSalesMap[b].sales += amt
              if (e.date) branchSalesMap[b].byDate[e.date] = (branchSalesMap[b].byDate[e.date] || 0) + amt
            })
            const totalSalesAll = Object.values(branchSalesMap).reduce((s, v) => s + v.sales, 0)
            const branchRows = (branches.length > 1 ? branches : Object.keys(branchSalesMap))
              .filter(b => branchSalesMap[b])
              .map(b => {
                const entries2  = branchSalesMap[b].byDate
                const topDay    = Object.entries(entries2).sort(([,a],[,bb]) => bb - a)[0]
                return { branch: b, sales: branchSalesMap[b].sales, share: totalSalesAll > 0 ? (branchSalesMap[b].sales / totalSalesAll * 100).toFixed(1) : '0.0', daily: branchSalesMap[b].sales / periodDays, topDate: topDay?.[0] || null, topAmt: topDay?.[1] || 0 }
              })

            // القسم 2: التطبيقات لكل فرع
            const appMap = {}
            salesEntries.forEach(e => {
              const b = e.branch || '— غير محدد'
              const t = e.type || ''
              const amt = (Number(e.cash_in)||0) + (Number(e.bank_in)||0) + (Number(e.receivable_in)||0)
              if (!t.includes('هنقر') && !t.includes('جاهز') && !t.includes('كيتا') && !t.includes('مرسول')) return
              if (!appMap[b]) appMap[b] = { hunger: 0, jahez: 0, keeta: 0, mrsool: 0 }
              if (t.includes('هنقر')) appMap[b].hunger += amt
              if (t.includes('جاهز')) appMap[b].jahez  += amt
              if (t.includes('كيتا')) appMap[b].keeta  += amt
              if (t.includes('مرسول')) appMap[b].mrsool += amt
            })
            const hasAppSales = Object.values(appMap).some(v => v.hunger + v.jahez + v.keeta + v.mrsool > 0)
            const appBranches = branches.length > 0 ? branches.filter(b => appMap[b]) : Object.keys(appMap)

            // القسم 3: النمو — بناءً على آخر تاريخ فيه مبيعات فعلية
            const actualLastDate  = salesEntries.length > 0
              ? salesEntries.reduce((max, e) => e.date > max ? e.date : max, salesEntries[0].date)
              : to
            const [fy2, fm2, fd2] = from.split('-').map(Number)
            const [ty2, tm2, td2] = actualLastDate.split('-').map(Number)
            const actualPrevFromD = fmtDate(new Date(fy2, fm2 - 2, fd2))
            const actualPrevToD   = fmtDate(new Date(ty2, tm2 - 2, td2))
            const curSales  = salesEntries.reduce((s, e) => s + (Number(e.cash_in)||0) + (Number(e.bank_in)||0) + (Number(e.receivable_in)||0), 0)
            const prevSales = prevEntries
              .filter(e => isSales(e.type) && e.date >= actualPrevFromD && e.date <= actualPrevToD)
              .reduce((s, e) => s + (Number(e.cash_in)||0) + (Number(e.bank_in)||0) + (Number(e.receivable_in)||0), 0)
            const growth    = prevSales > 0 ? ((curSales - prevSales) / prevSales * 100) : null

            // القسم 4: المبيعات اليومية
            const dailyMap = {}
            salesEntries.forEach(e => {
              const d = e.date; if (!d) return
              if (!dailyMap[d]) dailyMap[d] = { date: d, cash: 0, bank: 0, apps: 0 }
              dailyMap[d].cash += Number(e.cash_in)       || 0
              dailyMap[d].bank += Number(e.bank_in)       || 0
              dailyMap[d].apps += Number(e.receivable_in) || 0
            })
            const dailyRows    = Object.values(dailyMap).sort((a, b) => b.date.localeCompare(a.date))
            const maxDaySales  = Math.max(...dailyRows.map(r => r.cash + r.bank + r.apps), 1)

            // بطاقات الملخص
            const dailyAvg     = curSales / periodDays
            const bestDayEntry = dailyRows.reduce((best, r) => {
              const t = r.cash + r.bank + r.apps
              return t > (best?.total || 0) ? { date: r.date, total: t } : best
            }, null)
            const activeDays = dailyRows.length

            return (
              <div className="space-y-5">

                {/* بطاقات الملخص */}
                {engineSummary && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-white rounded-2xl p-4 shadow-sm" style={{ ...cardBorder, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6 }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">📅</span>
                        <span className="text-xs font-semibold text-slate-500">متوسط يومي</span>
                      </div>
                      <div className="text-xl font-bold font-mono tabular-nums" style={{ color: NAVY }}>{fmt(dailyAvg)}</div>
                      <div className="text-xs text-slate-400">ريال لكل يوم خلال {periodDays} يوم</div>
                    </div>

                    <div className="bg-white rounded-2xl p-4 shadow-sm" style={{ ...cardBorder, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6 }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">🏆</span>
                        <span className="text-xs font-semibold text-slate-500">أعلى يوم</span>
                      </div>
                      {bestDayEntry ? (
                        <>
                          <div className="text-xl font-bold font-mono tabular-nums" style={{ color: '#16a34a' }}>{fmt(bestDayEntry.total)}</div>
                          <div className="text-xs text-slate-400">{fmtD(bestDayEntry.date)}</div>
                        </>
                      ) : <div className="text-slate-400 text-sm">—</div>}
                    </div>

                    <div className="bg-white rounded-2xl p-4 shadow-sm" style={{ ...cardBorder, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6 }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">✅</span>
                        <span className="text-xs font-semibold text-slate-500">أيام التشغيل</span>
                      </div>
                      <div className="text-xl font-bold font-mono tabular-nums" style={{ color: NAVY }}>
                        {activeDays} <span className="text-sm font-normal text-slate-500">يوم</span>
                      </div>
                      <div className="text-xs text-slate-400">من أصل {periodDays} يوم</div>
                    </div>
                  </div>
                )}

                {/* القسم 1: أداء الفروع */}
                {branches.length > 1 && branchRows.length > 0 && (
                  <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={cardBorder}>
                    <div className="px-5 py-4" style={{ background: NAVY }}>
                      <h2 className="font-bold text-white text-sm">🏪 أداء الفروع</h2>
                      <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{from} — {to}</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ background: '#f5f4f0', borderBottom: `2px solid ${GOLD}` }}>
                            <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>الفرع</th>
                            <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: '#16a34a' }}>المبيعات</th>
                            <th className="px-4 py-3 text-right text-xs font-bold text-slate-400">النسبة</th>
                            <th className="px-4 py-3 text-right text-xs font-bold text-slate-500">متوسط يومي</th>
                            <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: GOLD }}>أعلى يوم</th>
                          </tr>
                        </thead>
                        <tbody>
                          {branchRows.map((r, i) => (
                            <tr key={r.branch} style={{ borderBottom: '1px solid #f5f4f0', background: i % 2 === 0 ? '#fff' : '#fafaf8' }}>
                              <td className="px-4 py-3 font-semibold text-xs" style={{ color: NAVY }}>🏢 {r.branch}</td>
                              <td className="px-4 py-3 font-mono tabular-nums font-bold text-xs" style={{ color: '#16a34a' }}>{fmt(r.sales)}</td>
                              <td className="px-4 py-3 font-mono tabular-nums text-xs text-slate-400">{r.share}%</td>
                              <td className="px-4 py-3 font-mono tabular-nums text-xs text-slate-500">{fmt(r.daily)}</td>
                              <td className="px-4 py-3 text-xs" style={{ color: GOLD }}>
                                {r.topDate ? <>{fmtD(r.topDate)} — <span className="font-mono font-bold">{fmt(r.topAmt)}</span></> : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: NAVY }}>
                            <td className="px-4 py-3 text-xs font-bold text-white">الإجمالي</td>
                            <td className="px-4 py-3 font-mono tabular-nums font-bold text-xs" style={{ color: '#86efac' }}>{fmt(totalSalesAll)}</td>
                            <td className="px-4 py-3 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>100%</td>
                            <td className="px-4 py-3 font-mono tabular-nums text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>{fmt(totalSalesAll / periodDays)}</td>
                            <td className="px-4 py-3" />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}

                {/* القسم 2: مبيعات التطبيقات */}
                {hasAppSales && (
                  <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={cardBorder}>
                    <div className="px-5 py-4" style={{ background: NAVY }}>
                      <h2 className="font-bold text-white text-sm">📱 مبيعات التطبيقات{branches.length > 1 ? ' لكل فرع' : ''}</h2>
                      <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{from} — {to}</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ background: '#f5f4f0', borderBottom: `2px solid ${GOLD}` }}>
                            {branches.length > 1 && <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>الفرع</th>}
                            <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: '#ef4444' }}>هنقر</th>
                            <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: '#f97316' }}>جاهز</th>
                            <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: '#8b5cf6' }}>كيتا</th>
                            <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: '#10b981' }}>مرسول</th>
                            <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>إجمالي التطبيقات</th>
                            <th className="px-4 py-3 text-right text-xs font-bold text-slate-400">% من المبيعات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(appBranches.length > 0 ? appBranches : Object.keys(appMap)).map((b, i) => {
                            const v        = appMap[b] || { hunger: 0, jahez: 0, keeta: 0, mrsool: 0 }
                            const appTotal = v.hunger + v.jahez + v.keeta + v.mrsool
                            const brTotal  = branchSalesMap[b]?.sales || 0
                            const pct      = brTotal > 0 ? (appTotal / brTotal * 100).toFixed(1) : '—'
                            return (
                              <tr key={b} style={{ borderBottom: '1px solid #f5f4f0', background: i % 2 === 0 ? '#fff' : '#fafaf8' }}>
                                {branches.length > 1 && <td className="px-4 py-3 font-semibold text-xs" style={{ color: NAVY }}>🏢 {b}</td>}
                                <td className="px-4 py-2 font-mono tabular-nums text-xs" style={{ color: v.hunger > 0 ? '#ef4444' : '#d1d5db' }}>{v.hunger > 0 ? fmt(v.hunger) : '—'}</td>
                                <td className="px-4 py-2 font-mono tabular-nums text-xs" style={{ color: v.jahez  > 0 ? '#f97316' : '#d1d5db' }}>{v.jahez  > 0 ? fmt(v.jahez)  : '—'}</td>
                                <td className="px-4 py-2 font-mono tabular-nums text-xs" style={{ color: v.keeta  > 0 ? '#8b5cf6' : '#d1d5db' }}>{v.keeta  > 0 ? fmt(v.keeta)  : '—'}</td>
                                <td className="px-4 py-2 font-mono tabular-nums text-xs" style={{ color: v.mrsool > 0 ? '#10b981' : '#d1d5db' }}>{v.mrsool > 0 ? fmt(v.mrsool) : '—'}</td>
                                <td className="px-4 py-2 font-mono tabular-nums font-bold text-xs" style={{ color: NAVY }}>{fmt(appTotal)}</td>
                                <td className="px-4 py-2 font-mono tabular-nums text-xs text-slate-400">{pct !== '—' ? `${pct}%` : '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* القسم 3: النمو */}
                {prevEntries.length > 0 && (
                  <div className="bg-white rounded-2xl p-5 shadow-sm" style={cardBorder}>
                    <div className="flex items-center justify-between flex-wrap gap-4">
                      <div>
                        <div className="text-sm font-bold mb-1" style={{ color: NAVY }}>📈 نمو المبيعات</div>
                        <div className="text-xs text-slate-400">
                          الحالية: {from} → {actualLastDate} | السابقة: {actualPrevFromD} → {actualPrevToD}
                        </div>
                      </div>
                      <div className="flex items-center gap-5">
                        <div className="text-center">
                          <div className="text-xs text-slate-400 mb-0.5">الفترة الحالية</div>
                          <div className="font-mono font-bold tabular-nums text-base" style={{ color: NAVY }}>{fmt(curSales)}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-slate-400 mb-0.5">الفترة السابقة</div>
                          <div className="font-mono font-bold tabular-nums text-base text-slate-400">{fmt(prevSales)}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-slate-400 mb-0.5">النمو</div>
                          {growth === null ? (
                            <div className="text-sm font-bold text-slate-400">—</div>
                          ) : (
                            <div className={`text-2xl font-bold ${growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {growth >= 0 ? '↑' : '↓'} {Math.abs(growth).toFixed(1)}%
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* القسم 4: مبيعات يومية */}
                {dailyRows.length > 0 && (
                  <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={cardBorder}>
                    <div className="px-5 py-4" style={{ background: NAVY }}>
                      <h2 className="font-bold text-white text-sm">📅 المبيعات اليومية</h2>
                      <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{from} — {to}</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ background: '#f5f4f0', borderBottom: `2px solid ${GOLD}` }}>
                            <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>التاريخ</th>
                            <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: '#16a34a' }}>كاش</th>
                            <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: '#1d4ed8' }}>شبكة</th>
                            <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: '#f97316' }}>تطبيقات</th>
                            <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>الإجمالي</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dailyRows.map((r, i) => {
                            const total = r.cash + r.bank + r.apps
                            const isTop = total === maxDaySales && total > 0
                            return (
                              <tr key={r.date} style={{ borderBottom: '1px solid #f5f4f0', background: isTop ? '#f0fdf4' : i % 2 === 0 ? '#fff' : '#fafaf8' }}>
                                <td className="px-4 py-2 text-xs font-semibold" style={{ color: isTop ? '#15803d' : '#4b5563' }}>
                                  {isTop && <span className="ml-1">🏆</span>}{fmtD(r.date)}
                                </td>
                                <td className="px-4 py-2 font-mono tabular-nums text-xs" style={{ color: r.cash > 0 ? '#16a34a' : '#d1d5db' }}>{r.cash > 0 ? fmt(r.cash) : '—'}</td>
                                <td className="px-4 py-2 font-mono tabular-nums text-xs" style={{ color: r.bank > 0 ? '#1d4ed8' : '#d1d5db' }}>{r.bank > 0 ? fmt(r.bank) : '—'}</td>
                                <td className="px-4 py-2 font-mono tabular-nums text-xs" style={{ color: r.apps > 0 ? '#f97316' : '#d1d5db' }}>{r.apps > 0 ? fmt(r.apps) : '—'}</td>
                                <td className="px-4 py-2 font-mono tabular-nums font-bold text-xs" style={{ color: isTop ? '#15803d' : NAVY }}>{fmt(total)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: NAVY }}>
                            <td className="px-4 py-3 text-xs font-bold text-white">الإجمالي ({dailyRows.length} يوم)</td>
                            <td className="px-4 py-3 font-mono tabular-nums text-xs font-bold" style={{ color: '#86efac' }}>{fmt(dailyRows.reduce((s,r) => s+r.cash, 0))}</td>
                            <td className="px-4 py-3 font-mono tabular-nums text-xs font-bold" style={{ color: '#93c5fd' }}>{fmt(dailyRows.reduce((s,r) => s+r.bank, 0))}</td>
                            <td className="px-4 py-3 font-mono tabular-nums text-xs font-bold" style={{ color: '#fdba74' }}>{fmt(dailyRows.reduce((s,r) => s+r.apps, 0))}</td>
                            <td className="px-4 py-3 font-mono tabular-nums text-xs font-bold" style={{ color: GOLD }}>{fmt(dailyRows.reduce((s,r) => s+r.cash+r.bank+r.apps, 0))}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}

                {!engineSummary && (
                  <div className="bg-white rounded-2xl p-12 text-center text-slate-400 shadow-sm" style={cardBorder}>
                    <div className="text-3xl mb-2">💵</div>
                    <p className="text-sm">لا توجد بيانات في هذه الفترة</p>
                  </div>
                )}
              </div>
            )
          })()}

          {/* ══════════════════ TAB 2: ضريبة القيمة المضافة ══════════════════ */}
          {activeTab === 'vat' && (
            <div className="space-y-4">

              {/* بطاقات الملخص */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { label: 'ضريبة المخرجات', sub: 'المبيعات ÷ 1.15 × 15%', value: data.outputVat, icon: '📤', bg: '#f0fdf4', border: '#bbf7d0', color: '#16a34a' },
                  { label: 'ضريبة المدخلات', sub: 'من فواتير المشتريات', value: data.inputVat,  icon: '📥', bg: '#fef2f2', border: '#fecaca', color: '#dc2626' },
                  { label: 'الصافي المستحق', sub: data.netVat >= 0 ? 'تُدفع لهيئة الزكاة' : 'مبلغ قابل للاسترداد', value: Math.abs(data.netVat), icon: '🏛️',
                    bg: data.netVat >= 0 ? '#fffbeb' : '#eff6ff',
                    border: data.netVat >= 0 ? '#fde68a' : '#bfdbfe',
                    color: data.netVat >= 0 ? '#b45309' : '#1d4ed8' },
                ].map(c => (
                  <div key={c.label} className="rounded-2xl p-5 shadow-sm text-center" style={{ background: c.bg, border: `2px solid ${c.border}` }}>
                    <div className="flex flex-col items-center gap-1 mb-2">
                      <span className="text-2xl">{c.icon}</span>
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{c.label}</span>
                      <span className="text-xs text-slate-400">{c.sub}</span>
                    </div>
                    <div className="text-2xl font-bold font-mono tabular-nums" style={{ color: c.color }}>
                      {(c.value||0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                ))}
              </div>

              {/* جدول الحساب التفصيلي */}
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: '1px solid #e8e5dc' }}>
                <div className="px-5 py-4" style={{ background: NAVY }}>
                  <h2 className="font-bold text-white text-sm">🏛️ تفاصيل حساب الضريبة</h2>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{from} — {to}</p>
                </div>
                <div className="p-5 space-y-0">
                  <IncomeRow label="إجمالي المبيعات (شامل الضريبة)"   value={data.totalSales}  indent />
                  <IncomeRow label="المبيعات الصافية (÷ 1.15)"         value={data.netSales}    indent />
                  <IncomeRow label="ضريبة المخرجات (15%)"              value={data.outputVat}   bold  line color="#16a34a" />
                  <IncomeRow label="ضريبة المدخلات (من الفواتير)"      value={-data.inputVat}   bold  color="#dc2626" />
                  <IncomeRow label={data.netVat >= 0 ? 'صافي الضريبة المستحقة لهيئة الزكاة' : 'فائض ضريبي قابل للاسترداد'}
                    value={data.netVat} bold line color={data.netVat >= 0 ? '#b45309' : '#1d4ed8'} />
                </div>
                {data.netVat > 0 && (
                  <div className="mx-5 mb-5 p-3 rounded-xl text-sm font-semibold" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
                    ⚠️ يجب تحويل <span className="font-mono">{(data.netVat).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span> لهيئة الزكاة والضريبة والجمارك
                  </div>
                )}
                {data.netVat < 0 && (
                  <div className="mx-5 mb-5 p-3 rounded-xl text-sm font-semibold" style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}>
                    ✅ لديك فائض ضريبي بقيمة <span className="font-mono">{Math.abs(data.netVat).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span> قابل للاسترداد
                  </div>
                )}
              </div>

              {/* فواتير المشتريات التي تحتوي ضريبة */}
              {data.vatEntries?.length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: '1px solid #e8e5dc' }}>
                  <div className="px-5 py-4 flex items-center justify-between" style={{ background: '#fef2f2', borderBottom: '1px solid #fecaca' }}>
                    <h2 className="font-bold text-sm text-red-800">📥 فواتير المشتريات — ضريبة المدخلات ({data.vatEntries.length})</h2>
                    <span className="font-mono font-bold text-red-700 text-sm">{fmt(data.inputVat)}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ background: '#f5f4f0', borderBottom: `2px solid ${GOLD}` }}>
                          <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>التاريخ</th>
                          <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>البند</th>
                          <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>الوصف</th>
                          <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>المبلغ الإجمالي</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-red-600">الضريبة</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y" style={{ borderColor: '#f5f4f0' }}>
                        {data.vatEntries.map((e, i) => {
                          const total = (e.cash_out||0)+(e.bank_out||0)+(e.custody_out||0)
                          return (
                            <tr key={e.id || i} className="hover:bg-amber-50/30 transition-colors">
                              <td className="px-4 py-3 text-xs text-slate-500">{e.date}</td>
                              <td className="px-4 py-3 text-xs font-medium" style={{ color: NAVY }}>{e.type || '—'}</td>
                              <td className="px-4 py-3 text-xs text-slate-500 max-w-48 truncate">{e.description || '—'}</td>
                              <td className="px-4 py-3 text-xs font-mono tabular-nums text-right" style={{ color: NAVY }}>{fmt(total)}</td>
                              <td className="px-4 py-3 text-xs font-mono tabular-nums font-bold text-right text-red-600">{fmt(e.vat_amount)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: NAVY }}>
                          <td colSpan={3} className="px-4 py-3 text-xs font-bold text-white">إجمالي ضريبة المدخلات</td>
                          <td className="px-4 py-3 text-xs font-mono text-right font-bold" style={{ color: '#e5e7eb' }}>{fmt(data.vatEntries.reduce((s,e)=>{const t=(e.cash_out||0)+(e.bank_out||0)+(e.custody_out||0);return s+t},0))}</td>
                          <td className="px-4 py-3 text-xs font-mono tabular-nums font-bold text-right" style={{ color: '#fca5a5' }}>{fmt(data.inputVat)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {data.vatEntries?.length === 0 && (
                <div className="bg-white rounded-2xl p-8 text-center text-slate-400 shadow-sm" style={{ border: '1px solid #e8e5dc' }}>
                  <span className="text-3xl block mb-2">📭</span>
                  <p className="text-sm">لا توجد فواتير مشتريات تحتوي ضريبة في هذه الفترة</p>
                </div>
              )}
            </div>
          )}

          {/* ══════════════════ TAB 3: الأرصدة ══════════════════ */}
          {activeTab === 'balance' && balances && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { label:'رصيد الصندوق', icon:'🏧', value:balances.cash,    bg:'#f0fdf4', border:'#bbf7d0', color:'#16a34a' },
                  { label:'رصيد البنك',   icon:'🏦', value:balances.bank,    bg:'#eff6ff', border:'#bfdbfe', color:'#1d4ed8' },
                  { label:'رصيد العهدة',  icon:'👤', value:balances.custody, bg:'#fffbeb', border:'#fde68a', color:'#b45309' },
                ].map(c => (
                  <div key={c.label} className="rounded-2xl p-5 shadow-sm text-center"
                    style={{ background: c.bg, border: `2px solid ${c.border}` }}>
                    <div className="flex flex-col items-center gap-1 mb-3">
                      <span className="text-2xl">{c.icon}</span>
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{c.label}</span>
                    </div>
                    <div className="text-2xl font-bold font-mono tabular-nums"
                      style={{ color: c.value < 0 ? '#dc2626' : c.color }}>
                      {Math.abs(c.value || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                    {c.value < 0 && <div className="text-xs text-red-500 font-semibold mt-2">⚠️ رصيد سالب</div>}
                  </div>
                ))}
              </div>

              <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={cardBorder}>
                <div className="px-5 py-4" style={{ background: NAVY }}>
                  <h2 className="font-bold text-white text-sm">ملخص الفترة</h2>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{from} — {to}</p>
                </div>
                <div className="p-5 space-y-0">
                  <IncomeRow label="إجمالي المدين (الدخل)"   value={data.totalIn}                   bold color="#16a34a" />
                  <IncomeRow label="إجمالي الدائن (الخروج)"  value={data.totalOut}                  bold color="#dc2626" />
                  <IncomeRow label="صافي الفترة"             value={data.totalIn - data.totalOut}   bold line color={data.totalIn>=data.totalOut?'#1d4ed8':'#dc2626'} />
                  <IncomeRow label="إجمالي الأرصدة النقدية"  value={balances.cash+balances.bank+balances.custody} bold line />
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════ TAB: الذمم الدائنة (بـ عسل فقط) ══════════════════ */}
          {activeTab === 'payables' && isBaAsal && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <KpiCard label="إجمالي الذمم الدائنة" icon="🧾" value={payableBalance} />
              </div>

              <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={cardBorder}>
                <div className="px-5 py-4" style={{ background: NAVY }}>
                  <h2 className="font-bold text-white text-sm">🧾 أرصدة الموردين</h2>
                </div>
                {payableSupplierRows.length === 0 ? (
                  <div className="p-10 text-center text-slate-400 text-sm">لا يوجد موردون بعد</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-400 border-b" style={{ borderColor: '#e8e5dc' }}>
                        <th className="text-right py-3 px-5 font-medium">المورد</th>
                        <th className="text-left py-3 px-5 font-medium">إجمالي الفواتير</th>
                        <th className="text-left py-3 px-5 font-medium">إجمالي المسدد</th>
                        <th className="text-left py-3 px-5 font-medium">الرصيد المتبقي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payableSupplierRows.map(r => (
                        <tr key={r.id} className="border-b hover:bg-slate-50 cursor-pointer transition-colors"
                          style={{ borderColor: '#f1f5f9' }}
                          onClick={() => navigate(`/payable-suppliers?supplier=${r.id}`)}>
                          <td className="py-3 px-5 font-medium text-slate-700">{r.name}</td>
                          <td className="py-3 px-5 text-left font-mono">{r.invoiced.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="py-3 px-5 text-left font-mono text-green-700">{r.paid.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="py-3 px-5 text-left font-mono font-bold" style={{ color: r.balance > 0 ? '#dc2626' : NAVY }}>
                            {r.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ══════════════════ TAB 3: ملخص الأرصدة ══════════════════ */}
          {activeTab === 'trial' && (
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={cardBorder}>
              <div className="px-5 py-4 flex items-center justify-between" style={{ background: NAVY }}>
                <h2 className="font-bold text-white text-sm">📋 ملخص الأرصدة</h2>
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>{from} — {to}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: '#f5f4f0', borderBottom: `2px solid ${GOLD}` }}>
                      <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>البند</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-green-700">مدين</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-red-600">دائن</th>
                      <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>الرصيد</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ '--tw-divide-opacity': 1, borderColor: '#D4E8E6' }}>
                    {trialBalance.length === 0 && (
                      <tr><td colSpan={4} className="text-center py-12 text-slate-400">لا توجد بيانات في هذه الفترة</td></tr>
                    )}
                    {trialBalance.map((row, i) => {
                      const net = row.debit - row.credit
                      return (
                        <tr key={i} className="transition-colors hover:bg-amber-50/40">
                          <td className="px-4 py-3 font-medium text-sm" style={{ color: NAVY }}>{row.type}</td>
                          <td className="px-4 py-3 font-mono tabular-nums text-green-700 text-right text-xs">
                            {row.debit > 0 ? fmt(row.debit) : '—'}
                          </td>
                          <td className="px-4 py-3 font-mono tabular-nums text-red-600 text-right text-xs">
                            {row.credit > 0 ? fmt(row.credit) : '—'}
                          </td>
                          <td className="px-4 py-3 font-mono tabular-nums font-bold text-right text-xs"
                            style={{ color: net >= 0 ? '#1d4ed8' : '#dc2626' }}>
                            {fmt(Math.abs(net))} {net < 0 ? '(دائن)' : net > 0 ? '(مدين)' : ''}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {trialBalance.length > 0 && (
                    <tfoot>
                      <tr style={{ background: NAVY }}>
                        <td className="px-4 py-3 text-sm font-bold text-white">الإجمالي</td>
                        <td className="px-4 py-3 font-mono tabular-nums text-right text-xs font-bold" style={{ color: '#86efac' }}>
                          {fmt(trialBalance.reduce((s,r) => s+r.debit,0))}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-right text-xs font-bold" style={{ color: '#fca5a5' }}>
                          {fmt(trialBalance.reduce((s,r) => s+r.credit,0))}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-right text-xs font-bold" style={{ color: GOLD }}>
                          {fmt(data.totalIn - data.totalOut)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* ══════════════════ TAB 2: تقرير المشتريات ══════════════════ */}
          {activeTab === 'purchases' && (() => {
            const strip = s => (s || '').replace(/^[^؀-ۿ]+/, '').trim()
            // بناء هيكل هرمي: category_main → { total, subs, rows }
            const mainMap = {}

            const addItem = (rawMain, rawSub, amount, label) => {
              if (!rawMain || rawMain.includes('مبيعات') || amount <= 0) return
              if (!mainMap[rawMain]) mainMap[rawMain] = { total: 0, subs: {}, rows: [] }
              mainMap[rawMain].total += amount
              mainMap[rawMain].rows.push({ label: label || rawSub || rawMain, amount })
              const subKey = rawSub || '__uncat__'
              if (!mainMap[rawMain].subs[subKey]) mainMap[rawMain].subs[subKey] = { total: 0, rows: [] }
              mainMap[rawMain].subs[subKey].total += amount
              mainMap[rawMain].subs[subKey].rows.push({ label: label || rawMain, amount })
            }

            // المصروفات الحقيقية فقط (بدون مسحوبات / أقساط / قروض)
            ;(entries || []).forEach(e => {
              const out = (e.cash_out||0) + (e.bank_out||0) + (e.custody_out||0)
              if (!out) return
              if (isExcluded(e.type) || isSales(e.type)) return
              if (isWithdrawal(e.type) || isDebt(e.type)) return
              addItem(e.type || '— غير محدد', e.category_sub || null, out, e.description)
            })

            // المسحوبات والالتزامات — للعرض المنفصل
            const fmt2 = v => (v||0).toLocaleString('en-US',{minimumFractionDigits:2})
            const sumOut = arr => arr.reduce((s,e)=>s+(e.cash_out||0)+(e.bank_out||0)+(e.custody_out||0),0)
            const withdrawalEntries = (entries||[]).filter(e=>!isExcluded(e.type)&&isWithdrawal(e.type))
            const debtEntries       = (entries||[]).filter(e=>!isExcluded(e.type)&&isDebt(e.type))
            const totalW = sumOut(withdrawalEntries)
            const totalD = sumOut(debtEntries)
            const hasObligations = totalW > 0 || totalD > 0

            const mainRows = Object.entries(mainMap)
              .map(([cat, v]) => ({
                cat,
                total: v.total,
                rows: v.rows,
                subs: Object.entries(v.subs)
                  .map(([s, sv]) => ({
                    cat:     s === '__uncat__' ? 'غير مصنف' : s,
                    total:   sv.total,
                    rows:    sv.rows,
                    isUncat: s === '__uncat__',
                  }))
                  .sort((a, b) => a.isUncat ? 1 : b.isUncat ? -1 : b.total - a.total),
              }))
              .sort((a, b) => b.total - a.total)
            // إجمالي البطاقة = مجموع التفاصيل مباشرة (نفس المصدر)
            const grandTotal = mainRows.reduce((sum, cat) => sum + cat.total, 0)

            // تقسيم: تكلفة البضاعة المباعة / المصروفات التشغيلية
            const cogsRows  = mainRows.filter(r => isCOGS(r.cat))
            const opexRows  = mainRows.filter(r => !isCOGS(r.cat))
            const cogsTotal = cogsRows.reduce((s, r) => s + r.total, 0)
            const opexTotal = opexRows.reduce((s, r) => s + r.total, 0)
            const _sales    = engineSummary?.totalSales || data?.totalSales || 0

            const toggleCat = cat => setExpandedCats(prev => {
              const next = new Set(prev)
              next.has(cat) ? next.delete(cat) : next.add(cat)
              return next
            })

            const mainCatColors = [
              { bg: '#eff6ff', border: '#bfdbfe', color: '#1d4ed8' },
              { bg: '#f0fdf4', border: '#bbf7d0', color: '#15803d' },
              { bg: '#faf5ff', border: '#e9d5ff', color: '#7e22ce' },
              { bg: '#fff7ed', border: '#fed7aa', color: '#c2410c' },
              { bg: '#fef2f2', border: '#fecaca', color: '#b91c1c' },
              { bg: '#f0f9ff', border: '#bae6fd', color: '#0369a1' },
            ]

            return (
              <div className="space-y-4">

                {/* أكورديون: تكلفة البضاعة المباعة — هرم مزدوج (category_sub داخل parent واحد) */}
                {cogsRows.length > 0 && (() => {
                  // تجميع كل مدخلات COGS حسب category_sub (بصرف النظر عن category_main)
                  const cogsBySubMap = {}
                  cogsRows.forEach(mainCat => {
                    mainCat.subs.forEach(sub => {
                      const key = sub.isUncat ? '__uncat__' : sub.cat
                      if (!cogsBySubMap[key]) cogsBySubMap[key] = { cat: sub.cat, total: 0, rows: [], isUncat: sub.isUncat }
                      cogsBySubMap[key].total += sub.total
                      cogsBySubMap[key].rows.push(...sub.rows)
                    })
                  })
                  const cogsBySubRows = Object.values(cogsBySubMap)
                    .sort((a, b) => a.isUncat ? 1 : b.isUncat ? -1 : b.total - a.total)
                  const cogsParentOpen = expandedCats.has('__cogs_parent__')
                  const clr = { bg: '#eff6ff', border: '#bfdbfe', color: '#1d4ed8' }
                  const cogsPct = _sales > 0 ? (cogsTotal / _sales * 100).toFixed(1) : 0
                  return (
                    <div className="rounded-2xl overflow-hidden shadow-sm" style={{ border: `1.5px solid ${clr.border}` }}>
                        {/* المستوى 1 — تكلفة البضاعة المباعة (parent واحد) */}
                        <button onClick={() => toggleCat('__cogs_parent__')}
                          className="w-full flex items-center gap-3 px-4 py-3 text-right transition-colors"
                          style={{ background: clr.bg, cursor: 'pointer' }}>
                          <span className="text-sm font-bold transition-transform duration-200"
                            style={{ color: clr.color, transform: cogsParentOpen ? 'rotate(90deg)' : 'none', display: 'inline-block', minWidth: '1rem' }}>▶</span>
                          <span className="flex-1 font-bold text-sm text-right" style={{ color: clr.color }}>🥩 تكلفة البضاعة المباعة</span>
                          <div className="text-left">
                            <div className="font-bold font-mono tabular-nums text-sm" style={{ color: clr.color }}>{fmt(cogsTotal)}</div>
                            {_sales > 0 && <div className="text-xs opacity-60" style={{ color: clr.color }}>{cogsPct}% من المبيعات</div>}
                          </div>
                          <div className="w-20">
                            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.1)' }}>
                              <div className="h-full rounded-full" style={{ width: `${Math.min(Number(cogsPct), 100)}%`, background: clr.color }} />
                            </div>
                          </div>
                        </button>
                        {/* المستوى 2 — التصنيفات الفرعية (category_sub) */}
                        {cogsParentOpen && (
                          <div className="border-t" style={{ borderColor: clr.border }}>
                            {cogsBySubRows.map((sub, si) => {
                              const subKey  = `__cogs__${sub.cat}`
                              const subOpen = expandedCats.has(subKey)
                              return (
                                <div key={si}>
                                  <button onClick={() => toggleCat(subKey)}
                                    className="w-full flex items-center gap-3 px-5 py-2.5 text-right transition-colors"
                                    style={{ background: subOpen ? '#dbeafe' : si % 2 === 0 ? '#fff' : '#fafafa', borderBottom: `1px solid ${clr.border}` }}>
                                    <span className="text-xs transition-transform duration-150"
                                      style={{ color: clr.color, transform: subOpen ? 'rotate(90deg)' : 'none', display: 'inline-block', opacity: 0.7 }}>▶</span>
                                    <span className={`flex-1 text-sm font-medium text-right ${sub.isUncat ? 'text-slate-400 italic' : 'text-slate-700'}`}>
                                      {sub.isUncat ? '📋 غير مصنف' : `📌 ${sub.cat}`}
                                    </span>
                                    <span className="font-mono tabular-nums text-sm font-semibold" style={{ color: clr.color }}>{fmt(sub.total)}</span>
                                    {_sales > 0 && <span className="text-xs shrink-0" style={{ color: clr.color, opacity: 0.55 }}>({(sub.total / _sales * 100).toFixed(1)}% من المبيعات)</span>}
                                  </button>
                                  {/* المستوى 3 — الفواتير الفردية */}
                                  {subOpen && (
                                    <div style={{ borderBottom: `1px solid ${clr.border}` }}>
                                      {sub.rows.map((row, ri) => (
                                        <div key={ri} className="flex items-center gap-3 px-8 py-2"
                                          style={{ background: ri % 2 === 0 ? '#f8faff' : '#f0f5ff', borderBottom: ri < sub.rows.length - 1 ? '1px solid #e8f0fe' : 'none' }}>
                                          <span className="text-slate-300 text-xs">└</span>
                                          <span className="flex-1 text-xs text-slate-600 truncate">{row.label || '—'}</span>
                                          <span className="font-mono tabular-nums text-xs font-semibold shrink-0" style={{ color: clr.color }}>{fmt(row.amount)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                  )
                })()}

                {/* أكورديون التصنيفات الهرمية (التشغيلية) */}
                {opexRows.length > 0 ? (
                  <div className="space-y-2">
                    {opexRows.map((r, idx) => {
                      const _baseSales = engineSummary?.totalSales || data?.totalSales || 0
                      const pct  = _baseSales > 0 ? ((r.total / _baseSales) * 100).toFixed(1) : 0
                      const open = expandedCats.has(r.cat)
                      const clr  = mainCatColors[idx % mainCatColors.length]
                      return (
                        <div key={r.cat} className="rounded-2xl overflow-hidden shadow-sm"
                          style={{ border: `1.5px solid ${clr.border}` }}>
                          {/* المستوى 1 — التصنيف الرئيسي */}
                          <button
                            onClick={() => toggleCat(r.cat)}
                            className="w-full flex items-center gap-3 px-4 py-3 text-right transition-colors"
                            style={{ background: clr.bg, cursor: 'pointer' }}>
                            <span className="text-sm font-bold transition-transform duration-200"
                              style={{ color: clr.color, transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block', minWidth: '1rem' }}>▶</span>
                            <span className="flex-1 font-bold text-sm text-right" style={{ color: clr.color }}>{r.cat}</span>
                            <div className="text-left">
                              <div className="font-bold font-mono tabular-nums text-sm" style={{ color: clr.color }}>{fmt(r.total)}</div>
                              <div className="text-xs opacity-60" style={{ color: clr.color }}>{pct}% من المبيعات</div>
                            </div>
                            <div className="w-20">
                              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.1)' }}>
                                <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: clr.color }} />
                              </div>
                            </div>
                          </button>

                          {/* المستوى 2 — category_sub */}
                          {open && (
                            <div className="border-t" style={{ borderColor: clr.border }}>
                              {r.subs.map((sub, si) => {
                                const subKey  = `${r.cat}__${sub.cat}`
                                const subOpen = expandedCats.has(subKey)
                                const sPct    = _baseSales > 0 ? ((sub.total / _baseSales) * 100).toFixed(1) : 0
                                return (
                                  <div key={si}>
                                    <button onClick={() => toggleCat(subKey)}
                                      className="w-full flex items-center gap-3 px-5 py-2.5 text-right transition-colors"
                                      style={{ background: subOpen ? clr.bg : si % 2 === 0 ? '#fff' : '#fafafa', borderBottom: `1px solid ${clr.border}` }}>
                                      <span className="text-xs transition-transform duration-150"
                                        style={{ color: clr.color, transform: subOpen ? 'rotate(90deg)' : 'none', display: 'inline-block', opacity: 0.7 }}>▶</span>
                                      <span className={`flex-1 text-sm font-medium text-right ${sub.isUncat ? 'text-slate-400 italic' : 'text-slate-700'}`}>
                                        {sub.isUncat ? '📋 غير مصنف' : `📌 ${sub.cat}`}
                                      </span>
                                      <span className="font-mono tabular-nums text-sm font-semibold" style={{ color: clr.color }}>{fmt(sub.total)}</span>
                                      {_baseSales > 0 && <span className="text-xs shrink-0" style={{ color: clr.color, opacity: 0.55 }}>({sPct}% من المبيعات)</span>}
                                    </button>
                                    {/* المستوى 3 — الفواتير الفردية */}
                                    {subOpen && (
                                      <div style={{ borderBottom: `1px solid ${clr.border}` }}>
                                        {sub.rows.map((row, ri) => (
                                          <div key={ri} className="flex items-center gap-3 px-8 py-2"
                                            style={{ background: ri % 2 === 0 ? '#fafafa' : '#f5f5f5', borderBottom: ri < sub.rows.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                                            <span className="text-slate-300 text-xs">└</span>
                                            <span className="flex-1 text-xs text-slate-600 truncate">{row.label || '—'}</span>
                                            <span className="font-mono tabular-nums text-xs font-semibold shrink-0" style={{ color: clr.color }}>{fmt(row.amount)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : null}

                {mainRows.length === 0 && !hasObligations && (
                  <div className="bg-white rounded-2xl p-12 text-center text-slate-400"
                    style={{ border: '1px solid #e8e5dc' }}>
                    <div className="text-4xl mb-3">🛒</div>
                    <p className="font-medium">لا توجد فواتير مشتريات مصنّفة في هذه الفترة</p>
                    <p className="text-xs mt-1">تظهر البيانات بعد اعتماد فواتير مسؤول المشتريات</p>
                  </div>
                )}

                {/* ── قسم المسحوبات والالتزامات المالية ── */}
                {hasObligations && (() => {
                  const groupByType = arr => {
                    const map = {}
                    arr.forEach(e => {
                      const key = e.type || '— غير محدد'
                      const out = (e.cash_out||0)+(e.bank_out||0)+(e.custody_out||0)
                      if (!out) return
                      map[key] = (map[key]||0) + out
                    })
                    return Object.entries(map).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).map(([type,total])=>({type,total}))
                  }
                  const wGroups = groupByType(withdrawalEntries)
                  const dGroups = groupByType(debtEntries)

                  const OblAccordion = ({ icon, title, total, groups, accentBg, accentBorder, accentColor, expandKey }) => {
                    if (!groups.length) return null
                    const open = expandedCats.has(expandKey)
                    return (
                      <div className="rounded-2xl overflow-hidden shadow-sm" style={{ border: `1.5px solid ${accentBorder}` }}>
                        <button onClick={() => toggleCat(expandKey)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-right transition-colors"
                          style={{ background: accentBg, cursor: 'pointer' }}>
                          <span className="text-sm font-bold transition-transform duration-200"
                            style={{ color: accentColor, transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block', minWidth: '1rem' }}>▶</span>
                          <span className="flex-1 font-bold text-sm text-right" style={{ color: accentColor }}>{icon} {title}</span>
                          <div className="text-left">
                            <div className="font-bold font-mono tabular-nums text-sm" style={{ color: accentColor }}>{fmt2(total)}</div>
                          </div>
                        </button>
                        {open && (
                          <div className="border-t" style={{ borderColor: accentBorder }}>
                            {groups.map((g, i) => (
                              <div key={i} className="flex items-center justify-between px-5 py-2.5"
                                style={{ background: i%2===0?'#fff':'#fafafa', borderBottom: i<groups.length-1?`1px solid ${accentBorder}`:'none' }}>
                                <span className="text-sm font-medium text-slate-700">└ {g.type}</span>
                                <span className="font-mono tabular-nums text-sm font-semibold" style={{ color: accentColor }}>{fmt2(g.total)}</span>
                              </div>
                            ))}
                            <div className="flex items-center justify-between px-4 py-2"
                              style={{ background: accentBg, borderTop: `1px solid ${accentBorder}` }}>
                              <span className="text-xs font-bold" style={{ color: accentColor }}>مجموع {title}</span>
                              <span className="font-mono tabular-nums text-sm font-bold" style={{ color: accentColor }}>{fmt2(total)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  }

                  return (
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 py-1">
                        <div className="flex-1 border-t" style={{ borderColor: '#e8e5dc' }}/>
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }}>
                          💼 المسحوبات والالتزامات — لا تدخل في صافي الربح
                        </span>
                        <div className="flex-1 border-t" style={{ borderColor: '#e8e5dc' }}/>
                      </div>
                      <OblAccordion icon="💼" title="المسحوبات" total={totalW} groups={wGroups}
                        accentBg="#fffbeb" accentBorder="#fde68a" accentColor="#b45309" expandKey="__withdrawals__" />
                      <OblAccordion icon="💳" title="الأقساط والقروض" total={totalD} groups={dGroups}
                        accentBg="#fffbeb" accentBorder="#fde68a" accentColor="#b45309" expandKey="__debts__" />
                      {(totalW + totalD) > 0 && (
                        <div className="rounded-2xl px-4 py-3 flex items-center justify-between"
                          style={{ background: '#78350f' }}>
                          <span className="font-bold text-white text-sm">إجمالي المسحوبات والالتزامات</span>
                          <span className="font-mono tabular-nums font-bold text-lg" style={{ color: '#fde68a' }}>{fmt2(totalW + totalD)}</span>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            )
          })()}

        </>
      )}

      {/* ── PDF Template (hidden) ── */}
      <div ref={pdfRef} style={{ display:'none', width:'794px', fontFamily:'Cairo,Arial,sans-serif', direction:'rtl', background:'#fff', padding:'36px', color:'#1e293b' }}>
        <div style={{ textAlign:'center', borderBottom:`4px solid ${GOLD}`, paddingBottom:'16px', marginBottom:'24px' }}>
          <div style={{ fontSize:'26px', fontWeight:'bold', color:NAVY }}>تحسيب</div>
          <div style={{ fontSize:'16px', fontWeight:'bold', marginTop:'4px', color:'#374151' }}>خدمة المتابعة المالية</div>
          <div style={{ fontSize:'13px', color:'#6b7280', marginTop:'6px' }}>الفترة من {from} إلى {to}</div>
          <div style={{ fontSize:'11px', color:'#9ca3af', marginTop:'3px' }}>تاريخ الطباعة: {new Date().toLocaleDateString('en-GB')}</div>
        </div>

        {data && <>
          <div style={{ marginBottom:'24px' }}>
            <div style={{ fontSize:'14px', fontWeight:'bold', background:NAVY, color:'#fff', padding:'8px 14px', borderRadius:'6px', marginBottom:'10px' }}>
              ملخص قائمة الدخل
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'12px' }}>
              <tbody>
                {(engineSummary ? [
                  ['مبيعات كاش',              fmt(engineSummary.cashSales),                   false, true,  '#374151'],
                  ['مبيعات شبكة / إلكترونية', fmt(engineSummary.networkSales),                false, true,  '#374151'],
                  ['إجمالي المبيعات',           fmt(engineSummary.totalSales),                 true,  false, NAVY],
                  ['إجمالي المصروفات',          `(${fmt(engineSummary.totalExpenses)})`,       false, true,  '#dc2626'],
                  ['صافي الربح',               fmt(engineSummary.netProfit),                  true,  false, engineSummary.netProfit>=0?'#16a34a':'#dc2626'],
                ] : [
                  ['إجمالي المبيعات', fmt(data.totalSales), true, false, NAVY],
                ]).map(([label, value, bold, indent, color], i) => (
                  <tr key={i} style={{ borderBottom:'1px solid #f1f5f9' }}>
                    <td style={{ padding:'7px 8px', paddingRight:indent?'24px':'8px', fontWeight:bold?'bold':'normal' }}>{label}</td>
                    <td style={{ padding:'7px 8px', textAlign:'left', fontWeight:bold?'bold':'normal', color }}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display:'flex', gap:'10px', marginBottom:'24px' }}>
            {[
              { label:'إجمالي المدين', value:fmt(data.totalIn),  color:'#16a34a', bg:'#f0fdf4' },
              { label:'إجمالي الدائن', value:fmt(data.totalOut), color:'#dc2626', bg:'#fef2f2' },
              { label:'الرصيد',         value:fmt(data.totalIn-data.totalOut), color:'#1d4ed8', bg:'#eff6ff' },
            ].map(b => (
              <div key={b.label} style={{ flex:1, background:b.bg, border:`1px solid ${b.color}30`, borderRadius:'8px', padding:'12px', textAlign:'center' }}>
                <div style={{ fontSize:'10px', color:'#6b7280', marginBottom:'4px' }}>{b.label}</div>
                <div style={{ fontSize:'15px', fontWeight:'bold', color:b.color }}>{b.value}</div>
              </div>
            ))}
          </div>

          {entriesDisplay.length > 0 && (
            <div style={{ marginBottom:'24px' }}>
              <div style={{ fontSize:'14px', fontWeight:'bold', background:NAVY, color:'#fff', padding:'8px 14px', borderRadius:'6px', marginBottom:'10px' }}>
                تفاصيل الحركات ({entriesDisplay.length} حركة)
              </div>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'10px' }}>
                <thead>
                  <tr style={{ background:'#f5f4f0', borderBottom:`2px solid ${GOLD}` }}>
                    {['رقم الحركة','التاريخ','النوع','الوصف','مدين','دائن'].map(h => (
                      <th key={h} style={{ padding:'7px 6px', textAlign:'right', fontWeight:'bold', color:NAVY }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entriesDisplay.map((e, i) => {
                    const debit  = (e.cash_in||0)+(e.bank_in||0)+(e.custody_in||0)
                    const credit = (e.cash_out||0)+(e.bank_out||0)+(e.custody_out||0)
                    return (
                      <tr key={e.id} style={{ borderBottom:'1px solid #f1f5f9', background:i%2===0?'#fff':'#fafaf8' }}>
                        <td style={{ padding:'5px 6px', color:e.journal_number?GOLD:'#9ca3af', fontWeight:'bold' }}>{e._displayNum}</td>
                        <td style={{ padding:'5px 6px', color:'#374151' }}>{e.date}</td>
                        <td style={{ padding:'5px 6px', color:'#374151' }}>{e.type}</td>
                        <td style={{ padding:'5px 6px', color:'#6b7280', maxWidth:'150px' }}>{e.description}</td>
                        <td style={{ padding:'5px 6px', color:'#16a34a', fontWeight:debit>0?'bold':'normal' }}>{debit>0?fmt(debit):'—'}</td>
                        <td style={{ padding:'5px 6px', color:'#dc2626', fontWeight:credit>0?'bold':'normal' }}>{credit>0?fmt(credit):'—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background:NAVY, fontWeight:'bold' }}>
                    <td colSpan={4} style={{ padding:'7px 6px', color:'#fff' }}>الإجمالي</td>
                    <td style={{ padding:'7px 6px', color:'#86efac' }}>{fmt(data.totalIn)}</td>
                    <td style={{ padding:'7px 6px', color:'#fca5a5' }}>{fmt(data.totalOut)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {docs.length > 0 && (
            <div style={{ marginBottom:'16px' }}>
              <div style={{ fontSize:'14px', fontWeight:'bold', background:NAVY, color:'#fff', padding:'8px 14px', borderRadius:'6px', marginBottom:'10px' }}>
                المستندات المعتمدة ({docs.length} مستند)
              </div>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'10px' }}>
                <thead>
                  <tr style={{ background:'#f5f4f0', borderBottom:`2px solid ${GOLD}` }}>
                    {['رقم القيد','اسم المستند','رُفع بواسطة','تاريخ الرفع','المبلغ'].map(h => (
                      <th key={h} style={{ padding:'7px 6px', textAlign:'right', fontWeight:'bold', color:NAVY }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d, i) => {
                    const res    = d.analysis_result
                    const amount = res?.type==='sales'?((res.cashSales||0)+(res.networkSales||0)):(res?.amount||0)
                    return (
                      <tr key={i} ref={el => docsRowRefs.current[i] = el}
                        style={{ borderBottom:'1px solid #f1f5f9', background:i%2===0?'#fff':'#fafaf8' }}>
                        <td style={{ padding:'5px 6px', color:GOLD, fontWeight:'bold' }}>{d.journal_number||'—'}</td>
                        <td style={{ padding:'5px 6px', color:d.file_url?'#1d4ed8':'#374151', textDecoration:d.file_url?'underline':'none' }}>
                          {cleanFileName(d.file_name)}
                        </td>
                        <td style={{ padding:'5px 6px', color:'#374151' }}>{ROLE_AR[d.uploaded_by]||d.uploaded_by}</td>
                        <td style={{ padding:'5px 6px', color:'#374151' }}>{fmtD(d.uploaded_at)}</td>
                        <td style={{ padding:'5px 6px', fontWeight:'bold', color:NAVY }}>{amount>0?fmt(amount)+'':'—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ borderTop:`2px solid ${GOLD}`, paddingTop:'12px', textAlign:'center', color:'#9ca3af', fontSize:'10px', marginTop:'16px' }}>
            تم إنشاء هذا التقرير بواسطة تحسيب — {new Date().toLocaleString('en-US')}
          </div>
        </>}
      </div>
    </div>
  )
}
