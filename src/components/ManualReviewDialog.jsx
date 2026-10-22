import { useState } from 'react'
import { isLoanRepayment, LOAN_NOTE, LOAN_CONFIRMATION_LABEL, loanPrincipalConfirmation, hasLoanPrincipalConfirmation } from '../lib/loanRepayment.js'
import { Button, DateInput, Dialog, Field, Input, Money, Note, Select, Textarea } from '../ui/components.jsx'
import { MANUAL_CHANNELS, manualInvoice } from '../lib/manualReview.js'
import { toHalalas } from '../lib/approvalV2.js'
import { bankAccountLabel, chosenBankAccount, eligibleBankAccounts, expensesAtProjectLevel, needsBankAccount, salesChannelAccount, withSalesChannelAccount } from '../lib/branchSetup.js'

export default function ManualReviewDialog({ invoice, categories, setup, branch, supplierName, onClose, onConfirm }) {
  // حسابات المنشأة كما تمررها شاشة المستندات (bankAccounts)؛ كانت تُقرأ من banks فلا يظهر حقل الحساب في هذه النافذة (مراجعة 2026-10-20)
  const banks = setup?.bankAccounts || setup?.banks || []
  // supplierName: هوية المورد كما عُرضت عند فتح النافذة؛ ثابتة ولا تتبع تعديل الوصف (manualInvoice يرسلها اسمًا للمورد الآجل)
  const [fields, setFields] = useState(() => ({ ...invoice, totalAmount: invoice.totalAmount ?? invoice.amount ?? '',
    vatAmount: invoice.vatAmount ?? '', categoryId: '', subcategoryId: '', reason: '', confirmed: false, loanPrincipalConfirmation: null, supplierName }))
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const edit = (key, value) => { setFields(f => ({ ...f, [key]: value, confirmed: false,
    ...(['totalAmount', 'vatAmount'].includes(key) ? { loanPrincipalConfirmation: null } : {}) })); setError('') }
  const sales = invoice.type === 'sales', expense = invoice.type === 'expense'
  const loan = isLoanRepayment(invoice)
  const parents = categories.filter(c => !c.parent_id && c.is_active !== false)
  const children = categories.filter(c => c.parent_id === fields.categoryId && c.is_active !== false)
  const accountBranch = expense && expensesAtProjectLevel(setup?.settings) ? null : branch
  const accounts = eligibleBankAccounts(banks, accountBranch)
  const bankChannels = sales ? [['networkSales', 'network', 'الشبكة / مدى'], ['transferSales', 'transfer', 'التحويل']].filter(([k]) => Number(fields[k]) > 0) : []
  const bankNeeded = needsBankAccount(fields)
  const sum = MANUAL_CHANNELS.reduce((s, [k]) => s + (toHalalas(fields[k]) || 0), 0) / 100
  const pay = { cash: 'الصندوق', bank: 'البنك', custody: 'العهدة', credit: 'آجل — مورد من القائمة', payable: 'آجل — باسم المورد' }
  async function confirm() {
    if (sending) return
    let result
    try {
      let values = fields
      if (bankNeeded && banks.length) {
        if (sales) {
          values = { ...fields, bankAccounts: { ...fields.bankAccounts } }
          for (const [, channel, label] of bankChannels) {
            const id = chosenBankAccount(banks, accountBranch, salesChannelAccount(fields, channel))
            if (!id) throw new Error(`اختر الحساب البنكي لقناة ${label}.`)
            values.bankAccounts[channel] = id
          }
        } else {
          const id = chosenBankAccount(banks, accountBranch, fields.bankAccountId)
          if (!id) throw new Error('اختر الحساب البنكي الذي سيُسجَّل عليه المبلغ.')
          values = { ...fields, bankAccountId: id }
        }
      }
      result = manualInvoice(invoice, values, categories)
    } catch (e) { setError(e.message); return }
    setSending(true)
    try { await onConfirm(result); onClose() } catch (e) { setError(e.message); setSending(false) }
  }
  return <Dialog open title="اعتماد يدوي — إدارة تحسيب" onClose={sending ? () => {} : onClose}
    description="قرار الاعتماد لك بعد مراجعة الصورة. تُحفظ القراءة الأصلية وملاحظتك، ويُنسب الاعتماد إلى حسابك."
    footer={<><Button variant="quiet" disabled={sending} onClick={onClose}>رجوع دون تغيير</Button>
      <Button variant="primary" disabled={sending || !fields.confirmed || (loan && !hasLoanPrincipalConfirmation(fields))} onClick={confirm}>تأكيد واعتماد الأرقام اليدوية</Button></>}>
    <Note tone="warning" title="الأرقام أدناه هي التي ستُسجَّل">
      {sales ? 'أدخل صافي كل قناة بعد المرتجعات. الإجمالي المعتمد هو مجموع هذه القنوات بدل إجمالي القراءة، ولا تُخصم المرتجعات مرة ثانية.'
        : expense ? 'سيُسجَّل الإجمالي شامل الضريبة وبعد الخصم على تصنيف واحد تختاره هنا، بدل تفاصيل البنود المقروءة. لتوزيعه على عدة تصنيفات، ارجع وصحّح البنود من المستند.'
          : loan ? LOAN_NOTE : 'سيُسجَّل المبلغ الذي تؤكده بدل مبلغ القراءة.'}
    </Note>
    <fieldset disabled={sending} style={{ border: 0, padding: 0, margin: 0 }}>
      <div className="ts-form-grid">
        <Field label="الوصف المعتمد" span><Input value={fields.description || ''} onChange={e => edit('description', e.target.value)} /></Field>
        <Field label="التاريخ المعتمد"><DateInput value={fields.date || ''} onChange={v => edit('date', v)} /></Field>
        {sales ? MANUAL_CHANNELS.map(([key, label]) => <Field key={key} label={`صافي ${label}`}>
          <Input inputMode="decimal" dir="ltr" value={fields[key] ?? ''} onChange={e => edit(key, e.target.value)} />
        </Field>) : <>
          {loan && <Field label="القرض / القسط"><strong data-k="manual-loan-type">{invoice.transType || 'غير محدد — اختره في المستند'}</strong></Field>}
          <Field label={loan ? 'مبلغ سداد أصل القرض المعتمد' : 'الإجمالي المعتمد شامل الضريبة'}><Input inputMode="decimal" dir="ltr" value={fields.totalAmount} onChange={e => edit('totalAmount', e.target.value)} /></Field>
          <Field label="الضريبة ضمن الإجمالي"><Input inputMode="decimal" dir="ltr" value={fields.vatAmount} onChange={e => edit('vatAmount', e.target.value)} /></Field>
        </>}
        {expense && <>
          <Field label="تصنيف الإجمالي المعتمد"><Select value={fields.categoryId} placeholder="— اختر التصنيف بنفسك —"
            onChange={e => { setFields(f => ({ ...f, categoryId: e.target.value, subcategoryId: '', confirmed: false })); setError('') }}
            options={parents.map(c => ({ value: c.id, label: c.name }))} /></Field>
          <Field label="التصنيف الفرعي"><Select value={fields.subcategoryId} placeholder="— بدون فرعي —" onChange={e => edit('subcategoryId', e.target.value)}
            options={children.map(c => ({ value: c.id, label: c.name }))} /></Field>
        </>}
        {bankNeeded && !!banks.length && (sales ? bankChannels.map(([, channel, label]) =>
          <Field key={channel} label={`حساب ${label}`}><Select
            value={chosenBankAccount(banks, accountBranch, salesChannelAccount(fields, channel))}
            placeholder="— اختر الحساب —" options={accounts.map(a => ({ value: a.id, label: bankAccountLabel(a) }))}
            onChange={e => edit('bankAccounts', withSalesChannelAccount(fields, [channel], e.target.value))} /></Field>) :
          <Field label="الحساب البنكي المعتمد"><Select value={chosenBankAccount(banks, accountBranch, fields.bankAccountId)}
            placeholder="— اختر الحساب —" options={accounts.map(a => ({ value: a.id, label: bankAccountLabel(a) }))}
            onChange={e => edit('bankAccountId', e.target.value)} /></Field>)}
        <Field label="ملاحظة المراجعة اليدوية" span><Textarea rows={2} value={fields.reason} onChange={e => edit('reason', e.target.value)} placeholder="مثال: راجعت الصورة، والقراءة كررت تفاصيل الصنف." /></Field>
      </div>
      {sales ? <p>الإجمالي الذي سيُعتمد: <Money value={sum} /></p> : <p data-k="manual-pay">مصدر الدفع: {pay[invoice.paySource] || 'يُحدد في المستند'}{['credit', 'payable'].includes(invoice.paySource) ? <> — المورد: <strong>{supplierName || 'غير محدد'}</strong></> : null}. المورد ومصدر الدفع كما اخترتهما في الفاتورة؛ لتغييرهما ارجع إلى حقولها.</p>}
      {loan && <label className="ts-check"><input type="checkbox" data-k="manual-loan-principal-confirmed" checked={hasLoanPrincipalConfirmation(fields)}
        onChange={e => { const checked = e.target.checked; setFields(f => ({ ...f, loanPrincipalConfirmation: loanPrincipalConfirmation(f, checked), confirmed: false })) }} />
        {LOAN_CONFIRMATION_LABEL}
      </label>}
      <label className="ts-check"><input type="checkbox" data-k="manual-review-confirmed" checked={fields.confirmed} onChange={e => setFields(f => ({ ...f, confirmed: e.target.checked }))} />
        راجعت صورة المستند وأؤكد الأرقام والتصنيف ومصدر الدفع أعلاه، وأعتمدها بدل قراءة البرنامج.
      </label>
    </fieldset>
    {error && <Note tone="error">{error}</Note>}
  </Dialog>
}
