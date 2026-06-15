import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { getOrCreateJournalNumber } from '../lib/journalNumber'
import { getTransactionTypes } from '../lib/projectSettings'

const NAVY = '#0f2444'
const GOLD = '#c9a227'

const STATUS_BADGE = {
  approved:  'bg-green-100 text-green-700',
  auto:      'bg-blue-100 text-blue-700',
  pending:   'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-red-100 text-red-700',
  modified:  'bg-purple-100 text-purple-700',
}
const STATUS_LABEL = {
  approved:  'معتمد',
  auto:      'تلقائي',
  pending:   'معلق',
  cancelled: 'ملغي',
  modified:  'معدَّل',
}

const QUICK_PERIODS = [
  { key: 'month',     label: 'الشهر الحالي' },
  { key: 'lastMonth', label: 'الشهر الماضي' },
  { key: 'year',      label: 'السنة الحالية' },
]

function getRange(type) {
  const n = new Date()
  const to = n.toISOString().split('T')[0]
  if (type === 'lastMonth') {
    const lm  = new Date(n.getFullYear(), n.getMonth() - 1, 1)
    const lme = new Date(n.getFullYear(), n.getMonth(), 0)
    return { from: lm.toISOString().split('T')[0], to: lme.toISOString().split('T')[0] }
  }
  const from = type === 'year'
    ? `${n.getFullYear()}-01-01`
    : `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`
  return { from, to }
}


export default function Ledger() {
  const { canEdit, projectId } = useAuth()
  const [allRows, setAllRows]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [types, setTypes]           = useState([])
  const [editRow, setEditRow]       = useState(null)
  const [activePeriod, setActivePeriod] = useState('month')
  const [filter, setFilter]         = useState({ ...getRange('month'), type: '' })
  const [newRow, setNewRow]           = useState(null)
  const [saving, setSaving]           = useState(false)

  useEffect(() => {
    if (!projectId) return
    getTransactionTypes(projectId).then(setTypes)
    load(projectId)
  }, [projectId])

  async function load(pid) {
    setLoading(true)
    const { data } = await supabase.from('ledger_entries')
      .select('*')
      .eq('project_id', pid)
      .order('date', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(2000)
    setAllRows(data || [])
    setLoading(false)
  }

  // Compute running balances for all non-cancelled entries (ascending order)
  const enriched = useMemo(() => {
    let cash = 0, bank = 0, custody = 0
    return allRows.map(r => {
      if (r.status !== 'cancelled') {
        cash    += (r.cash_in    || 0) - (r.cash_out    || 0)
        bank    += (r.bank_in    || 0) - (r.bank_out    || 0)
        custody += (r.custody_in || 0) - (r.custody_out || 0)
        return { ...r, _cashBal: cash, _bankBal: bank, _custodyBal: custody }
      }
      return { ...r, _cashBal: null, _bankBal: null, _custodyBal: null }
    })
  }, [allRows])

  // Current balance = last non-cancelled row's running balance
  const currentBal = useMemo(() => {
    const last = [...enriched].reverse().find(r => r._cashBal !== null)
    return last ? { cash: last._cashBal, bank: last._bankBal, custody: last._custodyBal } : { cash: 0, bank: 0, custody: 0 }
  }, [enriched])

  // Apply date + type filters, then reverse for newest-first display
  const filteredRows = useMemo(() => {
    let rows = enriched
    if (filter.from) rows = rows.filter(r => r.date >= filter.from)
    if (filter.to)   rows = rows.filter(r => r.date <= filter.to)
    if (filter.type) rows = rows.filter(r => r.type === filter.type)
    return [...rows].reverse()
  }, [enriched, filter])

  async function saveEdit() {
    if (!editRow) return
    await supabase.from('ledger_entries').update({
      type:        editRow.type,
      description: editRow.description,
      cash_out:    Number(editRow.cash_out)    || 0,
      cash_in:     Number(editRow.cash_in)     || 0,
      bank_out:    Number(editRow.bank_out)    || 0,
      bank_in:     Number(editRow.bank_in)     || 0,
      custody_out: Number(editRow.custody_out) || 0,
      custody_in:  Number(editRow.custody_in)  || 0,
      status:      'modified',
    }).eq('id', editRow.id)
    setEditRow(null)
    load(projectId)
  }

  async function cancelEntry(id) {
    if (!window.confirm('هل تريد حذف هذه الحركة نهائياً؟ لا يمكن التراجع.')) return
    const { error } = await supabase
      .from('ledger_entries')
      .delete()
      .eq('id', id)
    if (error) { alert('فشل الحذف: ' + error.message); return }
    load(projectId)
  }

  async function saveNew() {
    if (!newRow || !projectId) return
    setSaving(true)
    const jn = await getOrCreateJournalNumber(projectId, newRow.date)
    const amounts = ['cash_in','cash_out','bank_in','bank_out','custody_in','custody_out']
      .map(k => Number(newRow[k]) || 0)
    const total = Math.max(...amounts)
    const { error } = await supabase.from('ledger_entries').insert({
      project_id:    projectId,
      date:          newRow.date,
      type:          newRow.type,
      description:   newRow.description,
      cash_in:       Number(newRow.cash_in)     || 0,
      cash_out:      Number(newRow.cash_out)    || 0,
      bank_in:       Number(newRow.bank_in)     || 0,
      bank_out:      Number(newRow.bank_out)    || 0,
      custody_in:    Number(newRow.custody_in)  || 0,
      custody_out:   Number(newRow.custody_out) || 0,
      total_amount:  total,
      status:        'approved',
      file_url:      '',
      journal_number: jn,
    })
    setSaving(false)
    if (!error) { setNewRow(null); load(projectId) }
  }

  const fmt = v => v != null && v !== 0 ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'
  const fmtBal = v => v != null ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold" style={{ color: NAVY }}>الدفتر</h1>

      {/* فلتر التاريخ */}
      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3" style={{ border: '1px solid #e8e5dc' }}>
        <div className="text-sm font-bold uppercase tracking-wider text-center" style={{ color: '#8a7a5a' }}>الفترة الزمنية</div>
        <div className="flex flex-wrap gap-2 justify-center">
          {QUICK_PERIODS.map(p => (
            <button key={p.key} onClick={() => { setActivePeriod(p.key); setFilter(f => ({ ...getRange(p.key), type: f.type })) }}
              className="px-3 py-1.5 text-xs rounded-xl font-semibold transition-all"
              style={activePeriod === p.key
                ? { background: GOLD, color: NAVY }
                : { background: '#f5f4f0', color: '#4b5563' }
              }>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 items-end justify-center">
          <div className="flex-1 min-w-[8rem]">
            <label className="text-xs text-slate-500 block mb-1 text-center">من</label>
            <input type="date" value={filter.from}
              onChange={e => { setActivePeriod('custom'); setFilter(f => ({ ...f, from: e.target.value })) }}
              className="w-full border rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: '#d1c9b8' }}/>
          </div>
          <div className="flex-1 min-w-[8rem]">
            <label className="text-xs text-slate-500 block mb-1 text-center">إلى</label>
            <input type="date" value={filter.to}
              onChange={e => { setActivePeriod('custom'); setFilter(f => ({ ...f, to: e.target.value })) }}
              className="w-full border rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: '#d1c9b8' }}/>
          </div>
          <div className="flex-1 min-w-[8rem]">
            <label className="text-xs text-slate-500 block mb-1 text-center">النوع</label>
            <select value={filter.type}
              onChange={e => setFilter(f => ({ ...f, type: e.target.value }))}
              className="w-full border rounded-xl px-3 py-1.5 text-sm focus:outline-none"
              style={{ borderColor: '#d1c9b8' }}>
              <option value="">الكل</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {canEdit && (
            <div className="flex-1 min-w-[8rem]">
              <div className="mb-1 h-4" />
              <button onClick={() => setNewRow({ date: new Date().toISOString().split('T')[0], type:'', description:'', cash_in:'', cash_out:'', bank_in:'', bank_out:'', custody_in:'', custody_out:'' })}
                className="w-full px-4 py-1.5 text-sm font-bold rounded-xl transition-all text-center"
                style={{ background: NAVY, color: '#fff' }}>
                + إضافة قيد
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm overflow-x-auto" style={{ border: '1px solid #e8e5dc' }}>
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: GOLD, borderTopColor: 'transparent' }}/>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead style={{ background: NAVY }}>
              <tr>
                {[
                  'التاريخ','النوع','الوصف',
                  'خرج صندوق','دخل صندوق',
                  'خرج بنك','دخل بنك',
                  'خرج عهدة','دخل عهدة',
                ].map(h => (
                  <th key={h} className="px-3 py-3 text-right text-xs font-semibold whitespace-nowrap">{h}</th>
                ))}
                <th className="px-3 py-3 text-right text-xs font-semibold text-green-300 whitespace-nowrap">رصيد صندوق</th>
                <th className="px-3 py-3 text-right text-xs font-semibold text-blue-300 whitespace-nowrap">رصيد بنك</th>
                <th className="px-3 py-3 text-right text-xs font-semibold text-amber-300 whitespace-nowrap">رصيد عهدة</th>
                <th className="px-3 py-3 text-right text-xs font-semibold">الحالة</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredRows.length === 0 && (
                <tr><td colSpan={14} className="text-center py-10 text-slate-400">لا توجد بيانات</td></tr>
              )}
              {filteredRows.map(r => (
                <tr key={r.id} className={`hover:bg-slate-50 transition-colors ${r.status === 'cancelled' ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-3 text-slate-600 whitespace-nowrap font-mono text-xs">{r.date}</td>
                  <td className="px-3 py-3 text-slate-700 whitespace-nowrap text-xs">{r.type || '—'}</td>
                  <td className="px-3 py-3 text-slate-600 max-w-36 truncate text-xs">{r.description || '—'}</td>
                  <td className="px-3 py-3 text-red-600   tabular-nums text-xs text-right">{r.cash_out    > 0 ? fmt(r.cash_out)    : '—'}</td>
                  <td className="px-3 py-3 text-green-600 tabular-nums text-xs text-right">{r.cash_in    > 0 ? fmt(r.cash_in)    : '—'}</td>
                  <td className="px-3 py-3 text-red-600   tabular-nums text-xs text-right">{r.bank_out    > 0 ? fmt(r.bank_out)    : '—'}</td>
                  <td className="px-3 py-3 text-green-600 tabular-nums text-xs text-right">{r.bank_in    > 0 ? fmt(r.bank_in)    : '—'}</td>
                  <td className="px-3 py-3 text-red-600   tabular-nums text-xs text-right">{r.custody_out > 0 ? fmt(r.custody_out) : '—'}</td>
                  <td className="px-3 py-3 text-green-600 tabular-nums text-xs text-right">{r.custody_in > 0 ? fmt(r.custody_in) : '—'}</td>
                  {/* Running balances */}
                  <td className={`px-3 py-3 tabular-nums text-xs text-right font-semibold font-mono ${
                    r._cashBal == null ? 'text-slate-300' : r._cashBal < 0 ? 'text-red-600' : 'text-green-600'
                  }`}>{fmtBal(r._cashBal)}</td>
                  <td className={`px-3 py-3 tabular-nums text-xs text-right font-semibold font-mono ${
                    r._bankBal == null ? 'text-slate-300' : r._bankBal < 0 ? 'text-red-600' : 'text-blue-600'
                  }`}>{fmtBal(r._bankBal)}</td>
                  <td className={`px-3 py-3 tabular-nums text-xs text-right font-semibold font-mono ${
                    r._custodyBal == null ? 'text-slate-300' : r._custodyBal < 0 ? 'text-red-600' : 'text-amber-600'
                  }`}>{fmtBal(r._custodyBal)}</td>
                  <td className="px-3 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_BADGE[r.status] || 'bg-slate-100 text-slate-500'}`}>
                      {STATUS_LABEL[r.status] || r.status}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {canEdit && r.status !== 'cancelled' && (
                      <div className="flex gap-2">
                        <button onClick={() => setEditRow({ ...r })}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium">تعديل</button>
                        <button onClick={() => cancelEntry(r.id)}
                          className="text-xs text-red-400 hover:text-red-600 font-medium">إلغاء</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Row count */}
      {!loading && filteredRows.length > 0 && (
        <div className="text-xs text-slate-400 text-left">{filteredRows.length} صف معروض من {allRows.length} إجمالي</div>
      )}

      {/* New Entry Modal */}
      {newRow && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800">إضافة حركة جديدة</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-500 block mb-1">التاريخ</label>
                <input type="date" value={newRow.date} onChange={e => setNewRow(r => ({ ...r, date: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">النوع</label>
                <select value={newRow.type} onChange={e => setNewRow(r => ({ ...r, type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">— اختر —</option>
                  {types.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-500 block mb-1">الوصف</label>
                <input value={newRow.description} onChange={e => setNewRow(r => ({ ...r, description: e.target.value }))}
                  placeholder="اختياري" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
              </div>
              {['cash_out','cash_in','bank_out','bank_in','custody_out','custody_in'].map(k => (
                <div key={k}>
                  <label className="text-xs text-slate-500 block mb-1">
                    {{ cash_out:'خرج صندوق', cash_in:'دخل صندوق', bank_out:'خرج بنك', bank_in:'دخل بنك', custody_out:'خرج عهدة', custody_in:'دخل عهدة' }[k]}
                  </label>
                  <input type="number" value={newRow[k]} onChange={e => setNewRow(r => ({ ...r, [k]: e.target.value }))}
                    placeholder="0" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
                </div>
              ))}
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={saveNew} disabled={saving || !newRow.date || !newRow.type}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/><span>جارٍ...</span></> : 'حفظ القيد'}
              </button>
              <button onClick={() => setNewRow(null)}
                className="flex-1 bg-slate-100 text-slate-700 rounded-lg py-2.5 font-medium hover:bg-slate-200 transition-colors">رجوع</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editRow && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800">تعديل الحركة</h3>
            <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">سيتغير الحالة إلى "معدَّل" بعد الحفظ</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs text-slate-500 block mb-1">النوع</label>
                <select value={editRow.type || ''} onChange={e => setEditRow(r => ({ ...r, type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">— اختر —</option>
                  {types.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-500 block mb-1">الوصف</label>
                <input value={editRow.description || ''} onChange={e => setEditRow(r => ({ ...r, description: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
              </div>
              {['cash_out','cash_in','bank_out','bank_in','custody_out','custody_in'].map(k => (
                <div key={k}>
                  <label className="text-xs text-slate-500 block mb-1">
                    {{ cash_out:'خرج صندوق', cash_in:'دخل صندوق', bank_out:'خرج بنك', bank_in:'دخل بنك', custody_out:'خرج عهدة', custody_in:'دخل عهدة' }[k]}
                  </label>
                  <input type="number" value={editRow[k] || ''} onChange={e => setEditRow(r => ({ ...r, [k]: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
                </div>
              ))}
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={saveEdit}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 font-medium hover:bg-blue-700 transition-colors">حفظ</button>
              <button onClick={() => setEditRow(null)}
                className="flex-1 bg-slate-100 text-slate-700 rounded-lg py-2.5 font-medium hover:bg-slate-200 transition-colors">رجوع</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
