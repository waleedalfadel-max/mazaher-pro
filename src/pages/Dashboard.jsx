import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

function StatCard({ label, value, icon, color }) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
      <div className="flex items-center justify-between mb-3">
        <span className="text-2xl">{icon}</span>
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${color}`}>الفترة المحددة</span>
      </div>
      <div className="text-2xl font-bold text-slate-800 mb-1 tabular-nums">{value}</div>
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
  const n   = new Date()
  const to  = n.toISOString().split('T')[0]
  let from
  if (type === 'month') {
    from = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`
  } else if (type === 'lastMonth') {
    const lm  = new Date(n.getFullYear(), n.getMonth() - 1, 1)
    const lme = new Date(n.getFullYear(), n.getMonth(), 0)
    return { from: lm.toISOString().split('T')[0], to: lme.toISOString().split('T')[0] }
  } else if (type === '3months') {
    const d = new Date(n); d.setMonth(d.getMonth() - 3)
    from = d.toISOString().split('T')[0]
  } else {
    from = `${n.getFullYear()}-01-01`
  }
  return { from, to }
}

export default function Dashboard() {
  const { roleLabel } = useAuth()
  const [stats, setStats]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [recent, setRecent]   = useState([])
  const [activePeriod, setActivePeriod] = useState('month')
  const [range, setRange]     = useState(getRange('month'))

  useEffect(() => { loadStats(range) }, [])

  async function handlePeriod(key) {
    setActivePeriod(key)
    const r = getRange(key)
    setRange(r)
    await loadStats(r)
  }

  async function handleCustom(field, val) {
    setActivePeriod('custom')
    const r = { ...range, [field]: val }
    setRange(r)
  }

  async function loadStats(r) {
    setLoading(true)
    try {
      const { data: proj } = await supabase
        .from('projects').select('id').eq('name', 'مزاهر-برو').single()
      if (!proj) { setLoading(false); return }

      const pid = proj.id

      const [{ data: sales }, { data: ledger }] = await Promise.all([
        supabase.from('sales')
          .select('cash_sales,network_sales')
          .eq('project_id', pid)
          .gte('date', r.from).lte('date', r.to),
        supabase.from('ledger_entries')
          .select('cash_out,bank_out,custody_out,type,date,description,status')
          .eq('project_id', pid)
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">لوحة التحكم</h1>
        <p className="text-slate-500 text-sm mt-1">مرحباً — {roleLabel} | مقهى ديوانية مزاهر</p>
      </div>

      {/* Period selector */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 space-y-3">
        <div className="flex flex-wrap gap-2">
          {QUICK_PERIODS.map(p => (
            <button key={p.key} onClick={() => handlePeriod(p.key)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                activePeriod === p.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-700'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-slate-500 block mb-1">من</label>
            <input type="date" value={range.from}
              onChange={e => handleCustom('from', e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">إلى</label>
            <input type="date" value={range.to}
              onChange={e => handleCustom('to', e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
          </div>
          {activePeriod === 'custom' && (
            <button onClick={() => loadStats(range)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
              تحديث
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/>
        </div>
      ) : (
        <>
          {stats && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="إجمالي المبيعات"   value={`${fmt(stats.totalSales)} ر.س`}    icon="💵" color="bg-green-100 text-green-700" />
              <StatCard label="إجمالي المصروفات"  value={`${fmt(stats.totalExpenses)} ر.س`} icon="📤" color="bg-red-100 text-red-700" />
              <StatCard label="صافي الربح"         value={`${fmt(stats.profit)} ر.س`}         icon="📈" color={stats.profit >= 0 ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'} />
              <StatCard label="قيود معلقة"          value={stats.pending}                      icon="⏳" color="bg-yellow-100 text-yellow-700" />
            </div>
          )}

          {/* Recent */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-bold text-slate-800">آخر الحركات</h2>
            </div>
            <div className="divide-y divide-slate-50">
              {recent.length === 0 && (
                <p className="text-center text-slate-400 py-8 text-sm">لا توجد بيانات</p>
              )}
              {recent.map((r, i) => (
                <div key={i} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <div className="text-sm font-medium text-slate-700">{r.type || r.description || '—'}</div>
                    <div className="text-xs text-slate-400">{r.date}</div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    r.status === 'approved'  ? 'bg-green-100 text-green-700'
                    : r.status === 'auto'    ? 'bg-blue-100 text-blue-700'
                    : r.status === 'cancelled' ? 'bg-red-100 text-red-700'
                    : 'bg-yellow-100 text-yellow-700'
                  }`}>
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
