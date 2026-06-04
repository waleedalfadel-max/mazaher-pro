import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const TYPES = [
  '💵 مبيعات كاش','🏦 مبيعات شبكة','🛒 مصروفات تشغيلية','💰 مصروفات ثابتة',
  '💳 قسط سيارة','💳 قسط شراء أرض','💳 قرض ١','💳 قرض ٢',
  '👤 صرف عهدة','💼 مسحوبات سليمان','💼 مسحوبات أم طوبى','🏛️ ضريبة القيمة المضافة','🔄 تحويل داخلي',
]

const STATUS_BADGE = {
  approved: 'bg-green-100 text-green-700',
  auto:     'bg-blue-100 text-blue-700',
  pending:  'bg-yellow-100 text-yellow-700',
}

const STATUS_LABEL = { approved:'معتمد', auto:'تلقائي', pending:'معلق' }

export default function Ledger() {
  const { canEdit } = useAuth()
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(true)
  const [projectId, setProjectId] = useState(null)
  const [editRow, setEditRow] = useState(null)
  const [filter, setFilter] = useState({ from: '', to: '', type: '' })

  useEffect(() => { init() }, [])

  async function init() {
    const { data } = await supabase.from('projects').select('id').eq('name','مزاهر').single()
    if (data) { setProjectId(data.id); await load(data.id) }
    setLoading(false)
  }

  async function load(pid) {
    let q = supabase.from('ledger_entries')
      .select('*').eq('project_id', pid || projectId)
      .order('date', { ascending: false }).limit(200)
    if (filter.from) q = q.gte('date', filter.from)
    if (filter.to)   q = q.lte('date', filter.to)
    if (filter.type) q = q.eq('type', filter.type)
    const { data } = await q
    setRows(data || [])
  }

  async function saveEdit() {
    if (!editRow) return
    await supabase.from('ledger_entries').update({
      type:        editRow.type,
      description: editRow.description,
      cash_out:    Number(editRow.cash_out) || 0,
      cash_in:     Number(editRow.cash_in)  || 0,
      bank_out:    Number(editRow.bank_out) || 0,
      bank_in:     Number(editRow.bank_in)  || 0,
      custody_out: Number(editRow.custody_out) || 0,
      custody_in:  Number(editRow.custody_in)  || 0,
      status:      editRow.status,
    }).eq('id', editRow.id)
    setEditRow(null)
    await load()
  }

  const fmt = v => v ? Number(v).toLocaleString('ar-SA', {minimumFractionDigits:2}) : '—'

  if (loading) return <div className="flex justify-center h-64 items-center"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">الدفتر</h1>
        {!canEdit && <span className="text-xs bg-slate-100 text-slate-500 px-3 py-1 rounded-full">عرض فقط</span>}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-slate-500 block mb-1">من تاريخ</label>
          <input type="date" value={filter.from} onChange={e=>setFilter(f=>({...f,from:e.target.value}))}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">إلى تاريخ</label>
          <input type="date" value={filter.to} onChange={e=>setFilter(f=>({...f,to:e.target.value}))}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">النوع</label>
          <select value={filter.type} onChange={e=>setFilter(f=>({...f,type:e.target.value}))}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option value="">الكل</option>
            {TYPES.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button onClick={()=>load()} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          بحث
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              {['التاريخ','النوع','الوصف','خرج صندوق','دخل صندوق','خرج بنك','دخل بنك','خرج عهدة','دخل عهدة','الحالة',''].map(h=>(
                <th key={h} className="px-4 py-3 text-right text-xs font-semibold text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.length === 0 && (
              <tr><td colSpan={11} className="text-center py-10 text-slate-400">لا توجد بيانات</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.date}</td>
                <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{r.type || '—'}</td>
                <td className="px-4 py-3 text-slate-600 max-w-40 truncate">{r.description || '—'}</td>
                <td className="px-4 py-3 text-red-600 tabular-nums">{r.cash_out > 0 ? fmt(r.cash_out) : '—'}</td>
                <td className="px-4 py-3 text-green-600 tabular-nums">{r.cash_in > 0 ? fmt(r.cash_in) : '—'}</td>
                <td className="px-4 py-3 text-red-600 tabular-nums">{r.bank_out > 0 ? fmt(r.bank_out) : '—'}</td>
                <td className="px-4 py-3 text-green-600 tabular-nums">{r.bank_in > 0 ? fmt(r.bank_in) : '—'}</td>
                <td className="px-4 py-3 text-red-600 tabular-nums">{r.custody_out > 0 ? fmt(r.custody_out) : '—'}</td>
                <td className="px-4 py-3 text-green-600 tabular-nums">{r.custody_in > 0 ? fmt(r.custody_in) : '—'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_BADGE[r.status] || 'bg-slate-100 text-slate-500'}`}>
                    {STATUS_LABEL[r.status] || r.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {canEdit && (
                    <button onClick={()=>setEditRow({...r})}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium">تعديل</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit Modal */}
      {editRow && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-800">تعديل الحركة</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs text-slate-500 block mb-1">النوع</label>
                <select value={editRow.type || ''} onChange={e=>setEditRow(r=>({...r,type:e.target.value}))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">— اختر —</option>
                  {TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-500 block mb-1">الوصف</label>
                <input value={editRow.description||''} onChange={e=>setEditRow(r=>({...r,description:e.target.value}))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
              </div>
              {['cash_out','cash_in','bank_out','bank_in','custody_out','custody_in'].map(k=>(
                <div key={k}>
                  <label className="text-xs text-slate-500 block mb-1">
                    {{cash_out:'خرج صندوق',cash_in:'دخل صندوق',bank_out:'خرج بنك',bank_in:'دخل بنك',custody_out:'خرج عهدة',custody_in:'دخل عهدة'}[k]}
                  </label>
                  <input type="number" value={editRow[k]||''} onChange={e=>setEditRow(r=>({...r,[k]:e.target.value}))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
                </div>
              ))}
              <div>
                <label className="text-xs text-slate-500 block mb-1">الحالة</label>
                <select value={editRow.status||'pending'} onChange={e=>setEditRow(r=>({...r,status:e.target.value}))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="pending">معلق</option>
                  <option value="auto">تلقائي</option>
                  <option value="approved">معتمد</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={saveEdit} className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 font-medium hover:bg-blue-700 transition-colors">حفظ</button>
              <button onClick={()=>setEditRow(null)} className="flex-1 bg-slate-100 text-slate-700 rounded-lg py-2.5 font-medium hover:bg-slate-200 transition-colors">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
