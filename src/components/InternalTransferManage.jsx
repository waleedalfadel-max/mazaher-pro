import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { Button, DateInput, Dialog, Field, Input, Note, Textarea } from '../ui/components.jsx'
import InternalTransferFields from './InternalTransferFields.jsx'
import { INTERNAL_TRANSFER_TYPE } from '../lib/internalTransfer.js'

export default function InternalTransferManage({ entryId, action, accounts, settings, onClose, onSaved }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { let alive = true
    supabase.rpc('internal_transfer_manage', { p_entry: entryId }).then(r => {
      if (!alive) return
      if (r.error || !r.data?.ok) { setError('تعذّر تحميل طرفي التحويل. أغلق النافذة وحدّث الصفحة.'); return }
      setData({ ...r.data, type: 'transfer', transType: INTERNAL_TRANSFER_TYPE, internalTransfer: { from: r.data.from, to: r.data.to }, reason: '' })
    }).catch(() => alive && setError('تعذّر الاتصال لتحميل التحويل.'))
    return () => { alive = false }
  }, [entryId])
  const edit = (key, value) => setData(d => ({ ...d, [key]: value }))
  async function save() {
    if (busy || data?._dateInvalid || !data?.reason?.trim()) return
    setBusy(true); setError('')
    try {
      const r = await supabase.rpc('internal_transfer_manage', { p_entry: entryId, p_action: action, p_expected: data.version,
        p_data: { amount: data.amount, date: data.date, description: data.description, from: data.internalTransfer.from, to: data.internalTransfer.to, reason: data.reason } })
      if (r.error || !r.data?.ok) { setError(r.data?.code === 'stale' ? 'تغيّر التحويل. أغلق النافذة وحدّث الصفحة قبل تعديل جديد.' : 'لم يتم الإجراء. راجع المبلغ والتاريخ والحسابين وصلاحية الدخول.'); return }
      onSaved(); onClose()
    } catch { setError('تعذّر تأكيد الإجراء. حدّث الدفتر للتحقق قبل إعادة المحاولة.') } finally { setBusy(false) }
  }
  return <Dialog open title={action === 'delete' ? 'حذف التحويل الداخلي' : 'تعديل التحويل الداخلي'} onClose={busy ? () => {} : onClose}
    footer={<><Button disabled={!data?.reason?.trim() || data?._dateInvalid || busy} onClick={save}>{action === 'delete' ? 'حذف التحويل' : 'حفظ التحويل'}</Button><Button disabled={busy} onClick={onClose}>رجوع</Button></>}>
    {error && <Note tone="error">{error}</Note>}
    {!data ? <p>جارٍ تحميل التحويل…</p> : <fieldset disabled={busy} style={{ border: 0 }}>
      {action === 'delete' ? <Note>سيُحذف التحويل من الحسابين، ويعود المستند المرتبط به للمراجعة إن وُجد.</Note> : <div className="ts-form-grid">
        <Field label="مبلغ التحويل"><Input numeric value={data.amount} onChange={e => edit('amount', e.target.value)}/></Field>
        <Field label="تاريخ التحويل"><DateInput value={data.date} onChange={v => edit('date', v)} onValidityChange={ok => setData(d => d?._dateInvalid === !ok ? d : { ...d, _dateInvalid: !ok })}/></Field>
        <Field label="وصف التحويل"><Input value={data.description || ''} onChange={e => edit('description', e.target.value)}/></Field>
        <InternalTransferFields invoice={data} accounts={accounts} settings={settings} onEdit={edit}/>
      </div>}
      <Field label="سبب الإجراء"><Textarea value={data.reason} onChange={e => edit('reason', e.target.value)}/></Field>
    </fieldset>}
  </Dialog>
}
