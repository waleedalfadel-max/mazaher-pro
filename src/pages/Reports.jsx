import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

function Row({ label, value, bold, indent, color }) {
  return (
    <div className={`flex justify-between items-center py-2 border-b border-slate-50 ${bold ? 'font-bold' : ''} ${indent ? 'pr-6' : ''}`}>
      <span className={`text-sm ${color || 'text-slate-700'}`}>{label}</span>
      <span className={`text-sm tabular-nums ${bold ? 'text-slate-900' : 'text-slate-600'} ${color || ''}`}>{value} ر.س</span>
    </div>
  )
}

export default function Reports() {
  const now  = new Date()
  const [from, setFrom] = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`)
  const [to,   setTo]   = useState(now.toISOString().split('T')[0])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data: proj } = await supabase.from('projects').select('id').eq('name','مزاهر-برو').single()
    if (!proj) { setLoading(false); return }

    const [{ data: sales }, { data: ledger }] = await Promise.all([
      supabase.from('sales').select('cash_sales,network_sales')
        .eq('project_id', proj.id).gte('date', from).lte('date', to),
      supabase.from('ledger_entries').select('type,cash_out,bank_out,custody_out,cash_in,bank_in,custody_in')
        .eq('project_id', proj.id).gte('date', from).lte('date', to),
    ])

    const sum = (list, field) => (list||[]).reduce((s,r) => s+(Number(r[field])||0), 0)
    const sumOut = (list, types) => (list||[]).filter(r=>types.includes(r.type))
      .reduce((s,r) => s+(r.cash_out||0)+(r.bank_out||0)+(r.custody_out||0), 0)

    const cashSales    = sum(sales,'cash_sales')
    const networkSales = sum(sales,'network_sales')
    const totalSales   = cashSales + networkSales

    const opEx   = sumOut(ledger, ['🛒 مصروفات تشغيلية'])
    const fixEx  = sumOut(ledger, ['💰 مصروفات ثابتة'])
    const loans  = sumOut(ledger, ['💳 قسط سيارة','💳 قسط شراء أرض','💳 قرض ١','💳 قرض ٢'])
    const draws  = sumOut(ledger, ['💼 مسحوبات سليمان','💼 مسحوبات أم طوبى'])
    const grossProfit = totalSales - opEx - fixEx
    const netProfit   = grossProfit - loans
    const netFlow     = netProfit - draws
    const margin      = totalSales > 0 ? (netProfit / totalSales * 100).toFixed(1) : 0

    setData({ cashSales, networkSales, totalSales, opEx, fixEx, loans, draws, grossProfit, netProfit, netFlow, margin })
    setLoading(false)
  }

  const fmt = v => (v||0).toLocaleString('ar-SA', {minimumFractionDigits:2})

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-800">التقارير المالية</h1>

      {/* Date Range */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-slate-500 block mb-1">من تاريخ</label>
          <input type="date" value={from} onChange={e=>setFrom(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">إلى تاريخ</label>
          <input type="date" value={to} onChange={e=>setTo(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
        </div>
        <button onClick={load} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          تحديث
        </button>
      </div>

      {loading && <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/></div>}

      {data && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Income Statement */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <h2 className="font-bold text-slate-800 mb-4 pb-2 border-b border-slate-100">💰 قائمة الدخل</h2>
            <Row label="💵 مبيعات كاش"    value={fmt(data.cashSales)}    indent />
            <Row label="🏦 مبيعات شبكة"   value={fmt(data.networkSales)} indent />
            <Row label="إجمالي المبيعات"   value={fmt(data.totalSales)}   bold />
            <div className="pt-2 mt-2 border-t border-slate-100">
              <Row label="🛒 مصروفات تشغيلية" value={`(${fmt(data.opEx)})`}  indent color="text-red-600" />
              <Row label="💰 مصروفات ثابتة"   value={`(${fmt(data.fixEx)})`} indent color="text-red-600" />
            </div>
            <Row label="مجمل الربح" value={fmt(data.grossProfit)} bold color={data.grossProfit>=0?'text-green-700':'text-red-700'} />
            <Row label="(-) الأقساط" value={`(${fmt(data.loans)})`} indent color="text-red-600" />
            <Row label="صافي الربح" value={fmt(data.netProfit)}   bold color={data.netProfit>=0?'text-green-700':'text-red-700'} />
            <Row label="(-) المسحوبات" value={`(${fmt(data.draws)})`} indent color="text-red-600" />
            <Row label="صافي التدفق النقدي" value={fmt(data.netFlow)} bold color={data.netFlow>=0?'text-blue-700':'text-red-700'} />
            <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between">
              <span className="text-sm text-slate-500">هامش الربح</span>
              <span className="text-sm font-bold text-blue-600">{data.margin}%</span>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="space-y-3">
            {[
              { label:'إجمالي المبيعات', value:data.totalSales, icon:'💵', bg:'bg-green-50', border:'border-green-100', text:'text-green-700' },
              { label:'إجمالي المصروفات', value:data.opEx+data.fixEx, icon:'📤', bg:'bg-red-50', border:'border-red-100', text:'text-red-700' },
              { label:'صافي الربح', value:data.netProfit, icon:'📈', bg:'bg-blue-50', border:'border-blue-100', text:'text-blue-700' },
              { label:'إجمالي الأقساط', value:data.loans, icon:'💳', bg:'bg-orange-50', border:'border-orange-100', text:'text-orange-700' },
              { label:'المسحوبات', value:data.draws, icon:'💼', bg:'bg-purple-50', border:'border-purple-100', text:'text-purple-700' },
            ].map(c=>(
              <div key={c.label} className={`${c.bg} border ${c.border} rounded-xl p-4 flex items-center justify-between`}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{c.icon}</span>
                  <span className="text-sm font-medium text-slate-700">{c.label}</span>
                </div>
                <span className={`font-bold tabular-nums ${c.text}`}>{fmt(c.value)} ر.س</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
