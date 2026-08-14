import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const NAVY = '#1B3A5C'
const GOLD = '#6EB7B0'

const QUICK_PERIODS = [
  { key: 'month',     label: 'الشهر الحالي' },
  { key: 'lastMonth', label: 'الشهر الماضي' },
  { key: 'year',      label: 'السنة الحالية' },
]

// قنوات المشاريع العادية
const CHANNELS = [
  { key: 'cash_sales',    label: 'مبيعات كاش',       icon: '💵', color: '#16a34a' },
  { key: 'network_sales', label: 'مبيعات شبكة / مدى', icon: '🏦', color: '#1d4ed8' },
  { key: 'hunger_sales',  label: 'هنقر ستيشن',         icon: '🍔', color: '#ea580c' },
  { key: 'jahez_sales',   label: 'جاهز',               icon: '🛵', color: '#7c3aed' },
  { key: 'keeta_sales',   label: 'كيتا',               icon: '🛺', color: '#0891b2' },
]

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getRange(type) {
  const n  = new Date()
  const to = fmtDate(n)
  if (type === 'lastMonth') {
    const lm  = new Date(n.getFullYear(), n.getMonth() - 1, 1)
    const lme = new Date(n.getFullYear(), n.getMonth(), 0)
    return { from: fmtDate(lm), to: fmtDate(lme) }
  }
  const from = type === 'year'
    ? `${n.getFullYear()}-01-01`
    : `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`
  return { from, to }
}

const fmt = v => (v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })

// ── فلتر التاريخ ─────────────────────────────────────────────────────────────
function PeriodFilter({ activePeriod, filter, onPeriod, onDate }) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3" style={{ border: '1px solid #e8e5dc' }}>
      <div className="text-sm font-bold uppercase tracking-wider text-center" style={{ color: '#8a7a5a' }}>الفترة الزمنية</div>
      <div className="flex flex-wrap gap-2 justify-center">
        {QUICK_PERIODS.map(p => (
          <button key={p.key} onClick={() => onPeriod(p.key)}
            className="px-3 py-1.5 text-xs rounded-xl font-semibold transition-all"
            style={activePeriod === p.key
              ? { background: GOLD, color: NAVY }
              : { background: '#f5f4f0', color: '#4b5563' }}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 items-end justify-center">
        {[{ field: 'from', label: 'من' }, { field: 'to', label: 'إلى' }].map(({ field, label }) => (
          <div key={field} className="flex-1 min-w-[8rem]">
            <label className="text-xs text-slate-500 block mb-1 text-center">{label}</label>
            <input type="date" value={filter[field]} onChange={e => onDate(field, e.target.value)}
              className="w-full border rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: '#d1c9b8' }}/>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── الصفحة الرئيسية ──────────────────────────────────────────────────────────
export default function Sales() {
  const { projectId } = useAuth()

  const init = getRange('month')
  const [rows,         setRows]         = useState([])
  const [loading,      setLoading]      = useState(true)
  const [totals,       setTotals]       = useState({})
  const [filter,       setFilter]       = useState(init)
  const [activePeriod, setActivePeriod] = useState('month')

  useEffect(() => { if (projectId) load(projectId, init) }, [projectId])

  async function load(pid, f) {
    setLoading(true)
    let q = supabase.from('sales')
      .select('*').eq('project_id', pid)
      .order('date', { ascending: false }).limit(200)
    if (f.from) q = q.gte('date', f.from)
    if (f.to)   q = q.lte('date', f.to)
    const { data } = await q
    const list = data || []
    setRows(list)
    const t = {}
    CHANNELS.forEach(c => { t[c.key] = list.reduce((s, r) => s + (r[c.key] || 0), 0) })
    t.total = CHANNELS.reduce((s, c) => s + (t[c.key] || 0), 0)
    setTotals(t)
    setLoading(false)
  }

  function handlePeriod(key) {
    setActivePeriod(key)
    const r = getRange(key)
    setFilter(r)
    if (projectId) load(projectId, r)
  }

  function handleDate(field, val) {
    setActivePeriod('custom')
    const f = { ...filter, [field]: val }
    setFilter(f)
    if (projectId) load(projectId, f)
  }

  // عرض فقط القنوات التي فيها مبيعات
  const activeChannels = CHANNELS.filter(c => totals[c.key] > 0)

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold" style={{ color: NAVY }}>المبيعات</h1>

      <PeriodFilter
        activePeriod={activePeriod}
        filter={filter}
        onPeriod={handlePeriod}
        onDate={handleDate}
      />

      <>
          {/* بطاقات القنوات */}
          <div className={`grid gap-3 ${activeChannels.length > 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-3'}`}>
            {(activeChannels.length > 0 ? activeChannels : CHANNELS.slice(0, 2)).map(c => (
              <div key={c.key} className="rounded-2xl p-4 shadow-sm text-center"
                style={{ background: '#fff', border: '2px solid #e8e5dc' }}>
                <div className="flex flex-col items-center gap-1 mb-2">
                  <span className="text-xl">{c.icon}</span>
                  <span className="text-xs font-bold text-slate-500">{c.label}</span>
                </div>
                <div className="text-xl font-bold font-mono tabular-nums" style={{ color: c.color }}>
                  {fmt(totals[c.key])}
                </div>
              </div>
            ))}
            <div className="rounded-2xl p-4 shadow-sm text-center"
              style={{ background: NAVY, border: `2px solid ${GOLD}` }}>
              <div className="flex flex-col items-center gap-1 mb-2">
                <span className="text-xl">📊</span>
                <span className="text-xs font-bold text-white opacity-70">الإجمالي</span>
              </div>
              <div className="text-xl font-bold font-mono tabular-nums" style={{ color: GOLD }}>
                {fmt(totals.total)}
              </div>
            </div>
          </div>

          {/* الجدول */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: '1px solid #e8e5dc' }}>
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: GOLD, borderTopColor: 'transparent' }}/>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: '#f5f4f0', borderBottom: `2px solid ${GOLD}` }}>
                      <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>التاريخ</th>
                      {CHANNELS.map(c => (
                        <th key={c.key} className="px-3 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>
                          {c.icon} {c.label}
                        </th>
                      ))}
                      <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>الإجمالي</th>
                      <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: '#f5f4f0' }}>
                    {rows.length === 0 && (
                      <tr><td colSpan={CHANNELS.length + 3} className="text-center py-10 text-slate-400">لا توجد بيانات</td></tr>
                    )}
                    {rows.map(r => {
                      const rowTotal = CHANNELS.reduce((s, c) => s + (r[c.key] || 0), 0)
                      return (
                        <tr key={r.id} className="hover:bg-amber-50/30 transition-colors">
                          <td className="px-4 py-3 text-slate-600 text-xs font-medium">{r.date}</td>
                          {CHANNELS.map(c => (
                            <td key={c.key} className="px-3 py-3 font-mono tabular-nums text-xs"
                              style={{ color: r[c.key] > 0 ? c.color : '#cbd5e1' }}>
                              {r[c.key] > 0 ? fmt(r[c.key]) : '—'}
                            </td>
                          ))}
                          <td className="px-4 py-3 font-mono tabular-nums font-bold text-xs" style={{ color: NAVY }}>
                            {fmt(rowTotal)}
                          </td>
                          <td className="px-4 py-3 text-slate-400 text-xs">{r.description || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {rows.length > 0 && (
                    <tfoot>
                      <tr style={{ background: NAVY }}>
                        <td className="px-4 py-3 text-xs font-bold text-white">الإجمالي</td>
                        {CHANNELS.map(c => (
                          <td key={c.key} className="px-3 py-3 font-mono tabular-nums text-xs font-bold"
                            style={{ color: totals[c.key] > 0 ? GOLD : 'rgba(255,255,255,0.3)' }}>
                            {totals[c.key] > 0 ? fmt(totals[c.key]) : '—'}
                          </td>
                        ))}
                        <td className="px-4 py-3 font-mono tabular-nums font-bold text-sm" style={{ color: GOLD }}>
                          {fmt(totals.total)}
                        </td>
                        <td/>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        </>
    </div>
  )
}
