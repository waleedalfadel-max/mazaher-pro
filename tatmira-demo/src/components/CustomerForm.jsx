import React, { useEffect, useState } from 'react'
import { newId } from '../lib/ledger.js'
import { displayWhatsapp, normalizeWhatsapp } from '../lib/whatsapp.js'
import { useStore } from '../store.jsx'
import { Button, Field, Modal, Notice, TextInput } from './ui.jsx'

/** إضافة عميل أو تعديل اسمه ورقم واتسابه */
export default function CustomerForm({ open, customer, onClose, onSaved }) {
  const { dispatch } = useStore()
  const [name, setName] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [error, setError] = useState('')
  const [draftId, setDraftId] = useState('')

  useEffect(() => {
    if (!open) return
    setName(customer?.name || '')
    setWhatsapp(customer?.whatsapp ? displayWhatsapp(customer.whatsapp) : '')
    setError('')
    setDraftId(newId('cust'))
  }, [open, customer])

  const normalized = normalizeWhatsapp(whatsapp)

  function save() {
    const r = customer
      ? dispatch({ type: 'CUSTOMER_UPDATE', id: customer.id, name, whatsapp })
      : dispatch({ type: 'CUSTOMER_ADD', id: draftId, name, whatsapp })
    if (r.error) return setError(r.error)
    onSaved?.(customer?.id || draftId)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={customer ? 'تعديل بيانات العميل' : 'إضافة عميل'}
      footer={<>
        <Button variant="secondary" onClick={onClose}>إلغاء</Button>
        <Button onClick={save}>حفظ</Button>
      </>}>
      <div className="space-y-3">
        <Field label="اسم نقطة البيع">
          <TextInput value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="مثال: نقطة بيع 11" />
        </Field>
        <Field label="رقم الواتساب (اختياري)"
          hint={normalized ? <>سيُحفظ بصيغة <span className="num">{displayWhatsapp(normalized)}</span></> : 'مثال: 05xxxxxxxx — اتركه فارغاً إن لم يتوفر'}
          error={normalized === null ? 'رقم غير صحيح' : ''}>
          <TextInput value={whatsapp} onChange={e => setWhatsapp(e.target.value)} inputMode="tel" dir="ltr" className="text-left" placeholder="05xxxxxxxx" />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  )
}
