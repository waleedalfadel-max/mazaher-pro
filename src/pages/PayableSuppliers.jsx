import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { getOrCreateJournalNumber } from '../lib/journalNumber'
import { uploadToStorage } from '../lib/storage'

// v1: "بـ عسل" فقط حالياً — باقي المشاريع ما عندها بيانات موردين بعد
const TARGET_PROJECT = 'بـ عسل'

const fmt = v => (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const todayStr = () => new Date().toISOString().split('T')[0]

export default function PayableSuppliers() {
  const { projectId, projectName } = useAuth()
  const [suppliers, setSuppliers] = useState([])
  const [entries, setEntries]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [payModal, setPayModal]   = useState(null) // { invoice, amount, paySource }
  const [error, setError]         = useState('')
  const [busy, setBusy]           = useState(false)
  const [statement, setStatement] = useState(null) // { supplier, balance, statementRows }
  const [exporting, setExporting] = useState(false)
  const statementPdfRef = useRef()

  useEffect(() => {
    if (!projectId) return
    load()
  }, [projectId])

  async function load() {
    setLoading(true)
    const [{ data: sup }, { data: ent }] = await Promise.all([
      supabase.from('payable_suppliers').select('id,name').eq('project_id', projectId).order('name'),
      supabase.from('ledger_entries')
        .select('id,date,description,type,category_main,category_sub,payable_in,payable_out,supplier_id,paid_invoice_id,status,file_url')
        .eq('project_id', projectId)
        .not('supplier_id', 'is', null)
        .neq('status', 'cancelled')
        .order('date', { ascending: false }),
    ])
    setSuppliers(sup || [])
    setEntries(ent || [])
    setLoading(false)
  }

  if (!(projectName || '').includes(TARGET_PROJECT)) {
    return (
      <div className="max-w-lg mx-auto text-center py-20 text-slate-400">
        <div className="text-4xl mb-3">🚧</div>
        <p className="font-medium">هذه الميزة غير متاحة لمشروعك بعد</p>
      </div>
    )
  }

  if (loading) return (
    <div className="flex justify-center h-64 items-center">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  function paymentsFor(invoiceId) {
    return entries
      .filter(e => e.paid_invoice_id === invoiceId)
      .sort((a, b) => (a.date > b.date ? 1 : -1))
  }

  function paidFor(invoiceId) {
    return paymentsFor(invoiceId).reduce((s, e) => s + (Number(e.payable_out) || 0), 0)
  }

  const supplierRows = suppliers.map(s => {
    const supplierEntries = entries.filter(e => e.supplier_id === s.id)
    const balance  = supplierEntries.reduce((sum, e) => sum + (Number(e.payable_in) || 0) - (Number(e.payable_out) || 0), 0)
    const invoices = supplierEntries
      .filter(e => Number(e.payable_in) > 0)
      .map(inv => {
        const payments  = paymentsFor(inv.id)
        const paid      = payments.reduce((s, e) => s + (Number(e.payable_out) || 0), 0)
        const remaining = (Number(inv.payable_in) || 0) - paid
        const status    = remaining <= 0.01 ? 'مكتمل' : paid > 0 ? 'جزئي' : 'غير مسدَّد'
        return { ...inv, paid, remaining, statusLabel: status, payments }
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1))
    const statementRows = [...supplierEntries]
      .sort((a, b) => (a.date > b.date ? 1 : -1))
      .reduce((acc, e) => {
        const prevBalance = acc.length ? acc[acc.length - 1].runningBalance : 0
        const runningBalance = prevBalance + (Number(e.payable_in) || 0) - (Number(e.payable_out) || 0)
        acc.push({ ...e, runningBalance })
        return acc
      }, [])
    return { supplier: s, balance, invoices, statementRows }
  })

  function openPay(invoice) {
    setError('')
    setPayModal({ invoice, amount: invoice.remaining.toFixed(2), paySource: '', proofFile: null })
  }

  async function submitPayment() {
    if (!payModal) return
    const { invoice, amount, paySource, proofFile } = payModal
    const amt = Number(amount) || 0
    if (amt <= 0) { setError('أدخل مبلغاً صحيحاً'); return }
    if (amt > invoice.remaining + 0.01) { setError('المبلغ أكبر من المتبقي على هذه الفاتورة'); return }
    if (!paySource) { setError('اختر مصدر الدفع'); return }
    if (!proofFile) { setError('ارفع مستند إثبات السداد'); return }

    setBusy(true)
    setError('')
    try {
      const fileUrl = await uploadToStorage(proofFile, projectId)
      const jn = await getOrCreateJournalNumber(projectId, todayStr())
      const { error: insErr } = await supabase.from('ledger_entries').insert({
        project_id: projectId, date: todayStr(), type: invoice.type,
        description: `سداد — ${invoice.description || ''}`,
        cash_out:    paySource === 'cash'    ? amt : 0,
        bank_out:    paySource === 'bank'    ? amt : 0,
        custody_out: paySource === 'custody' ? amt : 0,
        cash_in: 0, bank_in: 0, custody_in: 0,
        receivable_in: 0, receivable_out: 0,
        payable_in: 0, payable_out: amt,
        supplier_id: invoice.supplier_id, paid_invoice_id: invoice.id,
        category_main: invoice.category_main || null, category_sub: invoice.category_sub || null,
        vat_amount: 0, total_amount: amt, status: 'approved',
        journal_number: jn, branch: null, file_url: fileUrl,
      })
      if (insErr) throw new Error(insErr.message)
      setPayModal(null)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function exportStatementPdf() {
    if (!statement || !statementPdfRef.current) return
    setExporting(true)
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'), import('html2canvas'),
      ])
      const el = statementPdfRef.current
      el.style.display = 'block'
      await new Promise(r => setTimeout(r, 150))
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' })
      el.style.display = 'none'
      const imgData = canvas.toDataURL('image/png')
      const pdf   = new jsPDF('p', 'mm', 'a4')
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const imgH  = (canvas.height * pageW) / canvas.width
      let yOffset = 0, remaining = imgH
      while (remaining > 0) {
        pdf.addImage(imgData, 'PNG', 0, -yOffset, pageW, imgH)
        remaining -= pageH; yOffset += pageH
        if (remaining > 0) pdf.addPage()
      }
      pdf.save(`كشف-حساب-${statement.supplier.name}.pdf`)
    } catch (e) { console.error(e) }
    setExporting(false)
  }

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">🏪 الذمم الدائنة</h1>
        <p className="text-sm text-slate-500 mt-1">رصيد كل مورد وفواتيره الآجلة، مع إمكانية السداد الكلي أو الجزئي</p>
      </div>

      {supplierRows.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center py-16 text-slate-400">
          <span className="text-4xl mb-3">📭</span>
          <p className="font-medium">لا يوجد موردون بعد</p>
        </div>
      ) : (
        <div className="space-y-3">
          {supplierRows.map(({ supplier, balance, invoices, statementRows }) => (
            <div key={supplier.id} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="w-full flex items-center justify-between p-4">
                <button onClick={() => setExpandedId(id => id === supplier.id ? null : supplier.id)}
                  className="flex-1 text-right font-bold text-slate-800">
                  {supplier.name}
                </button>
                <div className="flex items-center gap-3">
                  <button onClick={() => setStatement({ supplier, balance, statementRows })}
                    className="text-xs px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors font-semibold shrink-0">
                    📄 كشف حساب
                  </button>
                  <span className={`font-mono font-bold text-sm ${balance > 0 ? 'text-red-700' : 'text-slate-400'}`}>
                    {fmt(balance)}
                  </span>
                  <button onClick={() => setExpandedId(id => id === supplier.id ? null : supplier.id)}
                    className={`text-slate-400 transition-transform ${expandedId === supplier.id ? 'rotate-180' : ''}`}>▼</button>
                </div>
              </div>

              {expandedId === supplier.id && (
                <div className="border-t border-slate-100 divide-y divide-slate-50">
                  {invoices.length === 0 ? (
                    <div className="p-4 text-sm text-slate-400 text-center">لا توجد فواتير</div>
                  ) : invoices.map(inv => (
                    <div key={inv.id} className="p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-700 text-sm truncate">{inv.description || inv.type}</div>
                        <div className="text-xs text-slate-400 mt-0.5">{inv.date} · {inv.type}</div>
                        <div className="text-xs mt-1 flex items-center gap-2">
                          <span className="text-slate-500">الإجمالي: {fmt(inv.payable_in)}</span>
                          {inv.paid > 0 && <span className="text-green-600">مسدَّد: {fmt(inv.paid)}</span>}
                          <span className={`px-2 py-0.5 rounded-full font-semibold ${
                            inv.statusLabel === 'مكتمل' ? 'bg-green-100 text-green-700' :
                            inv.statusLabel === 'جزئي'  ? 'bg-amber-100 text-amber-700' :
                                                          'bg-red-100 text-red-700'
                          }`}>{inv.statusLabel}</span>
                        </div>
                        {inv.payments.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {inv.payments.map(p => (
                              <div key={p.id} className="flex items-center gap-2 text-xs text-slate-500">
                                <span>💵 {p.date} · {fmt(p.payable_out)}</span>
                                {p.file_url && (
                                  <a href={p.file_url} target="_blank" rel="noreferrer"
                                    className="text-blue-600 hover:text-blue-800" title="عرض مستند السداد">📎</a>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {inv.statusLabel !== 'مكتمل' && (
                        <button onClick={() => openPay(inv)}
                          className="shrink-0 px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors">
                          💰 تسديد
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {payModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !busy && setPayModal(null)}>
          <div className="bg-white rounded-2xl p-5 space-y-4 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div>
              <div className="font-bold text-slate-800">تسديد فاتورة</div>
              <div className="text-sm text-slate-500 mt-1">{payModal.invoice.description || payModal.invoice.type}</div>
              <div className="text-xs text-slate-400 mt-1">المتبقي: {fmt(payModal.invoice.remaining)}</div>
            </div>

            {error && <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-red-700 text-sm">❌ {error}</div>}

            <div>
              <label className="text-xs text-slate-400 block mb-1">مبلغ السداد</label>
              <input type="number" value={payModal.amount}
                onChange={e => setPayModal(m => ({ ...m, amount: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">مصدر الدفع</label>
              <select value={payModal.paySource}
                onChange={e => setPayModal(m => ({ ...m, paySource: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="">— اختر —</option>
                <option value="cash">💵 الصندوق</option>
                <option value="bank">🏦 البنك / مدى</option>
                <option value="custody">👤 العهدة</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">مستند إثبات السداد (إلزامي)</label>
              <input type="file" accept="image/*,.pdf"
                onChange={e => setPayModal(m => ({ ...m, proofFile: e.target.files?.[0] || null }))}
                className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 file:ml-2 file:px-2 file:py-1 file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-700 file:text-xs file:font-semibold"/>
              {payModal.proofFile && (
                <div className="text-xs text-green-600 mt-1">✅ {payModal.proofFile.name}</div>
              )}
            </div>

            <div className="flex gap-2">
              <button onClick={submitPayment} disabled={busy || !payModal.proofFile}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition-colors disabled:opacity-50">
                {busy ? '...' : '✅ تأكيد السداد'}
              </button>
              <button onClick={() => setPayModal(null)} disabled={busy}
                className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-200 transition-colors disabled:opacity-50">
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {statement && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !exporting && setStatement(null)}>
          <div className="bg-white rounded-2xl p-5 space-y-4 w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div>
              <div className="font-bold text-slate-800">📄 كشف حساب — {statement.supplier.name}</div>
              <div className="text-xs text-slate-400 mt-1">الرصيد الحالي المستحق: {fmt(statement.balance)}</div>
            </div>

            <div className="flex-1 overflow-y-auto -mx-5 px-5">
              {statement.statementRows.length === 0 ? (
                <div className="p-4 text-sm text-slate-400 text-center">لا توجد حركات</div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-100">
                      <th className="text-right py-2 font-medium">التاريخ</th>
                      <th className="text-right py-2 font-medium">الوصف</th>
                      <th className="text-left py-2 font-medium">فاتورة</th>
                      <th className="text-left py-2 font-medium">سداد</th>
                      <th className="text-left py-2 font-medium">الرصيد</th>
                      <th className="py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.statementRows.map(r => (
                      <tr key={r.id} className="border-b border-slate-50">
                        <td className="py-2 text-slate-500">{r.date}</td>
                        <td className="py-2 text-slate-700">{r.description || r.type}</td>
                        <td className="py-2 text-left text-slate-700">{r.payable_in > 0 ? fmt(r.payable_in) : '—'}</td>
                        <td className="py-2 text-left text-green-700">{r.payable_out > 0 ? fmt(r.payable_out) : '—'}</td>
                        <td className="py-2 text-left font-mono font-semibold text-slate-800">{fmt(r.runningBalance)}</td>
                        <td className="py-2 text-center">
                          {r.file_url && (
                            <a href={r.file_url} target="_blank" rel="noreferrer"
                              className="text-blue-600 hover:text-blue-800" title="عرض المستند">📎</a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-100">
              <button onClick={exportStatementPdf} disabled={exporting}
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors disabled:opacity-50">
                {exporting ? '...' : '🖨️ تصدير PDF'}
              </button>
              <button onClick={() => setStatement(null)} disabled={exporting}
                className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-200 transition-colors disabled:opacity-50">
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── قالب PDF مخفي لكشف الحساب ── */}
      {statement && (
        <div ref={statementPdfRef} style={{ display: 'none', width: '794px', fontFamily: 'Cairo,Arial,sans-serif', direction: 'rtl', background: '#fff', padding: '36px', color: '#1e293b' }}>
          <div style={{ textAlign: 'center', borderBottom: '4px solid #6EB7B0', paddingBottom: '16px', marginBottom: '24px' }}>
            <div style={{ fontSize: '26px', fontWeight: 'bold', color: '#1B3A5C' }}>تحسيب</div>
            <div style={{ fontSize: '16px', fontWeight: 'bold', marginTop: '4px', color: '#374151' }}>كشف حساب مورد — {statement.supplier.name}</div>
            <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '6px' }}>تاريخ الطباعة: {new Date().toLocaleDateString('en-GB')}</div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: '#f5f4f0', borderBottom: '2px solid #6EB7B0' }}>
                {['التاريخ', 'الوصف', 'فاتورة', 'سداد', 'الرصيد'].map(h => (
                  <th key={h} style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 'bold', color: '#1B3A5C' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {statement.statementRows.map((r, i) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#fafaf8' }}>
                  <td style={{ padding: '6px 8px' }}>{r.date}</td>
                  <td style={{ padding: '6px 8px' }}>{r.description || r.type}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'left' }}>{r.payable_in > 0 ? fmt(r.payable_in) : '—'}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'left', color: '#16a34a' }}>{r.payable_out > 0 ? fmt(r.payable_out) : '—'}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 'bold' }}>{fmt(r.runningBalance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#1B3A5C', fontWeight: 'bold' }}>
                <td colSpan={4} style={{ padding: '8px', color: '#fff' }}>الرصيد الحالي المستحق</td>
                <td style={{ padding: '8px', color: '#fff', textAlign: 'left' }}>{fmt(statement.balance)}</td>
              </tr>
            </tfoot>
          </table>

          <div style={{ borderTop: '2px solid #6EB7B0', paddingTop: '12px', textAlign: 'center', color: '#9ca3af', fontSize: '10px', marginTop: '16px' }}>
            تم إنشاء هذا الكشف بواسطة تحسيب — {new Date().toLocaleString('en-US')}
          </div>
        </div>
      )}
    </div>
  )
}
