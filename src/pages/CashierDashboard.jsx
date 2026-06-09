import React, { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { uploadToStorage } from '../lib/storage'

export default function CashierDashboard() {
  const { role, projectId } = useAuth()

  const [file, setFile]           = useState(null)
  const [preview, setPreview]     = useState(null)
  const [uploading, setUploading] = useState(false)
  const [done, setDone]           = useState(false)
  const [error, setError]         = useState('')
  const [dragOver, setDragOver]   = useState(false)
  const inputRef = useRef()

  function handleFile(f) {
    if (!f) return
    const allowed = ['image/jpeg','image/jpg','image/png','image/webp','image/heic','application/pdf']
    if (!allowed.includes(f.type)) { setError('صيغة غير مدعومة'); return }
    if (f.size > 10 * 1024 * 1024) { setError('الحد الأقصى 10MB'); return }
    setFile(f); setDone(false); setError('')
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : null)
  }

  async function upload() {
    if (!file) return
    setUploading(true); setError('')
    try {
      const fileUrl = await uploadToStorage(file, projectId || 'shared')
      const { error: err } = await supabase.from('documents').insert({
        project_id:  projectId,
        file_name:   file.name,
        file_type:   file.type,
        file_url:    fileUrl,
        status:      'uploaded',
        uploaded_by: role,
      })
      if (err) throw new Error(err.message)
      setDone(true); setFile(null); setPreview(null)
    } catch (e) { setError(e.message) }
    finally { setUploading(false) }
  }

  function reset() { setFile(null); setPreview(null); setDone(false); setError('') }

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">لوحة الكاشير</h1>
        <p className="text-slate-500 text-sm mt-1">ارفع ملخص مبيعات أو فاتورة مشتريات — سيراجعها المحاسب ويعتمدها</p>
      </div>

      {done ? (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-10 text-center space-y-3">
          <div className="text-5xl">✅</div>
          <div className="text-lg font-bold text-green-800">تم رفع المستند بنجاح</div>
          <p className="text-sm text-green-600">سيراجعه المحاسب ويعتمده قريباً</p>
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
          <p className="text-xs text-slate-400 mt-0.5">JPG · PNG · PDF (حتى 10MB)</p>
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
          <button onClick={upload} disabled={uploading}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {uploading
              ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/><span>جارٍ الرفع...</span></>
              : '⬆️ رفع المستند'}
          </button>
        </div>
      )}

      {error && !file && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-red-700 text-sm font-medium">❌ {error}</div>
      )}

      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-xs text-amber-700 space-y-1">
        <p>⚠️ المستندات المرفوعة تنتظر مراجعة المحاسب قبل تسجيلها في الدفتر.</p>
      </div>
    </div>
  )
}
