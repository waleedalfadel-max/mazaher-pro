import React, { forwardRef, useMemo, useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { statement } from '../lib/ledger.js'
import { fmt } from '../lib/money.js'
import { downloadBlob } from '../lib/files.js'
import { elementToPdfBlob, safeFileName } from '../lib/pdf.js'
import { Button, Card, DEMO_LABEL, NAVY } from './ui.jsx'
import PeriodFilter, { ALL_TIME } from './PeriodFilter.jsx'

export default function Statement({ customer }) {
  const { state } = useStore()
  const [period, setPeriod] = useState(ALL_TIME)
  const sheetRef = useRef(null)
  const [renderSheet, setRenderSheet] = useState(false)
  const st = useMemo(() => statement(state, customer.id, period), [state, customer.id, period])

  async function exportPdf() {
    setRenderSheet(true)
    await new Promise(r => setTimeout(r, 120))
    try {
      const blob = await elementToPdfBlob(sheetRef.current)
      downloadBlob(blob, safeFileName(`كشف-حساب-${customer.name}-نموذج-تجريبي.pdf`))
    } finally {
      setRenderSheet(false)
    }
  }

  const periodLabel = period.from || period.to ? `من ${period.from || 'البداية'} إلى ${period.to || 'اليوم'}` : 'كل الفترات'
  const hasPrior = !!period.from

  return (
    <div>
      <Card className="p-3 mb-3 no-print"><PeriodFilter value={period} onChange={setPeriod} /></Card>
      <div className="flex flex-wrap gap-2 mb-3 no-print">
        <Button variant="navy" onClick={() => window.print()}>🖨️ طباعة / حفظ PDF</Button>
        <Button variant="secondary" onClick={exportPdf}>تنزيل PDF</Button>
      </div>

      <Card className="p-3 sm:p-5 print-area">
        <div dir="rtl" className="bg-white" style={{ color: NAVY }}>
          <div className="text-center text-sm font-extrabold rounded-xl px-3 py-2 mb-3" style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #F59E0B' }}>
            {DEMO_LABEL}
          </div>
          <div className="flex flex-wrap justify-between gap-2 mb-3">
            <div>
              <div className="text-lg font-extrabold">كشف حساب — {customer.name}</div>
              <div className="text-xs" style={{ color: '#5A7A8A' }}>{state.lab.name} — {periodLabel}</div>
            </div>
            <div className="text-left">
              <div className="text-xs" style={{ color: '#5A7A8A' }}>الرصيد الختامي</div>
              <div className="text-lg font-extrabold num">{fmt(st.closing)} ر.س</div>
            </div>
          </div>

          <div className="overflow-x-auto -mx-3 sm:mx-0 print-visible">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr style={{ background: NAVY, color: '#fff' }}>
                  <th className="px-2 py-2 text-right">التاريخ</th>
                  <th className="px-2 py-2 text-right">البيان</th>
                  <th className="px-2 py-2">مدين</th>
                  <th className="px-2 py-2">دائن</th>
                  <th className="px-2 py-2">الرصيد</th>
                </tr>
              </thead>
              <tbody>
                {hasPrior && (
                  <tr className="border-b border-border" style={{ background: '#F4F8F7' }}>
                    <td className="px-2 py-2 num text-right">{period.from}</td>
                    <td className="px-2 py-2 font-bold">رصيد سابق للفترة</td>
                    <td /><td />
                    <td className="px-2 py-2 text-center num font-bold">{fmt(st.prior)}</td>
                  </tr>
                )}
                {st.rows.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-6" style={{ color: '#8FAAAA' }}>لا حركات في هذه الفترة</td></tr>
                )}
                {st.rows.map(r => (
                  <tr key={r.key} className="border-b border-border">
                    <td className="px-2 py-2 num text-right whitespace-nowrap">{r.date}</td>
                    <td className="px-2 py-2">
                      {r.label}{r.ref ? <span className="num"> {r.ref}</span> : ''}
                      {r.kind === 'opening' && <div className="text-[11px]" style={{ color: '#92400E' }}>مستحق سابق — ليس مبيعات جديدة</div>}
                      {r.kind === 'credit' && <div className="text-[11px] text-emerald-700">{fmt(r.info)} ر.س من دفعات سابقة — لا يغيّر الرصيد</div>}
                    </td>
                    <td className="px-2 py-2 text-center num">{r.debit ? fmt(r.debit) : ''}</td>
                    <td className="px-2 py-2 text-center num">{r.credit ? fmt(r.credit) : ''}</td>
                    <td className="px-2 py-2 text-center num font-bold">{fmt(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-extrabold" style={{ background: '#EEF4F3' }}>
                  <td className="px-2 py-2" colSpan={2}>المجموع</td>
                  <td className="px-2 py-2 text-center num">{fmt(st.totalDebit)}</td>
                  <td className="px-2 py-2 text-center num">{fmt(st.totalCredit)}</td>
                  <td className="px-2 py-2 text-center num">{fmt(st.closing)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {st.closing < 0 && (
            <div className="text-xs mt-2 font-bold text-emerald-700">الرصيد بالسالب يعني رصيداً دائناً للعميل ({fmt(-st.closing)} ر.س)</div>
          )}
          <div className="text-[11px] mt-3 text-center" style={{ color: '#92400E' }}>{DEMO_LABEL}</div>
        </div>
      </Card>

      {renderSheet && (
        <div style={{ position: 'fixed', left: -10000, top: 0 }} aria-hidden="true">
          <StatementSheet ref={sheetRef} lab={state.lab} st={st} periodLabel={periodLabel} hasPrior={hasPrior} from={period.from} />
        </div>
      )}
    </div>
  )
}

const cell = { padding: '7px 8px', borderBottom: '1px solid #D4E8E6' }

const StatementSheet = forwardRef(function StatementSheet({ lab, st, periodLabel, hasPrior, from }, ref) {
  return (
    <div ref={ref} dir="rtl" style={{ width: 760, padding: 32, background: '#fff', color: NAVY, fontFamily: 'Cairo, sans-serif' }}>
      <div style={{ background: '#FEF3C7', color: '#92400E', border: '2px solid #F59E0B', borderRadius: 12, padding: '8px 14px', textAlign: 'center', fontWeight: 800, fontSize: 17, marginBottom: 18 }}>{DEMO_LABEL}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>كشف حساب — {st.customer.name}</div>
          <div style={{ fontSize: 13, color: '#5A7A8A' }}>{lab.name} — {periodLabel}</div>
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 12, color: '#5A7A8A' }}>الرصيد الختامي</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{fmt(st.closing)} ر.س</div>
        </div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: NAVY, color: '#fff' }}>
            {['التاريخ', 'البيان', 'مدين', 'دائن', 'الرصيد'].map((h, i) => <th key={h} style={{ ...cell, textAlign: i < 2 ? 'right' : 'center' }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {hasPrior && (
            <tr style={{ background: '#F4F8F7', fontWeight: 700 }}>
              <td style={cell}><span dir="ltr">{from}</span></td><td style={cell}>رصيد سابق للفترة</td><td style={cell} /><td style={cell} />
              <td style={{ ...cell, textAlign: 'center' }}>{fmt(st.prior)}</td>
            </tr>
          )}
          {st.rows.map(r => (
            <tr key={r.key}>
              <td style={cell}><span dir="ltr">{r.date}</span></td>
              <td style={cell}>{r.label}{r.ref ? ` ${r.ref}` : ''}{r.kind === 'opening' ? ' (ليس مبيعات)' : ''}{r.kind === 'credit' ? ` (${fmt(r.info)} ر.س من دفعات سابقة — لا يغيّر الرصيد)` : ''}</td>
              <td style={{ ...cell, textAlign: 'center' }}>{r.debit ? fmt(r.debit) : ''}</td>
              <td style={{ ...cell, textAlign: 'center' }}>{r.credit ? fmt(r.credit) : ''}</td>
              <td style={{ ...cell, textAlign: 'center', fontWeight: 700 }}>{fmt(r.balance)}</td>
            </tr>
          ))}
          <tr style={{ background: '#EEF4F3', fontWeight: 800 }}>
            <td style={cell} colSpan={2}>المجموع</td>
            <td style={{ ...cell, textAlign: 'center' }}>{fmt(st.totalDebit)}</td>
            <td style={{ ...cell, textAlign: 'center' }}>{fmt(st.totalCredit)}</td>
            <td style={{ ...cell, textAlign: 'center' }}>{fmt(st.closing)}</td>
          </tr>
        </tbody>
      </table>
      {st.closing < 0 && <div style={{ fontSize: 12, marginTop: 8, color: '#166534', fontWeight: 700 }}>الرصيد بالسالب يعني رصيداً دائناً للعميل</div>}
      <div style={{ marginTop: 24, fontSize: 12, color: '#92400E', textAlign: 'center', fontWeight: 700 }}>{DEMO_LABEL} — مستند توضيحي من نموذج تحسيب التجريبي</div>
    </div>
  )
})
