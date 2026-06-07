import React, { useEffect, useState, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'

const NAVY = '#0f2444'
const GOLD = '#c9a227'

const ROLE_AR = { owner: 'المالك', accountant: 'المحاسب', purchasing: 'مسؤول المشتريات', cashier: 'الكاشير' }

const QUICK_PERIODS = [
  { key: 'month',     label: 'هذا الشهر'    },
  { key: 'lastMonth', label: 'الشهر الماضي' },
  { key: 'quarter',   label: 'هذا الربع'    },
  { key: 'year',      label: 'هذه السنة'    },
]

const TABS = [
  { key: 'income',  label: 'قائمة الدخل',   icon: '📊' },
  { key: 'vat',     label: 'ضريبة القيمة المضافة', icon: '🏛️' },
  { key: 'balance', label: 'الأرصدة',        icon: '⚖️' },
  { key: 'trial',   label: 'ميزان المراجعة', icon: '📋' },
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
  const fmt = v => Math.abs(v || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2 })
  const neg  = !neutral && value < 0
  const color = neutral ? NAVY : neg ? '#dc2626' : positive ? '#16a34a' : NAVY
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm flex flex-col gap-2"
      style={{ border: `1px solid #e8e5dc` }}>
      <div className="flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <span className="text-xs font-semibold text-slate-500">{label}</span>
      </div>
      <div className="text-xl font-bold font-mono tabular-nums" style={{ color }}>
        {fmt(value)}
        <span className="text-xs font-normal text-slate-400 mr-1">ر.س</span>
      </div>
      {neg && <div className="text-xs text-red-500 font-semibold">⚠️ رصيد سالب</div>}
    </div>
  )
}

function IncomeRow({ label, value, bold, indent, color, line }) {
  const fmt = v => (v || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2 })
  return (
    <>
      {line && <div className="border-t my-2" style={{ borderColor: '#e8e5dc' }} />}
      <div className={`flex justify-between items-center py-2 ${indent ? 'pr-4' : ''}`}>
        <span className={`text-sm ${bold ? 'font-bold' : 'font-medium'}`}
          style={{ color: color || (bold ? NAVY : '#4b5563') }}>
          {label}
        </span>
        <span className={`text-sm font-mono tabular-nums ${bold ? 'font-bold' : ''}`}
          style={{ color: color || (bold ? NAVY : '#6b7280') }}>
          {fmt(value)} ر.س
        </span>
      </div>
    </>
  )
}

export default function Reports() {
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
  const [exporting, setExporting] = useState(false)
  const pdfRef      = useRef()
  const docsRowRefs = useRef([])

  useEffect(() => { load(init.from, init.to) }, [])

  function applyPreset(key) {
    setActivePeriod(key)
    const r = getPeriodRange(key)
    setFrom(r.from); setTo(r.to)
    load(r.from, r.to)
  }

  async function load(fromDate = from, toDate = to) {
    setLoading(true)
    const { data: proj } = await supabase.from('projects').select('id').eq('name','تحسيب-برو').single()
    if (!proj) { setLoading(false); return }

    const [
      { data: sales },
      { data: ledger },
      { data: ledgerFull },
      { data: documents },
      { data: allTime }
    ] = await Promise.all([
      supabase.from('sales').select('cash_sales,network_sales')
        .eq('project_id', proj.id).gte('date', fromDate).lte('date', toDate),
      supabase.from('ledger_entries').select('type,cash_out,bank_out,custody_out,cash_in,bank_in,custody_in,vat_amount')
        .eq('project_id', proj.id).gte('date', fromDate).lte('date', toDate),
      supabase.from('ledger_entries').select('id,date,type,description,cash_in,bank_in,custody_in,cash_out,bank_out,custody_out,total_amount,journal_number')
        .eq('project_id', proj.id).gte('date', fromDate).lte('date', toDate).order('date'),
      supabase.from('documents').select('file_name,uploaded_by,uploaded_at,analysis_result,journal_number,file_url')
        .eq('project_id', proj.id).eq('status','approved')
        .gte('uploaded_at', fromDate).lte('uploaded_at', toDate + 'T23:59:59').order('uploaded_at'),
      supabase.from('ledger_entries').select('cash_in,cash_out,bank_in,bank_out,custody_in,custody_out')
        .eq('project_id', proj.id).lte('date', toDate).neq('status', 'cancelled')
    ])

    const sum    = (list, field) => (list||[]).reduce((s,r) => s+(Number(r[field])||0), 0)
    const sumOut = (list, types) => (list||[]).filter(r=>types.includes(r.type))
      .reduce((s,r) => s+(r.cash_out||0)+(r.bank_out||0)+(r.custody_out||0), 0)

    const cashSales    = sum(sales,'cash_sales')
    const networkSales = sum(sales,'network_sales')
    const totalSales   = cashSales + networkSales
    const opEx         = sumOut(ledger, ['🛒 مصروفات تشغيلية'])
    const fixEx        = sumOut(ledger, ['💰 مصروفات ثابتة'])
    const loans        = sumOut(ledger, ['💳 قسط سيارة','💳 قسط شراء أرض','💳 قرض ١','💳 قرض ٢'])
    const draws        = sumOut(ledger, ['💼 مسحوبات سليمان','💼 مسحوبات أم طوبى'])
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

  const fmt  = v => (v||0).toLocaleString('ar-SA', { minimumFractionDigits: 2 })
  const fmtD = d => d ? new Date(d).toLocaleDateString('ar-SA') : ''

  let legacySeq = 0
  const entriesDisplay = entries.map(e => ({
    ...e, _displayNum: e.journal_number || `OLD-${String(++legacySeq).padStart(3,'0')}`,
  }))

  const cardBorder = { border: '1px solid #e8e5dc' }

  return (
    <div className="space-y-5">

      {/* ── رأس الصفحة ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: NAVY }}>التقارير المالية</h1>
          <p className="text-sm text-slate-500 mt-0.5">الفترة: {from} — {to}</p>
        </div>
        {data && activeTab === 'income' && (
          <button onClick={exportPdf} disabled={exporting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
            style={{ background: NAVY, color: '#fff' }}>
            {exporting
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>جارٍ التصدير...</>
              : <>📄 تصدير PDF</>
            }
          </button>
        )}
      </div>

      {/* ── فلتر الفترة ── */}
      <div className="bg-white rounded-2xl p-4 shadow-sm" style={cardBorder}>
        <div className="flex flex-wrap gap-2 mb-3">
          {QUICK_PERIODS.map(p => (
            <button key={p.key} onClick={() => applyPreset(p.key)}
              className="px-4 py-1.5 text-sm rounded-xl font-semibold transition-all"
              style={activePeriod === p.key
                ? { background: GOLD, color: NAVY }
                : { background: '#f5f4f0', color: '#4b5563' }
              }>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-slate-500 block mb-1">من تاريخ</label>
            <input type="date" value={from}
              onChange={e => { setFrom(e.target.value); setActivePeriod('custom') }}
              className="border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: '#d1c9b8', '--tw-ring-color': GOLD }} />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">إلى تاريخ</label>
            <input type="date" value={to}
              onChange={e => { setTo(e.target.value); setActivePeriod('custom') }}
              className="border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: '#d1c9b8', '--tw-ring-color': GOLD }} />
          </div>
          <button onClick={() => load(from, to)}
            className="px-5 py-2 rounded-xl text-sm font-bold transition-all"
            style={{ background: NAVY, color: '#fff' }}>
            تحديث
          </button>
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
          <div className="flex gap-1 p-1 rounded-2xl w-fit" style={{ background: '#e8e5dc' }}>
            {TABS.map(t => (
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

          {/* ══════════════════ TAB 1: قائمة الدخل ══════════════════ */}
          {activeTab === 'income' && (
            <div className="space-y-4">

              {/* KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <KpiCard label="إجمالي المبيعات"  value={data.totalSales}      icon="💵" positive />
                <KpiCard label="إجمالي المصروفات" value={data.opEx+data.fixEx} icon="📤" />
                <KpiCard label="مجمل الربح"        value={data.grossProfit}     icon="📊" positive={data.grossProfit>=0} />
                <KpiCard label="صافي الربح"        value={data.netProfit}       icon="📈" positive={data.netProfit>=0} />
                <KpiCard label="صافي التدفق"       value={data.netFlow}         icon="💧" positive={data.netFlow>=0} />
              </div>

              {/* Income Statement + Breakdown */}
              <div className="grid md:grid-cols-2 gap-4">

                {/* قائمة الدخل */}
                <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={cardBorder}>
                  <div className="px-5 py-4" style={{ background: NAVY }}>
                    <h2 className="font-bold text-white text-sm">📊 قائمة الدخل</h2>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{from} — {to}</p>
                  </div>
                  <div className="p-5">
                    <IncomeRow label="مبيعات كاش"          value={data.cashSales}    indent />
                    <IncomeRow label="مبيعات شبكة"         value={data.networkSales} indent />
                    <IncomeRow label="إجمالي المبيعات"     value={data.totalSales}   bold line />
                    <IncomeRow label="مصروفات تشغيلية"     value={-data.opEx}        indent color="#dc2626" />
                    <IncomeRow label="مصروفات ثابتة"       value={-data.fixEx}       indent color="#dc2626" />
                    <IncomeRow label="مجمل الربح"          value={data.grossProfit}  bold  line color={data.grossProfit>=0?'#16a34a':'#dc2626'} />
                    <IncomeRow label="الأقساط"             value={-data.loans}       indent color="#dc2626" />
                    <IncomeRow label="صافي الربح"          value={data.netProfit}    bold  line color={data.netProfit>=0?'#16a34a':'#dc2626'} />
                    <IncomeRow label="المسحوبات"            value={-data.draws}       indent color="#dc2626" />
                    <IncomeRow label="صافي التدفق النقدي"  value={data.netFlow}      bold  line color={data.netFlow>=0?'#1d4ed8':'#dc2626'} />
                    <div className="mt-3 pt-3 flex justify-between items-center" style={{ borderTop: '1px solid #e8e5dc' }}>
                      <span className="text-xs text-slate-500 font-medium">هامش الربح الصافي</span>
                      <span className="text-sm font-bold font-mono" style={{ color: Number(data.margin)>=0 ? GOLD : '#dc2626' }}>
                        {data.margin}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* بطاقات الملخص */}
                <div className="space-y-3">
                  {[
                    { label:'إجمالي المبيعات',   value:data.totalSales,      icon:'💵', color:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0' },
                    { label:'المصروفات التشغيلية',value:data.opEx,            icon:'🛒', color:'#dc2626', bg:'#fef2f2', border:'#fecaca' },
                    { label:'المصروفات الثابتة',  value:data.fixEx,           icon:'💰', color:'#b45309', bg:'#fffbeb', border:'#fde68a' },
                    { label:'الأقساط',            value:data.loans,           icon:'💳', color:'#7c3aed', bg:'#f5f3ff', border:'#ddd6fe' },
                    { label:'المسحوبات',           value:data.draws,           icon:'💼', color:'#0369a1', bg:'#f0f9ff', border:'#bae6fd' },
                  ].map(c => (
                    <div key={c.label} className="flex items-center justify-between px-4 py-3 rounded-xl"
                      style={{ background: c.bg, border: `1px solid ${c.border}` }}>
                      <div className="flex items-center gap-2.5">
                        <span className="text-xl">{c.icon}</span>
                        <span className="text-sm font-semibold" style={{ color: NAVY }}>{c.label}</span>
                      </div>
                      <span className="font-bold font-mono tabular-nums text-sm" style={{ color: c.color }}>
                        {(c.value||0).toLocaleString('ar-SA', { minimumFractionDigits: 2 })} ر.س
                      </span>
                    </div>
                  ))}
                </div>
              </div>
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
                  <div key={c.label} className="rounded-2xl p-5 shadow-sm" style={{ background: c.bg, border: `2px solid ${c.border}` }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-2xl">{c.icon}</span>
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{c.label}</span>
                    </div>
                    <div className="text-xs text-slate-400 mb-2">{c.sub}</div>
                    <div className="text-2xl font-bold font-mono tabular-nums" style={{ color: c.color }}>
                      {(c.value||0).toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                      <span className="text-sm font-normal text-slate-400 mr-1">ر.س</span>
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
                    ⚠️ يجب تحويل <span className="font-mono">{(data.netVat).toLocaleString('ar-SA', { minimumFractionDigits: 2 })}</span> ر.س لهيئة الزكاة والضريبة والجمارك
                  </div>
                )}
                {data.netVat < 0 && (
                  <div className="mx-5 mb-5 p-3 rounded-xl text-sm font-semibold" style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}>
                    ✅ لديك فائض ضريبي بقيمة <span className="font-mono">{Math.abs(data.netVat).toLocaleString('ar-SA', { minimumFractionDigits: 2 })}</span> ر.س قابل للاسترداد
                  </div>
                )}
              </div>

              {/* فواتير المشتريات التي تحتوي ضريبة */}
              {data.vatEntries?.length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: '1px solid #e8e5dc' }}>
                  <div className="px-5 py-4 flex items-center justify-between" style={{ background: '#fef2f2', borderBottom: '1px solid #fecaca' }}>
                    <h2 className="font-bold text-sm text-red-800">📥 فواتير المشتريات — ضريبة المدخلات ({data.vatEntries.length})</h2>
                    <span className="font-mono font-bold text-red-700 text-sm">{fmt(data.inputVat)} ر.س</span>
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
                  <div key={c.label} className="rounded-2xl p-5 shadow-sm"
                    style={{ background: c.bg, border: `2px solid ${c.border}` }}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-2xl">{c.icon}</span>
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{c.label}</span>
                    </div>
                    <div className="text-2xl font-bold font-mono tabular-nums"
                      style={{ color: c.value < 0 ? '#dc2626' : c.color }}>
                      {Math.abs(c.value || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                      <span className="text-sm font-normal text-slate-400 mr-1">ر.س</span>
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

          {/* ══════════════════ TAB 3: ميزان المراجعة ══════════════════ */}
          {activeTab === 'trial' && (
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={cardBorder}>
              <div className="px-5 py-4 flex items-center justify-between" style={{ background: NAVY }}>
                <h2 className="font-bold text-white text-sm">📋 ميزان المراجعة</h2>
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
        </>
      )}

      {/* ── PDF Template (hidden) ── */}
      <div ref={pdfRef} style={{ display:'none', width:'794px', fontFamily:'Cairo,Arial,sans-serif', direction:'rtl', background:'#fff', padding:'36px', color:'#1e293b' }}>
        <div style={{ textAlign:'center', borderBottom:`4px solid ${GOLD}`, paddingBottom:'16px', marginBottom:'24px' }}>
          <div style={{ fontSize:'26px', fontWeight:'bold', color:NAVY }}>تحسيب برو</div>
          <div style={{ fontSize:'16px', fontWeight:'bold', marginTop:'4px', color:'#374151' }}>التقرير المالي</div>
          <div style={{ fontSize:'13px', color:'#6b7280', marginTop:'6px' }}>الفترة من {from} إلى {to}</div>
          <div style={{ fontSize:'11px', color:'#9ca3af', marginTop:'3px' }}>تاريخ الطباعة: {new Date().toLocaleDateString('ar-SA')}</div>
        </div>

        {data && <>
          <div style={{ marginBottom:'24px' }}>
            <div style={{ fontSize:'14px', fontWeight:'bold', background:NAVY, color:'#fff', padding:'8px 14px', borderRadius:'6px', marginBottom:'10px' }}>
              ملخص قائمة الدخل
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'12px' }}>
              <tbody>
                {[
                  ['مبيعات كاش',         fmt(data.cashSales),    false, true,  '#374151'],
                  ['مبيعات شبكة',        fmt(data.networkSales), false, true,  '#374151'],
                  ['إجمالي المبيعات',     fmt(data.totalSales),   true,  false, NAVY],
                  ['مصروفات تشغيلية',     `(${fmt(data.opEx)})`,  false, true,  '#dc2626'],
                  ['مصروفات ثابتة',       `(${fmt(data.fixEx)})`, false, true,  '#dc2626'],
                  ['مجمل الربح',          fmt(data.grossProfit),  true,  false, data.grossProfit>=0?'#16a34a':'#dc2626'],
                  ['الأقساط',             `(${fmt(data.loans)})`, false, true,  '#dc2626'],
                  ['صافي الربح',          fmt(data.netProfit),    true,  false, data.netProfit>=0?'#16a34a':'#dc2626'],
                  ['المسحوبات',           `(${fmt(data.draws)})`, false, true,  '#dc2626'],
                  ['صافي التدفق النقدي',  fmt(data.netFlow),      true,  false, data.netFlow>=0?'#1d4ed8':'#dc2626'],
                  ['هامش الربح',          `${data.margin}%`,      true,  false, GOLD],
                ].map(([label, value, bold, indent, color], i) => (
                  <tr key={i} style={{ borderBottom:'1px solid #f1f5f9' }}>
                    <td style={{ padding:'7px 8px', paddingRight:indent?'24px':'8px', fontWeight:bold?'bold':'normal' }}>{label}</td>
                    <td style={{ padding:'7px 8px', textAlign:'left', fontWeight:bold?'bold':'normal', color }}>{value} ر.س</td>
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
                <div style={{ fontSize:'15px', fontWeight:'bold', color:b.color }}>{b.value} ر.س</div>
              </div>
            ))}
          </div>

          {entriesDisplay.length > 0 && (
            <div style={{ marginBottom:'24px' }}>
              <div style={{ fontSize:'14px', fontWeight:'bold', background:NAVY, color:'#fff', padding:'8px 14px', borderRadius:'6px', marginBottom:'10px' }}>
                تفاصيل القيود ({entriesDisplay.length} قيد)
              </div>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'10px' }}>
                <thead>
                  <tr style={{ background:'#f5f4f0', borderBottom:`2px solid ${GOLD}` }}>
                    {['رقم القيد','التاريخ','النوع','الوصف','مدين','دائن'].map(h => (
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
                        <td style={{ padding:'5px 6px', fontWeight:'bold', color:NAVY }}>{amount>0?fmt(amount)+' ر.س':'—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ borderTop:`2px solid ${GOLD}`, paddingTop:'12px', textAlign:'center', color:'#9ca3af', fontSize:'10px', marginTop:'16px' }}>
            تم إنشاء هذا التقرير بواسطة تحسيب برو — {new Date().toLocaleString('ar-SA')}
          </div>
        </>}
      </div>
    </div>
  )
}
