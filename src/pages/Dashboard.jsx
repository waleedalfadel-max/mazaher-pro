import AccountCards from '../components/AccountCards.jsx'
import { usesCompactHome } from '../lib/businessPresentation.js'
import { accountDashboard, accountBalances, liabilityFigures, suppliersOutstanding, netLiquidity } from '../lib/accountStatement.js'
import { operatingBankFigures, OPERATING_BALANCE_NOTE } from '../lib/paymentWorkflow.js'
import { getProjectSettings } from '../lib/projectSettings.js'
import { APPS, receivableBalances } from '../lib/appStatement.js'
import React, { useEffect, useState, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { fetchEveryRow } from '../lib/fetchAll.js'
import { useAuth } from '../contexts/AuthContext'
import { Link } from 'react-router-dom'
import { ChevronDown, ClipboardList, FileText, Hourglass, Info, Receipt, RefreshCw, ShoppingBasket, Upload, Wallet } from 'lucide-react'
import { Metric, Money, Panel, Segment } from '../ui/components.jsx'
import { getFinancialSummary, isSales, salesAmountNet, expenseAmountNet } from '../lib/financialEngine'
import { uncountedText } from '../lib/financeRules.js'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  BarChart, Bar,
} from 'recharts'

const NAVY = '#1B3A5C'
const GOLD = '#6EB7B0'

const CHANNEL_COLORS = {
  'كاش':     '#6EB7B0', 'شبكة':   '#1B3A5C', 'تحويل': '#3b82f6',
  'هنقر':    '#ef4444', 'جاهز':   '#f97316', 'كيتا':  '#8b5cf6',
  'مرسول':   '#10b981', 'سلة':    '#06b6d4', 'تابي':  '#ec4899',
  'تمارا':   '#84cc16', 'تحصيل':  '#6366f1', 'نينجا': '#0ea5e9',
}
const EXPENSE_COLORS = ['#ef4444','#f97316','#8b5cf6','#1B3A5C','#06b6d4']
const BRANCH_COLORS  = ['#6EB7B0','#2D7A5F','#D4922A','#E9D8BB','#1B3A5C']
const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

function channelOf(type) {
  const t = type || ''
  if (t.includes('كاش'))    return 'كاش'
  if (t.includes('شبكة'))   return 'شبكة'
  if (t.includes('تحويل'))  return 'تحويل'
  if (t.includes('هنقر'))   return 'هنقر'
  if (t.includes('جاهز'))   return 'جاهز'
  if (t.includes('كيتا'))   return 'كيتا'
  if (t.includes('مرسول'))  return 'مرسول'
  if (t.includes('نينجا'))  return 'نينجا'
  if (t.includes('سلة'))    return 'سلة'
  if (t.includes('تابي'))   return 'تابي'
  if (t.includes('تمارا'))  return 'تمارا'
  if (t.includes('تحصيل'))  return 'تحصيل'
  return 'أخرى'
}

const fmt  = v => (v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtK = v => v >= 1000 ? `${(v / 1000).toFixed(1)}ك` : String(Math.round(v))

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function getPrevMonthRange(r) {
  const [fy, fm, fd] = r.from.split('-').map(Number)
  const [ty, tm, td] = r.to.split('-').map(Number)
  return {
    from: fmtDate(new Date(fy, fm - 2, fd)),
    to:   fmtDate(new Date(ty, tm - 2, td)),
  }
}

function getMonthRange(year, month) {
  const last = new Date(year, month, 0).getDate()
  return {
    from: `${year}-${String(month).padStart(2,'0')}-01`,
    to:   `${year}-${String(month).padStart(2,'0')}-${last}`,
  }
}

// ── مكونات ──────────────────────────────────────────────────────────

function BalanceCard({ label, icon, value, color }) {
  const neg = value < 0
  return (
    <div className="rounded-2xl p-5 shadow-sm text-center" style={{ background: neg ? '#fef2f2' : '#fff', border: `2px solid ${neg ? '#fecaca' : '#e8e5dc'}` }}>
      <div className="flex flex-col items-center gap-1 mb-3">
        <span className="text-2xl">{icon}</span>
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold font-mono tabular-nums" style={{ color: neg ? '#dc2626' : color }}>
        {Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2 })}
      </div>
      {neg && <div className="text-xs text-red-500 font-semibold mt-2">⚠️ رصيد سالب</div>}
    </div>
  )
}

function KpiCard({ label, value, negative, cmpValue, cmpLabel, foot }) {
  const isNeg  = negative ?? value < 0
  // فرق الفترة المقارَنة — يظهر فقط عند تفعيل المقارنة واختيار فترة
  const hasCmp = cmpValue !== null && cmpValue !== undefined
  const delta  = hasCmp ? value - cmpValue : 0
  const pct    = hasCmp && cmpValue !== 0 ? ((delta / Math.abs(cmpValue)) * 100).toFixed(1) : null
  const up     = delta >= 0
  return (
    <div className={`ts-metric${isNeg ? ' ts-metric--bad' : ''}`}>
      <div className="ts-metric-top"><span className="ts-metric-label">{label}</span></div>
      <div className="ts-metric-value"><Money value={value} /></div>
      {hasCmp && (
        <div className="ts-metric-foot" title={cmpLabel || ''}>
          <span style={{ color: up ? 'var(--ts-success)' : 'var(--ts-danger)', fontWeight: 600 }}>{up ? '▲' : '▼'} {pct !== null ? `${Math.abs(pct)}%` : '—'}</span>
          {' '}مقابل <span className="ts-num">{fmt(cmpValue)}</span>
        </div>
      )}
      {foot && !hasCmp && <div className="ts-metric-foot">{foot}</div>}
      {isNeg && <div className="ts-metric-foot" style={{ color: 'var(--ts-danger)' }}>رصيد سالب</div>}
    </div>
  )
}

function ChartCard({ title, children }) {
  return (
    <section className="ts-panel ts-panel-pad">
      <h2 className="rp-chart-title">{title}</h2>
      {children}
    </section>
  )
}

function MultiLineTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border rounded-xl shadow-lg p-3 text-sm" style={{ borderColor: '#e8e5dc', direction: 'rtl' }}>
      <div className="font-bold mb-1" style={{ color: NAVY }}>يوم {label}</div>
      {payload.filter(p => p.value != null).map((p, i) => (
        <div key={i} style={{ color: p.stroke }}>{p.name}: {fmt(p.value)} ر.س</div>
      ))}
    </div>
  )
}

function BarTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border rounded-xl shadow-lg p-3 text-sm" style={{ borderColor: '#e8e5dc', direction: 'rtl' }}>
      <div className="font-bold mb-1" style={{ color: NAVY }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.fill }}>{p.name}: {fmt(p.value)} ر.س</div>
      ))}
    </div>
  )
}

function PieTip({ active, payload, total }) {
  if (!active || !payload?.length) return null
  const d   = payload[0]
  const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0'
  return (
    <div className="bg-white border rounded-xl shadow-lg p-3 text-sm" style={{ borderColor: '#e8e5dc', direction: 'rtl' }}>
      <div className="font-bold" style={{ color: NAVY }}>{d.name}</div>
      <div>{fmt(d.value)} ر.س</div>
      <div className="text-slate-500 text-xs">{pct}%</div>
    </div>
  )
}

const RADIAN = Math.PI / 180
function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.07) return null
  const r = innerRadius + (outerRadius - innerRadius) * 0.55
  const x = cx + r * Math.cos(-midAngle * RADIAN)
  const y = cy + r * Math.sin(-midAngle * RADIAN)
  return <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight="bold">{`${(percent * 100).toFixed(0)}%`}</text>
}

const QUICK_PERIODS = [
  { key: 'month',     label: 'الشهر الحالي' },
  { key: 'lastMonth', label: 'الشهر الماضي' },
  { key: 'year',      label: 'السنة الحالية' },
]

function getRange(type) {
  const n  = new Date()
  const to = fmtDate(n)
  if (type === 'lastMonth') {
    const lm  = new Date(n.getFullYear(), n.getMonth() - 1, 1)
    const lme = new Date(n.getFullYear(), n.getMonth(), 0)
    return { from: fmtDate(lm), to: fmtDate(lme) }
  }
  const from = type === 'month'
    ? `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2,'0')}-01`
    : `${n.getFullYear()}-01-01`
  return { from, to }
}

// ── المكوّن الرئيسي ──────────────────────────────────────────────────

export default function Dashboard() {
  const { roleLabel, role, userName, projectId: pid, projectName, sessionEpoch } = useAuth()
  const compactHome = usesCompactHome(projectName)
  const [pendingDocs, setPendingDocs] = useState(null)
  const [pendingError, setPendingError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [cmpError, setCmpError] = useState('')
  const mainRequest = useRef(0)
  const pendingRequest = useRef(0)
  const compareRequest = useRef(0)

  // بيانات رئيسية
  const [stats,        setStats]        = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [balances,     setBalances]     = useState(null)
  const [receivables,  setReceivables]  = useState(null)
  const [activePeriod, setActivePeriod] = useState('month')
  const [range,        setRange]        = useState(getRange('month'))
  const [chartEntries, setChartEntries] = useState([])

  // بيانات المقارنة
  const [cmpOpen,    setCmpOpen]    = useState(false)
  const [cmpMode,    setCmpMode]    = useState(null)   // null | 'prev' | 'custom'
  const [cmpRange,   setCmpRange]   = useState(null)
  const [cmpStats,   setCmpStats]   = useState(null)
  const [cmpEntries, setCmpEntries] = useState([])
  const [cmpLoading, setCmpLoading] = useState(false)
  const [cmpLabel,   setCmpLabel]   = useState('')
  const [customYear,  setCustomYear]  = useState(new Date().getFullYear())
  const [customMonth, setCustomMonth] = useState(new Date().getMonth() === 0 ? 12 : new Date().getMonth()) // شهر ما قبل الحالي
  const [showPicker,       setShowPicker]       = useState(false)
  const [showMainPicker,   setShowMainPicker]   = useState(false)
  const [mainPickerYear,   setMainPickerYear]   = useState(new Date().getFullYear())
  const [mainPickerMonth,  setMainPickerMonth]  = useState(new Date().getMonth() + 1)

  const liveRef        = useRef({ pid: null, range: getRange('month') })
  const cmpRef         = useRef(null)
  const mainPickerRef  = useRef()

  useEffect(() => { liveRef.current = { pid, range, cmpRange, cmpMode } }, [pid, range, cmpRange, cmpMode])

  // إغلاق dropdown عند الضغط خارجه
  useEffect(() => {
    function onClickOutside(e) {
      if (cmpRef.current && !cmpRef.current.contains(e.target)) {
        setCmpOpen(false)
        setShowPicker(false)
      }
    }
    if (cmpOpen) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [cmpOpen])

  useEffect(() => {
    function onOutside(e) {
      if (mainPickerRef.current && !mainPickerRef.current.contains(e.target)) setShowMainPicker(false)
    }
    if (showMainPicker) document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [showMainPicker])

  useEffect(() => {
    if (pid) {
      loadMain(range, pid)
      loadPending(pid)
      if (cmpMode && cmpRange) loadCmpStats(cmpRange, pid)
    }
    return () => { mainRequest.current++; pendingRequest.current++; compareRequest.current++ }
  }, [pid, sessionEpoch])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const { pid: p, range: r, cmpRange: cr, cmpMode: mode } = liveRef.current
      if (p) { loadMain(r, p); loadPending(p); if (mode && cr) loadCmpStats(cr, p) }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // ── دوال التحميل ───────────────────────────────────────────────────

  async function loadPending(projectId) {
    const request = ++pendingRequest.current
    setPendingDocs(null); setPendingError('')
    try {
      const result = await fetchEveryRow(() => supabase.from('documents').select('id,uploaded_at')
        .eq('project_id', projectId).in('status', ['uploaded', 'analyzed']).order('uploaded_at').order('id'))
      if (result.error) throw result.error
      if (request === pendingRequest.current) setPendingDocs(result.data)
    } catch {
      if (request === pendingRequest.current) setPendingError('تعذّر تحميل المستندات بانتظار المراجعة')
    }
  }

  async function loadMain(r, projectId) {
    const request = ++mainRequest.current
    setLoading(true); setLoadError(''); setStats(null); setChartEntries([]); setBalances(null); setReceivables(null)
    try {
      if (!projectId || !r.from || !r.to || r.from > r.to) throw new Error('invalid_range')
      const [summary, result, settingsResult, banksResult] = await Promise.all([
        getFinancialSummary(projectId, r.from, r.to),
        fetchEveryRow(() => supabase.from('ledger_entries')
          .select('type,description,date,status,cash_in,cash_out,bank_in,bank_out,custody_in,custody_out,receivable_in,receivable_out,bank_account_id,payable_in,payable_out,supplier_id')
          .eq('project_id', projectId).neq('status','cancelled').lte('date', r.to).order('id')),
        getProjectSettings(projectId),
        supabase.from('bank_accounts').select('id,name,bank,is_active').eq('project_id',projectId),
      ])
      if (!summary || result.error || !settingsResult?.settings) throw new Error('load_failed')
      if (request !== mainRequest.current) return
      const cfg = accountDashboard(settingsResult?.settings)
      let supplierBalance = null
      if (cfg) {
        if (banksResult.error) throw new Error('banks')
        const [suppliers, txns] = await Promise.all([
          fetchEveryRow(() => supabase.from('suppliers').select('id,opening_balance').eq('project_id',projectId).order('id')),
          fetchEveryRow(() => supabase.from('supplier_transactions').select('supplier_id,type,amount,date').eq('project_id',projectId).lte('date',r.to).order('id')),
        ])
        if (suppliers.error || txns.error) throw new Error('suppliers')
        if (request !== mainRequest.current) return
        supplierBalance = suppliersOutstanding(suppliers.data,txns.data,result.data,r.to)
      }
      const rows = result.data
      const bankByAccount = rows.reduce((m,e)=>{ const k=e.bank_account_id||''; m[k]=(m[k]||0)+Math.round(Number(e.bank_in||0)*100)-Math.round(Number(e.bank_out||0)*100);return m },{})
      const countedBalances = cfg ? accountBalances(rows,r.to) : null
      setBalances({
        liquidity: countedBalances && !banksResult.error ? netLiquidity(countedBalances, banksResult.data, settingsResult?.settings) : null,
        settings: settingsResult?.settings, supplierBalance, liabilities: liabilityFigures(rows,settingsResult?.settings,r.to),
        ...(countedBalances || {}),
        operating: banksResult.error ? null : operatingBankFigures(banksResult.data,bankByAccount,settingsResult?.settings),
        cash: cfg ? countedBalances.cash : rows.reduce((s,r) => s + (r.cash_in ||0) - (r.cash_out ||0), 0),
        bank: cfg ? countedBalances.bank : rows.reduce((s,r) => s + (r.bank_in ||0) - (r.bank_out ||0), 0),
        custody: cfg ? countedBalances.custody : rows.reduce((s,r) => s + (r.custody_in||0) - (r.custody_out||0), 0),
      })
      // ذمم التطبيقات بإشارتها (src/lib/appStatement.js، القاعدة نفسها في «كشف حساب التطبيقات»): الرصيد السالب يظهر ولا يُخفى
      const rcv = receivableBalances(rows)
      setReceivables(rcv.active.length || rcv.unassigned ? rcv : null)
      setStats({ totalSales:summary.totalSales, totalExpenses:summary.totalExpenses, profit:summary.netProfit,
        grossProfit:summary.grossProfit, cogs:summary.cogs||0, operatingExpenses:summary.operatingExpenses||0,
        grossSales:summary.grossSales||0, outputVat:summary.outputVat||0, uncounted: uncountedText(summary.uncounted) })
      setChartEntries(summary.entries || [])
    } catch {
      if (request === mainRequest.current) setLoadError(!r.from || !r.to || r.from > r.to
        ? 'اختر فترة صحيحة لعرض الأرقام' : 'تعذّر تحميل أرقام لوحة التحكم. أعد المحاولة لعرض الأرقام كاملة.')
    } finally { if (request === mainRequest.current) setLoading(false) }
  }

  async function loadCmpStats(r, projectId) {
    const request = ++compareRequest.current
    setCmpStats(null); setCmpEntries([]); setCmpError('')
    if (!r || !projectId) { setCmpLoading(false); return }
    setCmpLoading(true)
    try {
      const summary = await getFinancialSummary(projectId, r.from, r.to)
      if (!summary) throw new Error('load_failed')
      if (request !== compareRequest.current) return
      setCmpStats({ totalSales:summary.totalSales, totalExpenses:summary.totalExpenses, profit:summary.netProfit,
        grossProfit:summary.grossProfit, cogs:summary.cogs||0, operatingExpenses:summary.operatingExpenses||0 })
      setCmpEntries(summary.entries || [])
    } catch {
      if (request === compareRequest.current) setCmpError('تعذّر تحميل أرقام المقارنة')
    } finally { if (request === compareRequest.current) setCmpLoading(false) }
  }

  function refreshDashboard() {
    if (!pid) return
    loadMain(range, pid); loadPending(pid)
    if (cmpMode && cmpRange) loadCmpStats(cmpRange, pid)
  }

  // ── معالجات الفترة ─────────────────────────────────────────────────

  function handlePeriod(key) {
    setActivePeriod(key)
    setShowMainPicker(false)
    const r = getRange(key)
    setRange(r)
    if (pid) {
      loadMain(r, pid)
      if (cmpMode === 'prev') {
        const cr = getPrevMonthRange(r)
        setCmpRange(cr)
        loadCmpStats(cr, pid)
      }
    }
  }

  function applyMainPicker() {
    const last = new Date(mainPickerYear, mainPickerMonth, 0).getDate()
    const from = `${mainPickerYear}-${String(mainPickerMonth).padStart(2,'0')}-01`
    const to   = `${mainPickerYear}-${String(mainPickerMonth).padStart(2,'0')}-${last}`
    setRange({ from, to })
    setActivePeriod('month-picker')
    setShowMainPicker(false)
    if (pid) { loadMain({ from, to }, pid) }
  }

  function handleCustom(field, val) {
    setActivePeriod('custom')
    setRange(prev => ({ ...prev, [field]: val }))
  }

  // ── تفعيل/إلغاء المقارنة ──────────────────────────────────────────

  function activatePrevCompare() {
    const cr = getPrevMonthRange(range)
    setCmpMode('prev')
    setCmpRange(cr)
    // label: الشهر السابق
    const d = new Date(range.from)
    d.setMonth(d.getMonth() - 1)
    setCmpLabel(`${MONTHS_AR[d.getMonth()]} ${d.getFullYear()}`)
    setCmpOpen(false)
    setShowPicker(false)
    if (pid) loadCmpStats(cr, pid)
  }

  function applyCustomCompare() {
    const cr = getMonthRange(customYear, customMonth)
    setCmpMode('custom')
    setCmpRange(cr)
    setCmpLabel(`${MONTHS_AR[customMonth - 1]} ${customYear}`)
    setCmpOpen(false)
    setShowPicker(false)
    if (pid) loadCmpStats(cr, pid)
  }

  function cancelCompare() {
    compareRequest.current++; setCmpLoading(false); setCmpError('')
    setCmpMode(null)
    setCmpRange(null)
    setCmpStats(null)
    setCmpEntries([])
    setCmpLabel('')
    setCmpOpen(false)
    setShowPicker(false)
  }

  // ── بيانات الرسوم ──────────────────────────────────────────────────

  // خط المبيعات اليومية — محور X: رقم اليوم لتوافق فترتين مختلفتين
  const combinedDailyData = useMemo(() => {
    const cur = {}, cmp = {}
    chartEntries.forEach(e => {
      if (!isSales(e.type)) return
      const day = parseInt(e.date.split('-')[2])
      cur[day] = (cur[day]||0) + salesAmountNet(e)
    })
    cmpEntries.forEach(e => {
      if (!isSales(e.type)) return
      const day = parseInt(e.date.split('-')[2])
      cmp[day] = (cmp[day]||0) + salesAmountNet(e)
    })
    const days = new Set([...Object.keys(cur), ...Object.keys(cmp)].map(Number))
    return [...days].sort((a,b)=>a-b).map(day => ({
      day,
      'الحالي':   cur[day] ?? null,
      'المقارنة': cmpEntries.length ? (cmp[day] ?? null) : undefined,
    }))
  }, [chartEntries, cmpEntries])

  const channelPieData = useMemo(() => {
    const ch = {}
    chartEntries.forEach(e => {
      if (!isSales(e.type)) return
      const c = channelOf(e.type)
      ch[c] = (ch[c]||0) + salesAmountNet(e)
    })
    return Object.entries(ch).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).map(([name,value])=>({name,value}))
  }, [chartEntries])

  const expensePieData = useMemo(() => {
    const ex = {}
    chartEntries.forEach(e => {
      if (isSales(e.type)) return
      const out = expenseAmountNet(e)
      if (!out) return
      const label = (e.type||'— غير محدد').replace(/^[ -؀︀-﻿]+/, '').trim() || e.type || '— غير محدد'
      ex[label] = (ex[label]||0) + out
    })
    return Object.entries(ex).sort(([,a],[,b])=>b-a).slice(0,5).map(([name,value])=>({name,value}))
  }, [chartEntries])

  // أعمدة أسبوعية — مع المقارنة إن وُجدت
  const combinedWeeklyData = useMemo(() => {
    if (chartEntries.length === 0) return []
    const fromMs  = new Date(range.from).getTime()
    const totalMs = new Date(range.to).getTime() - fromMs
    const wMs     = totalMs / 4

    const weeks = Array.from({ length: 4 }, (_, i) => ({
      name:     `أ${i+1}`,
      from:     new Date(fromMs + i*wMs).toISOString().split('T')[0],
      to:       new Date(fromMs + (i+1)*wMs - 1).toISOString().split('T')[0],
      مبيعات:  0,
      مصروفات: 0,
    }))
    chartEntries.forEach(e => {
      const w = weeks.find(w => e.date >= w.from && e.date <= w.to)
      if (!w) return
      if (isSales(e.type)) w['مبيعات']  += salesAmountNet(e)
      else                  w['مصروفات'] += expenseAmountNet(e)
    })

    // دمج بيانات المقارنة إذا كانت موجودة
    if (cmpEntries.length > 0 && cmpRange) {
      const cFromMs  = new Date(cmpRange.from).getTime()
      const cTotalMs = new Date(cmpRange.to).getTime() - cFromMs
      const cwMs     = cTotalMs / 4
      const cWeeks   = Array.from({ length: 4 }, (_, i) => ({
        from:  new Date(cFromMs + i*cwMs).toISOString().split('T')[0],
        to:    new Date(cFromMs + (i+1)*cwMs - 1).toISOString().split('T')[0],
        sales: 0,
      }))
      cmpEntries.forEach(e => {
        if (!isSales(e.type)) return
        const w = cWeeks.find(w => e.date >= w.from && e.date <= w.to)
        if (w) w.sales += salesAmountNet(e)
      })
      weeks.forEach((w, i) => { w['مقارنة'] = cWeeks[i]?.sales || 0 })
    }

    return weeks.filter(w => w['مبيعات'] > 0 || w['مصروفات'] > 0)
  }, [chartEntries, cmpEntries, range, cmpRange])

  const branchSalesData = useMemo(() => {
    if (chartEntries.length === 0) return []
    const bMap = {}
    chartEntries.forEach(e => {
      if (!isSales(e.type) || !e.branch) return
      bMap[e.branch] = (bMap[e.branch] || 0) + salesAmountNet(e)
    })
    return Object.entries(bMap).filter(([,v]) => v > 0).map(([name, مبيعات]) => ({ name, مبيعات }))
  }, [chartEntries])

  const totalChannelSales = channelPieData.reduce((s,d)=>s+d.value, 0)
  const totalExpensePie   = expensePieData.reduce((s,d)=>s+d.value, 0)
  const hasCharts   = !loading && chartEntries.length > 0
  const hasCompare  = !!cmpMode && !!cmpStats && !cmpLoading && !cmpError
  const thisYear    = new Date().getFullYear()

  const COMPARE_ENABLED = true

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 rp-dash">

      {/* Header */}
      <div className="ts-heading">
        <div>
          <h1>أهلًا {userName || ''}</h1>
          <p>{roleLabel}{projectName ? ` · ${projectName}` : ''}</p>
        </div>
        <button
          onClick={refreshDashboard} aria-label="تحديث"
          disabled={loading} className="ts-btn">
          <RefreshCw className={`ts-icon${loading ? ' ts-spin' : ''}`} aria-hidden="true" />
          <span className="ts-desktop-only">تحديث</span>
        </button>
      </div>

      {compactHome && <div className={`ts-note ${pendingError ? 'ts-note--error' : (pendingDocs || []).length ? 'ts-note--warning' : 'ts-note--info'}`} role={pendingError ? 'alert' : 'status'} data-k="pending-notice">
        <Hourglass className="ts-icon" aria-hidden="true" />
        <span>{pendingError || (pendingDocs == null ? 'جارٍ تحميل المستندات…' : pendingDocs.length ? `${pendingDocs.length} مستند بانتظار المراجعة` : 'لا مستندات بانتظار المراجعة')}</span>
        {pendingError ? <button className="ts-btn" onClick={() => loadPending(pid)}>إعادة المحاولة</button> : pendingDocs?.length > 0 && ['accountant', 'superadmin'].includes(role) ? <Link className="ts-btn" to="/pending">مراجعة المستندات</Link> : null}
      </div>}

      {/* فلتر التاريخ + زر المقارنة */}
      <div className="ts-panel ts-panel-pad rp-dash-period">
        <div className="rp-dash-period-row">
          <Segment label="الفترة" value={QUICK_PERIODS.some(p => p.key === activePeriod) ? activePeriod : ''}
            onChange={handlePeriod} options={QUICK_PERIODS.map(p => ({ value: p.key, label: p.label }))} />

          {/* زر شهر محدد */}
          <div className="relative" ref={mainPickerRef}>
            <button
              onClick={() => setShowMainPicker(v => !v)}
              className="px-3 py-1.5 text-xs rounded-xl font-semibold transition-all"
              style={activePeriod === 'month-picker'
                ? { background: GOLD, color: NAVY }
                : { background: '#f5f4f0', color: '#4b5563' }
              }>
              {activePeriod === 'month-picker'
                ? `${MONTHS_AR[mainPickerMonth - 1]} ${mainPickerYear} ▼`
                : 'شهر محدد ▼'}
            </button>
            {showMainPicker && (
              <div className="absolute top-full mt-1 z-50 bg-white rounded-2xl shadow-xl p-3 min-w-[190px]"
                style={{ border: '1px solid #e8e5dc', direction: 'rtl', left: 0 }}>
                <div className="text-xs font-bold text-slate-500 mb-2">اختر الشهر والسنة</div>
                <div className="flex gap-2 mb-2">
                  <select value={mainPickerMonth} onChange={e => setMainPickerMonth(Number(e.target.value))}
                    className="flex-1 border rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                    style={{ borderColor: '#d1c9b8' }}>
                    {MONTHS_AR.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                  <select value={mainPickerYear} onChange={e => setMainPickerYear(Number(e.target.value))}
                    className="w-20 border rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                    style={{ borderColor: '#d1c9b8' }}>
                    {[thisYear, thisYear - 1, thisYear - 2].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <button onClick={applyMainPicker}
                  className="w-full py-1.5 rounded-xl text-xs font-bold"
                  style={{ background: NAVY, color: '#fff' }}>
                  تطبيق
                </button>
              </div>
            )}
          </div>

          {/* زر المقارنة — مؤقتاً معطّل (COMPARE_ENABLED = false) */}
          {COMPARE_ENABLED && <div className="relative" ref={cmpRef}>
            {cmpMode ? (
              <div className="flex items-center gap-1">
                <span className="px-3 py-1.5 text-xs rounded-xl font-semibold"
                  style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
                  مقارنة: {cmpLabel}
                </span>
                <button onClick={cancelCompare}
                  className="px-2 py-1.5 text-xs rounded-xl font-semibold transition-all"
                  style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                  ✕
                </button>
              </div>
            ) : (
              <button onClick={() => { setCmpOpen(v => !v); setShowPicker(false) }}
                className="px-3 py-1.5 text-xs rounded-xl font-semibold transition-all"
                style={{ background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd' }}>
                ⚖️ مقارنة
              </button>
            )}

            {/* Dropdown المقارنة */}
            {cmpOpen && (
              <div className="absolute top-full mt-1 left-0 z-50 bg-white rounded-2xl shadow-xl border p-3 min-w-[220px]"
                style={{ borderColor: '#e8e5dc', direction: 'rtl' }}>
                <div className="text-xs font-bold text-slate-500 mb-2 px-1">اختر فترة المقارنة</div>

                <button onClick={activatePrevCompare}
                  className="w-full text-right px-3 py-2 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
                  📅 الشهر السابق
                </button>

                <button onClick={() => setShowPicker(v => !v)}
                  className="w-full text-right px-3 py-2 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
                  🗓️ شهر محدد {showPicker ? '▲' : '▼'}
                </button>

                {showPicker && (
                  <div className="mt-2 px-1 space-y-2">
                    <div className="flex gap-2">
                      <select value={customMonth} onChange={e => setCustomMonth(Number(e.target.value))}
                        className="flex-1 border rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                        style={{ borderColor: '#d1c9b8' }}>
                        {MONTHS_AR.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
                      </select>
                      <select value={customYear} onChange={e => setCustomYear(Number(e.target.value))}
                        className="w-20 border rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                        style={{ borderColor: '#d1c9b8' }}>
                        {[thisYear, thisYear-1, thisYear-2].map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                    <button onClick={applyCustomCompare}
                      className="w-full py-2 rounded-xl text-xs font-bold transition-all"
                      style={{ background: NAVY, color: '#fff' }}>
                      تطبيق
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>}
        </div>

        <div className="flex flex-wrap gap-3 items-end justify-center">
          <div>
            <label className="text-xs text-slate-500 block mb-1 text-center">من</label>
            <input type="date" value={range.from} onChange={e => handleCustom('from', e.target.value)}
              className="border rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2" style={{ borderColor: '#d1c9b8' }}/>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1 text-center">إلى</label>
            <input type="date" value={range.to} onChange={e => handleCustom('to', e.target.value)}
              className="border rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2" style={{ borderColor: '#d1c9b8' }}/>
          </div>
          {activePeriod === 'custom' && (
            <button onClick={refreshDashboard}
              className="px-4 py-2 rounded-xl text-sm font-bold" style={{ background: NAVY, color: '#fff' }}>
              تحديث
            </button>
          )}
        </div>
      </div>

      {cmpError && <div className="ts-note ts-note--error" role="alert">
        <span>{cmpError}</span><button className="ts-btn" onClick={() => loadCmpStats(cmpRange, pid)}>إعادة المحاولة</button>
      </div>}
      {cmpLoading && <div className="ts-note" role="status">جارٍ تحميل المقارنة…</div>}
      {loadError ? <div className="ts-note ts-note--error" role="alert">
        <span>{loadError}</span><button className="ts-btn" onClick={refreshDashboard}>إعادة المحاولة</button>
      </div> : <>
      {/* الأرقام الأربعة المعتمدة في التصميم — من getFinancialSummary نفسه بلا تغيير في الحساب */}
      {stats?.uncounted && !loading && <div className="ts-note ts-note--warning" data-k="uncounted"><div className="ts-note-body">{stats.uncounted}</div></div>}
      {accountDashboard(balances?.settings) && stats ? <AccountCards compactHome={compactHome} stats={stats} balances={balances} settings={balances.settings} receivables={receivables} supplierBalance={balances.supplierBalance} liabilities={balances.liabilities} from={range.from} to={range.to}/> : <div className="ts-metrics">
        {loading || !stats ? [0, 1, 2, 3].map(i => <div key={i} className="ts-metric rp-skeleton-card" />) : (
          <>
            <Metric label="المبيعات" icon={Wallet} tag="قبل الضريبة"
              foot={hasCompare ? <>مقابل <span className="ts-num">{fmt(cmpStats.totalSales)}</span> ({cmpLabel})</> : <>شاملة الضريبة <span className="ts-num">{fmt(stats.grossSales)}</span></>}>
              <Money value={stats.totalSales} />
            </Metric>
            <Metric label="المشتريات" icon={ShoppingBasket} tag="قبل الضريبة"
              foot={hasCompare ? <>مقابل <span className="ts-num">{fmt(cmpStats.cogs)}</span> ({cmpLabel})</> : 'تكلفة البضاعة والتغليف'}>
              <Money value={stats.cogs} />
            </Metric>
            <Metric label="المصروفات التشغيلية" icon={Receipt} tag="قبل الضريبة"
              foot={hasCompare ? <>مقابل <span className="ts-num">{fmt(cmpStats.operatingExpenses)}</span> ({cmpLabel})</> : 'لا تشمل المشتريات'}>
              <Money value={stats.operatingExpenses} />
            </Metric>
            <Metric as={role === 'accountant' ? Link : 'div'} to={role === 'accountant' ? '/pending' : undefined}
              label="بانتظار المراجعة" icon={Hourglass} tag="كل الفترات" tone={(pendingDocs || []).length ? 'attention' : undefined}
              foot={pendingError || (pendingDocs == null ? '…' : (pendingDocs || []).length ? 'مرفوعة ولم تُعتمد بعد' : 'لا شيء ينتظر')}>
              <span className="ts-num">{pendingDocs == null ? '—' : (pendingDocs || []).length}</span>
            </Metric>
          </>
        )}
      </div>}

      <details className="rp-scope">
        <summary><Info className="ts-icon--sm" aria-hidden="true" />ما الذي يشمله كل رقم؟<ChevronDown className="ts-icon--sm" aria-hidden="true" /></summary>
        <div className="rp-scope-list">
          <div><strong>المبيعات: </strong>قيود أنواعها «مبيعات» أو «تحصيل جملة» في الفترة (نقدي وبنك وذمم التطبيقات)، مقسومة على 1.15 لاستبعاد ضريبة المخرجات. التحويلات الداخلية وتحصيل الذمم مستثناة.</div>
          <div><strong>المشتريات: </strong>قيود تكلفة البضاعة المباعة ومشتريات المواد ومواد التعبئة والتغليف، بعد طرح ضريبة المدخلات المسجلة عليها.</div>
          <div><strong>المصروفات التشغيلية: </strong>بقية المصروفات بعد طرح ضريبتها، بلا المشتريات ولا المسحوبات ولا الأقساط ولا الضريبة. لا تكرار بين الرقمين.</div>
          <div><strong>بانتظار المراجعة: </strong>مستندات مرفوعة أو مقروءة لم تُعتمد ولم تُرفض، من كل التواريخ، ولا تدخل الأرقام قبل اعتمادها.</div>
          <div className="rp-scope-wide">«الربح» أدناه هو رقم التطبيق الحالي نفسه: المبيعات − المشتريات − المصروفات التشغيلية، بلا حساب للمخزون. بقي كما هو ولم يُعدَّل حسابه.</div>
        </div>
      </details>

      <div className="rp-home-mid">
        <div className="rp-shortcuts">
          <Link to="/invoice" className="rp-shortcut rp-shortcut--primary rp-desktop-only">
            <span className="rp-shortcut-icon"><Upload className="ts-icon" aria-hidden="true" /></span>
            <span><strong>رفع مستند</strong><small>فاتورة مورد أو مصروف أو تقرير إغلاق</small></span>
          </Link>
          {role === 'accountant' && (
            <Link to="/pending" className="rp-shortcut rp-shortcut--compact">
              <span className="rp-shortcut-icon"><FileText className="ts-icon" aria-hidden="true" /></span>
              <span><strong>مستندات جديدة</strong><small>مراجعة واعتماد</small></span>
            </Link>
          )}
        </div>
        {!compactHome && <Panel className="rp-actions-panel" clip title="يحتاج إجراء" icon={ClipboardList}>
          {pendingError ? <div className="ts-note ts-note--error" role="alert">
            <span>{pendingError}</span><button className="ts-btn" onClick={() => loadPending(pid)}>إعادة المحاولة</button>
          </div> : pendingDocs == null ? <div className="rp-todo-clear" role="status">جارٍ تحميل المستندات…</div> : (pendingDocs || []).length > 0 ? (
            <ul className="rp-todo"><li>
              {role === 'accountant' ? (
                <Link to="/pending">
                  <span className="rp-todo-mark"><Hourglass className="ts-icon" aria-hidden="true" /></span>
                  <span><strong><span className="ts-num">{(pendingDocs || []).length}</span> مستند بانتظار المراجعة</strong><small>أقدمها رُفع {pendingDocs[0] ? new Date(pendingDocs[0].uploaded_at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long' }) : ''}</small></span>
                  <span className="rp-todo-go">راجعها</span>
                </Link>
              ) : (
                <div className="rp-todo-static">
                  <span className="rp-todo-mark"><Hourglass className="ts-icon" aria-hidden="true" /></span>
                  <span><strong><span className="ts-num">{(pendingDocs || []).length}</span> مستند بانتظار مراجعة المحاسب</strong><small>تظهر في الأرقام بعد اعتمادها</small></span>
                </div>
              )}
            </li></ul>
          ) : <div className="rp-todo-clear">لا شيء يحتاج إجراء الآن.</div>}
        </Panel>}
      </div>

      {/* الربح والأرصدة كما في التطبيق الحالي */}
      {!accountDashboard(balances?.settings) && <><h2 className="rp-subhead">الربح والأرصدة</h2>
      <div className="ts-metrics rp-metrics-secondary">
        {loading || !stats ? <div className="ts-metric rp-skeleton-card" /> : (
          <KpiCard label="الربح (حسب التطبيق الحالي)" value={stats.profit} negative={stats.profit < 0}
            cmpValue={hasCompare ? cmpStats.profit : undefined} cmpLabel={cmpLabel} foot="بلا حساب للمخزون" />
        )}
        {!balances ? [0, 1, 2].map(i => <div key={i} className="ts-metric rp-skeleton-card" />) : (
          <>
            <KpiCard label="البنك" value={balances.bank} negative={balances.bank < 0} />
            {balances.operating && <KpiCard label="أرصدة بنكية موجبة متاحة للتشغيل" value={balances.operating.available} foot="حسب الدفتر؛ يستبعد الحسابات المخصصة للالتزامات"/>}
            <KpiCard label="الصندوق" value={balances.cash} negative={balances.cash < 0} />
            <KpiCard label="العهدة" value={balances.custody} negative={balances.custody < 0} />
          </>
        )}
      </div>

      </>}
      {balances?.operating && !accountDashboard(balances?.settings) && <div className="ts-note ts-note--info">{OPERATING_BALANCE_NOTE}</div>}
      {!compactHome && !loading && stats && (
        <div className="ts-note ts-note--info">
          <Receipt className="ts-icon" aria-hidden="true" />
          <div className="ts-note-body">
            <strong>مبيعات شاملة الضريبة: <span className="ts-num">{fmt(stats.grossSales)}</span></strong>
            المقبوض فعليًا، ومنه <span className="ts-num">{fmt(stats.outputVat)}</span> ضريبة مخرجات مستحقة للهيئة.
          </div>
        </div>
      )}

      {/* ذمم تطبيقات التوصيل: كل تطبيق له حركة يظهر برصيده الدفتري وإشارته؛ السالب يعني تحصيلًا أكبر من المبيعات المسجلة */}
      {!compactHome && receivables && (() => {
        const shown = APPS.filter(a => receivables.active.includes(a.key))
        const total = shown.reduce((t, a) => t + Math.round((receivables.balances[a.key] || 0) * 100), 0) / 100
        const fmt2 = v => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        return (
          <div className="rounded-2xl p-4 shadow-sm" data-k="app-receivables" style={{ background: '#fff', border: '2px solid #fde68a' }}>
            <div className="flex items-center gap-2 mb-3">
              <span className="font-bold text-sm" style={{ color: '#92400e' }}>ذمم تطبيقات التوصيل (الرصيد الدفتري)</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {shown.map(({ key, label }) => {
                const val = receivables.balances[key] || 0
                return (
                  <Link key={key} to={`/reports?tab=apps&app=${key}`} data-k={`app-receivable-${key}`} className="rounded-xl p-3 text-center" style={{ background: val < 0 ? '#fef2f2' : '#fffbeb', border: `1px solid ${val < 0 ? '#fecaca' : '#fde68a'}` }}>
                    <div className="text-xs font-semibold mb-1" style={{ color: '#92400e' }}>{label}</div>
                    <div className="text-base font-bold font-mono tabular-nums" dir="ltr" style={{ color: val < 0 ? '#b91c1c' : '#92400e' }}>{fmt2(val)}</div>
                    {val < 0 && <div className="text-xs mt-1" style={{ color: '#b91c1c' }}>تحصيل أكبر من المبيعات المسجلة</div>}
                  </Link>
                )
              })}
            </div>
            <div className="mt-2 text-xs text-right" style={{ color: '#a78a50' }} data-k="app-receivables-total">
              الصافي: <span dir="ltr">{fmt2(total)}</span> ر.س — رصيد دفتري من قيود تحسيب، يُطابَق مع كشف كل تطبيق من «التقارير ← ذمم التطبيقات».
              {total < 0 || shown.some(a => (receivables.balances[a.key] || 0) < 0) ? ' الرصيد السالب: تحصيل أكبر من المبيعات المسجلة؛ قد يخص مبيعات قبل بدء التسجيل أو لم تُسجَّل، ويُحدَّد من كشف التطبيق.' : ''}
              {receivables.unassigned ? <> ذمم غير منسوبة لتطبيق: <span dir="ltr">{fmt2(receivables.unassigned)}</span>.</> : null}
            </div>
          </div>
        )
      })()}

      {/* ── الرسوم البيانية ── */}

      {/* ١. خط المبيعات اليومية */}
      {!compactHome && hasCharts && combinedDailyData.length > 0 && (
        <ChartCard title={`📈 المبيعات اليومية${hasCompare ? ` (مقارنة مع ${cmpLabel})` : ''}`}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={combinedDailyData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede6" />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tickFormatter={fmtK} tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
              <Tooltip content={<MultiLineTip />} />
              <Line type="monotone" dataKey="الحالي"   stroke={GOLD}      strokeWidth={2.5}
                dot={{ r: 3, fill: GOLD, strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} />
              {hasCompare && (
                <Line type="monotone" dataKey="المقارنة" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 3"
                  dot={{ r: 2, fill: '#94a3b8', strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls={false} />
              )}
              {hasCompare && <Legend iconSize={10} formatter={v => <span style={{ fontSize: 11, color: '#374151' }}>{v}</span>} />}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* ٢ و ٣. دائريَّان — لا تتأثران بالمقارنة */}
      {!compactHome && hasCharts && (channelPieData.length > 0 || expensePieData.length > 0) && (
        <div className={`grid grid-cols-1 ${compactHome ? '' : 'md:grid-cols-2 '}gap-4`}>
          {!compactHome && channelPieData.length > 0 && (
            <ChartCard title="🍰 توزيع قنوات المبيعات">
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie data={channelPieData} cx="50%" cy="45%" outerRadius={80}
                    labelLine={false} label={<PieLabel />} dataKey="value">
                    {channelPieData.map((d, i) => (
                      <Cell key={i} fill={CHANNEL_COLORS[d.name] || EXPENSE_COLORS[i % EXPENSE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={props => <PieTip {...props} total={totalChannelSales} />} />
                  <Legend iconSize={10} formatter={v => <span style={{ fontSize: 11, color: '#374151' }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {expensePieData.length > 0 && (
            <ChartCard title="💸 أكبر 5 بنود مصروفات">
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie data={expensePieData} cx="50%" cy="45%" outerRadius={80}
                    labelLine={false} label={<PieLabel />} dataKey="value">
                    {expensePieData.map((_,i) => <Cell key={i} fill={EXPENSE_COLORS[i]} />)}
                  </Pie>
                  <Tooltip content={props => <PieTip {...props} total={totalExpensePie} />} />
                  <Legend iconSize={10} formatter={v => <span style={{ fontSize: 10, color: '#374151' }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </div>
      )}

      {/* ٤. أعمدة أسبوعية */}
      {!compactHome && hasCharts && combinedWeeklyData.length > 0 && (
        <ChartCard title={`📊 مبيعات ومصروفات الأسابيع${hasCompare ? ` (مقارنة مع ${cmpLabel})` : ''}`}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={combinedWeeklyData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede6" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} />
              <YAxis tickFormatter={fmtK} tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
              <Tooltip content={<BarTip />} />
              <Legend iconSize={10} formatter={v => <span style={{ fontSize: 11, color: '#374151' }}>{v}</span>} />
              <Bar dataKey="مبيعات"  name="مبيعات"  fill="#16a34a" radius={[4,4,0,0]} />
              {hasCompare
                ? <Bar dataKey="مقارنة" name="مبيعات المقارنة" fill="#93c5fd" radius={[4,4,0,0]} />
                : <Bar dataKey="مصروفات" name="مصروفات" fill="#ef4444" radius={[4,4,0,0]} />
              }
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* ٥. مقارنة مبيعات الفروع */}
      {!compactHome && hasCharts && branchSalesData.length > 1 && (
        <ChartCard title="🏪 مقارنة مبيعات الفروع">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={branchSalesData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }} barCategoryGap="35%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede6" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} />
              <YAxis tickFormatter={fmtK} tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(v) => [`${v.toLocaleString('en-US', { minimumFractionDigits: 2 })} ر.س`, 'المبيعات']}
                contentStyle={{ borderRadius: 12, border: '1px solid #e8e5dc', fontSize: 12, direction: 'rtl' }}
              />
              <Bar dataKey="مبيعات" radius={[6,6,0,0]}>
                {branchSalesData.map((_, i) => (
                  <Cell key={i} fill={BRANCH_COLORS[i % BRANCH_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* حالة فارغة */}
      {!loading && stats && chartEntries.length === 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-10 text-center" style={{ border: '1px solid #e8e5dc' }}>
          <p className="text-slate-400 text-sm">لا توجد بيانات في هذه الفترة</p>
        </div>
      )}

      </>}
    </div>
  )
}
