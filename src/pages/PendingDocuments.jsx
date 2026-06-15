import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { analyzeDocument } from '../lib/claude'
import { getOrCreateJournalNumber } from '../lib/journalNumber'
import { fetchAsBase64 } from '../lib/storage'
import { getTransactionTypes, getProjectSettings } from '../lib/projectSettings'
import { compressImageBase64 } from '../lib/imageCompress'

function readableName(doc, res) {
  if (res?.description?.trim()) return res.description.trim()
  const base = (doc.file_name || '').split('/').pop()
  return base.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || doc.file_name
}

const FALLBACK_TRANS_TYPES = [
  '💵 مبيعات كاش','🏦 مبيعات شبكة','🛒 مصروفات تشغيلية','💰 مصروفات ثابتة',
  '💳 قسط سيارة','💳 قسط شراء أرض','💳 قرض ١','💳 قرض ٢',
  '👤 صرف عهدة','💼 مسحوبات سليمان','💼 مسحوبات فايز','🏛️ ضريبة القيمة المضافة',
  '🔄 تحويل داخلي — صرف عهدة','🏧 تحويل داخلي — إيداع نقدي','📥 تحصيل جملة',
]

const ROLE_AR    = { purchasing: 'مسؤول المشتريات', accountant: 'المحاسب', owner: 'المالك', cashier: 'الكاشير' }
const ROLE_COLOR = {
  purchasing: 'bg-blue-100 text-blue-700',
  accountant: 'bg-purple-100 text-purple-700',
  owner:      'bg-amber-100 text-amber-700',
  cashier:    'bg-green-100 text-green-700',
}

// مقارنة مرنة — تبقي العربية فقط، تحذف الإيموجي والرموز والمسافات الزائدة
const normCat = s => (s || '').replace(/[^؀-ۿ\s]/g, '').replace(/\s+/g, ' ').trim()

export default function PendingDocuments() {
  const { projectId, projectName } = useAuth()
  const [docs, setDocs]             = useState([])
  const [loading, setLoading]       = useState(true)
  const [transTypes, setTransTypes] = useState(FALLBACK_TRANS_TYPES)
  const [categories, setCategories] = useState([])
  const [branches,   setBranches]   = useState([])
  const [suppliers,  setSuppliers]  = useState([])
  const pidRef                      = useRef(null)

  useEffect(() => {
    pidRef.current = projectId
    if (projectId) {
      getTransactionTypes(projectId).then(setTransTypes)
      getProjectSettings(projectId).then(s => setBranches(s?.settings?.branches || []))
      loadDocs(projectId).then(() => setLoading(false))
      supabase.from('categories')
        .select('id,name,parent_id,type,sort_order')
        .eq('project_id', projectId)
        .order('sort_order')
        .then(({ data }) => setCategories(data || []))
      supabase.from('suppliers')
        .select('id,name')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .order('name')
        .then(({ data }) => setSuppliers(data || []))
    }
  }, [projectId])

  async function loadDocs(pid) {
    let q = supabase.from('documents')
      .select('id,file_name,file_type,status,analysis_result,uploaded_at,uploaded_by,file_url,branch,purchase_category,category_main,category_sub')
      .in('status', ['uploaded', 'analyzed'])
      .order('uploaded_at', { ascending: false })
    if (pid) q = q.eq('project_id', pid)
    const { data } = await q
    setDocs((data || []).map(d => ({
      ...d,
      _state: 'idle', _error: '', _edit: d.analysis_result || null,
      _imageData: null, _showImage: false, _isUrl: false,
    })))
  }

  function updateDoc(id, patch) {
    setDocs(ds => ds.map(d => d.id === id ? { ...d, ...patch } : d))
  }

  async function loadImage(doc) {
    if (doc._imageData) { updateDoc(doc.id, { _showImage: !doc._showImage }); return }
    if (doc.file_url) {
      updateDoc(doc.id, { _imageData: doc.file_url, _isUrl: true, _showImage: true })
      return
    }
    updateDoc(doc.id, { _loadingImg: true })
    const { data } = await supabase.from('documents').select('file_data').eq('id', doc.id).single()
    updateDoc(doc.id, { _imageData: data?.file_data || null, _isUrl: false, _showImage: true, _loadingImg: false })
  }

  async function analyze(doc) {
    updateDoc(doc.id, { _state: 'analyzing', _error: '' })
    try {
      let fileBase64, fileMime
      if (doc.file_url) {
        const fetched = await fetchAsBase64(doc.file_url)
        fileBase64 = fetched.base64
        fileMime   = fetched.mimeType || doc.file_type
      } else {
        const { data } = await supabase.from('documents').select('file_data').eq('id', doc.id).single()
        if (!data?.file_data) throw new Error('لا توجد بيانات الملف')
        fileBase64 = data.file_data
        fileMime   = doc.file_type
      }
      if (fileMime?.startsWith('image/')) {
        fileBase64 = await compressImageBase64(fileBase64, fileMime)
        fileMime   = 'image/jpeg'
      }
      const result = await analyzeDocument(fileBase64, fileMime, doc.file_name, doc.uploaded_by, categories)
      await supabase.from('documents').update({ status: 'analyzed', analysis_result: result }).eq('id', doc.id)
      updateDoc(doc.id, {
        _state: 'analyzed', status: 'analyzed',
        analysis_result: result, _edit: result,
        _imageData: doc.file_url || fileBase64,
        _isUrl: !!doc.file_url,
        _showImage: true,
      })
    } catch(e) { updateDoc(doc.id, { _state: 'idle', _error: e.message }) }
  }

  async function checkLedgerDup(pid, date, type, description, total_amount) {
    const { data } = await supabase.from('ledger_entries').select('id')
      .eq('project_id', pid).eq('date', date)
      .eq('type', type).eq('description', description)
      .eq('total_amount', total_amount).neq('status', 'cancelled')
      .maybeSingle()
    return !!data
  }

  async function approve(doc, forceNew = false) {
    const res = doc._edit || doc.analysis_result
    if (doc.purchase_category && res) res.transType = doc.purchase_category

    // ── تحقق الإلزامي لمحمصة كون ──────────────────────────────────────
    const isMahmasa = projectName === 'محمصة كون'
    if (isMahmasa && res?.type !== 'sales' && res?.type !== 'transfer') {
      const missingType = !res?.transType
      const missingPay  = !res?.paySource
      if (missingType || missingPay) {
        updateDoc(doc.id, { _validationError: { missingType, missingPay } })
        return
      }
    }
    updateDoc(doc.id, { _state: 'approving', _validationError: null, _dupCheck: false })

    try {
      const pay        = res.paySource || 'custody'
      const isIncoming = res.transType?.includes('تحصيل جملة')

      if (res.type === 'sales') {
        // ── مبيعات ──────────────────────────────────────────────────────
        const cash    = Number(res.cashSales)    || 0
        const network = Number(res.networkSales) || 0
        const hunger  = Number(res.hungerSales)  || 0
        const jahez   = Number(res.jahez)         || 0
        const keeta   = Number(res.keeta)         || 0
        const date    = res.date

        const { error: e1 } = await supabase.from('sales').insert({
          project_id: pidRef.current, date,
          cash_sales: cash, network_sales: network,
          hunger_sales: hunger, jahez_sales: jahez, keeta_sales: keeta,
          description: 'تقرير POS', branch: doc.branch || null,
        })
        if (e1) throw new Error(e1.message)

        const jn = await getOrCreateJournalNumber(pidRef.current, date)
        const mkEntry = (type, desc, cash_in, bank_in, amt) => ({
          project_id: pidRef.current, date, type, description: desc,
          cash_in, cash_out: 0, bank_in, bank_out: 0, custody_in: 0, custody_out: 0,
          total_amount: amt, status: 'approved', journal_number: jn,
          file_url: doc.file_url || '', branch: doc.branch || null,
        })
        const entries = []
        if (cash    > 0) entries.push(mkEntry('💵 مبيعات كاش',          'مبيعات كاش — POS',          cash,    0,       cash))
        if (network > 0) entries.push(mkEntry('🏦 مبيعات شبكة',         'مبيعات شبكة — POS',         0,       network, network))
        if (hunger  > 0) entries.push(mkEntry('🍔 مبيعات هنقر ستيشن',   'مبيعات هنقر ستيشن — POS',   0,       hunger,  hunger))
        if (jahez   > 0) entries.push(mkEntry('🛵 مبيعات جاهز',          'مبيعات جاهز — POS',          0,       jahez,   jahez))
        if (keeta   > 0) entries.push(mkEntry('🛺 مبيعات كيتا',          'مبيعات كيتا — POS',          0,       keeta,   keeta))
        if (entries.length) {
          if (!forceNew) {
            const first = entries[0]
            const isDup = await checkLedgerDup(pidRef.current, date, first.type, first.description, first.total_amount)
            if (isDup) { updateDoc(doc.id, { _state: 'analyzed', _dupCheck: true }); return }
          }
          if (forceNew) {
            const uid = Date.now().toString(36)
            entries.forEach(e => { e.description += ` [${uid}]` })
          }
          const { data: insertedEntries, error: e2 } = await supabase.from('ledger_entries').insert(entries).select('id')
          if (e2) throw new Error(e2.message)
          if (!insertedEntries?.length) throw new Error('فشل تسجيل القيود في الدفتر')
          await supabase.from('documents').update({ journal_number: jn }).eq('id', doc.id)
        }

      } else if (res.type === 'transfer') {
        // ── تحويل داخلي (صرف عهدة / إيداع نقدي) ────────────────────────
        const amount = Number(res.amount) || 0
        const jn = await getOrCreateJournalNumber(pidRef.current, res.date)
        const isCustody = res.transType?.includes('صرف عهدة')
        const entryFields = isCustody
          ? { cash_in: 0, bank_in: 0, custody_in: amount, cash_out: 0, bank_out: amount, custody_out: 0 }
          : { cash_in: 0, bank_in: amount, custody_in: 0, cash_out: amount, bank_out: 0, custody_out: 0 }
        const transferType = res.transType || (isCustody ? '🔄 تحويل داخلي — صرف عهدة' : '🏧 تحويل داخلي — إيداع نقدي')
        const transferDesc = res.description || doc.file_name
        if (!forceNew) {
          const isDup = await checkLedgerDup(pidRef.current, res.date, transferType, transferDesc, amount)
          if (isDup) { updateDoc(doc.id, { _state: 'analyzed', _dupCheck: true }); return }
        }
        const transferDescFinal = forceNew
          ? `${transferDesc} [${Date.now().toString(36)}]`
          : transferDesc
        const { data: transferInserted, error: err } = await supabase.from('ledger_entries').insert({
          project_id:    pidRef.current,
          date:          res.date,
          type:          transferType,
          description:   transferDescFinal,
          ...entryFields,
          vat_amount:    0,
          total_amount:  amount,
          status:        'approved',
          file_url:      doc.file_url || '',
          journal_number: jn,
          branch:        doc.branch || null,
        }).select('id').single()
        if (err) throw new Error(err.message)
        if (!transferInserted) throw new Error('فشل تسجيل القيد في الدفتر')
        await supabase.from('documents').update({ journal_number: jn }).eq('id', doc.id)

      } else if (pay === 'credit') {
        // ── مشتريات آجلة — تُسجَّل في حساب المورد فقط ─────────────────
        const supplierId = doc._supplierId
        if (!supplierId) throw new Error('يرجى اختيار المورد قبل التسجيل')
        const amount = Number(res.totalAmount || res.amount) || 0
        const jn = await getOrCreateJournalNumber(pidRef.current, res.date)
        const { error: err } = await supabase.from('supplier_transactions').insert({
          supplier_id: supplierId,
          project_id:  pidRef.current,
          type:        'invoice',
          amount,
          date:        res.date,
          notes:       res.description || doc.file_name,
          document_id: doc.id,
          journal_number: jn,
        })
        if (err) throw new Error(err.message)
        await supabase.from('documents').update({ journal_number: jn }).eq('id', doc.id)

      } else if (res.type === 'expense' && res.items?.length > 0) {
        // ── مصروف متعدد البنود: قيد واحد + document_items ───────────────
        const jn         = await getOrCreateJournalNumber(pidRef.current, res.date)
        const itemsTotal = res.items.reduce((s, it) => s + (Number(it.amount) || 0), 0)
        const totalAmt   = Number(res.totalAmount || res.amount) || itemsTotal
        const vatTotal   = Number(res.vatAmount) || 0
        const transType  = res.transType || '🛒 مصروفات تشغيلية'
        const itemsDesc  = res.description || doc.file_name

        if (!forceNew) {
          const isDup = await checkLedgerDup(pidRef.current, res.date, transType, itemsDesc, totalAmt)
          if (isDup) { updateDoc(doc.id, { _state: 'analyzed', _dupCheck: true }); return }
        }
        const itemsDescFinal = forceNew
          ? `${itemsDesc} [${Date.now().toString(36)}]`
          : itemsDesc

        // قيد واحد بإجمالي الفاتورة — INSERT أولاً وتحقق من نجاحه قبل أي شيء
        const { data: itemsInserted, error: ledgerErr } = await supabase.from('ledger_entries').insert({
          project_id:   pidRef.current,
          date:         res.date,
          type:         transType,
          description:  itemsDescFinal,
          cash_out:     !isIncoming && pay === 'cash'    ? totalAmt : 0,
          bank_out:     !isIncoming && pay === 'bank'    ? totalAmt : 0,
          custody_out:  !isIncoming && pay === 'custody' ? totalAmt : 0,
          cash_in:      isIncoming && pay === 'cash'    ? totalAmt : 0,
          bank_in:      isIncoming && pay === 'bank'    ? totalAmt : 0,
          custody_in:   isIncoming && pay === 'custody' ? totalAmt : 0,
          vat_amount:   vatTotal,
          total_amount: totalAmt,
          status:       'approved',
          file_url:     doc.file_url || '',
          journal_number: jn,
          branch:       doc.branch || null,
          purchase_category: doc.purchase_category || null,
          category_main: null,
          category_sub:  null,
        }).select('id').single()
        if (ledgerErr) throw new Error(ledgerErr.message)
        if (!itemsInserted) throw new Error('فشل تسجيل القيد في الدفتر')

        // بنود مفصّلة في document_items
        const itemRows = res.items.map((item, i) => {
          const amt    = Number(item.amount) || 0
          const itemVat = itemsTotal > 0 ? parseFloat((vatTotal * amt / itemsTotal).toFixed(2)) : 0
          return {
            document_id:   doc.id,
            project_id:    pidRef.current,
            journal_number: jn,
            description:   item.description || res.description || '',
            amount:        amt,
            vat_amount:    itemVat,
            category_main: item.category_main || null,
            category_sub:  item.category_sub  || null,
            sort_order:    i + 1,
          }
        })
        const { error: itemsErr } = await supabase.from('document_items').insert(itemRows)
        if (itemsErr) throw new Error(itemsErr.message)

        await supabase.from('documents').update({ journal_number: jn }).eq('id', doc.id)

      } else {
        // ── مصروف بند واحد (قديم أو expense بدون items) ─────────────────
        const amount = Number(res.amount || res.totalAmount) || 0
        const singleDesc = res.description || doc.file_name
        if (!forceNew) {
          const isDup = await checkLedgerDup(pidRef.current, res.date, res.transType || '', singleDesc, amount)
          if (isDup) { updateDoc(doc.id, { _state: 'analyzed', _dupCheck: true }); return }
        }
        const singleDescFinal = forceNew
          ? `${singleDesc} [${Date.now().toString(36)}]`
          : singleDesc
        const jn = await getOrCreateJournalNumber(pidRef.current, res.date)
        // INSERT أولاً — تحقق من النجاح قبل أي عملية أخرى
        const { data: inserted, error: err } = await supabase.from('ledger_entries').insert({
          project_id:        pidRef.current,
          date:              res.date,
          type:              res.transType || '',
          description:       singleDescFinal,
          cash_out:    !isIncoming && pay === 'cash'    ? amount : 0,
          bank_out:    !isIncoming && pay === 'bank'    ? amount : 0,
          custody_out: !isIncoming && pay === 'custody' ? amount : 0,
          cash_in:      isIncoming && pay === 'cash'    ? amount : 0,
          bank_in:      isIncoming && pay === 'bank'    ? amount : 0,
          custody_in:   isIncoming && pay === 'custody' ? amount : 0,
          vat_amount:        Number(res.vatAmount) || 0,
          total_amount:      amount,
          status:            'approved',
          file_url:          doc.file_url || '',
          journal_number:    jn,
          branch:            doc.branch || null,
          purchase_category: doc.purchase_category || null,
          category_main:     res.category_main || null,
          category_sub:      res.category_sub  || null,
        }).select('id').single()
        if (err) throw new Error(err.message)
        if (!inserted) throw new Error('فشل تسجيل القيد في الدفتر — لم يُعاد أي سجل')
        if (doc.purchase_category && inserted?.id) {
          await supabase.rpc('set_entry_purchase_category', { entry_id: inserted.id, category: doc.purchase_category })
        }
        await supabase.from('documents').update({ journal_number: jn }).eq('id', doc.id)
      }

      const newName = readableName(doc, res)
      await supabase.from('documents').update({
        status:    'approved',
        file_name: newName,
        category_main: null,
        category_sub:  null,
      }).eq('id', doc.id)
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
          onApproveForced={() => approve(doc, true)}
          onDupIgnore={() => reject(doc)}
          onReject={() => reject(doc)}
          onEdit={(f, v) => updateDoc(doc.id, { _edit: { ...(doc._edit || doc.analysis_result || {}), [f]: v } })}
          onEditItem={(idx, f, v) => {
            const cur   = doc._edit || doc.analysis_result || {}
            const items = (cur.items || []).map((it, i) => i === idx ? { ...it, [f]: v } : it)
            updateDoc(doc.id, { _edit: { ...cur, items } })
          }}
          onDeleteItem={idx => {
            const cur   = doc._edit || doc.analysis_result || {}
            const items = (cur.items || []).filter((_, i) => i !== idx)
            updateDoc(doc.id, { _edit: { ...cur, items } })
          }}
          onAddItem={() => {
            const cur   = doc._edit || doc.analysis_result || {}
            const items = [...(cur.items || []), { description: '', amount: '', category_main: '', category_sub: '' }]
            updateDoc(doc.id, { _edit: { ...cur, items } })
          }}
          timeAgo={timeAgo}
          transTypes={transTypes}
          categories={categories}
          branches={branches}
          suppliers={suppliers}
          onBranchChange={b => updateDoc(doc.id, { branch: b })}
          onSupplierChange={id => updateDoc(doc.id, { _supplierId: id })}
          onClearValidation={() => updateDoc(doc.id, { _validationError: null })}
          ROLE_AR={ROLE_AR}
          ROLE_COLOR={ROLE_COLOR}
        />
      ))}
    </div>
  )
}

function openPdfBlob(base64, fileName) {
  const bytes = atob(base64)
  const arr   = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  const blob = new Blob([arr], { type: 'application/pdf' })
  window.open(URL.createObjectURL(blob), '_blank')
}

// ── ItemRow ──────────────────────────────────────────────────────────────────
function ItemRow({ item, index, parentCats, categories, onEdit, onDelete }) {
  const itemParent = parentCats.find(p =>
    p.name === item.category_main ||
    normCat(p.name) === normCat(item.category_main)
  )
  const itemSubs = itemParent ? categories.filter(c => c.parent_id === itemParent.id) : []
  const mainValue = itemParent ? itemParent.name : (item.category_main || '')
  const subValue  = item.category_sub || ''

  // تصحيح تلقائي: إذا AI أعطى اسماً مختلفاً عن الاسم الدقيق في DB، نصحح في الحال
  useEffect(() => {
    if (itemParent && item.category_main !== itemParent.name) {
      onEdit('category_main', itemParent.name)
    }
  }, [itemParent?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="border-b border-slate-100 last:border-0 p-2 space-y-1.5">
      <div className="flex gap-2 items-center">
        <span className="text-xs text-slate-400 shrink-0 w-4 text-center">{index + 1}</span>
        <input value={item.description || ''} onChange={e => onEdit('description', e.target.value)}
          placeholder="وصف البند"
          className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300"/>
        <input type="number" value={item.amount || ''} onChange={e => onEdit('amount', e.target.value)}
          placeholder="0.00"
          className="w-24 border border-slate-200 rounded-lg px-2 py-1 text-sm text-left font-mono focus:outline-none focus:ring-1 focus:ring-blue-300"/>
        <button onClick={onDelete}
          className="text-red-300 hover:text-red-600 transition-colors text-base leading-none px-1">✕</button>
      </div>
      <div className="flex gap-2 pr-5">
        {parentCats.length > 0 ? (
          <select
            value={mainValue}
            onChange={e => { onEdit('category_main', e.target.value); onEdit('category_sub', '') }}
            className="flex-1 min-w-0 border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1"
            style={{ borderColor: '#fde68a' }}>
            <option value="">— الرئيسي —</option>
            {/* إذا القيمة الحالية غير موجودة في القائمة نضيفها كخيار مؤقت */}
            {item.category_main && !parentCats.some(p => p.name === mainValue) && (
              <option value={mainValue}>{mainValue}</option>
            )}
            {parentCats.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        ) : (
          <input value={item.category_main || ''} onChange={e => onEdit('category_main', e.target.value)}
            placeholder="التصنيف الرئيسي"
            className="flex-1 min-w-0 border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1"
            style={{ borderColor: '#fde68a' }}/>
        )}
        {itemSubs.length > 0 ? (
          <select value={subValue} onChange={e => onEdit('category_sub', e.target.value)}
            className="flex-1 min-w-0 border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1"
            style={{ borderColor: '#bbf7d0' }}>
            <option value="">— الفرعي —</option>
            {item.category_sub && !itemSubs.some(s => s.name === subValue) && (
              <option value={subValue}>{subValue}</option>
            )}
            {itemSubs.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        ) : (
          <input value={subValue} onChange={e => onEdit('category_sub', e.target.value)}
            placeholder={itemParent ? 'التصنيف الفرعي' : 'التصنيف الفرعي'}
            className="flex-1 min-w-0 border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1"
            style={{ borderColor: '#bbf7d0' }}/>
        )}
      </div>
    </div>
  )
}

// ── DocCard ──────────────────────────────────────────────────────────────────
function DocCard({ doc, onLoadImage, onAnalyze, onApprove, onApproveForced, onDupIgnore, onReject, onEdit, onEditItem, onDeleteItem, onAddItem, onBranchChange, onSupplierChange, onClearValidation, timeAgo, transTypes, categories, branches, suppliers, ROLE_AR, ROLE_COLOR }) {
  const res      = doc._edit || doc.analysis_result
  const busy     = ['analyzing','approving','rejecting'].includes(doc._state)
  const isImage  = doc.file_type?.startsWith('image/')
  const fmt      = v => v != null && v !== '' ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'

  const parentCats     = categories.filter(c => !c.parent_id)
  const isExpenseItems = res?.type === 'expense' && res.items?.length > 0

  // مجموع البنود محسوب دائماً من البنود الفعلية
  const itemsTotal   = isExpenseItems ? res.items.reduce((s, it) => s + (Number(it.amount) || 0), 0) : 0
  const invoiceTotal = Number(res?.totalAmount || res?.amount) || 0
  const totalDiff    = itemsTotal > 0 ? itemsTotal - invoiceTotal : 0   // موجب = البنود أكثر، سالب = أقل

  const selectedParent = parentCats.find(p =>
    p.name === (res?.category_main || '') ||
    normCat(p.name) === normCat(res?.category_main || '')
  )
  const resolvedMain = selectedParent ? selectedParent.name : (res?.category_main || '')
  const subCats      = selectedParent ? categories.filter(c => c.parent_id === selectedParent.id) : []

  function openFile() {
    if (doc._isUrl)          window.open(doc._imageData, '_blank')
    else if (doc._imageData) openPdfBlob(doc._imageData, doc.file_name)
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center gap-3 p-4 border-b border-slate-50">
        <span className="text-2xl shrink-0">{isImage ? '🖼️' : '📄'}</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-800 truncate text-sm">{doc.file_name}</div>
          <div className="text-xs text-slate-400 mt-0.5">منذ {timeAgo(doc.uploaded_at)}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {doc.branch && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-700">🏢 {doc.branch}</span>
          )}
          {doc.uploaded_by && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLOR[doc.uploaded_by] || 'bg-slate-100 text-slate-500'}`}>
              {ROLE_AR[doc.uploaded_by] || doc.uploaded_by}
            </span>
          )}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${doc.status === 'analyzed' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
            {doc.status === 'analyzed' ? 'محلَّل' : 'جديد'}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">

        {doc._error && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-red-700 text-sm">❌ {doc._error}</div>
        )}

        {doc._validationError && (
          <div className="bg-red-50 border-2 border-red-400 rounded-xl p-3 text-red-700 text-sm font-semibold flex items-center gap-2">
            ⚠️ يرجى اختيار {doc._validationError.missingType && doc._validationError.missingPay ? 'نوع الحركة ومصدر الدفع' : doc._validationError.missingType ? 'نوع الحركة' : 'مصدر الدفع'} قبل الاعتماد
          </div>
        )}

        {doc._dupCheck && (
          <div className="rounded-xl p-4 space-y-3" style={{ background: '#fffbeb', border: '2px solid #f59e0b' }}>
            <div className="flex items-center gap-2 font-bold text-amber-800">
              ⚠️ هذا القيد مسجل مسبقاً في الدفتر
            </div>
            <p className="text-sm text-amber-700">
              تم تسجيل نفس المستند مسبقاً — هل هو مستند مختلف حقاً؟
            </p>
            <div className="flex gap-2">
              <button onClick={onDupIgnore}
                className="flex-1 py-2 rounded-xl text-sm font-medium transition-colors"
                style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                ✕ رفض المستند
              </button>
              <button onClick={onApproveForced} disabled={busy}
                className="flex-[2] py-2 text-white rounded-xl text-sm font-bold transition-colors disabled:opacity-50"
                style={{ background: '#d97706' }}>
                تسجيل كمستند جديد مختلف
              </button>
            </div>
          </div>
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
          doc._isUrl
            ? <img src={doc._imageData} alt={doc.file_name} className="w-full max-h-80 object-contain rounded-xl bg-slate-50 border border-slate-100"/>
            : <img src={`data:${doc.file_type};base64,${doc._imageData}`} alt={doc.file_name} className="w-full max-h-80 object-contain rounded-xl bg-slate-50 border border-slate-100"/>
        )}
        {doc._showImage && doc._imageData && !isImage && (
          <button onClick={openFile}
            className="flex items-center justify-center gap-2 w-full py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">
            📄 فتح الملف
          </button>
        )}

        {/* Analyze */}
        {doc.status === 'uploaded' && (
          <button onClick={onAnalyze} disabled={busy}
            className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {doc._state === 'analyzing'
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/><span>جارٍ التحليل...</span></>
              : '📄 قراءة المستند'
            }
          </button>
        )}

        {/* نتيجة التحليل */}
        {(doc.status === 'analyzed' || doc._state === 'analyzed') && res && (
          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">نتيجة التحليل — عدّل إن لزم ثم اعتمد</div>

            {/* ── ملخص ── */}
            <div className="bg-slate-50 rounded-xl p-3 space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-slate-400 text-xs block">التاريخ</span><span className="font-medium">{res.date}</span></div>

                {res.type === 'sales' ? (
                  <>
                    {[
                      { label: 'كاش',         val: res.cashSales,    show: true },
                      { label: 'شبكة / مدى',  val: res.networkSales, show: true },
                      { label: 'هنقر ستيشن',  val: res.hungerSales,  show: !!(res.hungerSales > 0) },
                      { label: 'جاهز',        val: res.jahez,        show: !!(res.jahez > 0) },
                      { label: 'كيتا',        val: res.keeta,        show: !!(res.keeta > 0) },
                    ].filter(c => c.show).map(c => (
                      <div key={c.label}><span className="text-slate-400 text-xs block">{c.label}</span><span className="font-semibold text-green-700">{fmt(c.val)}</span></div>
                    ))}
                    <div><span className="text-slate-400 text-xs block">الإجمالي</span><span className="font-bold text-green-800">{fmt(res.totalSales || (res.cashSales||0)+(res.networkSales||0)+(res.hungerSales||0)+(res.jahez||0)+(res.keeta||0))}</span></div>
                    <div><span className="text-slate-400 text-xs block">ضريبة المخرجات (15%)</span><span className="font-semibold" style={{color:'#b45309'}}>{fmt(((res.totalSales||(res.cashSales||0)+(res.networkSales||0))/1.15*0.15))}</span></div>
                  </>
                ) : (
                  <>
                    <div>
                      <span className="text-slate-400 text-xs block">إجمالي الفاتورة</span>
                      <span className="font-semibold text-red-700">
                        {fmt(invoiceTotal)}
                        {isExpenseItems && <span className="text-xs text-slate-400 mr-1 font-normal">({res.items.length} بنود)</span>}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-xs block">ضريبة المدخلات</span>
                      <span className="font-semibold" style={{color: res.vatAmount > 0 ? '#dc2626' : '#94a3b8'}}>
                        {res.vatAmount > 0 ? fmt(res.vatAmount) : '—'}
                      </span>
                    </div>
                    <div><span className="text-slate-400 text-xs block">مصدر الدفع</span><span className="font-medium">{{ cash:'الصندوق', bank:'البنك', custody:'العهدة' }[res.paySource] || res.paySource || '—'}</span></div>
                  </>
                )}

                {res.description && (
                  <div className="col-span-2"><span className="text-slate-400 text-xs block">الوصف</span><span>{res.description}</span></div>
                )}
              </div>

              {/* قائمة البنود */}
              {isExpenseItems && (
                <div className="border-t border-slate-200 pt-2 space-y-1">
                  {res.items.map((item, i) => (
                    <div key={i} className="flex items-start justify-between gap-2 text-xs">
                      <div className="flex-1 min-w-0">
                        <span className="text-slate-700">{item.description || '—'}</span>
                        {(item.category_sub || item.category_main) && (
                          <span className="text-slate-400 mr-1">· {item.category_sub || item.category_main}</span>
                        )}
                      </div>
                      <span className="font-mono text-slate-600 shrink-0">{fmt(item.amount)}</span>
                    </div>
                  ))}

                  {/* [تعديل 3] مجموع البنود المُعاد حسابه مع تحذير واضح */}
                  <div className="border-t border-slate-200 pt-1.5 mt-1 space-y-1">
                    <div className="flex justify-between text-xs font-semibold text-slate-600">
                      <span>مجموع البنود (محسوب)</span>
                      <span className="font-mono">{fmt(itemsTotal)}</span>
                    </div>
                    {Math.abs(totalDiff) > 0.5 && (
                      <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 text-xs text-red-700">
                        <span className="text-sm">⚠️</span>
                        <span>
                          البنود {totalDiff > 0 ? 'تزيد' : 'تنقص'} بمقدار <strong className="font-mono">{fmt(Math.abs(totalDiff))}</strong> عن إجمالي الفاتورة ({fmt(invoiceTotal)}) — راجع المبالغ في التعديل
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* شارات التصنيف للمستندات القديمة */}
              {!isExpenseItems && res.category_main && (
                <div className="flex gap-2 flex-wrap pt-1">
                  <span className="text-xs px-2 py-1 rounded-full font-semibold" style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }}>
                    🏷️ {res.category_main}
                  </span>
                  {res.category_sub && (
                    <span className="text-xs px-2 py-1 rounded-full font-semibold" style={{ background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' }}>
                      📌 {res.category_sub}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* ── منتقي الفرع — يظهر إذا لم يكن للمستند فرع ── */}
            {!doc.branch && branches.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-3">
                <span className="text-amber-600 text-sm shrink-0">🏢 الفرع</span>
                <select
                  value={doc.branch || ''}
                  onChange={e => onBranchChange(e.target.value)}
                  className="flex-1 border border-amber-300 bg-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                  <option value="">— اختر الفرع —</option>
                  {branches.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            )}

            {/* ── تعديل البيانات ── */}
            <details className="group" open={!!doc._validationError}>
              <summary className="text-sm text-blue-600 cursor-pointer hover:text-blue-800 font-medium list-none flex items-center gap-1">
                <span className="group-open:rotate-90 transition-transform inline-block">▶</span> تعديل البيانات
              </summary>
              <div className="mt-3 space-y-3">

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">التاريخ</label>
                    <input type="date" value={res.date || ''} onChange={e => onEdit('date', e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
                  </div>

                  {res.type !== 'sales' && (
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">
                        مصدر الدفع {doc._validationError?.missingPay && <span className="text-red-500 font-bold">*مطلوب</span>}
                      </label>
                      <select value={res.paySource || ''} onChange={e => { onEdit('paySource', e.target.value); onClearValidation() }}
                        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${doc._validationError?.missingPay ? 'border-red-400 bg-red-50 focus:ring-red-400' : 'border-slate-200 focus:ring-blue-400'}`}>
                        <option value="">— اختر —</option>
                        <option value="cash">💵 الصندوق</option>
                        <option value="bank">🏦 البنك / مدى</option>
                        <option value="custody">👤 العهدة</option>
                        {suppliers.length > 0 && <option value="credit">🏪 آجل / مورد</option>}
                      </select>

                  {res.paySource === 'credit' && suppliers.length > 0 && (
                    <div className="mt-2">
                      <label className="text-xs text-slate-400 block mb-1">المورد</label>
                      <select value={doc._supplierId || ''} onChange={e => onSupplierChange(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                        style={{ borderColor: '#fcd34d', background: '#fffbeb' }}>
                        <option value="">— اختر المورد —</option>
                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  )}
                    </div>
                  )}

                  {/* إجمالي الفاتورة قابل للتعديل حتى في expense items */}
                  {res.type !== 'sales' && (
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">
                        {isExpenseItems ? 'إجمالي الفاتورة (للقيد)' : 'المبلغ الإجمالي'}
                      </label>
                      <input type="number"
                        value={res.totalAmount ?? res.amount ?? ''}
                        onChange={e => onEdit(res.totalAmount != null ? 'totalAmount' : 'amount', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
                    </div>
                  )}

                  {res.type !== 'sales' && (
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">🏛️ ضريبة القيمة المضافة</label>
                      <input type="number" value={res.vatAmount || ''} onChange={e => onEdit('vatAmount', e.target.value)}
                        placeholder="0.00"
                        className="w-full border border-amber-200 bg-amber-50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"/>
                    </div>
                  )}

                  {res.type !== 'sales' && (
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">
                        نوع الحركة {doc._validationError?.missingType && <span className="text-red-500 font-bold">*مطلوب</span>}
                      </label>
                      <select value={res.transType || ''} onChange={e => { onEdit('transType', e.target.value); onClearValidation() }}
                        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${doc._validationError?.missingType ? 'border-red-400 bg-red-50 focus:ring-red-400' : 'border-slate-200 focus:ring-blue-400'}`}>
                        <option value="">— اختر —</option>
                        {transTypes.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  )}

                  {res.type === 'sales' && (
                    <>
                      {[
                        { key: 'cashSales',    label: '💵 مبيعات كاش' },
                        { key: 'networkSales', label: '🏦 مبيعات شبكة / مدى' },
                        { key: 'hungerSales',  label: '🍔 هنقر ستيشن' },
                        { key: 'jahez',        label: '🛵 جاهز' },
                        { key: 'keeta',        label: '🛺 كيتا' },
                      ].map(({ key, label }) => (
                        <div key={key}>
                          <label className="text-xs text-slate-400 block mb-1">{label}</label>
                          <input type="number" value={res[key] || ''} onChange={e => onEdit(key, e.target.value)}
                            placeholder="0.00"
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
                        </div>
                      ))}
                      <div className="col-span-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm flex justify-between">
                        <span className="text-green-700 font-semibold">الإجمالي المحسوب</span>
                        <span className="font-mono font-bold text-green-800">{fmt((Number(res.cashSales)||0)+(Number(res.networkSales)||0)+(Number(res.hungerSales)||0)+(Number(res.jahez)||0)+(Number(res.keeta)||0))}</span>
                      </div>
                    </>
                  )}

                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 block mb-1">الوصف / اسم المورد</label>
                    <input value={res.description || ''} onChange={e => onEdit('description', e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
                  </div>
                </div>

                {/* ── جدول البنود ── */}
                {isExpenseItems && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500">البنود ({res.items.length})</span>
                      <button onClick={onAddItem}
                        className="text-xs text-blue-600 hover:text-blue-800 font-semibold px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors">
                        + إضافة بند
                      </button>
                    </div>
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      {res.items.map((item, i) => (
                        <ItemRow key={i} item={item} index={i}
                          parentCats={parentCats} categories={categories}
                          onEdit={(f, v) => onEditItem(i, f, v)}
                          onDelete={() => onDeleteItem(i)}/>
                      ))}
                    </div>
                    {/* مقارنة المجموع */}
                    <div className={`flex justify-between text-xs px-1 font-semibold ${Math.abs(totalDiff) > 0.5 ? 'text-red-600' : 'text-green-600'}`}>
                      <span>مجموع البنود</span>
                      <span className="font-mono">{fmt(itemsTotal)} / {fmt(invoiceTotal)}</span>
                    </div>
                  </div>
                )}

                {/* التصنيف للمستندات القديمة */}
                {res.type !== 'sales' && !isExpenseItems && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">🏷️ التصنيف الرئيسي</label>
                      {parentCats.length > 0 ? (
                        <select value={resolvedMain} onChange={e => { onEdit('category_main', e.target.value); onEdit('category_sub', '') }}
                          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                          style={{ borderColor: '#fde68a' }}>
                          <option value="">— اختر التصنيف —</option>
                          {res.category_main && !parentCats.some(p => p.name === resolvedMain) && (
                            <option value={resolvedMain}>{resolvedMain}</option>
                          )}
                          {parentCats.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                        </select>
                      ) : (
                        <input value={res.category_main || ''} onChange={e => onEdit('category_main', e.target.value)}
                          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                          style={{ borderColor: '#fde68a' }}/>
                      )}
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">📌 التصنيف الفرعي</label>
                      {subCats.length > 0 ? (() => {
                        const resolvedSub = subCats.find(s =>
                          s.name === (res.category_sub || '') ||
                          normCat(s.name) === normCat(res.category_sub || '')
                        )?.name || (res.category_sub || '')
                        return (
                          <select value={resolvedSub} onChange={e => onEdit('category_sub', e.target.value)}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                            style={{ borderColor: '#bbf7d0' }}>
                            <option value="">— اختر الفئة الفرعية —</option>
                            {res.category_sub && !subCats.some(s => s.name === resolvedSub) && (
                              <option value={resolvedSub}>{resolvedSub}</option>
                            )}
                            {subCats.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                          </select>
                        )
                      })() : (
                        <input value={res.category_sub || ''} onChange={e => onEdit('category_sub', e.target.value)}
                          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                          style={{ borderColor: '#bbf7d0' }}/>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </details>

            {/* أزرار الاعتماد */}
            <div className="flex gap-2 pt-1">
              <button onClick={onApprove} disabled={busy}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
                {doc._state === 'approving'
                  ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/><span>جارٍ...</span></>
                  : isExpenseItems
                    ? `✓ تسجيل — حركة واحدة + ${res.items.length} بنود`
                    : '✓ تسجيل وحفظ'
                }
              </button>
              <button onClick={onReject} disabled={busy}
                className="px-4 py-2.5 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-semibold hover:bg-red-600 hover:text-white transition-colors disabled:opacity-50">
                {doc._state === 'rejecting' ? '...' : '✕ رد'}
              </button>
            </div>
          </div>
        )}

        {/* رد للمستندات غير المحللة */}
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
