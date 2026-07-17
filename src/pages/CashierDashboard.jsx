import React, { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { uploadToStorage } from '../lib/storage'
import { getProjectSettings } from '../lib/projectSettings'
import { getOrCreateJournalNumber } from '../lib/journalNumber'
import { compressImage } from '../lib/imageCompress'
import { analyzeDocument } from '../lib/claude'

const toBase64 = file => new Promise((res, rej) => {
  const r = new FileReader()
  r.onload  = e => res(e.target.result.split(',')[1])
  r.onerror = rej
  r.readAsDataURL(file)
})

const NAVY = '#1B3A5C'
const GOLD = '#6EB7B0'

const fmt = v =>
  Number(v || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── لوحة المحمصة الرئيسية: إدخال مباشر لقنوات المبيعات ──────────────────────
function RoasteryMainPanel({ projectId, branch }) {
  const today = new Date().toISOString().split('T')[0]
  const [date, setDate]     = useState(today)
  const [salla, setSalla]   = useState('')
  const [tabby, setTabby]   = useState('')
  const [tamara, setTamara] = useState('')
  const [tahseel, setTahseel] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone]     = useState(false)
  const [error, setError]   = useState('')

  const total = [salla, tabby, tamara, tahseel]
    .reduce((s, v) => s + (Number(v) || 0), 0)

  async function handleSubmit() {
    if (total === 0) { setError('أدخل مبلغاً واحداً على الأقل'); return }
    setSaving(true); setError('')
    try {
      const jn = await getOrCreateJournalNumber(projectId, date)
      const mkEntry = (type, desc, cash_in, bank_in) => ({
        project_id: projectId, date, type, description: desc,
        cash_in, cash_out: 0, bank_in, bank_out: 0,
        custody_in: 0, custody_out: 0,
        total_amount: cash_in + bank_in,
        status: 'approved', journal_number: jn, branch,
      })

      const entries = []
      if (Number(salla)   > 0) entries.push(mkEntry('🛒 مبيعات سلة',   'مبيعات سلة',   0, Number(salla)))
      if (Number(tabby)   > 0) entries.push(mkEntry('💳 مبيعات تابي',  'مبيعات تابي',  0, Number(tabby)))
      if (Number(tamara)  > 0) entries.push(mkEntry('💳 مبيعات تمارا', 'مبيعات تمارا', 0, Number(tamara)))
      if (Number(tahseel) > 0) entries.push(mkEntry('📥 تحصيل جملة',  'تحصيل جملة',   0, Number(tahseel)))

      if (entries.length) {
        const { error: e } = await supabase.from('ledger_entries').insert(entries)
        if (e) throw new Error(e.message)
      }

      // جدول المبيعات — سلة/تابي/تمارا → network_sales
      const netS = (Number(salla) || 0) + (Number(tabby) || 0) + (Number(tamara) || 0)
      if (netS > 0) {
        await supabase.from('sales').insert({
          project_id: projectId, date,
          cash_sales: 0, network_sales: netS,
          hunger_sales: 0, jahez_sales: 0, keeta_sales: 0,
          description: 'مبيعات المحمصة الرئيسية', branch,
        })
      }

      setDone(true)
      setSalla(''); setTabby(''); setTamara(''); setTahseel('')
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  if (done) return (
    <div className="bg-green-50 border border-green-200 rounded-2xl p-10 text-center space-y-3">
      <div className="text-5xl">✅</div>
      <div className="text-lg font-bold text-green-800">تم تسجيل المبيعات بنجاح</div>
      <p className="text-sm text-green-600">تمت إضافة القيود في الدفتر</p>
      <button onClick={() => setDone(false)}
        className="mt-2 px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
        تسجيل يوم آخر
      </button>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* التاريخ */}
      <div className="bg-white rounded-2xl shadow-sm p-5" style={{ border: `2px solid ${GOLD}` }}>
        <label className="text-sm font-bold block mb-2" style={{ color: NAVY }}>📅 التاريخ</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none"
          style={{ borderColor: '#d1c9b8', direction: 'ltr' }} />
      </div>

      {/* قنوات المبيعات */}
      <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4" style={{ border: '2px solid #e8e5dc' }}>
        <div className="text-sm font-bold mb-1" style={{ color: NAVY }}>قنوات المبيعات</div>

        {[
          { label: '🛒 سلة',          value: salla,  set: setSalla,  hint: 'مبيعات منصة سلة' },
          { label: '💳 تابي',         value: tabby,  set: setTabby,  hint: 'مبيعات منصة تابي' },
          { label: '💳 تمارا',        value: tamara, set: setTamara, hint: 'مبيعات منصة تمارا' },
          { label: '📥 تحصيل جملة',  value: tahseel, set: setTahseel, hint: 'استلام حوالة من عميل جملة' },
        ].map(({ label, value, set, hint }) => (
          <div key={label} className="flex items-center gap-3">
            <div className="w-36 shrink-0">
              <span className="text-sm font-semibold" style={{ color: NAVY }}>{label}</span>
              <span className="text-xs text-slate-400 block mt-0.5">{hint}</span>
            </div>
            <input
              type="number" value={value} onChange={e => set(e.target.value)}
              placeholder="0.00" min="0" step="0.01"
              className="flex-1 border rounded-xl px-4 py-2.5 text-sm focus:outline-none text-left"
              style={{ borderColor: '#d1c9b8', direction: 'ltr' }}
            />
          </div>
        ))}

        {total > 0 && (
          <div className="mt-2 flex items-center justify-between px-4 py-3 rounded-xl"
            style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
            <span className="font-bold text-green-800">الإجمالي</span>
            <span className="font-mono font-bold text-green-800 text-lg">{fmt(total)} ر.س</span>
          </div>
        )}
      </div>

      {error && (
        <p className="text-red-600 text-sm font-medium bg-red-50 rounded-xl p-3 border border-red-100">❌ {error}</p>
      )}

      <button
        onClick={handleSubmit}
        disabled={saving || total === 0}
        className="w-full py-3 text-white rounded-xl font-semibold transition-colors disabled:opacity-50"
        style={{ background: saving || total === 0 ? '#94a3b8' : NAVY }}
      >
        {saving
          ? <span className="flex items-center justify-center gap-2">
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin inline-block"/>
              جارٍ الحفظ...
            </span>
          : '✅ تسجيل المبيعات'
        }
      </button>
    </div>
  )
}

// ── لوحة الكاشير العادية: رفع مستند ──────────────────────────────────────────
export default function CashierDashboard() {
  const { role, userName, projectId, projectName, branch } = useAuth()

  const [file, setFile]                       = useState(null)
  const [preview, setPreview]                 = useState(null)
  const [uploading, setUploading]             = useState(false)
  const [uploadPhase, setUploadPhase]         = useState('') // 'uploading' | 'analyzing'
  const [done, setDone]                       = useState(false)
  const [error, setError]                     = useState('')
  const [dragOver, setDragOver]               = useState(false)
  const [purchaseCategory, setPurchaseCategory] = useState('')
  const [purchaseTypes, setPurchaseTypes]     = useState([])
  const [myDocs, setMyDocs]                   = useState([])
  const [myDocsLoading, setMyDocsLoading]     = useState(true)
  const inputRef = useRef()

  useEffect(() => {
    if (role === 'purchasing' && projectId) {
      getProjectSettings(projectId).then(s => {
        const types = s?.settings?.transaction_types?.map(t => t.label) || []
        setPurchaseTypes(types)
      })
    }
  }, [role, projectId])

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

  // كاشير المحمصة الرئيسية → لوحة إدخال مباشر للمبيعات
  if (role === 'cashier' && branch === 'المحمصة الرئيسية') {
    return (
      <div className="max-w-xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">المحمصة الرئيسية</h1>
          <p className="text-slate-500 text-sm mt-1">تسجيل مبيعات المنصات الإلكترونية والجملة</p>
          <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold"
            style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
            🏢 {branch}
          </div>
        </div>
        <RoasteryMainPanel projectId={projectId} branch={branch} />
      </div>
    )
  }

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
    if (role === 'purchasing' && !purchaseCategory) { setError('اختر نوع المادة أولاً'); return }
    setUploading(true); setUploadPhase('uploading'); setError('')
    try {
      const uploadFile = file.type.startsWith('image/') ? await compressImage(file) : file
      const fileBase64 = await toBase64(uploadFile)

      const fileUrl = await uploadToStorage(uploadFile, projectId || 'shared')
      const { data: docData, error: err } = await supabase.from('documents').insert({
        project_id:        projectId,
        file_name:         file.name,
        file_type:         uploadFile.type,
        file_url:          fileUrl,
        status:            'uploaded',
        uploaded_by:       role,
        uploaded_by_name:  userName,
        branch:            branch || null,
        purchase_category: role === 'purchasing' ? purchaseCategory : null,
      }).select('id').single()
      if (err) throw new Error(err.message)

      // تحليل تلقائي في الخلفية
      setUploadPhase('analyzing')
      try {
        const { data: cats } = await supabase.from('categories')
          .select('id,name,parent_id,type,sort_order')
          .eq('project_id', projectId).order('sort_order')
        const result = await analyzeDocument(fileBase64, uploadFile.type, file.name, role, cats || [], projectName || '')
        if (result && docData?.id) {
          await supabase.from('documents').update({ analysis_result: result, status: 'analyzed' }).eq('id', docData.id)
        }
      } catch { /* فشل التحليل — يبقى uploaded للمراجعة اليدوية */ }

      setDone(true); setFile(null); setPreview(null); setPurchaseCategory('')
      loadMyDocs()
    } catch (e) { setError(e.message) }
    finally { setUploading(false); setUploadPhase('') }
  }

  function reset() { setFile(null); setPreview(null); setDone(false); setError(''); setPurchaseCategory('') }

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">
          {role === 'purchasing' ? 'رفع فاتورة مشتريات' : 'لوحة الكاشير'}
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          {role === 'purchasing'
            ? 'ارفع فاتورة المشتريات — سيراجعها المحاسب ويعتمدها'
            : 'ارفع ملخص مبيعات أو فاتورة مشتريات — سيراجعها المحاسب ويعتمدها'}
        </p>
        {branch && (
          <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold"
            style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
            🏢 {branch}
          </div>
        )}
      </div>

      {/* قائمة نوع المادة — لمسؤول المشتريات فقط */}
      {role === 'purchasing' && purchaseTypes.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-5 space-y-3" style={{ border: `2px solid ${purchaseCategory ? GOLD : '#e8e5dc'}` }}>
          <div className="flex items-center gap-2">
            <span className="text-lg">🛒</span>
            <span className="font-bold text-sm" style={{ color: NAVY }}>نوع المادة</span>
            <span className="text-red-500 text-sm">*</span>
          </div>
          <select
            value={purchaseCategory}
            onChange={e => { setPurchaseCategory(e.target.value); setError('') }}
            className="w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none"
            style={{ borderColor: purchaseCategory ? GOLD : '#d1c9b8', color: purchaseCategory ? NAVY : '#9ca3af', direction: 'rtl' }}
          >
            <option value="">— اختر نوع المادة —</option>
            {purchaseTypes.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {purchaseCategory && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold"
              style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }}>
              ✅ {purchaseCategory}
            </div>
          )}
        </div>
      )}

      {done ? (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-10 text-center space-y-3">
          <div className="text-5xl">✅</div>
          <div className="text-lg font-bold text-green-800">تم استلام الملخص</div>
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
              ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                  <span>{uploadPhase === 'analyzing' ? 'جارٍ التحليل...' : 'جارٍ الرفع...'}</span></>
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
