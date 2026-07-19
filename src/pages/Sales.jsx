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

// قنوات الكوفي في محمصة كون
const CAFE_CHANNELS = [
  { key: 'cash_sales',    label: 'مبيعات كاش',       icon: '💵', color: '#16a34a' },
  { key: 'network_sales', label: 'مبيعات شبكة / مدى', icon: '🏦', color: '#1d4ed8' },
]

// قنوات المحمصة الرئيسية (من ledger_entries)
const ROASTERY_CHANNELS = [
  { key: 'salla',   type: '🛒 مبيعات سلة',   label: 'مبيعات سلة',   icon: '🛒', color: '#1d4ed8' },
  { key: 'tabby',   type: '💳 مبيعات تابي',  label: 'مبيعات تابي',  icon: '💳', color: '#7c3aed' },
  { key: 'tamara',  type: '💳 مبيعات تمارا', label: 'مبيعات تمارا', icon: '💳', color: '#db2777' },
  { key: 'tahseel', type: '📥 تحصيل جملة',   label: 'تحصيل جملة',   icon: '📥', color: '#0891b2' },
]

function getRange(type) {
  const n  = new Date()
  const to = n.toISOString().split('T')[0]
  if (type === 'lastMonth') {
    const lm  = new Date(n.getFullYear(), n.getMonth() - 1, 1)
    const lme = new Date(n.getFullYear(), n.getMonth(), 0)
    return { from: lm.toISOString().split('T')[0], to: lme.toISOString().split('T')[0] }
  }
  const from = type === 'year'
    ? `${n.getFullYear()}-01-01`
    : `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`
  return { from, to }
}

const fmt = v => (v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })

// ── بطاقة ملخص ──────────────────────────────────────────────────────────────
function SummaryCard({ label, icon, value, color, gold }) {
  return (
    <div className="rounded-2xl p-4 shadow-sm text-center"
      style={gold
        ? { background: NAVY, border: `2px solid ${GOLD}` }
        : { background: '#fff', border: '2px solid #e8e5dc' }}>
      <div className="flex flex-col items-center gap-1 mb-2">
        <span className="text-xl">{icon}</span>
        <span className="text-xs font-bold" style={{ color: gold ? 'rgba(255,255,255,0.7)' : '#6b7280' }}>{label}</span>
      </div>
      <div className="text-xl font-bold font-mono tabular-nums"
        style={{ color: gold ? GOLD : (color || NAVY) }}>
        {fmt(value)}
      </div>
    </div>
  )
}

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

// ── عرض محمصة كون ────────────────────────────────────────────────────────────
function MahmasaView({ projectId, filter }) {
  const [cafeRows,    setCafeRows]    = useState([])
  const [roastRows,   setRoastRows]   = useState([])
  const [cafeTotals,  setCafeTotals]  = useState({})
  const [roastTotals, setRoastTotals] = useState({})
  const [loading,     setLoading]     = useState(true)

  useEffect(() => { load() }, [filter.from, filter.to])

  async function load() {
    setLoading(true)
    const [{ data: cafeData }, { data: ledgerData }] = await Promise.all([
      // الكوفي: من sales table، كل الفروع ما عدا المحمصة الرئيسية
      supabase.from('sales')
        .select('date, cash_sales, network_sales, description, branch')
        .eq('project_id', projectId)
        .neq('branch', 'المحمصة الرئيسية')
        .gte('date', filter.from).lte('date', filter.to)
        .order('date', { ascending: false }),
      // المحمصة الرئيسية: من ledger_entries
      supabase.from('ledger_entries')
        .select('date, type, bank_in')
        .eq('project_id', projectId)
        .eq('branch', 'المحمصة الرئيسية')
        .in('type', ROASTERY_CHANNELS.map(c => c.type))
        .gte('date', filter.from).lte('date', filter.to)
        .order('date', { ascending: false }),
    ])

    setCafeRows(cafeData || [])

    // تجميع قيود المحمصة الرئيسية حسب التاريخ
    const grouped = {}
    ;(ledgerData || []).forEach(e => {
      const ch = ROASTERY_CHANNELS.find(c => c.type === e.type)
      if (!ch) return
      if (!grouped[e.date]) grouped[e.date] = { date: e.date }
      grouped[e.date][ch.key] = (grouped[e.date][ch.key] || 0) + (e.bank_in || 0)
    })
    const roastList = Object.values(grouped).sort((a, b) => b.date.localeCompare(a.date))
    setRoastRows(roastList)

    // إجماليات الكوفي
    const ct = {}
    CAFE_CHANNELS.forEach(c => { ct[c.key] = (cafeData || []).reduce((s, r) => s + (r[c.key] || 0), 0) })
    ct.total = CAFE_CHANNELS.reduce((s, c) => s + (ct[c.key] || 0), 0)
    setCafeTotals(ct)

    // إجماليات المحمصة
    const rt = {}
    ROASTERY_CHANNELS.forEach(c => { rt[c.key] = roastList.reduce((s, r) => s + (r[c.key] || 0), 0) })
    rt.total = ROASTERY_CHANNELS.reduce((s, c) => s + (rt[c.key] || 0), 0)
    setRoastTotals(rt)

    setLoading(false)
  }

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: GOLD, borderTopColor: 'transparent' }}/>
    </div>
  )

  return (
    <div className="space-y-6">

      {/* ── قسم الكوفي ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold" style={{ color: NAVY }}>☕ مبيعات الكافيهات</span>
          <span className="text-xs text-slate-400">(الفاخرية + الوسطى)</span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <SummaryCard label="مبيعات كاش"       icon="💵" value={cafeTotals.cash_sales}    color="#16a34a" />
          <SummaryCard label="مبيعات شبكة"       icon="🏦" value={cafeTotals.network_sales} color="#1d4ed8" />
          <SummaryCard label="الإجمالي"     icon="📊" value={cafeTotals.total}         gold />
        </div>

        <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: '1px solid #e8e5dc' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#f5f4f0', borderBottom: `2px solid ${GOLD}` }}>
                  <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>التاريخ</th>
                  <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>الفرع</th>
                  {CAFE_CHANNELS.map(c => (
                    <th key={c.key} className="px-3 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>
                      {c.icon} {c.label}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: '#f5f4f0' }}>
                {cafeRows.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-8 text-slate-400 text-sm">لا توجد بيانات</td></tr>
                )}
                {cafeRows.map((r, i) => {
                  const rowTotal = CAFE_CHANNELS.reduce((s, c) => s + (r[c.key] || 0), 0)
                  return (
                    <tr key={i} className="hover:bg-amber-50/30 transition-colors">
                      <td className="px-4 py-3 text-slate-600 text-xs font-medium">{r.date}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{r.branch || '—'}</td>
                      {CAFE_CHANNELS.map(c => (
                        <td key={c.key} className="px-3 py-3 font-mono tabular-nums text-xs"
                          style={{ color: r[c.key] > 0 ? c.color : '#cbd5e1' }}>
                          {r[c.key] > 0 ? fmt(r[c.key]) : '—'}
                        </td>
                      ))}
                      <td className="px-4 py-3 font-mono tabular-nums font-bold text-xs" style={{ color: NAVY }}>
                        {fmt(rowTotal)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {cafeRows.length > 0 && (
                <tfoot>
                  <tr style={{ background: NAVY }}>
                    <td colSpan={2} className="px-4 py-3 text-xs font-bold text-white">الإجمالي</td>
                    {CAFE_CHANNELS.map(c => (
                      <td key={c.key} className="px-3 py-3 font-mono tabular-nums text-xs font-bold"
                        style={{ color: cafeTotals[c.key] > 0 ? GOLD : 'rgba(255,255,255,0.3)' }}>
                        {cafeTotals[c.key] > 0 ? fmt(cafeTotals[c.key]) : '—'}
                      </td>
                    ))}
                    <td className="px-4 py-3 font-mono tabular-nums font-bold text-sm" style={{ color: GOLD }}>
                      {fmt(cafeTotals.total)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </section>

      {/* ── قسم المحمصة الرئيسية ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold" style={{ color: NAVY }}>🏭 مبيعات المحمصة الرئيسية</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {ROASTERY_CHANNELS.map(c => (
            <SummaryCard key={c.key} label={c.label} icon={c.icon} value={roastTotals[c.key] || 0} color={c.color} />
          ))}
          <SummaryCard label="الإجمالي" icon="📊" value={roastTotals.total || 0} gold />
        </div>

        <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: '1px solid #e8e5dc' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: '#f5f4f0', borderBottom: `2px solid ${GOLD}` }}>
                  <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>التاريخ</th>
                  {ROASTERY_CHANNELS.map(c => (
                    <th key={c.key} className="px-3 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>
                      {c.icon} {c.label}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: NAVY }}>الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: '#f5f4f0' }}>
                {roastRows.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-slate-400 text-sm">لا توجد بيانات</td></tr>
                )}
                {roastRows.map((r, i) => {
                  const rowTotal = ROASTERY_CHANNELS.reduce((s, c) => s + (r[c.key] || 0), 0)
                  return (
                    <tr key={i} className="hover:bg-amber-50/30 transition-colors">
                      <td className="px-4 py-3 text-slate-600 text-xs font-medium">{r.date}</td>
                      {ROASTERY_CHANNELS.map(c => (
                        <td key={c.key} className="px-3 py-3 font-mono tabular-nums text-xs"
                          style={{ color: r[c.key] > 0 ? c.color : '#cbd5e1' }}>
                          {r[c.key] > 0 ? fmt(r[c.key]) : '—'}
                        </td>
                      ))}
                      <td className="px-4 py-3 font-mono tabular-nums font-bold text-xs" style={{ color: NAVY }}>
                        {fmt(rowTotal)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {roastRows.length > 0 && (
                <tfoot>
                  <tr style={{ background: NAVY }}>
                    <td className="px-4 py-3 text-xs font-bold text-white">الإجمالي</td>
                    {ROASTERY_CHANNELS.map(c => (
                      <td key={c.key} className="px-3 py-3 font-mono tabular-nums text-xs font-bold"
                        style={{ color: roastTotals[c.key] > 0 ? GOLD : 'rgba(255,255,255,0.3)' }}>
                        {roastTotals[c.key] > 0 ? fmt(roastTotals[c.key]) : '—'}
                      </td>
                    ))}
                    <td className="px-4 py-3 font-mono tabular-nums font-bold text-sm" style={{ color: GOLD }}>
                      {fmt(roastTotals.total)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </section>

    </div>
  )
}

// ── الصفحة الرئيسية ──────────────────────────────────────────────────────────
export default function Sales() {
  const { projectId, projectName } = useAuth()
  const isMahmasa = projectName === 'محمصة كون'

  const init = getRange('month')
  const [rows,         setRows]         = useState([])
  const [loading,      setLoading]      = useState(true)
  const [totals,       setTotals]       = useState({})
  const [filter,       setFilter]       = useState(init)
  const [activePeriod, setActivePeriod] = useState('month')

  useEffect(() => { if (projectId && !isMahmasa) load(projectId, init) }, [projectId])

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
    if (projectId && !isMahmasa) load(projectId, r)
  }

  function handleDate(field, val) {
    setActivePeriod('custom')
    const f = { ...filter, [field]: val }
    setFilter(f)
    if (projectId && !isMahmasa) load(projectId, f)
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

      {/* ── محمصة كون: عرض خاص ── */}
      {isMahmasa ? (
        <MahmasaView projectId={projectId} filter={filter} />
      ) : (
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
      )}
    </div>
  )
}
