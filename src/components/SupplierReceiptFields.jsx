import { useEffect, useMemo, useState } from 'react'
import { Link2, Info, ReceiptText } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Button, DateInput, Field, Input, Money, Note, Segment, Select, Status, Textarea } from '../ui/components.jsx'
import { bankAccountLabel, chosenBankAccount, eligibleBankAccounts } from '../lib/branchSetup.js'
import { paymentSplitCheck, balanceAfter, optionKey, paymentDocuments, possibleDuplicates, rankPayments, suggestSupplier, supplierOptions } from '../lib/supplierReceipts.js'
import { dupCandidate, money } from '../lib/approvalV2.js'

const MODES = [{ value: 'new', label: 'تسجيل دفعة جديدة' }, { value: 'link', label: 'ربط بدفعة مسجلة' }]
const SOURCES = [{ value: 'cash', label: 'الصندوق' }, { value: 'bank', label: 'البنك / تحويل' }]
const KIND_LABEL = { list: 'من القائمة', payable: 'آجل باسم المورد' }

/**
 * حقول إيصال «سداد مورد» في مراجعة المستند (فاتورة مفردة أو داخل صورة متعددة). المورد يختاره المراجع؛ القراءة تقترح.
 * الرصيد والدفعات من supplier_payment_context (قراءة فقط). الاعتماد نفسه من شاشة المستندات بالمسار المعتاد.
 */
export default function SupplierReceiptFields({ invoice, index = 0, documentId, suppliers, payableSuppliers, bankAccounts = [], onPatch, readOnly, onContext, serverDuplicate }) {
  const options = useMemo(() => supplierOptions(suppliers, payableSuppliers), [suppliers, payableSuppliers])
  const key = optionKey(invoice)
  const chosen = options.find(o => o.key === key) || null
  const suggestion = useMemo(() => {
    if (invoice.suggestedSupplier && options.some(o => o.kind === invoice.suggestedSupplier.kind && o.id === invoice.suggestedSupplier.id)) {
      return { status: 'exact', candidates: options.filter(o => o.kind === invoice.suggestedSupplier.kind && o.id === invoice.suggestedSupplier.id) }
    }
    return suggestSupplier(invoice.beneficiary, options)
  }, [invoice.beneficiary, invoice.suggestedSupplier, options])
  const [ctx, setCtx] = useState(null)
  const [ctxError, setCtxError] = useState('')

  useEffect(() => {
    let live = true
    setCtx(null); setCtxError(''); onContext?.(null)
    if (!chosen) return
    supabase.rpc('supplier_payment_context', { p_kind: chosen.kind, p_supplier: chosen.id, p_document: documentId || null })
      .then(({ data, error }) => {
        if (!live) return
        if (error || !data?.ok) setCtxError(error ? 'تعذّر تحميل رصيد المورد ودفعاته. أعد فتح المستند.' : 'المورد غير موجود في منشأتك.')
        else { setCtx(data); onContext?.(data) }   // الدفعات للشاشة: منع الاعتماد قبل حسم اشتباه التكرار
      })
    return () => { live = false }
  }, [chosen?.key, documentId])

  const mode = invoice.paymentMode === 'link' ? 'link' : 'new'
  const accounts = eligibleBankAccounts(bankAccounts, null)
  const bankValue = invoice.paySource === 'bank' && accounts.length ? chosenBankAccount(bankAccounts, null, invoice.bankAccountId) : ''
  const ranked = ctx ? rankPayments(ctx.payments, invoice) : []
  const dups = ctx && mode === 'new' ? possibleDuplicates(ctx.payments, invoice) : []
  const after = ctx ? balanceAfter(ctx.balance, invoice) : null
  const k = s => `${s}-${index}`
  const pick = o => onPatch({ supplierKind: o.kind, supplierId: o.id, linkJournal: null, newPaymentReason: '', linkReason: '' })
  const splitError = paymentSplitCheck(invoice).error
  const setPart = (index, patch) => onPatch({ paymentAllocations: invoice.paymentAllocations.map((p,i) => i === index ? { ...p, ...patch } : p) })
  const linkedTo = ranked.find(p => p.journal_number === invoice.linkJournal) || null

  return (
    <div className="rp-receipt" data-k={k('receipt')}>
      {invoice.paymentEvidence && <p className="ts-field-hint" data-k={k('receipt-evidence')}><ReceiptText className="ts-icon--sm" aria-hidden="true" /> ما دلّ على السداد في الإيصال: «{invoice.paymentEvidence}». تأكد أنه سداد لمورد، لا مصروف أو تحويل داخلي.</p>}
      <div className="ts-form-grid">
        <Field label="المستفيد كما قُرئ" hint="اسم المستلم في الإيصال؛ للمطابقة فقط.">
          <Input value={invoice.beneficiary || ''} disabled={readOnly} data-k={k('receipt-beneficiary')} onChange={e => onPatch({ beneficiary: e.target.value })} />
        </Field>
        <Field label="المورد" error={!chosen ? 'اختر المورد من موردي المنشأة.' : undefined}>
          <Select value={key} placeholder="— اختر المورد —" disabled={readOnly} data-k={k('receipt-supplier')}
            onChange={e => { const o = options.find(x => x.key === e.target.value); if (o) pick(o); else onPatch({ supplierKind: null, supplierId: null, linkJournal: null }) }}
            options={options.map(o => ({ value: o.key, label: `${o.name} — ${KIND_LABEL[o.kind]}` }))} />
        </Field>
      </div>
      {!chosen && !readOnly && (
        suggestion.candidates.length ? (
          <div className="rp-receipt-suggest" data-k={k('receipt-suggest')}>
            <span>{suggestion.status === 'exact' ? 'المورد المقترح من الإيصال:' : suggestion.status === 'fuzzy' ? 'يشبه اسم المستفيد:' : 'أكثر من مورد يشبه اسم المستفيد — اختر الصحيح:'}</span>
            {suggestion.candidates.map(o => (
              <Button key={o.key} size="sm" data-k={`${k('receipt-suggest')}-${o.key}`} onClick={() => pick(o)}>{o.name} <small>({KIND_LABEL[o.kind]})</small></Button>
            ))}
          </div>
        ) : invoice.beneficiary ? (
          <p className="ts-field-hint" data-k={k('receipt-nomatch')}>لا مورد في المنشأة يطابق «{invoice.beneficiary}». اختره من القائمة؛ لا يُنشأ مورد جديد من الإيصال (أضفه من «الموردين» إن لزم).</p>
        ) : null
      )}
      <div className="ts-form-grid">
        <Field label="مبلغ السداد"><Input numeric dir="ltr" value={invoice.amount ?? ''} disabled={readOnly} data-k={k('receipt-amount')} onChange={e => onPatch({ amount: e.target.value })} /></Field>
        <Field label="تاريخ السداد"><DateInput value={invoice.date || ''} disabled={readOnly} onChange={v => onPatch({ date: v })} /></Field>
        <Field label="مرجع العملية" hint="رقم الحوالة أو السند إن ظهر؛ لا يُعتمد مرتين للمورد نفسه.">
          <Input dir="ltr" value={invoice.reference || ''} disabled={readOnly} data-k={k('receipt-reference')} onChange={e => onPatch({ reference: e.target.value })} />
        </Field>
      </div>
      <Segment full label="طريقة الاعتماد" value={mode} onChange={v => !readOnly && onPatch(v === 'link' ? { paymentMode: 'link' } : { paymentMode: 'new', linkJournal: null })} options={MODES} />
      {mode === 'new' ? (<>
        <label className="ts-check">
          <input type="checkbox" checked={invoice.splitPayment === true} disabled={readOnly} data-k={k('receipt-split-toggle')}
            onChange={e => onPatch(e.target.checked ? { splitPayment: true, paymentAllocations: [{bankAccountId:invoice.bankAccountId || '',amount:''},{bankAccountId:'',amount:''}] } : { splitPayment:false, paymentAllocations:null })} />
          <span>تقسيم السداد على حسابين (اختياري)</span>
        </label>
        {invoice.splitPayment === true ? <div className="rp-payment-split" data-k={k('receipt-split')}>
          {(invoice.paymentAllocations || []).map((part,i) => <div className="ts-form-grid" key={i}>
            <Field label={`الحساب ${i + 1}`}><Select value={part.bankAccountId || ''} placeholder="— اختر الحساب —" disabled={readOnly}
              data-k={k(`receipt-split-bank-${i}`)} onChange={e => setPart(i,{bankAccountId:e.target.value})} options={accounts.map(a=>({value:a.id,label:bankAccountLabel(a)}))} /></Field>
            <Field label={`المبلغ من الحساب ${i + 1}`}><Input numeric dir="ltr" disabled={readOnly} value={part.amount ?? ''}
              data-k={k(`receipt-split-amount-${i}`)} onChange={e=>setPart(i,{amount:e.target.value})} /></Field>
          </div>)}
          {splitError ? <p className="ts-field-error" role="alert">{splitError}</p> : <p className="ts-field-hint">مجموع الجزأين يساوي مبلغ السداد. تُسجّل دفعة واحدة للمورد وخروج من كل حساب بمبلغه.</p>}
        </div> : <div className="ts-form-grid">
          <Field label="دُفع من" error={!['cash', 'bank'].includes(invoice.paySource) ? 'اختر الصندوق أو البنك.' : undefined}>
            <Select value={['cash', 'bank'].includes(invoice.paySource) ? invoice.paySource : ''} placeholder="— اختر —" disabled={readOnly} data-k={k('receipt-source')}
              onChange={e => onPatch({ paySource: e.target.value })} options={SOURCES} />
          </Field>
          {invoice.paySource === 'bank' && bankAccounts.length > 0 && (
            <Field label="الحساب البنكي" error={!accounts.length ? 'لا حساب بنكي نشط.' : !bankValue ? 'اختر الحساب الذي خرجت منه الدفعة.' : undefined}>
              <Select value={bankValue} placeholder="— اختر الحساب —" disabled={readOnly} data-k={k('receipt-bank')}
                onChange={e => onPatch({ bankAccountId: e.target.value })} options={accounts.map(a => ({ value: a.id, label: bankAccountLabel(a) }))} />
            </Field>
          )}
        </div>}
      </>) : (
        <div className="rp-receipt-link" data-k={k('receipt-payments')}>
          {!chosen ? <p className="ts-field-hint">اختر المورد لتظهر دفعاته المسجلة.</p>
            : !ctx ? <p className="ts-field-hint">{ctxError || 'جارٍ تحميل دفعات المورد…'}</p>
            : !ranked.length ? <p className="ts-field-hint">لا دفعات مسجلة لهذا المورد. سجّلها دفعة جديدة.</p>
            : (
              <ul className="sup-txns">
                {ranked.map(p => (
                  <li key={p.journal_number} data-journal={p.journal_number}>
                    <label className="ts-check">
                      <input type="radio" name={k('receipt-link')} disabled={readOnly} checked={invoice.linkJournal === p.journal_number}
                        onChange={() => onPatch({ linkJournal: p.journal_number })} />
                      <span className="ts-num">{p.journal_number}</span> · {p.date} · {p.allocations?.length > 1 ? 'حسابان' : p.source === 'bank' ? 'البنك' : 'الصندوق'}
                      {p.linked ? <Status tone="neutral">مرفق بها: {paymentDocuments(p).map(x => x.file_name).join('، ')}</Status> : p.likely ? <Status tone="warning">المبلغ نفسه وتاريخ قريب</Status> : null}
                    </label>
                    <Money value={Number(p.amount)} />
                  </li>
                ))}
              </ul>
            )}
          <p className="ts-field-hint">التشابه في المبلغ والتاريخ اقتراح لا يثبت أنها الدفعة نفسها: اختر الدفعة بنفسك. الربط لا يسجل أي مبلغ جديد.</p>
          {linkedTo?.linked && (
            <Field label="للدفعة مستند مرفق: إن كان هذا مستندًا آخر لها (مثل سند قبض المورد مع إشعار التحويل)، اكتب ذلك" span>
              <Textarea rows={2} value={invoice.linkReason || ''} disabled={readOnly} data-k={k('receipt-link-reason')} onChange={e => onPatch({ linkReason: e.target.value })}
                placeholder="مثال: سند قبض المورد لهذه الحوالة؛ إشعار التحويل مرفق سابقًا." />
            </Field>
          )}
        </div>
      )}
      {chosen && ctx && (
        <div className="rp-receipt-balance" data-k={k('receipt-balance')}>
          <span>المستحق لـ«{ctx.name}» قبل السداد: <Money value={Number(ctx.balance)} /></span>
          <span>{mode === 'link' ? 'بعده: بلا تغيير (الدفعة مسجلة سابقًا)' : <>بعده: <Money value={after ?? 0} /></>}</span>
          {mode === 'new' && after != null && after < 0 && <Status tone="danger">المبلغ أكبر من المستحق</Status>}
        </div>
      )}
      {dups.length > 0 && (
        <div data-k={k('receipt-duplicates')}><Note tone="warning" icon={Info} title="قد تكون هذه الدفعة مسجلة سابقًا">
          <ul>{dups.map(p => (
            <li key={p.journal_number}><span className="ts-num">{p.journal_number}</span> بتاريخ {p.date} بمبلغ {money(p.amount)}{p.linked ? ` — مرفق بها «${paymentDocuments(p).map(x => x.file_name).join('»، «')}»` : ''}
              {!readOnly && <> — <Button size="sm" variant="quiet" icon={Link2} data-k={`${k('receipt-link-to')}-${p.journal_number}`}
                onClick={() => onPatch({ paymentMode: 'link', linkJournal: p.journal_number })}>اربط الإيصال بها</Button></>}
            </li>))}</ul>
          <Field label="إن كانت دفعة أخرى فعلًا، اكتب السبب" span>
            <Textarea rows={2} value={invoice.newPaymentReason || ''} disabled={readOnly} data-k={k('receipt-new-reason')} onChange={e => onPatch({ newPaymentReason: e.target.value })}
              placeholder="مثال: دفعتان لفاتورتين مختلفتين في الأسبوع نفسه." />
          </Field>
        </Note></div>
      )}
      {serverDuplicate && (
        <div data-k={k('receipt-server-dup')}><Note tone="warning" icon={Info} title={serverDuplicate.in_batch ? 'إيصال مشابه في الصورة نفسها' : 'وجد الخادم عمليات مشابهة'}>
          <ul>{(serverDuplicate.candidates || []).map((c, i) => <li key={i}>{c.kind === 'batch' ? `فاتورة أخرى في هذه الصورة بتاريخ ${c.date} بمبلغ ${money(c.amount)}${c.same_reference ? ' وبالمرجع نفسه' : ''}` : dupCandidate(c)}</li>)}</ul>
          التشابه لا يثبت التكرار. {mode === 'link' ? 'إن كان هذا مستندًا آخر للدفعة نفسها فاكتب ذلك سببًا.' : 'إن كانت دفعة مختلفة فعلًا فاكتب السبب، أو اربط الإيصال بالدفعة إن كانت هي.'} وإن كانت نسخة مكررة فارفضها.
          {!(mode === 'new' && dups.length > 0) && !(mode === 'link' && linkedTo?.linked) && (
            <Field label={mode === 'link' ? 'سبب إرفاق هذا المستند بالدفعة' : 'سبب أنها دفعة أخرى'} span>
              <Textarea rows={2} disabled={readOnly} data-k={k('receipt-server-reason')} value={(mode === 'link' ? invoice.linkReason : invoice.newPaymentReason) || ''}
                onChange={e => onPatch(mode === 'link' ? { linkReason: e.target.value } : { newPaymentReason: e.target.value })} />
            </Field>
          )}
        </Note></div>
      )}
      {ctx?.pending_receipts?.length > 0 && (
        <div data-k={k('receipt-pending-others')}><Note tone="info" title="إيصالات أخرى لهذا المورد بانتظار الاعتماد">
          {ctx.pending_receipts.map(r => <div key={`${r.document_id}-${r.invoice_id}`}>«{r.file_name}»{r.amount ? <> بمبلغ {money(r.amount)}</> : null}{r.date ? <> بتاريخ {r.date}</> : null}</div>)}
          تأكد أنها ليست الدفعة نفسها قبل الاعتماد.
        </Note></div>
      )}
    </div>
  )
}
