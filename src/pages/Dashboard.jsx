import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

function StatCard({ label, value, icon, color }) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
      <div className="flex items-center justify-between mb-3">
        <span className="text-2xl">{icon}</span>
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${color}`}>هذا الشهر</span>
      </div>
      <div className="text-2xl font-bold text-slate-800 mb-1 tabular-nums">{value}</div>
      <div className="text-sm text-slate-500">{label}</div>
    </div>
  )
}

export default function Dashboard() {
  const { roleLabel } = useAuth()
  const [stats, setStats]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [recent, setRecent] = useState([])

  useEffect(() => {
    loadStats()
  }, [])

  async function loadStats() {
    try {
      const now   = new Date()
      const from  = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
      const to    = now.toISOString().split('T')[0]

      const { data: proj } = await supabase
        .from('projects').select('id').eq('name', 'مزاهر').single()
      if (!proj) { setLoading(false); return }

      const pid = proj.id

      const [{ data: sales }, { data: ledger }] = await Promise.all([
        supabase.from('sales')
          .select('cash_sales,network_sales')
          .eq('project_id', pid)
          .gte('date', from).lte('date', to),
        supabase.from('ledger_entries')
          .select('cash_out,bank_out,custody_out,type,date,description,status')
          .eq('project_id', pid)
          .gte('date', from).lte('date', to)
          .order('date', { ascending: false })
          .limit(10),
      ])

      const totalSales    = (sales || []).reduce((s, r) => s + (r.cash_sales||0) + (r.network_sales||0), 0)
      const totalExpenses = (ledger || []).filter(r => r.cash_out || r.bank_out || r.custody_out)
        .reduce((s, r) => s + (r.cash_out||0) + (r.bank_out||0) + (r.custody_out||0), 0)
      const pending       = (ledger || []).filter(r => r.status === 'pending').length

      setStats({ totalSales, totalExpenses, profit: totalSales - totalExpenses, pending })
      setRecent(ledger || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const fmt = v => (v || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">لوحة التحكم</h1>
        <p className="text-slate-500 text-sm mt-1">مرحباً — {roleLabel} | مقهى ديوانية مزاهر</p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="إجمالي المبيعات" value={`${fmt(stats.totalSales)} ر.س`} icon="💵" color="bg-green-100 text-green-700" />
          <StatCard label="إجمالي المصروفات" value={`${fmt(stats.totalExpenses)} ر.س`} icon="📤" color="bg-red-100 text-red-700" />
          <StatCard label="صافي الربح" value={`${fmt(stats.profit)} ر.س`} icon="📈" color={stats.profit >= 0 ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"} />
          <StatCard label="قيود معلقة" value={stats.pending} icon="⏳" color="bg-yellow-100 text-yellow-700" />
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
                r.status === 'approved' ? 'bg-green-100 text-green-700'
                : r.status === 'auto'   ? 'bg-blue-100 text-blue-700'
                : 'bg-yellow-100 text-yellow-700'
              }`}>
                {r.status === 'approved' ? 'معتمد' : r.status === 'auto' ? 'تلقائي' : 'معلق'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
