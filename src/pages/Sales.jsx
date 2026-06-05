import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const now = new Date()
const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
const today = now.toISOString().split('T')[0]

export default function Sales() {
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(true)
  const [totals, setTotals] = useState({ cash: 0, network: 0, total: 0 })
  const [filter, setFilter] = useState({ from: thisMonthStart, to: today })
  const [projectId, setProjectId] = useState(null)

  useEffect(() => { init() }, [])

  async function init() {
    const { data: proj } = await supabase.from('projects').select('id').eq('name', 'تحسيب-برو').single()
    if (!proj) { setLoading(false); return }
    setProjectId(proj.id)
    await load(proj.id, filter)
  }

  async function load(pid, f) {
    setLoading(true)
    let q = supabase.from('sales')
      .select('*').eq('project_id', pid || projectId)
      .order('date', { ascending: false }).limit(200)
    if (f.from) q = q.gte('date', f.from)
    if (f.to)   q = q.lte('date', f.to)
    const { data } = await q
    const list = data || []
    setRows(list)
    setTotals({
      cash:    list.reduce((s, r) => s + (r.cash_sales    || 0), 0),
      network: list.reduce((s, r) => s + (r.network_sales || 0), 0),
      total:   list.reduce((s, r) => s + (r.cash_sales    || 0) + (r.network_sales || 0), 0),
    })
    setLoading(false)
  }

  function setQuick(type) {
    const n = new Date()
    let from, to = n.toISOString().split('T')[0]
    if (type === 'month') {
      from = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`
    } else if (type === 'lastMonth') {
      const lm = new Date(n.getFullYear(), n.getMonth() - 1, 1)
      const lme = new Date(n.getFullYear(), n.getMonth(), 0)
      from = lm.toISOString().split('T')[0]
      to   = lme.toISOString().split('T')[0]
    } else if (type === '3months') {
      const d = new Date(n); d.setMonth(d.getMonth() - 3)
      from = d.toISOString().split('T')[0]
    } else if (type === 'year') {
      from = `${n.getFullYear()}-01-01`
    }
    const f = { from, to }
    setFilter(f)
    if (projectId) load(projectId, f)
  }

  function search() { if (projectId) load(projectId, filter) }

  const fmt = v => (v || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2 })

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-800">المبيعات</h1>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 space-y-3">
        {/* Quick buttons */}
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'month',     label: 'هذا الشهر' },
            { key: 'lastMonth', label: 'الشهر الماضي' },
            { key: '3months',   label: 'آخر 3 أشهر' },
            { key: 'year',      label: 'هذا العام' },
          ].map(q => (
            <button key={q.key} onClick={() => setQuick(q.key)}
              className="px-3 py-1.5 text-xs bg-slate-100 text-slate-600 rounded-lg font-medium hover:bg-blue-100 hover:text-blue-700 transition-colors">
              {q.label}
            </button>
          ))}
        </div>
        {/* Date inputs */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-slate-500 block mb-1">من تاريخ</label>
            <input type="date" value={filter.from}
              onChange={e => setFilter(f => ({ ...f, from: e.target.value }))}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">إلى تاريخ</label>
            <input type="date" value={filter.to}
              onChange={e => setFilter(f => ({ ...f, to: e.target.value }))}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
          </div>
          <button onClick={search}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
            بحث
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'مبيعات كاش',   value: totals.cash,    color: 'text-green-600' },
          { label: 'مبيعات شبكة',  value: totals.network, color: 'text-blue-600' },
          { label: 'الإجمالي',      value: totals.total,   color: 'text-slate-800' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <div className="text-xs text-slate-500 mb-1">{c.label}</div>
            <div className={`text-xl font-bold tabular-nums ${c.color}`}>{fmt(c.value)} ر.س</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {['التاريخ', 'مبيعات كاش', 'مبيعات شبكة', 'الإجمالي', 'ملاحظات'].map(h => (
                  <th key={h} className="px-4 py-3 text-right text-xs font-semibold text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.length === 0 && (
                <tr><td colSpan={5} className="text-center py-10 text-slate-400">لا توجد بيانات</td></tr>
              )}
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600">{r.date}</td>
                  <td className="px-4 py-3 text-green-600 tabular-nums">{fmt(r.cash_sales)}</td>
                  <td className="px-4 py-3 text-blue-600 tabular-nums">{fmt(r.network_sales)}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800 tabular-nums">
                    {fmt((r.cash_sales || 0) + (r.network_sales || 0))}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{r.description || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
