import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { getProjectSettings } from '../lib/projectSettings'
import { getFinancialSummary } from '../lib/financialEngine'

const NAVY = '#0f2444'
const GOLD = '#c9a227'

const ROLE_AR = { owner: 'المالك', accountant: 'المحاسب', purchasing: 'مسؤول المشتريات', cashier: 'الكاشير' }

const QUICK_PERIODS = [
  { key: 'month',     label: 'الشهر الحالي' },
  { key: 'lastMonth', label: 'الشهر الماضي' },
  { key: 'year',      label: 'السنة الحالية' },
]

const TABS = [
  { key: 'income',    label: 'قائمة الدخل',         icon: '📊' },
  { key: 'purchases', label: 'المصروفات',             icon: '🛒' },
  { key: 'vat',       label: 'الضريبة',              icon: '🏛️' },
  { key: 'balance',   label: 'الأرصدة',              icon: '⚖️' },
]

function getPeriodRange(key) {
  const n  = new Date()
  const to = n.toISOString().split('T')[0]
  if (key === 'month')
    return { from: `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-01`, to }
  if (key === 'lastMonth') {
    const s = new Date(n.getFullYear(), n.getMonth() - 1, 1)
    const e = new Date(n.getFullYear(), n.getMonth(), 0)
    return { from: s.toISOString().split('T')[0], to: e.toISOString().split('T')[0] }
  }
  if (key === 'quarter') {
    const q = Math.floor(n.getMonth() / 3)
    return { from: new Date(n.getFullYear(), q * 3, 1).toISOString().split('T')[0], to }
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

export default function Reports() {
  const { projectId } = useAuth()
  const init = getPeriodRange('month')
  const [from, setFrom]                 = useState(init.from)
  const [to,   setTo]                   = useState(init.to)
  const [activePeriod, setActivePeriod] = useState('month')
  const [activeTab,    setActiveTab]    = useState('income')
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
  const [docItems,        setDocItems]        = useState([])
  const [allBranchSales,  setAllBranchSales]  = useState([])
  const [expandedCats,    setExpandedCats]    = useState(new Set())
  const [engineSummary,   setEngineSummary]   = useState(null)
  const pdfRef      = useRef()
  const docsRowRefs = useRef([])

  const liveRef = useRef({ from: init.from, to: init.to, branch: 'all' })
  useEffect(() => { liveRef.current = { from, to, branch: selectedBranch } }, [from, to, selectedBranch])

  useEffect(() => {
    if (projectId) {
      getProjectSettings(projectId).then(s => setBranches(s?.settings?.branches || []))
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
    const r = getPeriodRange(key)
    setFrom(r.from); setTo(r.to)
    load(r.from, r.to)
  }

  async function load(fromDate = from, toDate = to, branchFilter = selectedBranch) {
    if (!projectId) return
    setLoading(true)

    const applyBranch = q => branchFilter !== 'all' ? q.eq('branch', branchFilter) : q

    const [
      { data: sales },
      { data: ledger },
      { data: ledgerFull },
      { data: documents },
      { data: allTime },
      { data: allBranchEntries },
      { data: purchaseDocsData },
      { data: allBranchSalesData },
      engineResult,
    ] = await Promise.all([
      applyBranch(supabase.from('sales').select('cash_sales,network_sales')
        .eq('project_id', projectId).gte('date', fromDate).lte('date', toDate)),
      applyBranch(supabase.from('ledger_entries').select('type,cash_out,bank_out,custody_out,cash_in,bank_in,custody_in,vat_amount')
        .eq('project_id', projectId).neq('status', 'cancelled').gte('date', fromDate).lte('date', toDate)),
      applyBranch(supabase.from('ledger_entries').select('id,date,type,description,cash_in,bank_in,custody_in,cash_out,bank_out,custody_out,total_amount,vat_amount,journal_number')
        .eq('project_id', projectId).neq('status', 'cancelled').gte('date', fromDate).lte('date', toDate).order('date')),
      supabase.from('documents').select('file_name,uploaded_by,uploaded_at,analysis_result,journal_number,file_url')
        .eq('project_id', projectId).eq('status','approved')
        .gte('uploaded_at', fromDate).lte('uploaded_at', toDate + 'T23:59:59').order('uploaded_at'),
      applyBranch(supabase.from('ledger_entries').select('cash_in,cash_out,bank_in,bank_out,custody_in,custody_out')
        .eq('project_id', projectId).lte('date', toDate).neq('status', 'cancelled')),
      supabase.from('ledger_entries').select('branch,type,cash_in,bank_in,custody_in,cash_out,bank_out,custody_out')
        .eq('project_id', projectId).neq('status', 'cancelled').gte('date', fromDate).lte('date', toDate),
      supabase.rpc('get_purchase_entries', {
        p_project_id: projectId,
        p_from:       fromDate,
        p_to:         toDate,
      }),
      supabase.from('sales').select('branch,cash_sales,network_sales,hunger_sales,jahez_sales,keeta_sales')
        .eq('project_id', projectId).gte('date', fromDate).lte('date', toDate),
      getFinancialSummary(projectId, fromDate, toDate),
    ])
    setEngineSummary(engineResult)
    setBranchEntries(allBranchEntries || [])
    setAllBranchSales(allBranchSalesData || [])
    setPurchaseDocs(purchaseDocsData || [])

    // جلب document_items للفترة عبر journal_numbers من ledger
    const jnSet = [...new Set((ledgerFull||[]).filter(e => e.journal_number).map(e => e.journal_number))]
    let docItemsData = []
    if (jnSet.length > 0) {
      const { data: diData } = await supabase
        .from('document_items')
        .select('id,journal_number,description,amount,vat_amount,category_main,category_sub')
        .eq('project_id', projectId)
        .in('journal_number', jnSet)
      docItemsData = diData || []
    }
    setDocItems(docItemsData)

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
    const inputVat     = (ledger||[]).reduce((s,r) => s+(Number(r.vat_amount)||0), 0)      // ضريبة المدخلات من الفواتير
    const netVat       = outputVat - inputVat                                               // الصافي المستحق لهيئة الزكاة

    // تفصيل فواتير المشتريات التي تحتوي ضريبة
    const vatEntries   = (ledgerFull||[]).filter(r => (r.vat_amount||0) > 0)

    setData({ cashSales, networkSales, totalSales, opEx, fixEx, loans, draws, grossProfit, netProfit, netFlow, margin, totalIn, totalOut, outputVat, netSales, inputVat, netVat, vatEntries })
    setEntries(ledgerFull || [])
    setDocs(documents || [])

    const at = allTime || []
    setBalances({
      cash:    at.reduce((s,r) => s+(r.cash_in||0)-(r.cash_out||0), 0),
      bank:    at.reduce((s,r) => s+(r.bank_in||0)-(r.bank_out||0), 0),
      custody: at.reduce((s,r) => s+(r.custody_in||0)-(r.custody_out||0), 0),
    })
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
            const visibleTabs = branches.length > 1
              ? [...TABS, { key: 'branches', label: 'مقارنة الفروع', icon: '🏢' }]
              : TABS
            return (
              <div className="flex gap-1 p-1 rounded-2xl w-fit flex-wrap" style={{ background: '#e8e5dc' }}>
                {visibleTabs.map(t => (
                  <button key={t.key} onClick={() => setActiveTab(t.key)}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-xl transition-all"
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

          {/* ══════════════════ TAB 1: قائمة الدخل ══════════════════ */}
          {activeTab === 'income' && (
            <div className="space-y-4">
              {engineSummary ? (
                <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={cardBorder}>
                  <div className="px-5 py-4" style={{ background: NAVY }}>
                    <h2 className="font-bold text-white text-sm">📊 قائمة الدخل</h2>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{from} — {to}</p>
                  </div>
                  <div className="p-5">
                    <IncomeRow label="مبيعات كاش"        value={engineSummary.cashSales}     indent />
                    <IncomeRow label="مبيعات شبكة / إلكترونية" value={engineSummary.networkSales} indent />
                    <IncomeRow label="إجمالي المبيعات"   value={engineSummary.totalSales}    bold line color="#1d4ed8" />
                    <IncomeRow label="إجمالي المصروفات"  value={-engineSummary.totalExpenses} indent color="#dc2626" />
                    <IncomeRow label="صافي الربح"        value={engineSummary.netProfit}     bold line
                      color={engineSummary.netProfit >= 0 ? '#16a34a' : '#dc2626'} />
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-2xl p-12 text-center text-slate-400 shadow-sm" style={cardBorder}>
                  <div className="text-3xl mb-2">📊</div>
                  <p className="text-sm">لا توجد بيانات في هذه الفترة</p>
                </div>
              )}
            </div>
          )}

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
                  <tbody className="divide-y" style={{ '--tw-divide-opacity': 1, borderColor: '#f0ede6' }}>
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
              mainMap[rawMain].rows.push({ label: rawSub || label || rawMain, amount })
              if (rawSub) mainMap[rawMain].subs[rawSub] = (mainMap[rawMain].subs[rawSub] || 0) + amount
            }

            // أرقام قيود تحتوي إيراد مبيعات (bank_in > 0 ونوعها يحتوي "مبيعات")
            const salesIncomeJNs = new Set(
              (entries || [])
                .filter(e =>
                  (e.type || '').includes('مبيعات') &&
                  ((e.bank_in||0)+(e.cash_in||0)+(e.custody_in||0)) > 0 &&
                  e.journal_number
                )
                .map(e => e.journal_number)
            )

            // ── المصدر الأول: document_items (النظام الجديد — بنود مفصّلة) ──
            // نتتبع فقط أرقام القيود التي أضافت بنوداً فعلية لـ mainMap (لتجنب حذف قيود المصروفات من entries)
            const docItemJNs = new Set()
            docItems.forEach(item => {
              const rawMain = item.category_main || '— غير محدد'
              const rawSub  = item.category_sub  || null
              const amount  = Number(item.amount) || 0
              // استبعاد بنود غير مصنفة من قيود المبيعات (مثل إجمالي مبيعات تمارا/سلة)
              if (salesIncomeJNs.has(item.journal_number) && rawMain === '— غير محدد') return
              // استبعاد بنود مبيعات صريحة أو بمبلغ صفر/سالب
              if (!rawMain || rawMain.includes('مبيعات') || amount <= 0) return
              // البند اجتاز الفلاتر — سجّل الـ JN كـ "مُغطى" لتجنب تكراره من entries
              if (item.journal_number) docItemJNs.add(item.journal_number)
              addItem(rawMain, rawSub, amount, item.description)
            })

            // ── المصدر الثاني: قيود ledger اليدوية غير المغطاة بـ document_items ──
            ;(entries || []).forEach(e => {
              const out = (e.cash_out||0) + (e.bank_out||0) + (e.custody_out||0)
              if (!out) return
              const t = e.type || ''
              if (t.includes('تحويل داخلي') || t.includes('مبيعات') || t.includes('تحصيل')) return
              if (e.journal_number && docItemJNs.has(e.journal_number)) return
              addItem(t || '— غير محدد', null, out, e.description)
            })

            const mainRows = Object.entries(mainMap)
              .map(([cat, v]) => ({
                cat,
                total: v.total,
                rows: v.rows,
                subs: Object.entries(v.subs).map(([s, t]) => ({ cat: s, total: t })).sort((a, b) => b.total - a.total),
              }))
              .sort((a, b) => b.total - a.total)
            // إجمالي البطاقة = مجموع التفاصيل مباشرة (نفس المصدر)
            const grandTotal = mainRows.reduce((sum, cat) => sum + cat.total, 0)

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
                {/* بطاقة الإجمالي */}
                <div className="rounded-2xl p-5 shadow-sm" style={{ background: NAVY, border: `2px solid ${GOLD}` }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-white opacity-60 mb-1">إجمالي المصروفات</div>
                      <div className="text-2xl font-bold font-mono tabular-nums" style={{ color: GOLD }}>
                        {fmt(grandTotal)}
                        
                      </div>
                    </div>
                    <div className="text-4xl">🛒</div>
                  </div>
                  <div className="text-xs mt-2 opacity-50 text-white">
                    {mainRows.length} تصنيف رئيسي — {docItems.length || purchaseDocs.length} بند
                  </div>
                </div>

                {/* أكورديون التصنيفات الهرمية */}
                {mainRows.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs font-bold mb-2 flex items-center gap-2" style={{ color: NAVY }}>
                      <span>🏷️</span> تفصيل حسب التصنيف — اضغط للتوسيع
                    </div>
                    {mainRows.map((r, idx) => {
                      const _baseSales = engineSummary?.totalSales || data?.totalSales || 0
                      const pct  = _baseSales > 0 ? ((r.total / _baseSales) * 100).toFixed(1) : 0
                      const open = expandedCats.has(r.cat)
                      const clr  = mainCatColors[idx % mainCatColors.length]
                      const displayItems = r.subs.length > 0
                        ? r.subs
                        : r.rows.map(row => ({ cat: row.label, total: row.amount }))
                      return (
                        <div key={r.cat} className="rounded-2xl overflow-hidden shadow-sm"
                          style={{ border: `1.5px solid ${clr.border}` }}>
                          {/* صف التصنيف الرئيسي */}
                          <button
                            onClick={() => toggleCat(r.cat)}
                            className="w-full flex items-center gap-3 px-4 py-3 text-right transition-colors"
                            style={{ background: clr.bg, cursor: 'pointer' }}>
                            <span className="text-sm font-bold transition-transform duration-200"
                              style={{ color: clr.color, transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block', minWidth: '1rem' }}>
                              ▶
                            </span>
                            <span className="flex-1 font-bold text-sm text-right" style={{ color: clr.color }}>{r.cat}</span>
                            <div className="text-left">
                              <div className="font-bold font-mono tabular-nums text-sm" style={{ color: clr.color }}>
                                {fmt(r.total)}
                              </div>
                              <div className="text-xs opacity-60" style={{ color: clr.color }}>{pct}% من المبيعات</div>
                            </div>
                            <div className="w-20">
                              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.1)' }}>
                                <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: clr.color }} />
                              </div>
                            </div>
                          </button>

                          {/* صفوف التفصيل */}
                          {open && (
                            <div className="border-t" style={{ borderColor: clr.border }}>
                              {displayItems.map((s, si) => {
                                const sPct = _baseSales > 0 ? ((s.total / _baseSales) * 100).toFixed(1) : 0
                                return (
                                  <div key={si}
                                    className="flex items-center gap-3 px-5 py-2.5"
                                    style={{ background: si % 2 === 0 ? '#fff' : '#fafafa', borderBottom: si < displayItems.length-1 ? '1px solid #f5f4f0' : 'none' }}>
                                    <span className="text-slate-300 text-xs">└</span>
                                    <span className="flex-1 text-sm font-medium text-slate-700">📌 {s.cat}</span>
                                    <span className="font-mono tabular-nums text-sm font-semibold" style={{ color: clr.color }}>
                                      {fmt(s.total)}
                                    </span>
                                    <span className="text-xs text-slate-400 w-16 text-left">{sPct}% من المبيعات</span>
                                  </div>
                                )
                              })}
                              <div className="flex items-center gap-3 px-4 py-2"
                                style={{ background: clr.bg, borderTop: `1px solid ${clr.border}` }}>
                                <span className="flex-1 text-xs font-bold" style={{ color: clr.color }}>مجموع {r.cat}</span>
                                <span className="font-mono tabular-nums text-sm font-bold" style={{ color: clr.color }}>
                                  {fmt(r.total)}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* الإجمالي الكلي */}
                    <div className="rounded-2xl px-4 py-3 flex items-center justify-between"
                      style={{ background: NAVY }}>
                      <span className="font-bold text-white text-sm">الإجمالي الكلي للمصروفات</span>
                      <span className="font-mono tabular-nums font-bold text-lg" style={{ color: GOLD }}>
                        {fmt(grandTotal)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl p-12 text-center text-slate-400"
                    style={{ border: '1px solid #e8e5dc' }}>
                    <div className="text-4xl mb-3">🛒</div>
                    <p className="font-medium">لا توجد فواتير مشتريات مصنّفة في هذه الفترة</p>
                    <p className="text-xs mt-1">تظهر البيانات بعد اعتماد فواتير مسؤول المشتريات</p>
                  </div>
                )}
              </div>
            )
          })()}

          {/* ══════════════════ TAB 6: مقارنة الفروع ══════════════════ */}
          {activeTab === 'branches' && branches.length > 1 && (() => {
            // مبيعات كل فرع — فعلية من جدول sales (كل القنوات الخمس)
            const salesByBranch = {}
            allBranchSales.forEach(row => {
              const b = row.branch || '— غير محدد'
              if (!salesByBranch[b]) salesByBranch[b] = 0
              salesByBranch[b] += (row.cash_sales||0) + (row.network_sales||0) + (row.hunger_sales||0) + (row.jahez_sales||0) + (row.keeta_sales||0)
            })
            const totalSalesAll = Object.values(salesByBranch).reduce((s, v) => s + v, 0)
            // إجمالي المصروفات من كل القيود — بدون تصفية فرع (بدون تحويل داخلي)
            const totalExpenses = branchEntries
              .filter(e => !(e.type || '').includes('تحويل داخلي'))
              .reduce((s, e) => s + (e.cash_out||0) + (e.bank_out||0) + (e.custody_out||0), 0)

            const rows = branches.map(b => {
              const sales      = salesByBranch[b] || 0
              const shareRatio = totalSalesAll > 0 ? sales / totalSalesAll : 0
              const expenses   = totalExpenses * shareRatio
              const profit     = sales - expenses
              const margin     = sales > 0 ? (profit / sales * 100).toFixed(1) : null
              return { branch: b, sales, expenses, profit, margin, shareRatio }
            })
            const maxSales = Math.max(...rows.map(r => r.sales), 1)

            return (
              <div className="space-y-4">
                {/* ملاحظة توضيحية */}
                <div className="rounded-xl px-4 py-2.5 text-sm flex items-center gap-2"
                  style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
                  <span>ℹ️</span>
                  <span>المصروفات موزعة نسبياً حسب مبيعات كل فرع — المبيعات فعلية من جدول المبيعات</span>
                </div>

                {/* بطاقات الفروع */}
                <div className="grid sm:grid-cols-3 gap-4">
                  {rows.map(r => (
                    <div key={r.branch} className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: '1px solid #e8e5dc' }}>
                      <div className="px-4 py-3 font-bold text-sm" style={{ background: NAVY, color: '#fff' }}>
                        🏢 {r.branch}
                      </div>
                      <div className="p-4 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">المبيعات</span>
                          <span className="font-bold font-mono" style={{ color: '#16a34a' }}>{fmt(r.sales)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">المصروفات</span>
                          <span className="font-bold font-mono" style={{ color: '#dc2626' }}>{fmt(r.expenses)}</span>
                        </div>
                        <div className="flex justify-between text-sm border-t pt-2" style={{ borderColor: '#e8e5dc' }}>
                          <span className="font-bold text-slate-700">صافي الربح</span>
                          <span className="font-bold font-mono" style={{ color: r.profit >= 0 ? GOLD : '#dc2626' }}>
                            {fmt(r.profit)}
                          </span>
                        </div>
                        {r.margin !== null && (
                          <div className="flex justify-between text-xs text-slate-400">
                            <span>هامش الربح</span>
                            <span className="font-mono" style={{ color: r.profit >= 0 ? '#16a34a' : '#dc2626' }}>{r.margin}%</span>
                          </div>
                        )}
                        {/* شريط نسبة المبيعات */}
                        <div className="mt-2">
                          <div className="h-2 rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
                            <div className="h-full rounded-full transition-all"
                              style={{ width: `${Math.min((r.sales / maxSales) * 100, 100)}%`, background: r.profit >= 0 ? GOLD : '#dc2626' }} />
                          </div>
                          <div className="text-xs text-slate-400 mt-1 text-left">
                            {(r.shareRatio * 100).toFixed(1)}% من إجمالي المبيعات
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* جدول المقارنة */}
                <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: '1px solid #e8e5dc' }}>
                  <div className="px-5 py-4" style={{ background: NAVY }}>
                    <h2 className="font-bold text-white text-sm">🏢 جدول مقارنة الفروع</h2>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{from} — {to}</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ background: '#f5f4f0', borderBottom: `2px solid ${GOLD}` }}>
                          <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>الفرع</th>
                          <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: '#16a34a' }}>المبيعات</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-slate-400">النسبة</th>
                          <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: '#dc2626' }}>المصروفات *</th>
                          <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>صافي الربح</th>
                          <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: '#6b7280' }}>هامش الربح</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={r.branch} style={{ borderBottom: '1px solid #f5f4f0', background: i % 2 === 0 ? '#fff' : '#fafaf8' }}>
                            <td className="px-4 py-3 font-semibold" style={{ color: NAVY }}>🏢 {r.branch}</td>
                            <td className="px-4 py-3 font-mono tabular-nums font-bold" style={{ color: '#16a34a' }}>{fmt(r.sales)}</td>
                            <td className="px-4 py-3 font-mono tabular-nums text-slate-400 text-xs">{(r.shareRatio * 100).toFixed(1)}%</td>
                            <td className="px-4 py-3 font-mono tabular-nums font-bold" style={{ color: '#dc2626' }}>{fmt(r.expenses)}</td>
                            <td className="px-4 py-3 font-mono tabular-nums font-bold" style={{ color: r.profit >= 0 ? GOLD : '#dc2626' }}>{fmt(r.profit)}</td>
                            <td className="px-4 py-3 font-mono tabular-nums text-slate-500">{r.margin !== null ? `${r.margin}%` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: NAVY }}>
                          <td className="px-4 py-3 text-sm font-bold text-white">الإجمالي</td>
                          <td className="px-4 py-3 font-mono tabular-nums text-right text-xs font-bold" style={{ color: '#86efac' }}>
                            {fmt(totalSalesAll)}
                          </td>
                          <td className="px-4 py-3 font-mono tabular-nums text-right text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>100%</td>
                          <td className="px-4 py-3 font-mono tabular-nums text-right text-xs font-bold" style={{ color: '#fca5a5' }}>
                            {fmt(totalExpenses)}
                          </td>
                          <td className="px-4 py-3 font-mono tabular-nums text-right text-xs font-bold" style={{ color: GOLD }}>
                            {fmt(rows.reduce((s, r) => s + r.profit, 0))}
                          </td>
                          <td className="px-4 py-3" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <div className="px-5 py-2.5 text-xs" style={{ color: '#9ca3af', borderTop: '1px solid #f5f4f0' }}>
                    * المصروفات موزعة نسبياً حسب حصة كل فرع من إجمالي المبيعات
                  </div>
                </div>
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
