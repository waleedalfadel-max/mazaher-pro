import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { ownerDashboard } from '../lib/ledger.js'
import { expenseReport } from '../lib/expenses.js'
import { fmt } from '../lib/money.js'
import { Card, Money, Notice, PageTitle, Stat, NAVY } from '../components/ui.jsx'
import PeriodFilter, { monthRange } from '../components/PeriodFilter.jsx'

// ألوان المجموعات بنفس أسلوب تقارير تحسيب
const DIRECT_COLOR = { bg: '#eff6ff', border: '#bfdbfe', color: '#1d4ed8', open: '#dbeafe' }
const GROUP_COLORS = [
  { bg: '#f0fdf4', border: '#bbf7d0', color: '#15803d' },
  { bg: '#faf5ff', border: '#e9d5ff', color: '#7e22ce' },
  { bg: '#fff7ed', border: '#fed7aa', color: '#c2410c' },
  { bg: '#fef2f2', border: '#fecaca', color: '#b91c1c' },
  { bg: '#f0f9ff', border: '#bae6fd', color: '#0369a1' },
  { bg: '#fefce8', border: '#fde68a', color: '#a16207' },
]

const pctOf = (value, sales) => (sales > 0 ? (value / sales) * 100 : 0)

function Arrow({ open, color, small }) {
  return (
    <span className={`${small ? 'text-xs' : 'text-sm font-bold'} transition-transform duration-200`}
      style={{ color, transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block', minWidth: '1rem', opacity: small ? 0.7 : 1 }}>▶</span>
  )
}

function GroupCard({ group, clr, sales, expanded, toggle }) {
  const open = expanded.has(group.key)
  const pct = pctOf(group.total, sales)
  return (
    <div className="rounded-2xl overflow-hidden shadow-sm" style={{ border: `1.5px solid ${clr.border}` }}>
      {/* المستوى 1 — المجموعة */}
      <button onClick={() => toggle(group.key)} aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 text-right" style={{ background: clr.bg }}>
        <Arrow open={open} color={clr.color} />
        <span className="flex-1 font-bold text-sm text-right" style={{ color: clr.color }}>{group.name}</span>
        <div className="text-left">
          <div className="font-bold num text-sm" style={{ color: clr.color }}>{fmt(group.total)}</div>
          {sales > 0 && <div className="text-[11px] opacity-60" style={{ color: clr.color }}>{pct.toFixed(1)}% من المبيعات</div>}
        </div>
        <div className="w-12 sm:w-20 shrink-0">
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.1)' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: clr.color }} />
          </div>
        </div>
      </button>

      {/* المستوى 2 — التصنيفات الفرعية */}
      {open && (
        <div className="border-t" style={{ borderColor: clr.border }}>
          {group.categories.map((cat, ci) => {
            const catOpen = expanded.has(cat.key)
            return (
              <div key={cat.key}>
                <button onClick={() => toggle(cat.key)} aria-expanded={catOpen}
                  className="w-full flex items-center gap-3 px-5 py-2.5 text-right"
                  style={{ background: catOpen ? (clr.open || clr.bg) : ci % 2 === 0 ? '#fff' : '#fafafa', borderBottom: `1px solid ${clr.border}` }}>
                  <Arrow open={catOpen} color={clr.color} small />
                  <span className="flex-1 text-sm font-medium text-right text-slate-700">📌 {cat.name}</span>
                  <span className="text-[11px] shrink-0" style={{ color: '#8FAAAA' }}>{cat.movements.length} حركة</span>
                  <span className="num text-sm font-semibold" style={{ color: clr.color }}>{fmt(cat.total)}</span>
                </button>

                {/* المستوى 3 — الحركات المؤرخة */}
                {catOpen && (
                  <div style={{ borderBottom: `1px solid ${clr.border}` }}>
                    {cat.movements.map((m, mi) => (
                      <Link key={m.key} to={`/documents/${m.docId}`} state={{ from: 'reports' }}
                        className="flex items-center gap-2 px-6 py-2 hover:underline"
                        style={{ background: mi % 2 === 0 ? '#fafafa' : '#f5f5f5', borderBottom: mi < cat.movements.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                        <span className="text-slate-300 text-xs">└</span>
                        <span className="num text-[11px] shrink-0" style={{ color: '#5A7A8A' }}>{m.date}</span>
                        <span className="flex-1 min-w-0 text-xs text-slate-600 truncate">
                          {m.desc}{m.payee ? ` — ${m.payee}` : ''}
                        </span>
                        <span className="text-left shrink-0">
                          <span className="num text-xs font-semibold block" style={{ color: clr.color }}>{fmt(m.amount)}</span>
                          {m.documentVat > 0 && <span className="num text-[10px] block" style={{ color: '#8FAAAA' }}>
                            ضريبة مورد {fmt(m.documentVat)} — {m.separatedVat > 0 ? 'مفصولة' : 'ضمن التكلفة'}
                          </span>}
                        </span>
                        <span className="text-[11px] font-bold shrink-0" style={{ color: '#4A9E97' }}>المستند ←</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Section({ title, subtitle, section, colorFor, sales, expanded, toggle }) {
  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div>
          <h2 className="text-sm font-extrabold" style={{ color: NAVY }}>{title}</h2>
          <div className="text-[11px]" style={{ color: '#8FAAAA' }}>{subtitle}</div>
        </div>
        <Money value={section.total} strong className="text-sm" />
      </div>
      {section.groups.length === 0
        ? <Card className="p-4 text-sm text-center" style={{ color: '#8FAAAA' }}>لا حركات معتمدة في هذه الفترة</Card>
        : <div className="space-y-2">
            {section.groups.map((g, i) => <GroupCard key={g.key} group={g} clr={colorFor(i)} sales={sales} expanded={expanded} toggle={toggle} />)}
          </div>}
    </div>
  )
}

export default function Reports() {
  const { state } = useStore()
  const [period, setPeriod] = useState(monthRange(0))
  const [expanded, setExpanded] = useState(() => new Set())
  const report = useMemo(() => expenseReport(state, period), [state, period])
  const d = useMemo(() => ownerDashboard(state, period), [state, period])

  const toggle = key => setExpanded(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  return (
    <div>
      <PageTitle title="التقارير" subtitle="من المستندات المعتمدة فقط — نفس مصدر لوحة المالك" />
      <Card className="p-3 mb-4"><PeriodFilter value={period} onChange={setPeriod} /></Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-3">
        <Stat label={d.taxActive ? 'المبيعات (قبل الضريبة)' : 'المبيعات'} value={d.salesNet} />
        <Stat label="المواد المباشرة" value={report.direct.total} />
        <Stat label="المصروفات التشغيلية" value={report.operating.total} />
        <Stat label="الربحية التقديرية" value={d.estimatedProfit} tone={d.estimatedProfit >= 0 ? 'good' : 'bad'} note="قبل تسويات المخزون وتكلفة الوصفات" />
      </div>
      <Notice tone="warning" className="mb-5">
        الربحية الحالية <b>تقديرية</b>: {d.taxActive ? 'المبيعات قبل الضريبة' : 'المبيعات'} ناقص المواد المباشرة والمصروفات التشغيلية، قبل تسويات المخزون وتكلفة الوصفات.
        {' '}{d.taxActive
          ? <>ضريبة المصروفات المفصولة (<Money value={report.vat} />) لا تدخل في التكلفة.</>
          : 'ضريبة المورد — إن وجدت — داخلة في تكلفة المصروف.'}
      </Notice>

      <Section title="المواد المباشرة" subtitle="مواد تدخل في المنتج" section={report.direct}
        colorFor={() => DIRECT_COLOR} sales={d.salesNet} expanded={expanded} toggle={toggle} />
      <Section title="المصروفات التشغيلية" subtitle="إيجار ورواتب وكهرباء وصيانة ونقل وغيرها" section={report.operating}
        colorFor={i => GROUP_COLORS[i % GROUP_COLORS.length]} sales={d.salesNet} expanded={expanded} toggle={toggle} />

      <Card className="p-4">
        <div className="flex items-center justify-between text-sm font-extrabold" style={{ color: NAVY }}>
          <span>{d.taxActive ? 'إجمالي المصروفات بعد فصل الضريبة' : 'إجمالي المصروفات'}</span><Money value={report.total} strong />
        </div>
        <div className="text-[11px] mt-2" style={{ color: '#8FAAAA' }}>
          كل إجمالي هو مجموع ما تحته من حركات. تصنيف المستندات المعتمدة ثابت كما كان وقت اعتمادها.
          {' '}<Link to="/settings" className="underline font-bold" style={{ color: '#4A9E97' }}>إدارة المجموعات والتصنيفات</Link>
        </div>
      </Card>
    </div>
  )
}
