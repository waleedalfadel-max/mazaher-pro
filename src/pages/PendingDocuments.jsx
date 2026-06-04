import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { analyzeDocument } from '../lib/claude'

const TYPE_LABELS = { sales:'تقرير مبيعات POS', auto:'مستند واضح', expense:'فاتورة / مصروف' }

const TRANS_TYPES = [
  '💵 مبيعات كاش','🏦 مبيعات شبكة','🛒 مصروفات تشغيلية','💰 مصروفات ثابتة',
  '💳 قسط سيارة','💳 قسط شراء أرض','💳 قرض ١','💳 قرض ٢',
  '👤 صرف عهدة','💼 مسحوبات سليمان','💼 مسحوبات أم طوبى','🏛️ ضريبة القيمة المضافة','🔄 تحويل داخلي',
]

export default function PendingDocuments() {
  const [docs, setDocs]       = useState([])
  const [loading, setLoading] = useState(true)
  const [projectId, setProjectId] = useState(null)

  useEffect(() => { init() }, [])

  async function init() {
    const { data: proj } = await supabase.from('projects').select('id').eq('name','مزاهر').single()
    if (proj) {
      setProjectId(proj.id)
      await loadDocs(proj.id)
    }
    setLoading(false)
  }

  async function loadDocs(pid) {
    const { data } = await supabase.from('documents')
      .select('id,file_name,file_type,status,analysis_result,uploaded_at')
      .eq('project_id', pid || projectId)
      .in('status', ['uploaded','analyzed'])
      .order('uploaded_at', { ascending: false })
    setDocs((data || []).map(d => ({ ...d, _state: 'idle', _error: '' })))
  }

  function updateDoc(id, patch) {
    setDocs(ds => ds.map(d => d.id === id ? { ...d, ...patch } : d))
  }

  async function analyze(doc) {
    updateDoc(doc.id, { _state: 'analyzing', _error: '' })
    try {
      // جلب base64 من قاعدة البيانات
      const { data } = await supabase.from('documents')
        .select('file_data').eq('id', doc.id).single()
      if (!data?.file_data) throw new Error('لا توجد بيانات الملف')

      const result = await analyzeDocument(data.file_data, doc.file_type, doc.file_name)

      await supabase.from('documents').update({
        status: 'analyzed',
        analysis_result: result,
      }).eq('id', doc.id)

      updateDoc(doc.id, { _state: 'analyzed', status: 'analyzed', analysis_result: result, _edit: result })
    } catch (e) {
      updateDoc(doc.id, { _state: 'idle', _error: e.message })
    }
  }

  async function approve(doc) {
    updateDoc(doc.id, { _state: 'approving' })
    const res = doc._edit || doc.analysis_result
    try {
      const amount = Number(res.amount) || 0
      const pay    = res.paySource || 'custody'

      if (res.type === 'sales') {
        const { error: err } = await supabase.from('sales').insert({
          project_id:    projectId,
          date:          res.date,
          cash_sales:    Number(res.cashSales)    || 0,
          network_sales: Number(res.networkSales) || 0,
          description:   'تقرير POS',
          file_url:      '',
        })
        if (err) throw new Error(err.message)
      } else {
        const { error: err } = await supabase.from('ledger_entries').insert({
          project_id:   projectId,
          date:         res.date,
          type:         res.transType || '',
          description:  res.description || doc.file_name,
          cash_out:     pay === 'cash'    ? amount : 0,
          bank_out:     pay === 'bank'    ? amount : 0,
          custody_out:  pay === 'custody' ? amount : 0,
          cash_in:      0, bank_in: 0, custody_in: 0,
          vat_amount:   Number(res.vatAmount) || 0,
          total_amount: amount,
          status:       'approved',
          file_url:     '',
        })
        if (err) throw new Error(err.message)
      }

      await supabase.from('documents').update({ status: 'approved' }).eq('id', doc.id)
      setDocs(ds => ds.filter(d => d.id !== doc.id))
    } catch (e) {
      updateDoc(doc.id, { _state: 'analyzed', _error: e.message })
    }
  }

  const fmt = v => v ? Number(v).toLocaleString('ar-SA', {minimumFractionDigits:2}) : '—'
  const timeAgo = t => {
    const diff = (Date.now() - new Date(t)) / 60000
    if (diff < 60) return `منذ ${Math.round(diff)} دقيقة`
    if (diff < 1440) return `منذ ${Math.round(diff/60)} ساعة`
    return `منذ ${Math.round(diff/1440)} يوم`
  }

  if (loading) return (
    <div className="flex justify-center h-64 items-center">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">مستندات بانتظار المراجعة</h1>
          <p className="text-sm text-slate-500 mt-1">{docs.length} مستند مرفوع من مسؤول المشتريات</p>
        </div>
        <button onClick={() => loadDocs()} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
          ↻ تحديث
        </button>
      </div>

      {docs.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center py-16 text-slate-400">
          <span className="text-4xl mb-3">📭</span>
          <p className="font-medium">لا توجد مستندات جديدة</p>
          <p className="text-sm mt-1">جميع المستندات تمت مراجعتها</p>
        </div>
      ) : (
        <div className="space-y-4">
          {docs.map(doc => (
            <DocCard
              key={doc.id}
              doc={doc}
              onAnalyze={() => analyze(doc)}
              onApprove={() => approve(doc)}
              onEditChange={(field, val) => updateDoc(doc.id, { _edit: { ...(doc._edit || doc.analysis_result), [field]: val } })}
              fmt={fmt}
              timeAgo={timeAgo}
              TRANS_TYPES={TRANS_TYPES}
              TYPE_LABELS={TYPE_LABELS}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DocCard({ doc, onAnalyze, onApprove, onEditChange, fmt, timeAgo, TRANS_TYPES, TYPE_LABELS }) {
  const res  = doc._edit || doc.analysis_result
  const busy = doc._state === 'analyzing' || doc._state === 'approving'

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-2xl shrink-0">{doc.file_type?.startsWith('image/') ? '🖼️' : '📄'}</span>
          <div className="min-w-0">
            <div className="font-semibold text-slate-800 truncate">{doc.file_name}</div>
            <div className="text-xs text-slate-400">{timeAgo(doc.uploaded_at)}</div>
          </div>
        </div>
        <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-medium ${
          doc.status === 'analyzed' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
        }`}>
          {doc.status === 'analyzed' ? 'تم التحليل' : 'مرفوع'}
        </span>
      </div>

      {/* Error */}
      {doc._error && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-red-700 text-sm">❌ {doc._error}</div>
      )}

      {/* Not analyzed yet */}
      {doc.status === 'uploaded' && (
        <button onClick={onAnalyze} disabled={busy}
          className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {doc._state === 'analyzing'
            ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/><span>جارٍ التحليل...</span></>
            : '🤖 تحليل بالذكاء الاصطناعي'
          }
        </button>
      )}

      {/* Analysis result — editable */}
      {(doc.status === 'analyzed' || doc._state === 'analyzed') && res && (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">نتيجة التحليل — يمكن التعديل قبل الاعتماد</div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">التاريخ</label>
              <input type="date" value={res.date || ''} onChange={e=>onEditChange('date', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
            </div>
            {res.type !== 'sales' && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">المبلغ</label>
                <input type="number" value={res.amount || ''} onChange={e=>onEditChange('amount', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
              </div>
            )}
            {res.type !== 'sales' && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">نوع الحركة</label>
                <select value={res.transType || ''} onChange={e=>onEditChange('transType', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">— اختر —</option>
                  {TRANS_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}
            {res.type !== 'sales' && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">مصدر الدفع</label>
                <select value={res.paySource || 'custody'} onChange={e=>onEditChange('paySource', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="cash">الصندوق</option>
                  <option value="bank">البنك</option>
                  <option value="custody">العهدة</option>
                </select>
              </div>
            )}
            {res.type === 'sales' && (
              <>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">مبيعات كاش</label>
                  <input type="number" value={res.cashSales || ''} onChange={e=>onEditChange('cashSales', e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">مبيعات شبكة</label>
                  <input type="number" value={res.networkSales || ''} onChange={e=>onEditChange('networkSales', e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
                </div>
              </>
            )}
            <div className="col-span-2">
              <label className="text-xs text-slate-400 block mb-1">الوصف</label>
              <input value={res.description || ''} onChange={e=>onEditChange('description', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
            </div>
          </div>

          <button onClick={onApprove} disabled={busy}
            className="w-full py-3 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {doc._state === 'approving'
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/><span>جارٍ الاعتماد...</span></>
              : '✓ اعتماد وحفظ في الدفتر'
            }
          </button>
        </div>
      )}
    </div>
  )
}
