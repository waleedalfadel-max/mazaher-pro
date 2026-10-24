import { BANK_TRANSFER_TYPE, isBankTransfer, paymentWorkflow, paymentBranch, suggestDocumentPayments, reviewedPayment, bankOperationalNote, documentPaymentChoices } from '../lib/paymentWorkflow.js'
import BankTransferFields from '../components/BankTransferFields.jsx'
import React, { useEffect, useState, useRef, useLayoutEffect, useId } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Ban, Check, CircleAlert, FileSearch, FileText, FlaskConical, Inbox, Info, Layers, ListChecks, LoaderCircle, Maximize2, Plus, RefreshCw, RotateCcw, Save, ScanText, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import { Button, Chip, DateInput, Dialog, EmptyState, Field, GrowInput, IconButton, Input, Money, Note, Panel, SearchBox, Segment, Select, Status, Tabs, Textarea } from '../ui/components.jsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { analyzeDocument } from '../lib/claude'
import { getOrCreateJournalNumber } from '../lib/journalNumber'
import { fetchAsBase64, getSignedUrl } from '../lib/storage'
import { getTransactionTypes, getProjectSettings } from '../lib/projectSettings'
import { fitImageBase64 } from '../lib/imageCompress'
import { matchSupplier } from '../lib/supplierMatching'
import { compareItemsToTotal } from '../lib/documentTotals'
import { acceptAmount } from '../lib/amountInput'
import { plural } from '../ui/format.js'
import { approvalMessage, buildInvoicePayload, exactTotals, expenseBasisSuggestion, invoiceSupplierContext, money, newRequestId, payableDecision, salesCorrectionChanges, supplierBlockReason, callError } from '../lib/approvalV2'
import { setUnsaved } from '../lib/unsavedChanges'
import ExpenseReadingHelp from '../components/ExpenseReadingHelp.jsx'
import { accountDashboard } from '../lib/accountStatement.js'
import ManualReviewDialog from '../components/ManualReviewDialog.jsx'
import SupplierReceiptFields from '../components/SupplierReceiptFields.jsx'
import LoanRepaymentFields from '../components/LoanRepaymentFields.jsx'
import { LOAN_OPTION, isLoanRepayment, reviewDocumentType, toLoanRepayment, fromLoanRepayment, loanBlockReason, withoutLoanPrincipalConfirmation } from '../lib/loanRepayment.js'
import { RECEIPT_TYPE, isReceipt, toReceipt, fromReceipt, buildReceiptPayload, receiptBlockReason, receiptHistoryNote, withSuggestedSuppliers, supplierOptions } from '../lib/supplierReceipts.js'
import { withManualInvoice } from '../lib/manualReview.js'
import { operatesBusiness } from '../lib/adminAccess.js'
import { CHANNELS, CHANNEL_NAME, resolveUnknownPayment, salesReportCheck } from '../lib/salesReport.js'
import { bankAccountLabel, chosenBankAccount, documentExpensesAtProjectLevel, eligibleBankAccounts, expensesAtProjectLevel, needsBankAccount, salesChannelAccount, visibleSalesChannels, withSalesChannelAccount } from '../lib/branchSetup'
import { applyRulesToDocument, indexRules } from '../lib/itemRules'
import { clearDraft as dropDraft, dropLegacyDrafts, loadDraft, purgeDrafts, saveDraft as storeDraft } from '../lib/reviewDraft'

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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

const ROLE_AR    = { purchasing: 'مسؤول المشتريات', accountant: 'المحاسب', owner: 'المالك', cashier: 'الكاشير', superadmin: 'إدارة تحسيب' }
const ROLE_COLOR = {
  purchasing: 'bg-blue-100 text-blue-700',
  accountant: 'bg-purple-100 text-purple-700',
  owner:      'bg-amber-100 text-amber-700',
  cashier:    'bg-green-100 text-green-700',
}

// مقارنة مرنة — تبقي العربية فقط، تحذف الإيموجي والرموز والمسافات الزائدة
// مطابقة الاسم كما في الخادم (approval_private.norm_cat): تُحذف الرموز والإيموجي، وتُوحَّد الأرقام والمسافات وحالة
// الحروف اللاتينية؛ تبقى الحروف العربية واللاتينية والأرقام فلا يتطابق اسمان مختلفان.
const normCat = s => String(s || '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
  .replace(/[^A-Za-z0-9؀-ۿ\s]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

// يشتق category_main الصحيح لبند: الأب الفعلي الذي يحتوي category_sub بجدول categories —
// يبقى صحيحاً سواء كان category_sub من الذكاء الاصطناعي أو مُعدَّلاً يدوياً بالواجهة
function resolveItemCategoryMain(categories, item, fallbackTransType) {
  const cats = categories || [], subName = normCat(item.category_sub || '')
  const chosen = item.category_main ? cats.find(p => !p.parent_id && normCat(p.name) === normCat(item.category_main)) : null
  if (chosen && (!subName || cats.some(c => c.parent_id === chosen.id && normCat(c.name) === subName))) return normCat(chosen.name)
  const subs = subName ? cats.filter(c => c.parent_id && normCat(c.name) === subName) : []
  const sub = subs.length === 1 ? subs[0] : null
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
  if (uploadedBy === 'cashier') return 'cash'
  if (uploadedBy === 'owner')   return 'bank'
  if (uploadedBy === 'purchasing') return 'custody'
  return null
}

// إعادة القراءة (20261025120000): رسالة واضحة لكل رفض من الخادم؛ القراءة السابقة تبقى كما هي في كل الحالات
const REREAD_ERRORS = {
  forbidden: 'إعادة القراءة للمحاسب وإدارة تحسيب داخل المنشأة.',
  not_rereadable: 'المستند معتمد أو مرفوض أو لم يُقرأ بعد؛ لا تُعاد قراءته.',
  partially_decided: 'اعتُمدت أو استُبعدت فاتورة من هذه الصورة؛ لا تُعاد قراءتها.',
  stale: 'تغيّر المستند أثناء القراءة (اعتماد أو حفظ من شاشة أخرى). حدّث الصفحة؛ لم يُستبدل شيء.',
  invalid: 'نتيجة القراءة غير صالحة؛ بقيت القراءة السابقة كما هي.',
  no_session: 'انتهت الجلسة. سجّل الدخول من جديد؛ لم يتغير شيء.',
  not_found: 'المستند غير موجود في هذه المنشأة.',
}
const rereadError = code => REREAD_ERRORS[code] || 'تعذّر حفظ القراءة الجديدة؛ بقيت القراءة السابقة كما هي.'
// التعديلات اليدوية على القراءة: الفرق بين نسخة المراجعة والقراءة المحفوظة بعد إهمال علامات العرض (حقول _)
const withoutMarks = v => Array.isArray(v) ? v.map(withoutMarks) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('_')).map(([k, x]) => [k, withoutMarks(x)])) : v
const hasManualEdits = doc => !!doc._dirty || !!doc._draftSavedAt
  || JSON.stringify(withoutMarks(doc._edit || null)) !== JSON.stringify(withoutMarks(withoutLoanPrincipalConfirmation(doc.analysis_result || null)))

// مسودة المراجعة: تُحفظ بزر «حفظ مسودة» في هذه النافذة فقط (sessionStorage)، معزولة حسب المنشأة
// والمستخدم والمستند، ولا تُطبَّق إن تغيّرت حالة المستند أو قراءته (src/lib/reviewDraft.js).
// الحفظ في القاعدة ما زال عند الاعتماد وحده، كما في التطبيق قبل التصميم الجديد.
const draftStore = () => { try { return window.sessionStorage } catch { return null } }
const DRAFT_EXTRAS = ['branch', '_supplierId', '_supplierName', '_supplierResolution', '_matchedSupplierId']

// ملخص يُعرض في القائمة من نتيجة القراءة (شامل الضريبة كما في المستند)
function docSummary(doc) {
  const r = doc._edit || doc.analysis_result
  const inv = r?.invoices?.length ? r.invoices : r ? [r] : []
  const total = inv.reduce((t, x) => t + (Number(x.type === 'sales' ? x.totalSales : (x.totalAmount ?? x.amount)) || 0), 0)
  const kinds = [...new Set(inv.map(x => x.type))]
  const KIND = { expense: 'مصروف', sales: 'مبيعات', transfer: 'تحويل' }
  return {
    total: inv.length ? total : null,
    kind: inv.length > 1 ? plural(inv.length, 'فاتورة', 'فاتورتان', 'فواتير', 'فاتورة') : KIND[kinds[0]] || (doc.status === 'uploaded' ? '—' : 'غير محدد'),
    date: inv[0]?.date || null,
    name: readableName(doc, inv[0]),
  }
}

export default function PendingDocuments() {
  // مدير المنصة داخل منشأة اختارها (20261018120000) يعمل كمحاسبها: منشأة واحدة، وطريقة اعتمادها، والإجراءات كلها، والخادم ينسبها إليه.
  // المسار متعدد المنشآت للقراءة يبقى لمدير المنصة بلا منشأة مختارة فقط.
  const { projectId, projectName, role, viewState, isSuperAdmin: superAdminAccount } = useAuth()
  const manualAllowed = operatesBusiness(role, projectId, viewState)
  const isSuperAdmin = superAdminAccount && !projectId
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
  // إعداد المنشأة حسب الفرع (20261014140000): القنوات المفعلة، والحسابات البنكية، وقاموس الأصناف. منشأة بلا إعداد: كما كانت
  const [projectSettings, setProjectSettings] = useState(null)
  const [bankAccounts, setBankAccounts] = useState([])
  const [bankAccountsReady, setBankAccountsReady] = useState(false)
  const [setupError, setSetupError] = useState('')
  async function loadPaymentSetup(pid) {
    setSetupError(''); setBankAccountsReady(false)
    try {
      const [s,b] = await Promise.all([getProjectSettings(pid),supabase.from('bank_accounts').select('id,name,bank,branches,is_active,sort_order').eq('project_id',pid).order('sort_order')])
      if (pidRef.current !== pid) return
      if (!s?.settings || b.error) throw new Error('setup')
      setBranches(s.settings.branches || []);setProjectSettings(s.settings);setBankAccounts(b.data || []);setBankAccountsReady(true)
    } catch { if(pidRef.current===pid)setSetupError('تعذّر تحميل الحسابات واقتراحاتها. أعد المحاولة قبل الاعتماد.') }
  }
  const [ruleIndex, setRuleIndex] = useState(() => new Map())
  const [projects,   setProjects]     = useState([])
  const [projMap,    setProjMap]      = useState({})
  const [filterProjId, setFilterProjId] = useState('')
  const pidRef                        = useRef(null)
  const [modes, setModes]             = useState({})   // وضع الاعتماد لكل منشأة: legacy | v2 | paused
  const [listNotice, setListNotice]   = useState('')
  const modeOf = doc => (isSuperAdmin ? 'legacy' : modes[doc?.project_id || projectId] || 'legacy')
  const uidRef                        = useRef(undefined)   // هوية الجلسة الفعلية — لعزل المسودات
  async function sessionUid() {
    if (uidRef.current === undefined) {
      const { data } = await supabase.auth.getSession()
      uidRef.current = data?.session?.user?.id || null
    }
    return uidRef.current
  }
  const scopeOf = (d, uid = uidRef.current) => ({ projectId: d.project_id || projectId || null, userId: uid })

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
      // عرض منشأة لمدير المنصة: مستندات المنشأة المختارة وحدها (الخادم لا يعيد غيرها أصلًا)
      loadDocs(projectId || null).then(() => setLoading(false))
    } else if (projectId) {
      getTransactionTypes(projectId).then(setTransTypes)
      supabase.rpc('approval_mode', { p_project_id: projectId }).then(({ data }) => setModes(m => ({ ...m, [projectId]: data || 'legacy' })))
      loadPaymentSetup(projectId)
      supabase.from('item_category_rules').select('description_norm,category_id,subcategory_id,status,note').eq('project_id', projectId)
        .then(({ data }) => setRuleIndex(indexRules(data || [])))
      loadDocs(projectId).then(() => setLoading(false))
      supabase.from('categories')
        .select('id,name,parent_id,type,sort_order,financial_class,ledger_type,is_active')
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
    if (projectId) return   // عرض منشأة واحدة: لا فلتر مشاريع
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
          .select('id,name,parent_id,type,sort_order,financial_class,ledger_type,is_active')
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
      .select('id,file_name,file_type,status,analysis_result,uploaded_at,uploaded_by,created_by_role,file_url,branch,purchase_category,category_main,category_sub,project_id')
      .in('status', ['uploaded', 'analyzed'])
      .order('uploaded_at', { ascending: false })
    if (pid) q = q.eq('project_id', pid)
    const { data } = await q
    const uid = await sessionUid()
    const store = draftStore()
    setDocs((data || []).map(d => docState(d, store && uid ? loadDraft(store, scopeOf(d, uid), d) : null)))
  }

  // حالة مستند كما يُحمَّل من الخادم: بلا أي تأكيد مراجعة أو اختيار سابق (حقول _) إلا ما في مسودة صالحة
  function docState(d, saved = null) {
    const ok = saved && !saved.stale
    const extras = ok ? Object.fromEntries(DRAFT_EXTRAS.filter(k => k in saved.extras).map(k => [k, saved.extras[k]])) : {}
    return {
      ...d, ...extras,
      _state: 'idle', _error: '', _edit: withoutLoanPrincipalConfirmation(ok ? saved.edit : (d.analysis_result || null)),
      _dirty: false, _draftSavedAt: ok ? saved.savedAt : null, _draftStale: !!saved?.stale,
      _origBranch: d.branch, _branchEditable: !d.branch,
      _imageData: null, _showImage: false, _isUrl: false,
    }
  }

  function updateDoc(id, patch) {
    // تعديل من المستخدم (لا نتيجة قراءة جديدة ولا حالة بعد اعتماد جزئي): «تعديلات لم تُحفظ» حتى «حفظ مسودة» أو الاعتماد
    if (patch._edit && patch._state === undefined) patch = { _v2Error: null, ...patch, _dirty: true }
    setDocs(ds => ds.map(d => {
      if (d.id !== id) return d
      const next = { ...d, ...patch }
      // Preserve confirmed/cleared payment choices across reload in this user's existing isolated browser draft.
      if (paymentWorkflow(projectSettings) && patch._edit && patch._state === undefined
          && JSON.stringify(documentPaymentChoices(d._edit)) !== JSON.stringify(documentPaymentChoices(patch._edit))) {
        const store = draftStore(), at = Date.now()
        const extras = Object.fromEntries(DRAFT_EXTRAS.filter(k => next[k] !== undefined).map(k => [k, next[k]]))
        if (store && storeDraft(store, scopeOf(next), next, next._edit, extras, at)) {
          next._dirty = false; next._draftSavedAt = at
        } else next._error = 'تغيّر الاختيار، لكن تعذّر حفظ المسودة في هذا المتصفح. لا تغادر الصفحة قبل الاعتماد أو حفظ المسودة.'
      }
      return next
    }))
  }
  // يعيد true إذا حُفظت المسودة فعلًا، وfalse إن فشل التخزين (ممتلئ أو معطّل) فيبقى المستند «معدّلًا غير محفوظ»
  function saveDraftFor(doc) {
    const store = draftStore()
    const extras = Object.fromEntries(DRAFT_EXTRAS.filter(k => doc[k] !== undefined).map(k => [k, doc[k]]))
    const now = Date.now()
    if (store && storeDraft(store, scopeOf(doc), doc, doc._edit, extras, now)) { updateDoc(doc.id, { _dirty: false, _draftSavedAt: now, _draftStale: false }); return true }
    updateDoc(doc.id, { _error: 'تعذّر حفظ المسودة في هذا المتصفح (التخزين معطّل أو ممتلئ، أو لم تُعرف هوية الجلسة).' })
    return false
  }
  function discardDraft(doc) {
    const store = draftStore()
    if (store) dropDraft(store, scopeOf(doc), doc.id)
    updateDoc(doc.id, {
      _state: doc._state, _edit: withoutLoanPrincipalConfirmation(doc.analysis_result || null), _dirty: false, _draftSavedAt: null, _validationError: null, _rulesFor: null, _dictionaryApplied: null,
      branch: doc._origBranch, _supplierId: undefined, _supplierName: undefined, _supplierResolution: undefined, _matchedSupplierId: undefined,
    })
  }
  function clearDraftOf(doc) { const store = draftStore(); if (store) dropDraft(store, scopeOf(doc), doc.id) }
  // مسودات هذا المستخدم لمستندات خرجت من القائمة (اعتُمدت أو رُفضت) تُحذف؛ ومسودات النسخة السابقة غير المعزولة كذلك
  useEffect(() => {
    const store = draftStore(), uid = uidRef.current
    if (loading || !store || !uid) return
    dropLegacyDrafts(store)
    const pidOf = d => d.project_id || projectId || null
    const pids = new Set(docs.map(pidOf))
    if (!isSuperAdmin) pids.add(projectId || null)
    pids.forEach(pid => purgeDrafts(store, { projectId: pid, userId: uid }, docs.filter(d => pidOf(d) === pid).map(d => d.id)))
  }, [docs, loading])

  async function loadImage(doc) {
    if (doc._showImage) { updateDoc(doc.id, { _showImage: false }); return }
    if (doc._imageData && !doc._isUrl) { updateDoc(doc.id, { _showImage: true }); return }
    if (doc.file_url) {
      // رابط موقَّت يُولَّد وقت الطلب في كل مرة — لا يُخزَّن مؤقتاً بسبب انتهاء صلاحيته
      updateDoc(doc.id, { _loadingImg: true })
      const signedUrl = await getSignedUrl(doc.file_url)
      updateDoc(doc.id, { _imageData: signedUrl, _isUrl: true, _showImage: true, _loadingImg: false })
      return
    }
    updateDoc(doc.id, { _loadingImg: true })
    const { data } = await supabase.from('documents').select('file_data').eq('id', doc.id).single()
    updateDoc(doc.id, { _imageData: data?.file_data || null, _isUrl: false, _showImage: true, _loadingImg: false })
  }

  // قراءة الصورة الأصلية المخزّنة بالتعليمات الحالية (القراءة الأولى وإعادة القراءة معًا)؛ لا تكتب شيئًا
  async function readDocument(doc) {
    const docPid      = doc.project_id || projectId
    const docProjName = projMap[docPid] || projectName || ''

    // اجلب التصنيفات وأنواع الحركة الخاصة بمشروع المستند
    let docCategories = categories
    let docTransTypes = transTypes
    if (isSuperAdmin && docPid) {
      const { data: cats } = await supabase.from('categories')
        .select('id,name,parent_id,type,sort_order,financial_class,ledger_type,is_active')
        .eq('project_id', docPid).order('sort_order')
      docCategories = cats || []
      docTransTypes = transTypesMap[docPid] || await getTransactionTypes(docPid)
    }

    let fileBase64, fileMime, signedFileUrl = null
    if (doc.file_url) {
      signedFileUrl = await getSignedUrl(doc.file_url)
      const fetched = await fetchAsBase64(signedFileUrl)
      fileBase64 = fetched.base64
      fileMime   = fetched.mimeType || doc.file_type
    } else {
      const { data } = await supabase.from('documents').select('file_data').eq('id', doc.id).single()
      if (!data?.file_data) throw new Error('لا توجد بيانات الملف')
      fileBase64 = data.file_data
      fileMime   = doc.file_type
    }
    if (fileMime?.startsWith('image/')) {
      // بلا ضغط ثانٍ للمخزّنة ضمن الحدود (src/lib/imageCompress.js)؛ والتدوير عند الحاجة داخل analyzeDocument
      ({ base64: fileBase64, mime: fileMime } = await fitImageBase64(fileBase64, fileMime))
    }
    const readingSettings = await getProjectSettings(docPid)
    let result = await analyzeDocument(fileBase64, fileMime, doc.file_name, doc.uploaded_by, docCategories, docProjName, docTransTypes, false, readingSettings?.settings || {})

    // مصدر الدفع الافتراضي — يُطبَّق فقط إذا لم يُحدَّد أصلاً
    const defaultPaySource = getDefaultPaySource(docProjName, doc.uploaded_by)
    if (defaultPaySource) {
      if (result?.invoices) {
        result.invoices = result.invoices.map(inv =>
          inv.type === 'sales' ? inv
            : isReceipt(inv) ? { ...inv, paySource: ['cash', 'bank'].includes(inv.paySource) ? inv.paySource : ['cash', 'bank'].includes(defaultPaySource) ? defaultPaySource : '' }
            : { ...inv, paySource: inv.paySource || defaultPaySource }
        )
      } else if (result && result.type !== 'sales') {
        result.paySource = result.paySource || defaultPaySource
      }
    }

    // إيصال سداد: المورد المطابق تمامًا لاسم المستفيد يُحفظ اقتراحًا (suggestedSupplier) يؤكده المراجع؛ لا يُملأ المورد تلقائيًا
    if (!isSuperAdmin) result = withSuggestedSuppliers(result, supplierOptions(suppliers, payableSuppliers))
    return { result, signedFileUrl, fileBase64 }
  }

  async function analyze(doc) {
    updateDoc(doc.id, { _state: 'analyzing', _error: '' })
    try {
      const { result, signedFileUrl, fileBase64 } = await readDocument(doc)
      await supabase.from('documents').update({ status: 'analyzed', analysis_result: result }).eq('id', doc.id)
      updateDoc(doc.id, {
        _state: 'analyzed', status: 'analyzed',
        analysis_result: result, _edit: withoutLoanPrincipalConfirmation(result),
        _aiSuggestedType: true,
        _imageData: signedFileUrl || fileBase64,
        _isUrl: !!signedFileUrl,
        _showImage: true,
      })
    } catch(e) { updateDoc(doc.id, { _state: 'idle', _error: e.message }) }
  }

  // إعادة قراءة مستند مقروء لم يُعتمد (20261025120000): قراءة جديدة للصورة الأصلية، ثم حفظ في الخادم يحتفظ بالقراءة السابقة
  // ويلغي تجهيز المراجعة. لا يتغير شيء في الشاشة ولا في الخادم إلا بعد نجاح القراءة والحفظ معًا؛ ولا قيد مالي.
  async function reread(doc) {
    const before = doc._state
    updateDoc(doc.id, { _state: 'rereading', _error: '', _rereadNotice: '' })
    try {
      const { data: cur, error } = await supabase.from('documents').select('status,version').eq('id', doc.id).single()
      if (error || !cur) throw new Error('تعذّر التحقق من حالة المستند. أعد المحاولة؛ لم يتغير شيء.')
      if (cur.status !== 'analyzed') throw new Error('المستند لم يعد قيد المراجعة؛ لا تُعاد قراءته. حدّث الصفحة.')
      const { result } = await readDocument(doc)
      if (!Array.isArray(result?.invoices) || !result.invoices.length) throw new Error('لم تُرجع القراءة الجديدة أي فاتورة؛ بقيت القراءة السابقة كما هي.')
      const { data, error: saveError } = await supabase.rpc('document_reread_save', { p_document_id: doc.id, p_expected_version: cur.version, p_result: result })
      if (saveError || !data?.ok) throw new Error(rereadError(data?.code))
      const { data: fresh, error: freshError } = await supabase.from('documents')
        .select('id,file_name,file_type,status,analysis_result,uploaded_at,uploaded_by,created_by_role,file_url,branch,purchase_category,category_main,category_sub,project_id')
        .eq('id', doc.id).single()
      clearDraftOf(doc)
      if (freshError || !fresh) { setListNotice('أُعيدت القراءة وحُفظت. حدّث الصفحة لمراجعة النتيجة الجديدة.'); setDocs(ds => ds.filter(d => d.id !== doc.id)); return }
      // كل تأكيدات المراجعة السابقة تسقط مع الحالة القديمة؛ يُعاد تجهيز المراجعة تلقائيًا من القراءة الجديدة
      setDocs(ds => ds.map(d => d.id !== doc.id ? d : { ...docState(fresh), _imageData: d._imageData, _isUrl: d._isUrl, _showImage: d._showImage,
        _rereadNotice: 'أُعيدت قراءة المستند. القراءة السابقة محفوظة للمراجعة، وأُلغيت تأكيدات المراجعة السابقة: راجع النتيجة الجديدة كاملة قبل الاعتماد.' }))
    } catch (e) { updateDoc(doc.id, { _state: before === 'rereading' ? 'idle' : before, _error: e.message }) }
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
    // مصروفات على مستوى المنشأة (إعداد expenses_scope): قيد المصروف بلا فرع ولو رُفع المستند من مستخدم فرع (والخادم يفعل الشيء نفسه في الاعتماد الجديد)
    const expenseBranch = expensesAtProjectLevel(projectSettings) ? null : (doc.branch || null)
    const pid        = doc.project_id || pidRef.current
    const docProjName = projMap[pid] || projectName || ''
    const pay        = res.paySource || 'custody'
    const isIncoming = res.transType?.includes('تحصيل جملة')
    const docCategories = isSuperAdmin ? (categoriesMap[pid] || []) : categories
    const docTransTypes = isSuperAdmin ? (transTypesMap[pid] || FALLBACK_TRANS_TYPES) : transTypes

    if (res.type === 'sales') {
      // وسيلة دفع غير معروفة أو فرق مع الإجمالي المطبوع: لا كتابة (src/lib/salesReport.js)
      const check = salesReportCheck(res)
      if (!check.ok) throw new Error(check.reasons[0])
      // ثبّت الفرع المختار في المستند قبل أي كتابة مالية؛ الربط القديم يتطلب تطابقه مع القيود والمبيعات.
      const { error: branchError } = await supabase.from('documents')
        .update({ branch: doc.branch || null }).eq('id', doc.id).eq('project_id', pid).select('id').single()
      if (branchError) throw new Error(branchError.message)
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
      const isDeposit  = !isCustody && !isCollect && (!res.transType || res.transType.includes('إيداع نقدي'))
      const entryFields = isCollect
        ? { cash_in: 0, bank_in: amount, custody_in: 0, cash_out: 0, bank_out: 0, custody_out: 0, receivable_in: 0, receivable_out: amount }
        : isCustody
          ? { cash_in: 0, bank_in: 0, custody_in: amount, cash_out: 0, bank_out: amount, custody_out: 0, receivable_in: 0, receivable_out: 0 }
          : isDeposit
            ? { cash_in: 0, bank_in: amount, custody_in: 0, cash_out: amount, bank_out: 0, custody_out: 0, receivable_in: 0, receivable_out: 0 }
            : {
                // transType حقيقي آخر (مثل "مسحوبات سليمان") — لا يمثّل تحويلاً داخلياً فعلياً، فيُقرأ مصدر الدفع الفعلي
                cash_in: 0, bank_in: 0, custody_in: 0,
                cash_out:    pay === 'cash'    ? amount : 0,
                bank_out:    pay === 'bank'    ? amount : 0,
                custody_out: pay === 'custody' ? amount : 0,
                receivable_in: 0, receivable_out: 0,
              }
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
      const supplierId = res.supplier_id || doc._supplierId   // مورد الفاتورة داخل الصورة متعددة الفواتير أولًا
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
        file_url: doc.file_url || '', journal_number: jn, branch: expenseBranch,
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
        branch: expenseBranch, purchase_category: doc.purchase_category || null,
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
    if (modeOf(doc) !== 'legacy') return approveV2(doc)
    const rawRes = doc._edit || doc.analysis_result
    if (doc.purchase_category && rawRes) rawRes.transType = doc.purchase_category

    const invoiceList = rawRes?.invoices

    // فواتير متعددة — اعتمد كل فاتورة بقيدها المستقل
    if (invoiceList?.length > 1) {
      const badTransferIdx = invoiceList.findIndex(inv => inv.type === 'transfer' && !inv.paySource)
      if (badTransferIdx !== -1) {
        updateDoc(doc.id, { _error: `⚠️ الفاتورة رقم ${badTransferIdx + 1} من نوع "تحويل" — يجب اختيار مصدر الدفع لها قبل اعتماد الكل` })
        return
      }
      const badExpenseIdx = invoiceList.findIndex(inv => {
        if (inv.type === 'sales' || inv.type === 'transfer') return false
        const isMultiItem = inv.items?.length > 1
        return (!isMultiItem && !inv.transType) || !inv.paySource
      })
      if (badExpenseIdx !== -1) {
        updateDoc(doc.id, { _error: `⚠️ الفاتورة رقم ${badExpenseIdx + 1} — يجب اختيار التصنيف الأساسي ومصدر الدفع لها قبل اعتماد الكل` })
        return
      }
      updateDoc(doc.id, { _state: 'approving', _validationError: null, _dupCheck: false })
      try {
        for (const inv of invoiceList) {
          await _approveOne(doc, inv, true)
        }
        const newName = readableName(doc, invoiceList[0])
        await supabase.from('documents').update({
          status: 'approved', file_name: newName, category_main: null, category_sub: null,
        }).eq('id', doc.id)
        clearDraftOf(doc); setDocs(ds => ds.filter(d => d.id !== doc.id))
      } catch(e) {
        const msg = e?.needsSupplierConfirm ? 'يرجى تأكيد هوية المورد أولاً — راجع بطاقة "يشبه مورد موجود" أعلاه' : e.message
        updateDoc(doc.id, { _state: 'analyzed', _error: msg })
      }
      return
    }

    // فاتورة واحدة
    const res = invoiceList?.[0] ?? rawRes

    // ── تحقق إلزامي: تصنيف أساسي ومصدر دفع لأي مصروف — لكل المشاريع ──
    if (res?.type !== 'sales' && res?.type !== 'transfer') {
      const isMultiItem = res?.items?.length > 1
      // فاتورة متعددة البنود: لا حقل "تصنيف أساسي" عام لنتحقق منه — التصنيف أصبح لكل بند (مسبوق تلقائياً من الذكاء الاصطناعي)
      const missingType = !isMultiItem && !res?.transType
      const missingPay  = !res?.paySource
      if (missingType || missingPay) {
        updateDoc(doc.id, { _validationError: { missingType, missingPay } })
        return
      }
    }

    // ── تحقق عام لكل المشاريع: تحويل بلا مصدر دفع يسقط صامتاً على "عهدة" بـ_approveOne ──
    if (res?.type === 'transfer' && !res?.paySource) {
      updateDoc(doc.id, { _validationError: { missingPay: true, missingTransferPay: true } })
      return
    }

    updateDoc(doc.id, { _state: 'approving', _validationError: null, _dupCheck: false })

    try {
      await _approveOne(doc, res, forceNew)
      const newName = readableName(doc, res)
      await supabase.from('documents').update({
        status: 'approved', file_name: newName, category_main: null, category_sub: null,
      }).eq('id', doc.id)
      clearDraftOf(doc); setDocs(ds => ds.filter(d => d.id !== doc.id))
    } catch(e) {
      if (e?.isDup) { updateDoc(doc.id, { _state: 'analyzed', _dupCheck: true }); return }
      if (e?.needsSupplierConfirm) { updateDoc(doc.id, { _state: 'analyzed', _error: 'يرجى تأكيد هوية المورد أولاً — راجع بطاقة "يشبه مورد موجود" أعلاه' }); return }
      updateDoc(doc.id, { _state: 'analyzed', _error: e.message })
    }
  }

  async function reject(doc) {
    updateDoc(doc.id, { _state: 'rejecting' })
    try {
      // الرد يُفحص: كان الفشل يُخفي المستند من القائمة وهو باقٍ في القاعدة
      const { error } = await supabase.from('documents').update({ status: 'rejected' }).eq('id', doc.id)
      if (error) throw new Error(error.message)
      clearDraftOf(doc); setDocs(ds => ds.filter(d => d.id !== doc.id))
    } catch(e) { updateDoc(doc.id, { _state: 'idle', _error: e.message }) }
  }

  // اعتماد فاتورة واحدة من مستند متعدد الفواتير
  async function approveInvoice(doc, invIdx) {
    if (modeOf(doc) !== 'legacy') return approveV2(doc, invIdOf(doc, invIdx))
    const rawRes  = doc._edit || doc.analysis_result
    const invList = rawRes?.invoices || []
    const inv     = invList[invIdx]
    if (!inv) return
    if (inv.type === 'transfer' && !inv.paySource) {
      updateDoc(doc.id, { _error: '⚠️ يجب اختيار مصدر الدفع قبل اعتماد التحويل' })
      return
    }
    if (inv.type !== 'sales' && inv.type !== 'transfer') {
      const isMultiItem = inv.items?.length > 1
      const missingType = !isMultiItem && !inv.transType
      const missingPay  = !inv.paySource
      if (missingType || missingPay) {
        updateDoc(doc.id, { _error: '⚠️ يجب اختيار التصنيف الأساسي ومصدر الدفع قبل الاعتماد' })
        return
      }
    }
    updateDoc(doc.id, { _state: 'approving', _error: '' })
    try {
      await _approveOne(doc, inv, true)
      const remaining = invList.filter((_, i) => i !== invIdx)
      if (remaining.length === 0) {
        const newName = readableName(doc, inv)
        await supabase.from('documents').update({ status: 'approved', file_name: newName, category_main: null, category_sub: null }).eq('id', doc.id)
        clearDraftOf(doc); setDocs(ds => ds.filter(d => d.id !== doc.id))
      } else {
        // اعتُمد جزء من الفواتير: المسودة السابقة تحوي فاتورة صارت مسجّلة، فتُحذف
        clearDraftOf(doc)
        updateDoc(doc.id, { _state: 'analyzed', _edit: { ...rawRes, invoices: remaining }, _dirty: false, _draftSavedAt: null })
      }
    } catch(e) {
      if (e?.isDup) { updateDoc(doc.id, { _state: 'analyzed', _dupCheck: true }); return }
      updateDoc(doc.id, { _state: 'analyzed', _error: e.message })
    }
  }

  // رفض فاتورة واحدة من مستند متعدد الفواتير
  function rejectInvoice(doc, invIdx) {
    if (modeOf(doc) !== 'legacy') return excludeV2(doc, invIdOf(doc, invIdx))
    const rawRes    = doc._edit || doc.analysis_result
    const invList   = rawRes?.invoices || []
    const remaining = invList.filter((_, i) => i !== invIdx)
    if (remaining.length === 0) {
      reject(doc)
    } else {
      updateDoc(doc.id, { _edit: { ...rawRes, invoices: remaining } })
    }
  }

  // ── الاعتماد الجديد (v2): كل الكتابة في الخادم، في معاملة واحدة (supabase/migrations/20260928000000_approval_v2.sql) ──
  const invIdOf = (doc, idx) => ((doc._edit || doc.analysis_result)?.invoices || [])[idx]?._id

  async function prepareV2(doc) {
    const { data, error } = await supabase.rpc('approval_prepare', { p_document_id: doc.id })
    if (error || !data) { updateDoc(doc.id, { _state: 'analyzed', _v2Error: callError(error) }); return }
    if (!data.ok) { updateDoc(doc.id, { _state: doc._state === 'approving' ? 'analyzed' : doc._state, _v2Error: data }); return }
    if (!['uploaded', 'analyzed'].includes(data.status)) { clearDraftOf(doc); setDocs(ds => ds.filter(d => d.id !== doc.id)); return }
    setDocs(ds => ds.map(d => {
      if (d.id !== doc.id) return d
      const ar = data.analysis_result
      const src = d._edit || withoutLoanPrincipalConfirmation(ar)
      let edit = src
      if (src && ar?.invoices) {   // معرّفات الفواتير من الخادم تُنقل إلى نسخة المراجعة دون فقد التعديلات
        const list = src.invoices?.length ? src.invoices : [src]
        edit = { ...(ar._localStub ? { _localStub: true } : {}), invoices: list.map((x, i) => ({ ...x, _id: x._id || ar.invoices[i]?._id })) }
      }
      if (d._draftSavedAt || data.invoices?.some(x => x.history?.length)) {
        const mark = x => ({ ...x, _paymentInitialized: true })
        edit = edit?.invoices ? { ...edit, invoices: edit.invoices.map(mark) } : mark(edit)
      }
      const next = { ...d, status: data.status, analysis_result: ar, _edit: edit, _v2: { version: data.version, invoices: data.invoices, mode: data.mode } }
      if (d._draftSavedAt) { const store = draftStore(); if (store) storeDraft(store, scopeOf(next), next, next._edit, {}, d._draftSavedAt) }
      return next
    }))
  }

  async function approveV2(doc, target = 'all') {
    if (!bankAccountsReady || !projectSettings) { updateDoc(doc.id,{_state:doc._state,_error:'لم يكتمل تحميل الحسابات. أعد المحاولة قبل الاعتماد.'});return }
    if (modeOf(doc) === 'paused') { updateDoc(doc.id, { _state: doc._state, _v2Error: { code: 'paused' } }); return }
    if (!doc._v2) { await prepareV2(doc); return }
    const pid = doc.project_id || pidRef.current
    const docCategories = isSuperAdmin ? (categoriesMap[pid] || []) : categories
    const docTransTypes = isSuperAdmin ? (transTypesMap[pid] || FALLBACK_TRANS_TYPES) : transTypes
    const docPayable    = isSuperAdmin ? (payableSuppliersMap[pid] || []) : payableSuppliers
    const raw = doc._edit || doc.analysis_result
    const list = (raw?.invoices?.length ? raw.invoices : [raw]).map(x => (x._id ? x : { ...x, _id: newRequestId() }))
    const known = new Set(doc._v2.invoices.map(i => i.id))
    const pending = new Set(doc._v2.invoices.filter(i => i.status === 'pending').map(i => i.id))
    let invs = list.filter(x => pending.has(x._id) || !known.has(x._id))
    if (target !== 'all') invs = invs.filter(x => x._id === target)
    if (!invs.length) return
    for (const inv of invs) {
      const loanReason = loanBlockReason(inv, docTransTypes)
      if (loanReason) { updateDoc(doc.id, { _state: doc._state, _v2Error: { code: 'loan_incomplete', reason: loanReason, invoice_id: inv._id } }); return }
      if (inv.type === 'expense' && inv.items?.length) {
        const t = exactTotals(inv)
        if (t.status !== 'match') { updateDoc(doc.id, { _state: doc._state, _v2Error: { code: t.status === 'invalid' ? 'invalid_amount' : 'amounts_mismatch', difference: t.diff / 100, invoice_id: inv._id } }); return }
      }
      if (inv.type === 'sales') {
        const c = salesReportCheck(inv)
        if (!c.ok) { updateDoc(doc.id, { _state: doc._state, _v2Error: { code: 'sales_unexplained', reason: c.reasons[0], invoice_id: inv._id } }); return }
      }
    }
    // الإيصال المعاد فتحه (بعد حذف دفعته) يحمل بيانات المراجع السابقة؛ القراءة الأصلية من الخادم (original_reading)
    const originals = Object.fromEntries((doc.analysis_result?.invoices || []).map(x => [x._id, doc._v2?.invoices?.find(i => i.id === x._id)?.original_reading || x]))
    const decisions = { suppliers: {}, duplicates: { ...(doc._dupDecisions || {}) } }
    // الصورة متعددة الفواتير: مورد كل فاتورة وحدها (invoiceSupplierContext)، والفاتورة المفردة: اختيار المستند كما كان
    const multi = list.length > 1
    const payload = invs.map(inv => {
      if (isReceipt(inv)) return buildReceiptPayload(inv, { original: originals[inv._id] })
      const ctx = invoiceSupplierContext(doc, inv, multi)
      const pl = buildInvoicePayload(inv, { original: originals[inv._id], categories: docCategories, transTypes: docTransTypes,
        purchaseCategory: doc.purchase_category, supplierId: ctx.supplierId })
      if (pl.paySource === 'payable') {
        pl.supplier_name = ctx.name
        const decision = payableDecision(matchSupplier(ctx.name, docPayable), ctx)
        if (decision) decisions.suppliers[inv._id] = decision
      }
      return pl
    })
    const document = { branch: doc.branch || null, file_name: readableName(doc, payload[0]), supplier_id: multi ? null : (doc._supplierId || null) }
    const fp = JSON.stringify([payload, decisions, document])
    const requestId = doc._req?.fp === fp ? doc._req.id : newRequestId()   // إعادة المحاولة نفسها بالمعرّف نفسه
    updateDoc(doc.id, { _state: 'approving', _v2Error: null, _notice: '', _req: { id: requestId, fp },
      _edit: raw?.invoices ? { ...raw, invoices: list } : { invoices: list } })
    let data = null, error = null
    try {
      ({ data, error } = await supabase.rpc('approval_approve', { p_document_id: doc.id, p_request_id: requestId,
        p_expected_version: doc._v2.version, p_invoices: payload, p_decisions: decisions, p_document: document }))
    } catch (e) { error = e }
    if (error || !data) { updateDoc(doc.id, { _state: 'analyzed', _v2Error: callError(error) }); return }
    if (!data.ok) return v2Failed(doc, data)
    v2Done(doc, data)
  }

  function v2Failed(doc, data) {
    if (data.code === 'already_approved') { clearDraftOf(doc); setListNotice(approvalMessage(data)); setDocs(ds => ds.filter(d => d.id !== doc.id)); return }
    const dup = data.code === 'payment_possible_duplicate' && data.invoice_id ? { _receiptDup: { ...(doc._receiptDup || {}), [data.invoice_id]: data } } : {}
    updateDoc(doc.id, { _state: 'analyzed', _v2Error: data, ...dup, ...(['stale', 'invoice_already_decided', 'payment_deleted'].includes(data.code) ? { _req: null } : {}) })
    if (['stale', 'invoice_already_decided', 'payment_deleted'].includes(data.code)) prepareV2(doc)
  }

  function v2Done(doc, data) {
    clearDraftOf(doc)
    const jns = (data.journals || []).map(j => j.journal_number)
    if (data.document_status === 'approved' || data.document_status === 'rejected') {
      if (jns.length) setListNotice(`اعتُمد «${docSummary(doc).name}» بالقيد ${jns.join('، ')}.`)
      setDocs(ds => ds.filter(d => d.id !== doc.id)); return
    }
    const done = Object.fromEntries((data.journals || []).map(j => [j.invoice_id, j.journal_number]))
    const receiptDup = Object.fromEntries(Object.entries(doc._receiptDup || {}).filter(([id]) => !done[id]))
    const invoices = doc._v2.invoices.map(i => (done[i.id] ? { ...i, status: 'approved', journal_number: done[i.id] } : i))
    for (const id of Object.keys(done)) if (!invoices.some(i => i.id === id)) invoices.push({ id, status: 'approved', journal_number: done[id] })
    updateDoc(doc.id, { _state: 'analyzed', _req: null, _v2Error: null, _draftSavedAt: null, _receiptDup: receiptDup,
      _v2: { ...doc._v2, version: data.version, invoices },
      _notice: jns.length ? `اعتُمدت بالقيد ${jns.join('، ')}. الباقي بانتظار المراجعة.` : 'حُدّثت حالة الفواتير.' })
  }

  async function excludeV2(doc, invoiceId, reason = null) {
    if (!doc._v2) return prepareV2(doc)
    const { data, error } = await supabase.rpc('approval_exclude_invoice', { p_document_id: doc.id, p_invoice_id: invoiceId,
      p_expected_version: doc._v2.version, p_reason: reason })
    if (error || !data) { updateDoc(doc.id, { _state: doc._state, _v2Error: callError(error) }); return }
    if (!data.ok) return v2Failed(doc, data)
    if (data.document_status !== 'analyzed') { clearDraftOf(doc); setDocs(ds => ds.filter(d => d.id !== doc.id)); return }
    updateDoc(doc.id, { _state: doc._state, _v2: { ...doc._v2, version: data.version,
      invoices: doc._v2.invoices.map(i => (i.id === invoiceId ? { ...i, status: 'excluded', excluded_reason: reason } : i)) }, _notice: 'استُبعدت الفاتورة ولن تُسجَّل.' })
  }

  async function rejectV2(doc, reason) {
    if (!doc._v2 && doc.status === 'analyzed') { await prepareV2(doc); return }
    const { data, error } = await supabase.rpc('approval_reject_document', { p_document_id: doc.id,
      p_expected_version: doc._v2?.version ?? doc.version ?? 0, p_reason: reason || null })
    if (error || !data) { updateDoc(doc.id, { _state: 'idle', _v2Error: callError(error) }); return }
    if (!data.ok) return v2Failed(doc, data)
    clearDraftOf(doc); setDocs(ds => ds.filter(d => d.id !== doc.id))
  }

  async function correctSalesV2(doc, reason) {
    const raw = doc._edit || doc.analysis_result
    const inv = (raw?.invoices || [raw])[0]
    const payload = buildInvoicePayload(inv, { original: (doc.analysis_result?.invoices || [])[0], categories: [], transTypes: [] })
    const document = { branch: doc.branch || null }
    // التصحيح مبني على نسخة التقرير التي عُرضت في التنبيه؛ تُحفظ لإعادة المحاولة بعد انقطاع
    const linked = doc._v2Error?.linked || doc._salesLinked || {}
    if (payload.bankAccounts && linked.accounts) {
      const kept = Object.fromEntries(Object.entries(payload.bankAccounts).filter(([k]) => !(Number(linked.accounts[k]?.old || 0) || Number(linked.accounts[k]?.total || 0))))
      payload.bankAccounts = kept
    }
    const revision = linked.revision ?? null
    const fp = JSON.stringify(['correct', payload, reason, document, revision])
    const requestId = doc._req?.fp === fp ? doc._req.id : newRequestId()
    updateDoc(doc.id, { _state: 'approving', _v2Error: null, _salesLinked: linked, _req: { id: requestId, fp } })
    const { data, error } = await supabase.rpc('approval_correct_sales_report', { p_document_id: doc.id, p_request_id: requestId,
      p_expected_version: doc._v2.version, p_invoice: payload, p_reason: reason, p_expected_revision: revision, p_document: document })
    if (error || !data) { updateDoc(doc.id, { _state: 'analyzed', _v2Error: callError(error) }); return }
    if (data.code === 'report_changed') {
      // صحّحه غيرك بعد عرضه: التنبيه نفسه بالأرقام الحالية ونسختها، ليراجع المستخدم قبل أن يصحّح
      const fresh = { ...linked, current: data.current, revision: data.revision }
      updateDoc(doc.id, { _state: 'analyzed', _req: null, _salesLinked: fresh, _v2Error: { code: 'sales_report_exists', changed: true, linked: fresh } })
      return
    }
    if (!data.ok) return v2Failed(doc, data)
    clearDraftOf(doc)
    const changes = salesCorrectionChanges(data.previous, data.corrected)
    setListNotice(`صُحّح تقرير مبيعات ${inv.date || ''} بالقيد ${data.journal_number}: ${changes.join('، ')} ر.س.`)
    setDocs(ds => ds.filter(d => d.id !== doc.id))
  }

  const timeAgo = t => {
    const m = (Date.now() - new Date(t)) / 60000
    if (m < 1)    return 'لحظات'
    if (m < 60)   return `${Math.round(m)} دقيقة`
    if (m < 1440) return `${Math.round(m / 60)} ساعة`
    return `${Math.round(m / 1440)} يوم`
  }

  // ── العرض: قائمة، أو تفاصيل مستند واحد عبر ?doc= (نفس الصفحة، فلا تضيع حالة المراجعة) ──
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const openId = params.get('doc')
  const [rejecting, setRejecting] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [view, setView] = useState('fields')
  const listScroll = useRef(0)
  const scroller = () => document.querySelector('.ts-scroll')
  // الرجوع من التفاصيل يعيد موضع القائمة
  useLayoutEffect(() => {
    const el = scroller(); if (!el) return
    if (openId) el.scrollTo(0, 0)
    else requestAnimationFrame(() => el.scrollTo(0, listScroll.current))
  }, [openId])
  function openDoc(id) {
    listScroll.current = scroller()?.scrollTop || 0
    const next = new URLSearchParams(params); next.set('doc', id); setParams(next)
  }
  function closeDoc() { if (window.history.state?.idx > 0) navigate(-1); else { const next = new URLSearchParams(params); next.delete('doc'); setParams(next, { replace: true }) } }
  function askReject(doc) { setRejectReason(''); setRejecting(doc) }
  async function confirmReject() {
    const doc = rejecting; setRejecting(null)
    if (modeOf(doc) !== 'legacy') { await rejectV2(doc, rejectReason.trim()); if (openId === doc.id) closeDoc(); return }
    await reject(doc)
    if (openId === doc.id) closeDoc()
  }
  // الصورة تُحمَّل عند فتح المستند
  const opened = docs.find(d => d.id === openId)
  useEffect(() => { if (opened && !opened._showImage && !opened._loadingImg && (opened.file_url || opened.file_type)) loadImage(opened) }, [openId, !!opened])
  useEffect(() => { if (opened && modeOf(opened) !== 'legacy' && opened.status === 'analyzed' && !opened._v2) prepareV2(opened) }, [openId, !!opened, opened?.status, modes])
  // Suggestions wait for the real uploader, account list and stable invoice IDs; never modify the original reading.
  useLayoutEffect(() => {
    if (!opened?._v2 || !bankAccountsReady || !projectSettings) return
    const pending = new Set(opened._v2.invoices.filter(x => x.status === 'pending').map(x => x.id))
    const before = opened._edit || opened.analysis_result
    const next = suggestDocumentPayments(before, opened, projectSettings, bankAccounts, {}, pending)
    if (JSON.stringify(next) !== JSON.stringify(before)) updateDoc(opened.id, { _edit: next, _state: opened._state })
  }, [opened?._v2, opened?._edit, opened?.branch, bankAccountsReady, projectSettings, bankAccounts])
  // قاموس الأصناف: مرة لكل قراءة، للبنود التي بلا تصنيف فقط (الاعتماد الجديد). صنف «للمراجعة» لا يُصنَّف، يُعلَّم فقط
  useEffect(() => {
    if (!opened || isSuperAdmin || modeOf(opened) === 'legacy' || !ruleIndex.size || !categories.length) return
    if (opened.status !== 'analyzed' && opened._state !== 'analyzed') return
    if (!opened._v2) return   // بعد تجهيز الخادم (معرّفات الفواتير): يُطبَّق مرة واحدة على النسخة النهائية فيبقى العدد صحيحًا
    if (opened._rulesFor && opened._rulesFor === opened.analysis_result) return
    const r = applyRulesToDocument(opened._edit || opened.analysis_result, ruleIndex, categories)
    updateDoc(opened.id, { _state: opened._state, _rulesFor: opened.analysis_result,
      ...(r.applied || r.review ? { _edit: r.edit, _dictionaryApplied: { applied: r.applied, review: r.review } } : {}) })
  }, [openId, opened?.status, opened?._state, opened?.analysis_result, opened?._rulesFor, !!opened?._v2, ruleIndex, categories, modes])
  // اعتماد المستند المفتوح يخرجه من القائمة: نعود إليها ونمسح مسودته
  useEffect(() => { if (openId && !loading && !opened) closeDoc() }, [openId, loading, !!opened])

  // مغادرة الصفحة وفيها تعديلات لم تُحفظ: روابط التطبيق تمر بحوار، وإعادة التحميل أو الإغلاق بتنبيه المتصفح.
  // (BrowserRouter لا يوفّر useBlocker؛ زر الرجوع في المتصفح إلى صفحة أخرى لا يُعترض.)
  const [leaving, setLeaving] = useState(null)
  const [typing, setTyping] = useState(false)
  const dirtyDocs = docs.filter(d => d._dirty)
  const hasDirty = dirtyDocs.length > 0
  useEffect(() => {
    if (!hasDirty) return
    const warn = e => { e.preventDefault(); e.returnValue = '' }
    const onClick = e => {
      const a = e.target.closest?.('a[href]')
      if (!a || a.target === '_blank' || e.ctrlKey || e.metaKey || e.shiftKey) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return
      e.preventDefault(); e.stopPropagation()
      setLeaving({ to: url.pathname + url.search })
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', onClick, true)
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', onClick, true) }
  }, [hasDirty])
  // رسالة «صدر تحديث» تعرض الحفظ قبل إعادة التحميل ما دامت هنا تعديلات (src/components/VersionNotice.jsx)
  useEffect(() => {
    if (!hasDirty) { setUnsaved(null); return undefined }
    // save: يحاول حفظ كل المستندات المعدّلة (لا يتوقف عند أول فشل) ويعيد true فقط إن نجحت كلها
    setUnsaved({ count: dirtyDocs.length, save: () => dirtyDocs.map(saveDraftFor).every(Boolean), discard: () => setDocs(ds => ds.map(d => ({ ...d, _dirty: false }))) })
    return () => setUnsaved(null)
  }, [hasDirty, dirtyDocs.length, docs])
  // «حفظ مسودة ومغادرة»: لا مغادرة إلا بعد نجاح حفظ مسودات كل المستندات المعدّلة؛ عند الفشل يبقى الحوار والتعديلات مع «إعادة المحاولة»
  function leave(save) {
    const to = leaving.to
    if (save) {
      if (!dirtyDocs.map(saveDraftFor).every(Boolean)) { setLeaving({ to, failed: true }); return }
    } else setDocs(ds => ds.map(d => ({ ...d, _dirty: false })))
    setLeaving(null)
    setTimeout(() => navigate(to))
  }
  const leaveDialog = (
    <Dialog open={!!leaving} onClose={() => setLeaving(null)} title="تعديلات لم تُحفظ"
      description={`في ${dirtyDocs.length === 1 ? 'مستند واحد' : `${dirtyDocs.length} مستندات`} تعديلات لم تُحفظ ولم تُعتمد.`}
      footer={<>
        <Button variant="primary" icon={Save} disabled={!uidRef.current} onClick={() => leave(true)}>
          {leaving?.failed ? 'إعادة المحاولة: حفظ مسودة ومغادرة' : 'حفظ مسودة ومغادرة'}
        </Button>
        <Button onClick={() => leave(false)}>تجاهل التعديلات</Button>
        <Button variant="quiet" onClick={() => setLeaving(null)}>البقاء</Button>
      </>}>
      <p className="ts-field-hint">المسودة تُحفظ في هذه النافذة فقط، لا في قاعدة البيانات.</p>
      {leaving?.failed && (
        <p className="ts-version-notice__error" role="alert">
          تعذّر حفظ المسودة في هذا المتصفح (مساحة التخزين ممتلئة أو غير متاحة)، فلم تُغادَر الصفحة وتعديلاتك باقية فيها.
          أعد المحاولة؛ وإن استمر الفشل فابقَ في الصفحة ولا تغادرها قبل تدوين تعديلاتك.
        </p>
      )}
    </Dialog>
  )

  const q = params.get('q') || '', statusFilter = params.get('status') || 'all', roleFilter = params.get('by') || 'all'
  const setFilter = (k, v) => { const next = new URLSearchParams(params); if (!v || v === 'all') next.delete(k); else next.set(k, v); setParams(next, { replace: true }) }
  const rows = docs.map(d => ({ doc: d, sum: docSummary(d) })).filter(({ doc, sum }) =>
    (statusFilter === 'all' || doc.status === statusFilter) && (roleFilter === 'all' || doc.uploaded_by === roleFilter) &&
    (!q.trim() || [sum.name, doc.file_name, sum.kind, String(sum.total ?? '')].join(' ').toLowerCase().includes(q.trim().toLowerCase())))
  const counts = { all: docs.length, uploaded: docs.filter(d => d.status === 'uploaded').length, analyzed: docs.filter(d => d.status === 'analyzed').length }
  const STATUS = { uploaded: { label: 'جديد — لم يُقرأ', tone: 'neutral' }, analyzed: { label: 'مقروء — بانتظار المراجعة', tone: 'warning' } }
  const refresh = () => { setLoading(true); loadDocs(isSuperAdmin ? (projectId || filterProjId || null) : pidRef.current).then(() => setLoading(false)) }

  const rejectDialog = (
    <Dialog open={!!rejecting} onClose={() => setRejecting(null)} title="رفض المستند؟"
      description={rejecting ? docSummary(rejecting).name : ''}
      footer={<><Button variant="danger-solid" icon={Ban} onClick={confirmReject}>رفض المستند</Button><Button onClick={() => setRejecting(null)}>إلغاء</Button></>}>
      {rejecting && modeOf(rejecting) !== 'legacy' ? (
        <Field label="سبب الرفض (اختياري)" hint="يُحفظ مع المستند.">
          <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="مثال: صورة مكررة لفاتورة معتمدة" />
        </Field>
      ) : (
        <Note tone="info">يُخرج من القائمة بحالة «مرفوض» كما في التطبيق الحالي. <strong>تسجيل سبب الرفض</strong> يحتاج عمودًا وتنفيذًا خلفيًا في الحزمة التشغيلية التالية، فلا يُطلب هنا.</Note>
      )}
    </Dialog>
  )

  if (loading) return (
    <div className="ts-empty"><div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--ts-petrol)', borderTopColor: 'transparent' }} /></div>
  )

  if (openId && opened) {
    const doc = opened   // خصائص DocCard المنقولة كما هي تستعمل اسم doc
    const sum = docSummary(opened)
    const isImage = opened.file_type?.startsWith('image/')
    return (
      <div className={`rp-review-page${typing ? ' is-typing' : ''}`}>
        <button type="button" className="ts-back" onClick={closeDoc}><ArrowRight className="ts-icon--sm" aria-hidden="true" />مستندات جديدة</button>
        <div className="rp-review-head">
          <div>
            <h1>{sum.name} <Status tone={STATUS[opened.status]?.tone || 'neutral'}>{STATUS[opened.status]?.label || opened.status}</Status></h1>
            <p>{sum.kind} · رفعه {ROLE_AR[opened.uploaded_by] || opened.uploaded_by || '—'} منذ {timeAgo(opened.uploaded_at)}{opened.branch ? ` · ${opened.branch}` : ''}{isSuperAdmin && projMap[opened.project_id] ? ` · ${projMap[opened.project_id]}` : ''}</p>
          </div>
        </div>
        {!bankAccountsReady && !isSuperAdmin && <Note tone={setupError ? 'error' : 'info'} action={setupError && <Button onClick={()=>loadPaymentSetup(projectId)}>إعادة تحميل الحسابات</Button>}>{setupError || 'جارٍ تحميل الحسابات واقتراحاتها…'}</Note>}
        {opened._draftStale && (
          <Note tone="warning" icon={CircleAlert} title="لم تُطبَّق مسودة سابقة">
            تغيّرت حالة المستند أو نتيجة قراءته بعد حفظها، فحُذفت. الحقول أدناه من القراءة الحالية.
          </Note>
        )}
        {opened._dirty ? (
          <Note tone="warning" icon={CircleAlert} title="تعديلات لم تُحفظ">
            احفظها مسودةً في هذه النافذة، أو اعتمد مباشرة. لا يُكتب شيء في قاعدة البيانات قبل الاعتماد.
          </Note>
        ) : opened._draftSavedAt ? (
          <Note tone="info" icon={Save} title={`مسودة محفوظة في هذه النافذة فقط · ${new Date(opened._draftSavedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
            action={<Button size="sm" variant="quiet" icon={Undo2} onClick={() => discardDraft(opened)}>تجاهل المسودة</Button>}>
            ليست في قاعدة البيانات ولا يراها غيرك. تُحذف عند الاعتماد أو الرفض أو إغلاق النافذة.
          </Note>
        ) : null}
        <div className="rp-view-switch">
          <div className="ts-segment ts-segment--full" role="group" aria-label="عرض">
            <button type="button" aria-pressed={view === 'fields'} onClick={() => setView('fields')}>البيانات</button>
            <button type="button" aria-pressed={view === 'image'} onClick={() => setView('image')}>صورة المستند</button>
          </div>
        </div>
        <div className="rp-review-grid rp-review-grid--app" data-view={view}>
          <div className="rp-review-fields"
            onFocus={e => { if (e.target.matches('input, select, textarea')) setTyping(true) }}
            onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setTyping(false) }}>
            <DocCard key={doc.id} doc={doc} embedded readOnly={isSuperAdmin || !bankAccountsReady}
          onManualApprove={manualAllowed ? async (index, invoice) => {
            if (doc.project_id !== projectId || modeOf(doc) === 'legacy') throw new Error('ادخل المنشأة أولًا وانتظر تجهيز المستند.')
            const reviewed = withManualInvoice(doc, index, invoice)
            await approveV2(reviewed, invoice._id)
          } : null}
          v2={modeOf(doc) !== 'legacy' ? { mode: modeOf(doc), ...(doc._v2 || {}) } : null}
          onDupConfirm={(invId, reason, linked) => {
            const decisions = { ...(doc._dupDecisions || {}), [invId]: { reason, linked_journal: linked?.journal_number || null, linked_document: linked?.document_id || null } }
            updateDoc(doc.id, { _state: doc._state, _dupDecisions: decisions })
            approveV2({ ...doc, _dupDecisions: decisions })
          }}
          onCorrectSales={reason => correctSalesV2(doc, reason)}
          onEditCorrection={(f, v) => {
            // لوحة حسابات التصحيح (R2): التعديل يبقي تنبيه «يوجد تقرير» ومربع السبب
            const cur = doc._edit || doc.analysis_result || {}
            const _edit = cur.invoices?.length === 1 ? { ...cur, invoices: [reviewedPayment(cur.invoices[0], { [f]: v })] } : { ...cur, [f]: v }
            updateDoc(doc.id, { _edit, _v2Error: doc._v2Error })
          }}
          onSaveDraft={() => saveDraftFor(doc)}
          canSaveDraft={!!uidRef.current}
          projName={isSuperAdmin ? (projMap[doc.project_id] || '') : ''}
          onLoadImage={() => loadImage(doc)}
          onAnalyze={() => analyze(doc)}
          onReread={() => reread(doc)}
          canReread={!isSuperAdmin && bankAccountsReady && ['accountant', 'superadmin'].includes(role)}
          onApprove={() => approve(doc)}
          onApproveForced={() => approve(doc, true)}
          onDupIgnore={() => askReject(doc)}
          onReject={() => askReject(doc)}
          onApproveInvoice={invIdx => approveInvoice(doc, invIdx)}
          onRejectInvoice={invIdx => rejectInvoice(doc, invIdx)}
          onEdit={(f, v) => {
            const cur = doc._edit || doc.analysis_result || {}
            const extra = f === 'transType' ? { _aiSuggestedType: false } : {}
            // إذا wrapped في invoices[0] — عدّل داخل المصفوفة مباشرة
            if (cur.invoices?.length === 1) {
              updateDoc(doc.id, { ...extra, _edit: { ...cur, invoices: [reviewedPayment(cur.invoices[0], { [f]: v })] } })
            } else {
              updateDoc(doc.id, { ...extra, _edit: reviewedPayment(cur, { [f]: v }) })
            }
          }}
          onEditInvoice={(invIdx, f, v) => {
            const cur = doc._edit || doc.analysis_result || {}
            const invoices = (cur.invoices || []).map((inv, i) => i === invIdx ? reviewedPayment(inv, { [f]: v }) : inv)
            updateDoc(doc.id, { _edit: { ...cur, invoices } })
          }}
          // استبدال فاتورة كاملة بتعديل واحد (عدة حقول معًا، مثل نسبة وسيلة دفع غير معروفة إلى قناة): invIdx null = الفاتورة الوحيدة
          onReplaceInvoice={(invIdx, next) => {
            const cur = doc._edit || doc.analysis_result || {}
            const old = invIdx != null ? cur.invoices?.[invIdx] : cur.invoices?.[0] || cur
            next = reviewedPayment(old, next)
            if (invIdx != null) updateDoc(doc.id, { _edit: { ...cur, invoices: (cur.invoices || []).map((inv, i) => i === invIdx ? next : inv) } })
            else if (cur.invoices?.length === 1) updateDoc(doc.id, { _edit: { ...cur, invoices: [next] } })
            else updateDoc(doc.id, { _edit: next })
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
            const today = fmtDate(new Date())
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
          setup={isSuperAdmin ? null : { settings: projectSettings, bankAccounts }}
          suppliers={suppliers}
          payableSuppliers={isSuperAdmin ? (payableSuppliersMap[doc.project_id] || []) : payableSuppliers}
          onBranchChange={b => updateDoc(doc.id, { branch: b, _dirty: true })}
          onSupplierChange={id => updateDoc(doc.id, { _supplierId: id, _dirty: true })}
          onSupplierNameChange={v => updateDoc(doc.id, { _supplierName: v, _supplierResolution: null, _matchedSupplierId: null, _dirty: true })}
          onSupplierResolve={(resolution, matchedId) => updateDoc(doc.id, { _supplierResolution: resolution, _matchedSupplierId: matchedId, _dirty: true })}
          onClearValidation={() => updateDoc(doc.id, { _validationError: null })}
          ROLE_AR={ROLE_AR}
          ROLE_COLOR={ROLE_COLOR}
        />
          </div>
          <div className="rp-image-col">
            <DocImagePanel doc={opened} isImage={isImage} onOpenFile={() => loadImage(opened)} />
          </div>
        </div>
        {rejectDialog}
        {leaveDialog}
      </div>
    )
  }

  return (
    <div>
      <div className="ts-heading">
        <div>
          <h1>مستندات جديدة</h1>
          <p>مرفوعة ولم تُعتمد بعد. اعتمادها يسجّلها في الدفتر.</p>
        </div>
        <div className="ts-heading-actions">
          {isSuperAdmin && !projectId && (
            <Select aria-label="المشروع" value={filterProjId} onChange={e => setFilterProjId(e.target.value)}
              options={[{ value: '', label: 'كل المشاريع' }, ...projects.map(p => ({ value: p.id, label: p.name }))]} />
          )}
          <Button icon={RefreshCw} onClick={refresh}>تحديث</Button>
        </div>
      </div>

      {listNotice && <Note tone="success" icon={Check} title={listNotice} action={<Button size="sm" variant="quiet" onClick={() => setListNotice('')}>إخفاء</Button>} />}
      <Panel clip>
        <div className="rp-toolbar">
          <Tabs label="الحالة" value={statusFilter} onChange={v => setFilter('status', v)} tabs={[
            { value: 'all', label: 'الكل', count: counts.all },
            { value: 'analyzed', label: 'مقروء', count: counts.analyzed },
            { value: 'uploaded', label: 'لم يُقرأ', count: counts.uploaded },
          ]} />
          <div className="rp-filters">
            <SearchBox label="بحث" value={q} onChange={v => setFilter('q', v)} placeholder="المورد، اسم الملف، المبلغ…" />
            <Select aria-label="رفعه" value={roleFilter} onChange={e => setFilter('by', e.target.value)}
              options={[{ value: 'all', label: 'كل الرافعين' }, ...Object.entries(ROLE_AR).map(([value, label]) => ({ value, label }))]} />
          </div>
          <div className="rp-results">
            <span><strong className="ts-num">{rows.length}</strong> من <span className="ts-num">{docs.length}</span></span>
            <span className="rp-vat-note">المبالغ كما في المستند (شاملة الضريبة)</span>
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={Inbox}>{docs.length ? 'لا مستندات تطابق البحث.' : 'لا توجد مستندات جديدة.'}</EmptyState>
        ) : (
          <>
            <table className="ts-table rp-table">
              <thead><tr><th>المستند</th><th>النوع</th><th>التاريخ</th><th className="ts-end">الإجمالي</th><th>الحالة</th><th>رفعه</th></tr></thead>
              <tbody>
                {rows.map(({ doc, sum }) => (
                  <tr key={doc.id} className="is-link" onClick={() => openDoc(doc.id)}>
                    <td><div className="rp-doc-main"><span className="rp-doc-icon"><FileText className="ts-icon" aria-hidden="true" /></span>
                      <div><button type="button" className="rp-link-cell" onClick={e => { e.stopPropagation(); openDoc(doc.id) }}><strong>{sum.name}</strong></button>
                        <small>{doc._dirty ? 'تعديلات لم تُحفظ' : doc._draftSavedAt ? 'مسودة محفوظة في هذه النافذة' : doc.file_name}</small></div></div></td>
                    <td><Chip>{sum.kind}</Chip></td>
                    <td>{sum.date || '—'}</td>
                    <td className="ts-end">{sum.total == null ? <span className="ts-muted">—</span> : <Money value={sum.total} />}</td>
                    <td><Status tone={STATUS[doc.status]?.tone || 'neutral'}>{STATUS[doc.status]?.label || doc.status}</Status></td>
                    <td>{ROLE_AR[doc.uploaded_by] || doc.uploaded_by || '—'}<small>منذ {timeAgo(doc.uploaded_at)}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="rp-cards">
              {rows.map(({ doc, sum }) => (
                <li key={doc.id}>
                  <button type="button" className="rp-card rp-card--button" onClick={() => openDoc(doc.id)}>
                    <div className="rp-card-top"><strong>{sum.name}</strong><Status tone={STATUS[doc.status]?.tone || 'neutral'}>{STATUS[doc.status]?.label || doc.status}</Status></div>
                    <div className="rp-card-meta"><Chip>{sum.kind}</Chip>{sum.date && <span className="ts-num">{sum.date}</span>}{(doc._dirty || doc._draftSavedAt) && <span>{doc._dirty ? 'تعديلات لم تُحفظ' : 'مسودة محفوظة'}</span>}</div>
                    <div className="rp-card-bottom">{sum.total == null ? <span className="ts-muted">لم يُقرأ بعد</span> : <Money value={sum.total} />}</div>
                    <div className="rp-card-meta">رفعه {ROLE_AR[doc.uploaded_by] || doc.uploaded_by || '—'} · منذ {timeAgo(doc.uploaded_at)}</div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
      {rejectDialog}
      {leaveDialog}
    </div>
  )
}

// صورة المستند: تُحمَّل برابط موقَّت كما في السابق، مع تكبير
function DocImagePanel({ doc, isImage, onOpenFile }) {
  const [zoom, setZoom] = useState(1)
  const src = doc._imageData ? (doc._isUrl ? doc._imageData : `data:${doc.file_type};base64,${doc._imageData}`) : null
  return (
    <Panel className="rp-image-panel" title="صورة المستند" icon={FileSearch}
      action={isImage && src ? (
        <div className="rp-image-tools">
          <IconButton label="تصغير" icon={ZoomOut} disabled={zoom <= 0.6} onClick={() => setZoom(z => Math.max(0.6, +(z - 0.2).toFixed(1)))} />
          <span className="rp-zoom ts-num">{Math.round(zoom * 100)}%</span>
          <IconButton label="تكبير" icon={ZoomIn} disabled={zoom >= 3} onClick={() => setZoom(z => Math.min(3, +(z + 0.2).toFixed(1)))} />
          <IconButton label="الحجم الأصلي" icon={Maximize2} onClick={() => setZoom(1)} />
        </div>
      ) : null}>
      <div className="rp-image-stage">
        {doc._loadingImg && <div className="ts-empty">جارٍ تحميل الصورة…</div>}
        {!doc._loadingImg && src && isImage && (
          <div className="rp-image-scale" style={{ transform: `scale(${zoom})` }}><img src={src} alt={doc.file_name} className="rp-doc-image" /></div>
        )}
        {!doc._loadingImg && src && !isImage && (
          <div className="ts-empty"><Button variant="primary" icon={FileText} onClick={() => { if (doc._isUrl) window.open(doc._imageData, '_blank'); else openPdfBlob(doc._imageData, doc.file_name) }}>فتح الملف</Button></div>
        )}
        {!doc._loadingImg && !src && <div className="ts-empty"><Button onClick={onOpenFile}>عرض الملف</Button></div>}
      </div>
    </Panel>
  )
}

function openPdfBlob(base64, fileName) {
  const bytes = atob(base64)
  const arr   = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  const blob = new Blob([arr], { type: 'application/pdf' })
  window.open(URL.createObjectURL(blob), '_blank')
}

// ── نموذج المراجعة ───────────────────────────────────────────────────────────
// الحقول نفسها ومسارات الاعتماد نفسها كما قبل التصميم الجديد؛ تغيّر العرض فقط.

const TYPE_OPTIONS = [
  { value: 'expense',  label: 'فاتورة مصروفات' },
  { value: 'sales',    label: 'مبيعات' },
  { value: 'transfer', label: 'تحويل' },
]
// «سداد مورد» (2026-10-20): في الاعتماد الجديد وحده؛ يخفض مستحق المورد مع القيد، أو يُرفق بدفعة مسجلة
const RECEIPT_OPTION = { value: RECEIPT_TYPE, label: 'سداد مورد' }
/** تغيير نوع الفاتورة إلى سداد أو منه يعيد حقول المراجعة مع بقاء المعرّف؛ undefined ⇒ تعديل النوع وحده؛ null ⇒ لا تغيير. */
const typeChange = (inv, v) => {
  if (v === LOAN_OPTION.value) return isLoanRepayment(inv) ? null : toLoanRepayment(inv)
  if (v === RECEIPT_TYPE) return isReceipt(inv) ? null : toReceipt(inv)
  if (isLoanRepayment(inv)) return fromLoanRepayment(inv, v)
  return isReceipt(inv) ? fromReceipt(inv, v) : undefined
}
const PAY_OPTIONS = [
  { value: 'cash',    label: 'الصندوق' },
  { value: 'bank',    label: 'البنك / مدى' },
  { value: 'custody', label: 'العهدة' },
  { value: 'payable', label: 'آجل — باسم المورد' },
]
const paymentOptions = (setup, current) => PAY_OPTIONS.filter(o => o.value !== 'custody' || !accountDashboard(setup?.settings) || current === 'custody').map(o => o.value === 'custody' && accountDashboard(setup?.settings) ? {...o,label:'عهدة موظف سابقة — ليست حساب العهدة البنكي'} : o)
const SALES_CHANNELS = [
  { key: 'cashSales',     label: 'نقدي' },
  { key: 'networkSales',  label: 'شبكة / مدى' },
  { key: 'transferSales', label: 'تحويل' },
  { key: 'hungerSales',   label: 'هنقر ستيشن' },
  { key: 'jahez',         label: 'جاهز' },
  { key: 'keeta',         label: 'كيتا' },
  { key: 'mrsool',        label: 'مرسول' },
]
const accountTransTypes = (types, setup) => types.filter(t => !accountDashboard(setup?.settings) || !t.includes('صرف عهدة'))
function HistoricalCustodyNote({invoice,setup}) {
  return accountDashboard(setup?.settings) && (invoice?.paySource==='custody' || invoice?.transType?.includes('صرف عهدة')) ? <Note tone="warning">هذه القراءة تستخدم عهدة الموظف السابقة، وليست حساب العهدة البنكي. لتمويل حساب العهدة اختر تحويلًا بين الحسابات البنكية، ولشراء مدفوع منه اختر البنك وحساب العهدة.</Note> : null
}
const TRANSFER_KINDS = t => t.includes('صرف عهدة') || t.includes('تحصيل ذمم') || t.includes('إيداع نقدي') || t.includes('تحويل داخلي')
const blankItem = () => ({ description: '', amount: '', category_main: '', category_sub: '' })

/** حقل مبلغ (src/lib/amountInput.js): أرقام لاتينية، ويقبل العربية ويحوّلها، ويرفض أي حرف آخر.
 *  كان type=number يعيد قيمة فارغة للمدخل غير الصالح فتُحسب صفرًا عند الاعتماد. */
const Num = React.forwardRef(function Num({ onChange, value, ...props }, ref) {
  return <Input ref={ref} numeric dir="ltr" placeholder="0.00" value={typeof value === 'number' ? value.toFixed(2) : value} {...props}
    onChange={e => { const v = acceptAmount(e.target.value); if (v !== null) onChange({ target: { value: v } }) }} />
})

function catOptions(list, current) {
  const opts = list.map(n => ({ value: n, label: n }))
  return current && !list.includes(current) ? [{ value: current, label: current }, ...opts] : opts
}

// ── الحساب البنكي (20261014140000): يظهر فقط لمنشأة بحسابات وحركة بنك؛ حساب وحيد متاح للفرع يُختار تلقائيًا (والخادم يفعل الشيء نفسه)
const BANK_CHANNELS = [{ k: 'network', field: 'networkSales', label: 'الشبكة' }, { k: 'transfer', field: 'transferSales', label: 'التحويل' }]
function BankAccountField({ invoice, branch, setup, onEdit }) {
  const accounts = setup?.bankAccounts || []
  if (isBankTransfer(invoice)) return <BankTransferFields invoice={invoice} accounts={accounts} settings={setup?.settings} onEdit={onEdit}/>
  branch = paymentBranch({ branch }, invoice, setup?.settings)
  if (!accounts.length || !needsBankAccount(invoice)) return null
  const list = eligibleBankAccounts(accounts, branch)
  const opts = list.map(a => ({ value: a.id, label: bankAccountLabel(a) }))
  const staleMsg = 'الحساب المختار سابقًا غير متاح لهذا الفرع؛ اختر من القائمة.'
  // تقرير المبيعات: حساب كل قناة بنكية يُقرأ ويُكتب في مكان واحد (bankAccounts.<القناة>، والعام احتياطي) — في الحقلين أو الحقل الواحد،
  // فما يظهر للمحاسب هو ما يُرسل ويُسجَّل، ولو صُفّرت قناة أو أُعيدت (R3-01)
  if (invoice?.type === 'sales') {
    const shown = BANK_CHANNELS.filter(c => Number(invoice?.[c.field] || 0) > 0)
    if (shown.length === 2 && list.length > 1) return shown.map(c => {
      const stored = salesChannelAccount(invoice, c.k), value = chosenBankAccount(accounts, branch, stored)
      return (
        <Field key={c.k} label={`حساب ${c.label}`} error={stored && stored !== value ? staleMsg : undefined} hint={`الحساب البنكي الذي دخلته مبيعات ${c.label}.`}>
          <Select value={value} placeholder="— اختر الحساب —" data-k={`bank-account-${c.k}`}
            onChange={e => onEdit('bankAccounts', withSalesChannelAccount(invoice, [c.k], e.target.value))} options={opts} />
        </Field>
      )
    })
    const keys = shown.map(c => c.k)
    const stored = keys.map(k => salesChannelAccount(invoice, k))
    const value = chosenBankAccount(accounts, branch, stored[0])
    const stale = stored.some(x => x && x !== value) || new Set(stored.filter(Boolean)).size > 1
    return (
      <Field label="الحساب البنكي" error={!list.length ? `لا حساب بنكي مربوط بفرع «${branch || ''}».` : stale ? staleMsg : undefined}
        hint={list.length === 1 ? 'الحساب الوحيد المتاح لهذا الفرع.' : branch ? `الحسابات المربوطة بفرع «${branch}».` : 'اختر الفرع أولًا لتظهر حساباته.'}>
        <Select value={value} placeholder="— اختر الحساب —" data-k="bank-account" onChange={e => onEdit('bankAccounts', withSalesChannelAccount(invoice, keys, e.target.value))} options={opts} />
      </Field>
    )
  }
  const value = chosenBankAccount(accounts, branch, invoice?.bankAccountId)
  const accountNote = bankOperationalNote(setup?.settings, value)
  const stale = invoice?.bankAccountId && invoice.bankAccountId !== value
  // مصروف على مستوى المنشأة: حسابات المنشأة كلها، بلا ذكر فرع
  const projectWide = !branch && invoice?.type === 'expense' && expensesAtProjectLevel(setup?.settings)
  return (
    <Field label="الحساب البنكي" error={!list.length ? (projectWide ? 'لا حساب بنكي نشط للمنشأة.' : `لا حساب بنكي مربوط بفرع «${branch || ''}».`) : stale ? staleMsg : undefined}
      hint={accountNote || (projectWide ? (list.length === 1 ? 'الحساب الوحيد للمنشأة.' : 'حسابات المنشأة (المصروف على مستوى المنشأة، لا فرع).')
        : list.length === 1 ? 'الحساب الوحيد المتاح لهذا الفرع.' : branch ? `الحسابات المربوطة بفرع «${branch}».` : 'اختر الفرع أولًا لتظهر حساباته.')} >
      <Select value={value} placeholder="— اختر الحساب —" data-k="bank-account" onChange={e => onEdit('bankAccountId', e.target.value)} options={opts} />
    </Field>
  )
}

// ── حساب فرق كل قناة بنكية في تصحيح تقرير المبيعات (R2): القناة القائمة على حسابها الأصلي (من قيود التقرير، يرسلها الخادم في
// التنبيه)، والجديدة على حسابها المختار هنا. لا يُنقل فرق قناة قائمة إلى حساب آخر.
function CorrectionAccounts({ linked, invoice, branch, setup, onEdit }) {
  const accounts = setup?.bankAccounts || []
  if (!accounts.length || !linked?.accounts || !invoice) return null
  const list = eligibleBankAccounts(accounts, branch)
  const rows = BANK_CHANNELS.map(c => {
    const oldV = Number(linked.current?.[c.k] || 0), newV = Number(invoice[c.field] || 0), a = linked.accounts[c.k] || {}
    if (oldV === newV) return null
    const delta = `${newV > oldV ? '+' : '−'}${money(Math.abs(newV - oldV))}`
    if (Number(a.old || 0) !== 0 || Number(a.total || 0) !== 0) {
      if (!a.account) return <li key={c.k} data-k={`corr-${c.k}`} className="rp-corr-warn">{c.label}: قيود هذه القناة في التقرير الموجود لا تثبت رقمه أو موزعة على أكثر من حساب؛ يتوقف التصحيح لمراجعتها.</li>
      return <li key={c.k} data-k={`corr-${c.k}`}>{c.label} {delta}: على «{a.account_name}» — حساب المبلغ الأصلي</li>
    }
    return (
      <li key={c.k} data-k={`corr-${c.k}`}>
        <Field label={`حساب ${c.label} (قناة جديدة في التقرير، ${delta})`}>
          <Select value={chosenBankAccount(accounts, branch, salesChannelAccount(invoice, c.k))} placeholder="— اختر الحساب —" data-k={`corr-account-${c.k}`}
            onChange={e => onEdit('bankAccounts', withSalesChannelAccount(invoice, [c.k], e.target.value))}
            options={list.map(x => ({ value: x.id, label: bankAccountLabel(x) }))} />
        </Field>
      </li>
    )
  }).filter(Boolean)
  if (!rows.length) return null
  return <Panel title="الحساب البنكي لفروق التصحيح" icon={Info}><ul className="rp-corr-accounts">{rows}</ul></Panel>
}

// ── تقرير المبيعات كما قُرئ (src/lib/salesReport.js) ────────────────────────────
// أسطر وسائل الدفع بقنواتها، والمرتجعات، والإجمالي المطبوع والفرق، ووسائل الدفع غير المعروفة: تُنسب لقناة أو تُستبعد بسبب، ولا تُهمل.
function SalesReading({ invoice, onEdit, onReplace, readOnly }) {
  const [choice, setChoice] = useState({})
  const check = salesReportCheck(invoice)
  const b = invoice?.salesBreakdown
  const unknown = invoice?.unknownPayments || []
  const rows = b ? CHANNELS.filter(c => b.gross[c] || b.returns[c]) : []
  return (
    <div className="rp-sales-reading" data-k="sales-reading">
      {b && (
        <table className="rp-table rp-sales-channels" data-k="sales-channels">
          <thead><tr><th>القناة</th><th className="ts-end">قبل المرتجعات</th><th className="ts-end">المرتجعات</th><th className="ts-end">الصافي حسب القراءة</th></tr></thead>
          <tbody>{rows.map(c => (
            <tr key={c} data-channel={c}><td>{CHANNEL_NAME[c]}</td><td className="ts-end"><Money value={b.gross[c]} /></td>
              <td className="ts-end">{b.returns[c] ? <Money value={-b.returns[c]} /> : '—'}</td><td className="ts-end"><Money value={b.gross[c] - b.returns[c]} /></td></tr>
          ))}</tbody>
          <tfoot><tr data-k="sales-channels-total"><td>المجموع</td><td className="ts-end"><Money value={b.grossTotal} /></td>
            <td className="ts-end">{b.returnsTotal ? <Money value={-b.returnsTotal} /> : '—'}</td><td className="ts-end"><Money value={b.grossTotal - b.returnsTotal} /></td></tr></tfoot>
        </table>
      )}
      {b && (b.lines.length > 0 || b.returnLines.length > 0) && (
        <details className="rp-sales-lines" data-k="sales-lines">
          <summary>أسطر وسائل الدفع كما قُرئت من التقرير (<span className="ts-num">{b.lines.length + b.returnLines.length}</span>)</summary>
          <ul>
            {b.lines.map((l, i) => <li key={'p' + i}>«{l.label}» <span className="ts-num">{money(l.amount)}</span> ← {l.channel ? CHANNEL_NAME[l.channel] : 'غير معروفة'}</li>)}
            {b.returnLines.map((l, i) => <li key={'r' + i}>مرتجع «{l.label}» <span className="ts-num">−{money(l.amount)}</span> ← {l.channel ? CHANNEL_NAME[l.channel] : 'غير معروفة'}</li>)}
          </ul>
        </details>
      )}
      {unknown.map((u, i) => {
        const c = choice[i] || {}
        const apply = () => { onReplace?.(resolveUnknownPayment(invoice, i, c.channel === 'exclude' ? null : c.channel, c.reason, c.amount)); setChoice({}) }
        // سطر بلا مبلغ مقروء: نسبته تتطلب مبلغه من التقرير (موجبًا)
        const needsAmount = u.unreadable && c.channel && c.channel !== 'exclude'
        const amountOk = !needsAmount || Number(String(c.amount || '').replace(/,/g, '')) > 0
        return (
          <Note key={i} tone="warning" icon={CircleAlert} title={u.unreadable ? `سطر بلا مبلغ مقروء (${u.kind === 'return' ? 'مرتجع' : 'وسيلة دفع'}): «${u.label || '—'}»`
            : `${u.kind === 'return' ? 'مرتجع بوسيلة' : 'وسيلة دفع'} غير معروفة: «${u.label || '—'}» ${money(u.amount)}`}>
            <div className="ts-form-grid" data-k="unknown-payment" data-index={i}>
              <Field label="انسبها إلى">
                <Select value={c.channel || ''} placeholder="— اختر —" disabled={readOnly} data-k={`unknown-channel-${i}`}
                  onChange={e => setChoice({ ...choice, [i]: { ...c, channel: e.target.value } })}
                  options={[...CHANNELS.map(k => ({ value: k, label: CHANNEL_NAME[k] })), { value: 'exclude', label: 'ليست وسيلة دفع (استبعاد)' }]} />
              </Field>
              {c.channel === 'exclude' && (
                <Field label="سبب الاستبعاد"><Input value={c.reason || ''} data-k={`unknown-reason-${i}`} onChange={e => setChoice({ ...choice, [i]: { ...c, reason: e.target.value } })} /></Field>
              )}
              {needsAmount && (
                <Field label="المبلغ من التقرير"><Num value={c.amount || ''} data-k={`unknown-amount-${i}`} onChange={e => setChoice({ ...choice, [i]: { ...c, amount: e.target.value } })} /></Field>
              )}
              <Button size="sm" disabled={readOnly || !c.channel || !amountOk || (c.channel === 'exclude' && !String(c.reason || '').trim())} data-k={`unknown-apply-${i}`} onClick={apply}>تطبيق</Button>
            </div>
          </Note>
        )
      })}
      {(invoice?.resolvedPayments || []).length > 0 && (
        <ul className="rp-sales-resolved" data-k="sales-resolved">
          {invoice.resolvedPayments.map((r, i) => <li key={i}>«{r.label}» {r.amount == null ? 'بلا مبلغ' : money(r.amount)}{r.unreadable ? ' (كان غير مقروء)' : ''} ← {r.channel ? CHANNEL_NAME[r.channel] : `مستبعدة: ${r.reason}`}</li>)}
        </ul>
      )}
      <div className="rp-totals">
        <Field label="إجمالي التقرير المطبوع شامل الضريبة (بعد المرتجعات)"
          error={check.total == null && Number(invoice?.salesReadingVersion) >= 2 ? 'مطلوب: اكتبه من التقرير (Net sales with tax، لا قبل الضريبة) ليُطابق وسائل الدفع.' : undefined}
          hint={check.total == null && !(Number(invoice?.salesReadingVersion) >= 2) ? 'لم يُقرأ إجمالي مطبوع: اكتبه من التقرير ليُطابق قبل الاعتماد.' : undefined}>
          <Num value={invoice?.totalSales ?? ''} data-k="sales-printed-total" disabled={readOnly} onChange={e => onEdit('totalSales', e.target.value)} />
        </Field>
        {check.diff != null && (
          <div className={`rp-total-row${check.diff ? ' rp-total-row--warn' : ''}`} data-k="sales-diff"><span>الفرق بين وسائل الدفع والإجمالي</span><Money value={check.diff} /></div>
        )}
      </div>
      {!check.ok && <Note tone="error" icon={CircleAlert} title="لا يُعتمد التقرير قبل تفسير هذا">{check.reasons.map((r, i) => <div key={i} data-k="sales-reason">{r}</div>)}</Note>}
    </div>
  )
}

// ── بند ──────────────────────────────────────────────────────────────────────
// فاتورة ببند واحد (categoryMainFromType مُمرَّر): الأب ثابت من تصنيف الفاتورة العام.
// فاتورة متعددة البنود (categoryMainFromType === undefined): كل بند يختار تصنيفه الأساسي بنفسه.
// onEdit يستقبل كائن تصحيح (patch) — يسمح بتحديث حقلين معاً بنداء واحد ذرّي (مثل تصفير
// category_sub عند تغيير category_main دون تسلسل نداءات يتصادم على نفس الإغلاق القديم).
function ItemRow({ item, index, categories, onEdit, onDelete, categoryMainFromType, discounts }) {
  const allCats     = categories || []
  const parentCats  = allCats.filter(c => !c.parent_id)
  const independentMode = categoryMainFromType === undefined
  const mainValue   = independentMode ? (item.category_main || '') : (categoryMainFromType || '')
  const parentCat   = parentCats.find(p => normCat(p.name) === normCat(mainValue))
  const itemSubs    = parentCat ? allCats.filter(c => c.parent_id === parentCat.id) : []
  const subValue    = item.category_sub || ''
  const n = index + 1
  const remove = cls => (
    <button type="button" className={`rp-line-remove ${cls}`} onClick={onDelete} aria-label={`حذف البند ${n}`}>
      <Trash2 className="ts-icon--sm" aria-hidden="true" /><span>حذف</span>
    </button>
  )
  return (
    <div className={`rp-line rp-line--doc${independentMode ? ' has-main' : ''}${discounts ? ' has-disc' : ''}`}>
      <div className="rp-line-top"><span>البند <span className="ts-num">{n}</span></span>{remove('rp-line-remove--top')}</div>
      <label className="rp-cell rp-cell--name"><span className="rp-cell-label">الوصف</span>
        <Input value={item.description || ''} placeholder="وصف البند" aria-label={`وصف البند ${n}`}
          onChange={e => onEdit({ description: e.target.value })} />
        {item._dictionary === 'active' && item.category_main ? <small className="rp-dict-tag">من قاموس الأصناف</small>
          : item._dictionary === 'review' && !item.category_main ? <small className="rp-dict-tag rp-dict-tag--review" title={item._dictionaryNote || undefined}>للمراجعة في القاموس: اختر التصنيف</small> : null}</label>
      {independentMode && (
        <label className="rp-cell"><span className="rp-cell-label">التصنيف الأساسي</span>
          <Select value={mainValue} placeholder="— اختر —" aria-label={`التصنيف الأساسي للبند ${n}`}
            onChange={e => onEdit({ category_main: e.target.value, category_sub: '' })}
            options={catOptions(parentCats.filter(p => p.is_active !== false).map(p => p.name), mainValue)} /></label>
      )}
      <label className="rp-cell"><span className="rp-cell-label">التصنيف الفرعي</span>
        <Select value={subValue} placeholder="— اختر —" aria-label={`التصنيف الفرعي للبند ${n}`}
          onChange={e => onEdit({ category_sub: e.target.value })}
          options={catOptions(itemSubs.length ? itemSubs.filter(s => s.is_active !== false).map(s => s.name) : ['أخرى'], subValue)} /></label>
      {discounts && (
        <label className="rp-cell rp-cell--amount"><span className="rp-cell-label">خصم البند</span>
          <Num value={item.discount ?? ''} placeholder="0" aria-label={`خصم البند ${n}`} onChange={e => onEdit({ discount: e.target.value })} /></label>
      )}
      <label className="rp-cell rp-cell--amount"><span className="rp-cell-label">{discounts ? 'المبلغ بعد الخصم' : 'المبلغ شامل الضريبة'}</span>
        <Num value={item.amount ?? ''} aria-label={`مبلغ البند ${n}`} onChange={e => onEdit({ amount: e.target.value })} /></label>
      {remove('rp-line-remove--desk')}
    </div>
  )
}

function ItemLines({ items, independent, categories, transType, onEditItem, onDeleteItem, onAddItem, discounts }) {
  return (
    <div className="rp-lines rp-lines--doc">
      {items.length > 0 && (
        <div className={`rp-line rp-line--doc rp-line-head${independent ? ' has-main' : ''}${discounts ? ' has-disc' : ''}`} aria-hidden="true">
          <span>الوصف</span>{independent && <span>التصنيف الأساسي</span>}<span>التصنيف الفرعي</span>
          {discounts && <span className="rp-line-total">خصم البند</span>}<span className="rp-line-total">{discounts ? 'المبلغ بعد الخصم' : 'المبلغ شامل الضريبة'}</span><span />
        </div>
      )}
      {items.map((item, i) => (
        <ItemRow key={i} item={item} index={i} categories={categories}
          categoryMainFromType={independent ? undefined : normCat(transType || '')} discounts={discounts}
          onEdit={patch => onEditItem(i, patch)} onDelete={() => onDeleteItem(i)} />
      ))}
      <div><Button size="sm" icon={Plus} onClick={onAddItem}>إضافة بند</Button></div>
    </div>
  )
}

function ExpenseBasis({ invoice, onEdit, readOnly }) {
  return <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
    <Segment label="أساس مبالغ البنود" value={invoice.amountsBasis === 'exclusive' ? 'exclusive' : 'inclusive'}
      onChange={v => onEdit('amountsBasis', v)}
      options={[{ value: 'inclusive', label: 'البنود شاملة الضريبة' }, { value: 'exclusive', label: 'البنود قبل الضريبة' }]} />
  </fieldset>
}

function ItemsTotals({ check, exact, res, onEdit, onReplace, readOnly }) {
  const id = useId()
  const totalKey = res.totalAmount != null ? 'totalAmount' : 'amount'
  const suggestedBasis = exact ? expenseBasisSuggestion(res) : null
  if (exact) return (
    <div className="rp-totals">
      <ExpenseReadingHelp invoice={res} exact={exact} onReplace={onReplace} readOnly={readOnly}/>
      {exact.status !== 'none' && (
        <div className="rp-total-row"><span>{exact.basis === 'exclusive' ? 'مجموع البنود قبل الضريبة' : 'مجموع البنود'}</span><Money value={exact.itemsTotal / 100} /></div>
      )}
      <div className="rp-total-row">
        <label htmlFor={`${id}-disc`}>خصم على إجمالي الفاتورة <small className="ts-field-hint">يُوزَّع على البنود بنسبة مبالغها</small></label>
        <Num id={`${id}-disc`} disabled={readOnly} value={res.invoiceDiscount ?? ''} placeholder="0" onChange={e => onEdit('invoiceDiscount', e.target.value)} />
      </div>
      <div className="rp-total-row">
        <label htmlFor={`${id}-vat`}>{exact.basis === 'exclusive' ? 'ضريبة القيمة المضافة' : 'منها ضريبة القيمة المضافة'} <small className="ts-field-hint">كما في المستند</small></label>
        <Num id={`${id}-vat`} disabled={readOnly} value={res.vatAmount || ''} onChange={e => onEdit('vatAmount', e.target.value)} />
      </div>
      <div className="rp-total-row rp-total-row--strong">
        <label htmlFor={`${id}-total`}>إجمالي المستند <small className="ts-field-hint">شامل الضريبة</small></label>
        <Num id={`${id}-total`} disabled={readOnly} value={res.totalAmount ?? res.amount ?? ''} onChange={e => onEdit(totalKey, e.target.value)} />
      </div>
      {exact.status === 'match' && (
        <div className="rp-total-row rp-total-row--ok"><span>{[exact.basis === 'exclusive' ? 'البنود' : 'مجموع البنود', exact.discount ? '− الخصم' : '', exact.basis === 'exclusive' ? '+ الضريبة' : ''].filter(Boolean).join(' ')} = الإجمالي، بالهللة</span><Check className="ts-icon--sm" aria-hidden="true" /></div>
      )}
      {exact.status === 'mismatch' && (
        <div className="rp-total-row rp-total-row--diff" role="status">
          <span>فرق غير مفسّر: البنود {exact.diff > 0 ? 'تزيد' : 'تنقص'} عن الإجمالي. طابق مبالغ البنود وخصوماتها والضريبة مع المستند؛ لا يُعتمد بفرق</span><Money value={Math.abs(exact.diff) / 100} />
        </div>
      )}
      {exact.status === 'mismatch' && (suggestedBasis ? (
        <Note tone="warning" title="راجع أساس مبالغ البنود في صورة الفاتورة"
          action={<Button size="sm" disabled={readOnly} onClick={() => onEdit('amountsBasis', suggestedBasis)}>
            {suggestedBasis === 'exclusive' ? 'تأكيد أن البنود قبل الضريبة' : 'تأكيد أن البنود شاملة الضريبة'}
          </Button>}>
          {suggestedBasis === 'exclusive'
            ? 'مجموع البنود بعد خصم الفاتورة، مضافًا إليه الضريبة، يطابق الإجمالي بالهللة. إن كانت البنود مطبوعة قبل الضريبة، أكّد ذلك دون تغيير الأرقام.'
            : 'مجموع البنود بعد خصم الفاتورة يطابق الإجمالي بالهللة دون إضافة الضريبة مرة أخرى. إن كانت البنود مطبوعة شاملة الضريبة، أكّد ذلك دون تغيير الأرقام.'}
        </Note>
      ) : <Note tone="warning" title="طابق كل صنف مرة واحدة">
        قد يظهر سعر الوحدة والمبلغ قبل الضريبة والإجمالي في أسطر متتابعة للصنف نفسه. تأكد أنها لم تُقرأ كبنود إضافية، وأن مبلغ البند هو إجمالي الكمية لا سعر الوحدة. لا تضف بندًا لتغطية الفرق.
      </Note>)}
      {exact.status === 'invalid' && (
        <div className="rp-total-row rp-total-row--diff" role="status"><span>في المبالغ قيمة غير صالحة (رقم بأكثر من هللتين أو نص).</span></div>
      )}
    </div>
  )
  return (
    <div className="rp-totals">
      {check.status !== 'none' && <div className="rp-total-row"><span>مجموع البنود</span><Money value={check.itemsTotal} /></div>}
      <div className="rp-total-row">
        <label htmlFor="rv-vat">منها ضريبة القيمة المضافة <small className="ts-field-hint">كما في المستند</small></label>
        <Num id="rv-vat" value={res.vatAmount || ''} onChange={e => onEdit('vatAmount', e.target.value)} />
      </div>
      <div className="rp-total-row rp-total-row--strong">
        <label htmlFor="rv-total">إجمالي المستند <small className="ts-field-hint">يُسجَّل في القيد</small></label>
        <Num id="rv-total" value={res.totalAmount ?? res.amount ?? ''} onChange={e => onEdit(totalKey, e.target.value)} />
      </div>
      {check.status === 'match' && (
        <div className="rp-total-row rp-total-row--ok"><span>مجموع البنود يطابق الإجمالي</span><Check className="ts-icon--sm" aria-hidden="true" /></div>
      )}
      {check.status === 'net-basis' && (
        <div className="rp-total-row rp-total-row--warn" role="status">
          <span>البنود مقروءة قبل الضريبة: مجموعها + الضريبة = الإجمالي. المعتاد أن تكون شاملة الضريبة — طابقها مع الصورة.</span>
        </div>
      )}
      {check.status === 'mismatch' && (
        <div className="rp-total-row rp-total-row--diff" role="status">
          <span>البنود {check.diff > 0 ? 'تزيد' : 'تنقص'} عن الإجمالي بمقدار</span><Money value={Math.abs(check.diff)} />
        </div>
      )}
    </div>
  )
}

const LINK_REASON = { same_number_other_supplier: 'الرقم نفسه لمورد آخر', same_supplier_date_total: 'المورد واليوم والمبلغ نفسها',
  legacy_entry_match: 'قيد مسجّل سابقًا بالتاريخ والمبلغ والمورد نفسها' }
function V2Error({ err, busy, onReject, onDupConfirm, onCorrectSales }) {
  const [reason, setReason] = useState('')
  if (!err) return null
  const l = err.linked
  const facts = l ? [
    l.reason && { label: 'سبب التشابه', value: LINK_REASON[l.reason] || l.reason },
    l.file_name && { label: 'المستند المرتبط', value: l.file_name },
    l.supplier_label && { label: 'المورد', value: l.supplier_label },
    l.journal_number && { label: 'القيد', value: <span className="ts-num">{l.journal_number}</span> },
    l.invoice_date && { label: 'التاريخ', value: <span className="ts-num">{l.invoice_date}</span> },
    l.total != null && { label: 'المبلغ', value: <Money value={l.total} /> },
    l.current && { label: 'أرقام التقرير الموجود', value: <span className="ts-num">نقدي {money(l.current.cash)} · شبكة {money(l.current.network)}</span> },
  ].filter(Boolean) : null
  const warn = ['suspected_duplicate', 'sales_report_exists', 'no_change', 'stale', 'invoice_already_decided'].includes(err.code)
  const reasonBox = (label, cta, onGo) => (
    <div className="rp-v2-decision">
      <Field label={label}><Textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <div className="rp-note-actions">
        <Button size="sm" variant="primary" disabled={busy || !reason.trim()} onClick={() => onGo(reason.trim())}>{cta}</Button>
        <Button size="sm" variant="quiet" icon={Ban} onClick={onReject}>رفض المستند</Button>
      </div>
    </div>
  )
  return (
    <Note tone={warn ? 'warning' : 'error'} icon={CircleAlert} title={approvalMessage(err)} facts={facts}
      action={err.code === 'suspected_duplicate' ? reasonBox('لماذا ليس مكررًا؟ (يُحفظ مع الاعتماد)', 'ليس مكررًا — اعتماد', r => onDupConfirm(err.invoice_id, r, l))
        : err.code === 'sales_report_exists' ? reasonBox('سبب تصحيح التقرير الموجود', 'تصحيح التقرير الموجود', r => onCorrectSales(r))
        : ['duplicate_invoice', 'no_change', 'sales_report_exists_legacy'].includes(err.code)
          ? <div className="rp-note-actions"><Button size="sm" variant="quiet" icon={Ban} onClick={onReject}>رفض المستند</Button></div> : null} />
  )
}

// القراءات المستبدلة بإعادة القراءة، للمراجعة (approval_private.document_readings)
function PreviousReadings({ docId, refreshKey }) {
  const [list, setList] = useState(null)
  useEffect(() => {
    let on = true
    supabase.rpc('document_readings', { p_document_id: docId }).then(({ data }) => { if (on) setList(data?.ok ? data.readings : []) }, () => { if (on) setList([]) })
    return () => { on = false }
  }, [docId, refreshKey])
  if (!list?.length) return null
  const total = inv => inv.totalAmount ?? inv.amount ?? inv.totalSales ?? '—'
  return <details className="rp-prev-readings" data-k="previous-readings">
    <summary>القراءات السابقة ({list.length})</summary>
    {list.map(r => <div key={r.id} data-k="previous-reading">
      <strong>{new Date(r.replaced_at).toLocaleString('ar-SA-u-ca-gregory-nu-latn')} — استُبدلت بإعادة قراءة من {r.replaced_by_name}</strong>
      <ul>{(r.reading?.invoices || [r.reading]).filter(Boolean).map((inv, i) => <li key={i}>
        {inv.description || inv.transType || inv.type || 'فاتورة'} · {inv.date || 'بلا تاريخ'} · الإجمالي <span className="ts-num">{total(inv)}</span>
        {inv.vatAmount != null && <> · الضريبة <span className="ts-num">{inv.vatAmount}</span></>} · البنود <span className="ts-num">{inv.items?.length || 0}</span></li>)}</ul>
    </div>)}
  </details>
}

function DocCard({ readOnly, onReread, canReread, v2, onManualApprove, onDupConfirm, onCorrectSales, onEditCorrection, doc, projName, onAnalyze, onApprove, onApproveForced, onDupIgnore, onReject, onSaveDraft, canSaveDraft, onEdit, onEditInvoice, onReplaceInvoice, onEditItem, onDeleteItem, onAddItem, onAddInvoice, onApproveInvoice, onRejectInvoice, onBranchChange, onSupplierChange, onSupplierNameChange, onSupplierResolve, onClearValidation, transTypes, categories, branches, setup, suppliers, payableSuppliers }) {
  const [manualIndex, setManualIndex] = useState(null)
  const [rereadOpen, setRereadOpen] = useState(false)
  const rawRes        = doc._edit || doc.analysis_result
  const isMultiInvoice = rawRes?.invoices?.length > 1
  const res           = isMultiInvoice ? null : (rawRes?.invoices?.[0] ?? rawRes)
  const busy          = ['analyzing','approving','rejecting','rereading'].includes(doc._state)
  const analyzed      = doc.status === 'analyzed' || doc._state === 'analyzed'
  // إعادة القراءة ممنوعة متى حُسمت فاتورة من الصورة (اعتُمدت أو استُبعدت)؛ والخادم يرفضها أيضًا
  const rereadBlocked = (v2?.invoices || []).some(i => i.status !== 'pending') ? 'اعتُمدت أو استُبعدت فاتورة من هذه الصورة؛ لا تُعاد قراءتها.' : null

  const parentCats     = categories.filter(c => !c.parent_id)
  const isSales        = res?.type === 'sales'
  const isLoan         = !!v2 && isLoanRepayment(res)
  const isExpenseItems = res?.type === 'expense' && res.items?.length > 0
  const itemCount       = isExpenseItems ? res.items.length : 0
  const isFutureDate    = res?.date && res.date > fmtDate(new Date())

  // "نوع المستند = تحويل" مخصص فقط للتحويلات الداخلية الحقيقية — قصر خيارات "التصنيف الأساسي"
  // على الأنواع التحويلية فقط، مع الحفاظ على أي قيمة محفوظة سابقاً حتى لو لم تعد ضمن الفلتر
  const isTransferDoc      = res?.type === 'transfer'
  const filteredTransTypes = isTransferDoc ? [...new Set([...accountTransTypes(transTypes,setup).filter(TRANSFER_KINDS), ...(paymentWorkflow(setup?.settings) ? [BANK_TRANSFER_TYPE] : [])])] : accountTransTypes(transTypes,setup)

  // مقارنة على الأساس نفسه (src/lib/documentTotals.js): البنود شاملة الضريبة مع الإجمالي الشامل،
  // والبنود المقروءة قبل الضريبة تُميَّز عن البند الناقص بدل أن تُعرض نقصًا بقيمة الضريبة
  const totalsCheck = res && res.type === 'expense' ? compareItemsToTotal(res) : { status: 'none', itemsTotal: 0, total: 0, vat: 0, diff: 0 }
  const salesTotal  = SALES_CHANNELS.reduce((s, c) => s + (Number(res?.[c.key]) || 0), 0)

  // الأولوية: transType أولاً، ثم category_main كـ fallback للمستندات القديمة
  const selectedParent = parentCats.find(p =>
    normCat(p.name) === normCat(res?.transType || '') ||
    p.name === (res?.category_main || '') ||
    normCat(p.name) === normCat(res?.category_main || '')
  )
  const subCats     = selectedParent ? categories.filter(c => c.parent_id === selectedParent.id) : []
  const resolvedSub = subCats.find(s => s.name === (res?.category_sub || '') || normCat(s.name) === normCat(res?.category_sub || ''))?.name || (res?.category_sub || '')

  // مطابقة اسم المورد — فقط لفواتير "آجل"، تُعاد حسبتها حياً مع كل تعديل بالاسم
  const isPayable      = res?.paySource === 'payable'
  const [receiptCtx, setReceiptCtx] = useState({})   // معرّف الإيصال ← رصيد المورد ودفعاته (supplier_payment_context)
  const onReceiptContext = id => c => setReceiptCtx(m => ({ ...m, [id]: c }))
  // الاعتماد الجديد يرسل اسم invoiceSupplierContext (وفيه الوصف بديلًا)، فيُعرض ويُطابق الاسم نفسه الذي سيُسجَّل عليه الآجل
  const supplierName   = doc._supplierName ?? res?.supplier_name ?? (v2 ? res?.description ?? '' : '')
  const supplierMatch  = isPayable && supplierName.trim()
    ? matchSupplier(supplierName, payableSuppliers || [])
    : { matchType: 'none', supplier: null }
  const needsSupplierConfirm = isPayable && supplierMatch.matchType === 'fuzzy' && !doc._supplierResolution
  const vErr = doc._validationError || {}
  const isStub = [doc.analysis_result, rawRes, ...(rawRes?.invoices || [])].some(r => r?._localStub)
  // الاعتماد الجديد: فحص الهللة يمنع الاعتماد بفرق غير مفسّر، وحالة كل فاتورة من الخادم
  const isV2 = !!v2
  const paused = v2?.mode === 'paused'
  const preparing = isV2 && analyzed && v2.version == null
  const canManual = !!onManualApprove && !readOnly && isV2 && !paused && !preparing && !busy
  const invStatus = id => v2?.invoices?.find(i => i.id === id)
  const exact = isV2 && res?.type === 'expense' ? exactTotals(res) : null
  const amountsBlocked = !!exact ? (exact.status === 'mismatch' || exact.status === 'invalid')
    : isV2 && isMultiInvoice && rawRes.invoices.some(x => (invStatus(x._id)?.status ?? 'pending') === 'pending'
      && x.type === 'expense' && x.items?.length && ['mismatch', 'invalid'].includes(exactTotals(x).status))
  // الآجل لكل فاتورة في الصورة متعددة الفواتير: مورد من القائمة مطلوب، والاسم المشابه لمورد مسجل يُؤكَّد قبل الاعتماد
  const supplierBlocked = isMultiInvoice && rawRes.invoices.some(x => (!isV2 || (invStatus(x._id)?.status ?? 'pending') === 'pending') && (() => {
    const ctx = invoiceSupplierContext(null, x, true)
    return !!supplierBlockReason(x, ctx, x.paySource === 'payable' && ctx.name ? matchSupplier(ctx.name, payableSuppliers || []) : null)
  })())
  // إيصال سداد مورد (2026-10-20): مورد ومبلغ وتاريخ، ومصدر دفعة جديدة أو دفعة مربوطة، قبل الاعتماد
  const serverDup = id => (id && doc._receiptDup?.[id]) || (doc._v2Error?.code === 'payment_possible_duplicate' && (!doc._v2Error.invoice_id || doc._v2Error.invoice_id === id) ? doc._v2Error : null)
  const receiptBlocked = isMultiInvoice
    ? rawRes.invoices.find(x => (!isV2 || (invStatus(x._id)?.status ?? 'pending') === 'pending') && receiptBlockReason(x, receiptCtx[x._id], serverDup(x._id))) ? 'في الصورة إيصال سداد غير مكتمل أو مشتبه بتكراره: افتحه وأكمل المورد وطريقة الاعتماد أو سبب الاشتباه.' : null
    : receiptBlockReason(res, receiptCtx[res?._id], serverDup(res?._id))
  const loanBlocked = isV2 && (isMultiInvoice
    ? rawRes.invoices.filter(x => (invStatus(x._id)?.status ?? 'pending') === 'pending').map(x => loanBlockReason(x, transTypes)).find(Boolean)
    : loanBlockReason(res, transTypes))
  // سبب عودة المستند للمراجعة (حُذفت دفعته بعد اعتماده)، ظاهر مهما كان النوع المعروض
  const reopenedNote = !isMultiInvoice ? receiptHistoryNote(invStatus(res?._id)?.history) : null
  // تقرير المبيعات (src/lib/salesReport.js): وسيلة دفع غير معروفة أو فرق مع الإجمالي المطبوع أو مرتجع أكبر من قناته يمنع الاعتماد
  const salesCheck = isSales ? salesReportCheck(res) : null
  const salesBlocked = (salesCheck && !salesCheck.ok) || (isMultiInvoice && rawRes.invoices.some(x => x.type === 'sales'
    && (!isV2 || (invStatus(x._id)?.status ?? 'pending') === 'pending') && !salesReportCheck(x).ok))
  const pendingCount = isMultiInvoice ? rawRes.invoices.filter(x => !isV2 || (invStatus(x._id)?.status ?? 'pending') === 'pending').length : 0
  // قرار معلّق في التنبيه (تكرار، أو اشتباه بلا سبب، أو تقرير مبيعات موجود): الاعتماد يمر من التنبيه وحده
  const DECISIONS = { duplicate_invoice: 'فاتورة معتمدة مسبقًا: لا اعتماد لها. ارفض المستند.',
    suspected_duplicate: 'اكتب سبب اختلافه عن المستند المرتبط في التنبيه أعلاه، أو ارفضه.',
    sales_report_exists: 'يوجد تقرير لهذا اليوم: صحّحه بسبب مكتوب من التنبيه أعلاه، أو ارفض المستند.',
    sales_report_exists_legacy: 'يوجد تقرير لهذا اليوم سُجّل سابقًا: لا يُنشأ ثانٍ.',
    no_change: 'مطابق للتقرير الموجود: ارفض المستند المكرر.' }
  const decisionPending = isV2 && DECISIONS[doc._v2Error?.code]
  // عدد القيود: قيد لكل تصنيف أساسي في الفاتورة (الاعتماد الجديد)
  const entryCount = isV2 && isExpenseItems ? new Set(res.items.map(it => resolveItemCategoryMain(categories, it, res.transType))).size : 1

  const approveHint = needsSupplierConfirm ? null
    : isMultiInvoice ? `يسجّل ${plural(pendingCount, 'قيدًا واحدًا للفاتورة المتبقية', 'قيدين للفاتورتين المتبقيتين', 'قيود مستقلة للفواتير المتبقية', 'قيدًا مستقلًا للفواتير المتبقية')}.`
    : isSales ? 'يسجّل المبيعات وقيودها حسب طريقة الدفع.'
    : isExpenseItems ? `يسجّل ${plural(entryCount, 'قيدًا واحدًا', 'قيدين', 'قيود', 'قيدًا')} في الدفتر، وعدد البنود ${itemCount}.`
    : isBankTransfer(res) ? 'يسجّل طرفي التحويل معًا: خروجًا من حساب ودخولًا إلى الآخر، دون مصروف أو مبيعات.' : 'يسجّل قيدًا واحدًا في الدفتر.'
  const approveLabel = n => (n === 1 ? 'اعتماد الفاتورة المتبقية' : n === 2 ? 'اعتماد الفاتورتين' : n <= 10 ? `اعتماد ${n} فواتير` : `اعتماد ${n} فاتورة`)
  // مدير المنصة يعرض المنشأة للقراءة فقط: لا اعتماد ولا رفض ولا قراءة (20261009150000)
  const actionBar = (approveCount) => readOnly ? (
    <div className="rp-action-bar" data-readonly-actions>
      <div className="rp-action-why"><Info className="ts-icon--sm" aria-hidden="true" />عرض للقراءة فقط: الاعتماد والرفض للمحاسب.</div>
    </div>
  ) : (
    <div className="rp-action-bar">
      {paused ? <div className="rp-action-why"><Info className="ts-icon--sm" aria-hidden="true" />الاعتماد متوقف مؤقتًا لهذه المنشأة.</div>
        : decisionPending ? <div className="rp-action-why"><Info className="ts-icon--sm" aria-hidden="true" />{decisionPending}</div>
        : supplierBlocked ? <div className="rp-action-why" data-k="supplier-blocked"><Info className="ts-icon--sm" aria-hidden="true" />في الصورة فاتورة آجلة بلا مورد محدد أو باسم يشبه موردًا مسجلًا: أكمل المورد في فاتورتها.</div>
        : amountsBlocked ? <div className="rp-action-why"><Info className="ts-icon--sm" aria-hidden="true" />البنود لا تطابق الإجمالي بالهللة. طابق مبالغ البنود وخصوماتها والضريبة مع المستند.</div>
        : receiptBlocked ? <div className="rp-action-why" data-k="receipt-blocked"><Info className="ts-icon--sm" aria-hidden="true" />{receiptBlocked}</div>
        : loanBlocked ? <div className="rp-action-why" data-k="loan-blocked"><Info className="ts-icon--sm" aria-hidden="true" />{loanBlocked}</div>
        : salesBlocked ? <div className="rp-action-why" data-k="sales-blocked"><Info className="ts-icon--sm" aria-hidden="true" />{salesCheck?.reasons?.[0] || 'تقرير مبيعات في الصورة فيه وسيلة دفع غير معروفة أو فرق مع إجماليه. راجعه في فاتورته.'}</div>
        : needsSupplierConfirm
        ? <div className="rp-action-why"><Info className="ts-icon--sm" aria-hidden="true" />أكّد هوية المورد أولًا (أعلاه).</div>
        : <div className="rp-action-hint">{(exact ? amountsBlocked : totalsCheck.status === 'mismatch') ? <strong>البنود لا تطابق الإجمالي — راجعها قبل الاعتماد. </strong> : null}{approveHint}</div>}
      <div className="rp-action-buttons">
        <Button variant="primary" icon={doc._state === 'approving' ? LoaderCircle : Check} className="rp-approve"
          disabled={busy || needsSupplierConfirm || paused || amountsBlocked || salesBlocked || supplierBlocked || !!receiptBlocked || !!loanBlocked || preparing || !!decisionPending} onClick={onApprove}>
          {doc._state === 'approving' ? 'جارٍ الاعتماد…' : approveCount ? approveLabel(approveCount) : 'اعتماد'}
        </Button>
        <Button icon={Save} className="rp-save" disabled={busy || !doc._dirty || !canSaveDraft} onClick={onSaveDraft}
          title={canSaveDraft ? 'تُحفظ في هذه النافذة فقط، لا في قاعدة البيانات' : 'تعذّر التعرف على هوية الجلسة'}>حفظ مسودة</Button>
        {!isMultiInvoice && canManual && !isReceipt(res) && <Button onClick={() => setManualIndex(0)}>اعتماد يدوي</Button>}
        {canReread && doc.status === 'analyzed' && <Button icon={doc._state === 'rereading' ? LoaderCircle : RotateCcw} className="rp-reread" data-k="reread"
          disabled={busy || !!rereadBlocked} title={rereadBlocked || 'قراءة الصورة الأصلية من جديد بالتعليمات الحالية'} onClick={() => setRereadOpen(true)}>
          {doc._state === 'rereading' ? 'جارٍ إعادة القراءة…' : 'إعادة قراءة المستند'}</Button>}
        <Button variant="quiet" icon={Ban} className="rp-reject" disabled={busy} onClick={onReject}>رفض</Button>
      </div>
    </div>
  )

  return (
    <div className="rp-form">
      {manualIndex != null && canManual && <ManualReviewDialog
        invoice={isMultiInvoice ? rawRes.invoices[manualIndex] : res} categories={categories} setup={setup} branch={doc.branch}
        supplierName={(() => { const inv = isMultiInvoice ? rawRes.invoices[manualIndex] : res, ctx = invoiceSupplierContext(doc, inv, isMultiInvoice)
          return inv?.paySource === 'credit' ? (suppliers.find(x => x.id === ctx.supplierId)?.name || '') : ctx.name })()}
        onClose={() => setManualIndex(null)} onConfirm={invoice => onManualApprove(manualIndex, invoice)} />}
      <Dialog open={rereadOpen} title="إعادة قراءة المستند" onClose={() => setRereadOpen(false)}
        footer={<><Button variant="primary" data-k="reread-confirm" onClick={() => { setRereadOpen(false); onReread() }}>إعادة القراءة</Button>
          <Button data-k="reread-cancel" onClick={() => setRereadOpen(false)}>إلغاء</Button></>}>
        <div data-k="reread-dialog">
          {hasManualEdits(doc) && <Note tone="warning" icon={CircleAlert} title="ستُستبدل تعديلاتك اليدوية">
            على هذه القراءة تعديلات منك أو مسودة محفوظة. ستُستبدل بالقراءة الجديدة ولا تُطبَّق عليها.</Note>}
          <p>تُقرأ الصورة الأصلية المخزّنة من جديد بالتعليمات الحالية، دون إعادة رفعها أو إنشاء نسخة منها.</p>
          <ul>
            <li>تُحفظ القراءة الحالية للمراجعة.</li>
            <li>تُلغى تأكيدات المراجعة السابقة (المورد، والتكرار، وأصل القرض، والتقريب، والمراجعة اليدوية، واختيارات الحساب)، وتراجع النتيجة الجديدة كاملة.</li>
            <li>إن فشلت القراءة أو الحفظ بقيت القراءة الحالية وتعديلاتك كما هي.</li>
            <li>لا يُنشأ أي قيد.</li>
          </ul>
        </div>
      </Dialog>
      {doc._rereadNotice && <Note tone="info" icon={RotateCcw} data-k="reread-notice">{doc._rereadNotice}</Note>}
      {canReread && rereadBlocked && doc.status === 'analyzed' && <Note data-k="reread-blocked">{rereadBlocked}</Note>}
      {analyzed && <PreviousReadings docId={doc.id} refreshKey={doc._rereadNotice || ''} />}
      {isStub && (
        <Note tone="info" icon={FlaskConical} title="قراءة محاكاة محليًا">
          بيئة الاختبار: نتيجة ثابتة مطابقة للصورة المصطنعة. لا تقيس دقة مزوّد القراءة، ولم يُرسل المستند إلى أي مزوّد.
        </Note>
      )}
      {doc._error && <Note tone="error" icon={CircleAlert} title="تعذّر الإجراء">{doc._error}</Note>}
      {doc._notice && <Note tone="success" icon={Check} title={doc._notice} />}
      {reopenedNote && <div data-k="receipt-reopened"><Note tone="warning" icon={CircleAlert} title="عاد هذا المستند للمراجعة">{reopenedNote}</Note></div>}
      <V2Error err={doc._v2Error} busy={busy} onReject={onReject} onDupConfirm={onDupConfirm} onCorrectSales={onCorrectSales} />
      {doc._v2Error?.code === 'sales_report_exists' && <CorrectionAccounts linked={doc._v2Error.linked} invoice={res} branch={doc.branch} setup={setup} onEdit={onEditCorrection || onEdit} />}
      {doc._validationError && (
        <Note tone="error" icon={CircleAlert} title="حقول مطلوبة قبل الاعتماد">
          {vErr.missingTransferPay
            ? 'اختر مصدر الدفع قبل اعتماد التحويل.'
            : `اختر ${vErr.missingType && vErr.missingPay ? 'التصنيف الأساسي ومصدر الدفع' : vErr.missingType ? 'التصنيف الأساسي' : 'مصدر الدفع'}.`}
        </Note>
      )}
      {doc._dupCheck && !readOnly && (
        <Note tone="warning" icon={CircleAlert} title="قيد مطابق مسجّل مسبقًا في الدفتر"
          action={<div className="rp-note-actions">
            <Button size="sm" variant="primary" disabled={busy} onClick={onApproveForced}>تسجيله مستندًا مختلفًا</Button>
            <Button size="sm" variant="quiet" icon={Ban} onClick={onDupIgnore}>رفض المستند</Button>
          </div>}>
          بالتاريخ والنوع والوصف والمبلغ نفسها. هل هذا مستند مختلف حقًا؟
        </Note>
      )}

      {/* لم يُقرأ بعد */}
      {doc.status === 'uploaded' && doc._state !== 'analyzed' && (
        <Panel title="لم يُقرأ بعد" icon={FileSearch} subtitle="اقرأ المستند لتظهر حقوله، ثم راجعها مع الصورة">
          <div className="ts-panel-body rp-read-actions">
            {readOnly ? <span className="rp-action-why" data-readonly-actions>عرض للقراءة فقط: القراءة والرفض للمحاسب.</span> : <>
            <Button variant="primary" icon={doc._state === 'analyzing' ? LoaderCircle : ScanText} disabled={busy} onClick={onAnalyze}>
              {doc._state === 'analyzing' ? 'جارٍ القراءة…' : 'قراءة المستند'}
            </Button>
            {doc._state !== 'analyzing' && <Button variant="quiet" icon={Ban} disabled={busy} onClick={onReject}>رفض المستند</Button>}
            </>}
          </div>
        </Panel>
      )}

      {analyzed && doc._dictionaryApplied && (
        <Note tone="info" icon={ListChecks} title="قاموس الأصناف">
          {doc._dictionaryApplied.applied > 0 && <>صُنّف <span className="ts-num">{doc._dictionaryApplied.applied}</span> بند من القاموس؛ راجعه وغيّره إن لزم. </>}
          {doc._dictionaryApplied.review > 0 && <><span className="ts-num">{doc._dictionaryApplied.review}</span> بند صنفه «للمراجعة» في القاموس فلم يُصنَّف تلقائيًا: اختر تصنيفه.</>}
        </Note>
      )}
      {/* فواتير متعددة في صورة واحدة */}
      {analyzed && isMultiInvoice && (
        <Panel title={`${plural(rawRes.invoices.length, 'فاتورة واحدة', 'فاتورتان', 'فواتير', 'فاتورة')} في هذه الصورة`} icon={Layers} subtitle="افتح كل فاتورة لتعديلها. تُعتمد كلها معًا، أو كل فاتورة وحدها.">
          {expensesAtProjectLevel(setup?.settings) && doc._branchEditable && branches.length > 0 && !documentExpensesAtProjectLevel(setup?.settings, rawRes) && (
            <div className="rp-section ts-form-grid">
              <Field label="الفرع" hint="للمبيعات والتحويلات في الصورة؛ المصروفات تُسجَّل على مستوى المنشأة.">
                <Select value={doc.branch || ''} placeholder="— اختر الفرع —" onChange={e => onBranchChange(e.target.value)}
                  options={branches.map(b => ({ value: b, label: b }))} />
              </Field>
            </div>
          )}
          <div className="rp-subinvs">
            {rawRes.invoices.map((inv, idx) => (
              <InvoiceSubPanel key={inv._id || idx} invoice={inv} index={idx} transTypes={transTypes} categories={categories}
                setup={setup} branch={doc.branch}
                v2={isV2} decision={isV2 ? invStatus(inv._id) : null}
                onEdit={(f, v) => onEditInvoice(idx, f, v)} onReplace={next => onReplaceInvoice(idx, next)} readOnly={readOnly}
                suppliers={suppliers} payableSuppliers={payableSuppliers || []}
                onApprove={readOnly ? null : () => onApproveInvoice(idx)}
                onManualApprove={canManual && !isReceipt(inv) ? () => setManualIndex(idx) : null}
                documentId={doc.id} history={invStatus(inv._id)?.history} receiptContext={receiptCtx[inv._id]} onReceiptContext={onReceiptContext(inv._id)}
                serverDuplicate={serverDup(inv._id)}
                onReject={readOnly ? null : () => onRejectInvoice(idx)}
                approving={busy}
                blocked={isV2 ? (decisionPending && (!doc._v2Error?.invoice_id || doc._v2Error.invoice_id === inv._id) ? decisionPending
                  : inv.type === 'expense' && inv.items?.length && ['mismatch', 'invalid'].includes(exactTotals(inv).status) ? 'البنود لا تطابق إجمالي هذه الفاتورة بالهللة. طابق مبالغ البنود وخصوماتها والضريبة مع المستند.'
                  : inv.type === 'sales' && !salesReportCheck(inv).ok ? salesReportCheck(inv).reasons[0] : null)
                  : inv.type === 'sales' && !salesReportCheck(inv).ok ? salesReportCheck(inv).reasons[0] : null} />
            ))}
          </div>
          {pendingCount > 0 && actionBar(pendingCount)}
        </Panel>
      )}

      {/* فاتورة واحدة */}
      {analyzed && res && (
        <Panel title="بيانات المستند" icon={ListChecks} subtitle="طابق الحقول مع الصورة">
          <div className="rp-section">
            <Segment full label="نوع المستند" value={isV2 ? reviewDocumentType(res) : res.type || ''} options={isV2 ? [...TYPE_OPTIONS, RECEIPT_OPTION, LOAN_OPTION] : TYPE_OPTIONS}
              onChange={v => { if (readOnly) return; const next = typeChange(res, v); if (next === undefined) onEdit('type', v); else if (next) onReplaceInvoice(null, next) }} />
            {res._paymentSuggested && <Note>{res._paymentSuggested}</Note>}
            <HistoricalCustodyNote invoice={res} setup={setup}/>
            {isReceipt(res) ? (
              <SupplierReceiptFields invoice={res} documentId={doc.id} suppliers={suppliers} payableSuppliers={payableSuppliers || []} readOnly={readOnly}
                bankAccounts={setup?.bankAccounts || []} serverDuplicate={serverDup(res._id)} onPatch={patch => onReplaceInvoice(null, { ...res, ...patch })}
                onContext={onReceiptContext(res._id)} />
            ) : <>
            <div className="ts-form-grid">
              <Field label={isSales ? 'الوصف' : 'المورد أو الوصف'} span>
                <GrowInput value={res.description || ''} onChange={e => onEdit('description', e.target.value)} />
              </Field>
              <Field label="التاريخ" error={isFutureDate ? 'تاريخ في المستقبل — تأكد من القراءة قبل الاعتماد.' : undefined}>
                <DateInput value={res.date || ''} onChange={v => onEdit('date', v)} />
              </Field>
              {isV2 && !isSales && (
                <Field label="رقم الفاتورة" hint={res.invoiceNumber ? 'كما هو مطبوع؛ يُحفظ النص الأصلي' : 'لم تقرأه القراءة الآلية — اكتبه من الصورة إن وُجد'}>
                  <Input value={res.invoiceNumber || ''} dir="ltr" onChange={e => onEdit('invoiceNumber', e.target.value)} />
                </Field>
              )}
              {doc._branchEditable && branches.length > 0 && !documentExpensesAtProjectLevel(setup?.settings, rawRes) && (
                <Field label="الفرع">
                  <Select value={doc.branch || ''} placeholder="— اختر الفرع —" onChange={e => onBranchChange(e.target.value)}
                    options={branches.map(b => ({ value: b, label: b }))} />
                </Field>
              )}
              {!isSales && !isBankTransfer(res) && (
                <Field label="مصدر الدفع" error={vErr.missingPay ? 'مطلوب' : undefined} hint={isLoan ? 'المصدر الذي خرج منه مبلغ السداد.' : 'يحدد الرصيد الذي ينقص، أو دينًا على المورد.'}>
                  <Select value={res.paySource || ''} placeholder="— اختر —" onChange={e => { onEdit('paySource', e.target.value); onClearValidation() }}
                    options={isLoan ? paymentOptions(setup,res.paySource).filter(o => o.value !== 'payable') : [...paymentOptions(setup,res.paySource), ...(suppliers.length > 0 ? [{ value: 'credit', label: 'آجل — مورد من القائمة' }] : []),
                      ...(res.paySource && ![...PAY_OPTIONS.map(o => o.value), 'credit'].includes(res.paySource) ? [{ value: res.paySource, label: res.paySource }] : [])]} />
                </Field>
              )}
              {res.paySource === 'credit' && suppliers.length > 0 && (
                <Field label="المورد">
                  <Select value={doc._supplierId || ''} placeholder="— اختر المورد —" onChange={e => onSupplierChange(e.target.value)}
                    options={suppliers.map(s => ({ value: s.id, label: s.name }))} />
                </Field>
              )}
              {isPayable && (
                <Field label="اسم المورد (آجل)" span>
                  <Input value={supplierName} placeholder="اسم المورد" onChange={e => onSupplierNameChange(e.target.value)} />
                </Field>
              )}
              {!isSales && <BankAccountField invoice={res} branch={res?.type === 'expense' && expensesAtProjectLevel(setup?.settings) ? null : doc.branch} setup={setup} onEdit={onEdit} />}
              {/* الاعتماد الجديد: التصنيف على البند نفسه (من قائمة التصنيفات)، ولو كان بندًا واحدًا؛ نوع القيد ومعالجته منه */}
              {!isSales && !isLoan && !(isExpenseItems && (itemCount > 1 || isV2)) && (
                <Field label={<>التصنيف الأساسي{doc._aiSuggestedType && res.transType ? <span className="rp-ai-tag">اقتراح القراءة</span> : null}</>}
                  error={vErr.missingType ? 'مطلوب' : undefined}>
                  <Select value={res.transType || ''} placeholder="— اختر —" onChange={e => { onEdit('transType', e.target.value); onClearValidation() }}
                    options={catOptions(filteredTransTypes, res.transType)} />
                </Field>
              )}
              {!isSales && !isLoan && !isExpenseItems && (
                <Field label="التصنيف الفرعي">
                  {subCats.length > 0
                    ? <Select value={resolvedSub} placeholder="— اختر الفئة الفرعية —" onChange={e => onEdit('category_sub', e.target.value)}
                        options={catOptions(subCats.map(s => s.name), resolvedSub)} />
                    : <Input value={res.category_sub || ''} onChange={e => onEdit('category_sub', e.target.value)} />}
                </Field>
              )}
            </div>
            {needsSupplierConfirm && (
              <Note tone="warning" icon={CircleAlert} title={`يشبه موردًا مسجّلًا: ${supplierMatch.supplier.name}`}
                action={<div className="rp-note-actions">
                  <Button size="sm" variant="primary" onClick={() => onSupplierResolve('existing', supplierMatch.supplier.id)}>نعم، المورد نفسه</Button>
                  <Button size="sm" onClick={() => onSupplierResolve('new', null)}>لا، مورد جديد</Button>
                </div>}>
                هل هو المورد نفسه؟
              </Note>
            )}
            </>}
          </div>

          {res.type === 'expense' && (
            <div className="rp-section">
              <h3>البنود <span className="ts-num">{itemCount}</span> <span className="ts-field-hint">{exact?.basis === 'exclusive' ? 'المبالغ قبل الضريبة كما في المستند' : 'المبالغ شاملة الضريبة كما في المستند'}</span></h3>
              {isV2 && (
                <ExpenseBasis invoice={res} onEdit={onEdit} readOnly={readOnly} />
              )}
              <ItemLines items={res.items || []} independent={itemCount > 1 || isV2} categories={categories} transType={res.transType} discounts={isV2}
                onEditItem={onEditItem} onDeleteItem={onDeleteItem} onAddItem={onAddItem} />
              <ItemsTotals check={totalsCheck} exact={exact} res={res} onEdit={onEdit} onReplace={next => onReplaceInvoice(null, next)} readOnly={readOnly} />
            </div>
          )}

          {isLoan && <div className="rp-section"><LoanRepaymentFields invoice={res} transTypes={transTypes} readOnly={readOnly}
            onPatch={patch => onReplaceInvoice(null, { ...res, ...patch })} /></div>}
          {res.type === 'transfer' && !isLoan && (
            <div className="rp-section">
              <div className="ts-form-grid">
                <Field label="المبلغ">
                  <Num value={res.totalAmount ?? res.amount ?? ''} onChange={e => onEdit(res.totalAmount != null ? 'totalAmount' : 'amount', e.target.value)} />
                </Field>
                <Field label="ضريبة القيمة المضافة">
                  <Num value={res.vatAmount || ''} onChange={e => onEdit('vatAmount', e.target.value)} />
                </Field>
              </div>
            </div>
          )}

          {isSales && (
            <div className="rp-section">
              <h3>المبيعات حسب طريقة الدفع</h3>
              <div className="ts-form-grid rp-channels">
                {visibleSalesChannels(SALES_CHANNELS, setup?.settings, doc.branch, res).map(({ key, label, enabled }) => (
                  <Field key={key} label={label} error={enabled ? undefined : `غير مفعّلة لفرع «${doc.branch}». انقل المبلغ إلى قناته الصحيحة أو صحّح الفرع.`}>
                    <Num value={res[key] || ''} onChange={e => onEdit(key, e.target.value)} /></Field>
                ))}
                {isV2 && <BankAccountField invoice={res} branch={doc.branch} setup={setup} onEdit={onEdit} />}
              </div>
              <SalesReading invoice={res} onEdit={onEdit} onReplace={next => onReplaceInvoice(null, next)} readOnly={readOnly} />
              <div className="rp-totals">
                <div className="rp-total-row rp-total-row--strong"><span>الإجمالي المحسوب</span><Money value={salesTotal} /></div>
                <div className="rp-total-row"><span>ضريبة المخرجات المحسوبة (15% كما في التطبيق)</span>
                  <Money value={(res.totalSales || (res.cashSales || 0) + (res.networkSales || 0) + (res.transferSales || 0)) / 1.15 * 0.15} /></div>
              </div>
            </div>
          )}

          {actionBar(0)}
        </Panel>
      )}

      {analyzed && (res || isMultiInvoice) && (
        <div className="rp-secondary-actions">
          <Button size="sm" variant="quiet" icon={Plus} disabled={busy} onClick={onAddInvoice}>إضافة فاتورة أخرى من الصورة نفسها</Button>
        </div>
      )}
    </div>
  )
}

// ── InvoiceSubPanel — فاتورة واحدة ضمن صورة فيها عدة فواتير ─────────────────
function InvoiceSubPanel({ invoice, index, transTypes, categories, setup, branch, onEdit, onReplace, readOnly, onApprove, onManualApprove, onReject, approving, blocked, v2, decision, suppliers = [], payableSuppliers = [], documentId, history, receiptContext, onReceiptContext, serverDuplicate }) {
  const decided = decision && decision.status !== 'pending'
  if (decided) return (
    <div className="rp-subinv rp-subinv--decided">
      <div className="rp-subinv-row">
        <span className="rp-subinv-n">فاتورة <span className="ts-num">{index + 1}</span></span>
        <span className="rp-subinv-desc">{invoice.description || invoice.transType || '—'}</span>
        <Status tone={decision.status === 'approved' ? 'success' : 'neutral'}>
          {decision.status === 'approved' ? <>معتمدة · <span className="ts-num">{decision.journal_number}</span></> : 'مستبعدة'}
        </Status>
      </div>
    </div>
  )
  const [payError, setPayError] = useState(false)
  const isSales      = invoice.type === 'sales'
  const isLoan       = !!v2 && isLoanRepayment(invoice)
  const isMultiItem  = (invoice.items?.length || 0) > 1
  const isFutureDate = invoice.date && invoice.date > fmtDate(new Date())
  const isTransferDoc      = invoice.type === 'transfer'
  const filteredTransTypes = isTransferDoc ? [...new Set([...accountTransTypes(transTypes,setup).filter(TRANSFER_KINDS), ...(paymentWorkflow(setup?.settings) ? [BANK_TRANSFER_TYPE] : [])])] : accountTransTypes(transTypes,setup)
  const totalDisp = isSales
    ? SALES_CHANNELS.reduce((t, c) => t + (Number(invoice[c.key]) || 0), 0)
    : Number(invoice.totalAmount || invoice.amount) || 0
  const items = invoice.items || []
  // الآجل لهذه الفاتورة وحدها: مورد من القائمة (supplier_id) أو باسم المورد (supplier_name مع تأكيد المشابه)
  const isExpense = invoice.type === 'expense'
  const supCtx = invoiceSupplierContext(null, invoice, true)
  const payableMatch = isExpense && invoice.paySource === 'payable' && supCtx.name ? matchSupplier(supCtx.name, payableSuppliers) : null
  const supplierBlocked = supplierBlockReason(invoice, supCtx, payableMatch)
  const receipt = isReceipt(invoice)
  const why = blocked || supplierBlocked || receiptBlockReason(invoice, receiptContext, serverDuplicate) || (v2 && loanBlockReason(invoice, transTypes))
  const reopenedNote = receiptHistoryNote(history)
  const payOptions = isExpense
    ? [...paymentOptions(setup,invoice.paySource), ...(suppliers.length > 0 ? [{ value: 'credit', label: 'آجل — مورد من القائمة' }] : [])]
    : paymentOptions(setup,invoice.paySource).filter(o => o.value !== 'payable')

  return (
    <details className="rp-subinv" open={isFutureDate || undefined}>
      <summary>
        <span className="rp-subinv-n">فاتورة <span className="ts-num">{index + 1}</span></span>
        <span className="rp-subinv-desc">{invoice.description || invoice.transType || '—'}</span>
        {invoice.date && <span className="ts-num rp-subinv-date">{invoice.date}</span>}
        <Money value={totalDisp} />
      </summary>
      <div className="rp-subinv-body">
        {reopenedNote && <div data-k={`receipt-reopened-${index}`}><Note tone="warning" icon={CircleAlert} title="عادت هذه الفاتورة للمراجعة">{reopenedNote}</Note></div>}
        {v2 && (
          <div className="ts-form-grid">
            <Field label="نوع الفاتورة">
              <Select value={reviewDocumentType(invoice)} disabled={readOnly} data-k={`type-${index}`}
                onChange={e => { const v = e.target.value, next = typeChange(invoice, v); if (next === undefined) onEdit('type', v); else if (next) onReplace?.(next) }}
                options={[...TYPE_OPTIONS, RECEIPT_OPTION, LOAN_OPTION]} />
            </Field>
          </div>
        )}
        {invoice._paymentSuggested && <Note>{invoice._paymentSuggested}</Note>}
        <HistoricalCustodyNote invoice={invoice} setup={setup}/>
        {receipt ? (
          <SupplierReceiptFields invoice={invoice} index={index} documentId={documentId} suppliers={suppliers} payableSuppliers={payableSuppliers}
            bankAccounts={setup?.bankAccounts || []} readOnly={readOnly} serverDuplicate={serverDuplicate} onPatch={patch => onReplace?.({ ...invoice, ...patch })} onContext={onReceiptContext} />
        ) : <>
        <div className="ts-form-grid">
          <Field label="الوصف" span>
            <Input value={invoice.description || ''} onChange={e => onEdit('description', e.target.value)} />
          </Field>
          <Field label="التاريخ" error={isFutureDate ? 'تاريخ في المستقبل — تأكد من القراءة.' : undefined}>
            <DateInput value={invoice.date || ''} onChange={v => onEdit('date', v)} />
          </Field>
          {v2 && !isSales && (
            <Field label="رقم الفاتورة"><Input value={invoice.invoiceNumber || ''} dir="ltr" onChange={e => onEdit('invoiceNumber', e.target.value)} /></Field>
          )}
          {!isSales && !isBankTransfer(invoice) && (
            <Field label="مصدر الدفع" error={payError ? 'مطلوب' : undefined}>
              <Select value={invoice.paySource || ''} placeholder="— اختر —" data-k={`pay-source-${index}`} onChange={e => { onEdit('paySource', e.target.value); setPayError(false) }}
                options={payOptions} />
            </Field>
          )}
          {isExpense && invoice.paySource === 'credit' && (
            <Field label="المورد" error={!invoice.supplier_id ? 'اختر المورد لهذه الفاتورة.' : undefined}>
              <Select value={invoice.supplier_id || ''} placeholder="— اختر المورد —" data-k={`supplier-${index}`} disabled={readOnly}
                onChange={e => onEdit('supplier_id', e.target.value || null)} options={suppliers.map(x => ({ value: x.id, label: x.name }))} />
            </Field>
          )}
          {isExpense && invoice.paySource === 'payable' && (
            <Field label="اسم المورد (آجل)" hint="يُسجَّل المستحق باسمه في «موردو الآجل».">
              <Input value={invoice.supplier_name ?? invoice.description ?? ''} data-k={`payable-name-${index}`} disabled={readOnly}
                onChange={e => onReplace?.({ ...invoice, supplier_name: e.target.value, _supplierResolution: undefined, _matchedSupplierId: undefined })} />
            </Field>
          )}
          {payableMatch?.matchType === 'fuzzy' && (
            <Field label={`هل هو المورد المسجل «${payableMatch.supplier.name}»؟`}>
              <Select value={invoice._supplierResolution || ''} placeholder="— أكّد —" data-k={`payable-resolution-${index}`} disabled={readOnly}
                onChange={e => onReplace?.({ ...invoice, _supplierResolution: e.target.value || undefined, _matchedSupplierId: e.target.value === 'existing' ? payableMatch.supplier.id : undefined })}
                options={[{ value: 'existing', label: `نعم، «${payableMatch.supplier.name}»` }, { value: 'new', label: 'لا، مورد جديد' }]} />
            </Field>
          )}
          {!isSales && !isLoan && !(v2 && invoice.type === 'expense') && (
            <Field label="المبلغ">
              <Num value={invoice.totalAmount ?? invoice.amount ?? ''} onChange={e => onEdit(invoice.totalAmount != null ? 'totalAmount' : 'amount', e.target.value)} />
            </Field>
          )}
          {!isSales && !isLoan && !isMultiItem && (
            <Field label="التصنيف الأساسي">
              <Select value={invoice.transType || ''} placeholder="— اختر —" onChange={e => onEdit('transType', e.target.value)}
                options={catOptions(filteredTransTypes, isTransferDoc ? invoice.transType : '')} />
            </Field>
          )}
          {isSales && visibleSalesChannels(SALES_CHANNELS, setup?.settings, branch, invoice).map(({ key, label, enabled }) => (
            <Field key={key} label={label} error={enabled ? undefined : `غير مفعّلة لفرع «${branch}».`}><Num value={invoice[key] || ''} onChange={e => onEdit(key, e.target.value)} /></Field>
          ))}
          {(v2 || !isSales) && <BankAccountField invoice={invoice} branch={invoice.type === 'expense' && expensesAtProjectLevel(setup?.settings) ? null : branch} setup={setup} onEdit={onEdit} />}
        </div>
        {isLoan && <LoanRepaymentFields invoice={invoice} transTypes={transTypes} readOnly={readOnly}
          onPatch={patch => onReplace?.({ ...invoice, ...patch })} />}
        {isSales && <SalesReading invoice={invoice} onEdit={onEdit} onReplace={onReplace} readOnly={readOnly} />}
        {!isSales && !isLoan && (
          <div className="rp-subinv-items">
            <h4>البنود <span className="ts-num">{items.length}</span></h4>
            {v2 && invoice.type === 'expense' && <ExpenseBasis invoice={invoice} onEdit={onEdit} readOnly={readOnly} />}
            <ItemLines items={items} independent={isMultiItem || v2} categories={categories || []} transType={invoice.transType} discounts={v2}
              onEditItem={(i, patch) => onEdit('items', items.map((it, j) => j === i ? { ...it, ...patch } : it))}
              onDeleteItem={i => onEdit('items', items.filter((_, j) => j !== i))}
              onAddItem={() => onEdit('items', [...items, blankItem()])} />
            {v2 && invoice.type === 'expense' && <ItemsTotals exact={exactTotals(invoice)} res={invoice} onEdit={onEdit} onReplace={onReplace} readOnly={readOnly} />}
          </div>
        )}
        </>}
        {(onApprove || onReject) && (
          <div className="rp-subinv-actions">
            {payError && <span className="ts-field-error">اختر مصدر الدفع قبل اعتماد التحويل.</span>}
            {why && <span className="rp-action-why" data-k={`invoice-blocked-${index}`}><Info className="ts-icon--sm" aria-hidden="true" />{why}</span>}
            {onApprove && (
              <Button size="sm" icon={Check} disabled={approving || !!why} onClick={() => {
                if (invoice.type === 'transfer' && !invoice.paySource) { setPayError(true); return }
                setPayError(false)
                onApprove()
              }}>اعتماد هذه الفاتورة وحدها</Button>
            )}
            {onManualApprove && <Button size="sm" disabled={approving} onClick={onManualApprove}>اعتماد يدوي لهذه الفاتورة</Button>}
            {onReject && <Button size="sm" variant="quiet" icon={Ban} disabled={approving} onClick={onReject}>استبعادها</Button>}
          </div>
        )}
      </div>
    </details>
  )
}
