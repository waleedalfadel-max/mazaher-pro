import { useState } from 'react'
import { Button, Field, Input, Select, Note } from '../ui/components.jsx'
import { CHANNELS, CHANNEL_NAME, salesReviewRows, applySalesRows } from '../lib/salesReport.js'

const channels = CHANNELS.map(value => ({ value, label: CHANNEL_NAME[value] }))
const kinds = [{ value: 'payment', label: 'مبيعات' }, { value: 'return', label: 'مرتجع' }]

export default function SalesRowsEditor({ invoice, onApply }) {
  const [rows, setRows] = useState(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const edit = (i, key, value) => setRows(current => current.map((row, index) =>
    index === i ? { ...row, [key]: value } : row))
  function open() {
    setRows(salesReviewRows(invoice))
    setReason('')
    setError('')
  }
  function apply() {
    try {
      onApply(applySalesRows(invoice, rows, reason))
      setRows(null)
    } catch (e) { setError(e.message) }
  }
  if (!rows) return <Button size="sm" onClick={open}>مراجعة أسطر الإغلاق</Button>
  return <div className="rp-sales-lines">
    <p>طابق الأسطر مع الصورة. عند التطبيق تُحسب القنوات من هذه الأسطر ويُخصم كل مرتجع من قناته.</p>
    {rows.map((row, i) => <div className="ts-form-grid" key={i}>
      <Field label={`اسم السطر ${i + 1}`}><Input value={row.label} onChange={e => edit(i, 'label', e.target.value)} /></Field>
      <Field label="النوع"><Select value={row.kind} options={kinds} onChange={e => edit(i, 'kind', e.target.value)} /></Field>
      <Field label="القناة"><Select value={row.channel} options={channels} placeholder="اختر القناة" onChange={e => edit(i, 'channel', e.target.value)} /></Field>
      <Field label="المبلغ المطبوع"><Input dir="ltr" inputMode="decimal" value={row.amount} onChange={e => edit(i, 'amount', e.target.value)} /></Field>
      <Button size="sm" onClick={() => setRows(rows.filter((_, index) => i !== index))}>حذف السطر {i + 1}</Button>
    </div>)}
    <Button size="sm" onClick={() => setRows([...rows, { label: '', kind: 'payment', channel: '', amount: '' }])}>إضافة سطر</Button>
    <Field label="سبب مراجعة الأسطر"><Input value={reason} onChange={e => setReason(e.target.value)} /></Field>
    {error && <Note tone="error">{error}</Note>}
    <Button size="sm" onClick={apply}>تطبيق الأسطر وحساب الصافي</Button>
    <Button size="sm" variant="quiet" onClick={() => setRows(null)}>إلغاء مراجعة الأسطر</Button>
  </div>
}
