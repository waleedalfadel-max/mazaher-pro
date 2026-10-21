import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { Button, DateInput, Dialog, Field, Input, Note, Textarea } from '../ui/components.jsx'
import BankTransferFields from './BankTransferFields.jsx'
import { BANK_TRANSFER_TYPE } from '../lib/paymentWorkflow.js'

export default function BankTransferManage({ invoiceId, action, accounts, onClose, onSaved }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { let alive = true
    supabase.rpc('bank_transfer_manage', { p_invoice: invoiceId }).then(r => {
      if (!alive) return
      if (r.error || !r.data?.ok) { setError('تعذّر تحميل طرفي التحويل. أغلق النافذة وحدّث الصفحة.'); return }
      const { source: s, destination: t, version } = r.data
      setData({ version, type: 'transfer', transType: BANK_TRANSFER_TYPE, bankTransfer: { from: s.bank_account_id, to: t.bank_account_id }, amount: s.bank_out, date: s.date, description: s.description, reason: '' })
    }).catch(() => alive && setError('تعذّر الاتصال لتحميل التحويل.'))
    return () => { alive = false }
  }, [invoiceId])
  const edit = (key, value) => setData(d => ({ ...d, [key]: value }))
  async function save() {
    if (busy || !data?.reason?.trim()) return
    setBusy(true); setError('')
    try {
      const r = await supabase.rpc('bank_transfer_manage', { p_invoice: invoiceId, p_action: action, p_expected: data.version,
        p_data: { amount: data.amount, date: data.date, description: data.description, from: data.bankTransfer.from, to: data.bankTransfer.to, reason: data.reason } })
      if (r.error || !r.data?.ok) { setError(r.data?.code === 'stale' ? 'تغيّر التحويل. أغلق النافذة وحدّث الصفحة قبل تعديل جديد.' : 'لم يتم الإجراء. راجع المبلغ والتاريخ والحسابين وصلاحية الدخول.'); return }
      onSaved(); onClose()
    } catch { setError('تعذّر تأكيد الإجراء. حدّث الدفتر للتحقق قبل إعادة المحاولة.') } finally { setBusy(false) }
  }
  return <Dialog open title={action === 'delete' ? 'حذف التحويل بين الحسابين' : 'تعديل التحويل بين الحسابين'} onClose={busy ? () => {} : onClose}
    footer={<><Button disabled={!data?.reason?.trim() || busy} onClick={save}>{action === 'delete' ? 'تأكيد حذف الطرفين' : 'حفظ طرفي التحويل'}</Button><Button disabled={busy} onClick={onClose}>رجوع</Button></>}>
    {error && <Note tone="error">{error}</Note>}
    {!data ? <p>جارٍ تحميل التحويل…</p> : <fieldset disabled={busy} style={{ border: 0 }}>
      {action === 'delete' ? <Note>سيُحذف قيدا الخروج والدخول معًا، ويعود مستند التحويل للمراجعة بالبيانات التي اعتُمدت. يُحفظ سبب الحذف واسم منفذه.</Note> : <div className="ts-form-grid">
        <Field label="مبلغ التحويل"><Input numeric value={data.amount} onChange={e => edit('amount', e.target.value)}/></Field>
        <Field label="تاريخ التحويل"><DateInput value={data.date} onChange={v => edit('date', v)}/></Field>
        <Field label="وصف التحويل"><Input value={data.description || ''} onChange={e => edit('description', e.target.value)}/></Field>
        <BankTransferFields invoice={data} accounts={accounts} onEdit={edit}/>
      </div>}
      <Field label="سبب الإجراء"><Textarea value={data.reason} onChange={e => edit('reason', e.target.value)}/></Field>
    </fieldset>}
  </Dialog>
}
