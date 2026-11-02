import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, CircleAlert, FileText, PencilLine } from 'lucide-react'
import { Button, Field, Money, Note, Panel, Textarea } from '../ui/components.jsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { getProjectSettings, getTransactionTypes } from '../lib/projectSettings'
import { getSignedUrl } from '../lib/storage'
import { matchSupplier } from '../lib/supplierMatching'
import { approvalMessage, buildInvoicePayload, exactTotals, invoiceSupplierContext, newRequestId, payableDecision, vatExcess } from '../lib/approvalV2.js'
import { staleLineVatCorrection } from '../lib/lineVat.js'
import { withdrawalBlockReason } from '../lib/ownerWithdrawal.js'
import { loanBlockReason } from '../lib/loanRepayment.js'
import { isReceipt } from '../lib/supplierReceipts.js'
import { InvoiceSubPanel } from './PendingDocuments.jsx'

// تصحيح فاتورة معتمدة (20261103090000): تُفتح الفاتورة بما اعتُمد به في محرر المراجعة نفسه، ويُكتب سبب، ثم يحذف الخادم ما كتبته
// ويكتب المصحَّح بفحوص الاعتماد نفسها في معاملة واحدة (approval_correct_invoice)، برقم القيد نفسه. لا تبقى الفاتورة بلا قيود لحظة.
export default function CorrectInvoice() {
  const { docId, invId } = useParams()
  const navigate = useNavigate()
  const { projectId } = useAuth()
  const [state, setState] = useState({ loading: true })
  const [invoice, setInvoice] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)
  const [requestId, setRequestId] = useState(null)

  async function load() {
    setState({ loading: true }); setError(''); setDone(null)
    const [prep, doc, cats, types, settings, banks, sups, payable] = await Promise.all([
      supabase.rpc('approval_correction_prepare', { p_document_id: docId, p_invoice_id: invId }),
      supabase.from('documents').select('id,file_name,file_url,branch,purchase_category,project_id').eq('id', docId).maybeSingle(),
      supabase.from('categories').select('id,name,parent_id,type,sort_order,financial_class,ledger_type,is_active').eq('project_id', projectId).order('sort_order'),
      getTransactionTypes(projectId),
      getProjectSettings(projectId),
      supabase.from('bank_accounts').select('id,name,bank,branches,is_active,sort_order').eq('project_id', projectId).order('sort_order'),
      supabase.from('suppliers').select('id,name').eq('project_id', projectId).eq('is_active', true).order('name'),
      supabase.from('payable_suppliers').select('id,name').eq('project_id', projectId).order('name'),
    ])
    const p = prep.data
    if (prep.error || !p) { setState({ loading: false, fatal: 'تعذّر فتح الفاتورة للتصحيح. أعد المحاولة.' }); return }
    if (!p.ok) { setState({ loading: false, fatal: approvalMessage(p) }); return }
    if (doc.error || !doc.data || cats.error || banks.error || !settings?.settings) { setState({ loading: false, fatal: 'تعذّر تحميل بيانات المنشأة. أعد المحاولة.' }); return }
    const inv = (p.analysis_result?.invoices || []).find(x => x._id === invId)
    if (!inv) { setState({ loading: false, fatal: approvalMessage({ code: 'invoice_unknown' }) }); return }
    setInvoice(inv)
    setRequestId(null)
    setState({ loading: false, prep: p, doc: doc.data, original: inv, categories: cats.data || [], transTypes: types,
      setup: { settings: settings.settings, bankAccounts: banks.data || [] }, suppliers: sups.data || [], payableSuppliers: payable.data || [] })
  }
  useEffect(() => { if (projectId) load() }, [docId, invId, projectId])

  const blocked = useMemo(() => {
    if (!invoice) return null
    if (isReceipt(invoice)) return approvalMessage({ code: 'correction_not_supported', kind: 'supplier_payment' })
    if (invoice.type === 'expense' && invoice.items?.length) {
      const stale = staleLineVatCorrection(invoice)
      if (stale) return approvalMessage({ code: 'line_vat_stale', ...stale })
      const t = exactTotals(invoice)
      if (t.status !== 'match') return approvalMessage({ code: t.status === 'invalid' ? 'invalid_amount' : 'amounts_mismatch', difference: t.diff / 100 })
      if (vatExcess(invoice)) return approvalMessage({ code: 'vat_excess' })
    }
    return withdrawalBlockReason(invoice, state.transTypes) || loanBlockReason(invoice, state.transTypes) || null
  }, [invoice, state.transTypes])

  async function save() {
    if (!invoice || busy) return
    if (!reason.trim()) { setError(approvalMessage({ code: 'reason_required' })); return }
    if (blocked) { setError(blocked); return }
    setBusy(true); setError('')
    try {
      const ctx = invoiceSupplierContext(null, invoice, true)
      const payload = buildInvoicePayload(invoice, { original: state.original, categories: state.categories, transTypes: state.transTypes,
        purchaseCategory: state.doc.purchase_category, supplierId: ctx.supplierId })
      const decisions = { suppliers: {}, duplicates: {} }
      if (payload.paySource === 'payable') {
        payload.supplier_name = ctx.name
        const decision = payableDecision(matchSupplier(ctx.name, state.payableSuppliers), ctx)
        if (decision) decisions.suppliers[invId] = decision
      }
      const req = requestId || newRequestId()
      setRequestId(req)   // إعادة المحاولة بعد انقطاع الاتصال بالمعرّف نفسه لا تكرر التصحيح
      const { data, error: err } = await supabase.rpc('approval_correct_invoice', { p_document_id: docId, p_invoice_id: invId, p_request_id: req,
        p_expected_version: state.prep.version, p_invoice: payload, p_reason: reason.trim(), p_decisions: decisions, p_document: { branch: state.doc.branch || null } })
      if (err || !data) { setError('تعذّر الاتصال. أعد المحاولة؛ لن يتكرر التصحيح.'); return }
      if (!data.ok) {
        setError(approvalMessage(data)); setRequestId(null)
        if (data.code === 'stale' || data.code === 'invoice_not_approved') load()
        return
      }
      setDone(data)
    } catch (e) { setError(e?.message || 'تعذّر بناء الفاتورة المصححة.') } finally { setBusy(false) }
  }

  async function openFile() {
    const url = state.doc?.file_url && await getSignedUrl(state.doc.file_url).catch(() => null)
    if (url) window.open(url, '_blank', 'noopener')
  }

  const meta = state.prep?.corrected_invoice
  return <div data-k="correct-invoice">
    <div className="ts-heading">
      <h1>تصحيح فاتورة معتمدة</h1>
      <Button variant="quiet" icon={ArrowRight} onClick={() => navigate(-1)}>رجوع</Button>
    </div>
    {state.loading && <p>جارٍ التحميل…</p>}
    {state.fatal && <Note tone="error" icon={CircleAlert}>{state.fatal}</Note>}
    {done && <div data-k="correct-done"><Note tone="success" title="حُفظ التصحيح">
      صُحّحت الفاتورة بالقيد <span className="ts-num">{done.journal_number}</span>
      {done.previous_journal_number && done.previous_journal_number !== done.journal_number ? <> (كان <span className="ts-num">{done.previous_journal_number}</span>)</> : null}.
      الإجمالي <Money value={done.previous_total} /> ← <Money value={done.total} />. سُجّل السبب وما كان قبل التصحيح في سجل الفاتورة.
    </Note><Button onClick={() => navigate(-1)}>رجوع</Button></div>}
    {!state.loading && !state.fatal && !done && invoice && <>
      <Panel title={`القيد ${meta?.journal_number || '—'}`} icon={PencilLine}
        subtitle="عدّل ما يلزم ثم احفظ. تُحذف قيود هذه الفاتورة وبنودها وحركة موردها وتُكتب المصححة بفحوص الاعتماد نفسها في خطوة واحدة، برقم القيد نفسه. إن رُفض التصحيح يبقى المعتمد كما هو.">
        <div className="ts-panel-body">
          <p>اعتُمدت بإجمالي <Money value={meta?.total} />{meta?.invoice_date ? <> بتاريخ <span className="ts-num">{meta.invoice_date}</span></> : null}.
            {state.doc?.file_url && <> <Button size="sm" variant="quiet" icon={FileText} onClick={openFile}>فتح المستند</Button></>}</p>
          <Field label="سبب التصحيح" hint="مطلوب. يُحفظ مع ما كان قبل التصحيح في سجل الفاتورة وسجل الإجراءات.">
            <Textarea data-k="correct-reason" value={reason} rows={2} onChange={e => setReason(e.target.value)} />
          </Field>
          <div className="rp-subinvs">
            <InvoiceSubPanel invoice={invoice} index={0} transTypes={state.transTypes} categories={state.categories} setup={state.setup}
              branch={state.doc.branch} v2 decision={{ status: 'pending' }} defaultOpen approveLabel={busy ? 'جارٍ الحفظ…' : 'حفظ التصحيح'}
              onEdit={(f, v) => setInvoice(cur => ({ ...cur, [f]: v }))} onReplace={next => setInvoice({ ...next, _id: invId })}
              suppliers={state.suppliers} payableSuppliers={state.payableSuppliers} documentId={docId}
              onApprove={save} approving={busy} blocked={blocked} />
          </div>
          {error && <div data-k="correct-error"><Note tone="error" icon={CircleAlert}>{error}</Note></div>}
        </div>
      </Panel>
    </>}
  </div>
}
