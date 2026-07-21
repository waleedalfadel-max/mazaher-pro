import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { analyzeDocument } from '../lib/claude'
import { getOrCreateJournalNumber } from '../lib/journalNumber'
import { fetchAsBase64 } from '../lib/storage'
import { getTransactionTypes, getProjectSettings } from '../lib/projectSettings'
import { compressImageBase64 } from '../lib/imageCompress'
import { matchSupplier } from '../lib/supplierMatching'

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

// يشتق category_main الصحيح لبند: الأب الفعلي الذي يحتوي category_sub بجدول categories —
// يبقى صحيحاً سواء كان category_sub من الذكاء الاصطناعي أو مُعدَّلاً يدوياً بالواجهة
function resolveItemCategoryMain(categories, item, fallbackTransType) {
  const sub = (categories || []).find(c => c.parent_id && normCat(c.name) === normCat(item.category_sub || ''))
  if (sub) {
    const parent = categories.find(p => p.id === sub.parent_id)
    if (parent) return parent.name
  }
  return normCat(item.category_main) || normCat(fallbackTransType) || null
}

// يحسم type + category_main لقيد الفاتورة الواحد عند تعدد التصنيفات بين البنود:
// نفس تصنيف الكل لو متطابقين، وإلا تصنيف البند الأكبر مبلغاً + إشارة "متعدد التصنيفات"
function resolveInvoiceType(items, categories, transTypes, fallbackTransType) {
  const resolvedMains = items.map(it => resolveItemCategoryMain(categories, it, fallbackTransType))
  const uniqueMains   = [...new Set(resolvedMains.map(m => normCat(m || '')).filter(Boolean))]
  let chosenMain
  let mixed = false
  if (uniqueMains.length <= 1) {
    chosenMain = resolvedMains.find(Boolean) || fallbackTransType
  } else {
    mixed = true
    let maxIdx = 0
    items.forEach((it, i) => { if ((Number(it.amount) || 0) > (Number(items[maxIdx].amount) || 0)) maxIdx = i })
    chosenMain = resolvedMains[maxIdx]
  }
  const matchedType = (transTypes || []).find(t => normCat(t) === normCat(chosenMain))
  return { type: matchedType || fallbackTransType || '🛒 مصروفات تشغيلية', categoryMain: normCat(chosenMain) || null, mixed }
}

// مصدر الدفع الافتراضي بناءً على اسم المشروع ودور الرافع
function getDefaultPaySource(projName, uploadedBy) {
  if (projName?.includes('تشورميك')) return 'bank'
  if (uploadedBy === 'cashier') return 'cash'
  if (uploadedBy === 'owner')   return 'bank'
  if (projName?.includes('كون') && uploadedBy === 'purchasing') return 'bank'
  if (projName?.includes('كون') && uploadedBy === 'accountant') return 'bank'
  if (uploadedBy === 'purchasing') return 'custody'
  return null
}

export default function PendingDocuments() {
  const { projectId, projectName, isSuperAdmin } = useAuth()
  const [docs, setDocs]               = useState([])
  const [loading, setLoading]         = useState(true)
  const [transTypes, setTransTypes]   = useState(FALLBACK_TRANS_TYPES)
  const [transTypesMap,  setTransTypesMap]  = useState({})   // superadmin: projectId → types[]
  const [categoriesMap,  setCategoriesMap]  = useState({})   // superadmin: projectId → categories[]
  const [payableSuppliersMap, setPayableSuppliersMap] = useState({}) // superadmin: projectId → payable_suppliers[]
  const [categories, setCategories]   = useState([])
  const [branches,   setBranches]     = useState([])
  const [suppliers,  setSuppliers]    = useState([])
  const [payableSuppliers, setPayableSuppliers] = useState([])
  const [projects,   setProjects]     = useState([])
  const [projMap,    setProjMap]      = useState({})
  const [filterProjId, setFilterProjId] = useState('')
  const pidRef                        = useRef(null)

  useEffect(() => {
    pidRef.current = projectId
    if (isSuperAdmin) {
      supabase.from('projects').select('id,name').order('name').then(({ data }) => {
        const list = data || []
        setProjects(list)
        const m = {}
        list.forEach(p => { m[p.id] = p.name })
        setProjMap(m)
      })
      loadDocs(null).then(() => setLoading(false))
    } else if (projectId) {
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
      supabase.from('payable_suppliers')
        .select('id,name')
        .eq('project_id', projectId)
        .order('name')
        .then(({ data }) => setPayableSuppliers(data || []))
    }
  }, [projectId, isSuperAdmin])

  // إعادة تحميل عند تغيير فلتر المشروع (superadmin فقط)
  useEffect(() => {
    if (!isSuperAdmin) return
    setLoading(true)
    loadDocs(filterProjId || null).then(() => setLoading(false))
  }, [filterProjId])

  // superadmin: حمّل transTypes لكل project_id موجود في الوثائق
  useEffect(() => {
    if (!isSuperAdmin) return
    const pids = [...new Set(docs.map(d => d.project_id).filter(Boolean))]
    pids.forEach(pid => {
      if (!transTypesMap[pid]) {
        getTransactionTypes(pid).then(types => {
          setTransTypesMap(m => ({ ...m, [pid]: types }))
        })
      }
    })
  }, [docs, isSuperAdmin])

  // superadmin: حمّل categories لكل project_id موجود في الوثائق
  useEffect(() => {
    if (!isSuperAdmin) return
    const pids = [...new Set(docs.map(d => d.project_id).filter(Boolean))]
    pids.forEach(pid => {
      if (!categoriesMap[pid]) {
        supabase.from('categories')
          .select('id,name,parent_id,type,sort_order')
          .eq('project_id', pid)
          .order('sort_order')
          .then(({ data }) => setCategoriesMap(m => ({ ...m, [pid]: data || [] })))
      }
    })
  }, [docs, isSuperAdmin])

  // superadmin: حمّل payable_suppliers لكل project_id موجود في الوثائق
  useEffect(() => {
    if (!isSuperAdmin) return
    const pids = [...new Set(docs.map(d => d.project_id).filter(Boolean))]
    pids.forEach(pid => {
      if (!payableSuppliersMap[pid]) {
        supabase.from('payable_suppliers')
          .select('id,name')
          .eq('project_id', pid)
          .order('name')
          .then(({ data }) => setPayableSuppliersMap(m => ({ ...m, [pid]: data || [] })))
      }
    })
  }, [docs, isSuperAdmin])

  async function loadDocs(pid) {
    let q = supabase.from('documents')
      .select('id,file_name,file_type,status,analysis_result,uploaded_at,uploaded_by,file_url,branch,purchase_category,category_main,category_sub,project_id')
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
      const docPid      = doc.project_id || projectId
      const docProjName = projMap[docPid] || projectName || ''

      // اجلب التصنيفات وأنواع الحركة الخاصة بمشروع المستند
      let docCategories = categories
      let docTransTypes = transTypes
      if (isSuperAdmin && docPid) {
        const { data: cats } = await supabase.from('categories')
          .select('id,name,parent_id,type,sort_order')
          .eq('project_id', docPid).order('sort_order')
        docCategories = cats || []
        docTransTypes = transTypesMap[docPid] || await getTransactionTypes(docPid)
      }

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
      const result = await analyzeDocument(fileBase64, fileMime, doc.file_name, doc.uploaded_by, docCategories, docProjName, docTransTypes)

      // مصدر الدفع — تشورميك: bank دائماً بغض النظر عما أعاده Claude أو ما هو محفوظ
      const defaultPaySource = getDefaultPaySource(docProjName, doc.uploaded_by)
      const isTashormik = docProjName?.includes('تشورميك')
      if (isTashormik || defaultPaySource) {
        if (result?.invoices) {
          result.invoices = result.invoices.map(inv =>
            inv.type === 'sales' ? inv : { ...inv, paySource: isTashormik ? 'bank' : (inv.paySource || defaultPaySource) }
          )
        } else if (result && result.type !== 'sales') {
          result.paySource = isTashormik ? 'bank' : (result.paySource || defaultPaySource)
        }
      }

      await supabase.from('documents').update({ status: 'analyzed', analysis_result: result }).eq('id', doc.id)
      updateDoc(doc.id, {
        _state: 'analyzed', status: 'analyzed',
        analysis_result: result, _edit: result,
        _aiSuggestedType: true,
        _imageData: doc.file_url || fileBase64,
        _isUrl: !!doc.file_url,
        _showImage: true,
      })
    } catch(e) { updateDoc(doc.id, { _state: 'idle', _error: e.message }) }
  }

  // يحسم هوية المورد لفاتورة "آجل" — يربط بمورد موجود أو ينشئ سجلاً جديداً في payable_suppliers
  // يرمي __SUPPLIER_CONFIRM_NEEDED__ لو فيه تشابه قريب ولسا ما تأكّد المحاسب (يحتاج تفاعل بالواجهة أولاً)
  async function resolveSupplierId(pid, doc, res) {
    const name = (doc._supplierName ?? res.supplier_name ?? '').trim()
    if (!name) return null

    if (doc._supplierResolution === 'existing' && doc._matchedSupplierId) {
      return doc._matchedSupplierId
    }
    if (doc._supplierResolution === 'new') {
      const { data, error } = await supabase.from('payable_suppliers')
        .insert({ project_id: pid, name }).select('id').single()
      if (error) throw new Error(error.message)
      return data.id
    }

    const projectSuppliers = isSuperAdmin ? (payableSuppliersMap[pid] || []) : payableSuppliers
    const { matchType, supplier } = matchSupplier(name, projectSuppliers)
    if (matchType === 'exact') return supplier.id
    if (matchType === 'fuzzy') {
      const e = new Error('__SUPPLIER_CONFIRM_NEEDED__')
      e.needsSupplierConfirm = true
      throw e
    }
    const { data, error } = await supabase.from('payable_suppliers')
      .insert({ project_id: pid, name }).select('id').single()
    if (error) throw new Error(error.message)
    return data.id
  }

  async function checkLedgerDup(pid, date, type, description, total_amount) {
    const { data } = await supabase.from('ledger_entries').select('id')
      .eq('project_id', pid).eq('date', date)
      .eq('type', type).eq('description', description)
      .eq('total_amount', total_amount).neq('status', 'cancelled')
      .maybeSingle()
    return !!data
  }

  // اعتماد فاتورة واحدة — يرمي خطأ عند فشل أو dup
  async function _approveOne(doc, res, forceNew) {
    const pid        = doc.project_id || pidRef.current
    const docProjName = projMap[pid] || projectName || ''
    const pay        = docProjName?.includes('تشورميك') ? 'bank' : (res.paySource || 'custody')
    const isIncoming = res.transType?.includes('تحصيل جملة')
    const docCategories = isSuperAdmin ? (categoriesMap[pid] || []) : categories
    const docTransTypes = isSuperAdmin ? (transTypesMap[pid] || FALLBACK_TRANS_TYPES) : transTypes

    if (res.type === 'sales') {
      const cash     = Number(res.cashSales)     || 0
      const network  = Number(res.networkSales)  || 0
      const transfer = Number(res.transferSales) || 0
      const hunger   = Number(res.hungerSales)   || 0
      const jahez    = Number(res.jahez)          || 0
      const keeta    = Number(res.keeta)          || 0
      const mrsool   = Number(res.mrsool)         || 0
      const date    = res.date
      const { error: e1 } = await supabase.from('sales').insert({
        project_id: pid, date,
        cash_sales: cash, network_sales: network,
        hunger_sales: hunger, jahez_sales: jahez, keeta_sales: keeta,
        description: 'تقرير POS', branch: doc.branch || null,
      })
      if (e1) throw new Error(e1.message)
      const jn = await getOrCreateJournalNumber(pid, date)
      const mkEntry = (type, desc, cash_in, bank_in, amt) => ({
        project_id: pid, date, type, description: desc,
        cash_in, cash_out: 0, bank_in, bank_out: 0, custody_in: 0, custody_out: 0,
        total_amount: amt, status: 'approved', journal_number: jn,
        file_url: doc.file_url || '', branch: doc.branch || null,
      })
      const mkReceivable = (type, desc, amt) => ({
        project_id: pid, date, type, description: desc,
        cash_in: 0, cash_out: 0, bank_in: 0, bank_out: 0, custody_in: 0, custody_out: 0,
        receivable_in: amt, receivable_out: 0,
        total_amount: amt, status: 'approved', journal_number: jn,
        file_url: doc.file_url || '', branch: doc.branch || null,
      })
      const entries = []
      if (cash     > 0) entries.push(mkEntry('💵 مبيعات كاش',         'مبيعات كاش — POS',      cash,     0,       cash))
      if (network  > 0) entries.push(mkEntry('🏦 مبيعات شبكة',        'مبيعات شبكة — POS',     0,        network, network))
      if (transfer > 0) entries.push(mkEntry('💸 مبيعات تحويل',       'مبيعات تحويل — POS',    0,        transfer,transfer))
      if (hunger   > 0) entries.push(mkReceivable('🍔 مبيعات هنقر ستيشن', 'ذمم هنقر — POS',    hunger))
      if (jahez    > 0) entries.push(mkReceivable('🛵 مبيعات جاهز',        'ذمم جاهز — POS',    jahez))
      if (keeta    > 0) entries.push(mkReceivable('🛺 مبيعات كيتا',         'ذمم كيتا — POS',    keeta))
      if (mrsool   > 0) entries.push(mkReceivable('🛵 مبيعات مرسول',        'ذمم مرسول — POS',   mrsool))
      if (entries.length) {
        if (!forceNew) {
          const first = entries[0]
          const isDup = await checkLedgerDup(pid, date, first.type, first.description, first.total_amount)
          if (isDup) { const e = new Error('__DUP__'); e.isDup = true; throw e }
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
      const amount = Number(res.amount) || 0
      const jn = await getOrCreateJournalNumber(pid, res.date)
      const isCustody  = res.transType?.includes('صرف عهدة')
      const isCollect  = res.transType?.includes('تحصيل ذمم')
      const entryFields = isCollect
        ? { cash_in: 0, bank_in: amount, custody_in: 0, cash_out: 0, bank_out: 0, custody_out: 0, receivable_in: 0, receivable_out: amount }
        : isCustody
          ? { cash_in: 0, bank_in: 0, custody_in: amount, cash_out: 0, bank_out: amount, custody_out: 0, receivable_in: 0, receivable_out: 0 }
          : { cash_in: 0, bank_in: amount, custody_in: 0, cash_out: amount, bank_out: 0, custody_out: 0, receivable_in: 0, receivable_out: 0 }
      const transferType = res.transType || (isCustody ? '🔄 تحويل داخلي — صرف عهدة' : '🏧 تحويل داخلي — إيداع نقدي')
      const transferDesc = res.description || doc.file_name
      if (!forceNew) {
        const isDup = await checkLedgerDup(pid, res.date, transferType, transferDesc, amount)
        if (isDup) { const e = new Error('__DUP__'); e.isDup = true; throw e }
      }
      const transferDescFinal = forceNew ? `${transferDesc} [${Date.now().toString(36)}]` : transferDesc
      const { data: transferInserted, error: err } = await supabase.from('ledger_entries').insert({
        project_id: pid, date: res.date, type: transferType,
        description: transferDescFinal, ...entryFields,
        vat_amount: 0, total_amount: amount, status: 'approved',
        file_url: doc.file_url || '', journal_number: jn, branch: doc.branch || null,
      }).select('id').single()
      if (err) throw new Error(err.message)
      if (!transferInserted) throw new Error('فشل تسجيل القيد في الدفتر')
      await supabase.from('documents').update({ journal_number: jn }).eq('id', doc.id)

    } else if (pay === 'credit') {
      const supplierId = doc._supplierId
      if (!supplierId) throw new Error('يرجى اختيار المورد قبل التسجيل')
      const amount = Number(res.totalAmount || res.amount) || 0
      const jn = await getOrCreateJournalNumber(pid, res.date)
      const { error: err } = await supabase.from('supplier_transactions').insert({
        supplier_id: supplierId, project_id: pid,
        type: 'invoice', amount, date: res.date,
        notes: res.description || doc.file_name,
        document_id: doc.id, journal_number: jn,
      })
      if (err) throw new Error(err.message)
      await supabase.from('documents').update({ journal_number: jn }).eq('id', doc.id)

    } else if (res.type === 'expense' && res.items?.length > 0) {
      const jn         = await getOrCreateJournalNumber(pid, res.date)
      const supplierId = pay === 'payable' ? await resolveSupplierId(pid, doc, res) : null
      const itemsTotal = res.items.reduce((s, it) => s + (Number(it.amount) || 0), 0)
      const totalAmt   = Number(res.totalAmount || res.amount) || itemsTotal
      const vatTotal   = Number(res.vatAmount) || 0
      const single = res.items.length === 1
      const { type: transType, categoryMain, mixed } = single
        ? { type: res.transType || '🛒 مصروفات تشغيلية', categoryMain: normCat(res.transType || '') || null, mixed: false }
        : resolveInvoiceType(res.items, docCategories, docTransTypes, res.transType)
      const baseDesc   = res.description || doc.file_name
      const itemsDesc  = mixed ? `${baseDesc} — فاتورة متعددة التصنيفات — راجع البنود` : baseDesc
      if (!forceNew) {
        const isDup = await checkLedgerDup(pid, res.date, transType, itemsDesc, totalAmt)
        if (isDup) { const e = new Error('__DUP__'); e.isDup = true; throw e }
      }
      const itemsDescFinal = forceNew ? `${itemsDesc} [${Date.now().toString(36)}]` : itemsDesc
      const { data: itemsInserted, error: ledgerErr } = await supabase.from('ledger_entries').insert({
        project_id: pid, date: res.date, type: transType, description: itemsDescFinal,
        cash_out:    !isIncoming && pay === 'cash'    ? totalAmt : 0,
        bank_out:    !isIncoming && pay === 'bank'    ? totalAmt : 0,
        custody_out: !isIncoming && pay === 'custody' ? totalAmt : 0,
        cash_in:      isIncoming && pay === 'cash'    ? totalAmt : 0,
        bank_in:      isIncoming && pay === 'bank'    ? totalAmt : 0,
        custody_in:   isIncoming && pay === 'custody' ? totalAmt : 0,
        payable_in:  !isIncoming && pay === 'payable' ? totalAmt : 0,
        payable_out: 0,
        supplier_id: supplierId,
        vat_amount: vatTotal, total_amount: totalAmt, status: 'approved',
        file_url: doc.file_url || '', journal_number: jn, branch: doc.branch || null,
        purchase_category: doc.purchase_category || null, category_main: categoryMain, category_sub: null,
      }).select('id').single()
      if (ledgerErr) throw new Error(ledgerErr.message)
      if (!itemsInserted) throw new Error('فشل تسجيل القيد في الدفتر')
      const itemRows = res.items.map((item, i) => {
        const amt     = Number(item.amount) || 0
        const itemVat = itemsTotal > 0 ? parseFloat((vatTotal * amt / itemsTotal).toFixed(2)) : 0
        return {
          document_id: doc.id, project_id: pid, journal_number: jn,
          description: item.description || res.description || '',
          amount: amt, vat_amount: itemVat,
          category_main: resolveItemCategoryMain(docCategories, item, transType),
          category_sub: item.category_sub || null,
          sort_order: i + 1,
        }
      })
      const { error: itemsErr } = await supabase.from('document_items').insert(itemRows)
      if (itemsErr) throw new Error(itemsErr.message)
      await supabase.from('documents').update({ journal_number: jn }).eq('id', doc.id)

    } else {
      const amount = Number(res.amount || res.totalAmount) || 0
      const singleDesc = res.description || doc.file_name
      if (!forceNew) {
        const isDup = await checkLedgerDup(pid, res.date, res.transType || '', singleDesc, amount)
        if (isDup) { const e = new Error('__DUP__'); e.isDup = true; throw e }
      }
      const singleDescFinal = forceNew ? `${singleDesc} [${Date.now().toString(36)}]` : singleDesc
      const jn = await getOrCreateJournalNumber(pid, res.date)
      const supplierId = pay === 'payable' ? await resolveSupplierId(pid, doc, res) : null
      const { data: inserted, error: err } = await supabase.from('ledger_entries').insert({
        project_id: pid, date: res.date, type: res.transType || '',
        description: singleDescFinal,
        cash_out:    !isIncoming && pay === 'cash'    ? amount : 0,
        bank_out:    !isIncoming && pay === 'bank'    ? amount : 0,
        custody_out: !isIncoming && pay === 'custody' ? amount : 0,
        cash_in:      isIncoming && pay === 'cash'    ? amount : 0,
        bank_in:      isIncoming && pay === 'bank'    ? amount : 0,
        custody_in:   isIncoming && pay === 'custody' ? amount : 0,
        payable_in:  !isIncoming && pay === 'payable' ? amount : 0,
        payable_out: 0,
        supplier_id: supplierId,
        vat_amount: Number(res.vatAmount) || 0, total_amount: amount,
        status: 'approved', file_url: doc.file_url || '', journal_number: jn,
        branch: doc.branch || null, purchase_category: doc.purchase_category || null,
        category_main: normCat(res.transType || '') || res.category_main || null, category_sub: res.category_sub || null,
      }).select('id').single()
      if (err) throw new Error(err.message)
      if (!inserted) throw new Error('فشل تسجيل القيد في الدفتر — لم يُعاد أي سجل')
      if (doc.purchase_category && inserted?.id) {
        await supabase.rpc('set_entry_purchase_category', { entry_id: inserted.id, category: doc.purchase_category })
      }
      await supabase.from('documents').update({ journal_number: jn }).eq('id', doc.id)
    }
  }

  async function approve(doc, forceNew = false) {
    const rawRes = doc._edit || doc.analysis_result
    if (doc.purchase_category && rawRes) rawRes.transType = doc.purchase_category

    const invoiceList = rawRes?.invoices

    // فواتير متعددة — اعتمد كل فاتورة بقيدها المستقل
    if (invoiceList?.length > 1) {
      updateDoc(doc.id, { _state: 'approving', _validationError: null, _dupCheck: false })
      try {
        for (const inv of invoiceList) {
          await _approveOne(doc, inv, true)
        }
        const newName = readableName(doc, invoiceList[0])
        await supabase.from('documents').update({
          status: 'approved', file_name: newName, category_main: null, category_sub: null,
        }).eq('id', doc.id)
        setDocs(ds => ds.filter(d => d.id !== doc.id))
      } catch(e) {
        const msg = e?.needsSupplierConfirm ? 'يرجى تأكيد هوية المورد أولاً — راجع بطاقة "يشبه مورد موجود" أعلاه' : e.message
        updateDoc(doc.id, { _state: 'analyzed', _error: msg })
      }
      return
    }

    // فاتورة واحدة
    const res = invoiceList?.[0] ?? rawRes

    // ── تحقق الإلزامي لمحمصة كون ──────────────────────────────────────
    const docProjName = projMap[doc.project_id] || projectName
    const isMahmasa = docProjName === 'محمصة كون'
    if (isMahmasa && res?.type !== 'sales' && res?.type !== 'transfer') {
      const isMultiItem = res?.items?.length > 1
      // فاتورة متعددة البنود: لا حقل "تصنيف أساسي" عام لنتحقق منه — التصنيف أصبح لكل بند (مسبوق تلقائياً من الذكاء الاصطناعي)
      const missingType = !isMultiItem && !res?.transType
      const missingPay  = !res?.paySource
      if (missingType || missingPay) {
        updateDoc(doc.id, { _validationError: { missingType, missingPay } })
        return
      }
    }
    updateDoc(doc.id, { _state: 'approving', _validationError: null, _dupCheck: false })

    try {
      await _approveOne(doc, res, forceNew)
      const newName = readableName(doc, res)
      await supabase.from('documents').update({
        status: 'approved', file_name: newName, category_main: null, category_sub: null,
      }).eq('id', doc.id)
      setDocs(ds => ds.filter(d => d.id !== doc.id))
    } catch(e) {
      if (e?.isDup) { updateDoc(doc.id, { _state: 'analyzed', _dupCheck: true }); return }
      if (e?.needsSupplierConfirm) { updateDoc(doc.id, { _state: 'analyzed', _error: 'يرجى تأكيد هوية المورد أولاً — راجع بطاقة "يشبه مورد موجود" أعلاه' }); return }
      updateDoc(doc.id, { _state: 'analyzed', _error: e.message })
    }
  }

  async function reject(doc) {
    updateDoc(doc.id, { _state: 'rejecting' })
    try {
      await supabase.from('documents').update({ status: 'rejected' }).eq('id', doc.id)
      setDocs(ds => ds.filter(d => d.id !== doc.id))
    } catch(e) { updateDoc(doc.id, { _state: 'idle', _error: e.message }) }
  }

  // اعتماد فاتورة واحدة من مستند متعدد الفواتير
  async function approveInvoice(doc, invIdx) {
    const rawRes  = doc._edit || doc.analysis_result
    const invList = rawRes?.invoices || []
    const inv     = invList[invIdx]
    if (!inv) return
    updateDoc(doc.id, { _state: 'approving', _error: '' })
    try {
      await _approveOne(doc, inv, true)
      const remaining = invList.filter((_, i) => i !== invIdx)
      if (remaining.length === 0) {
        const newName = readableName(doc, inv)
        await supabase.from('documents').update({ status: 'approved', file_name: newName, category_main: null, category_sub: null }).eq('id', doc.id)
        setDocs(ds => ds.filter(d => d.id !== doc.id))
      } else {
        updateDoc(doc.id, { _state: 'analyzed', _edit: { ...rawRes, invoices: remaining } })
      }
    } catch(e) {
      if (e?.isDup) { updateDoc(doc.id, { _state: 'analyzed', _dupCheck: true }); return }
      updateDoc(doc.id, { _state: 'analyzed', _error: e.message })
    }
  }

  // رفض فاتورة واحدة من مستند متعدد الفواتير
  function rejectInvoice(doc, invIdx) {
    const rawRes    = doc._edit || doc.analysis_result
    const invList   = rawRes?.invoices || []
    const remaining = invList.filter((_, i) => i !== invIdx)
    if (remaining.length === 0) {
      reject(doc)
    } else {
      updateDoc(doc.id, { _edit: { ...rawRes, invoices: remaining } })
    }
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
        <div className="flex items-center gap-3">
          {isSuperAdmin && (
            <select
              value={filterProjId}
              onChange={e => setFilterProjId(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="">كل المشاريع</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <button onClick={() => { setLoading(true); loadDocs(isSuperAdmin ? (filterProjId || null) : pidRef.current).then(() => setLoading(false)) }}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium">↻ تحديث</button>
        </div>
      </div>

      {docs.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center py-16 text-slate-400">
          <span className="text-4xl mb-3">📭</span>
          <p className="font-medium">لا توجد مستندات جديدة</p>
        </div>
      ) : docs.map(doc => (
        <DocCard key={doc.id} doc={doc}
          projName={isSuperAdmin ? (projMap[doc.project_id] || '') : ''}
          branchProjectName={projMap[doc.project_id] || projectName || ''}
          onLoadImage={() => loadImage(doc)}
          onAnalyze={() => analyze(doc)}
          onApprove={() => approve(doc)}
          onApproveForced={() => approve(doc, true)}
          onDupIgnore={() => reject(doc)}
          onReject={() => reject(doc)}
          onApproveInvoice={invIdx => approveInvoice(doc, invIdx)}
          onRejectInvoice={invIdx => rejectInvoice(doc, invIdx)}
          onEdit={(f, v) => {
            const cur = doc._edit || doc.analysis_result || {}
            const extra = f === 'transType' ? { _aiSuggestedType: false } : {}
            // إذا wrapped في invoices[0] — عدّل داخل المصفوفة مباشرة
            if (cur.invoices?.length === 1) {
              updateDoc(doc.id, { ...extra, _edit: { ...cur, invoices: [{ ...cur.invoices[0], [f]: v }] } })
            } else {
              updateDoc(doc.id, { ...extra, _edit: { ...cur, [f]: v } })
            }
          }}
          onEditInvoice={(invIdx, f, v) => {
            const cur = doc._edit || doc.analysis_result || {}
            const invoices = (cur.invoices || []).map((inv, i) => i === invIdx ? { ...inv, [f]: v } : inv)
            updateDoc(doc.id, { _edit: { ...cur, invoices } })
          }}
          onEditItem={(idx, patch) => {
            const cur = doc._edit || doc.analysis_result || {}
            if (cur.invoices?.length === 1) {
              const inv   = cur.invoices[0]
              const items = (inv.items || []).map((it, i) => i === idx ? { ...it, ...patch } : it)
              updateDoc(doc.id, { _edit: { ...cur, invoices: [{ ...inv, items }] } })
            } else {
              const items = (cur.items || []).map((it, i) => i === idx ? { ...it, ...patch } : it)
              updateDoc(doc.id, { _edit: { ...cur, items } })
            }
          }}
          onDeleteItem={idx => {
            const cur = doc._edit || doc.analysis_result || {}
            if (cur.invoices?.length === 1) {
              const inv   = cur.invoices[0]
              const items = (inv.items || []).filter((_, i) => i !== idx)
              updateDoc(doc.id, { _edit: { ...cur, invoices: [{ ...inv, items }] } })
            } else {
              const items = (cur.items || []).filter((_, i) => i !== idx)
              updateDoc(doc.id, { _edit: { ...cur, items } })
            }
          }}
          onAddItem={() => {
            const cur = doc._edit || doc.analysis_result || {}
            const blank = { description: '', amount: '', category_main: '', category_sub: '' }
            if (cur.invoices?.length === 1) {
              const inv   = cur.invoices[0]
              const items = [...(inv.items || []), blank]
              updateDoc(doc.id, { _edit: { ...cur, invoices: [{ ...inv, items }] } })
            } else {
              const items = [...(cur.items || []), blank]
              updateDoc(doc.id, { _edit: { ...cur, items } })
            }
          }}
          onAddInvoice={() => {
            const cur  = doc._edit || doc.analysis_result || {}
            const prev = cur.invoices?.length ? cur.invoices : [{ ...cur }]
            const today = new Date().toISOString().split('T')[0]
            const blank = {
              type: 'expense', date: prev[0]?.date || today,
              totalAmount: '', vatAmount: 0, transType: '',
              paySource: prev[0]?.paySource || '', description: '',
              items: [{ description: '', amount: '', category_main: '', category_sub: '' }],
            }
            updateDoc(doc.id, { _edit: { invoices: [...prev, blank] }, _showImage: true })
          }}
          timeAgo={timeAgo}
          transTypes={isSuperAdmin ? (transTypesMap[doc.project_id] || FALLBACK_TRANS_TYPES) : transTypes}
          categories={isSuperAdmin ? (categoriesMap[doc.project_id] || []) : categories}
          branches={branches}
          suppliers={suppliers}
          payableSuppliers={isSuperAdmin ? (payableSuppliersMap[doc.project_id] || []) : payableSuppliers}
          onBranchChange={b => updateDoc(doc.id, { branch: b })}
          onSupplierChange={id => updateDoc(doc.id, { _supplierId: id })}
          onSupplierNameChange={v => updateDoc(doc.id, { _supplierName: v, _supplierResolution: null, _matchedSupplierId: null })}
          onSupplierResolve={(resolution, matchedId) => updateDoc(doc.id, { _supplierResolution: resolution, _matchedSupplierId: matchedId })}
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
// فاتورة ببند واحد (categoryMainFromType مُمرَّر): الأب ثابت من تصنيف الفاتورة العام.
// فاتورة متعددة البنود (categoryMainFromType === undefined): كل بند يختار تصنيفه الأساسي بنفسه.
// onEdit يستقبل كائن تصحيح (patch) — يسمح بتحديث حقلين معاً بنداء واحد ذرّي (مثل تصفير
// category_sub عند تغيير category_main دون تسلسل نداءات يتصادم على نفس الإغلاق القديم).
function ItemRow({ item, index, categories, onEdit, onDelete, categoryMainFromType }) {
  const allCats     = categories || []
  const parentCats  = allCats.filter(c => !c.parent_id)
  const independentMode = categoryMainFromType === undefined
  const mainValue   = independentMode ? (item.category_main || '') : (categoryMainFromType || '')
  const parentCat   = parentCats.find(p => normCat(p.name) === normCat(mainValue))
  const itemSubs    = parentCat ? allCats.filter(c => c.parent_id === parentCat.id) : []
  const subValue    = item.category_sub || ''

  return (
    <div className="border-b border-slate-100 last:border-0 p-2 space-y-1.5">
      <div className="flex gap-2 items-center">
        <span className="text-xs text-slate-400 shrink-0 w-4 text-center">{index + 1}</span>
        <input value={item.description || ''} onChange={e => onEdit({ description: e.target.value })}
          placeholder="وصف البند"
          className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300"/>
        <input type="number" value={item.amount || ''} onChange={e => onEdit({ amount: e.target.value })}
          placeholder="0.00"
          className="w-24 border border-slate-200 rounded-lg px-2 py-1 text-sm text-left font-mono focus:outline-none focus:ring-1 focus:ring-blue-300"/>
        <button onClick={onDelete}
          className="text-red-300 hover:text-red-600 transition-colors text-base leading-none px-1">✕</button>
      </div>
      <div className={independentMode ? 'pr-5 grid grid-cols-2 gap-1.5' : 'pr-5'}>
        {independentMode && (
          <select value={mainValue}
            onChange={e => onEdit({ category_main: e.target.value, category_sub: '' })}
            className="w-full border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1"
            style={{ borderColor: '#fde68a' }}>
            <option value="">— التصنيف الأساسي —</option>
            {item.category_main && !parentCats.some(p => p.name === mainValue) && (
              <option value={mainValue}>{mainValue}</option>
            )}
            {parentCats.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        )}
        <select value={subValue} onChange={e => onEdit({ category_sub: e.target.value })}
          className="w-full border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1"
          style={{ borderColor: '#bbf7d0' }}>
          <option value="">— التصنيف الفرعي —</option>
          {item.category_sub && !itemSubs.some(s => s.name === subValue) && (
            <option value={subValue}>{subValue}</option>
          )}
          {itemSubs.length > 0
            ? itemSubs.map(s => <option key={s.id} value={s.name}>{s.name}</option>)
            : <option value="أخرى">أخرى</option>
          }
        </select>
      </div>
    </div>
  )
}

// ── DocCard ──────────────────────────────────────────────────────────────────
function DocCard({ doc, projName, branchProjectName, onLoadImage, onAnalyze, onApprove, onApproveForced, onDupIgnore, onReject, onEdit, onEditInvoice, onEditItem, onDeleteItem, onAddItem, onAddInvoice, onApproveInvoice, onRejectInvoice, onBranchChange, onSupplierChange, onSupplierNameChange, onSupplierResolve, onClearValidation, timeAgo, transTypes, categories, branches, suppliers, payableSuppliers, ROLE_AR, ROLE_COLOR }) {
  const rawRes        = doc._edit || doc.analysis_result
  const isMultiInvoice = rawRes?.invoices?.length > 1
  const hideBranchPicker = branchProjectName?.includes('بـ عسل')

  useEffect(() => {
    if (hideBranchPicker && !doc.branch && branches.length > 0) {
      onBranchChange(branches[0])
    }
  }, [hideBranchPicker, doc.branch, branches])
  const res           = isMultiInvoice ? null : (rawRes?.invoices?.[0] ?? rawRes)
  const busy          = ['analyzing','approving','rejecting'].includes(doc._state)
  const isImage  = doc.file_type?.startsWith('image/')
  const fmt      = v => v != null && v !== '' ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'

  const parentCats     = categories.filter(c => !c.parent_id)
  const isExpenseItems = res?.type === 'expense' && res.items?.length > 0
  const itemCount       = isExpenseItems ? res.items.length : 0
  const isFutureDate    = res?.date && res.date > new Date().toISOString().split('T')[0]

  // مجموع البنود محسوب دائماً من البنود الفعلية
  const itemsTotal   = isExpenseItems ? res.items.reduce((s, it) => s + (Number(it.amount) || 0), 0) : 0
  const invoiceTotal = Number(res?.totalAmount || res?.amount) || 0
  const totalDiff    = itemsTotal > 0 ? itemsTotal - invoiceTotal : 0   // موجب = البنود أكثر، سالب = أقل

  // الأولوية: transType أولاً، ثم category_main كـ fallback للمستندات القديمة
  const selectedParent = parentCats.find(p =>
    normCat(p.name) === normCat(res?.transType || '') ||
    p.name === (res?.category_main || '') ||
    normCat(p.name) === normCat(res?.category_main || '')
  )
  const resolvedMain = selectedParent ? selectedParent.name : (res?.category_main || '')
  const subCats      = selectedParent ? categories.filter(c => c.parent_id === selectedParent.id) : []

  function openFile() {
    if (doc._isUrl)          window.open(doc._imageData, '_blank')
    else if (doc._imageData) openPdfBlob(doc._imageData, doc.file_name)
  }

  // مطابقة اسم المورد — فقط لفواتير "آجل"، تُعاد حسبتها حياً مع كل تعديل بالاسم
  const isPayable      = res?.paySource === 'payable'
  const supplierName   = doc._supplierName ?? res?.supplier_name ?? ''
  const supplierMatch  = isPayable && supplierName.trim()
    ? matchSupplier(supplierName, payableSuppliers || [])
    : { matchType: 'none', supplier: null }
  const needsSupplierConfirm = isPayable && supplierMatch.matchType === 'fuzzy' && !doc._supplierResolution

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
          {projName && (
            <span className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-full font-medium">{projName}</span>
          )}
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
            ⚠️ يرجى اختيار {doc._validationError.missingType && doc._validationError.missingPay ? 'التصنيف الأساسي ومصدر الدفع' : doc._validationError.missingType ? 'التصنيف الأساسي' : 'مصدر الدفع'} قبل الاعتماد
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

        {/* نتيجة التحليل — فواتير متعددة */}
        {(doc.status === 'analyzed' || doc._state === 'analyzed') && isMultiInvoice && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold rounded-lg px-3 py-2 border"
              style={{ background: '#eef2ff', color: '#4338ca', borderColor: '#c7d2fe' }}>
              📑 {rawRes.invoices.length} فواتير في هذه الصورة — عدّل كل فاتورة ثم اعتمد الكل
            </div>
            {rawRes.invoices.map((inv, idx) => (
              <InvoiceSubPanel
                key={idx}
                invoice={inv}
                index={idx}
                transTypes={transTypes}
                categories={categories}
                onEdit={(f, v) => onEditInvoice(idx, f, v)}
                onApprove={() => onApproveInvoice(idx)}
                onReject={() => onRejectInvoice(idx)}
                approving={busy}
              />
            ))}
            <div className="flex gap-2 pt-1">
              <button onClick={onApprove} disabled={busy}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
                {doc._state === 'approving'
                  ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/><span>جارٍ...</span></>
                  : `✓ اعتماد ${rawRes.invoices.length} فواتير`
                }
              </button>
              <button onClick={onReject} disabled={busy}
                className="px-4 py-2.5 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-semibold hover:bg-red-600 hover:text-white transition-colors disabled:opacity-50">
                {doc._state === 'rejecting' ? '...' : '✕ رد'}
              </button>
            </div>
            <button onClick={onAddInvoice} disabled={busy}
              className="w-full py-2 text-blue-600 border border-dashed border-blue-300 bg-blue-50 rounded-xl text-sm font-medium hover:bg-blue-100 transition-colors disabled:opacity-50">
              ➕ إضافة فاتورة أخرى من نفس الصورة
            </button>
          </div>
        )}

        {/* نتيجة التحليل — فاتورة واحدة */}
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
                      { label: 'تحويل 💸',     val: res.transferSales, show: !!(res.transferSales > 0) },
                      { label: 'هنقر ستيشن',  val: res.hungerSales,   show: !!(res.hungerSales > 0) },
                      { label: 'جاهز',         val: res.jahez,         show: !!(res.jahez > 0) },
                      { label: 'كيتا',         val: res.keeta,         show: !!(res.keeta > 0) },
                      { label: 'مرسول',        val: res.mrsool,        show: !!(res.mrsool > 0) },
                    ].filter(c => c.show).map(c => (
                      <div key={c.label}><span className="text-slate-400 text-xs block">{c.label}</span><span className="font-semibold text-green-700">{fmt(c.val)}</span></div>
                    ))}
                    <div><span className="text-slate-400 text-xs block">الإجمالي</span><span className="font-bold text-green-800">{fmt(res.totalSales || (res.cashSales||0)+(res.networkSales||0)+(res.transferSales||0)+(res.hungerSales||0)+(res.jahez||0)+(res.keeta||0)+(res.mrsool||0))}</span></div>
                    <div><span className="text-slate-400 text-xs block">ضريبة المخرجات (15%)</span><span className="font-semibold" style={{color:'#b45309'}}>{fmt(((res.totalSales||(res.cashSales||0)+(res.networkSales||0)+(res.transferSales||0))/1.15*0.15))}</span></div>
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
                    <div><span className="text-slate-400 text-xs block">مصدر الدفع</span><span className="font-medium">{{ cash:'الصندوق', bank:'البنك', custody:'العهدة', payable:'آجل 🏪' }[res.paySource] || res.paySource || '—'}</span></div>
                  </>
                )}

                {res.description && (
                  <div className="col-span-2"><span className="text-slate-400 text-xs block">الوصف</span><span>{res.description}</span></div>
                )}
              </div>

              {/* اسم المورد — فواتير "آجل" فقط */}
              {isPayable && (
                <div className="border-t border-slate-200 pt-2 space-y-2">
                  <label className="text-xs text-slate-400 block">🏪 اسم المورد</label>
                  <input value={supplierName} onChange={e => onSupplierNameChange(e.target.value)}
                    placeholder="اسم المورد"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>

                  {needsSupplierConfirm && (
                    <div className="rounded-xl p-3 space-y-2" style={{ background: '#fffbeb', border: '2px solid #f59e0b' }}>
                      <div className="text-sm text-amber-800 font-semibold">
                        ⚠️ يشبه مورد موجود: {supplierMatch.supplier.name} — هل هو نفس المورد؟
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => onSupplierResolve('existing', supplierMatch.supplier.id)}
                          className="flex-1 py-1.5 rounded-lg text-xs font-bold text-white" style={{ background: '#d97706' }}>
                          نعم نفس المورد
                        </button>
                        <button onClick={() => onSupplierResolve('new', null)}
                          className="flex-1 py-1.5 rounded-lg text-xs font-semibold border border-amber-300 text-amber-800 bg-white">
                          لا، مورد جديد
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

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
            {!doc.branch && branches.length > 0 && !hideBranchPicker && (
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
            <details className="group" open={!!doc._validationError || isFutureDate}>
              <summary className="text-sm text-blue-600 cursor-pointer hover:text-blue-800 font-medium list-none flex items-center gap-1">
                <span className="group-open:rotate-90 transition-transform inline-block">▶</span> تعديل البيانات
              </summary>
              <div className="mt-3 space-y-3">

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">التاريخ</label>
                    {isFutureDate && (
                      <div className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mb-1">
                        ⚠️ هذا التاريخ في المستقبل — تأكد أن القراءة صحيحة قبل الاعتماد
                      </div>
                    )}
                    <input type="date" value={res.date || ''} onChange={e => onEdit('date', e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
                  </div>

                  {/* نوع المستند — دائماً قابل للتعديل لتصحيح التصنيف الخاطئ */}
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">نوع المستند</label>
                    <select value={res.type || ''} onChange={e => onEdit('type', e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                      <option value="sales">📊 مبيعات POS</option>
                      <option value="expense">🧾 فاتورة مصروفات</option>
                      <option value="transfer">🔄 تحويل</option>
                    </select>
                  </div>

                  {/* مصدر الدفع — دائماً قابل للتعديل */}
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
                      <option value="payable">🏪 آجل</option>
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

                  {/* إجمالي الفاتورة */}
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

                  {/* التصنيف الأساسي — على مستوى الفاتورة فقط عندما تكون ببند واحد أو بلا بنود؛
                      الفواتير متعددة البنود تُصنَّف لكل بند على حدة (انظر جدول البنود أدناه) */}
                  {!(isExpenseItems && itemCount > 1) && (
                    <div>
                      <label className="text-xs text-slate-400 mb-1 flex items-center gap-1.5">
                        <span>التصنيف الأساسي</span>
                        {doc._validationError?.missingType && <span className="text-red-500 font-bold">*مطلوب</span>}
                        {doc._aiSuggestedType && res.transType && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: '#eff6ff', color: '#1d4ed8' }}>🤖 اقتراح ذكي</span>
                        )}
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
                        { key: 'cashSales',     label: '💵 مبيعات كاش' },
                        { key: 'networkSales',  label: '🏦 مبيعات شبكة / مدى' },
                        { key: 'transferSales', label: '💸 مبيعات تحويل' },
                        { key: 'hungerSales',   label: '🍔 هنقر ستيشن' },
                        { key: 'jahez',         label: '🛵 جاهز' },
                        { key: 'keeta',         label: '🛺 كيتا' },
                        { key: 'mrsool',        label: '🛵 مرسول' },
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
                        <span className="font-mono font-bold text-green-800">{fmt((Number(res.cashSales)||0)+(Number(res.networkSales)||0)+(Number(res.transferSales)||0)+(Number(res.hungerSales)||0)+(Number(res.jahez)||0)+(Number(res.keeta)||0)+(Number(res.mrsool)||0))}</span>
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
                          categories={categories}
                          categoryMainFromType={itemCount > 1 ? undefined : normCat(res.transType || '')}
                          onEdit={patch => onEditItem(i, patch)}
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

                {/* التصنيف الفرعي — الرئيسي يُشتق تلقائياً من نوع الحركة */}
                {res.type !== 'sales' && !isExpenseItems && (
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
                )}
              </div>
            </details>

            {/* أزرار الاعتماد */}
            <div className="flex gap-2 pt-1">
              <button onClick={onApprove} disabled={busy || needsSupplierConfirm}
                title={needsSupplierConfirm ? 'يرجى تأكيد هوية المورد أولاً' : ''}
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
            <button onClick={onAddInvoice} disabled={busy}
              className="w-full py-2 text-blue-600 border border-dashed border-blue-300 bg-blue-50 rounded-xl text-sm font-medium hover:bg-blue-100 transition-colors disabled:opacity-50">
              ➕ إضافة فاتورة أخرى من نفس الصورة
            </button>
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

// ── InvoiceSubPanel — بطاقة فاتورة واحدة ضمن نتيجة متعددة ───────────────────
function InvoiceSubPanel({ invoice, index, transTypes, categories, onEdit, onApprove, onReject, approving }) {
  const fmt = v => v != null && v !== '' ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'
  const isSales      = invoice.type === 'sales'
  const isMultiItem  = (invoice.items?.length || 0) > 1
  const isFutureDate = invoice.date && invoice.date > new Date().toISOString().split('T')[0]
  const totalDisp = isSales
    ? (Number(invoice.cashSales)||0) + (Number(invoice.networkSales)||0) + (Number(invoice.hungerSales)||0) + (Number(invoice.jahez)||0) + (Number(invoice.keeta)||0)
    : Number(invoice.totalAmount || invoice.amount) || 0

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      {/* header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100">
        <span className="text-xs font-bold text-slate-600">فاتورة {index + 1}</span>
        <div className="flex items-center gap-3">
          {invoice.date && <span className="text-xs text-slate-400">{invoice.date}</span>}
          <span className={`text-xs font-mono font-bold ${isSales ? 'text-green-700' : 'text-red-700'}`}>
            {fmt(totalDisp)}
          </span>
        </div>
      </div>

      {/* summary row */}
      {(invoice.description || invoice.transType) && (
        <div className="px-3 py-2 flex items-center gap-2 text-xs text-slate-500">
          {invoice.transType && (
            <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full shrink-0">{invoice.transType}</span>
          )}
          {invoice.description && <span className="truncate">{invoice.description}</span>}
        </div>
      )}

      {/* edit */}
      <details open={isFutureDate}>
        <summary className="px-3 py-2 text-xs text-blue-600 cursor-pointer list-none flex items-center gap-1 border-t border-slate-100">
          <span>▶</span> تعديل
        </summary>
        <div className="px-3 pb-3 pt-2 space-y-2 bg-slate-50 border-t border-slate-100">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-400 block mb-1">التاريخ</label>
              {isFutureDate && (
                <div className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mb-1">
                  ⚠️ هذا التاريخ في المستقبل — تأكد أن القراءة صحيحة قبل الاعتماد
                </div>
              )}
              <input type="date" value={invoice.date || ''} onChange={e => onEdit('date', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white"/>
            </div>
            {!isSales && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">مصدر الدفع</label>
                <select value={invoice.paySource || ''} onChange={e => onEdit('paySource', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 bg-white">
                  <option value="">— اختر —</option>
                  <option value="cash">💵 الصندوق</option>
                  <option value="bank">🏦 البنك</option>
                  <option value="custody">👤 العهدة</option>
                </select>
              </div>
            )}
            {!isSales && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">المبلغ</label>
                <input type="number" value={invoice.totalAmount ?? invoice.amount ?? ''}
                  onChange={e => onEdit(invoice.totalAmount != null ? 'totalAmount' : 'amount', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 bg-white"/>
              </div>
            )}
            {!isSales && !isMultiItem && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">التصنيف الأساسي</label>
                <select value={invoice.transType || ''} onChange={e => onEdit('transType', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 bg-white">
                  <option value="">— اختر —</option>
                  {transTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}
            {isSales && [
              { key: 'cashSales',    label: '💵 كاش' },
              { key: 'networkSales', label: '🏦 شبكة' },
              { key: 'hungerSales',  label: '🍔 هنقر' },
              { key: 'jahez',        label: '🛵 جاهز' },
              { key: 'keeta',        label: '🛺 كيتا' },
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="text-xs text-slate-400 block mb-1">{label}</label>
                <input type="number" value={invoice[key] || ''} onChange={e => onEdit(key, e.target.value)}
                  placeholder="0.00"
                  className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 bg-white"/>
              </div>
            ))}
            <div className="col-span-2">
              <label className="text-xs text-slate-400 block mb-1">الوصف</label>
              <input value={invoice.description || ''} onChange={e => onEdit('description', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 bg-white"/>
            </div>

            {/* ── بنود الفاتورة ── */}
            {!isSales && (
              <div className="col-span-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">البنود ({(invoice.items || []).length})</span>
                  <button
                    onClick={() => onEdit('items', [...(invoice.items || []), { description: '', amount: '', category_main: '', category_sub: '' }])}
                    className="text-xs text-blue-600 hover:text-blue-800 font-semibold px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors">
                    + إضافة بند
                  </button>
                </div>
                {(invoice.items || []).length > 0 && (
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    {(invoice.items || []).map((item, i) => (
                      <ItemRow key={i} item={item} index={i}
                        categories={categories || []}
                        categoryMainFromType={isMultiItem ? undefined : normCat(invoice.transType || '')}
                        onEdit={patch => {
                          const items = (invoice.items || []).map((it, j) => j === i ? { ...it, ...patch } : it)
                          onEdit('items', items)
                        }}
                        onDelete={() => onEdit('items', (invoice.items || []).filter((_, j) => j !== i))}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </details>

      {/* أزرار الاعتماد والرفض الفردي */}
      {(onApprove || onReject) && (
        <div className="flex gap-2 px-3 pb-3 pt-1">
          {onApprove && (
            <button onClick={onApprove} disabled={approving}
              className="flex-1 py-2 bg-green-600 text-white rounded-xl text-xs font-bold hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
              {approving
                ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"/><span>جارٍ...</span></>
                : '✅ اعتماد هذه الفاتورة'
              }
            </button>
          )}
          {onReject && (
            <button onClick={onReject} disabled={approving}
              className="px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-xl text-xs font-semibold hover:bg-red-600 hover:text-white transition-colors disabled:opacity-50">
              ❌ رفض
            </button>
          )}
        </div>
      )}
    </div>
  )
}
