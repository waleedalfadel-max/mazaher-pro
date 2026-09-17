import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { ownerDashboard, customerSummary } from '../lib/ledger.js'
import { Card, Money, Notice, PageTitle, Stat, NAVY } from '../components/ui.jsx'
import PeriodFilter, { monthRange } from '../components/PeriodFilter.jsx'

export default function Dashboard() {
  const { state } = useStore()
  const [period, setPeriod] = useState(monthRange(0))
  const d = useMemo(() => ownerDashboard(state, period), [state, period])

  const topDue = useMemo(() => state.customers
    .map(c => ({ c, s: customerSummary(state, c.id, { to: period.to }) }))
    .filter(x => x.s.due > 0)
    .sort((a, b) => b.s.due - a.s.due)
    .slice(0, 5), [state, period.to])

  const untilLabel = period.to ? `حتى ${period.to}` : 'حتى اليوم'

  return (
    <div>
      <PageTitle title="لوحة المالك" subtitle="أرقام المستندات المعتمدة فقط" />

      <Card className="p-3 mb-4"><PeriodFilter value={period} onChange={setPeriod} /></Card>

      {d.pendingDocs > 0 && (
        <Link to="/documents" className="block mb-4">
          <Notice tone="warning">
            🔔 {d.pendingDocs} مستند بانتظار المراجعة — لا تدخل في الأرقام حتى تُعتمد
          </Notice>
        </Link>
      )}

      <h2 className="text-sm font-extrabold mb-2" style={{ color: NAVY }}>المبيعات والتحصيل</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-5">
        <Stat label="المبيعات (قبل الضريبة)" value={d.salesNet}
          note={`${d.invoicesCount} فاتورة${d.invoicesWithoutVat ? ` — منها ${d.invoicesWithoutVat} بلا ضريبة` : ''}`} />
        <Stat label="ضريبة المبيعات" value={d.salesVat} note="تُعرض منفصلة عن المبيعات" />
        <Stat label="المحصَّل" value={d.collected} tone="good" note={`${d.paymentsCount} دفعة معتمدة — ليست مبيعات جديدة`} />
        <Stat label="المتبقي لدى العملاء" value={d.due} tone={d.due > 0 ? 'bad' : undefined}
          note={`${untilLabel} — يشمل الأرصدة الافتتاحية التجريبية`} />
      </div>

      {d.credit > 0 && (
        <Notice tone="info" className="mb-5">
          أرصدة دائنة لعملاء (مبالغ زائدة عن فواتيرهم): <Money value={d.credit} strong />
        </Notice>
      )}

      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm font-extrabold" style={{ color: NAVY }}>المصروفات</h2>
        <Link to="/reports" className="text-xs font-bold underline" style={{ color: '#4A9E97' }}>التفاصيل في التقارير</Link>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3 mb-5">
        <Stat label="المواد المباشرة" value={d.direct} note="قبل الضريبة" />
        <Stat label="المصروفات التشغيلية" value={d.operating} note="قبل الضريبة" />
        <Stat label="ضريبة المصروفات" value={d.inputVat} />
      </div>

      <Card className="p-4 mb-5" style={{ borderColor: '#FCD34D' }}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-sm font-extrabold" style={{ color: NAVY }}>الربحية التقديرية</div>
            <div className="text-xs mt-0.5" style={{ color: '#92400E' }}>
              تقدير أولي وليس ربحاً نهائياً: المخزون وتكلفة الوصفات خارج هذه المرحلة
            </div>
          </div>
          <div className="text-xl" style={{ color: d.estimatedProfit >= 0 ? '#2D9B6F' : '#E05C5C' }}>
            <Money value={d.estimatedProfit} strong />
          </div>
        </div>
        <div className="text-xs mt-2 num text-right" style={{ color: '#8FAAAA', direction: 'rtl' }}>
          = المبيعات قبل الضريبة − المواد المباشرة − المصروفات التشغيلية
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-3">
        <Card className="p-4">
          <h2 className="text-sm font-extrabold mb-3" style={{ color: NAVY }}>حركة حسابات الاستلام والدفع</h2>
          <div className="space-y-2">
            {d.accounts.filter(a => !a.archived || a.inflow || a.outflow).map(a => (
              <div key={a.id} className="flex items-center justify-between text-sm">
                <span>{a.kind === 'cash' ? '💵' : '🏦'} {a.name}</span>
                <Money value={a.balance} strong />
              </div>
            ))}
          </div>
          <div className="text-[11px] mt-3" style={{ color: '#8FAAAA' }}>
            التحصيلات المعتمدة ناقص المصروفات المدفوعة {untilLabel}. لا تشمل أرصدة بنكية فعلية.
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-extrabold mb-3" style={{ color: NAVY }}>أعلى المستحقات</h2>
          {topDue.length === 0
            ? <div className="text-sm" style={{ color: '#8FAAAA' }}>لا مستحقات</div>
            : <div className="space-y-2">
                {topDue.map(({ c, s }) => (
                  <Link key={c.id} to={`/customers/${c.id}`} className="flex items-center justify-between text-sm hover:underline">
                    <span>{c.name}</span>
                    <Money value={s.due} strong className="text-red-600" />
                  </Link>
                ))}
              </div>}
        </Card>
      </div>
    </div>
  )
}
