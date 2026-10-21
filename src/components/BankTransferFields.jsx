import { Field, Select, Note } from '../ui/components.jsx'
import { bankAccountLabel, eligibleBankAccounts } from '../lib/branchSetup.js'
import { bankOperationalNote, paymentWorkflow } from '../lib/paymentWorkflow.js'

export default function BankTransferFields({ invoice, accounts, settings, onEdit }) {
  const list = eligibleBankAccounts(accounts, null)
  const pair = invoice.bankTransfer || {}
  const opts = list.map(a => ({ value: a.id, label: bankAccountLabel(a) }))
  const note = bankOperationalNote(settings, pair.from)
  return <>
    <Field label="من الحساب البنكي"><Select data-k="bank-transfer-from" value={pair.from || ''} placeholder="— اختر حساب الخروج —" options={opts}
      onChange={e => { const from = e.target.value; const proposed = paymentWorkflow(settings)?.accounts?.[from]?.transfer_to
        const to = pair.to && pair.to !== from ? pair.to : list.some(a => a.id === proposed && a.id !== from) ? proposed : ''
        onEdit('bankTransfer', { from, to }) }} /></Field>
    <Field label="إلى الحساب البنكي"><Select data-k="bank-transfer-to" value={pair.to || ''} placeholder="— اختر حساب الدخول —" options={opts.filter(a => a.value !== pair.from)}
      onChange={e => onEdit('bankTransfer', { ...pair, to: e.target.value })} /></Field>
    <Note>{note ? `${note} ` : ''}يُخصم المبلغ من حساب الخروج ويضاف إلى حساب الدخول في عملية واحدة. التحويل ليس مبيعات ولا مصروفًا؛ راجع الحسابين مع إيصال التحويل.</Note>
  </>
}
