import { useEffect, useRef } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button, Money, Note } from '../ui/components.jsx'

/** The figures and confirmation come from the server's locked balance check, never from OCR. */
export default function SupplierOverpaymentNotice({ error, busy, onConfirm, onCancel }) {
  const notice = useRef(null)
  useEffect(() => { notice.current?.focus() }, [error])
  if (error?.code !== 'supplier_overpayment_confirmation') return null
  return <div ref={notice} tabIndex={-1} role="alert" data-k="supplier-overpayment-notice"><Note tone="warning" icon={CircleAlert}
    title="مبلغ السداد أعلى من المستحق للمورد"
    facts={[
      { label: 'المورد', value: error.name },
      { label: 'الرصيد قبل السداد', value: <Money value={error.balance} /> },
      { label: 'مبلغ السداد', value: <Money value={error.amount} /> },
      { label: 'الزيادة على المستحق', value: <Money value={error.excess} /> },
      { label: 'رصيد المورد بعد السداد', value: <Money value={error.after} /> },
    ]}
    action={<div className="rp-note-actions">
      <Button variant="primary" disabled={busy || !onConfirm} data-k="supplier-overpayment-confirm" onClick={onConfirm}>أوافق على الزيادة وأعتمد</Button>
      <Button variant="quiet" disabled={busy} onClick={onCancel}>رجوع للمراجعة</Button>
    </div>}>
    يصبح رصيد المورد بالسالب؛ أي <Money value={Math.abs(error.after)} /> لصالح المنشأة لدى المورد.
    لم يُسجّل السداد بعد. تأكد من المبلغ والمورد ثم وافق للاعتماد.
  </Note></div>
}
