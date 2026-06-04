import React, { useState, useRef } from 'react'
import { analyzeDocument } from '../lib/claude'

const TYPE_LABELS = {
  sales:   'تقرير مبيعات POS',
  auto:    'مستند واضح',
  expense: 'فاتورة / مصروف',
}

export default function InvoiceUpload() {
  const [file, setFile]       = useState(null)
  const [preview, setPreview] = useState(null)
  const [result, setResult]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef()

  function handleFile(f) {
    if (!f) return
    const allowed = ['image/jpeg','image/jpg','image/png','image/webp','image/heic','application/pdf']
    if (!allowed.includes(f.type)) {
      setError('صيغة غير مدعومة. المدعوم: JPG, PNG, WEBP, HEIC, PDF')
      return
    }
    setFile(f)
    setResult(null)
    setError('')
    if (f.type.startsWith('image/')) {
      setPreview(URL.createObjectURL(f))
    } else {
      setPreview(null)
    }
  }

  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    handleFile(e.dataTransfer.files[0])
  }

  async function analyze() {
    if (!file) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const reader = new FileReader()
      reader.onload = async (e) => {
        const base64 = e.target.result.split(',')[1]
        try {
          const res = await analyzeDocument(base64, file.type, file.name)
          setResult(res)
        } catch (err) {
          setError(err.message || 'فشل التحليل')
        } finally {
          setLoading(false)
        }
      }
      reader.readAsDataURL(file)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  function reset() {
    setFile(null)
    setPreview(null)
    setResult(null)
    setError('')
  }

  const fmt = v => v ? Number(v).toLocaleString('ar-SA', {minimumFractionDigits:2}) : '—'

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">رفع وتحليل مستند</h1>
        <p className="text-slate-500 text-sm mt-1">ارفع فاتورة أو إيصال وسيحللها النظام تلقائياً</p>
      </div>

      {/* Upload Zone */}
      {!file && (
        <div
          onDragOver={e=>{e.preventDefault();setDragOver(true)}}
          onDragLeave={()=>setDragOver(false)}
          onDrop={onDrop}
          onClick={()=>inputRef.current.click()}
          className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-200
            ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'}`}
        >
          <div className="text-5xl mb-4">📤</div>
          <p className="font-semibold text-slate-700 text-lg mb-2">اسحب الملف هنا أو انقر للاختيار</p>
          <p className="text-sm text-slate-400">JPG · PNG · WEBP · HEIC · PDF</p>
          <input ref={inputRef} type="file" accept="image/*,.pdf" className="hidden"
            onChange={e=>handleFile(e.target.files[0])} />
        </div>
      )}

      {/* File Preview */}
      {file && !result && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{file.type.startsWith('image/') ? '🖼️' : '📄'}</span>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-slate-800 truncate">{file.name}</div>
              <div className="text-xs text-slate-400">{(file.size/1024).toFixed(0)} KB</div>
            </div>
            <button onClick={reset} className="text-slate-400 hover:text-red-500 transition-colors text-xl">✕</button>
          </div>

          {preview && (
            <img src={preview} alt="preview" className="w-full max-h-64 object-contain rounded-xl bg-slate-50"/>
          )}

          <button
            onClick={analyze}
            disabled={loading}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold text-base hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                <span>جارٍ التحليل...</span>
              </>
            ) : (
              <>🤖 تحليل بالذكاء الاصطناعي</>
            )}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-red-700 text-sm font-medium">
          ❌ {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-white rounded-2xl shadow-sm border border-green-100 p-5 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <span className="text-2xl">✅</span>
            <div>
              <div className="font-bold text-slate-800">نتيجة التحليل</div>
              <div className="text-xs text-slate-500">{TYPE_LABELS[result.type] || result.type}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { label:'التاريخ',       value: result.date },
              { label:'نوع المستند',   value: TYPE_LABELS[result.type] || result.type },
              result.type === 'sales' && { label:'مبيعات كاش',   value: `${fmt(result.cashSales)} ر.س` },
              result.type === 'sales' && { label:'مبيعات شبكة',  value: `${fmt(result.networkSales)} ر.س` },
              result.type === 'sales' && { label:'الإجمالي',     value: `${fmt(result.totalSales)} ر.س` },
              result.type !== 'sales' && { label:'المبلغ',       value: `${fmt(result.amount)} ر.س` },
              result.type !== 'sales' && result.vatAmount > 0 && { label:'الضريبة',    value: `${fmt(result.vatAmount)} ر.س` },
              result.transType && { label:'نوع الحركة',  value: result.transType },
              result.paySource && { label:'مصدر الدفع',  value: { cash:'الصندوق', bank:'البنك', custody:'العهدة' }[result.paySource] || result.paySource },
              result.description && { label:'الوصف',     value: result.description },
            ].filter(Boolean).map((item, i) => (
              <div key={i} className="bg-slate-50 rounded-xl p-3">
                <div className="text-xs text-slate-400 mb-1">{item.label}</div>
                <div className="text-sm font-semibold text-slate-800">{item.value || '—'}</div>
              </div>
            ))}
          </div>

          <button onClick={reset}
            className="w-full py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
            تحليل مستند جديد
          </button>
        </div>
      )}
    </div>
  )
}
