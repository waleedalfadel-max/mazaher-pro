import React, { forwardRef } from 'react'
import { fmt } from '../lib/money.js'
import { DEMO_LABEL } from './ui.jsx'
import { taxEnabled, taxModeLabel } from '../lib/tax.js'

/** ملخص فاتورة للمشاركة اليدوية — يحمل دائماً «نموذج تجريبي — ليس فاتورة ضريبية» */
const InvoiceSheet = forwardRef(function InvoiceSheet({ lab, customer, invoice, demo = true }, ref) {
  const taxable = taxEnabled(invoice.taxProfile)
  const totals = taxable
    ? [['الصافي', invoice.net], ['الضريبة', invoice.vat], ['الإجمالي', invoice.total]]
    : [['الإجمالي', invoice.total]]
  return (
    <div ref={ref} dir="rtl" style={{ width: 720, padding: 32, background: '#fff', color: '#1B3A5C', position: 'relative', fontFamily: 'Cairo, sans-serif' }}>
      {demo && <div style={{ background: '#FEF3C7', color: '#92400E', border: '2px solid #F59E0B', borderRadius: 12, padding: '10px 14px', textAlign: 'center', fontWeight: 800, fontSize: 18, marginBottom: 20 }}>
        {DEMO_LABEL}
      </div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{lab.name}</div>
          {lab.city && <div style={{ fontSize: 13, color: '#5A7A8A' }}>{lab.city}</div>}
          {lab.phone && <div style={{ fontSize: 13, color: '#5A7A8A' }}>{lab.phone}</div>}
          {taxable && invoice.taxProfile?.vatNumber && <div style={{ fontSize: 13, color: '#5A7A8A' }}>الرقم الضريبي: <span dir="ltr">{invoice.taxProfile.vatNumber}</span></div>}
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>ملخص فاتورة بيع</div>
          <div style={{ fontSize: 13 }}>رقم: <span dir="ltr">{invoice.number}</span></div>
          <div style={{ fontSize: 13 }}>التاريخ: <span dir="ltr">{invoice.date}</span></div>
        </div>
      </div>
      <div style={{ fontSize: 14, marginBottom: 12 }}>العميل: <b>{customer.name}</b></div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#1B3A5C', color: '#fff' }}>
            <th style={{ padding: 8, textAlign: 'right' }}>البند</th>
            <th style={{ padding: 8 }}>الكمية</th>
            <th style={{ padding: 8 }}>{invoice.taxProfile?.mode === 'inclusive' ? 'السعر شامل الضريبة' : invoice.taxProfile?.mode === 'exclusive' ? 'السعر قبل الضريبة' : 'السعر'}</th>
            <th style={{ padding: 8 }}>المبلغ</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((l, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #D4E8E6' }}>
              <td style={{ padding: 8 }}>{l.desc}</td>
              <td style={{ padding: 8, textAlign: 'center' }}>{l.qty}</td>
              <td style={{ padding: 8, textAlign: 'center' }}>{fmt(l.price)}</td>
              <td style={{ padding: 8, textAlign: 'center' }}>{fmt(Math.round(l.qty * l.price))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 12, color: '#5A7A8A', marginTop: 10 }}>معالجة الضريبة: {taxModeLabel(invoice.taxProfile)}</div>
      <div style={{ marginTop: 16, marginRight: 'auto', width: 280, fontSize: 14 }}>
        {totals.map(([k, v], i) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: i === totals.length - 1 ? '2px solid #1B3A5C' : 'none', fontWeight: i === totals.length - 1 ? 800 : 400 }}>
            <span>{k}</span><span>{fmt(v)} ر.س</span>
          </div>
        ))}
      </div>
      {demo && <div style={{ marginTop: 28, fontSize: 12, color: '#92400E', textAlign: 'center', fontWeight: 700 }}>
        {DEMO_LABEL} — مستند توضيحي من نموذج تحسيب التجريبي
      </div>}
    </div>
  )
})

export default InvoiceSheet
