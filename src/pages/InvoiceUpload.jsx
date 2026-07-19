import React, { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { uploadToStorage } from '../lib/storage'
import { compressImage } from '../lib/imageCompress'
import { analyzeDocument } from '../lib/claude'

const MAX_SIZE_MB = 10
const ROLE_AR = { purchasing: 'مسؤول المشتريات', accountant: 'المحاسب', owner: 'المالك' }

const toBase64 = file => new Promise((res, rej) => {
  const r = new FileReader()
  r.onload  = e => res(e.target.result.split(',')[1])
  r.onerror = rej
  r.readAsDataURL(file)
})

const ALLOWED = ['image/jpeg','image/jpg','image/png','image/webp','image/heic','application/pdf']

const STATUS_LABEL = {
  pending:   'في الانتظار',
  uploading: 'جارٍ الرفع...',
  analyzing: 'جارٍ التحليل...',
  done:      'تم ✓',
  error:     'خطأ',
}

export default function InvoiceUpload() {
  const { role, userName, projectId, projectName } = useAuth()
  const [files, setFiles]         = useState([])  // [{ file, status, error }]
  const [uploading, setUploading] = useState(false)
  const [allDone, setAllDone]     = useState(false)
  const [dragOver, setDragOver]   = useState(false)
  const [myDocs, setMyDocs]             = useState([])
  const [myDocsLoading, setMyDocsLoading] = useState(true)
  const [paySource, setPaySource] = useState('')
  const inputRef = useRef()

  // "بـ عسل" فقط حالياً: مسؤول المشتريات يختار مصدر الدفع صراحة عند الرفع (بما فيها "آجل")
  const showPaySourcePicker = role === 'purchasing' && (projectName || '').includes('بـ عسل')

  const loadMyDocs = useCallback(async () => {
    if (!projectId || !userName) return
    setMyDocsLoading(true)
    const { data } = await supabase.from('documents')
      .select('id,file_name,file_type,status,uploaded_at,file_url')
      .eq('project_id', projectId)
      .eq('uploaded_by_name', userName)
      .order('uploaded_at', { ascending: false })
      .limit(10)
    setMyDocs(data || [])
    setMyDocsLoading(false)
  }, [projectId, userName])

  useEffect(() => { loadMyDocs() }, [loadMyDocs])

  async function deleteMyDoc(doc) {
    if (doc.status === 'approved') return
    if (!window.confirm(`حذف "${doc.file_name}"؟ لا يمكن التراجع.`)) return
    const { error } = await supabase.from('documents').delete().eq('id', doc.id)
    if (error) { alert('فشل الحذف: ' + error.message); return }
    setMyDocs(ds => ds.filter(d => d.id !== doc.id))
  }

  function handleFiles(fileList) {
    const newEntries = []
    for (const f of fileList) {
      if (!ALLOWED.includes(f.type)) {
        newEntries.push({ file: f, status: 'error', error: 'صيغة غير مدعومة' })
        continue
      }
      if (f.size > MAX_SIZE_MB * 1024 * 1024) {
        newEntries.push({ file: f, status: 'error', error: `يتجاوز ${MAX_SIZE_MB}MB` })
        continue
      }
      newEntries.push({ file: f, status: 'pending', error: '' })
    }
    setFiles(prev => [...prev, ...newEntries])
    setAllDone(false)
  }

  function onDrop(e) {
    e.preventDefault(); setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  function updateFile(index, patch) {
    setFiles(prev => prev.map((f, i) => i === index ? { ...f, ...patch } : f))
  }

  async function upload() {
    if (!files.some(f => f.status === 'pending')) return
    setUploading(true)

    const { data: cats } = await supabase.from('categories')
      .select('id,name,parent_id,type,sort_order')
      .eq('project_id', projectId).order('sort_order')

    for (let i = 0; i < files.length; i++) {
      if (files[i].status !== 'pending') continue
      updateFile(i, { status: 'uploading', error: '' })
      try {
        const uploadFile = files[i].file.type.startsWith('image/')
          ? await compressImage(files[i].file) : files[i].file
        const fileBase64 = await toBase64(uploadFile)

        const fileUrl = await uploadToStorage(uploadFile, projectId || 'shared')
        const { data: docData, error: err } = await supabase.from('documents').insert({
          project_id:  projectId,
          file_name:   files[i].file.name,
          file_type:   uploadFile.type,
          file_url:    fileUrl,
          status:      'uploaded',
          uploaded_by: role,
          uploaded_by_name: userName,
        }).select('id').single()
        if (err) throw new Error(err.message)

        updateFile(i, { status: 'analyzing' })
        try {
          const result = await analyzeDocument(fileBase64, uploadFile.type, files[i].file.name, role, cats || [], projectName || '', [], showPaySourcePicker && paySource === 'payable')

          // مصدر الدفع المُختار صراحة عند الرفع ("بـ عسل" فقط) — يطغى على تخمين الذكاء الاصطناعي
          if (showPaySourcePicker && paySource) {
            if (result?.invoices) {
              result.invoices = result.invoices.map(inv =>
                inv.type === 'sales' ? inv : { ...inv, paySource }
              )
            }
          }

          const invoiceCount = result?.invoices?.length || 0
          if (invoiceCount > 1) {
            if (role === 'purchasing' || role === 'cashier') {
              if (docData?.id) await supabase.from('documents').delete().eq('id', docData.id)
              updateFile(i, { status: 'error', error: '', multiInvoice: true, invoiceCount })
              continue
            }
            updateFile(i, { multiInvoiceWarning: true, invoiceCount })
          }
          if (result && docData?.id) {
            await supabase.from('documents').update({ analysis_result: result, status: 'analyzed' }).eq('id', docData.id)
          }
        } catch { /* فشل التحليل — يبقى uploaded للمراجعة اليدوية */ }

        updateFile(i, { status: 'done' })
      } catch (e) {
        updateFile(i, { status: 'error', error: e.message })
      }
    }

    setUploading(false)
    setAllDone(true)
    loadMyDocs()
  }

  function reset() { setFiles([]); setAllDone(false) }

  const pendingCount = files.filter(f => f.status === 'pending').length
  const doneCount    = files.filter(f => f.status === 'done').length
  const errorCount   = files.filter(f => f.status === 'error').length

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">رفع مستندات</h1>
        <p className="text-slate-500 text-sm mt-1">
          {role === 'purchasing' ? 'ارفع الفواتير — سيراجعها المحاسب ويعتمدها'
            : role === 'owner'   ? 'ارفع إيصالات السداد أو الفواتير'
            : 'ارفع مستنداً وسيظهر في قائمة المراجعة'}
        </p>
      </div>

      {/* بطاقة التعليمات */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
        <div className="flex items-center gap-2 font-bold text-amber-800 text-base">
          <span>📌</span>
          <span>تعليمات الرفع</span>
        </div>
        <ul className="space-y-1.5 text-sm text-amber-900">
          <li className="flex items-start gap-2">
            <span className="shrink-0">✅</span>
            <span>صوّر كل فاتورة في صورة منفصلة</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="shrink-0">✅</span>
            <span>يمكنك رفع أكثر من صورة في نفس الوقت</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="shrink-0">❌</span>
            <span className="font-semibold">لا تضع أكثر من فاتورة في صورة واحدة</span>
          </li>
        </ul>
      </div>

      {/* مصدر الدفع — "بـ عسل" فقط لمسؤول المشتريات */}
      {showPaySourcePicker && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 space-y-2">
          <label className="text-sm font-bold text-slate-600 block">مصدر الدفع</label>
          <select value={paySource} onChange={e => setPaySource(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option value="">— اختر —</option>
            <option value="cash">💵 الصندوق</option>
            <option value="bank">🏦 البنك / مدى</option>
            <option value="custody">👤 العهدة</option>
            <option value="payable">🏪 آجل</option>
          </select>
        </div>
      )}

      {/* Drop Zone */}
      {!uploading && (
        <div
          onDragOver={e=>{e.preventDefault();setDragOver(true)}}
          onDragLeave={()=>setDragOver(false)}
          onDrop={onDrop}
          onClick={()=>inputRef.current.click()}
          className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-200
            ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'}`}
        >
          <div className="text-5xl mb-3">📤</div>
          <p className="font-semibold text-slate-700 text-lg mb-1">
            {files.length ? 'اسحب صور إضافية أو اضغط للإضافة' : 'اسحب الصور هنا أو اضغط للاختيار'}
          </p>
          <p className="text-sm text-slate-500">فاتورة واحدة لكل صورة — يمكن رفع عدة صور معاً</p>
          <p className="text-xs text-slate-400 mt-1">JPG · PNG · WEBP · HEIC · PDF (حتى {MAX_SIZE_MB}MB)</p>
          <input ref={inputRef} type="file" accept="image/*,.pdf" multiple className="hidden"
            onChange={e => handleFiles(e.target.files)} />
        </div>
      )}

      {/* قائمة الملفات */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((entry, i) => entry.multiInvoice ? (
            <div key={i} className="rounded-2xl border-2 border-red-300 bg-red-50 p-5 space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-3xl">❌</span>
                <div>
                  <div className="font-bold text-red-800 text-base">تم رفض الصورة</div>
                  <div className="text-xs text-slate-500 truncate max-w-xs">{entry.file.name}</div>
                </div>
              </div>
              <p className="text-sm text-slate-700">
                اكتشف النظام <span className="font-bold text-red-700">{entry.invoiceCount} فواتير</span> في هذه الصورة
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1.5 text-sm text-amber-900">
                <div className="font-bold mb-1">📌 التعليمات:</div>
                <div className="flex items-start gap-2"><span className="shrink-0">•</span><span>صوّر كل فاتورة في صورة منفصلة</span></div>
                <div className="flex items-start gap-2"><span className="shrink-0">•</span><span>يمكنك رفع عدة صور في نفس الوقت</span></div>
              </div>
              <button onClick={reset}
                className="w-full py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors text-sm">
                حاول مرة ثانية 🔄
              </button>
            </div>
          ) : (
            <div key={i} className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${
              entry.status === 'done'      ? 'border-green-200 bg-green-50' :
              entry.status === 'error'     ? 'border-red-200 bg-red-50' :
              entry.status === 'analyzing' || entry.status === 'uploading'
                                           ? 'border-blue-200 bg-blue-50' :
              'border-slate-200 bg-white'
            }`}>
              <span className="text-2xl shrink-0">
                {entry.file.type.startsWith('image/') ? '🖼️' : '📄'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-800 truncate text-sm">{entry.file.name}</div>
                <div className="text-xs text-slate-400">{(entry.file.size / 1024).toFixed(0)} KB</div>
                {entry.error && <div className="text-xs text-red-600 mt-0.5">{entry.error}</div>}
                {entry.multiInvoiceWarning && (
                  <div className="text-xs text-amber-600 mt-0.5 font-semibold">
                    ⚠️ اكتُشف {entry.invoiceCount} فواتير — راجع التحليل
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {(entry.status === 'uploading' || entry.status === 'analyzing') && (
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/>
                )}
                <span className={`text-xs font-semibold ${
                  entry.status === 'done'      ? 'text-green-700' :
                  entry.status === 'error'     ? 'text-red-600'   :
                  entry.status === 'analyzing' || entry.status === 'uploading'
                                               ? 'text-blue-600'  : 'text-slate-500'
                }`}>{STATUS_LABEL[entry.status]}</span>
                {entry.status === 'pending' && !uploading && (
                  <button onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))}
                    className="text-slate-300 hover:text-red-500 text-base leading-none ml-1">✕</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* رسالة النجاح النهائية */}
      {allDone && !uploading && !files.every(f => f.multiInvoice) && (
        <div className={`rounded-2xl p-6 text-center space-y-2 ${errorCount && !doneCount ? 'bg-red-50 border border-red-200' : errorCount ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
          <div className="text-4xl">{errorCount && !doneCount ? '❌' : errorCount ? '⚠️' : '✅'}</div>
          <div className="font-bold text-lg text-slate-800">
            {doneCount > 0
              ? `تم رفع ${doneCount} ${doneCount === 1 ? 'فاتورة' : 'فاتورة'} بنجاح`
              : 'فشل رفع الملفات'}
          </div>
          {errorCount > 0 && doneCount > 0 && (
            <p className="text-sm text-amber-700">فشل رفع {errorCount} ملف — تحقق من الأخطاء أعلاه</p>
          )}
          <button onClick={reset}
            className="mt-1 px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors">
            رفع مزيد من الفواتير
          </button>
        </div>
      )}

      {/* أزرار الإجراء */}
      {!uploading && pendingCount > 0 && (
        <button onClick={upload} disabled={showPaySourcePicker && !paySource}
          className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          ⬆️ رفع {pendingCount} {pendingCount === 1 ? 'مستند' : 'مستندات'}
        </button>
      )}

      {uploading && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center text-blue-700 text-sm font-semibold flex items-center justify-center gap-2">
          <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"/>
          جارٍ معالجة الملفات...
        </div>
      )}

      {/* آخر المستندات المرفوعة */}
      <div className="pt-2">
        <h2 className="text-sm font-bold text-slate-600 mb-2 flex items-center gap-1.5">
          <span>📋</span> آخر المستندات المرفوعة
        </h2>
        {myDocsLoading ? (
          <div className="text-xs text-slate-400 py-3 text-center">جارٍ التحميل...</div>
        ) : myDocs.length === 0 ? (
          <div className="text-xs text-slate-400 py-3 text-center">ما رفعت أي مستند بعد</div>
        ) : (
          <div className="space-y-1.5">
            {myDocs.map(doc => {
              const approved = doc.status === 'approved'
              return (
                <div key={doc.id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3">
                  <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="text-xl shrink-0">{doc.file_type?.startsWith('image/') ? '🖼️' : '📄'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-blue-700 truncate hover:underline">{doc.file_name}</div>
                      <div className="text-xs text-slate-400">
                        {new Date(doc.uploaded_at).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' })}
                      </div>
                    </div>
                  </a>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold shrink-0 ${
                    approved ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {approved ? '✅ معتمد' : '⏳ معلّق'}
                  </span>
                  {!approved && (
                    <button onClick={() => deleteMyDoc(doc)}
                      className="text-slate-300 hover:text-red-500 text-base leading-none shrink-0" title="حذف">
                      🗑️
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
