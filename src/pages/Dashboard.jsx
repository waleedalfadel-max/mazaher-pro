import React, { useEffect, useState, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { getFinancialSummary, isSales } from '../lib/financialEngine'
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
  'تمارا':   '#84cc16', 'تحصيل':  '#6366f1',
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

function StatCard({ label, icon, value, cmpValue, cmpLabel, sub }) {
  const hasCmp = cmpValue !== null && cmpValue !== undefined
  const delta  = hasCmp ? value - cmpValue : 0
  const pct    = hasCmp && cmpValue !== 0 ? ((delta / Math.abs(cmpValue)) * 100).toFixed(1) : null
  const up     = delta >= 0
  return (
    <div className="rounded-2xl p-5 shadow-sm text-center" style={{ background: '#fff', border: '2px solid #e8e5dc' }}>
      <div className="flex flex-col items-center gap-1 mb-3">
        <span className="text-2xl">{icon}</span>
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold font-mono tabular-nums" style={{ color: NAVY }}>{fmt(value)}</div>
      {sub && <div className="text-xs font-semibold mt-1" style={{ color: '#0369a1' }}>{sub}</div>}
      {hasCmp && (
        <div className="mt-2 space-y-0.5">
          <div className="text-xs font-bold" style={{ color: up ? '#16a34a' : '#dc2626' }}>
            {up ? '▲' : '▼'} {pct !== null ? `${Math.abs(pct)}%` : '—'}{cmpLabel ? ` من ${cmpLabel}` : ''}
          </div>
          <div className="text-xs text-slate-400">({fmt(cmpValue)} ر.س)</div>
        </div>
      )}
    </div>
  )
}

function KpiCard({ label, value, accent, bg, negative }) {
  const isNeg  = negative ?? value < 0
  const color  = isNeg ? '#dc2626' : accent
  const border = isNeg ? '#fecaca' : (accent + '40')
  return (
    <div className="rounded-xl text-center shadow-sm" style={{ background: isNeg ? '#fef2f2' : bg, border: `1.5px solid ${border}`, padding: '10px 8px' }}>
      <div className="mb-1" style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{label}</div>
      <div className="font-bold font-mono tabular-nums" style={{ fontSize: 16, color, lineHeight: 1.2 }}>{fmt(Math.abs(value))}</div>
    </div>
  )
}

function ChartCard({ title, children }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4" style={{ border: '1px solid #e8e5dc' }}>
      <h2 className="font-bold text-sm mb-4" style={{ color: NAVY }}>{title}</h2>
      {children}
    </div>
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
  const { roleLabel, projectId: pid, projectName } = useAuth()

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

  useEffect(() => { liveRef.current = { pid, range } }, [pid, range])

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
    if (!pid) { setBalances({ cash:0, bank:0, custody:0 }); setLoading(false); return }
    const initRange = getRange('month')
    Promise.all([loadBalances(pid, initRange.to), loadStats(initRange, pid)]).catch(e => {
      console.error(e); setBalances({ cash:0, bank:0, custody:0 }); setLoading(false)
    })
  }, [pid])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const { pid: p, range: r } = liveRef.current
      if (p) Promise.all([loadBalances(p, r.to), loadStats(r, p)]).catch(console.error)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // ── دوال التحميل ───────────────────────────────────────────────────

  async function loadBalances(projectId, toDate) {
    try {
      let q = supabase.from('ledger_entries')
        .select('type,cash_in,cash_out,bank_in,bank_out,custody_in,custody_out,receivable_in,receivable_out')
        .eq('project_id', projectId).neq('status','cancelled')
      if (toDate) q = q.lte('date', toDate)
      const { data, error } = await q
      if (error) throw error
      const rows = data || []
      setBalances({
        cash:    rows.reduce((s,r) => s + (r.cash_in   ||0) - (r.cash_out   ||0), 0),
        bank:    rows.reduce((s,r) => s + (r.bank_in   ||0) - (r.bank_out   ||0), 0),
        custody: rows.reduce((s,r) => s + (r.custody_in||0) - (r.custody_out||0), 0),
      })
      // ذمم تطبيقات التوصيل من حقلَي receivable_in/out المنفصلَين عن العهدة
      const sumRcvIn  = (t) => rows.filter(r => (r.type||'').includes(t)).reduce((s,r) => s+(r.receivable_in ||0), 0)
      const sumRcvOut = (t) => rows.filter(r => (r.type||'').includes(t)).reduce((s,r) => s+(r.receivable_out||0), 0)
      const rcv = {
        hunger:  sumRcvIn('هنقر')   - sumRcvOut('هنقر'),
        jahez:   sumRcvIn('جاهز')   - sumRcvOut('جاهز'),
        keeta:   sumRcvIn('كيتا')   - sumRcvOut('كيتا'),
        mrsool:  sumRcvIn('مرسول')  - sumRcvOut('مرسول'),
      }
      setReceivables(rcv.hunger > 0 || rcv.jahez > 0 || rcv.keeta > 0 || rcv.mrsool > 0 ? rcv : null)
    } catch(e) { console.error(e); setBalances({ cash:0, bank:0, custody:0 }) }
  }

  async function loadStats(r, projectId) {
    setLoading(true)
    try {
      const p = projectId || pid
      if (!p) return
      const summary = await getFinancialSummary(p, r.from, r.to)
      if (summary) {
        setStats({ totalSales: summary.totalSales, totalExpenses: summary.totalExpenses, profit: summary.netProfit, grossProfit: summary.grossProfit, cogs: summary.cogs || 0, operatingExpenses: summary.operatingExpenses || 0 })
        setChartEntries(summary.entries || [])
      }
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function loadCmpStats(r, projectId) {
    if (!r || !projectId) return
    setCmpLoading(true)
    try {
      const summary = await getFinancialSummary(projectId, r.from, r.to)
      if (summary) {
        setCmpStats({ totalSales: summary.totalSales, totalExpenses: summary.totalExpenses, profit: summary.netProfit, grossProfit: summary.grossProfit, cogs: summary.cogs || 0, operatingExpenses: summary.operatingExpenses || 0 })
        setCmpEntries(summary.entries || [])
      }
    } catch(e) { console.error(e) }
    finally { setCmpLoading(false) }
  }

  // ── معالجات الفترة ─────────────────────────────────────────────────

  function handlePeriod(key) {
    setActivePeriod(key)
    setShowMainPicker(false)
    const r = getRange(key)
    setRange(r)
    if (pid) {
      loadBalances(pid, r.to)
      loadStats(r, pid)
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
    if (pid) { loadBalances(pid, to); loadStats({ from, to }, pid) }
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
      cur[day] = (cur[day]||0) + (Number(e.cash_in)||0) + (Number(e.bank_in)||0) + (Number(e.receivable_in)||0)
    })
    cmpEntries.forEach(e => {
      if (!isSales(e.type)) return
      const day = parseInt(e.date.split('-')[2])
      cmp[day] = (cmp[day]||0) + (Number(e.cash_in)||0) + (Number(e.bank_in)||0) + (Number(e.receivable_in)||0)
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
      ch[c] = (ch[c]||0) + (Number(e.cash_in)||0) + (Number(e.bank_in)||0) + (Number(e.receivable_in)||0)
    })
    return Object.entries(ch).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).map(([name,value])=>({name,value}))
  }, [chartEntries])

  const expensePieData = useMemo(() => {
    const ex = {}
    chartEntries.forEach(e => {
      if (isSales(e.type)) return
      const out = (Number(e.cash_out)||0) + (Number(e.bank_out)||0) + (Number(e.custody_out)||0)
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
      if (isSales(e.type)) w['مبيعات']  += (Number(e.cash_in)||0)  + (Number(e.bank_in)||0) + (Number(e.receivable_in)||0)
      else                  w['مصروفات'] += (Number(e.cash_out)||0) + (Number(e.bank_out)||0) + (Number(e.custody_out)||0)
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
        if (w) w.sales += (Number(e.cash_in)||0) + (Number(e.bank_in)||0) + (Number(e.receivable_in)||0)
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
      bMap[e.branch] = (bMap[e.branch] || 0) + (Number(e.cash_in)||0) + (Number(e.bank_in)||0) + (Number(e.receivable_in)||0)
    })
    return Object.entries(bMap).filter(([,v]) => v > 0).map(([name, مبيعات]) => ({ name, مبيعات }))
  }, [chartEntries])

  const totalChannelSales = channelPieData.reduce((s,d)=>s+d.value, 0)
  const totalExpensePie   = expensePieData.reduce((s,d)=>s+d.value, 0)
  const hasCharts   = !loading && chartEntries.length > 0
  const hasCompare  = !!cmpMode && !!cmpStats
  const thisYear    = new Date().getFullYear()

  const COMPARE_ENABLED = false // مؤقتاً — لإعادة التفعيل: غيّر إلى true

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: NAVY }}>لوحة التحكم</h1>
          <p className="text-slate-500 text-sm mt-0.5">مرحباً — {roleLabel}{projectName ? ` | ${projectName}` : ''}</p>
        </div>
        <button
          onClick={() => { if (pid) Promise.all([loadBalances(pid, range.to), loadStats(range, pid)]).catch(console.error) }}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all shrink-0"
          style={{ background: '#f5f4f0', color: NAVY, border: '1px solid #e8e5dc' }}
        >
          <span className={loading ? 'animate-spin inline-block' : ''}>🔄</span>
          <span className="hidden sm:inline">تحديث</span>
        </button>
      </div>

      {/* فلتر التاريخ + زر المقارنة */}
      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3" style={{ border: '1px solid #e8e5dc' }}>
        <div className="text-sm font-bold uppercase tracking-wider text-center" style={{ color: '#8a7a5a' }}>الفترة الزمنية</div>
        <div className="flex flex-wrap gap-2 justify-center">
          {QUICK_PERIODS.map(p => (
            <button key={p.key} onClick={() => handlePeriod(p.key)}
              className="px-3 py-1.5 text-xs rounded-xl font-semibold transition-all"
              style={activePeriod === p.key ? { background: GOLD, color: NAVY } : { background: '#f5f4f0', color: '#4b5563' }}>
              {p.label}
            </button>
          ))}

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
            <button onClick={() => { loadBalances(pid, range.to); loadStats(range, pid) }}
              className="px-4 py-2 rounded-xl text-sm font-bold" style={{ background: NAVY, color: '#fff' }}>
              تحديث
            </button>
          )}
        </div>
      </div>

      {/* الكروت الرئيسية — صفّان من 3 */}
      <div className="grid grid-cols-3 gap-2">
        {/* الصف الأول: أرقام الفترة */}
        {loading || !stats ? (
          [0,1,2].map(i => <div key={i} className="rounded-xl h-16 animate-pulse" style={{ background: '#e8e5dc' }}/>)
        ) : (
          <>
            <KpiCard label="المبيعات"
              value={stats.totalSales} accent="#0284c7" bg="#f0f9ff" />
            <KpiCard label="المصروفات"
              value={stats.totalExpenses} accent="#dc2626" bg="#fef2f2" />
            <KpiCard label="الربح"
              value={stats.profit} accent={stats.profit >= 0 ? '#15803d' : '#dc2626'}
              bg={stats.profit >= 0 ? '#f0fdf4' : '#fef2f2'} negative={stats.profit < 0} />
          </>
        )}

        {/* الصف الثاني: الأرصدة */}
        {!balances ? (
          [0,1,2].map(i => <div key={i} className="rounded-xl h-16 animate-pulse" style={{ background: '#e8e5dc' }}/>)
        ) : (
          <>
            <KpiCard label="البنك"
              value={balances.bank}    accent="#1d4ed8" bg="#eff6ff" negative={balances.bank < 0} />
            <KpiCard label="الصندوق"
              value={balances.cash}    accent="#16a34a" bg="#f0fdf4" negative={balances.cash < 0} />
            <KpiCard label="العهدة"
              value={balances.custody} accent="#b45309" bg="#fffbeb" negative={balances.custody < 0} />
          </>
        )}
      </div>

      {/* بطاقة الذمم المستحقة — تظهر فقط عند وجود ذمم */}
      {receivables && (
        <div className="rounded-2xl p-4 shadow-sm" style={{ background: '#fff', border: '2px solid #fde68a' }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">⏳</span>
            <span className="font-bold text-sm" style={{ color: '#92400e' }}>ذمم مستحقة من تطبيقات التوصيل</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'هنقر',   val: receivables.hunger,  color: '#dc2626' },
              { label: 'جاهز',   val: receivables.jahez,   color: '#ea580c' },
              { label: 'كيتا',   val: receivables.keeta,   color: '#7c3aed' },
              { label: 'مرسول',  val: receivables.mrsool,  color: '#059669' },
            ].filter(x => (x.val||0) > 0).map(({ label, val, color }) => (
              <div key={label} className="rounded-xl p-3 text-center" style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
                <div className="text-xs font-semibold mb-1" style={{ color: '#92400e' }}>{label}</div>
                <div className="text-base font-bold font-mono tabular-nums" style={{ color }}>
                  {(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs text-right" style={{ color: '#a78a50' }}>
            الإجمالي: {((receivables.hunger||0)+(receivables.jahez||0)+(receivables.keeta||0)+(receivables.mrsool||0)).toLocaleString('en-US',{minimumFractionDigits:2})} ر.س — يُحصَّل عند ورود التحويل البنكي
          </div>
        </div>
      )}

      {/* ── الرسوم البيانية ── */}

      {/* ١. خط المبيعات اليومية */}
      {hasCharts && combinedDailyData.length > 0 && (
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
      {hasCharts && (channelPieData.length > 0 || expensePieData.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {channelPieData.length > 0 && (
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
      {hasCharts && combinedWeeklyData.length > 0 && (
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
      {hasCharts && branchSalesData.length > 1 && (
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
      {!loading && chartEntries.length === 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-10 text-center" style={{ border: '1px solid #e8e5dc' }}>
          <p className="text-slate-400 text-sm">لا توجد بيانات في هذه الفترة</p>
        </div>
      )}

    </div>
  )
}
