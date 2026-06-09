import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export default function Journals() {
  const { canEdit, projectId } = useAuth()
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (projectId) load(projectId) }, [projectId])

  async function load(pid) {
    setLoading(true)
    const { data } = await supabase.from('ledger_entries')
      .select('*').eq('project_id', pid)
      .eq('status','pending')
      .order('date', { ascending: false })
    setRows(data || [])
    setLoading(false)
  }

  async function approve(id) {
    await supabase.from('ledger_entries').update({ status: 'approved' }).eq('id', id)
    setRows(rows.filter(r => r.id !== id))
  }

  async function approveAll() {
    if (!projectId) return
    await supabase.from('ledger_entries')
      .update({ status: 'approved' })
      .eq('project_id', projectId).eq('status','pending')
    setRows([])
  }

  const fmt = v => v ? Number(v).toLocaleString('ar-SA', {minimumFractionDigits:2}) : '—'

  if (loading) return <div className="flex justify-center h-64 items-center"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">القيود المعلقة</h1>
          <p className="text-sm text-slate-500 mt-1">{rows.length} قيد بانتظار الاعتماد</p>
        </div>
        {canEdit && rows.length > 0 && (
          <button onClick={approveAll}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
            اعتماد الكل ✓
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 flex flex-col items-center justify-center py-16 text-slate-400">
          <span className="text-4xl mb-3">✅</span>
          <p className="font-medium">لا توجد قيود معلقة</p>
          <p className="text-sm mt-1">جميع الحركات معتمدة</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(r => (
            <div key={r.id} className="bg-white rounded-xl shadow-sm border border-yellow-100 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-800">{r.type || 'غير محدد'}</span>
                    <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">معلق</span>
                  </div>
                  <div className="text-sm text-slate-500">{r.description || '—'}</div>
                  <div className="flex gap-4 text-sm flex-wrap">
                    <span className="text-slate-500">📅 {r.date}</span>
                    {r.cash_out > 0 && <span className="text-red-600">خرج صندوق: {fmt(r.cash_out)}</span>}
                    {r.cash_in  > 0 && <span className="text-green-600">دخل صندوق: {fmt(r.cash_in)}</span>}
                    {r.bank_out > 0 && <span className="text-red-600">خرج بنك: {fmt(r.bank_out)}</span>}
                    {r.bank_in  > 0 && <span className="text-green-600">دخل بنك: {fmt(r.bank_in)}</span>}
                    {r.custody_out > 0 && <span className="text-red-600">خرج عهدة: {fmt(r.custody_out)}</span>}
                    {r.custody_in  > 0 && <span className="text-green-600">دخل عهدة: {fmt(r.custody_in)}</span>}
                  </div>
                  {r.file_url && (
                    <a href={r.file_url} target="_blank" rel="noreferrer"
                      className="text-xs text-blue-600 hover:underline">📎 عرض الفاتورة</a>
                  )}
                </div>
                {canEdit && (
                  <button onClick={() => approve(r.id)}
                    className="shrink-0 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
                    اعتماد
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
