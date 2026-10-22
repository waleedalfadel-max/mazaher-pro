import React from 'react'
import { Field, Input, Note, Select } from '../ui/components.jsx'
import { acceptAmount } from '../lib/amountInput.js'
import { LOAN_NOTE, LOAN_CONFIRMATION_LABEL, loanAmount, loanTypes, loanPrincipalConfirmation, hasLoanPrincipalConfirmation } from '../lib/loanRepayment.js'

export default function LoanRepaymentFields({ invoice, transTypes, onPatch, readOnly }) {
  const types = loanTypes(transTypes)
  // Clear on every edit, including changing away and back to the previously confirmed value.
  const edit = patch => onPatch({ ...patch, loanPrincipalConfirmation: null })
  return <div data-k="loan-repayment">
    <Note tone="info" title="سداد قرض / قسط">{LOAN_NOTE} يُسجَّل خروج المبلغ من مصدر الدفع المختار؛ لا يحسب هذا المسار المتبقي من القرض.</Note>
    {!types.length && <Note tone="warning">لا توجد أنواع قروض أو أقساط مسجلة لهذه المنشأة. حدّدها في إعدادات المنشأة أولًا.</Note>}
    <div className="ts-form-grid">
      <Field label="القرض / القسط">
        <Select data-k="loan-type" value={invoice.transType || ''} disabled={readOnly} placeholder="— اختر القرض المقصود —"
          options={types.map(t => ({ value: t, label: t }))} onChange={e => edit({ transType: e.target.value })} />
      </Field>
      <Field label="مبلغ سداد أصل القرض">
        <Input data-k="loan-amount" numeric dir="ltr" value={loanAmount(invoice)} disabled={readOnly} onChange={e => {
          const value = acceptAmount(e.target.value)
          if (value !== null) edit({ amount: value, totalAmount: value })
        }} />
      </Field>
      <Field label="ضريبة مقروءة للمراجعة" hint="سداد الأصل يُسجَّل بلا ضريبة. إن كانت هناك رسوم وضريبة، افصلها ثم صحح الحقل إلى صفر.">
        <Input data-k="loan-vat" numeric dir="ltr" value={invoice.vatAmount ?? 0} disabled={readOnly} onChange={e => {
          const value = acceptAmount(e.target.value)
          if (value !== null) edit({ vatAmount: value })
        }} />
      </Field>
    </div>
    <label className="ts-check"><input type="checkbox" data-k="loan-principal-confirmed" disabled={readOnly}
      checked={hasLoanPrincipalConfirmation(invoice)} onChange={e => onPatch({ loanPrincipalConfirmation: loanPrincipalConfirmation(invoice, e.target.checked) })} />
      {LOAN_CONFIRMATION_LABEL}
    </label>
  </div>
}
