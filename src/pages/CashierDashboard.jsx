import React, { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { analyzeDocument } from '../lib/claude'
import { useAuth } from '../contexts/AuthContext'

function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload  = e => res(e.target.result.split(',')[1])
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

export default function CashierDashboard() {
  const { role } = useAuth()

  const [projectId, setProjectId] = useState(null)
  const [file, setFile]           = useState(null)
  const [preview, setPreview]     = useState(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult]       = useState(null) // { type, label, details }
  const [error, setError]         = useState('')
  const [dragOver, setDragOver]   = useState(false)
  const inputRef = useRef()

  useEffect(() => {
    supabase.from('projects').select('id').eq('name', 'تحسيب-برو').maybeSingle()
      .then(({ data }) => { if (data) setProjectId(data.id) })
  }, [])

  function handleFile(f) {
    if (!f) return
    const allowed = ['image/jpeg','image/jpg','image/png','image/webp','image/heic','application/pdf']
    if (!allowed.includes(f.type)) { setError('صيغة غير مدعومة'); return }
    if (f.size > 4 * 1024 * 1024) { setError('الحد الأقصى 4MB'); return }
    setFile(f); setResult(null); setError('')
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : null)
  }

  async function analyze() {
    if (!file) return
    setUploading(true); setError('')
    try {
      const base64 = await toBase64(file)
      const analysis = await analyzeDocument(base64, file.type, file.name)

      if (analysis.type === 'sales') {
        const cash    = Number(analysis.cashSales)    || 0
        const network = Number(analysis.networkSales) || 0
        const date    = analysis.date

        const { error: e1 } = await supabase.from('sales').insert({
          project_id: projectId, date,
          cash_sales: cash, network_sales: network,
          description: 'تقرير POS — كاشير',
        })
        if (e1) throw new Error(e1.message)

        const entries = []
        if (cash > 0)    entries.push({ project_id: projectId, date, type: '💵 مبيعات كاش',   description: 'مبيعات كاش — POS',   cash_in: cash,    cash_out: 0, bank_in: 0,       bank_out: 0, custody_in: 0, custody_out: 0, total_amount: cash,    status: 'auto' })
        if (network > 0) entries.push({ project_id: projectId, date, type: '🏦 مبيعات شبكة', description: 'مبيعات شبكة — POS', cash_in: 0,       cash_out: 0, bank_in: network, bank_out: 0, custody_in: 0, custody_out: 0, total_amount: network, status: 'auto' })
        if (entries.length) {
          const { error: e2 } = await supabase.from('ledger_entries').insert(entries)
          if (e2) throw new Error(e2.message)
        }

        const fmt = v => (v || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2 })
        setResult({
          type: 'sales',
          label: 'تم تسجيل المبيعات',
          details: [
            cash    > 0 ? `💵 كاش → الصندوق: ${fmt(cash)} ر.س`    : null,
            network > 0 ? `🏦 شبكة → البنك: ${fmt(network)} ر.س` : null,
          ].filter(Boolean),
        })
      } else {
        const amount = Number(analysis.amount) || 0
        const date   = analysis.date
        const paySource = analysis.paySource || 'cash'

        const entry = {
          project_id:   projectId, date,
          type:         analysis.transType || '🛒 مصروفات تشغيلية',
          description:  analysis.description || file.name,
          cash_in: 0, bank_in: 0, custody_in: 0,
          cash_out:     paySource === 'cash'    ? amount : 0,
          bank_out:     paySource === 'bank'    ? amount : 0,
          custody_out:  paySource === 'custody' ? amount : 0,
          vat_amount:   Number(analysis.vatAmount) || 0,
          total_amount: amount,
          status: 'auto',
        }
        const { error: e1 } = await supabase.from('ledger_entries').insert(entry)
        if (e1) throw new Error(e1.message)

        const fmt = v => (v || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2 })
        const src = paySource === 'bank' ? 'البنك' : paySource === 'custody' ? 'العهدة' : 'الصندوق'
        setResult({
          type: 'expense',
          label: 'تم تسجيل الفاتورة',
          details: [
            `${analysis.transType || '🛒 مصروفات تشغيلية'}: ${fmt(amount)} ر.س`,
            `خُصم من: ${src}`,
          ],
        })
      }

      await supabase.from('documents').insert({
        project_id: projectId, file_name: file.name,
        file_type: file.type, file_data: base64,
        status: 'approved', uploaded_by: role,
        analysis_result: analysis,
      })

      setFile(null); setPreview(null)
    } catch (e) { setError(e.message) }
    finally { setUploading(false) }
  }

  function reset() { setFile(null); setPreview(null); setResult(null); setError('') }

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">لوحة الكاشير</h1>
        <p className="text-slate-500 text-sm mt-1">ارفع ملخص مبيعات أو فاتورة مشتريات — الذكاء الاصطناعي يحللها تلقائياً</p>
      </div>

      {result ? (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-8 text-center space-y-3">
          <div className="text-5xl">✅</div>
          <div className="text-lg font-bold text-green-800">{result.label}</div>
          <div className="space-y-1">
            {result.details.map((d, i) => (
              <p key={i} className="text-sm text-green-700">{d}</p>
            ))}
          </div>
          <button onClick={reset}
            className="mt-2 px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
            رفع مستند آخر
          </button>
        </div>
      ) : !file ? (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }}
          onClick={() => inputRef.current.click()}
          className={`border-2 border-dashed rounded-2xl p-14 text-center cursor-pointer transition-all duration-200
            ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'}`}
        >
          <div className="text-5xl mb-4">📤</div>
          <p className="font-semibold text-slate-700 text-lg mb-2">اسحب الملف هنا أو انقر للاختيار</p>
          <p className="text-xs text-slate-400 mt-1">ملخص مبيعات أو فاتورة مشتريات</p>
          <p className="text-xs text-slate-400 mt-0.5">JPG · PNG · PDF (حتى 4MB)</p>
          <input ref={inputRef} type="file" accept="image/*,.pdf" capture="environment" className="hidden"
            onChange={e => handleFile(e.target.files[0])} />
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{file.type.startsWith('image/') ? '🖼️' : '📄'}</span>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-slate-800 truncate">{file.name}</div>
              <div className="text-xs text-slate-400">{(file.size / 1024).toFixed(0)} KB</div>
            </div>
            <button onClick={reset} className="text-slate-400 hover:text-red-500 text-xl">✕</button>
          </div>
          {preview && (
            <img src={preview} alt="preview"
              className="w-full max-h-60 object-contain rounded-xl bg-slate-50 border border-slate-100"/>
          )}
          {error && <p className="text-red-600 text-sm font-medium">❌ {error}</p>}
          <button onClick={analyze} disabled={uploading}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {uploading
              ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/><span>جارٍ التحليل...</span></>
              : '🤖 تحليل وتسجيل'}
          </button>
        </div>
      )}

      {error && !file && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-red-700 text-sm font-medium">❌ {error}</div>
      )}

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-600 space-y-1">
        <p>💵 <span className="font-medium">ملخص مبيعات:</span> كاش → الصندوق · شبكة → البنك</p>
        <p>🧾 <span className="font-medium">فاتورة مشتريات:</span> تُخصم من الصندوق أو البنك تلقائياً</p>
      </div>
    </div>
  )
}
