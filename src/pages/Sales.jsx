import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Sales() {
  const [rows, setRows]   = useState([])
  const [loading, setLoading] = useState(true)
  const [totals, setTotals] = useState({ cash:0, network:0, total:0 })

  useEffect(() => { load() }, [])

  async function load() {
    const { data: proj } = await supabase.from('projects').select('id').eq('name','مزاهر').single()
    if (!proj) { setLoading(false); return }
    const { data } = await supabase.from('sales')
      .select('*').eq('project_id', proj.id)
      .order('date', { ascending: false }).limit(100)
    const list = data || []
    setRows(list)
    setTotals({
      cash:    list.reduce((s,r) => s+(r.cash_sales||0), 0),
      network: list.reduce((s,r) => s+(r.network_sales||0), 0),
      total:   list.reduce((s,r) => s+(r.cash_sales||0)+(r.network_sales||0), 0),
    })
    setLoading(false)
  }

  const fmt = v => (v||0).toLocaleString('ar-SA', {minimumFractionDigits:2})

  if (loading) return <div className="flex justify-center h-64 items-center"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/></div>

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-800">المبيعات</h1>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label:'مبيعات كاش', value:totals.cash, color:'text-green-600' },
          { label:'مبيعات شبكة', value:totals.network, color:'text-blue-600' },
          { label:'الإجمالي', value:totals.total, color:'text-slate-800' },
        ].map(c=>(
          <div key={c.label} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <div className="text-xs text-slate-500 mb-1">{c.label}</div>
            <div className={`text-xl font-bold tabular-nums ${c.color}`}>{fmt(c.value)} ر.س</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              {['التاريخ','مبيعات كاش','مبيعات شبكة','الإجمالي','ملاحظات'].map(h=>(
                <th key={h} className="px-4 py-3 text-right text-xs font-semibold text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-slate-400">لا توجد بيانات</td></tr>}
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-600">{r.date}</td>
                <td className="px-4 py-3 text-green-600 tabular-nums">{fmt(r.cash_sales)}</td>
                <td className="px-4 py-3 text-blue-600 tabular-nums">{fmt(r.network_sales)}</td>
                <td className="px-4 py-3 font-semibold text-slate-800 tabular-nums">{fmt((r.cash_sales||0)+(r.network_sales||0))}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{r.description || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
