import { Field, Select } from '../ui/components.jsx'
import { internalTransferAccounts, normalizeInternalTransfer } from '../lib/internalTransfer.js'

export default function InternalTransferFields({ invoice, accounts, settings, onEdit, bankOnly = false }) {
  const pair = normalizeInternalTransfer(invoice)?.internalTransfer || {}
  const options = internalTransferAccounts(accounts, settings).filter(a => !bankOnly || a.value.startsWith('bank:'))
  return <>
    {['from', 'to'].map(key => <Field key={key} label={key === 'from' ? 'تحويل من' : 'تحويل إلى'}
      error={pair[key] && !options.some(a => a.value === pair[key]) ? 'الحساب غير متاح؛ اختر من القائمة.' : undefined}>
      <Select value={pair[key] || ''} placeholder="— اختر الحساب —" data-k={`internal-transfer-${key}`}
        options={options.filter(a => key !== 'to' || a.value !== pair.from)}
        onChange={e => onEdit('internalTransfer', { ...pair, [key]: e.target.value, ...(key === 'from' && e.target.value === pair.to ? { to: '' } : {}) })}/>
    </Field>)}
  </>
}
