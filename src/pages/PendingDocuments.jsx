import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { analyzeDocument } from '../lib/claude'

const TRANS_TYPES = [
  '💵 مبيعات كاش','🏦 مبيعات شبكة','🛒 مصروفات تشغيلية','💰 مصروفات ثابتة',
  '💳 قسط سيارة','💳 قسط شراء أرض','💳 قرض ١','💳 قرض ٢',
  '👤 صرف عهدة','💼 مسحوبات سليمان','💼 مسحوبات أم طوبى','🏛️ ضريبة القيمة المضافة','🔄 تحويل داخلي',
]

const ROLE_AR    = { purchasing: 'مسؤول المشتريات', accountant: 'المحاسب', owner: 'المالك', cashier: 'الكاشير' }
const ROLE_COLOR = {
  purchasing: 'bg-blue-100 text-blue-700',
  accountant: 'bg-purple-100 text-purple-700',
  owner:      'bg-amber-100 text-amber-700',
  cashier:    'bg-green-100 text-green-700',
}

export default function PendingDocuments() {
  const [docs, setDocs]       = useState([])
  const [loading, setLoading] = useState(true)
  const pidRef                = useRef(null)   // always up-to-date project id for async callbacks

  useEffect(() => { init() }, [])

  async function init() {
    const { data: proj } = await supabase.from('projects').select('id').eq('name', 'تحسيب-برو').maybeSingle()
    pidRef.current = proj?.id || null
    await loadDocs(proj?.id || null)
    setLoading(false)
  }

  async function loadDocs(pid) {
    const projectId = pid ?? pidRef.current
    let q = supabase.from('documents')
      .select('id,file_name,file_type,status,analysis_result,uploaded_at,uploaded_by')
      .in('status', ['uploaded', 'analyzed'])
      .order('uploaded_at', { ascending: false })
    if (projectId) q = q.eq('project_id', projectId)
    const { data } = await q
    setDocs((data || []).map(d => ({
      ...d,
      _state: 'idle', _error: '', _edit: d.analysis_result || null,
      _imageData: null, _showImage: false,
    })))
  }

  function updateDoc(id, patch) {
    setDocs(ds => ds.map(d => d.id === id ? { ...d, ...patch } : d))
  }

  async function loadImage(doc) {
    if (doc._imageData) { updateDoc(doc.id, { _showImage: !doc._showImage }); return }
    updateDoc(doc.id, { _loadingImg: true })
    const { data } = await supabase.from('documents').select('file_data').eq('id', doc.id).single()
    updateDoc(doc.id, { _imageData: data?.file_data || null, _showImage: true, _loadingImg: false })
  }

  async function analyze(doc) {
    updateDoc(doc.id, { _state: 'analyzing', _error: '' })
    try {
      const { data } = await supabase.from('documents').select('file_data').eq('id', doc.id).single()
      if (!data?.file_data) throw new Error('لا توجد بيانات الملف')
      const result = await analyzeDocument(data.file_data, doc.file_type, doc.file_name, doc.uploaded_by)
      await supabase.from('documents').update({ status: 'analyzed', analysis_result: result }).eq('id', doc.id)
      updateDoc(doc.id, {
        _state: 'analyzed', status: 'analyzed',
        analysis_result: result, _edit: result,
        _imageData: data.file_data, _showImage: true,
      })
    } catch(e) { updateDoc(doc.id, { _state: 'idle', _error: e.message }) }
  }

  async function approve(doc) {
    updateDoc(doc.id, { _state: 'approving' })
    const res = doc._edit || doc.analysis_result
    try {
      const amount = Number(res.amount) || 0
      const pay    = res.paySource || 'custody'

      if (res.type === 'sales') {
        const cash    = Number(res.cashSales)    || 0
        const network = Number(res.networkSales) || 0
        const date    = res.date

        const { error: e1 } = await supabase.from('sales').insert({
          project_id:    pidRef.current,
          date,
          cash_sales:    cash,
          network_sales: network,
          description:   'تقرير POS',
        })
        if (e1) throw new Error(e1.message)

        const entries = []
        if (cash > 0)    entries.push({ project_id: pidRef.current, date, type: '💵 مبيعات كاش',   description: 'مبيعات كاش — POS',   cash_in: cash,    cash_out: 0, bank_in: 0,       bank_out: 0, custody_in: 0, custody_out: 0, total_amount: cash,    status: 'approved' })
        if (network > 0) entries.push({ project_id: pidRef.current, date, type: '🏦 مبيعات شبكة', description: 'مبيعات شبكة — POS', cash_in: 0,       cash_out: 0, bank_in: network, bank_out: 0, custody_in: 0, custody_out: 0, total_amount: network, status: 'approved' })
        if (entries.length) {
          const { error: e2 } = await supabase.from('ledger_entries').insert(entries)
          if (e2) throw new Error(e2.message)
        }
      } else {
        const { error: err } = await supabase.from('ledger_entries').insert({
          project_id:   pidRef.current,
          date:         res.date,
          type:         res.transType || '',
          description:  res.description || doc.file_name,
          cash_out:     pay === 'cash'    ? amount : 0,
          bank_out:     pay === 'bank'    ? amount : 0,
          custody_out:  pay === 'custody' ? amount : 0,
          cash_in: 0, bank_in: 0, custody_in: 0,
          vat_amount:   Number(res.vatAmount) || 0,
          total_amount: amount,
          status:       'approved',
          file_url:     '',
        })
        if (err) throw new Error(err.message)
      }

      await supabase.from('documents').update({ status: 'approved' }).eq('id', doc.id)
      setDocs(ds => ds.filter(d => d.id !== doc.id))
    } catch(e) { updateDoc(doc.id, { _state: 'analyzed', _error: e.message }) }
  }

  async function reject(doc) {
    updateDoc(doc.id, { _state: 'rejecting' })
    try {
      await supabase.from('documents').update({ status: 'rejected' }).eq('id', doc.id)
      setDocs(ds => ds.filter(d => d.id !== doc.id))
    } catch(e) { updateDoc(doc.id, { _state: 'idle', _error: e.message }) }
  }

  const timeAgo = t => {
    const m = (Date.now() - new Date(t)) / 60000
    if (m < 60)   return `${Math.round(m)}د`
    if (m < 1440) return `${Math.round(m / 60)}س`
    return `${Math.round(m / 1440)}ي`
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
          <p className="text-sm text-slate-500 mt-1">{docs.length} مستند</p>
        </div>
        <button onClick={() => loadDocs(pidRef.current)}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium">↻ تحديث</button>
      </div>

      {docs.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center py-16 text-slate-400">
          <span className="text-4xl mb-3">📭</span>
          <p className="font-medium">لا توجد مستندات جديدة</p>
        </div>
      ) : docs.map(doc => (
        <DocCard key={doc.id} doc={doc}
          onLoadImage={() => loadImage(doc)}
          onAnalyze={() => analyze(doc)}
          onApprove={() => approve(doc)}
          onReject={() => reject(doc)}
          onEdit={(f, v) => updateDoc(doc.id, { _edit: { ...(doc._edit || doc.analysis_result || {}), [f]: v } })}
          timeAgo={timeAgo}
          TRANS_TYPES={TRANS_TYPES}
          ROLE_AR={ROLE_AR}
          ROLE_COLOR={ROLE_COLOR}
        />
      ))}
    </div>
  )
}

function DocCard({ doc, onLoadImage, onAnalyze, onApprove, onReject, onEdit, timeAgo, TRANS_TYPES, ROLE_AR, ROLE_COLOR }) {
  const res     = doc._edit || doc.analysis_result
  const busy    = ['analyzing','approving','rejecting'].includes(doc._state)
  const isImage = doc.file_type?.startsWith('image/')
  const fmt     = v => v ? Number(v).toLocaleString('ar-SA', { minimumFractionDigits: 2 }) : '—'

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-slate-50">
        <span className="text-2xl shrink-0">{isImage ? '🖼️' : '📄'}</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-800 truncate text-sm">{doc.file_name}</div>
          <div className="text-xs text-slate-400 mt-0.5">منذ {timeAgo(doc.uploaded_at)}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {doc.uploaded_by && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLOR[doc.uploaded_by] || 'bg-slate-100 text-slate-500'}`}>
              {ROLE_AR[doc.uploaded_by] || doc.uploaded_by}
            </span>
          )}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            doc.status === 'analyzed' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
          }`}>
            {doc.status === 'analyzed' ? 'محلَّل' : 'جديد'}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">

        {doc._error && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-red-700 text-sm">❌ {doc._error}</div>
        )}

        {/* File toggle */}
        <button onClick={onLoadImage} disabled={doc._loadingImg}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-blue-600 transition-colors font-medium">
          {doc._loadingImg
            ? <><div className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"/>جارٍ التحميل...</>
            : doc._showImage ? `🔼 إخفاء ${isImage ? 'الصورة' : 'الملف'}` : `👁 عرض ${isImage ? 'الصورة' : 'الملف PDF'}`
          }
        </button>

        {doc._showImage && doc._imageData && isImage && (
          <img
            src={`data:${doc.file_type};base64,${doc._imageData}`}
            alt={doc.file_name}
            className="w-full max-h-80 object-contain rounded-xl bg-slate-50 border border-slate-100"
          />
        )}
        {doc._showImage && doc._imageData && !isImage && (
          <div className="space-y-2">
            <iframe
              src={`data:application/pdf;base64,${doc._imageData}`}
              className="w-full rounded-xl border border-slate-200"
              style={{ height: '500px' }}
              title={doc.file_name}
            />
            <a
              href={`data:application/pdf;base64,${doc._imageData}`}
              download={doc.file_name}
              className="flex items-center justify-center gap-2 w-full py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
            >
              ⬇️ تحميل الملف
            </a>
          </div>
        )}
        {/* Analyze */}
        {doc.status === 'uploaded' && (
          <button onClick={onAnalyze} disabled={busy}
            className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {doc._state === 'analyzing'
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/><span>جارٍ التحليل...</span></>
              : '🤖 تحليل بالذكاء الاصطناعي'
            }
          </button>
        )}

        {/* Analysis result */}
        {(doc.status === 'analyzed' || doc._state === 'analyzed') && res && (
          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">نتيجة التحليل — عدّل إن لزم ثم اعتمد</div>

            <div className="bg-slate-50 rounded-xl p-3 grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-slate-400 text-xs block">التاريخ</span><span className="font-medium">{res.date}</span></div>
              {res.type === 'sales'
                ? <div><span className="text-slate-400 text-xs block">الإجمالي</span><span className="font-semibold text-green-700">{fmt(res.totalSales || ((res.cashSales || 0) + (res.networkSales || 0)))} ر.س</span></div>
                : <div><span className="text-slate-400 text-xs block">المبلغ</span><span className="font-semibold text-red-700">{fmt(res.amount)} ر.س</span></div>
              }
              {res.type !== 'sales' && <div><span className="text-slate-400 text-xs block">البند</span><span className="font-medium">{res.transType || '—'}</span></div>}
              {res.type !== 'sales' && <div><span className="text-slate-400 text-xs block">مصدر الدفع</span><span className="font-medium">{{ cash: 'الصندوق', bank: 'البنك', custody: 'العهدة' }[res.paySource] || res.paySource || '—'}</span></div>}
              {res.description && <div className="col-span-2"><span className="text-slate-400 text-xs block">الوصف</span><span>{res.description}</span></div>}
            </div>

            <details className="group">
              <summary className="text-sm text-blue-600 cursor-pointer hover:text-blue-800 font-medium list-none flex items-center gap-1">
                <span className="group-open:rotate-90 transition-transform inline-block">▶</span> تعديل البيانات
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">التاريخ</label>
                  <input type="date" value={res.date || ''} onChange={e => onEdit('date', e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
                </div>
                {res.type !== 'sales' && (
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">المبلغ</label>
                    <input type="number" value={res.amount || ''} onChange={e => onEdit('amount', e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
                  </div>
                )}
                {res.type !== 'sales' && (
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">البند المحاسبي</label>
                    <select value={res.transType || ''} onChange={e => onEdit('transType', e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                      <option value="">— اختر —</option>
                      {TRANS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                )}
                {res.type !== 'sales' && (
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">مصدر الدفع</label>
                    <select value={res.paySource || 'custody'} onChange={e => onEdit('paySource', e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                      <option value="cash">💵 الصندوق</option>
                      <option value="bank">🏦 البنك / مدى</option>
                      <option value="custody">👤 العهدة</option>
                    </select>
                  </div>
                )}
                {res.type === 'sales' && (
                  <>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">مبيعات كاش</label>
                      <input type="number" value={res.cashSales || ''} onChange={e => onEdit('cashSales', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">مبيعات شبكة</label>
                      <input type="number" value={res.networkSales || ''} onChange={e => onEdit('networkSales', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
                    </div>
                  </>
                )}
                <div className="col-span-2">
                  <label className="text-xs text-slate-400 block mb-1">الوصف</label>
                  <input value={res.description || ''} onChange={e => onEdit('description', e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
                </div>
              </div>
            </details>

            {/* Action buttons */}
            <div className="flex gap-2 pt-1">
              <button onClick={onApprove} disabled={busy}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
                {doc._state === 'approving'
                  ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/><span>جارٍ...</span></>
                  : '✓ اعتماد وحفظ'
                }
              </button>
              <button onClick={onReject} disabled={busy}
                className="px-4 py-2.5 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-semibold hover:bg-red-600 hover:text-white transition-colors disabled:opacity-50">
                {doc._state === 'rejecting' ? '...' : '✕ رد'}
              </button>
            </div>
          </div>
        )}

        {/* Reject button for non-analyzed docs */}
        {doc.status === 'uploaded' && doc._state !== 'analyzing' && (
          <button onClick={onReject} disabled={busy}
            className="w-full py-2 bg-slate-50 text-slate-500 border border-slate-200 rounded-xl text-sm font-medium hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors disabled:opacity-50">
            ✕ رد المستند
          </button>
        )}
      </div>
    </div>
  )
}
