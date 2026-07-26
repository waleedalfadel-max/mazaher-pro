import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { getOrCreateJournalNumber } from '../lib/journalNumber'

const NAVY = '#1B3A5C'
const GOLD = '#6EB7B0'

const fmt = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const todayStr = () => new Date().toISOString().split('T')[0]

export default function QuickSale() {
  const { projectId } = useAuth()
  const [channel, setChannel]         = useState(null) // 'cash' | 'bank'
  const [amount, setAmount]           = useState('')
  const [saving, setSaving]           = useState(false)
  const [closing, setClosing]         = useState(false)
  const [error, setError]             = useState('')
  const [lastSuccess, setLastSuccess] = useState(null)   // { amount, channel }
  const [closeSuccess, setCloseSuccess] = useState(null) // { cash, bank }
  const [todayRows, setTodayRows]     = useState([])
  const [loading, setLoading]         = useState(true)
  const closingRef = useRef(false)
  const today = todayStr()

  useEffect(() => {
    if (!projectId) return
    loadToday().then(() => setLoading(false))
  }, [projectId])

  async function loadToday() {
    const { data } = await supabase.from('quick_sales_draft')
      .select('id,channel,amount,created_at')
      .eq('project_id', projectId).eq('date', today).eq('closed', false)
      .order('created_at', { ascending: false })
    setTodayRows(data || [])
  }

  const amt = Number(amount) || 0
  const cashRows  = todayRows.filter(r => r.channel === 'cash')
  const bankRows  = todayRows.filter(r => r.channel === 'bank')
  const cashTotal = cashRows.reduce((s, r) => s + Number(r.amount), 0)
  const bankTotal = bankRows.reduce((s, r) => s + Number(r.amount), 0)

  async function handleSubmit() {
    if (!channel || amt <= 0) return
    setSaving(true); setError('')
    try {
      const { error: insErr } = await supabase.from('quick_sales_draft').insert({
        project_id: projectId, date: today, channel, amount: amt, closed: false,
      })
      if (insErr) throw new Error(insErr.message)

      setLastSuccess({ amount: amt, channel })
      setChannel(null)
      setAmount('')
      await loadToday()
      setTimeout(() => setLastSuccess(s => (s?.amount === amt ? null : s)), 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    setError('')
    try {
      const { error: delErr } = await supabase.from('quick_sales_draft').delete().eq('id', id).eq('closed', false)
      if (delErr) throw new Error(delErr.message)
      await loadToday()
    } catch (e) {
      setError(e.message)
    }
  }

  async function closeDay() {
    if (closingRef.current) return
    if (!window.confirm('هل أنت متأكد؟ هذا سيقفل مبيعات اليوم ولن تقدر تعدلها بعدها')) return
    closingRef.current = true
    setClosing(true); setError(''); setCloseSuccess(null)
    try {
      // إعادة جلب فورية للصفوف المفتوحة فعلياً — وليس الاعتماد على todayRows بالحالة
      const { data: openRows, error: fetchErr } = await supabase.from('quick_sales_draft')
        .select('id,channel,amount')
        .eq('project_id', projectId).eq('date', today).eq('closed', false)
      if (fetchErr) throw new Error(fetchErr.message)
      if (!openRows?.length) { await loadToday(); return } // أُقفلت بالفعل بضغطة سابقة — لا شيء لفعله

      const cTotal = openRows.filter(r => r.channel === 'cash').reduce((s, r) => s + Number(r.amount), 0)
      const bTotal = openRows.filter(r => r.channel === 'bank').reduce((s, r) => s + Number(r.amount), 0)
      const jn = await getOrCreateJournalNumber(projectId, today)

      if (cTotal > 0) {
        const { error: e1 } = await supabase.from('ledger_entries').insert({
          project_id: projectId, date: today, type: '💵 مبيعات كاش',
          description: 'إقفال يومي — إدخال سريع', cash_in: cTotal, cash_out: 0,
          bank_in: 0, bank_out: 0, custody_in: 0, custody_out: 0,
          total_amount: cTotal, status: 'approved', journal_number: jn, branch: null,
        })
        if (e1) throw new Error(e1.message)
        const { error: e2 } = await supabase.from('sales').insert({
          project_id: projectId, date: today, cash_sales: cTotal, network_sales: 0,
          hunger_sales: 0, jahez_sales: 0, keeta_sales: 0, description: 'إقفال يومي — إدخال سريع',
        })
        if (e2) throw new Error(e2.message)
      }
      if (bTotal > 0) {
        const { error: e3 } = await supabase.from('ledger_entries').insert({
          project_id: projectId, date: today, type: '🏦 مبيعات شبكة',
          description: 'إقفال يومي — إدخال سريع', cash_in: 0, cash_out: 0,
          bank_in: bTotal, bank_out: 0, custody_in: 0, custody_out: 0,
          total_amount: bTotal, status: 'approved', journal_number: jn, branch: null,
        })
        if (e3) throw new Error(e3.message)
        const { error: e4 } = await supabase.from('sales').insert({
          project_id: projectId, date: today, cash_sales: 0, network_sales: bTotal,
          hunger_sales: 0, jahez_sales: 0, keeta_sales: 0, description: 'إقفال يومي — إدخال سريع',
        })
        if (e4) throw new Error(e4.message)
      }

      const ids = openRows.map(r => r.id)
      const { error: closeErr } = await supabase.from('quick_sales_draft').update({ closed: true }).in('id', ids)
      if (closeErr) throw new Error(closeErr.message)

      setCloseSuccess({ cash: cTotal, bank: bTotal })
      await loadToday()
    } catch (e) {
      setError(e.message)
    } finally {
      setClosing(false)
      closingRef.current = false
    }
  }

  if (loading) return (
    <div className="flex justify-center h-64 items-center">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  return (
    <div className="max-w-md mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">💵 إدخال سريع للمبيعات</h1>
        <p className="text-slate-500 text-sm mt-1">سجّل كل عملية بيع فور حدوثها</p>
      </div>

      {lastSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
          <div className="text-2xl mb-1">✅</div>
          <div className="font-bold text-green-800">
            تم تسجيل {fmt(lastSuccess.amount)} ريال {lastSuccess.channel === 'cash' ? 'كاش' : 'شبكة'}
          </div>
        </div>
      )}

      {closeSuccess && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-center">
          <div className="text-2xl mb-1">✅</div>
          <div className="font-bold text-blue-800">
            تم إقفال اليوم — كاش: {fmt(closeSuccess.cash)} / شبكة: {fmt(closeSuccess.bank)}
          </div>
        </div>
      )}

      {/* بطاقة الإجمالي العام — أبرز بصرياً من البطاقتين الفرعيتين */}
      <div className="rounded-2xl p-5 text-center shadow-sm" style={{ background: NAVY }}>
        <div className="text-sm font-bold mb-1" style={{ color: 'rgba(255,255,255,0.7)' }}>💰 إجمالي اليوم</div>
        <div className="text-4xl font-bold font-mono text-white">{fmt(cashTotal + bankTotal)}</div>
        <div className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>{cashRows.length + bankRows.length} عملية</div>
      </div>

      {/* بطاقتا إجمالي اليوم لحد الآن — كاش/شبكة */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl p-4 text-center" style={{ background: '#fffbeb', border: '2px solid #fde68a' }}>
          <div className="text-xs font-bold text-amber-700 mb-1">💵 كاش اليوم</div>
          <div className="text-xl font-bold font-mono" style={{ color: NAVY }}>{fmt(cashTotal)}</div>
          <div className="text-xs text-slate-400 mt-0.5">{cashRows.length} عملية</div>
        </div>
        <div className="rounded-2xl p-4 text-center" style={{ background: '#eff6ff', border: '2px solid #bfdbfe' }}>
          <div className="text-xs font-bold text-blue-700 mb-1">🏦 شبكة اليوم</div>
          <div className="text-xl font-bold font-mono" style={{ color: NAVY }}>{fmt(bankTotal)}</div>
          <div className="text-xs text-slate-400 mt-0.5">{bankRows.length} عملية</div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4" style={{ border: '2px solid #e8e5dc' }}>
        <div>
          <label className="text-sm font-bold block mb-2" style={{ color: NAVY }}>قناة الدفع</label>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setChannel('cash')}
              className="py-6 rounded-2xl text-lg font-bold transition-all flex flex-col items-center gap-1"
              style={channel === 'cash'
                ? { background: GOLD, color: '#fff', border: `2px solid ${GOLD}` }
                : { background: '#f5f4f0', color: NAVY, border: '2px solid #e8e5dc' }}>
              <span className="text-3xl">💵</span> كاش
            </button>
            <button onClick={() => setChannel('bank')}
              className="py-6 rounded-2xl text-lg font-bold transition-all flex flex-col items-center gap-1"
              style={channel === 'bank'
                ? { background: GOLD, color: '#fff', border: `2px solid ${GOLD}` }
                : { background: '#f5f4f0', color: NAVY, border: '2px solid #e8e5dc' }}>
              <span className="text-3xl">🏦</span> شبكة
            </button>
          </div>
        </div>

        <div>
          <label className="text-sm font-bold block mb-2" style={{ color: NAVY }}>المبلغ</label>
          <input type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="0.00" min="0" step="0.01"
            className="w-full border rounded-xl px-4 py-3 text-2xl font-bold text-center focus:outline-none focus:ring-2"
            style={{ borderColor: '#d1c9b8', direction: 'ltr' }}/>
        </div>

        {error && (
          <p className="text-red-600 text-sm font-medium bg-red-50 rounded-xl p-3 border border-red-100">❌ {error}</p>
        )}

        <button onClick={handleSubmit} disabled={saving || !channel || amt <= 0}
          className="w-full py-4 text-white rounded-xl font-bold text-lg transition-colors disabled:opacity-50"
          style={{ background: saving || !channel || amt <= 0 ? '#94a3b8' : NAVY }}>
          {saving
            ? <span className="flex items-center justify-center gap-2">
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin inline-block"/>
                جارٍ التسجيل...
              </span>
            : '✅ تسجيل'
          }
        </button>
      </div>

      {/* قائمة عمليات اليوم غير المُقفلة */}
      {todayRows.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: '2px solid #e8e5dc' }}>
          <div className="px-4 py-3" style={{ background: NAVY }}>
            <h2 className="font-bold text-white text-sm">عمليات اليوم ({todayRows.length})</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {todayRows.map(r => (
              <div key={r.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-bold" style={{ color: NAVY }}>{r.channel === 'cash' ? '💵 كاش' : '🏦 شبكة'}</span>
                  <span className="text-slate-400">—</span>
                  <span className="font-mono font-bold" style={{ color: NAVY }}>{fmt(r.amount)} ريال</span>
                  <span className="text-slate-400">—</span>
                  <span className="text-slate-500 text-xs">
                    {new Date(r.created_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <button onClick={() => handleDelete(r.id)}
                  className="text-red-400 hover:text-red-600 text-sm font-medium transition-colors">
                  🗑️ حذف
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* إقفال اليوم — يظهر فقط إن وُجدت عمليات مفتوحة */}
      {todayRows.length > 0 && (
        <button onClick={closeDay} disabled={closing}
          className="w-full py-4 text-white rounded-xl font-bold text-lg transition-colors disabled:opacity-50"
          style={{ background: closing ? '#94a3b8' : '#b91c1c' }}>
          {closing
            ? <span className="flex items-center justify-center gap-2">
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin inline-block"/>
                جارٍ الإقفال...
              </span>
            : '🔒 إقفال اليوم'
          }
        </button>
      )}
    </div>
  )
}
