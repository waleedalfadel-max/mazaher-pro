import React, { useState, useEffect, useRef } from 'react'
import { PDFDocument } from 'pdf-lib'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { analyzeBankStatementPage } from '../lib/claude'
import { matchLinesToLedger, computeNetworkAggregate, buildLedgerInsertRow, normCat } from '../lib/bankReconciliation'
import { getTransactionTypes } from '../lib/projectSettings'
import { getOrCreateJournalNumber } from '../lib/journalNumber'
import { uploadToStorage } from '../lib/storage'

// v1: مقتصرة على هذا المشروع فقط للاختبار — الكود عام وجاهز لأي مشروع آخر بدون تعديل،
// فقط احذف هذا الشرط (أو وسّعه) لاحقاً لإتاحتها لمشاريع أخرى
const TARGET_PROJECT = 'ديوانية مزاهر'

const BANK_CAT_LABEL = {
  pos_credit:       'نقاط بيع / دائنة التاجر',
  installment_loan: 'قسط / قرض',
  fee:              'عمولة / رسوم',
  transfer:         'تحويل',
  cash_deposit:     'إيداع نقدي',
  other:            'أخرى',
}

const fmt = v => (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function fmtDate(d) { return d.toISOString().split('T')[0] }
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return fmtDate(d)
}

function isCommissionLine(item) {
  return item.bank_category === 'fee' || /commission/i.test(item.description || '')
}

function pickCommissionTransType(transTypes) {
  const dedicated = transTypes.find(t => normCat(t).includes(normCat('عمولات بنكية')))
  if (dedicated) return dedicated
  const opEx = transTypes.find(t => normCat(t) === normCat('مصروفات تشغيلية'))
  return opEx || '🛒 مصروفات تشغيلية'
}

function pickCommissionCategorySub(categories, transType) {
  const parentCats = categories.filter(c => !c.parent_id)
  const parent = parentCats.find(p => normCat(p.name) === normCat(transType))
  if (!parent) return 'أخرى'
  const subs = categories.filter(c => c.parent_id === parent.id)
  const match = subs.find(s => normCat(s.name).includes('عمولات') || normCat(s.name).includes('رسوم بنكية'))
  return match ? match.name : 'أخرى'
}

function uint8ToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export default function BankReconciliation() {
  const { projectId, projectName } = useAuth()
  const today = fmtDate(new Date())

  const [from, setFrom]   = useState(addDays(today, -30))
  const [to, setTo]       = useState(today)
  const [file, setFile]   = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy]   = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [transTypes, setTransTypes] = useState([])
  const [categories, setCategories] = useState([])
  const [statementFileUrl, setStatementFileUrl] = useState(null)
  const [commissionExpanded, setCommissionExpanded] = useState(false)
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

  if (projectName !== TARGET_PROJECT) {
    return (
      <div className="max-w-lg mx-auto text-center py-20 text-slate-400">
        <div className="text-4xl mb-3">🚧</div>
        <p className="font-medium">هذه الميزة غير متاحة لمشروعك بعد</p>
      </div>
    )
  }

  function handleFile(f) {
    if (!f) return
    if (f.type !== 'application/pdf') { setError('الملف يجب أن يكون PDF'); return }
    setFile(f); setError(''); setResult(null); setStatementFileUrl(null)
  }

  async function runReconciliation() {
    if (!file) return
    setBusy(true); setError(''); setResult(null); setProgress(null)
    try {
      const bytes   = await file.arrayBuffer()
      const srcDoc  = await PDFDocument.load(bytes)
      const pageCount = srcDoc.getPageCount()

      let allLines = []
      for (let i = 0; i < pageCount; i++) {
        setProgress({ page: i + 1, total: pageCount })
        const pageDoc = await PDFDocument.create()
        const [copied] = await pageDoc.copyPages(srcDoc, [i])
        pageDoc.addPage(copied)
        const pageBytes = await pageDoc.save()
        const pageBase64 = uint8ToBase64(pageBytes)
        const lines = await analyzeBankStatementPage(pageBase64, file.name, `صفحة ${i + 1} من ${pageCount}`)
        allLines = allLines.concat(lines)
      }
      setProgress(null)

      // فلترة الحركات ضمن الفترة المختارة فقط (Claude قد يستخرج حركات خارج النطاق لو الكشف أوسع)
      allLines = allLines.filter(l => l.date >= from && l.date <= to)

      // جلب قيود الدفتر بهامش يومين من كل طرف — يغطي مطابقة مبيعات الشبكة (±2) ومطابقة السطور (±1)
      const qFrom = addDays(from, -2)
      const qTo   = addDays(to, 2)
      const { data: ledgerEntries, error: ledgerErr } = await supabase
        .from('ledger_entries')
        .select('id,date,type,description,bank_in,bank_out,status')
        .eq('project_id', projectId)
        .gte('date', qFrom).lte('date', qTo)
        .neq('status', 'cancelled')
      if (ledgerErr) throw new Error(ledgerErr.message)

      const network = computeNetworkAggregate(allLines, ledgerEntries || [])
      const { matchedCount, unmatchedLines, unmatchedEntries } = matchLinesToLedger(allLines, ledgerEntries || [])

      // "موجود في تحسيب لكن غير موجود بالبنك" — نعرض فقط ما كان ضمن الفترة المطلوبة فعلياً
      const missingFromBank = unmatchedEntries.filter(e => e.date >= from && e.date <= to)

      setResult({
        matchedCount,
        network,
        reviewList: unmatchedLines.map((l, i) => ({ ...l, _key: i, _transType: '', _categorySub: '', _busy: false })),
        missingList: missingFromBank,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  function updateReview(key, patch) {
    setResult(r => ({ ...r, reviewList: r.reviewList.map(item => item._key === key ? { ...item, ...patch } : item) }))
  }

  function dismissReview(key) {
    setResult(r => ({ ...r, reviewList: r.reviewList.filter(item => item._key !== key) }))
  }

  async function approveReview(item) {
    if (!item._transType) { setError('يرجى اختيار نوع الحركة قبل الاعتماد'); return }
    setError('')
    updateReview(item._key, { _busy: true })
    try {
      let fileUrl = statementFileUrl
      if (!fileUrl && file) {
        fileUrl = await uploadToStorage(file, projectId || 'shared')
        setStatementFileUrl(fileUrl)
      }

      const amount = Number(item.amount) || 0
      const { data: dup } = await supabase.from('ledger_entries').select('id')
        .eq('project_id', projectId).eq('date', item.date)
        .eq('type', item._transType).eq('description', item.description)
        .eq('total_amount', amount).neq('status', 'cancelled').maybeSingle()
      if (dup) {
        setError('هذا القيد مسجل مسبقاً في الدفتر — لم يتم إدراجه مرة أخرى')
        updateReview(item._key, { _busy: false })
        return
      }

      const jn = await getOrCreateJournalNumber(projectId, item.date)
      const row = buildLedgerInsertRow(item, {
        transType: item._transType,
        categorySub: item._categorySub,
        projectId,
        journalNumber: jn,
        fileUrl,
      })
      const { error: insErr } = await supabase.from('ledger_entries').insert(row)
      if (insErr) throw new Error(insErr.message)

      setResult(r => ({
        ...r,
        matchedCount: r.matchedCount + 1,
        reviewList: r.reviewList.filter(x => x._key !== item._key),
      }))
    } catch (e) {
      setError(e.message)
      updateReview(item._key, { _busy: false })
    }
  }

  function dismissAllCommissions(lines) {
    const keys = lines.map(l => l._key)
    setResult(r => ({ ...r, reviewList: r.reviewList.filter(item => !keys.includes(item._key)) }))
  }

  async function approveAllCommissions(lines) {
    if (!lines.length) return
    setError('')
    setResult(r => ({ ...r, reviewList: r.reviewList.map(item => isCommissionLine(item) ? { ...item, _busy: true } : item) }))

    let fileUrl = statementFileUrl
    try {
      if (!fileUrl && file) {
        fileUrl = await uploadToStorage(file, projectId || 'shared')
        setStatementFileUrl(fileUrl)
      }
    } catch (e) {
      setError(e.message)
      setResult(r => ({ ...r, reviewList: r.reviewList.map(item => isCommissionLine(item) ? { ...item, _busy: false } : item) }))
      return
    }

    const transType   = pickCommissionTransType(transTypes)
    const categorySub = pickCommissionCategorySub(categories, transType)

    const doneKeys = []
    let skippedDup = 0
    let failMsg = ''

    for (const item of lines) {
      try {
        const amount = Number(item.amount) || 0
        const { data: dup } = await supabase.from('ledger_entries').select('id')
          .eq('project_id', projectId).eq('date', item.date)
          .eq('type', transType).eq('description', item.description)
          .eq('total_amount', amount).neq('status', 'cancelled').maybeSingle()
        if (dup) { skippedDup++; doneKeys.push(item._key); continue }

        const jn = await getOrCreateJournalNumber(projectId, item.date)
        const row = buildLedgerInsertRow(item, { transType, categorySub, projectId, journalNumber: jn, fileUrl })
        const { error: insErr } = await supabase.from('ledger_entries').insert(row)
        if (insErr) throw new Error(insErr.message)
        doneKeys.push(item._key)
      } catch (e) {
        failMsg = `توقفت العملية عند حركة بتاريخ ${item.date}: ${e.message}`
        break
      }
    }

    setResult(r => {
      const remaining = r.reviewList.filter(x => !doneKeys.includes(x._key))
      return {
        ...r,
        matchedCount: r.matchedCount + doneKeys.length,
        reviewList: remaining.map(item => isCommissionLine(item) ? { ...item, _busy: false } : item),
      }
    })

    if (failMsg) setError(failMsg)
    else if (skippedDup > 0) setError(`تنبيه: ${skippedDup} عمولة كانت مسجلة مسبقاً بالدفتر ولم تُكرَّر`)
  }

  const parentCats = categories.filter(c => !c.parent_id)
  function subCatsFor(transType) {
    const parent = parentCats.find(p => normCat(p.name) === normCat(transType || ''))
    return parent ? categories.filter(c => c.parent_id === parent.id) : []
  }

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">🧮 المطابقة البنكية</h1>
        <p className="text-sm text-slate-500 mt-1">قارن كشف الحساب البنكي بحركات الدفتر واكتشف الفروقات</p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800 font-medium">
        🕐 لأفضل دقة، ننصح بعمل المطابقة كل 15 يوم أو شهرياً — بسبب اختلاف توقيت تسوية مدى/فيزا/ماستركارد بين البنك ونظام نقاط البيع
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 space-y-4">
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
          <p className="font-semibold text-slate-700">{file ? file.name : 'اسحب كشف الحساب هنا أو اضغط لاختياره'}</p>
          <p className="text-xs text-slate-400 mt-1">PDF فقط</p>
          <input ref={inputRef} type="file" accept="application/pdf" className="hidden"
            onChange={e => handleFile(e.target.files[0])}/>
        </div>

        {error && <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-red-700 text-sm">❌ {error}</div>}

        <button onClick={runReconciliation} disabled={!file || busy}
          className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {busy
            ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                <span>{progress ? `جارٍ تحليل صفحة ${progress.page} من ${progress.total}` : 'جارٍ التحليل...'}</span></>
            : '🔍 بدء المطابقة'}
        </button>
      </div>

      {result && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
              <div className="text-2xl font-bold text-green-700">{result.matchedCount}</div>
              <div className="text-sm text-green-600 mt-1">✅ متطابق</div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
              <div className="text-2xl font-bold text-amber-700">{result.reviewList.length}</div>
              <div className="text-sm text-amber-600 mt-1">⚠️ فروقات تحتاج مراجعة</div>
            </div>
          </div>

          {result.network.hasIssue && (
            <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-4 space-y-2">
              <div className="font-bold text-red-800 flex items-center gap-2">⚠️ فرق في مبيعات الشبكة</div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div><span className="text-slate-400 text-xs block">إجمالي البنك</span><span className="font-semibold">{fmt(result.network.bankTotal)}</span></div>
                <div><span className="text-slate-400 text-xs block">إجمالي تحسيب</span><span className="font-semibold">{fmt(result.network.systemTotal)}</span></div>
                <div><span className="text-slate-400 text-xs block">الفرق</span><span className="font-bold text-red-700">{fmt(result.network.diff)}</span></div>
              </div>
            </div>
          )}

          {result.reviewList.length > 0 && (() => {
            const commissionLines = result.reviewList.filter(isCommissionLine)
            const otherLines      = result.reviewList.filter(item => !isCommissionLine(item))
            return (
              <div className="space-y-3">
                <div className="text-sm font-bold text-slate-600">غير مسجل في تحسيب</div>

                {commissionLines.length > 0 && (
                  <CommissionGroupCard
                    lines={commissionLines}
                    expanded={commissionExpanded}
                    onToggle={() => setCommissionExpanded(v => !v)}
                    onApproveAll={() => approveAllCommissions(commissionLines)}
                    onDismissAll={() => dismissAllCommissions(commissionLines)}
                    busy={commissionLines.some(l => l._busy)}
                  />
                )}

                {otherLines.map(item => (
                  <ReviewCard key={item._key} item={item}
                    transTypes={transTypes}
                    subCats={subCatsFor(item._transType)}
                    onChangeType={v => updateReview(item._key, { _transType: v, _categorySub: '' })}
                    onChangeSub={v => updateReview(item._key, { _categorySub: v })}
                    onApprove={() => approveReview(item)}
                    onDismiss={() => dismissReview(item._key)}
                  />
                ))}
              </div>
            )
          })()}

          {result.missingList.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-bold text-slate-600">موجود في تحسيب لكن غير موجود بالبنك</div>
              {result.missingList.map(e => (
                <div key={e.id} className="bg-white rounded-xl border border-slate-100 p-3 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-medium text-slate-700">{e.description || e.type}</div>
                    <div className="text-xs text-slate-400">{e.date} · {e.type}</div>
                  </div>
                  <span className="font-mono font-semibold text-slate-600">{fmt(e.bank_in || e.bank_out)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function CommissionGroupCard({ lines, expanded, onToggle, onApproveAll, onDismissAll, busy }) {
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-4 text-right">
        <div>
          <div className="font-bold text-slate-800 flex items-center gap-2">💳 عمولات نقاط البيع</div>
          <div className="text-xs text-slate-400 mt-0.5">{lines.length} حركة — الإجمالي: {fmt(total)} ريال</div>
        </div>
        <span className={`text-slate-400 transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 max-h-64 overflow-y-auto">
          {lines.map(l => (
            <div key={l._key} className="flex items-center justify-between px-4 py-2 text-sm border-b border-slate-50 last:border-0">
              <span className="text-slate-500">{l.date}</span>
              <span className="font-mono text-slate-700">{fmt(l.amount)} ريال</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 p-4 border-t border-slate-100">
        <button onClick={onApproveAll} disabled={busy}
          className="flex-1 py-2 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition-colors disabled:opacity-50">
          {busy ? '...' : '✅ اعتماد الكل كعمولات'}
        </button>
        <button onClick={onDismissAll} disabled={busy}
          className="px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-semibold hover:bg-red-600 hover:text-white transition-colors disabled:opacity-50">
          🚫 تجاهل الكل
        </button>
      </div>
    </div>
  )
}

function ReviewCard({ item, transTypes, subCats, onChangeType, onChangeSub, onApprove, onDismiss }) {
  const catLabel = BANK_CAT_LABEL[item.bank_category] || item.bank_category

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-slate-800 text-sm truncate">{item.description}</div>
          <div className="text-xs text-slate-400 mt-0.5">{item.date} · {catLabel}</div>
        </div>
        <span className={`font-mono font-bold text-sm shrink-0 ${item.direction === 'in' ? 'text-green-700' : 'text-red-700'}`}>
          {item.direction === 'in' ? '+' : '−'}{fmt(item.amount)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-slate-400 block mb-1">نوع الحركة</label>
          <select value={item._transType} onChange={e => onChangeType(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option value="">— اختر —</option>
            {transTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">التصنيف الفرعي</label>
          <select value={item._categorySub} onChange={e => onChangeSub(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option value="">— اختر —</option>
            {subCats.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={onApprove} disabled={item._busy}
          className="flex-1 py-2 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition-colors disabled:opacity-50">
          {item._busy ? '...' : '✅ اعتماد وتسجيل'}
        </button>
        <button onClick={onDismiss} disabled={item._busy}
          className="px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-semibold hover:bg-red-600 hover:text-white transition-colors disabled:opacity-50">
          🚫 تجاهل
        </button>
      </div>
    </div>
  )
}
