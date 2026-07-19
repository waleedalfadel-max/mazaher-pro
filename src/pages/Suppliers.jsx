import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { getOrCreateJournalNumber } from '../lib/journalNumber'

const NAVY = '#1B3A5C'
const GOLD = '#6EB7B0'

function todayStr() { return new Date().toISOString().split('T')[0] }
const fmt = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })

export default function Suppliers() {
  const { projectId } = useAuth()
  const [suppliers, setSuppliers]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [selected, setSelected]     = useState(null)
  const [txns, setTxns]             = useState([])
  const [txnLoading, setTxnLoading] = useState(false)
  const [payModal, setPayModal]     = useState(null)
  const [addModal, setAddModal]     = useState(false)
  const [saving, setSaving]         = useState(false)
  const [payForm, setPayForm]       = useState({ amount: '', date: todayStr(), notes: '', paySource: 'bank' })
  const [newForm, setNewForm]       = useState({ name: '', phone: '', opening_balance: '', notes: '' })

  useEffect(() => { if (projectId) loadSuppliers() }, [projectId])

  async function loadSuppliers() {
    setLoading(true)
    const { data } = await supabase
      .from('suppliers')
      .select('id,name,phone,opening_balance,notes,supplier_transactions(type,amount)')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .order('name')

    const withBalance = (data || []).map(s => {
      const ts       = s.supplier_transactions || []
      const invoices = ts.filter(t => t.type === 'invoice').reduce((sum, t) => sum + Number(t.amount || 0), 0)
      const payments = ts.filter(t => t.type === 'payment').reduce((sum, t) => sum + Number(t.amount || 0), 0)
      const balance  = Number(s.opening_balance || 0) + invoices - payments
      return { ...s, balance, invoices, payments }
    })
    setSuppliers(withBalance)
    setLoading(false)
  }

  async function loadTxns(supplierId) {
    setTxnLoading(true)
    const { data } = await supabase
      .from('supplier_transactions')
      .select('*')
      .eq('supplier_id', supplierId)
      .order('date', { ascending: false })
    setTxns(data || [])
    setTxnLoading(false)
  }

  function selectSupplier(sup) {
    if (selected?.id === sup.id) { setSelected(null); setTxns([]) }
    else { setSelected(sup); loadTxns(sup.id) }
  }

  async function recordPayment() {
    if (!payModal || !payForm.amount || !payForm.date) return
    setSaving(true)
    try {
      const amount = Number(payForm.amount)
      const jn = await getOrCreateJournalNumber(projectId, payForm.date)
      await supabase.from('supplier_transactions').insert({
        supplier_id: payModal.id, project_id: projectId,
        type: 'payment', amount, date: payForm.date,
        notes: payForm.notes || null, journal_number: jn,
      })
      await supabase.from('ledger_entries').insert({
        project_id: projectId, date: payForm.date,
        type: '🏪 سداد مورد',
        description: `سداد مستحقات ${payModal.name}`,
        cash_out:    payForm.paySource === 'cash' ? amount : 0,
        bank_out:    payForm.paySource === 'bank' ? amount : 0,
        custody_out: 0, cash_in: 0, bank_in: 0, custody_in: 0,
        vat_amount: 0, total_amount: amount,
        status: 'approved', file_url: '', journal_number: jn,
      })
      setPayModal(null)
      setPayForm({ amount: '', date: todayStr(), notes: '', paySource: 'bank' })
      loadSuppliers()
      if (selected?.id === payModal.id) loadTxns(payModal.id)
    } catch(e) { alert(e.message) }
    setSaving(false)
  }

  async function addSupplier() {
    if (!newForm.name.trim()) return
    setSaving(true)
    try {
      await supabase.from('suppliers').insert({
        project_id: projectId,
        name:            newForm.name.trim(),
        phone:           newForm.phone.trim() || null,
        opening_balance: Number(newForm.opening_balance) || 0,
        notes:           newForm.notes.trim() || null,
      })
      setAddModal(false)
      setNewForm({ name: '', phone: '', opening_balance: '', notes: '' })
      loadSuppliers()
    } catch(e) { alert(e.message) }
    setSaving(false)
  }

  const totalOutstanding = suppliers.reduce((s, sup) => s + Math.max(0, sup.balance), 0)

  if (loading) return (
    <div className="flex justify-center h-64 items-center">
      <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: GOLD, borderTopColor: 'transparent' }}/>
    </div>
  )

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: NAVY }}>الموردين</h1>
          <p className="text-slate-500 text-sm mt-0.5">{suppliers.length} مورد نشط</p>
        </div>
        <button onClick={() => setAddModal(true)}
          className="px-4 py-2 rounded-xl text-sm font-bold"
          style={{ background: NAVY, color: '#fff' }}>
          + إضافة مورد
        </button>
      </div>

      {/* تنبيه المستحقات */}
      {totalOutstanding > 0 && (
        <div className="rounded-2xl p-4" style={{ background: '#fef3c7', border: '2px solid #fcd34d' }}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <div className="font-bold text-amber-800 text-sm">إجمالي المستحقات المتبقية</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-amber-900">{fmt(totalOutstanding)}</div>
            </div>
          </div>
        </div>
      )}

      {/* قائمة الموردين */}
      {suppliers.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center shadow-sm" style={{ border: '1px solid #e8e5dc' }}>
          <div className="text-4xl mb-3">🏪</div>
          <p className="text-slate-400 font-medium">لا يوجد موردون — أضف مورداً جديداً</p>
        </div>
      ) : suppliers.map(sup => (
        <div key={sup.id} className="bg-white rounded-2xl shadow-sm overflow-hidden"
          style={{ border: `2px solid ${sup.balance > 0 ? '#fcd34d' : '#e8e5dc'}` }}>

          {/* صف المورد */}
          <div className="p-4 flex items-center gap-3 cursor-pointer" onClick={() => selectSupplier(sup)}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-lg"
              style={{ background: sup.balance > 0 ? '#fef3c7' : '#f5f4f0' }}>
              🏪
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm" style={{ color: NAVY }}>{sup.name}</div>
              {sup.phone && <div className="text-xs text-slate-400 mt-0.5">{sup.phone}</div>}
              <div className="text-xs text-slate-400 mt-0.5">
                فواتير: {fmt(sup.invoices)} | مدفوع: {fmt(sup.payments)}
              </div>
            </div>
            <div className="text-center shrink-0 mx-2">
              <div className="text-xs text-slate-400 mb-0.5">المتبقي</div>
              <div className={`text-lg font-bold font-mono tabular-nums ${sup.balance > 0 ? 'text-amber-700' : 'text-green-600'}`}>
                {fmt(sup.balance)}
              </div>
            </div>
            <button
              onClick={e => { e.stopPropagation(); setPayModal(sup); setPayForm({ amount: '', date: todayStr(), notes: '', paySource: 'bank' }) }}
              disabled={sup.balance <= 0}
              className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 disabled:opacity-40"
              style={{ background: GOLD, color: NAVY }}>
              تسجيل دفعة
            </button>
            <span className="text-slate-400 text-sm">{selected?.id === sup.id ? '▲' : '▼'}</span>
          </div>

          {/* الحركات */}
          {selected?.id === sup.id && (
            <div style={{ borderTop: '1px solid #f5f4f0' }}>
              {txnLoading ? (
                <div className="p-4 text-center text-slate-400 text-sm">جارٍ التحميل...</div>
              ) : txns.length === 0 ? (
                <div className="p-4 text-center text-slate-400 text-sm">لا توجد حركات مسجّلة</div>
              ) : (
                <div className="divide-y" style={{ borderColor: '#f5f4f0' }}>
                  {txns.map(t => (
                    <div key={t.id} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${t.type === 'invoice' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                            {t.type === 'invoice' ? '📄 فاتورة' : '✅ دفعة'}
                          </span>
                          {t.notes && <span className="text-xs text-slate-400">{t.notes}</span>}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">{t.date}</div>
                      </div>
                      <div className={`font-mono font-bold text-sm ${t.type === 'invoice' ? 'text-red-700' : 'text-green-700'}`}>
                        {t.type === 'invoice' ? '+' : '−'}{fmt(t.amount)}
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between px-4 py-2.5 font-semibold text-sm"
                    style={{ background: '#f9f8f5' }}>
                    <span style={{ color: NAVY }}>الرصيد الحالي</span>
                    <span className={`font-mono ${sup.balance > 0 ? 'text-amber-700' : 'text-green-600'}`}>{fmt(sup.balance)}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* مودال تسجيل دفعة */}
      {payModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPayModal(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-4" style={{ color: NAVY }}>تسجيل دفعة — {payModal.name}</h2>
            <div className="mb-3 text-sm text-amber-700 font-semibold bg-amber-50 rounded-xl px-3 py-2">
              المستحق: {fmt(payModal.balance)}
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">المبلغ</label>
                <input type="number" value={payForm.amount} autoFocus
                  onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">التاريخ</label>
                <input type="date" value={payForm.date}
                  onChange={e => setPayForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">مصدر الدفع</label>
                <select value={payForm.paySource} onChange={e => setPayForm(f => ({ ...f, paySource: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="bank">🏦 البنك / تحويل</option>
                  <option value="cash">💵 الصندوق</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">ملاحظات</label>
                <input value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="اختياري"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setPayModal(null)}
                className="flex-1 py-2 rounded-xl text-sm font-semibold border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
                إلغاء
              </button>
              <button onClick={recordPayment} disabled={saving || !payForm.amount}
                className="flex-1 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                style={{ background: GOLD, color: NAVY }}>
                {saving ? 'جارٍ الحفظ...' : 'تسجيل الدفعة'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* مودال إضافة مورد */}
      {addModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setAddModal(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-4" style={{ color: NAVY }}>إضافة مورد جديد</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">اسم المورد *</label>
                <input value={newForm.name} autoFocus
                  onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="اسم الشركة أو المورد"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">رقم الجوال</label>
                <input value={newForm.phone} onChange={e => setNewForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="اختياري"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">رصيد افتتاحي (مديونية سابقة)</label>
                <input type="number" value={newForm.opening_balance}
                  onChange={e => setNewForm(f => ({ ...f, opening_balance: e.target.value }))}
                  placeholder="0.00"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">ملاحظات</label>
                <input value={newForm.notes} onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="اختياري"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setAddModal(false)}
                className="flex-1 py-2 rounded-xl text-sm font-semibold border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
                إلغاء
              </button>
              <button onClick={addSupplier} disabled={saving || !newForm.name.trim()}
                className="flex-1 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                style={{ background: NAVY, color: '#fff' }}>
                {saving ? 'جارٍ الحفظ...' : 'إضافة مورد'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
