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
  const today = new Date().toISOString().split('T')[0]

  const [projectId, setProjectId] = useState(null)
  const [todayEntries, setTodayEntries] = useState([])

  // Sales form
  const [form, setForm]           = useState({ date: today, cash: '', network: '', notes: '' })
  const [saving, setSaving]       = useState(false)
  const [salesDone, setSalesDone] = useState(false)
  const [salesErr, setSalesErr]   = useState('')

  // Invoice upload
  const [file, setFile]               = useState(null)
  const [preview, setPreview]         = useState(null)
  const [uploading, setUploading]     = useState(false)
  const [invoiceDone, setInvoiceDone] = useState(false)
  const [invoiceType, setInvoiceType] = useState('')
  const [invoiceErr, setInvoiceErr]   = useState('')
  const [dragOver, setDragOver]       = useState(false)
  const inputRef = useRef()

  useEffect(() => { init() }, [])

  async function init() {
    const { data: proj } = await supabase
      .from('projects').select('id').eq('name', 'مزاهر-برو').maybeSingle()
    if (proj) { setProjectId(proj.id); loadToday(proj.id) }
  }

  async function loadToday(pid) {
    const { data } = await supabase.from('sales')
      .select('date,cash_sales,network_sales,description')
      .eq('project_id', pid).eq('date', today)
      .order('id', { ascending: false })
    setTodayEntries(data || [])
  }

  async function saveSales() {
    const cash    = Number(form.cash)    || 0
    const network = Number(form.network) || 0
    if (!cash && !network) { setSalesErr('أدخل المبيعات أولاً'); return }
    setSaving(true); setSalesErr('')
    try {
      const { error: e1 } = await supabase.from('sales').insert({
        project_id:    projectId,
        date:          form.date,
        cash_sales:    cash,
        network_sales: network,
        description:   form.notes || 'ملخص مبيعات يومي',
      })
      if (e1) throw new Error(e1.message)

      const entries = []
      if (cash > 0) entries.push({
        project_id: projectId, date: form.date,
        type: '💵 مبيعات كاش', description: 'مبيعات كاش — يومية',
        cash_in: cash, cash_out: 0, bank_in: 0, bank_out: 0,
        custody_in: 0, custody_out: 0, total_amount: cash, status: 'auto',
      })
      if (network > 0) entries.push({
        project_id: projectId, date: form.date,
        type: '🏦 مبيعات شبكة', description: 'مبيعات شبكة — يومية',
        cash_in: 0, cash_out: 0, bank_in: network, bank_out: 0,
        custody_in: 0, custody_out: 0, total_amount: network, status: 'auto',
      })
      if (entries.length) {
        const { error: e2 } = await supabase.from('ledger_entries').insert(entries)
        if (e2) throw new Error(e2.message)
      }

      setSalesDone(true)
      setForm({ date: today, cash: '', network: '', notes: '' })
      loadToday(projectId)
    } catch(e) { setSalesErr(e.message) }
    finally { setSaving(false) }
  }

  function handleFile(f) {
    if (!f) return
    const allowed = ['image/jpeg','image/jpg','image/png','image/webp','image/heic','application/pdf']
    if (!allowed.includes(f.type)) { setInvoiceErr('صيغة غير مدعومة'); return }
    if (f.size > 4 * 1024 * 1024) { setInvoiceErr('الحد الأقصى 4MB'); return }
    setFile(f); setInvoiceDone(false); setInvoiceErr('')
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : null)
  }

  async function uploadInvoice() {
    if (!file) return
    setUploading(true); setInvoiceErr('')
    try {
      const base64 = await toBase64(file)
      const result = await analyzeDocument(base64, file.type, file.name)

      if (result.type === 'sales') {
        // تقرير مبيعات → يحفظ في sales + قيدين في الدفتر
        const cash    = Number(result.cashSales)    || 0
        const network = Number(result.networkSales) || 0
        const { error: e1 } = await supabase.from('sales').insert({
          project_id:    projectId,
          date:          result.date,
          cash_sales:    cash,
          network_sales: network,
          description:   'تقرير POS — كاشير',
        })
        if (e1) throw new Error(e1.message)
        const entries = []
        if (cash > 0)    entries.push({ project_id: projectId, date: result.date, type: '💵 مبيعات كاش',   description: 'مبيعات كاش — POS',   cash_in: cash,    cash_out: 0, bank_in: 0, bank_out: 0, custody_in: 0, custody_out: 0, total_amount: cash,    status: 'auto' })
        if (network > 0) entries.push({ project_id: projectId, date: result.date, type: '🏦 مبيعات شبكة', description: 'مبيعات شبكة — POS', cash_in: 0,       cash_out: 0, bank_in: network, bank_out: 0, custody_in: 0, custody_out: 0, total_amount: network, status: 'auto' })
        if (entries.length) {
          const { error: e2 } = await supabase.from('ledger_entries').insert(entries)
          if (e2) throw new Error(e2.message)
        }
      } else {
        // فاتورة مصروف → تخصم من الصندوق
        const amount = Number(result.amount) || 0
        const { error: e1 } = await supabase.from('ledger_entries').insert({
          project_id:   projectId,
          date:         result.date,
          type:         result.transType || '🛒 مصروفات تشغيلية',
          description:  result.description || file.name,
          cash_out:     amount,
          cash_in: 0, bank_in: 0, bank_out: 0, custody_in: 0, custody_out: 0,
          vat_amount:   Number(result.vatAmount) || 0,
          total_amount: amount,
          status:       'auto',
          file_url:     '',
        })
        if (e1) throw new Error(e1.message)
      }

      await supabase.from('documents').insert({
        project_id:      projectId,
        file_name:       file.name,
        file_type:       file.type,
        file_data:       base64,
        status:          'approved',
        uploaded_by:     role,
        analysis_result: result,
      })

      setInvoiceDone(true)
      setInvoiceType(result.type === 'sales' ? 'sales' : 'expense')
      setFile(null); setPreview(null)
    } catch(e) { setInvoiceErr(e.message) }
    finally { setUploading(false) }
  }

  const fmt = v => (v || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2 })
  const totalToday = todayEntries.reduce((s, r) => s + (r.cash_sales || 0) + (r.network_sales || 0), 0)

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">لوحة الكاشير</h1>
        <p className="text-slate-500 text-sm mt-1">إدخال مبيعات اليوم ورفع فواتير المشتريات</p>
      </div>

      {/* Sales Form */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-4">
        <h2 className="font-bold text-slate-800">💵 ملخص مبيعات اليوم</h2>

        {salesDone ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center space-y-2">
            <div className="text-4xl">✅</div>
            <p className="text-green-800 font-semibold">تم حفظ المبيعات بنجاح</p>
            <p className="text-green-600 text-xs">مبيعات الشبكة → البنك · مبيعات الكاش → الصندوق</p>
            <button onClick={() => setSalesDone(false)}
              className="mt-1 text-xs text-green-700 underline">إدخال مبيعات أخرى</button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">التاريخ</label>
                <input type="date" value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
              </div>
              <div/>
              <div>
                <label className="text-xs text-slate-500 block mb-1">💵 مبيعات كاش (الصندوق)</label>
                <input type="number" placeholder="0.00" value={form.cash}
                  onChange={e => setForm(f => ({ ...f, cash: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">🏦 مبيعات شبكة (البنك)</label>
                <input type="number" placeholder="0.00" value={form.network}
                  onChange={e => setForm(f => ({ ...f, network: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
              </div>
            </div>

            {(form.cash || form.network) && (
              <div className="bg-slate-50 rounded-xl p-3 flex justify-between text-sm">
                <span className="text-slate-500">الإجمالي</span>
                <span className="font-bold text-slate-800">
                  {fmt((Number(form.cash) || 0) + (Number(form.network) || 0))} ر.س
                </span>
              </div>
            )}

            <div>
              <label className="text-xs text-slate-500 block mb-1">ملاحظات (اختياري)</label>
              <input placeholder="..." value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
            </div>

            {salesErr && <p className="text-red-600 text-sm font-medium">❌ {salesErr}</p>}

            <button onClick={saveSales} disabled={saving}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {saving
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/><span>جارٍ الحفظ...</span></>
                : '💾 حفظ المبيعات'}
            </button>
          </>
        )}
      </div>

      {/* Invoice Upload */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-4">
        <div>
          <h2 className="font-bold text-slate-800">🧾 رفع فاتورة مشتريات</h2>
          <p className="text-xs text-slate-400 mt-0.5">الذكاء الاصطناعي يحللها ويخصمها تلقائياً من الصندوق</p>
        </div>

        {invoiceDone ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center space-y-2">
            <div className="text-4xl">✅</div>
            {invoiceType === 'sales'
              ? <p className="text-green-800 font-semibold">تم تسجيل تقرير المبيعات — كاش → الصندوق · شبكة → البنك</p>
              : <p className="text-green-800 font-semibold">تم تسجيل الفاتورة وخصمها من الصندوق</p>
            }
            <button onClick={() => { setInvoiceDone(false); setInvoiceType('') }}
              className="text-xs text-green-700 underline">رفع مستند آخر</button>
          </div>
        ) : !file ? (
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }}
            onClick={() => inputRef.current.click()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all
              ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-amber-300 hover:bg-amber-50'}`}
          >
            <div className="text-4xl mb-3">🧾</div>
            <p className="text-sm font-medium text-slate-600">اسحب الفاتورة أو انقر للاختيار</p>
            <p className="text-xs text-slate-400 mt-1">JPG · PNG · PDF (حتى 4MB)</p>
            <input ref={inputRef} type="file" accept="image/*,.pdf" capture="environment" className="hidden"
              onChange={e => handleFile(e.target.files[0])} />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-3">
              <span className="text-2xl">{file.type.startsWith('image/') ? '🖼️' : '📄'}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-700 truncate">{file.name}</div>
                <div className="text-xs text-slate-400">{(file.size / 1024).toFixed(0)} KB</div>
              </div>
              <button onClick={() => { setFile(null); setPreview(null) }}
                className="text-slate-400 hover:text-red-500 text-lg">✕</button>
            </div>
            {preview && (
              <img src={preview} alt="preview"
                className="w-full max-h-48 object-contain rounded-xl bg-slate-50 border border-slate-100"/>
            )}
            {invoiceErr && <p className="text-red-600 text-sm font-medium">❌ {invoiceErr}</p>}
            <button onClick={uploadInvoice} disabled={uploading}
              className="w-full py-3 bg-amber-600 text-white rounded-xl font-semibold hover:bg-amber-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {uploading
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/><span>جارٍ التحليل...</span></>
                : '🤖 تحليل وخصم من الصندوق'}
            </button>
          </div>
        )}
      </div>

      {/* Today's sales summary */}
      {todayEntries.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-slate-800">📋 مبيعات اليوم المسجلة</h2>
            <span className="text-sm font-bold text-blue-700">{fmt(totalToday)} ر.س</span>
          </div>
          <div className="space-y-2">
            {todayEntries.map((e, i) => (
              <div key={i} className="flex justify-between items-center bg-slate-50 rounded-lg px-4 py-2.5 text-sm">
                <span className="text-slate-600">{e.description}</span>
                <div className="flex gap-4 tabular-nums">
                  {e.cash_sales > 0 && <span className="text-green-600">كاش: {fmt(e.cash_sales)}</span>}
                  {e.network_sales > 0 && <span className="text-blue-600">شبكة: {fmt(e.network_sales)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
