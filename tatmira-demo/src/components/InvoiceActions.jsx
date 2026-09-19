import React, { useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { getFile, downloadBlob } from '../lib/files.js'
import { elementToPdfBlob, safeFileName } from '../lib/pdf.js'
import { displayWhatsapp, invoiceMessage, normalizeWhatsapp, whatsappUrl } from '../lib/whatsapp.js'
import { Button, Field, Modal, Notice, TextInput } from './ui.jsx'
import InvoiceSheet from './InvoiceSheet.jsx'
import { can } from '../lib/permissions.js'

export default function InvoiceActions({ invoice, customer }) {
  const { state, dispatch, remote, fetchFile, actor } = useStore()
  const sheetRef = useRef(null)
  const [waOpen, setWaOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [opened, setOpened] = useState(false)
  const [error, setError] = useState('')
  const [renderSheet, setRenderSheet] = useState(false)

  const doc = state.documents.find(d => d.id === invoice.docId)
  const normalized = normalizeWhatsapp(phone)
  const message = invoiceMessage({ labName: state.lab.name, customerName: customer.name, invoice })

  function openDialog() {
    setPhone(customer.whatsapp ? displayWhatsapp(customer.whatsapp) : '')
    setOpened(false)
    setError('')
    setWaOpen(true)
  }

  async function openWhatsapp() {
    if (!normalized) return setError('راجع رقم الواتساب قبل المتابعة')
    if (normalized !== customer.whatsapp && can(actor, 'manageCustomers')) {
      const r = await dispatch({ type: 'CUSTOMER_UPDATE', id: customer.id, whatsapp: normalized })
      if (r.error) return setError(r.error)
    }
    window.open(whatsappUrl(normalized, message), '_blank', 'noopener')
    setOpened(true) // فُتح واتساب فقط — الإرسال يتم يدوياً من المستخدم
  }

  async function downloadOriginal() {
    const blob = remote ? (doc ? await fetchFile(doc.id) : null) : (doc?.file?.id ? await getFile(doc.file.id) : null)
    if (!blob) return alert('الملف الأصلي غير متاح')
    downloadBlob(blob, doc.file.name)
  }

  async function downloadSummary() {
    setRenderSheet(true)
    await new Promise(r => setTimeout(r, 120))
    try {
      const blob = await elementToPdfBlob(sheetRef.current)
      downloadBlob(blob, safeFileName(`ملخص-فاتورة-${invoice.number}${remote ? '' : '-نموذج-تجريبي'}.pdf`))
    } finally {
      setRenderSheet(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="whatsapp" className="!px-3 !py-1.5 !text-xs" onClick={openDialog}>واتساب</Button>
        <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={downloadSummary}>ملخص PDF</Button>
        <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={downloadOriginal}>المستند الأصلي</Button>
      </div>

      {renderSheet && (
        <div style={{ position: 'fixed', left: -10000, top: 0 }} aria-hidden="true">
          <InvoiceSheet ref={sheetRef} lab={state.lab} customer={customer} invoice={invoice} demo={!remote} />
        </div>
      )}

      <Modal open={waOpen} onClose={() => setWaOpen(false)} title={`واتساب — ${customer.name}`}
        footer={<>
          <Button variant="secondary" onClick={() => setWaOpen(false)}>إغلاق</Button>
          <Button variant="whatsapp" onClick={openWhatsapp} disabled={!normalized}>فتح واتساب</Button>
        </>}>
        <div className="space-y-3">
          <Field label="راجع رقم الواتساب قبل الفتح"
            hint={normalized ? <>سيُفتح على <span className="num">{displayWhatsapp(normalized)}</span></> : ''}
            error={normalized === null ? 'رقم غير صحيح' : (normalized === '' ? 'لا يوجد رقم — أدخله أولاً' : '')}>
            <TextInput value={phone} onChange={e => { setPhone(e.target.value); setOpened(false) }} inputMode="tel" dir="ltr" className="text-left" placeholder="05xxxxxxxx" />
          </Field>
          <div>
            <div className="text-xs font-bold mb-1" style={{ color: '#5A7A8A' }}>نص الرسالة</div>
            <pre className="whitespace-pre-wrap text-sm bg-surface rounded-xl p-3 border border-border">{message}</pre>
          </div>
          <Notice tone="info">
            الرسالة لا تُرسَل تلقائياً. يفتح واتساب بالنص جاهزاً، وتضغط أنت «إرسال». لإرفاق المستند نزّله أولاً ثم أرفقه يدوياً.
          </Notice>
          {opened && <Notice tone="success">فُتح واتساب — أكمل الإرسال من التطبيق. لم يُسجَّل أي إرسال.</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      </Modal>
    </>
  )
}
