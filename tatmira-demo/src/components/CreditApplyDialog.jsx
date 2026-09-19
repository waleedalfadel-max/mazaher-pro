import React, { useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { availableCredit, invalidMessage, newId, openItems, suggestAllocations } from '../lib/ledger.js'
import { isValidMoneyField, moneyOrZero } from '../lib/money.js'
import { Button, InvalidInputsNotice, Modal, Money, MoneyInput, Notice, NAVY } from './ui.jsx'

/** تسوية فواتير العميل من رصيده الزائد — لا إيراد ولا تحصيل جديد */
export default function CreditApplyDialog({ open, customer, onClose, onDone }) {
  const { state, dispatch, busy } = useStore()
  const [allocations, setAllocations] = useState([])
  const [opId, setOpId] = useState('')
  const [error, setError] = useState('')

  const available = availableCredit(state, customer.id)
  const items = openItems(state, customer.id)

  // معرّف واحد لكل فتح للنافذة: الضغط المتكرر على «تأكيد» لا يكرر التسوية
  useEffect(() => {
    if (!open) return
    setOpId(newId('credit'))
    setAllocations(suggestAllocations(state, customer.id, availableCredit(state, customer.id)))
    setError('')
  }, [open, customer.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const allocOf = target => allocations.find(a => a.target === target)?.amount || 0
  const total = allocations.reduce((s, a) => s + moneyOrZero(a.amount), 0)
  const hasInvalid = allocations.some(a => !isValidMoneyField(a.amount))
  function setAlloc(target, amount) {
    const rest = allocations.filter(a => a.target !== target)
    const keep = typeof amount === 'string' || amount > 0 // النص غير الصالح يبقى حتى يُصحَّح
    setAllocations(keep ? [...rest, { target, amount }] : rest)
  }

  async function confirm() {
    if (hasInvalid) return setError(invalidMessage(['مبالغ التسوية']))
    const r = await dispatch({ type: 'CREDIT_APPLY', id: opId, customerId: customer.id, allocations })
    if (r.error) return setError(r.error)
    onDone?.(r.code === 'ALREADY_APPLIED' ? 'التسوية منفذة مسبقاً — لم تتكرر' : 'تمت التسوية من الرصيد المتاح')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="استخدام الرصيد المتاح"
      footer={<>
        <Button variant="secondary" onClick={onClose}>إلغاء</Button>
        <Button onClick={confirm} disabled={busy || hasInvalid || total <= 0 || total > available}>{busy ? 'جارٍ التنفيذ…' : 'تأكيد التسوية'}</Button>
      </>}>
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-xl p-3" style={{ background: '#F0FDF4' }}>
          <span className="text-sm font-bold text-emerald-800">الرصيد المتاح</span>
          <Money value={available} strong className="text-emerald-800" />
        </div>
        <Notice tone="info">
          تُستخدم مبالغ زائدة من دفعات سابقة لتسديد فواتير مفتوحة. لا يُسجَّل إيراد ولا تحصيل جديد، ولا يتغير النقد أو البنك.
        </Notice>

        {items.length === 0 && <div className="text-sm" style={{ color: '#8FAAAA' }}>لا فواتير مفتوحة لهذا العميل</div>}
        <div className="space-y-2">
          {items.map(it => (
            <div key={it.target} className="grid grid-cols-5 gap-2 items-center">
              <div className="col-span-3 text-xs">
                <div className="font-bold" style={{ color: NAVY }}>{it.label}</div>
                <div style={{ color: '#8FAAAA' }}><span className="num">{it.date}</span> — المتبقي <Money value={it.remaining} /></div>
              </div>
              <div className="col-span-2"><MoneyInput value={allocOf(it.target)} onChange={v => setAlloc(it.target, v)} aria-label={`تسوية ${it.label}`} /></div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between text-sm font-extrabold border-t border-border pt-2">
          <span>مجموع التسوية</span><Money value={total} strong />
        </div>
        {hasInvalid && <InvalidInputsNotice fields={['مبالغ التسوية']} />}
        {total > available && <Notice tone="error">المجموع أكبر من الرصيد المتاح</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  )
}
