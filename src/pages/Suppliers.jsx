import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Info, Plus, RefreshCw, Store, Wallet } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { fetchEveryRow } from '../lib/fetchAll.js'
import { Button, DateInput, Dialog, EmptyState, Field, Input, Panel, Select, Status } from '../ui/components.jsx'
import { formatDate, formatNumber, parseAmount } from '../ui/format.js'

// تحديث 20261010130000: الدفعة بدالة خادم واحدة (supplier_payment_record) تخفض الالتزام ولا تُحتسب تكلفة ثانية، وقسم لموردي «آجل — باسم المورد».
// الموردون بالهوية الجديدة. الحسابات والعمليات كما كانت حرفيًا: الموردون النشطون بالاسم، ورصيد كل مورد = الرصيد الافتتاحي + فواتيره
// − دفعاته (من supplier_transactions)، وإجمالي المستحقات = مجموع الأرصدة الموجبة؛ وتسجيل دفعة = رقم قيد من العدّاد ثم حركة «دفعة» للمورد
// ثم قيد «🏪 سداد مورد» في الدفتر من البنك أو الصندوق؛ وإضافة مورد بالحقول نفسها. الصلاحيات من المسار كما هي.
// التغيير: الموردون وحركاتهم تُحمَّل كاملة بترتيب ثابت (src/lib/fetchAll.js) بدل طلب واحد بحد الخادم وبلا فحص خطأ، وفشل أي جزء رسالة
// بإعادة محاولة بلا أرصدة ناقصة؛ وأي فشل في الدفعة أو الإضافة يظهر في الحوار (كان يُتجاهل)؛ والمبلغ يُقرأ بدقة أو يُرفض.
// المقارنة قبل وبعد: local-test/suppliers-loans-figures.mjs؛ العمليات والفشل: local-test/suppliers-loans-ui.mjs.

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const fmt = v => formatNumber(Number(v || 0), 2)
const reason = error => (/failed to fetch|network|load failed/i.test(error?.message || '') ? 'تعذّر الاتصال بالخادم؛ تحقق من الاتصال ثم أعد المحاولة.' : (error?.message || 'خطأ غير معروف'))
const PAY_SOURCES = [{ value: 'bank', label: 'البنك / تحويل' }, { value: 'cash', label: 'الصندوق' }]
const blankPay = () => ({ amount: '', date: todayStr(), notes: '', paySource: 'bank' })
const blankNew = () => ({ name: '', phone: '', opening_balance: '', notes: '' })
const PAY_MESSAGES = {
  no_session: 'انتهت الجلسة. سجّل الدخول من جديد.', forbidden: 'تسجيل الدفعات للمحاسب فقط.', project_inactive: 'المنشأة موقوفة.',
  amount_invalid: 'مبلغ غير صالح؛ اكتب رقمًا أكبر من صفر بمنزلتين على الأكثر.', date_required: 'أدخل تاريخًا صحيحًا.', source_invalid: 'اختر مصدر الدفع.',
  not_found: 'المورد غير موجود في منشأتك. حدّث الصفحة.', exceeds_balance: 'المبلغ أكبر من المستحق لهذا المورد.', bad_request: 'طلب غير صالح. حدّث الصفحة.',
  // R4-01: الطلب نفسه بعد حذف دفعته (من «سجل الدفتر») لا يعيد تسجيلها؛ التسجيل من جديد قرار جديد بحوار جديد
  payment_deleted: 'هذه الدفعة سُجّلت ثم حُذفت من «سجل الدفتر»، فلم تُسجَّل مرة أخرى. إن أردت تسجيلها فأغلق هذا الحوار وافتح «تسجيل دفعة» من جديد.',
}

export default function Suppliers() {
  const { projectId } = useAuth()
  const [suppliers, setSuppliers]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [loadError, setLoadError]   = useState('')
  const [selected, setSelected]     = useState(null)
  const [txns, setTxns]             = useState([])
  const [txnLoading, setTxnLoading] = useState(false)
  const [txnError, setTxnError]     = useState('')
  const [payModal, setPayModal]     = useState(null)
  const [addModal, setAddModal]     = useState(false)
  const [saving, setSaving]         = useState(false)
  const [formError, setFormError]   = useState('')
  const [payDateValid, setPayDateValid] = useState(true)
  const [paymentIncomplete, setPaymentIncomplete] = useState(false)
  const [payForm, setPayForm]       = useState(blankPay())
  const [newForm, setNewForm]       = useState(blankNew())
  const loadSeq = useRef(0), txnSeq = useRef(0)
  const savingRef = useRef(false)
  const payRequest = useRef(null)
  const [payables, setPayables] = useState([])   // موردو «آجل — باسم المورد»: الرصيد من قيود الدفتر (الالتزام − السداد)

  useEffect(() => { if (projectId) loadSuppliers() }, [projectId])

  // الموردون النشطون ثم كل حركاتهم كاملتين؛ الرصيد من الحركات كلها. أي فشل ← رسالة بلا موردين ولا أرصدة.
  async function loadSuppliers() {
    const seq = ++loadSeq.current
    setLoading(true); setLoadError('')
    const list = await fetchEveryRow(() => supabase.from('suppliers')
      .select('id,name,phone,opening_balance,notes')
      .eq('project_id', projectId).eq('is_active', true)
      .order('name').order('id'))
    const ts = list.error ? null : await fetchEveryRow(() => supabase.from('supplier_transactions')
      .select('supplier_id,type,amount')
      .eq('project_id', projectId)
      .order('id'))
    const ps = list.error || ts?.error ? null : await fetchEveryRow(() => supabase.from('payable_suppliers').select('id,name').eq('project_id', projectId).order('name').order('id'))
    const pl = !ps || ps.error ? null : await fetchEveryRow(() => supabase.from('ledger_entries').select('supplier_id,payable_in,payable_out')
      .eq('project_id', projectId).not('supplier_id', 'is', null).in('status', ['approved', 'auto']).order('id'))
    if (seq !== loadSeq.current) return
    const failed = list.error || ts?.error || ps?.error || pl?.error
    if (failed) { setSuppliers([]); setPayables([]); setLoadError(`${list.error ? 'الموردون' : ts?.error ? 'حركات الموردين' : 'موردو الآجل باسم المورد'}: ${reason(failed)}`); setLoading(false); return }
    const owed = {}
    pl.data.forEach(e => { owed[e.supplier_id] = (owed[e.supplier_id] || 0) + Math.round((Number(e.payable_in) || 0) * 100) - Math.round((Number(e.payable_out) || 0) * 100) })
    setPayables(ps.data.map(p => ({ ...p, kind: 'payable', balance: (owed[p.id] || 0) / 100 })).filter(p => owed[p.id]))
    const bySupplier = {}
    ts.data.forEach(t => { (bySupplier[t.supplier_id] ||= []).push(t) })
    const withBalance = list.data.map(s => {
      const own      = bySupplier[s.id] || []
      const invoices = own.filter(t => t.type === 'invoice').reduce((sum, t) => sum + Number(t.amount || 0), 0)
      const payments = own.filter(t => t.type === 'payment').reduce((sum, t) => sum + Number(t.amount || 0), 0)
      const balance  = Number(s.opening_balance || 0) + invoices - payments
      return { ...s, balance, invoices, payments }
    })
    setSuppliers(withBalance)
    setLoading(false)
  }

  // حركات المورد المختار كاملة، الأحدث أولًا بترتيب ثابت
  async function loadTxns(supplierId) {
    const seq = ++txnSeq.current
    setTxnLoading(true); setTxnError('')
    const res = await fetchEveryRow(() => supabase.from('supplier_transactions')
      .select('*')
      .eq('supplier_id', supplierId)
      .order('date', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false }))
    if (seq !== txnSeq.current) return
    if (res.error) { setTxns([]); setTxnError(reason(res.error)) } else setTxns(res.data)
    setTxnLoading(false)
  }

  function selectSupplier(sup) {
    if (selected?.id === sup.id) { ++txnSeq.current; setSelected(null); setTxns([]); setTxnError('') }
    else { setSelected(sup); loadTxns(sup.id) }
  }

  const payAmount = parseAmount(payForm.amount)
  const payAmountBad = payForm.amount !== '' && !(payAmount > 0)

  // الدفعة في معاملة خادم واحدة (supplier_payment_record، 20261010130000): رقم القيد وحركة «دفعة» للمورد وقيد «سداد مورد» يخفض الالتزام
  // معًا أو لا شيء. معرّف الطلب ثابت للحوار المفتوح، فإعادة المحاولة بعد انقطاع لا تكرر الدفعة (يعيد الخادم نتيجتها الأولى).
  // الدفعة ليست تكلفة جديدة: الشراء احتُسب بفاتورته؛ وحده ما يغطي رصيدًا لم يدخل الدفتر قط (افتتاحي أو فواتير سابقة) يبقى تكلفة عند السداد.
  async function recordPayment() {
    if (savingRef.current || !payModal || !(payAmount > 0) || !payForm.date || !payDateValid) return
    savingRef.current = true
    setSaving(true); setFormError('')
    try {
      const { data, error } = await supabase.rpc('supplier_payment_record', {
        p_kind: payModal.kind || 'list', p_supplier: payModal.id, p_amount: payAmount, p_date: payForm.date,
        p_source: payForm.paySource, p_notes: payForm.notes || null, p_request: payRequest.current,
      })
      if (error) {
        if (/failed to fetch|network|load failed/i.test(error.message || '')) {
          setPaymentIncomplete(true)
          setFormError('تعذّر تأكيد حفظ الدفعة لانقطاع الاتصال. أعد المحاولة من هذا الحوار: إن كانت وصلت لن تُسجَّل مرتين.')
        } else setFormError('لم تُسجَّل الدفعة: ' + reason(error))
        return
      }
      if (!data?.ok) { if (data?.code === 'payment_deleted') loadSuppliers(); setFormError(PAY_MESSAGES[data?.code] || `لم تُسجَّل الدفعة (${data?.code || 'غير معروف'}).`); return }
      const supId = payModal.id
      loadSuppliers()
      if (selected?.id === supId) loadTxns(supId)
      setPayModal(null)
      setPayForm(blankPay())
    } catch (e) {
      setPaymentIncomplete(true)
      setFormError('تعذّر تأكيد حفظ الدفعة. أعد المحاولة من هذا الحوار: إن كانت وصلت لن تُسجَّل مرتين. ' + reason(e))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const openingAmount = parseAmount(newForm.opening_balance)
  const openingBad = Number.isNaN(openingAmount)

  async function addSupplier() {
    if (savingRef.current || !newForm.name.trim() || openingBad) return
    savingRef.current = true
    setSaving(true); setFormError('')
    try {
      const { error } = await supabase.from('suppliers').insert({
        project_id: projectId,
        name:            newForm.name.trim(),
        phone:           newForm.phone.trim() || null,
        opening_balance: openingAmount || 0,
        notes:           newForm.notes.trim() || null,
      })
      if (error) { setFormError('لم يُضَف المورد: ' + reason(error)); return }
      setAddModal(false)
      setNewForm(blankNew())
      loadSuppliers()
    } catch (e) { setFormError('تعذّر تأكيد إضافة المورد: ' + reason(e)) }
    finally { savingRef.current = false; setSaving(false) }
  }

  // المستحقات الشاملة: موردو القائمة وموردو «آجل — باسم المورد» معًا، مع مجموع كل قسم (بالهللات)
  const listOutstanding = useMemo(() => suppliers.reduce((s, sup) => s + Math.max(0, Math.round(sup.balance * 100)), 0) / 100, [suppliers])
  const payablesOutstanding = useMemo(() => payables.reduce((s, p) => s + Math.max(0, Math.round(p.balance * 100)), 0) / 100, [payables])
  const totalOutstanding = Math.round((listOutstanding + payablesOutstanding) * 100) / 100
  const openPay = sup => { setFormError(''); setPayModal(sup); setPayForm(blankPay()); setPayDateValid(true); setPaymentIncomplete(false); payRequest.current = crypto.randomUUID() }

  return (
    <div className="ldg-page sup-page">
      <div className="ts-heading">
        <div>
          <h1>الموردون</h1>
          <p className="ldg-showing"><Store className="ts-icon--sm" aria-hidden="true" /><span data-k="sup.count">{loading || loadError ? '—' : `${suppliers.length} مورد نشط`}</span></p>
        </div>
        <Button variant="primary" icon={Plus} disabled={loading || !!loadError} onClick={() => { setFormError(''); setAddModal(true) }}>إضافة مورد</Button>
      </div>

      {loading ? (
        <Panel><div className="ldg-loading" aria-busy="true">جارٍ تحميل الموردين…</div></Panel>
      ) : loadError ? (
        <div className="ts-note ts-note--error ldg-load-error" data-k="sup.loadError" role="alert">
          <Info className="ts-icon" aria-hidden="true" />
          <div className="ts-note-body">
            <strong>تعذّر تحميل الموردين وأرصدتهم كاملة، فلم تُعرض الأرصدة.</strong>
            رصيد من حركات ناقصة يكون خاطئًا. {loadError}
            <div className="ts-note-action"><Button size="sm" variant="primary" icon={RefreshCw} onClick={loadSuppliers}>إعادة المحاولة</Button></div>
          </div>
        </div>
      ) : (
        <>
          {totalOutstanding > 0 && (
            <div className="sup-due" data-k="sup.totalOutstanding">
              <Wallet className="ts-icon" aria-hidden="true" />
              <span>إجمالي المستحقات المتبقية</span>
              <strong className="ts-num">{fmt(totalOutstanding)}</strong>
              {payablesOutstanding > 0 && <small className="sup-due-split">موردو القائمة <span className="ts-num" data-k="sup.listOutstanding">{fmt(listOutstanding)}</span> · آجل باسم المورد <span className="ts-num" data-k="sup.payablesOutstanding">{fmt(payablesOutstanding)}</span></small>}
            </div>
          )}

          {suppliers.length === 0 ? (
            <Panel><EmptyState icon={Store}>لا يوجد موردون — أضف مورداً جديداً.</EmptyState></Panel>
          ) : (
            <div className="sup-list">
              {suppliers.map(sup => {
                const isOpen = selected?.id === sup.id
                return (
                  <section key={sup.id} className={`sup-item${isOpen ? ' is-open' : ''}${sup.balance > 0 ? ' is-due' : ''}`} data-supplier={sup.id}>
                    <div className="sup-head">
                      <button type="button" className="sup-toggle" data-k="toggle" aria-expanded={isOpen} onClick={() => selectSupplier(sup)}>
                        <ChevronDown className="ts-icon jar-chev" aria-hidden="true" />
                        <span className="sup-name">
                          <strong data-k="name">{sup.name}</strong>
                          {sup.phone && <span className="ts-num" data-k="phone">{sup.phone}</span>}
                          <small>فواتير: <span className="ts-num" data-k="invoices">{fmt(sup.invoices)}</span> · مدفوع: <span className="ts-num" data-k="payments">{fmt(sup.payments)}</span></small>
                        </span>
                        <span className="sup-bal">
                          <small>المتبقي</small>
                          <strong className={`ts-num ${sup.balance > 0 ? 'amt-due' : 'amt-clear'}`} data-k="balance">{fmt(sup.balance)}</strong>
                        </span>
                      </button>
                      <Button size="sm" variant="primary" data-k="pay" disabled={sup.balance <= 0} onClick={() => openPay(sup)}>تسجيل دفعة</Button>
                    </div>

                    {isOpen && (
                      <div className="sup-body">
                        {txnLoading ? (
                          <div className="ldg-loading" aria-busy="true">جارٍ تحميل الحركات…</div>
                        ) : txnError ? (
                          <div className="ts-note ts-note--error" data-k="sup.txnError" role="alert">
                            <Info className="ts-icon" aria-hidden="true" />
                            <div className="ts-note-body"><strong>تعذّر تحميل حركات المورد كاملة.</strong> {txnError}
                              <div className="ts-note-action"><Button size="sm" variant="primary" icon={RefreshCw} onClick={() => loadTxns(sup.id)}>إعادة المحاولة</Button></div>
                            </div>
                          </div>
                        ) : txns.length === 0 ? (
                          <EmptyState icon={Store}>لا توجد حركات مسجّلة.</EmptyState>
                        ) : (
                          <ul className="sup-txns" data-table="sup.txns">
                            {txns.map(t => (
                              <li key={t.id} data-id={t.id}>
                                <span className="sup-txn-main">
                                  <Status tone={t.type === 'invoice' ? 'danger' : 'success'}><span data-k="type">{t.type === 'invoice' ? 'فاتورة' : 'دفعة'}</span></Status>
                                  {t.notes && <span className="sup-notes" data-k="notes">{t.notes}</span>}
                                  <span className="sup-date" data-k="date" data-iso={t.date || ''}>{t.date ? formatDate(t.date, { year: true }) : '—'}</span>
                                </span>
                                <strong className={`ts-num ${t.type === 'invoice' ? 'amt-due' : 'amt-clear'}`} data-k="amount">{t.type === 'invoice' ? '+' : '−'}{fmt(t.amount)}</strong>
                              </li>
                            ))}
                            <li className="sup-txn-total">
                              <span>الرصيد الحالي</span>
                              <strong className={`ts-num ${sup.balance > 0 ? 'amt-due' : 'amt-clear'}`} data-k="currentBalance">{fmt(sup.balance)}</strong>
                            </li>
                          </ul>
                        )}
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          )}
        </>
      )}

      {!loading && !loadError && payables.length > 0 && (
        <Panel title="موردو «آجل — باسم المورد»" subtitle="المستحق من فواتير مسجلة في الدفتر آجلًا ناقص ما سُدد منها. الدفعة تخفض المستحق ولا تُحتسب تكلفة ثانية.">
          <ul className="sup-txns" data-table="sup.payables">
            {payables.map(p => (
              <li key={p.id} data-payable={p.id}>
                <span className="sup-txn-main"><strong data-k="name">{p.name}</strong></span>
                <strong className={`ts-num ${p.balance > 0 ? 'amt-due' : 'amt-clear'}`} data-k="balance">{fmt(p.balance)}</strong>
                <Button size="sm" variant="primary" data-k="pay" disabled={p.balance <= 0} onClick={() => openPay(p)}>تسجيل دفعة</Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* تسجيل دفعة */}
      <Dialog open={!!payModal} onClose={() => !saving && setPayModal(null)} title={payModal ? `تسجيل دفعة — ${payModal.name}` : ''}
        description={payModal ? `المستحق: ${fmt(payModal.balance)}` : ''}
        footer={<>
          <Button variant="primary" disabled={saving || !(payAmount > 0) || !payForm.date || !payDateValid} onClick={recordPayment}>{saving ? 'جارٍ الحفظ…' : paymentIncomplete ? 'إعادة المحاولة' : 'تسجيل الدفعة'}</Button>
          <Button onClick={() => setPayModal(null)} disabled={saving}>{paymentIncomplete ? 'إغلاق' : 'إلغاء'}</Button>
        </>}>
        {payModal && (
          <div className="ts-form-grid">
            <Field label="المبلغ" error={payAmountBad ? 'مبلغ غير صالح؛ اكتب رقمًا أكبر من صفر.' : undefined}>
              <Input numeric disabled={saving || paymentIncomplete} value={payForm.amount} placeholder="0.00" data-k="payAmount" onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} />
            </Field>
            <Field label="التاريخ" error={!payDateValid ? 'أدخل تاريخًا صحيحًا.' : undefined}><DateInput disabled={saving || paymentIncomplete} value={payForm.date} onValidityChange={setPayDateValid} onChange={iso => setPayForm(f => ({ ...f, date: iso }))} /></Field>
            <Field label="مصدر الدفع"><Select disabled={saving || paymentIncomplete} value={payForm.paySource} options={PAY_SOURCES} onChange={e => setPayForm(f => ({ ...f, paySource: e.target.value }))} /></Field>
            <Field label="ملاحظات"><Input disabled={saving || paymentIncomplete} value={payForm.notes} placeholder="اختياري" onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} /></Field>
          </div>
        )}
        {payModal && formError && <p className="ts-field-error" role="alert" data-k="sup.formError">{formError}</p>}
      </Dialog>

      {/* إضافة مورد */}
      <Dialog open={addModal} onClose={() => !saving && setAddModal(false)} title="إضافة مورد جديد"
        footer={<>
          <Button variant="primary" disabled={saving || !newForm.name.trim() || openingBad} onClick={addSupplier}>{saving ? 'جارٍ الحفظ…' : 'إضافة مورد'}</Button>
          <Button onClick={() => setAddModal(false)} disabled={saving}>إلغاء</Button>
        </>}>
        {addModal && (
          <div className="ts-form-grid">
            <Field label="اسم المورد" span><Input value={newForm.name} placeholder="اسم الشركة أو المورد" data-k="newName" onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="رقم الجوال"><Input value={newForm.phone} placeholder="اختياري" onChange={e => setNewForm(f => ({ ...f, phone: e.target.value }))} /></Field>
            <Field label="رصيد افتتاحي (مديونية سابقة)" error={openingBad ? 'مبلغ غير صالح.' : undefined}>
              <Input numeric value={newForm.opening_balance} placeholder="0.00" data-k="newOpening" onChange={e => setNewForm(f => ({ ...f, opening_balance: e.target.value }))} />
            </Field>
            <Field label="ملاحظات" span><Input value={newForm.notes} placeholder="اختياري" onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))} /></Field>
          </div>
        )}
        {addModal && formError && <p className="ts-field-error" role="alert" data-k="sup.formError">{formError}</p>}
      </Dialog>
    </div>
  )
}
