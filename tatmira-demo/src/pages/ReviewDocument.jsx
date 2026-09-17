import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useStore } from '../store.jsx'
import {
  DOC_KINDS, REVIEW_STATUS, duplicateInvoiceNumber, invalidInputs, newId, openItems, purchaseTotals, saleTotals, suggestAllocations,
} from '../lib/ledger.js'
import { moneyOrZero, toQuantity, vatFor } from '../lib/money.js'
import {
  Badge, Button, Card, Field, InvalidInputsNotice, Money, MoneyInput, Notice, QuantityInput, Select, TextInput, NAVY,
} from '../components/ui.jsx'
import FilePreview from '../components/FilePreview.jsx'

export default function ReviewDocument() {
  const { id } = useParams()
  const { state, dispatch } = useStore()
  const [result, setResult] = useState(null)
  const [needsDupConfirm, setNeedsDupConfirm] = useState(false)
  const [dupConfirmed, setDupConfirmed] = useState(false)

  useEffect(() => { setResult(null); setNeedsDupConfirm(false); setDupConfirmed(false) }, [id])

  const doc = state.documents.find(d => d.id === id)
  if (!doc) return <Card className="p-6 text-center">المستند غير موجود — <Link to="/documents" className="underline">العودة</Link></Card>

  const editable = doc.status === 'pending'
  const f = doc.fields
  const invalid = editable ? invalidInputs(doc.kind, f) : []
  const update = fields => {
    const r = dispatch({ type: 'DOC_UPDATE_FIELDS', id: doc.id, fields })
    if (r.error) setResult({ tone: 'error', text: r.error })
    else if (result?.tone === 'error') setResult(null)
  }

  function approve() {
    const r = dispatch({ type: 'DOC_APPROVE', id: doc.id, confirmDuplicate: dupConfirmed })
    if (r.code === 'DUPLICATE_NUMBER') { setNeedsDupConfirm(true); return setResult({ tone: 'warning', text: r.error }) }
    if (r.error) return setResult({ tone: 'error', text: r.error })
    if (r.code === 'ALREADY_APPROVED') return setResult({ tone: 'info', text: 'المستند معتمد مسبقاً — لم تُنشأ حركة جديدة' })
    setResult({ tone: 'success', text: 'اعتُمد المستند' })
  }

  function reject() {
    if (!confirm('رفض المستند؟ لن يدخل في أي رقم.')) return
    dispatch({ type: 'DOC_REJECT', id: doc.id })
    setResult({ tone: 'info', text: 'رُفض المستند' })
  }

  const approvedEntity = doc.kind === 'sale' ? state.invoices.find(i => i.docId === doc.id)
    : doc.kind === 'payment' ? state.payments.find(p => p.docId === doc.id)
    : state.purchases.find(p => p.docId === doc.id)

  return (
    <div>
      <Link to="/documents" className="text-sm font-bold" style={{ color: '#4A9E97' }}>→ المستندات</Link>
      <div className="flex flex-wrap items-center gap-2 mt-2 mb-3">
        <h1 className="text-xl font-extrabold" style={{ color: NAVY }}>{DOC_KINDS[doc.kind]}</h1>
        <Badge tone={doc.status}>{REVIEW_STATUS[doc.status]}</Badge>
      </div>

      {doc.sample && editable && (
        <Notice tone="warning" className="mb-3">
          <b>بيانات تجريبية</b> — لم يقرأ الذكاء الاصطناعي هذا الملف. القيم أدناه أمثلة ثابتة؛ طابقها مع المستند وعدّلها قبل الاعتماد.
        </Notice>
      )}

      <div className="grid lg:grid-cols-2 gap-3">
        <div className="lg:order-2"><FilePreview file={doc.file} compact /></div>

        <Card className="p-4 lg:order-1">
          {doc.kind === 'sale' && <SaleForm state={state} doc={doc} f={f} editable={editable} update={update} />}
          {doc.kind === 'payment' && <PaymentForm state={state} doc={doc} f={f} editable={editable} update={update} />}
          {doc.kind === 'purchase' && <PurchaseForm state={state} doc={doc} f={f} editable={editable} update={update} />}

          {result && <Notice tone={result.tone} className="mt-3">{result.text}</Notice>}

          {editable && needsDupConfirm && (
            <label className="flex items-start gap-2 mt-3 text-sm font-bold" style={{ color: '#92400E' }}>
              <input type="checkbox" className="mt-1 w-4 h-4" checked={dupConfirmed} onChange={e => setDupConfirmed(e.target.checked)} />
              تأكدت أنها فاتورة مختلفة رغم تكرار الرقم
            </label>
          )}

          {editable && invalid.length > 0 && <div className="mt-3"><InvalidInputsNotice fields={invalid} /></div>}

          {editable && (
            <div className="grid grid-cols-3 gap-2 mt-4">
              <Button variant="danger" onClick={reject}>رفض</Button>
              <Button className="col-span-2 !py-3" onClick={approve} disabled={invalid.length > 0 || (needsDupConfirm && !dupConfirmed)}>اعتماد</Button>
            </div>
          )}

          {doc.status === 'approved' && approvedEntity && (
            <Notice tone="success" className="mt-4">
              معتمد في <span className="num">{doc.reviewedAt?.slice(0, 10)}</span>.
              {' '}{doc.kind !== 'purchase' && <Link to={`/customers/${approvedEntity.customerId}`} className="underline font-bold">عرض حساب العميل</Link>}
            </Notice>
          )}
        </Card>
      </div>
    </div>
  )
}

function CustomerSelect({ state, value, onChange, disabled }) {
  const options = state.customers.filter(c => !c.archived || c.id === value)
  return (
    <Select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>
      <option value="">— اختر العميل —</option>
      {options.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </Select>
  )
}

function AccountSelect({ state, value, onChange, disabled }) {
  return (
    <Select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>
      <option value="">— اختر الحساب —</option>
      {state.accounts.filter(a => !a.archived || a.id === value).map(a => (
        <option key={a.id} value={a.id}>{a.kind === 'cash' ? '💵' : '🏦'} {a.name}</option>
      ))}
    </Select>
  )
}

function SaleForm({ state, doc, f, editable, update }) {
  const totals = saleTotals(f)
  const dup = editable ? duplicateInvoiceNumber(state, f.number, { excludeDocId: doc.id }) : null
  const autoVat = f.vatMode !== 'none' && f.vatAuto !== false

  function setLines(lines) {
    const patch = { lines }
    if (autoVat) patch.vat = vatFor(saleTotals({ ...f, lines }).net)
    update(patch)
  }
  const setLine = (i, p) => setLines(f.lines.map((l, j) => j === i ? { ...l, ...p } : l))

  return (
    <div className="space-y-3">
      <Field label="العميل"><CustomerSelect state={state} value={f.customerId} onChange={v => update({ customerId: v })} disabled={!editable} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="رقم الفاتورة">
          <TextInput value={f.number} onChange={e => update({ number: e.target.value })} disabled={!editable} dir="ltr" className="text-left" />
        </Field>
        <Field label="التاريخ">
          <TextInput type="date" value={f.date} onChange={e => update({ date: e.target.value })} disabled={!editable} />
        </Field>
      </div>
      {dup && (
        <Notice tone="warning">
          ⚠️ رقم الفاتورة مكرر: {dup.where === 'approved' ? 'توجد فاتورة معتمدة بنفس الرقم' : 'يوجد مستند آخر بانتظار المراجعة بنفس الرقم'}
        </Notice>
      )}

      <div>
        <div className="text-xs font-bold mb-1" style={{ color: '#5A7A8A' }}>البنود</div>
        <div className="space-y-2">
          {f.lines.map((l, i) => (
            <div key={l.id || i} className="rounded-xl border border-border p-2 bg-surface">
              <div className="flex gap-2">
                <TextInput value={l.desc} onChange={e => setLine(i, { desc: e.target.value })} disabled={!editable} placeholder="الوصف" />
                {editable && f.lines.length > 1 && (
                  <button onClick={() => setLines(f.lines.filter((_, j) => j !== i))} className="px-3 rounded-xl text-red-600 bg-white border border-border" aria-label="حذف البند">×</button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2 items-end">
                <Field label="الكمية">
                  <QuantityInput value={l.qty} onChange={v => setLine(i, { qty: v })} disabled={!editable} aria-label="الكمية" />
                </Field>
                <Field label="سعر الوحدة"><MoneyInput value={l.price} onChange={v => setLine(i, { price: v })} disabled={!editable} /></Field>
                <div className="text-xs pb-3 text-left" style={{ color: '#5A7A8A' }}><Money value={Math.round((toQuantity(l.qty ?? '') || 0) * moneyOrZero(l.price))} /></div>
              </div>
            </div>
          ))}
        </div>
        {editable && (
          <Button variant="secondary" className="mt-2 !py-1.5 !text-xs"
            onClick={() => setLines([...f.lines, { id: newId('line'), desc: '', qty: 1, price: 0 }])}>+ بند</Button>
        )}
      </div>

      <div className="rounded-xl border border-border p-3 space-y-2">
        <div className="flex gap-1.5">
          {[['standard', 'ضريبة 15%'], ['none', 'بلا ضريبة']].map(([mode, label]) => (
            <button key={mode} disabled={!editable}
              onClick={() => update(mode === 'none' ? { vatMode: 'none', vat: 0 } : { vatMode: 'standard', vatAuto: true, vat: vatFor(totals.net) })}
              className="flex-1 py-1.5 rounded-lg text-xs font-bold border"
              style={f.vatMode === mode ? { background: NAVY, color: '#fff', borderColor: NAVY } : { background: '#fff', color: NAVY, borderColor: '#D4E8E6' }}>
              {label}
            </button>
          ))}
        </div>
        <Row label="الصافي" value={totals.net} />
        {f.vatMode !== 'none' && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">الضريبة</span>
            <div className="w-36"><MoneyInput value={f.vat} onChange={v => update({ vat: v, vatAuto: false })} disabled={!editable} /></div>
          </div>
        )}
        <Row label="الإجمالي" value={totals.total} strong />
      </div>
    </div>
  )
}

function PaymentForm({ state, doc, f, editable, update }) {
  const items = f.customerId ? openItems(state, f.customerId) : []
  const allocations = f.allocations || []
  const allocOf = target => allocations.find(a => a.target === target)?.amount || 0
  const allocated = allocations.reduce((s, a) => s + moneyOrZero(a.amount), 0)
  const unallocated = moneyOrZero(f.amount) - allocated
  const approved = doc.status === 'approved' ? state.payments.find(p => p.docId === doc.id) : null

  const suggest = (customerId, amount) => suggestAllocations(state, customerId, amount)
  function setAlloc(target, amount) {
    const rest = allocations.filter(a => a.target !== target)
    const keep = typeof amount === 'string' || amount > 0 // النص غير الصالح يبقى ظاهراً حتى يُصحَّح
    update({ allocAuto: false, allocations: keep ? [...rest, { target, amount }] : rest })
  }

  return (
    <div className="space-y-3">
      <Notice tone="info">صورة الإيصال لا تثبت وصول المبلغ. اعتمد بعد التأكد من دخوله للحساب.</Notice>
      <Field label="العميل">
        <CustomerSelect state={state} value={f.customerId} disabled={!editable}
          onChange={v => update({ customerId: v, allocAuto: true, allocations: v ? suggest(v, moneyOrZero(f.amount)) : [] })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="المبلغ">
          <MoneyInput value={f.amount} disabled={!editable}
            onChange={v => update(typeof v === 'number' && f.allocAuto !== false && f.customerId ? { amount: v, allocations: suggest(f.customerId, v) } : { amount: v })} />
        </Field>
        <Field label="التاريخ"><TextInput type="date" value={f.date} onChange={e => update({ date: e.target.value })} disabled={!editable} /></Field>
      </div>
      <Field label="الحساب المستلم"><AccountSelect state={state} value={f.accountId} onChange={v => update({ accountId: v })} disabled={!editable} /></Field>
      <Field label="مرجع التحويل (اختياري)">
        <TextInput value={f.reference} onChange={e => update({ reference: e.target.value })} disabled={!editable} dir="ltr" className="text-left" />
      </Field>

      {editable && f.customerId && (
        <div className="rounded-xl border border-border p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-extrabold" style={{ color: NAVY }}>توزيع الدفعة</span>
            <Button variant="secondary" className="!py-1 !px-2.5 !text-xs" onClick={() => update({ allocAuto: true, allocations: suggest(f.customerId, moneyOrZero(f.amount)) })}>
              اقترح على الأقدم
            </Button>
          </div>
          {items.length === 0 && <div className="text-xs" style={{ color: '#8FAAAA' }}>لا فواتير مفتوحة لهذا العميل — المبلغ كله رصيد دائن</div>}
          <div className="space-y-2">
            {items.map(it => (
              <div key={it.target} className="grid grid-cols-5 gap-2 items-center">
                <div className="col-span-3 text-xs">
                  <div className="font-bold">{it.label}</div>
                  <div style={{ color: '#8FAAAA' }}><span className="num">{it.date}</span> — المتبقي <Money value={it.remaining} /></div>
                </div>
                <div className="col-span-2"><MoneyInput value={allocOf(it.target)} onChange={v => setAlloc(it.target, v)} /></div>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-2 border-t border-border space-y-1">
            <Row label="الموزع" value={allocated} />
            {unallocated >= 0
              ? <Row label="غير موزع (يبقى رصيداً دائناً للعميل)" value={unallocated} />
              : <div className="text-xs font-bold text-red-600">التوزيع أكبر من مبلغ الدفعة بـ <Money value={-unallocated} /></div>}
          </div>
        </div>
      )}

      {approved && (
        <div className="rounded-xl border border-border p-3 text-sm space-y-1">
          <div className="font-extrabold" style={{ color: NAVY }}>التوزيع المعتمد</div>
          {approved.allocations.map(a => (
            <Row key={a.target} label={a.target === 'opening' ? 'رصيد افتتاحي' : `فاتورة ${state.invoices.find(i => i.id === a.target)?.number}`} value={a.amount} />
          ))}
          {approved.unallocated > 0 && <Row label="رصيد دائن للعميل" value={approved.unallocated} />}
        </div>
      )}
    </div>
  )
}

const KIND_LABEL = { direct: 'مواد مباشرة', operating: 'مصروفات تشغيلية' }

function PurchaseForm({ state, doc, f, editable, update }) {
  const lines = f.lines || []
  const totals = purchaseTotals(f)
  const approved = doc.status === 'approved' ? state.purchases.find(p => p.docId === doc.id) : null
  const setLines = next => update({ lines: next })
  const setLine = (i, p) => setLines(lines.map((l, j) => j === i ? { ...l, ...p } : l))
  const kindOf = id => state.categories.find(c => c.id === id)?.kind

  const byKind = kind => lines.filter(l => kindOf(l.categoryId) === kind).reduce((s, l) => s + moneyOrZero(l.net), 0)

  return (
    <div className="space-y-3">
      <Notice tone="info">المشتريات في هذا النموذج مدفوعة مباشرة: الاعتماد يخصم الإجمالي من حساب الدفع. لكل بند تصنيفه.</Notice>
      <Field label="المورد"><TextInput value={f.supplier} onChange={e => update({ supplier: e.target.value })} disabled={!editable} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="رقم الفاتورة"><TextInput value={f.number} onChange={e => update({ number: e.target.value })} disabled={!editable} dir="ltr" className="text-left" /></Field>
        <Field label="التاريخ"><TextInput type="date" value={f.date} onChange={e => update({ date: e.target.value })} disabled={!editable} /></Field>
      </div>

      {!approved && (
        <div>
          <div className="text-xs font-bold mb-1" style={{ color: '#5A7A8A' }}>البنود</div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={l.id || i} className="rounded-xl border border-border p-2 bg-surface space-y-2">
                <div className="flex gap-2">
                  <TextInput value={l.desc} onChange={e => setLine(i, { desc: e.target.value })} disabled={!editable} placeholder="الوصف" />
                  {editable && lines.length > 1 && (
                    <button onClick={() => setLines(lines.filter((_, j) => j !== i))} className="px-3 rounded-xl text-red-600 bg-white border border-border" aria-label="حذف البند">×</button>
                  )}
                </div>
                <Select value={l.categoryId} onChange={e => setLine(i, { categoryId: e.target.value })} disabled={!editable} aria-label="تصنيف البند">
                  <option value="">— اختر التصنيف —</option>
                  {Object.entries(KIND_LABEL).map(([kind, label]) => (
                    <optgroup key={kind} label={label}>
                      {state.categories.filter(c => c.kind === kind && (!c.archived || c.id === l.categoryId)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </optgroup>
                  ))}
                </Select>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="قبل الضريبة"><MoneyInput value={l.net} onChange={v => setLine(i, { net: v })} disabled={!editable} /></Field>
                  <Field label="الضريبة"><MoneyInput value={l.vat} onChange={v => setLine(i, { vat: v })} disabled={!editable} /></Field>
                </div>
                {editable && (
                  <div className="flex gap-1.5">
                    <Button variant="secondary" className="!py-1 !px-2.5 !text-xs" onClick={() => setLine(i, { vat: vatFor(moneyOrZero(l.net)) })}>ضريبة 15%</Button>
                    <Button variant="secondary" className="!py-1 !px-2.5 !text-xs" onClick={() => setLine(i, { vat: 0 })}>بلا ضريبة</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {editable && (
            <Button variant="secondary" className="mt-2 !py-1.5 !text-xs"
              onClick={() => setLines([...lines, { id: newId('pline'), desc: '', categoryId: '', net: 0, vat: 0 }])}>+ بند</Button>
          )}
        </div>
      )}

      {approved && (
        <div className="rounded-xl border border-border p-3 text-sm space-y-2">
          <div className="font-extrabold" style={{ color: NAVY }}>البنود المعتمدة</div>
          <div className="text-[11px]" style={{ color: '#8FAAAA' }}>التصنيف ونوعه مثبّتان كما كانا وقت الاعتماد</div>
          {approved.lines.map((l, i) => (
            <div key={i} className="flex items-start justify-between gap-2">
              <div>
                <div>{l.desc}</div>
                <div className="text-[11px]" style={{ color: '#5A7A8A' }}>{l.categoryName} — {KIND_LABEL[l.categoryKind]}</div>
              </div>
              <div className="text-left"><Money value={l.net} /><div className="text-[11px]" style={{ color: '#8FAAAA' }}>ضريبة <Money value={l.vat} /></div></div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-border p-3 space-y-1">
        {!approved && <>
          <Row label="مواد مباشرة" value={byKind('direct')} />
          <Row label="مصروفات تشغيلية" value={byKind('operating')} />
        </>}
        <Row label="قبل الضريبة" value={approved ? approved.net : totals.net} />
        <Row label="الضريبة" value={approved ? approved.vat : totals.vat} />
        <Row label="الإجمالي" value={approved ? approved.total : totals.total} strong />
      </div>
      <Field label="حساب الدفع"><AccountSelect state={state} value={f.accountId} onChange={v => update({ accountId: v })} disabled={!editable} /></Field>
    </div>
  )
}

function Row({ label, value, strong }) {
  return (
    <div className={`flex items-center justify-between text-sm ${strong ? 'font-extrabold' : ''}`}>
      <span>{label}</span><Money value={value} strong={strong} />
    </div>
  )
}
