import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'

const now = new Date()
const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
const today = now.toISOString().split('T')[0]

const STATUS_BADGE = {
  approved:  'bg-green-100 text-green-700',
  auto:      'bg-blue-100 text-blue-700',
  pending:   'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-red-100 text-red-700',
  modified:  'bg-purple-100 text-purple-700',
}
const STATUS_LABEL = {
  approved:  'معتمد',
  auto:      'تلقائي',
  pending:   'معلق',
  cancelled: 'ملغي',
  modified:  'معدَّل',
}

export default function JournalLedger() {
  const [rows, setRows]             = useState([])
  const [loading, setLoading]       = useState(true)
  const [projectId, setProjectId]   = useState(null)
  const [filter, setFilter]         = useState({ from: thisMonthStart, to: today })

  useEffect(() => { init() }, [])

  async function init() {
    const { data: proj } = await supabase
      .from('projects').select('id').eq('name', 'تحسيب-برو').single()
    if (proj) { setProjectId(proj.id); await load(proj.id, filter) }
    setLoading(false)
  }

  async function load(pid, f) {
    setLoading(true)
    let q = supabase.from('ledger_entries')
      .select('id,date,type,description,cash_in,bank_in,custody_in,cash_out,bank_out,custody_out,total_amount,status,journal_no,created_at')
      .eq('project_id', pid || projectId)
      .not('status', 'eq', 'cancelled')
      .order('date', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(500)
    if (f.from) q = q.gte('date', f.from)
    if (f.to)   q = q.lte('date', f.to)
    const { data } = await q
    setRows(data || [])
    setLoading(false)
  }

  function setQuick(type) {
    const n = new Date()
    let from, to = n.toISOString().split('T')[0]
    if (type === 'month') {
      from = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`
    } else if (type === 'lastMonth') {
      const lm  = new Date(n.getFullYear(), n.getMonth() - 1, 1)
      const lme = new Date(n.getFullYear(), n.getMonth(), 0)
      from = lm.toISOString().split('T')[0]; to = lme.toISOString().split('T')[0]
    } else if (type === '3months') {
      const d = new Date(n); d.setMonth(d.getMonth() - 3)
      from = d.toISOString().split('T')[0]
    } else {
      from = `${n.getFullYear()}-01-01`
    }
    const f = { from, to }
    setFilter(f)
    if (projectId) load(projectId, f)
  }

  const totals = useMemo(() => {
    const debit   = rows.reduce((s, r) => s + (r.cash_in  || 0) + (r.bank_in  || 0) + (r.custody_in  || 0), 0)
    const credit  = rows.reduce((s, r) => s + (r.cash_out || 0) + (r.bank_out || 0) + (r.custody_out || 0), 0)
    const cashIn  = rows.reduce((s, r) => s + (r.cash_in  || 0), 0)
    const cashOut = rows.reduce((s, r) => s + (r.cash_out || 0), 0)
    const bankIn  = rows.reduce((s, r) => s + (r.bank_in  || 0), 0)
    const bankOut = rows.reduce((s, r) => s + (r.bank_out || 0), 0)
    const custIn  = rows.reduce((s, r) => s + (r.custody_in  || 0), 0)
    const custOut = rows.reduce((s, r) => s + (r.custody_out || 0), 0)
    return { debit, credit, cashIn, cashOut, bankIn, bankOut, custIn, custOut }
  }, [rows])

  const fmt = v => v ? Number(v).toLocaleString('ar-SA', { minimumFractionDigits: 2 }) : '—'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">سجل القيود اليومية</h1>
          <p className="text-sm text-slate-500 mt-1">{rows.length} قيد</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 space-y-3">
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
          <button onClick={() => load(projectId, filter)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
            بحث
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {rows.length > 0 && (
        <div className="space-y-2">
          {/* Main totals */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-green-50 border border-green-100 rounded-xl p-3 text-center">
              <div className="text-xs text-green-600 mb-1">إجمالي الدخل (مدين)</div>
              <div className="font-bold text-green-700 tabular-nums text-sm">{fmt(totals.debit)} ر.س</div>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-center">
              <div className="text-xs text-red-600 mb-1">إجمالي الخرج (دائن)</div>
              <div className="font-bold text-red-700 tabular-nums text-sm">{fmt(totals.credit)} ر.س</div>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-center">
              <div className="text-xs text-blue-600 mb-1">صافي الحركة</div>
              <div className={`font-bold tabular-nums text-sm ${totals.debit - totals.credit >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                {fmt(Math.abs(totals.debit - totals.credit))} ر.س {totals.debit >= totals.credit ? '▲' : '▼'}
              </div>
            </div>
          </div>
          {/* Per-source breakdown */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border border-slate-100 rounded-xl p-3 shadow-sm">
              <div className="text-xs font-semibold text-slate-500 mb-2">🏧 الصندوق</div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">دخل</span>
                <span className="text-green-600 font-mono font-medium">{fmt(totals.cashIn)}</span>
              </div>
              <div className="flex justify-between text-xs mt-1">
                <span className="text-slate-400">خرج</span>
                <span className="text-red-500 font-mono font-medium">{fmt(totals.cashOut)}</span>
              </div>
              <div className="border-t border-slate-100 mt-2 pt-2 flex justify-between text-xs">
                <span className="text-slate-600 font-semibold">صافي</span>
                <span className={`font-mono font-bold ${totals.cashIn - totals.cashOut >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                  {fmt(Math.abs(totals.cashIn - totals.cashOut))} {totals.cashIn >= totals.cashOut ? '▲' : '▼'}
                </span>
              </div>
            </div>
            <div className="bg-white border border-slate-100 rounded-xl p-3 shadow-sm">
              <div className="text-xs font-semibold text-slate-500 mb-2">🏦 البنك</div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">دخل</span>
                <span className="text-green-600 font-mono font-medium">{fmt(totals.bankIn)}</span>
              </div>
              <div className="flex justify-between text-xs mt-1">
                <span className="text-slate-400">خرج</span>
                <span className="text-red-500 font-mono font-medium">{fmt(totals.bankOut)}</span>
              </div>
              <div className="border-t border-slate-100 mt-2 pt-2 flex justify-between text-xs">
                <span className="text-slate-600 font-semibold">صافي</span>
                <span className={`font-mono font-bold ${totals.bankIn - totals.bankOut >= 0 ? 'text-blue-700' : 'text-red-600'}`}>
                  {fmt(Math.abs(totals.bankIn - totals.bankOut))} {totals.bankIn >= totals.bankOut ? '▲' : '▼'}
                </span>
              </div>
            </div>
            <div className="bg-white border border-slate-100 rounded-xl p-3 shadow-sm">
              <div className="text-xs font-semibold text-slate-500 mb-2">👤 العهدة</div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">دخل</span>
                <span className="text-green-600 font-mono font-medium">{fmt(totals.custIn)}</span>
              </div>
              <div className="flex justify-between text-xs mt-1">
                <span className="text-slate-400">خرج</span>
                <span className="text-red-500 font-mono font-medium">{fmt(totals.custOut)}</span>
              </div>
              <div className="border-t border-slate-100 mt-2 pt-2 flex justify-between text-xs">
                <span className="text-slate-600 font-semibold">صافي</span>
                <span className={`font-mono font-bold ${totals.custIn - totals.custOut >= 0 ? 'text-amber-700' : 'text-red-600'}`}>
                  {fmt(Math.abs(totals.custIn - totals.custOut))} {totals.custIn >= totals.custOut ? '▲' : '▼'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Journal Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="px-4 py-3 text-right text-xs font-semibold w-12">#</th>
                <th className="px-4 py-3 text-right text-xs font-semibold">التاريخ</th>
                <th className="px-4 py-3 text-right text-xs font-semibold">نوع الحركة</th>
                <th className="px-4 py-3 text-right text-xs font-semibold">البيان</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-green-300">مدين (دخل)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-red-300">دائن (خرج)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.length === 0 && (
                <tr><td colSpan={7} className="text-center py-12 text-slate-400">لا توجد قيود في هذه الفترة</td></tr>
              )}
              {rows.map((r, idx) => {
                const debit  = (r.cash_in  || 0) + (r.bank_in  || 0) + (r.custody_in  || 0)
                const credit = (r.cash_out || 0) + (r.bank_out || 0) + (r.custody_out || 0)
                return (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full tabular-nums">
                        {idx + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap font-mono text-xs">{r.date}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap text-xs">{r.type || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 max-w-48 truncate text-xs">{r.description || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {debit > 0
                        ? <span className="text-green-700 font-semibold">{fmt(debit)}</span>
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {credit > 0
                        ? <span className="text-red-600 font-semibold">{fmt(credit)}</span>
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[r.status] || 'bg-slate-100 text-slate-500'}`}>
                        {STATUS_LABEL[r.status] || r.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-sm font-bold text-slate-700 text-left">الإجمالي ({rows.length} قيد)</td>
                  <td className="px-4 py-3 text-right font-bold text-green-700 tabular-nums">{fmt(totals.debit)}</td>
                  <td className="px-4 py-3 text-right font-bold text-red-600 tabular-nums">{fmt(totals.credit)}</td>
                  <td/>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </div>
  )
}
