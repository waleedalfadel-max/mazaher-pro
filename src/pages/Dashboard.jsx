import React, { useEffect, useState, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { getFinancialSummary, isSales } from '../lib/financialEngine'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  BarChart, Bar,
} from 'recharts'

const NAVY = '#0f2444'
const GOLD = '#c9a227'

// ألوان قنوات المبيعات
const CHANNEL_COLORS = {
  'كاش':    '#c9a227',
  'شبكة':   '#0f2444',
  'هنقر':   '#ef4444',
  'جاهز':   '#f97316',
  'كيتا':   '#8b5cf6',
  'سلة':    '#06b6d4',
  'تابي':   '#ec4899',
  'تمارا':  '#84cc16',
  'تحصيل':  '#6366f1',
}
const EXPENSE_COLORS = ['#ef4444', '#f97316', '#8b5cf6', '#0f2444', '#06b6d4']

function channelOf(type) {
  const t = type || ''
  if (t.includes('كاش'))    return 'كاش'
  if (t.includes('شبكة'))   return 'شبكة'
  if (t.includes('هنقر'))   return 'هنقر'
  if (t.includes('جاهز'))   return 'جاهز'
  if (t.includes('كيتا'))   return 'كيتا'
  if (t.includes('سلة'))    return 'سلة'
  if (t.includes('تابي'))   return 'تابي'
  if (t.includes('تمارا'))  return 'تمارا'
  if (t.includes('تحصيل'))  return 'تحصيل'
  return 'أخرى'
}

const fmt  = v => (v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtK = v => v >= 1000 ? `${(v / 1000).toFixed(1)}ك` : String(Math.round(v))

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

function StatCard({ label, value, icon }) {
  return (
    <div className="rounded-2xl p-5 shadow-sm text-center" style={{ background: '#fff', border: '2px solid #e8e5dc' }}>
      <div className="flex flex-col items-center gap-1 mb-3">
        <span className="text-2xl">{icon}</span>
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold font-mono tabular-nums" style={{ color: NAVY }}>{value}</div>
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

function LineTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border rounded-xl shadow-lg p-3 text-sm" style={{ borderColor: '#e8e5dc', direction: 'rtl' }}>
      <div className="font-bold mb-1" style={{ color: NAVY }}>{label}</div>
      <div style={{ color: GOLD }}>مبيعات: {fmt(payload[0]?.value)} ر.س</div>
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
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight="bold">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

const QUICK_PERIODS = [
  { key: 'month',     label: 'الشهر الحالي' },
  { key: 'lastMonth', label: 'الشهر الماضي' },
  { key: 'year',      label: 'السنة الحالية' },
]

function getRange(type) {
  const n  = new Date()
  const to = n.toISOString().split('T')[0]
  if (type === 'lastMonth') {
    const lm  = new Date(n.getFullYear(), n.getMonth() - 1, 1)
    const lme = new Date(n.getFullYear(), n.getMonth(), 0)
    return { from: lm.toISOString().split('T')[0], to: lme.toISOString().split('T')[0] }
  }
  let from
  if (type === 'month') from = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`
  else                  from = `${n.getFullYear()}-01-01`
  return { from, to }
}

export default function Dashboard() {
  const { roleLabel, projectId: pid, projectName } = useAuth()
  const [stats, setStats]               = useState(null)
  const [loading, setLoading]           = useState(true)
  const [balances, setBalances]         = useState(null)
  const [activePeriod, setActivePeriod] = useState('month')
  const [range, setRange]               = useState(getRange('month'))
  const [chartEntries, setChartEntries] = useState([])
  const liveRef = useRef({ pid: null, range: getRange('month') })

  useEffect(() => { liveRef.current = { pid, range } }, [pid, range])

  useEffect(() => {
    if (!pid) { setBalances({ cash: 0, bank: 0, custody: 0 }); setLoading(false); return }
    Promise.all([loadBalances(pid), loadStats(getRange('month'), pid)]).catch(e => {
      console.error(e); setBalances({ cash: 0, bank: 0, custody: 0 }); setLoading(false)
    })
  }, [pid])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const { pid: p, range: r } = liveRef.current
      if (p) Promise.all([loadBalances(p), loadStats(r, p)]).catch(console.error)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  async function loadBalances(projectId) {
    try {
      const { data, error } = await supabase.from('ledger_entries')
        .select('cash_in,cash_out,bank_in,bank_out,custody_in,custody_out')
        .eq('project_id', projectId).neq('status', 'cancelled')
      if (error) throw error
      const rows = data || []
      setBalances({
        cash:    rows.reduce((s, r) => s + (r.cash_in    || 0) - (r.cash_out    || 0), 0),
        bank:    rows.reduce((s, r) => s + (r.bank_in    || 0) - (r.bank_out    || 0), 0),
        custody: rows.reduce((s, r) => s + (r.custody_in || 0) - (r.custody_out || 0), 0),
      })
    } catch(e) {
      console.error(e); setBalances({ cash: 0, bank: 0, custody: 0 })
    }
  }

  async function loadStats(r, projectId) {
    setLoading(true)
    try {
      const p = projectId || pid
      if (!p) return
      const summary = await getFinancialSummary(p, r.from, r.to)
      if (summary) {
        setStats({ totalSales: summary.totalSales, totalExpenses: summary.totalExpenses, profit: summary.netProfit })
        setChartEntries(summary.entries || [])
      }
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  function handlePeriod(key) {
    setActivePeriod(key)
    const r = getRange(key)
    setRange(r)
    if (pid) loadStats(r, pid)
  }

  function handleCustom(field, val) {
    setActivePeriod('custom')
    setRange(prev => ({ ...prev, [field]: val }))
  }

  // ── بيانات الرسوم ──────────────────────────────────────────────────

  const dailySalesData = useMemo(() => {
    const byDate = {}
    chartEntries.forEach(e => {
      if (!isSales(e.type)) return
      byDate[e.date] = (byDate[e.date] || 0) + (Number(e.cash_in) || 0) + (Number(e.bank_in) || 0)
    })
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, sales]) => ({ date: date.slice(5), sales }))
  }, [chartEntries])

  const channelPieData = useMemo(() => {
    const ch = {}
    chartEntries.forEach(e => {
      if (!isSales(e.type)) return
      const c = channelOf(e.type)
      ch[c] = (ch[c] || 0) + (Number(e.cash_in) || 0) + (Number(e.bank_in) || 0)
    })
    return Object.entries(ch)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => ({ name, value }))
  }, [chartEntries])

  const expensePieData = useMemo(() => {
    const ex = {}
    chartEntries.forEach(e => {
      if (isSales(e.type)) return
      const out = (Number(e.cash_out) || 0) + (Number(e.bank_out) || 0) + (Number(e.custody_out) || 0)
      if (!out) return
      const label = (e.type || '— غير محدد').replace(/^[ -⿿&&[^؀-ۿ]]+/, '').trim() || e.type || '— غير محدد'
      ex[label] = (ex[label] || 0) + out
    })
    return Object.entries(ex)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, value]) => ({ name, value }))
  }, [chartEntries])

  const weeklyData = useMemo(() => {
    if (chartEntries.length === 0) return []
    const fromMs  = new Date(range.from).getTime()
    const totalMs = new Date(range.to).getTime() - fromMs
    const weekMs  = totalMs / 4

    const weeks = Array.from({ length: 4 }, (_, i) => ({
      name:     `أ${i + 1}`,
      from:     new Date(fromMs + i * weekMs).toISOString().split('T')[0],
      to:       new Date(fromMs + (i + 1) * weekMs - 1).toISOString().split('T')[0],
      مبيعات:  0,
      مصروفات: 0,
    }))

    chartEntries.forEach(e => {
      const w = weeks.find(w => e.date >= w.from && e.date <= w.to)
      if (!w) return
      if (isSales(e.type)) {
        w['مبيعات'] += (Number(e.cash_in) || 0) + (Number(e.bank_in) || 0)
      } else {
        w['مصروفات'] += (Number(e.cash_out) || 0) + (Number(e.bank_out) || 0) + (Number(e.custody_out) || 0)
      }
    })

    return weeks.filter(w => w['مبيعات'] > 0 || w['مصروفات'] > 0)
  }, [chartEntries, range])

  const totalChannelSales = channelPieData.reduce((s, d) => s + d.value, 0)
  const totalExpensePie   = expensePieData.reduce((s, d) => s + d.value, 0)
  const hasCharts = !loading && chartEntries.length > 0

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
          onClick={() => { if (pid) Promise.all([loadBalances(pid), loadStats(range, pid)]).catch(console.error) }}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all shrink-0"
          style={{ background: '#f5f4f0', color: NAVY, border: '1px solid #e8e5dc' }}
        >
          <span className={loading ? 'animate-spin inline-block' : ''}>🔄</span>
          <span className="hidden sm:inline">تحديث</span>
        </button>
      </div>

      {/* فلتر التاريخ */}
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
            <button onClick={() => loadStats(range, pid)}
              className="px-4 py-2 rounded-xl text-sm font-bold" style={{ background: NAVY, color: '#fff' }}>
              تحديث
            </button>
          )}
        </div>
      </div>

      {/* بطاقات الأرقام */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[0,1,2].map(i => <div key={i} className="rounded-2xl p-4 h-28 animate-pulse" style={{ background: '#e8e5dc' }}/>)}
        </div>
      ) : stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard label="إجمالي المبيعات"  value={fmt(stats.totalSales)}    icon="💵" />
          <StatCard label="إجمالي المصروفات" value={fmt(stats.totalExpenses)} icon="📤" />
          <StatCard label="صافي الربح"        value={fmt(stats.profit)}        icon="📈" />
        </div>
      )}

      {/* بطاقات الأرصدة */}
      {balances ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <BalanceCard label="رصيد الصندوق" icon="🏧" value={balances.cash}    color="#16a34a" />
          <BalanceCard label="رصيد البنك"   icon="🏦" value={balances.bank}    color="#1d4ed8" />
          <BalanceCard label="رصيد العهدة"  icon="👤" value={balances.custody} color="#b45309" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[0,1,2].map(i => <div key={i} className="rounded-2xl p-4 h-24 animate-pulse" style={{ background: '#e8e5dc' }}/>)}
        </div>
      )}

      {/* ── الرسوم البيانية ── */}

      {/* ١. خط المبيعات اليومية */}
      {hasCharts && dailySalesData.length > 0 && (
        <ChartCard title="📈 المبيعات اليومية">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={dailySalesData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede6" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tickFormatter={fmtK} tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
              <Tooltip content={<LineTip />} />
              <Line type="monotone" dataKey="sales" name="مبيعات" stroke={GOLD} strokeWidth={2.5}
                dot={{ r: 3, fill: GOLD, strokeWidth: 0 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* ٢ و ٣. دائريَّان: قنوات المبيعات + المصروفات */}
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
                    {expensePieData.map((_, i) => <Cell key={i} fill={EXPENSE_COLORS[i]} />)}
                  </Pie>
                  <Tooltip content={props => <PieTip {...props} total={totalExpensePie} />} />
                  <Legend iconSize={10} formatter={v => <span style={{ fontSize: 10, color: '#374151' }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </div>
      )}

      {/* ٤. أعمدة مبيعات vs مصروفات أسبوعياً */}
      {hasCharts && weeklyData.length > 0 && (
        <ChartCard title="📊 مبيعات ومصروفات الأسابيع">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weeklyData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }} barCategoryGap="35%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede6" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} />
              <YAxis tickFormatter={fmtK} tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
              <Tooltip content={<BarTip />} />
              <Legend iconSize={10} formatter={v => <span style={{ fontSize: 11, color: '#374151' }}>{v}</span>} />
              <Bar dataKey="مبيعات"  fill="#16a34a" radius={[4, 4, 0, 0]} />
              <Bar dataKey="مصروفات" fill="#ef4444" radius={[4, 4, 0, 0]} />
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
