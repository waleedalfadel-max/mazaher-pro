import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { getOrCreateJournalNumber } from '../lib/journalNumber'

const NAVY = '#1B3A5C'
const GOLD = '#6EB7B0'

const fmt = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function QuickSale() {
  const { projectId } = useAuth()
  const [channel, setChannel]   = useState(null) // 'cash' | 'bank'
  const [amount, setAmount]     = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [lastSuccess, setLastSuccess] = useState(null) // { amount, channel }

  const amt = Number(amount) || 0

  async function handleSubmit() {
    if (!channel || amt <= 0) return
    setSaving(true); setError('')
    try {
      const now       = new Date()
      const date      = now.toISOString().split('T')[0]
      const timeLabel = now.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })
      const isCash    = channel === 'cash'
      const jn        = await getOrCreateJournalNumber(projectId, date)

      const { error: ledgerErr } = await supabase.from('ledger_entries').insert({
        project_id: projectId, date,
        type: isCash ? '💵 مبيعات كاش' : '🏦 مبيعات شبكة',
        description: `مبيعة سريعة — ${timeLabel}`,
        cash_in: isCash ? amt : 0, cash_out: 0,
        bank_in: !isCash ? amt : 0, bank_out: 0,
        custody_in: 0, custody_out: 0,
        total_amount: amt, status: 'approved',
        journal_number: jn, branch: null,
      })
      if (ledgerErr) throw new Error(ledgerErr.message)

      const { error: salesErr } = await supabase.from('sales').insert({
        project_id: projectId, date,
        cash_sales: isCash ? amt : 0, network_sales: !isCash ? amt : 0,
        hunger_sales: 0, jahez_sales: 0, keeta_sales: 0,
        description: `مبيعة سريعة — ${timeLabel}`,
      })
      if (salesErr) throw new Error(salesErr.message)

      setLastSuccess({ amount: amt, channel })
      setChannel(null)
      setAmount('')
      setTimeout(() => setLastSuccess(s => (s?.amount === amt ? null : s)), 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

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
    </div>
  )
}
