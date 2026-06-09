import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const NAVY = '#0f2444'
const GOLD = '#c9a227'

function BalanceCard({ label, icon, value, color }) {
  const neg = value < 0
  const fmt = v => Math.abs(v).toLocaleString('ar-SA', { minimumFractionDigits: 2 })
  return (
    <div className="rounded-2xl p-5 shadow-sm" style={{ background: neg ? '#fef2f2' : '#fff', border: `2px solid ${neg ? '#fecaca' : '#e8e5dc'}` }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl">{icon}</span>
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold font-mono tabular-nums" style={{ color: neg ? '#dc2626' : color }}>
        {fmt(value)}
        <span className="text-sm font-normal text-slate-400 mr-1">ر.س</span>
      </div>
      {neg && <div className="text-xs text-red-500 font-semibold mt-2">⚠️ رصيد سالب</div>}
    </div>
  )
}

function StatCard({ label, value, icon, positive }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ border: '1px solid #e8e5dc' }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-2xl">{icon}</span>
        <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ background: '#f5f4f0', color: '#8a7a5a' }}>الفترة</span>
      </div>
      <div className="text-2xl font-bold mb-1 tabular-nums" style={{ color: NAVY }}>{value}</div>
      <div className="text-sm text-slate-500">{label}</div>
    </div>
  )
}

const QUICK_PERIODS = [
  { key: 'month',     label: 'هذا الشهر' },
  { key: 'lastMonth', label: 'الشهر الماضي' },
  { key: '3months',   label: 'آخر 3 أشهر' },
  { key: 'year',      label: 'هذا العام' },
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
  if (type === 'month')   from = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`
  else if (type === '3months') { const d = new Date(n); d.setMonth(d.getMonth() - 3); from = d.toISOString().split('T')[0] }
  else                    from = `${n.getFullYear()}-01-01`
  return { from, to }
}

export default function Dashboard() {
  const { roleLabel, projectId: pid, projectName } = useAuth()
  const [stats, setStats]         = useState(null)
  const [loading, setLoading]     = useState(true)
  const [recent, setRecent]       = useState([])
  const [balances, setBalances]   = useState(null)
  const [activePeriod, setActivePeriod] = useState('month')
  const [range, setRange]         = useState(getRange('month'))

  useEffect(() => {
    if (!pid) { setBalances({ cash: 0, bank: 0, custody: 0 }); setLoading(false); return }
    const r = getRange('month')
    Promise.all([loadBalances(pid), loadStats(r, pid)]).catch(e => {
      console.error(e); setBalances({ cash: 0, bank: 0, custody: 0 }); setLoading(false)
    })
  }, [pid])

  async function loadBalances(projectId) {
    try {
      const { data, error } = await supabase.from('ledger_entries')
        .select('cash_in,cash_out,bank_in,bank_out,custody_in,custody_out')
        .eq('project_id', projectId)
        .neq('status', 'cancelled')
      if (error) throw error
      const rows = data || []
      setBalances({
        cash:    rows.reduce((s, r) => s + (r.cash_in    || 0) - (r.cash_out    || 0), 0),
        bank:    rows.reduce((s, r) => s + (r.bank_in    || 0) - (r.bank_out    || 0), 0),
        custody: rows.reduce((s, r) => s + (r.custody_in || 0) - (r.custody_out || 0), 0),
      })
    } catch(e) {
      console.error('loadBalances error:', e)
      setBalances({ cash: 0, bank: 0, custody: 0 })
    }
  }

  async function handlePeriod(key) {
    setActivePeriod(key)
    const r = getRange(key)
    setRange(r)
    if (pid) loadStats(r, pid)
  }

  async function handleCustom(field, val) {
    setActivePeriod('custom')
    setRange(prev => ({ ...prev, [field]: val }))
  }

  async function loadStats(r, projectId) {
    setLoading(true)
    try {
      const p = projectId || pid
      if (!p) return
      const [{ data: sales }, { data: ledger }] = await Promise.all([
        supabase.from('sales')
          .select('cash_sales,network_sales')
          .eq('project_id', p)
          .gte('date', r.from).lte('date', r.to),
        supabase.from('ledger_entries')
          .select('cash_out,bank_out,custody_out,type,date,description,status')
          .eq('project_id', p)
          .gte('date', r.from).lte('date', r.to)
          .order('date', { ascending: false })
          .limit(10),
      ])
      const totalSales    = (sales || []).reduce((s, row) => s + (row.cash_sales || 0) + (row.network_sales || 0), 0)
      const totalExpenses = (ledger || [])
        .filter(row => row.cash_out || row.bank_out || row.custody_out)
        .reduce((s, row) => s + (row.cash_out || 0) + (row.bank_out || 0) + (row.custody_out || 0), 0)
      const pending = (ledger || []).filter(row => row.status === 'pending').length
      setStats({ totalSales, totalExpenses, profit: totalSales - totalExpenses, pending })
      setRecent(ledger || [])
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  const fmt = v => (v || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: NAVY }}>لوحة التحكم</h1>
        <p className="text-slate-500 text-sm mt-0.5">مرحباً — {roleLabel}{projectName ? ` | ${projectName}` : ''}</p>
      </div>

      {balances ? (
        <div>
          <div className="text-xs font-bold mb-2 uppercase tracking-wider" style={{ color: '#8a7a5a' }}>الأرصدة الحالية</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <BalanceCard label="رصيد الصندوق" icon="🏧" value={balances.cash}    color="#16a34a" />
            <BalanceCard label="رصيد البنك"   icon="🏦" value={balances.bank}    color="#1d4ed8" />
            <BalanceCard label="رصيد العهدة"  icon="👤" value={balances.custody} color="#b45309" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[0,1,2].map(i => <div key={i} className="rounded-2xl p-4 h-24 animate-pulse" style={{ background: '#e8e5dc' }}/>)}
        </div>
      )}

      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3" style={{ border: '1px solid #e8e5dc' }}>
        <div className="text-xs font-bold uppercase tracking-wider" style={{ color: '#8a7a5a' }}>الفترة الزمنية</div>
        <div className="flex flex-wrap gap-2">
          {QUICK_PERIODS.map(p => (
            <button key={p.key} onClick={() => handlePeriod(p.key)}
              className="px-3 py-1.5 text-xs rounded-xl font-semibold transition-all"
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
            <label className="text-xs text-slate-500 block mb-1">من</label>
            <input type="date" value={range.from}
              onChange={e => handleCustom('from', e.target.value)}
              className="border rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: '#d1c9b8' }}/>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">إلى</label>
            <input type="date" value={range.to}
              onChange={e => handleCustom('to', e.target.value)}
              className="border rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: '#d1c9b8' }}/>
          </div>
          {activePeriod === 'custom' && (
            <button onClick={() => loadStats(range, pid)}
              className="px-4 py-2 rounded-xl text-sm font-bold transition-all"
              style={{ background: NAVY, color: '#fff' }}>
              تحديث
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: GOLD, borderTopColor: 'transparent' }}/>
        </div>
      ) : (
        <>
          {stats && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard label="إجمالي المبيعات"  value={`${fmt(stats.totalSales)} ر.س`}    icon="💵" />
              <StatCard label="إجمالي المصروفات" value={`${fmt(stats.totalExpenses)} ر.س`} icon="📤" />
              <StatCard label="صافي الربح"        value={`${fmt(stats.profit)} ر.س`}        icon="📈" />
              <StatCard label="قيود معلقة"         value={stats.pending}                     icon="⏳" />
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: '1px solid #e8e5dc' }}>
            <div className="px-5 py-4" style={{ borderBottom: '1px solid #e8e5dc' }}>
              <h2 className="font-bold text-sm" style={{ color: NAVY }}>آخر الحركات</h2>
            </div>
            <div className="divide-y" style={{ borderColor: '#f5f4f0' }}>
              {recent.length === 0 && (
                <p className="text-center text-slate-400 py-8 text-sm">لا توجد بيانات في هذه الفترة</p>
              )}
              {recent.map((r, i) => (
                <div key={i} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <div className="text-sm font-medium" style={{ color: NAVY }}>{r.type || r.description || '—'}</div>
                    <div className="text-xs text-slate-400">{r.date}</div>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full font-semibold"
                    style={r.status === 'approved' ? { background: '#f0fdf4', color: '#16a34a' }
                      : r.status === 'auto'        ? { background: '#eff6ff', color: '#1d4ed8' }
                      : r.status === 'cancelled'   ? { background: '#fef2f2', color: '#dc2626' }
                      :                              { background: '#fffbeb', color: '#b45309' }}>
                    {r.status === 'approved' ? 'معتمد' : r.status === 'auto' ? 'تلقائي' : r.status === 'cancelled' ? 'ملغي' : 'معلق'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
