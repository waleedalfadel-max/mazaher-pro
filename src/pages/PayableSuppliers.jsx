import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { getOrCreateJournalNumber } from '../lib/journalNumber'

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

  useEffect(() => {
    if (!projectId) return
    load()
  }, [projectId])

  async function load() {
    setLoading(true)
    const [{ data: sup }, { data: ent }] = await Promise.all([
      supabase.from('payable_suppliers').select('id,name').eq('project_id', projectId).order('name'),
      supabase.from('ledger_entries')
        .select('id,date,description,type,category_main,category_sub,payable_in,payable_out,supplier_id,paid_invoice_id,status')
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

  function paidFor(invoiceId) {
    return entries
      .filter(e => e.paid_invoice_id === invoiceId)
      .reduce((s, e) => s + (Number(e.payable_out) || 0), 0)
  }

  const supplierRows = suppliers.map(s => {
    const supplierEntries = entries.filter(e => e.supplier_id === s.id)
    const balance  = supplierEntries.reduce((sum, e) => sum + (Number(e.payable_in) || 0) - (Number(e.payable_out) || 0), 0)
    const invoices = supplierEntries
      .filter(e => Number(e.payable_in) > 0)
      .map(inv => {
        const paid      = paidFor(inv.id)
        const remaining = (Number(inv.payable_in) || 0) - paid
        const status    = remaining <= 0.01 ? 'مكتمل' : paid > 0 ? 'جزئي' : 'غير مسدَّد'
        return { ...inv, paid, remaining, statusLabel: status }
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1))
    return { supplier: s, balance, invoices }
  })

  function openPay(invoice) {
    setError('')
    setPayModal({ invoice, amount: invoice.remaining.toFixed(2), paySource: '' })
  }

  async function submitPayment() {
    if (!payModal) return
    const { invoice, amount, paySource } = payModal
    const amt = Number(amount) || 0
    if (amt <= 0) { setError('أدخل مبلغاً صحيحاً'); return }
    if (amt > invoice.remaining + 0.01) { setError('المبلغ أكبر من المتبقي على هذه الفاتورة'); return }
    if (!paySource) { setError('اختر مصدر الدفع'); return }

    setBusy(true)
    setError('')
    try {
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
        journal_number: jn, branch: null, file_url: '',
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
          {supplierRows.map(({ supplier, balance, invoices }) => (
            <div key={supplier.id} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <button onClick={() => setExpandedId(id => id === supplier.id ? null : supplier.id)}
                className="w-full flex items-center justify-between p-4 text-right">
                <div className="font-bold text-slate-800">{supplier.name}</div>
                <div className="flex items-center gap-3">
                  <span className={`font-mono font-bold text-sm ${balance > 0 ? 'text-red-700' : 'text-slate-400'}`}>
                    {fmt(balance)}
                  </span>
                  <span className={`text-slate-400 transition-transform ${expandedId === supplier.id ? 'rotate-180' : ''}`}>▼</span>
                </div>
              </button>

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

            <div className="flex gap-2">
              <button onClick={submitPayment} disabled={busy}
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
    </div>
  )
}
