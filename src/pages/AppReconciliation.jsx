import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { analyzeAppStatement } from '../lib/claude'
import { APPS, computeSystemTotal, hasSalesMismatch } from '../lib/appReconciliation'
import { normCat } from '../lib/bankReconciliation'
import { getTransactionTypes } from '../lib/projectSettings'
import { getOrCreateJournalNumber } from '../lib/journalNumber'
import { uploadToStorage } from '../lib/storage'

const TARGET_PROJECT = 'بـ عسل'

const fmt = v => (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const toBase64 = file => new Promise((res, rej) => {
  const r = new FileReader()
  r.onload  = e => res(e.target.result.split(',')[1])
  r.onerror = rej
  r.readAsDataURL(file)
})

function pickOperatingExpenseType(transTypes) {
  const match = transTypes.find(t => normCat(t) === normCat('مصروفات تشغيلية'))
  return match || '🛒 مصروفات تشغيلية'
}

function pickAppCommissionCategorySub(categories, transType) {
  const parentCats = categories.filter(c => !c.parent_id)
  const parent = parentCats.find(p => normCat(p.name) === normCat(transType))
  if (!parent) return 'أخرى'
  const subs = categories.filter(c => c.parent_id === parent.id)
  const match = subs.find(s => normCat(s.name).includes(normCat('عمولات تطبيقات')))
  return match ? match.name : 'أخرى'
}

export default function AppReconciliation() {
  const { projectId, projectName } = useAuth()

  const [selectedApp, setSelectedApp] = useState(APPS[0].key)
  const [from, setFrom] = useState('')
  const [to, setTo]     = useState('')
  const [file, setFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [transTypes, setTransTypes] = useState([])
  const [categories, setCategories] = useState([])
  const [statementFileUrl, setStatementFileUrl] = useState(null)
  const [recording, setRecording] = useState(false)
  const [recorded, setRecorded]   = useState(false)
  const inputRef = useRef()

  useEffect(() => {
    if (!projectId) return
    getTransactionTypes(projectId).then(setTransTypes)
    supabase.from('categories')
      .select('id,name,parent_id,type,sort_order')
      .eq('project_id', projectId)
      .order('sort_order')
      .then(({ data }) => setCategories(data || []))
  }, [projectId])

  if (!(projectName || '').includes(TARGET_PROJECT)) {
    return (
      <div className="max-w-lg mx-auto text-center py-20 text-slate-400">
        <div className="text-4xl mb-3">🚧</div>
        <p className="font-medium">هذه الميزة غير متاحة لمشروعك بعد</p>
      </div>
    )
  }

  const app = APPS.find(a => a.key === selectedApp)

  function handleFile(f) {
    if (!f) return
    const allowed = f.type.startsWith('image/') || f.type === 'application/pdf'
    if (!allowed) { setError('الملف يجب أن يكون صورة أو PDF'); return }
    setFile(f); setError(''); setResult(null); setStatementFileUrl(null); setRecorded(false)
  }

  async function runReconciliation() {
    if (!file || !from || !to) { setError('اختر التطبيق والفترة والملف أولاً'); return }
    setBusy(true); setError(''); setResult(null); setRecorded(false)
    try {
      const fileBase64 = await toBase64(file)
      const statement  = await analyzeAppStatement(fileBase64, file.type, file.name)

      const { data: entries, error: entriesErr } = await supabase
        .from('ledger_entries')
        .select('type,receivable_in')
        .eq('project_id', projectId)
        .gte('date', from).lte('date', to)
        .neq('status', 'cancelled')
      if (entriesErr) throw new Error(entriesErr.message)

      const systemTotal = computeSystemTotal(entries || [], app.keyword)
      const diff = systemTotal - statement.netTransferred

      setResult({
        systemTotal,
        netTransferred: statement.netTransferred,
        diff,
        commission: statement.commission,
        tax: statement.tax,
        otherDeductions: statement.otherDeductions,
        reportedSales: statement.reportedSales,
        mismatch: hasSalesMismatch(systemTotal, statement.reportedSales),
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function recordDifference() {
    if (!result) return
    setRecording(true); setError('')
    try {
      let fileUrl = statementFileUrl
      if (!fileUrl && file) {
        fileUrl = await uploadToStorage(file, projectId)
        setStatementFileUrl(fileUrl)
      }

      const amount = result.diff
      const transType   = pickOperatingExpenseType(transTypes)
      const categorySub = pickAppCommissionCategorySub(categories, transType)
      const description = `عمولات ${app.label} — ${from} إلى ${to}`

      const { data: dup } = await supabase.from('ledger_entries').select('id')
        .eq('project_id', projectId).eq('date', to)
        .eq('type', transType).eq('description', description)
        .eq('total_amount', amount).neq('status', 'cancelled').maybeSingle()
      if (dup) {
        setError('هذا الفرق مسجَّل مسبقاً في الدفتر — لم يتم تسجيله مرة أخرى')
        setRecorded(true)
        return
      }

      const jn = await getOrCreateJournalNumber(projectId, to)
      const { error: insErr } = await supabase.from('ledger_entries').insert({
        project_id: projectId, date: to, type: transType, description,
        cash_in: 0, cash_out: 0, bank_in: 0, bank_out: 0, custody_in: 0, custody_out: 0,
        receivable_in: 0, receivable_out: amount,
        payable_in: 0, payable_out: 0,
        category_main: normCat(transType) || null, category_sub: categorySub,
        vat_amount: 0, total_amount: amount, status: 'approved',
        journal_number: jn, branch: null, file_url: fileUrl || '',
      })
      if (insErr) throw new Error(insErr.message)
      setRecorded(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setRecording(false)
    }
  }

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">📱 مطابقة التطبيقات</h1>
        <p className="text-sm text-slate-500 mt-1">قارن مبيعات تطبيق التوصيل المسجَّلة بتحسيب مقابل صافي المبلغ المحوَّل فعلياً</p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800 font-medium">
        🕐 حدد الفترة المطابقة لدورة تحويل هذا التطبيق تحديداً (شهرية أو نصف شهرية حسب سياسته) للحصول على مطابقة دقيقة
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 space-y-4">
        <div>
          <label className="text-xs text-slate-400 block mb-1">التطبيق</label>
          <select value={selectedApp} onChange={e => { setSelectedApp(e.target.value); setResult(null); setRecorded(false) }}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            {APPS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">من تاريخ</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">إلى تاريخ</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
          </div>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }}
          onClick={() => inputRef.current.click()}
          className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200
            ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'}`}
        >
          <div className="text-4xl mb-2">📤</div>
          <p className="font-semibold text-slate-700">{file ? file.name : 'اسحب كشف/إيصال التحويل هنا أو اضغط لاختياره'}</p>
          <p className="text-xs text-slate-400 mt-1">صورة أو PDF</p>
          <input ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden"
            onChange={e => handleFile(e.target.files[0])}/>
        </div>

        {error && <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-red-700 text-sm">❌ {error}</div>}

        <button onClick={runReconciliation} disabled={!file || !from || !to || busy}
          className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {busy
            ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/><span>جارٍ التحليل...</span></>
            : '🔍 بدء المطابقة'}
        </button>
      </div>

      {result && (
        <div className="space-y-3">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-3">
            <Row label={`إجمالي مبيعات ${app.label} بتحسيب`} value={result.systemTotal} />
            <Row label="صافي المحوّل فعلياً (من الكشف)" value={result.netTransferred} />
            <div className="border-t border-slate-100 pt-3">
              <Row label="الفرق (عمولات + ضريبة + استقطاعات)" value={result.diff} bold
                color={result.diff >= 0 ? '#dc2626' : '#16a34a'} />
            </div>
          </div>

          {(result.commission > 0 || result.tax > 0 || result.otherDeductions.length > 0) && (
            <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 space-y-1 text-sm">
              <div className="text-xs font-bold text-slate-500 mb-1">تفصيل الاستقطاعات كما وردت بالكشف</div>
              {result.commission > 0 && <div className="flex justify-between"><span className="text-slate-500">العمولة</span><span className="font-mono">{fmt(result.commission)}</span></div>}
              {result.tax > 0 && <div className="flex justify-between"><span className="text-slate-500">الضريبة على العمولة</span><span className="font-mono">{fmt(result.tax)}</span></div>}
              {result.otherDeductions.map((d, i) => (
                <div key={i} className="flex justify-between"><span className="text-slate-500">{d.description}</span><span className="font-mono">{fmt(d.amount)}</span></div>
              ))}
            </div>
          )}

          {result.mismatch && (
            <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-4 text-sm text-red-800">
              ⚠️ فرق كبير بين مبيعات {app.label} كما يذكرها التطبيق ({fmt(result.reportedSales)}) وما هو مسجَّل بتحسيب ({fmt(result.systemTotal)}) —
              قد يدل على مبيعات لم تُسجَّل أو سُجّلت خطأ، بخلاف فرق العمولات العادي.
            </div>
          )}

          {recorded ? (
            <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center text-green-700 font-semibold">
              ✅ تم تسجيل الفرق كمصروف عمولات تطبيقات
            </div>
          ) : (
            <button onClick={recordDifference} disabled={recording || result.diff <= 0}
              className="w-full py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-colors disabled:opacity-50">
              {recording ? '...' : '✅ تسجيل الفرق كمصروف عمولات تطبيقات'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, bold, color }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-sm ${bold ? 'font-bold' : ''}`} style={{ color: color || '#374151' }}>{label}</span>
      <span className={`font-mono ${bold ? 'font-bold text-base' : 'text-sm'}`} style={{ color: color || '#1e293b' }}>{fmt(value)}</span>
    </div>
  )
}
