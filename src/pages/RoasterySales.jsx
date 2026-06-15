import React, { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { getOrCreateJournalNumber } from '../lib/journalNumber'
import { compressImage } from '../lib/imageCompress'

const NAVY   = '#0f2444'
const BRANCH = 'المحمصة الرئيسية'
const MODEL  = (import.meta.env.VITE_CLAUDE_MODEL || 'claude-opus-4-5').trim()

const VALID_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

const fmt = v =>
  Number(v || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function normMime(type, name = '') {
  if (!type) {
    const ext = (name.split('.').pop() || '').toLowerCase()
    if (ext === 'pdf')                  return 'application/pdf'
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
    if (ext === 'png')                  return 'image/png'
    return 'application/pdf'
  }
  const t = type.toLowerCase()
  if (t === 'image/jpg' || t === 'image/jfif') return 'image/jpeg'
  return t
}

const toBase64 = file => new Promise((res, rej) => {
  const r = new FileReader()
  r.onload  = e => res(e.target.result.split(',')[1])
  r.onerror = rej
  r.readAsDataURL(file)
})

async function analyzeRoasteryDoc(file) {
  const mime    = normMime(file.type, file.name)
  const isImage = VALID_MIME.includes(mime)
  const isPdf   = mime === 'application/pdf'
  if (!isImage && !isPdf) throw new Error(`نوع الملف غير مدعوم: ${mime}`)

  const b64   = await toBase64(file)
  const today = new Date().toISOString().split('T')[0]

  const contentBlock = isImage
    ? { type: 'image',    source: { type: 'base64', media_type: mime,              data: b64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }

  const prompt = `أنت مساعد محاسبي. اقرأ هذا المستند وصنّفه — اليوم: ${today}

إذا كان تقرير مبيعات منصة إلكترونية (سلة / تابي / تمارا):
{"type":"مبيعات إلكترونية","platform":"سلة أو تابي أو تمارا","date":"YYYY-MM-DD","gross_sales":0.00,"commission":0.00,"commission_vat":0.00,"net_transfer":0.00}

إذا كان إيصال حوالة بنكية واردة أو تحصيل جملة:
{"type":"tahseel","date":"YYYY-MM-DD","amount":0.00,"description":"وصف الحوالة أو اسم المرسِل"}

قواعد صارمة — لا استثناء:
- JSON فقط بدون أي نص قبله أو بعده
- platform: "سلة" أو "تابي" أو "تمارا" فقط (ليس إنجليزي)
- gross_sales: إجمالي المبيعات قبل خصم العمولة — في تمارا: "إجمالي المبيعات" أو "Gross Sales" أو "Total Sales" أو "GMV"
- commission: عمولة المنصة بدون ضريبة — في تمارا: "رسوم تمارا" أو "عمولة" أو "Platform Fee" أو "Tamara Fee" أو "Merchant Fee"
- commission_vat: ضريبة القيمة المضافة على العمولة — في تمارا: "ضريبة الرسوم" أو "VAT on Fee" أو "VAT"
- net_transfer: صافي المبلغ المحوَّل للبنك — في تمارا: "المبلغ المحوّل" أو "صافي الاستحقاق" أو "Net Settlement" أو "Net Transfer" أو "Total Settlement" أو "Payout" أو "Net Payout"
- net_transfer = gross_sales - commission - commission_vat (تحقق من الحساب)
- إذا كان المستند إيصال إيداع أو حوالة واردة أو مبلغ دخل الحساب → type=tahseel
- date: YYYY-MM-DD — إذا غير واضح استخدم ${today}`

  const res = await fetch('/api/analyze', {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }],
    }),
  })

  if (!res.ok) {
    let detail = ''
    try { const e = await res.json(); detail = e?.error?.message || JSON.stringify(e) } catch {}
    throw new Error(`خطأ في التحليل ${res.status}: ${detail}`)
  }

  const data  = await res.json()
  const text  = data.content[0].text.trim()
  const clean = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const s = clean.indexOf('{'), e = clean.lastIndexOf('}')
  if (s === -1 || e === -1) throw new Error('لا يوجد JSON في رد الذكاء الاصطناعي')
  return JSON.parse(clean.substring(s, e + 1))
}

// emoji للمنصة
function platformIcon(platform) {
  if (platform === 'سلة')  return '🛒'
  if (platform === 'تابي') return '💳'
  return '💳'
}

// ── الصفحة الرئيسية ────────────────────────────────────────────────────────────
export default function RoasterySales() {
  const { projectId } = useAuth()
  const inputRef = useRef()

  const [stage, setStage]     = useState('upload')  // upload | analyzing | review | done
  const [file, setFile]       = useState(null)
  const [preview, setPreview] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [result, setResult]   = useState(null)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  async function handleFile(f) {
    if (!f) return
    const allowed = ['image/jpeg','image/jpg','image/png','image/webp','image/heic','application/pdf']
    if (!allowed.includes(f.type)) { setError('صيغة غير مدعومة — JPG أو PNG أو PDF فقط'); return }
    if (f.size > 10 * 1024 * 1024) { setError('الحد الأقصى 10MB'); return }
    const ready = f.type.startsWith('image/') ? await compressImage(f) : f
    setFile(ready)
    setPreview(ready.type.startsWith('image/') ? URL.createObjectURL(ready) : null)
    setError('')
    runAnalysis(ready)
  }

  async function runAnalysis(f) {
    setStage('analyzing')
    try {
      const r = await analyzeRoasteryDoc(f)
      setResult(r)
      setStage('review')
    } catch (e) {
      setError(e.message)
      setStage('upload')
    }
  }

  function reset() {
    setFile(null); setPreview(null); setResult(null)
    setStage('upload'); setError('')
  }

  async function handleSave() {
    if (!result) return
    setSaving(true); setError('')
    try {
      const date = result.date || new Date().toISOString().split('T')[0]
      const jn   = await getOrCreateJournalNumber(projectId, date)

      const mkEntry = (type, description, amount, dir = 'in') => ({
        project_id: projectId, date, type, description,
        cash_in: 0, cash_out: 0,
        bank_in:  dir === 'in'  ? Number(amount) : 0,
        bank_out: dir === 'out' ? Number(amount) : 0,
        custody_in: 0, custody_out: 0,
        total_amount: Number(amount),
        status: 'approved', journal_number: jn, branch: BRANCH,
      })

      if (result.type === 'مبيعات إلكترونية') {
        const platform   = result.platform || ''
        let gross        = Number(result.gross_sales)    || 0
        const commission = Number(result.commission)     || 0
        const commVat    = Number(result.commission_vat) || 0
        let netTransfer  = Number(result.net_transfer)   || 0
        const icon       = platformIcon(platform)

        // فالباك: احسب الحقل الغائب من الباقين
        if (netTransfer === 0 && gross > 0)
          netTransfer = Math.max(0, gross - commission - commVat)
        if (gross === 0 && netTransfer > 0)
          gross = netTransfer + commission + commVat

        const entries = []

        // ١. صافي التحويل البنكي (bank_in)
        if (netTransfer > 0)
          entries.push(mkEntry(`${icon} مبيعات ${platform}`, `مبيعات ${platform} — صافي التحويل`, netTransfer, 'in'))

        // ٢. مصروف عمولة المنصة (bank_out)
        if (commission > 0)
          entries.push(mkEntry(`💸 عمولة ${platform}`, `عمولة منصة ${platform}`, commission, 'out'))

        // ٣. مصروف ضريبة العمولة (bank_out)
        if (commVat > 0)
          entries.push(mkEntry(`🏛️ ضريبة عمولة ${platform}`, `ضريبة القيمة المضافة على عمولة ${platform}`, commVat, 'out'))

        if (entries.length) {
          const { error: e } = await supabase.from('ledger_entries').insert(entries)
          if (e) throw new Error(e.message)
        }

        // سجل المبيعات — إجمالي المبيعات قبل العمولة
        if (gross > 0) {
          const { error: e } = await supabase.from('sales').upsert({
            project_id: projectId, branch: BRANCH, date,
            cash_sales: 0, network_sales: gross,
            hunger_sales: 0, jahez_sales: 0, keeta_sales: 0,
            description: `مبيعات ${platform} — المحمصة الرئيسية`,
          }, { onConflict: 'project_id,branch,date' })
          if (e) throw new Error(e.message)
        }

      } else if (result.type === 'tahseel') {
        const amount = Number(result.amount) || 0
        if (amount > 0) {
          const { error: e } = await supabase.from('ledger_entries').insert([
            mkEntry('📥 تحصيل جملة', result.description || 'تحصيل جملة', amount, 'in')
          ])
          if (e) throw new Error(e.message)
        }
      }

      setStage('done')
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  // ── Done ──────────────────────────────────────────────────────────────────────
  const wasTahseel = result?.type === 'tahseel'

  if (stage === 'done') return (
    <div className="max-w-xl mx-auto space-y-4">
      <div className="bg-green-50 border border-green-200 rounded-2xl p-10 text-center space-y-3">
        <div className="text-5xl">✅</div>
        <div className="text-lg font-bold text-green-800">تم التسجيل بنجاح</div>
        <p className="text-sm text-green-600">
          {wasTahseel
            ? 'تم تسجيل التحصيل كإيراد بنكي في الدفتر'
            : 'تم إضافة 3 قيود في الدفتر وتحديث سجل المبيعات'}
        </p>
        <button onClick={reset}
          className="mt-2 px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
          رفع مستند آخر
        </button>
      </div>
      {wasTahseel && (
        <div className="rounded-xl px-4 py-3 text-xs"
          style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
          💡 تحصيل الجملة لا يظهر في سجل المبيعات — يظهر فقط في الدفتر كـ bank_in
        </div>
      )}
    </div>
  )

  return (
    <div className="max-w-xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">مبيعات المحمصة 🏭</h1>
        <p className="text-slate-500 text-sm mt-1">ارفع تقرير مبيعات أو إيصال حوالة — الذكاء الاصطناعي يستخرج الأرقام</p>
        <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold"
          style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
          🏢 {BRANCH}
        </div>
      </div>

      {/* ── Upload ─────────────────────────────────────────────────────────────── */}
      {stage === 'upload' && (
        <>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }}
            onClick={() => inputRef.current.click()}
            className={`border-2 border-dashed rounded-2xl p-14 text-center cursor-pointer transition-all duration-200
              ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'}`}
          >
            <div className="text-5xl mb-4">📤</div>
            <p className="font-semibold text-slate-700 text-lg mb-2">ارفع المستند هنا أو انقر للاختيار</p>
            <p className="text-xs text-slate-400 mt-1">تقرير مبيعات سلة / تابي / تمارا · أو إيصال حوالة جملة</p>
            <p className="text-xs text-slate-400 mt-0.5">JPG · PNG · PDF (حتى 10MB)</p>
            <input ref={inputRef} type="file" accept="image/*,.pdf" capture="environment" className="hidden"
              onChange={e => handleFile(e.target.files[0])} />
          </div>
          {error && (
            <p className="text-red-600 text-sm font-medium bg-red-50 rounded-xl p-3 border border-red-100">❌ {error}</p>
          )}
        </>
      )}

      {/* ── Analyzing ──────────────────────────────────────────────────────────── */}
      {stage === 'analyzing' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-10 text-center space-y-4">
          {preview && (
            <img src={preview} alt="preview"
              className="w-full max-h-48 object-contain rounded-xl bg-slate-50 mb-2" />
          )}
          {!preview && file && <div className="text-5xl mb-2">📄</div>}
          <div className="flex items-center justify-center gap-3">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/>
            <span className="text-slate-600 font-medium">الذكاء الاصطناعي يحلل المستند...</span>
          </div>
          <p className="text-xs text-slate-400">قد يستغرق بضع ثوانٍ</p>
        </div>
      )}

      {/* ── Review ─────────────────────────────────────────────────────────────── */}
      {stage === 'review' && result && (
        <ReviewPanel
          result={result}
          setResult={setResult}
          preview={preview}
          file={file}
          onSave={handleSave}
          onReset={reset}
          saving={saving}
          error={error}
        />
      )}
    </div>
  )
}

// ── لوحة المراجعة ─────────────────────────────────────────────────────────────
function ReviewPanel({ result, setResult, preview, file, onSave, onReset, saving, error }) {
  const isPlatform = result.type === 'مبيعات إلكترونية'
  const isTahseel  = result.type === 'tahseel'

  const netTransfer = Number(result.net_transfer) || 0
  const gross       = Number(result.gross_sales)  || 0

  // الإجمالي المعروض في الزر — صافي التحويل للمنصة أو مبلغ التحصيل
  const displayTotal = isPlatform ? netTransfer : (Number(result.amount) || 0)
  const saveDisabled = saving || displayTotal === 0

  return (
    <div className="space-y-4">
      {/* Preview */}
      {(preview || file) && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
          {preview
            ? <img src={preview} alt="preview"
                className="w-full max-h-48 object-contain rounded-xl bg-slate-50" />
            : <div className="flex items-center gap-3 py-2">
                <span className="text-3xl">📄</span>
                <span className="text-sm text-slate-600 truncate">{file?.name}</span>
              </div>
          }
        </div>
      )}

      {/* نوع المستند */}
      <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold
        ${isPlatform
          ? 'bg-blue-50 text-blue-800 border border-blue-200'
          : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
        {isPlatform
          ? `${platformIcon(result.platform)} تقرير مبيعات ${result.platform || 'إلكترونية'}`
          : '📥 تحصيل جملة — حوالة واردة'}
      </div>

      {/* رسالة توضيحية — تحصيل الجملة فقط */}
      {isTahseel && (
        <div className="rounded-xl p-4 text-sm space-y-1"
          style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
          <p className="font-semibold">💡 ما هو تحصيل الجملة؟</p>
          <p>استلام مبلغ من عميل جملة سبق البيع له — وليس مبيعات جديدة.</p>
          <p className="text-xs mt-1" style={{ color: '#b45309' }}>
            يُسجَّل كإيراد بنكي في الدفتر فقط ولا يُضاف لسجل المبيعات.
          </p>
        </div>
      )}

      {/* رسالة توضيحية — مبيعات إلكترونية */}
      {isPlatform && (
        <div className="rounded-xl p-3 text-xs"
          style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}>
          💡 سيتم إنشاء 3 قيود: صافي التحويل (bank_in) + عمولة المنصة (bank_out) + ضريبة العمولة (bank_out)
        </div>
      )}

      {/* الحقول */}
      <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4" style={{ border: '2px solid #e8e5dc' }}>

        {/* التاريخ */}
        <div>
          <label className="text-xs text-slate-400 block mb-1">📅 التاريخ</label>
          <input
            type="date" value={result.date || ''}
            onChange={e => setResult(r => ({ ...r, date: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            style={{ direction: 'ltr' }}
          />
        </div>

        {isPlatform ? (
          <>
            {/* المنصة */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">🏪 المنصة</label>
              <select
                value={result.platform || ''}
                onChange={e => setResult(r => ({ ...r, platform: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="سلة">سلة</option>
                <option value="تابي">تابي</option>
                <option value="تمارا">تمارا</option>
              </select>
            </div>

            {/* إجمالي المبيعات */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">💰 إجمالي المبيعات (قبل العمولة)</label>
              <input
                type="number" value={result.gross_sales ?? ''} min="0" step="0.01" placeholder="0.00"
                onChange={e => setResult(r => ({ ...r, gross_sales: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                style={{ direction: 'ltr' }}
              />
            </div>

            {/* عمولة المنصة */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">💸 عمولة المنصة</label>
              <input
                type="number" value={result.commission ?? ''} min="0" step="0.01" placeholder="0.00"
                onChange={e => setResult(r => ({ ...r, commission: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                style={{ direction: 'ltr' }}
              />
            </div>

            {/* ضريبة العمولة */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">🏛️ ضريبة العمولة (VAT)</label>
              <input
                type="number" value={result.commission_vat ?? ''} min="0" step="0.01" placeholder="0.00"
                onChange={e => setResult(r => ({ ...r, commission_vat: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                style={{ direction: 'ltr' }}
              />
            </div>

            {/* صافي التحويل */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">🏦 صافي التحويل للبنك</label>
              <input
                type="number" value={result.net_transfer ?? ''} min="0" step="0.01" placeholder="0.00"
                onChange={e => setResult(r => ({ ...r, net_transfer: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                style={{ direction: 'ltr' }}
              />
            </div>

            {/* ملخص */}
            {gross > 0 && (
              <div className="rounded-xl p-4 space-y-2 text-sm" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <div className="flex justify-between">
                  <span className="text-slate-500">إجمالي المبيعات</span>
                  <span className="font-mono font-semibold text-slate-800">{fmt(gross)} ر.س</span>
                </div>
                <div className="flex justify-between text-red-600">
                  <span>− عمولة + ضريبة</span>
                  <span className="font-mono font-semibold">{fmt((Number(result.commission) || 0) + (Number(result.commission_vat) || 0))} ر.س</span>
                </div>
                <div className="flex justify-between font-bold border-t pt-2" style={{ borderColor: '#e2e8f0', color: '#1d4ed8' }}>
                  <span>= صافي التحويل</span>
                  <span className="font-mono">{fmt(netTransfer)} ر.س</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div>
              <label className="text-xs text-slate-400 block mb-1">💰 المبلغ</label>
              <input
                type="number" value={result.amount ?? ''} min="0" step="0.01" placeholder="0.00"
                onChange={e => setResult(r => ({ ...r, amount: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                style={{ direction: 'ltr' }}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">الوصف / اسم المرسِل</label>
              <input
                value={result.description || ''}
                onChange={e => setResult(r => ({ ...r, description: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {displayTotal > 0 && (
              <div className="flex items-center justify-between px-4 py-3 rounded-xl"
                style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                <span className="font-bold text-green-800">المبلغ المحصَّل</span>
                <span className="font-mono font-bold text-green-800 text-lg">{fmt(displayTotal)} ر.س</span>
              </div>
            )}
          </>
        )}
      </div>

      {error && (
        <p className="text-red-600 text-sm font-medium bg-red-50 rounded-xl p-3 border border-red-100">❌ {error}</p>
      )}

      <div className="flex gap-3">
        <button
          onClick={onReset}
          className="flex-1 py-3 border border-slate-200 text-slate-600 rounded-xl font-medium text-sm hover:bg-slate-50 transition-colors"
        >
          ← رفع آخر
        </button>
        <button
          onClick={onSave}
          disabled={saveDisabled}
          className="flex-[2] py-3 text-white rounded-xl font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          style={{ background: saveDisabled ? '#94a3b8' : NAVY }}
        >
          {saving
            ? <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/><span>جارٍ الحفظ...</span></>
            : '✅ حفظ في الدفتر'
          }
        </button>
      </div>
    </div>
  )
}

