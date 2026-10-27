import { isOwnerWithdrawal, withdrawalBlockReason } from './ownerWithdrawal.js'
import { categoryChoice } from './categoryLinks.js'
// الاعتماد الجديد (v2): العمليات كلها في الخادم (دوال approval_* في قاعدة البيانات، معاملة واحدة لكل اعتماد).
// هذه الوحدة تبني البيانات المرسلة وتفحص المبالغ بالهللة قبل الإرسال وتترجم رموز الخادم إلى رسائل.
// الفحص هنا للعرض فقط؛ الخادم يعيد الفحص نفسه ويرفض ما يخالفه.
import { STALE_MESSAGE } from './appVersion.js'
import { isLoanRepayment, loanAmount, loanBlockReason, hasLoanPrincipalConfirmation } from './loanRepayment.js'
import { bankTransferPayment } from './paymentWorkflow.js'

/** خطأ نداء لم يصل إلى رد من الخادم: صفحة قديمة بعد نشر إصدار أحدث (رُفض قبل الإرسال)، أو انقطاع. */
export const callError = error => ({ code: error?.code === 'APP_VERSION_STALE' ? 'app_version_stale' : 'network' })

const LATIN = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٫': '.' }

/**
 * المبلغ بالهللة عددًا صحيحًا، من نص أو رقم، بلا حساب عشري تقريبي.
 * يعيد null للفارغ، وNaN لغير الصالح أو لأكثر من هللتين (لا تقريب صامت).
 */
export function toHalalas(value) {
  if (value == null || value === '') return null
  let s = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : 'x') : String(value)
  s = s.replace(/[٠-٩۰-۹٫]/g, c => LATIN[c]).replace(/[,٬\s]/g, '')
  if (/e/i.test(s)) s = Number(s).toFixed(10).replace(/0+$/, '').replace(/\.$/, '')
  const m = s.match(/^(-?)(\d*)(?:\.(\d*))?$/)
  if (!m || (m[2] === '' && !m[3])) return NaN
  const frac = (m[3] || '').replace(/0+$/, '')
  if (frac.length > 2) return NaN
  const h = Number(m[2] || '0') * 100 + Number((frac + '00').slice(0, 2))
  return m[1] ? -h : h
}
export const fromHalalas = h => (h / 100).toFixed(2)

/**
 * مطابقة البنود والإجمالي بالهللة على أساس المستند، بعد الخصم على الإجمالي إن وُجد:
 *  inclusive — مجموع البنود − الخصم = الإجمالي؛ exclusive — مجموع البنود − الخصم + الضريبة = الإجمالي.
 *  مبلغ البند هو بعد خصم البند نفسه (خصم البند للتدقيق فقط).
 * لا هامش: أي فرق يجب أن يُفسَّر (بند ظاهر) قبل الاعتماد.
 */
export function exactTotals(inv) {
  const items = Array.isArray(inv?.items) ? inv.items : []
  const basis = inv?.amountsBasis === 'exclusive' ? 'exclusive' : 'inclusive'
  const total = toHalalas(inv?.totalAmount ?? inv?.amount)
  const vat = toHalalas(inv?.vatAmount) ?? 0
  const discount = toHalalas(inv?.invoiceDiscount) ?? 0          // خصم على إجمالي الفاتورة (موجب)
  const amounts = items.map(it => toHalalas(it.amount) ?? 0)     // مبلغ البند بعد خصمه
  const invalid = [total, vat, discount, ...amounts].some(x => Number.isNaN(x)) || discount < 0 || amounts.some(a => a < 0)
  const itemsSum = amounts.reduce((a, b) => a + b, 0)
  const base = { basis, total: total ?? 0, vat, discount, itemsTotal: itemsSum, diff: 0 }
  if (invalid) return { ...base, status: 'invalid' }
  if (!items.length) return { ...base, status: discount ? 'invalid' : 'none' }
  if (discount && discount >= itemsSum) return { ...base, status: 'invalid' }
  const diff = basis === 'inclusive' ? itemsSum - discount - (total ?? 0) : itemsSum - discount + vat - (total ?? 0)
  return { ...base, status: diff === 0 ? 'match' : 'mismatch', diff }
}

/** اقتراح للمراجع فقط؛ لا يغيّر القراءة أو المبالغ ولا يسمح بالاعتماد قبل اختياره. */
export function expenseBasisSuggestion(inv) {
  if (inv?.type !== 'expense') return null
  const current = exactTotals(inv)
  if (current.status !== 'mismatch' || current.vat <= 0 || current.total <= 0) return null
  if (inv.items.some(item => toHalalas(item.amount) == null)) return null
  const basis = current.basis === 'inclusive' ? 'exclusive' : 'inclusive'
  return exactTotals({ ...inv, amountsBasis: basis }).status === 'match' ? basis : null
}

/** توزيع الضريبة على البنود بالهللة بطريقة الباقي الأكبر (مطابق لـ approval_private.allocate). للعرض. */
export function allocateHalalas(weights, amount) {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (!weights.length) return []
  if (sum === 0) return weights.map(() => 0)
  const base = weights.map(w => Math.floor((amount * w) / sum))
  const rem = weights.map((w, i) => ({ i, r: (amount * w) % sum }))
  let left = amount - base.reduce((a, b) => a + b, 0)
  for (const { i } of rem.sort((a, b) => b.r - a.r || a.i - b.i)) { if (left-- <= 0) break; base[i]++ }
  return base
}

// مطابقة الاسم كما في الخادم (approval_private.norm_cat): تُحذف الرموز والإيموجي، وتُوحَّد الأرقام والمسافات وحالة
// الحروف اللاتينية؛ تبقى الحروف العربية واللاتينية والأرقام فلا يتطابق اسمان مختلفان.
export const normCat = s => String(s || '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
  .replace(/[^A-Za-z0-9؀-ۿ\s]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * التصنيف الأساسي الفعلي للبند: المختار إن كان الفرعي تحته (أو لا فرعي)، وإلا أبو الفرعي بالاسم (قراءة وضعت الفرعي
 * تحت رئيسي آخر)، وإلا المكتوب، وإلا تصنيف الفاتورة. المختار أولًا حتى لا يحسم اسمُ فرعي متكرر تحت رئيسيين الاختيارَ.
 */
export function itemMainCategory(categories, item, fallbackTransType) {
  const cats = categories || [], subName = normCat(item.category_sub || '')
  const chosen = item.category_main ? cats.find(p => !p.parent_id && normCat(p.name) === normCat(item.category_main)) : null
  if (chosen && (!subName || cats.some(c => c.parent_id === chosen.id && normCat(c.name) === subName))) return chosen.name
  // بلا رئيسي مختار: الفرعي يحسمه فقط إن كان اسمه وحيدًا في المنشأة؛ الملتبس (مثل «أخرى» تحت رئيسيين) يرفضه الخادم ويطلب الاختيار
  const subs = subName ? cats.filter(c => c.parent_id && normCat(c.name) === subName) : []
  const sub = subs.length === 1 ? subs[0] : null
  if (sub) { const parent = categories.find(p => p.id === sub.parent_id); if (parent) return parent.name }
  return item.category_main || normCat(fallbackTransType) || null
}
/** نوع قيد التصنيف: نوع الحركة المطابق لاسمه في إعدادات المنشأة، وإلا نوع الفاتورة. */
export function ledgerTypeFor(main, transTypes, fallbackTransType) {
  return (transTypes || []).find(t => normCat(t) === normCat(main)) || fallbackTransType || '🛒 مصروفات تشغيلية'
}

const CHANNEL_LABEL = { cash: 'النقدي', network: 'الشبكة', transfer: 'التحويل', hunger: 'هنقر', jahez: 'جاهز', keeta: 'كيتا', mrsool: 'مرسول' }
const FIELD_LABEL = { description: 'المورد أو الوصف', date: 'التاريخ', invoiceNumber: 'رقم الفاتورة', totalAmount: 'الإجمالي', amount: 'المبلغ',
  vatAmount: 'الضريبة', paySource: 'مصدر الدفع', transType: 'التصنيف الأساسي', category_sub: 'التصنيف الفرعي', amountsBasis: 'أساس المبالغ',
  type: 'نوع المستند', cashSales: 'نقدي', networkSales: 'شبكة', transferSales: 'تحويل', hungerSales: 'هنقر ستيشن', jahez: 'جاهز', keeta: 'كيتا', mrsool: 'مرسول',
  totalSales: 'إجمالي التقرير المطبوع',
  // إيصال سداد مورد (20261020120000)
  beneficiary: 'المستفيد', reference: 'مرجع العملية', supplierKind: 'قائمة المورد', supplierId: 'المورد', paymentMode: 'طريقة الاعتماد',
  linkJournal: 'الدفعة المربوطة', newPaymentReason: 'سبب أنها دفعة أخرى', linkReason: 'سبب إرفاق مستند آخر بالدفعة', bankAccountId: 'الحساب البنكي', bankAccounts: 'حسابات قنوات المبيعات', bankTransfer: 'حسابا التحويل الداخلي', splitPayment: 'تقسيم السداد', paymentAllocations: 'مبالغ السداد وحساباتها' }
const fieldText = v => Array.isArray(v) ? JSON.stringify(v) : v && typeof v === 'object' ? JSON.stringify(v, Object.keys(v).sort()) : String(v ?? '')
const same = (a, b) => fieldText(a) === fieldText(b)

/** سجل التعديلات بين نتيجة القراءة وما يُعتمد (يُحفظ مع الاعتماد في الخادم). */
export function reviewChanges(original, final) {
  const out = original ? [] : ['فاتورة أضافها المراجع (لم تكن في القراءة)']
  if (hasLoanPrincipalConfirmation(final)) out.push(`أكد المراجع بعد مراجعة كشف التمويل أن مبلغ ${final.loanPrincipalConfirmation.amount} لـ«${final.transType}» أصل قرض فقط، دون أرباح تمويل أو رسوم.`)
  if (!original) return out
  if (final.roundingReview && !same(final.roundingReview,original.roundingReview)) out.push(`تسوية تقريب مؤكدة للبند ${final.roundingReview.line+1}: ${final.roundingReview.from} ← ${final.roundingReview.to}؛ ${final.roundingReview.reason}`)
  if (final.manualReview?.version === 1) out.push(`اعتماد بمراجعة يدوية (${final.manualReview.mode === 'confirmed_channels' ? 'صافي القنوات المؤكد' : 'الإجمالي والتصنيف المؤكد'}): ${final.manualReview.reason}`)
  for (const [k, label] of Object.entries(FIELD_LABEL)) {
    if (k in final || k in original) if (!same(original[k], final[k])) out.push(`${label}: «${fieldText(original[k] ?? '—')}» ← «${fieldText(final[k] ?? '—')}»`)
  }
  const a = original.items || [], b = final.items || []
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (!a[i]) { out.push(`بند ${i + 1} أُضيف: ${b[i].description || '—'} ${b[i].amount ?? ''}`); continue }
    if (!b[i]) { out.push(`بند ${i + 1} حُذف: ${a[i].description || '—'} ${a[i].amount ?? ''}`); continue }
    for (const k of ['description', 'amount', 'category_main', 'category_sub']) {
      if (!same(a[i][k], b[i][k])) out.push(`بند ${i + 1} — ${{ description: 'الوصف', amount: 'المبلغ', category_main: 'التصنيف', category_sub: 'الفرعي' }[k]}: «${a[i][k] ?? '—'}» ← «${b[i][k] ?? '—'}»`)
    }
  }
  return out
}

/**
 * الفاتورة كما تُرسل للخادم: تصنيف كل بند ونوع قيده، وسجل التعديلات. لا تُحسب هنا أي مبالغ نهائية؛
 * الخادم يحسب القيود والضريبة ويرفض الفرق.
 */
export function buildInvoicePayload(inv, { original, categories, transTypes, purchaseCategory, supplierId }) {
  inv = bankTransferPayment(inv)
  const withdrawal = isOwnerWithdrawal(inv)
  if (withdrawal) { const reason = withdrawalBlockReason(inv, transTypes); if (reason) throw new Error(reason) }
  const loan = isLoanRepayment(inv)
  if (loan) {
    const reason = loanBlockReason(inv, transTypes)
    if (reason) throw new Error(reason)
  }
  // An expense's document-level choice must never replace a transfer/loan selected by the reviewer.
  const transType = (inv.type === 'expense' ? purchaseCategory : '') || inv.transType || ''

  // التصنيف بمعرّفه الثابت (الخادم يأخذ منه نوع القيد والرمز المالي)؛ الاسم للعرض والتوافق فقط
  const byName = (name, parentId = null) => (categories || []).find(c => (c.parent_id || null) === parentId && normCat(c.name) === normCat(name || ''))
  const items = (inv.items || []).map(it => {
    const main = itemMainCategory(categories, it, transType)
    const chosen = categoryChoice(categories, { ...it, category_main: main }, transType)
    const { _dictionary, _dictionaryNote, ...line } = it
    return { ...line, ...chosen, ledger_type: chosen.ledger_type || ledgerTypeFor(main, transTypes, transType) }
  })
  const invoiceName = (inv.type === 'expense' && purchaseCategory) || inv.category_main || transType
  const invCat = byName(invoiceName) || (() => { const matches = (categories || []).filter(c => !c.parent_id && c.is_active !== false && c.ledger_type && c.ledger_type === transType); return matches.length === 1 ? matches[0] : null })()
  // بلا نوع حركة للفاتورة (البند يحمل تصنيفه): نوع قيد تصنيف البند الأول، والخادم يأخذ نوع كل قيد من تصنيفه على أي حال
  const effectiveType = transType || items.find(it => it.category_id && it.ledger_type)?.ledger_type || ''
  const payload = { ...inv, transType: effectiveType, items, category_main: invCat?.name || invoiceName || null, category_id: invCat?.id || null, subcategory_id: categoryChoice(categories, { ...inv, category_main: invCat?.name || inv.category_main }, transType).subcategory_id }
  if (loan || withdrawal) {
    // The server's transfer path reads amount first: send exactly the visible amount, even for an older saved draft.
    payload.amount = fromHalalas(toHalalas(loanAmount(inv)))
    payload.totalAmount = payload.amount
    payload.vatAmount = 0
    payload.items = []
    payload.category_id = null; payload.category_main = null
    delete payload.subcategory_id; delete payload.category_sub
  }
  // المورد لكل فاتورة (2026-10-20): يُرسل مورد السياق (اختيار المستند للفاتورة المفردة، ومورد الفاتورة نفسها في الصورة متعددة
  // الفواتير — invoiceSupplierContext)، ولا يبقى معرّف مورد على فاتورة ليست آجلة لمورد من القائمة
  if (inv.paySource === 'credit') { if (supplierId) payload.supplier_id = supplierId } else delete payload.supplier_id
  delete payload._paymentInitialized; delete payload._paymentSuggested; delete payload._localStub; delete payload._supplierResolution; delete payload._matchedSupplierId
  payload.review_changes = reviewChanges(original, payload)
  return payload
}

/**
 * سياق المورد لفاتورة عند الاعتماد (2026-10-20، بلاغ «الآجل لا يظهر في الصورة متعددة الفواتير»):
 *  • فاتورة مفردة: اختيار المستند كما كان (doc._supplierId / _supplierName / _supplierResolution).
 *  • صورة متعددة الفواتير: مورد كل فاتورة وحدها (invoice.supplier_id / supplier_name / _supplierResolution)؛ لا يتغلب عليها مورد
 *    المستند العام، ولا يُرسل مورد للمستند (الخادم يقدّم مورد الفاتورة ثم مورد المستند).
 */
export function invoiceSupplierContext(doc, inv, multi) {
  if (multi) return { supplierId: inv?.supplier_id || null, name: String(inv?.supplier_name ?? inv?.description ?? '').trim(),
    resolution: inv?._supplierResolution || null, matchedId: inv?._matchedSupplierId || null, documentSupplierId: null }
  return { supplierId: doc?._supplierId || null, name: String(doc?._supplierName ?? inv?.supplier_name ?? inv?.description ?? '').trim(),
    resolution: doc?._supplierResolution || null, matchedId: doc?._matchedSupplierId || null, documentSupplierId: doc?._supplierId || null }
}

/** قرار مورد «آجل — باسم المورد»: مطابق تمامًا ⇒ الموجود؛ مؤكَّد أنه الموجود ⇒ هو؛ مشابه بلا تأكيد ⇒ null (يتوقف للتأكيد)؛ وإلا جديد. */
export function payableDecision(match, ctx) {
  if (match?.matchType === 'exact') return { resolution: 'existing', supplier_id: match.supplier.id }
  if (ctx.resolution === 'existing' && ctx.matchedId) return { resolution: 'existing', supplier_id: ctx.matchedId }
  if (match?.matchType === 'fuzzy' && !ctx.resolution) return null
  return { resolution: 'new' }
}

/** سبب منع اعتماد فاتورة آجلة قبل إرسالها: مورد من القائمة غير مختار، أو اسم مشابه لمورد قائم لم يُؤكَّد. null ⇒ لا مانع. */
export function supplierBlockReason(inv, ctx, payableMatch) {
  if (inv?.type !== 'expense') return null
  if (inv.paySource === 'credit' && !ctx.supplierId) return 'اختر المورد من القائمة لهذه الفاتورة الآجلة.'
  if (inv.paySource === 'payable') {
    if (!ctx.name) return 'اكتب اسم المورد لهذه الفاتورة الآجلة.'
    if (payableMatch?.matchType === 'fuzzy' && !ctx.resolution) return `«${ctx.name}» يشبه موردًا مسجلًا («${payableMatch.supplier.name}»): أكّد هل هو نفسه أم مورد جديد.`
  }
  return null
}

export const newRequestId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)))

/** المبالغ في رسائل الاعتماد: منزلتان دائمًا. */
export const money = v => (v == null ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

const SALES_CHANNEL_NAMES = { cash: 'النقدي', network: 'الشبكة', transfer: 'التحويل', hunger: 'هنقر', jahez: 'جاهز', keeta: 'كيتا', mrsool: 'مرسول' }
/** ما تغيّر في تقرير المبيعات بالتصحيح، لكل قناة: «النقدي من 1,184.35 إلى 1,250.35». */
export function salesCorrectionChanges(previous, corrected) {
  return Object.keys(SALES_CHANNEL_NAMES).filter(k => Number(previous?.[k] || 0) !== Number(corrected?.[k] || 0))
    .map(k => `${SALES_CHANNEL_NAMES[k]} من ${money(previous?.[k] || 0)} إلى ${money(corrected?.[k] || 0)}`)
}

/** وصف عملية سابقة مشابهة لإيصال سداد: إيصال معتمد، أو دفعة قائمة، أو مستند مرفق بالدفعة، أو إيصال آخر في الطلب نفسه. */
export const dupCandidate = c => c.kind === 'batch' ? 'إيصال مشابه في الصورة نفسها'
  : `${c.kind === 'receipt' ? (c.same_reference ? 'إيصال معتمد بالمرجع نفسه' : 'إيصال معتمد بالتاريخ والمبلغ نفسيهما') : c.kind === 'payment_document' ? 'مستند مرفق بالدفعة' : 'دفعة مسجلة'}${c.journal_number ? ` ${c.journal_number}` : ''}${c.date ? ` بتاريخ ${c.date}` : ''}${c.amount != null ? ` بمبلغ ${money(c.amount)}` : ''}${c.file_name ? ` («${c.file_name}»)` : ''}`

/** رسالة عربية لرمز الخادم. linked: بيانات المستند المرتبط إن وُجد. */
export function approvalMessage(res) {
  const d = res || {}
  const M = {
    loan_incomplete: d.reason || 'أكمل بيانات سداد القرض قبل الاعتماد.',
    no_session: 'انتهت الجلسة. سجّل الدخول من جديد ثم أعد المحاولة.',
    not_found: 'المستند غير موجود أو لا يخص منشأتك.',
    forbidden: 'الاعتماد للمحاسب في المنشأة فقط.',
    legacy_mode: 'الاعتماد الجديد غير مفعّل لهذه المنشأة.',
    paused: 'الاعتماد متوقف مؤقتًا لهذه المنشأة. لم يُسجَّل شيء.',
    already_approved: `اعتُمد هذا المستند مسبقًا${d.journal_number ? ` بالقيد ${d.journal_number}` : ''}. لم يُسجَّل شيء جديد.`,
    invoice_already_decided: `هذه الفاتورة ${d.status === 'excluded' ? 'استُبعدت' : 'اعتُمدت'} مسبقًا${d.journal_number ? ` بالقيد ${d.journal_number}` : ''}. حُدّثت الصفحة.`,
    stale: 'تغيّر المستند منذ فتحته (اعتمده أو عدّله مستخدم آخر). حُدّثت الصفحة؛ راجع ثم أعد المحاولة.',
    reading_replaced: 'استُبدلت قراءة المستند؛ راجع القراءة الجديدة قبل الاعتماد.',
    bad_status: 'حالة المستند لا تسمح بالاعتماد.',
    empty: 'لا فواتير للاعتماد.',
    duplicate_in_batch: 'في المستند فاتورتان بالرقم نفسه للمورد نفسه.',
    supplier_payment_via_suppliers: 'هذه الفاتورة مصنفة «سداد مورد» كمصروف. غيّر «نوع المستند» إلى «سداد مورد» واختر المورد (يخفض مستحقه مع القيد)، أو سجّل الدفعة من «الموردين» ثم اربط الإيصال بها، أو صنّفها مصروفًا آخر. لم يُسجَّل شيء.',
    date_required: 'التاريخ مطلوب.',
    payment_split_invalid: 'أدخل حسابين مختلفين ومبلغًا موجبًا لكل حساب.',
    payment_split_mismatch: 'مجموع مبالغ الحسابين لا يساوي مبلغ السداد. راجع التقسيم.',
    payment_split_disabled: 'تقسيم السداد غير متاح في هذه النسخة. حدّث الصفحة.',
    pay_required: 'اختر مصدر الدفع.',
    type_required: 'اختر التصنيف الأساسي.',
    amount_required: 'المبلغ مطلوب.',
    vat_invalid: 'الضريبة يجب أن تكون بين صفر والإجمالي.',
    invalid_amount: 'في المبالغ قيمة غير رقمية.',
    too_many_decimals: 'المبالغ بهللتين على الأكثر.',
    negative_items: 'لا بنود سالبة: سجّل الخصم في «خصم البند» أو «خصم على الإجمالي». المرتجعات مستند مستقل لم يُدعم بعد.',
    invalid_discount: 'الخصم يجب أن يكون موجبًا وأقل من مجموع البنود.',
    discount_needs_items: 'الخصم على الإجمالي يوزَّع على البنود؛ أضف بنود الفاتورة أولًا.',
    zero_items_nonzero_vat: 'البنود صفرية والضريبة ليست صفرًا.',
    amounts_mismatch: `البنود${d.discount ? ' بعد الخصم' : ''} لا تطابق الإجمالي: الفرق ${money(Math.abs(d.difference ?? 0))} ر.س. طابق مبالغ البنود وخصوماتها والضريبة مع المستند؛ لا يُعتمد بفرق.`,
    unknown_payment: `في تقرير المبيعات وسيلة دفع غير معروفة${d.labels?.length ? `: ${d.labels.map(l => `«${l}»`).join('، ')}` : ''}. انسبها إلى قناتها أو استبعدها بسبب، ثم اعتمد. لم يُسجَّل شيء.`,
    total_required: 'اكتب إجمالي التقرير المطبوع شامل الضريبة بعد المرتجعات من التقرير نفسه، ثم اعتمد. لم يُسجَّل شيء.',
    exclusion_reason_required: 'سطر مستبعد من التقرير بلا سبب موثّق. اكتب السبب ثم اعتمد. لم يُسجَّل شيء.',
    sales_unexplained:`${d.reason || 'تقرير المبيعات فيه فرق غير مفسّر.'} لم يُسجَّل شيء.`,
    supplier_required: 'اختر المورد.',
    supplier_decision_required: `«${d.name || ''}» غير مسجّل في الموردين. أكّد أنه مورد جديد أو اختر المورد الموجود.`,
    duplicate_invoice: 'هذه الفاتورة معتمدة مسبقًا (الرقم نفسه للمورد نفسه). لا يمكن اعتمادها مرة ثانية.',
    suspected_duplicate: 'يشبه مستندًا معتمدًا. راجع المرتبط؛ إن كان مختلفًا فاكتب السبب ثم اعتمد.',
    branch_required: 'اختر الفرع لتقرير المبيعات.',
    sales_report_exists: d.changed ? 'صُحّح التقرير من مستند آخر بعد عرضه. راجع أرقامه الحالية أدناه، ثم صحّحه إن لزم؛ لم يُسجَّل شيء.'
      : 'يوجد تقرير مبيعات معتمد لهذا الفرع في هذا اليوم. لا يُنشأ تقرير ثانٍ؛ يمكن تصحيح الموجود بسبب مكتوب.',
    report_changed: 'صُحّح التقرير من مستند آخر بعد عرضه. حدّث الصفحة وراجع أرقامه؛ لم يُسجَّل شيء.',
    report_revision_required: 'حدّث الصفحة ثم أعد التصحيح.',
    negative_amount: `مبلغ «${FIELD_LABEL[d.field] || CHANNEL_LABEL[d.field] || d.field || ''}» سالب. المبالغ في المستند لا تكون سالبة؛ التخفيض يكون بتصحيح التقرير.`,
    request_reused: 'هذا الطلب سُجّل من قبل بمحتوى آخر أو لمستخدم آخر. حدّث الصفحة ثم أعد المحاولة.',
    sales_report_exists_legacy: 'يوجد تقرير مبيعات لهذا اليوم سُجّل بالطريقة السابقة. لا يُنشأ تقرير ثانٍ؛ صحّحه من صفحة المبيعات والدفتر.',
    no_report_to_correct: 'لا تقرير معتمد لهذا الفرع واليوم لتصحيحه.',
    no_change: 'الأرقام مطابقة للتقرير الموجود؛ لا تصحيح. غالبًا المستند مكرر ويمكن رفضه.',
    reason_required: 'اكتب سبب التصحيح.',
    partially_approved: 'اعتُمدت فاتورة من هذا المستند؛ استبعد الباقي بدل رفض المستند كله.',
    invoice_unknown: 'الفاتورة غير موجودة في هذا المستند.',
    invoice_mismatch: 'الفاتورة لا تخص هذا المستند.',
    invoice_id_missing: 'حدّث الصفحة ثم أعد المحاولة.',
    mode_locked: 'لا يمكن الرجوع إلى طريقة الاعتماد السابقة بعد تفعيل الجديدة.',
    category_required: 'اختر التصنيف الأساسي من القائمة قبل الاعتماد.',
    subcategory_required: 'اختر التصنيف الفرعي التابع للتصنيف الأساسي قبل الاعتماد.',
    category_invalid: 'التصنيف المختار غير موجود في منشأتك. حدّث الصفحة واختره من جديد.',
    subcategory_invalid: 'التصنيف الفرعي المختار غير موجود في منشأتك. حدّث الصفحة واختره من جديد.',
    subcategory_mismatch: `الفرعي «${d.name || ''}» لا يتبع «${d.parent || ''}». اختر فرعيًا من تحت التصنيف الرئيسي للبند.`,
    category_ambiguous: d.needs_main ? `الفرعي «${d.name || ''}» موجود تحت أكثر من تصنيف رئيسي. اختر التصنيف الرئيسي للبند.`
      : `الاسم «${d.name || ''}» يطابق أكثر من تصنيف${d.parent ? ` تحت «${d.parent}»` : ''}. اختر التصنيف من القائمة.`,
    category_inactive: `التصنيف «${d.name || ''}»${d.parent ? ` (تحت «${d.parent}»)` : ''} معطّل. اختر تصنيفًا فعّالًا؛ القيود السابقة تبقى مرتبطة به ومحسوبة.`,
    documents_without_file: `في المنشأة ${d.count || ''} مستند معلّق بلا ملف محفوظ. عالجه قبل تفعيل الاعتماد الجديد.`,
    request_id_required: 'تعذّر إنشاء معرّف الطلب.',
    network: 'انقطع الاتصال قبل وصول الرد. أعد المحاولة: لن يُسجَّل المستند مرتين.',
    app_version_stale: STALE_MESSAGE,
    channel_not_enabled: `قناة «${d.label || CHANNEL_LABEL[d.channel] || d.channel || ''}» غير مفعّلة لفرع «${d.branch || ''}». صحّح الفرع أو انقل المبلغ إلى القناة الصحيحة؛ لم يُسجَّل شيء.`,
    bank_account_required: `اختر الحساب البنكي${d.branch ? ` لفرع «${d.branch}»` : ''}: أكثر من حساب متاح لهذه الحركة. لم يُسجَّل شيء.`,
    // R1-01: التصحيح يسجّل فرق كل قناة بنكية على حساب مبلغها الأصلي
    bank_account_mismatch: `مبلغ «${d.label || CHANNEL_LABEL[d.channel] || ''}» في التقرير الأصلي على حساب «${d.account || ''}»، والتصحيح يُسجَّل على الحساب نفسه. اختر «${d.account || ''}» في حقل الحساب البنكي؛ لم يُسجَّل شيء.`,
    report_entries_unproven: `قيود «${d.label || CHANNEL_LABEL[d.channel] || ''}» في التقرير الموجود ${d.split ? 'موزعة على أكثر من حساب' : `لا تطابق رقمه (${money(d.report)} مقابل ${money(d.entries)})`}، فلا يُعرف حسابها. راجع قيود التقرير في «سجل الدفتر» قبل التصحيح؛ لم يُسجَّل شيء.`,
    bank_account_unassigned: `مبلغ «${d.label || CHANNEL_LABEL[d.channel] || ''}» في التقرير الأصلي غير مربوط بحساب بنكي. اربطه بحسابه من «سجل الدفتر» (ربط بحساب)، ثم صحّح؛ لم يُسجَّل شيء.`,
    // إيصالات سداد الموردين (20261020120000)
    exceeds_balance: `مبلغ السداد أكبر من المستحق${d.name ? ` لـ«${d.name}»` : ''} (${money(d.balance)}). راجع المبلغ أو المورد؛ لم يُسجَّل شيء.`,
    // اشتباه تكرار إيصال سداد (20261020120000): يُعرض السابق، والمحاسب أو إدارة تحسيب يحسم بسبب مكتوب
    payment_possible_duplicate: `قد يكون هذا الإيصال مكررًا لـ«${d.name || 'المورد'}»: ${(d.candidates || []).map(dupCandidate).join('؛ ') || 'عملية سابقة مشابهة'}. التشابه لا يثبت التكرار: ${d.mode === 'link' ? 'إن كان مستندًا آخر للدفعة نفسها (مثل سند قبض المورد مع إشعار التحويل) فاكتب ذلك سببًا ثم اعتمد' : 'إن كانت الدفعة نفسها فاختر «ربط بدفعة مسجلة»، وإن كانت دفعة مختلفة فعلًا فاكتب السبب ثم اعتمد'}؛ وإن كانت نسخة مكررة فارفضها. لم يُسجَّل شيء.`,
    link_amount_mismatch: `مبلغ الإيصال (${money(d.amount)}) لا يساوي مبلغ الدفعة ${d.journal_number || ''} (${money(d.payment_amount)}). الربط بمبلغ مختلف يضلل؛ صحّح المبلغ أو اختر دفعة أخرى. لم يُسجَّل شيء.`,
    link_not_found: `الدفعة ${d.journal_number || ''} غير موجودة (ربما حُذفت). اختر دفعة أخرى أو سجّلها دفعة جديدة؛ لم يُسجَّل شيء.`,
    link_supplier_mismatch: `الدفعة ${d.journal_number || ''} ليست لـ«${d.name || 'المورد المختار'}». اختر دفعة لهذا المورد؛ لم يُسجَّل شيء.`,
    link_required: 'اختر الدفعة المسجلة التي يخصها الإيصال.',
    payment_mode_required: 'اختر: تسجيل دفعة جديدة، أو ربط بدفعة مسجلة.',
    payment_deleted: `الدفعة ${d.journal_number || ''} المسجلة من هذا الإيصال حُذفت من «سجل الدفتر» بعد اعتماده، فعاد الإيصال بانتظار الاعتماد. حُدّثت الصفحة؛ راجعه ثم اعتمده من جديد إن كان صحيحًا.`,
    bank_transfer_accounts: 'اختر حسابين بنكيين مختلفين: حساب الخروج وحساب الدخول.',
    bank_transfer_pair_edit: 'عدّل التحويل بين الحسابين من حواره؛ يجب حفظ طرفيه معًا.',
    bank_transfer_pair_required: 'سجّل التحويل من مستند التحويل ليُنشأ طرفاه معًا.',
    bank_account_invalid: `الحساب البنكي المختار غير متاح${d.branch ? ` لفرع «${d.branch}»` : ''} أو معطّل. اختر حسابًا من القائمة؛ لم يُسجَّل شيء.`,
  }
  return M[d.code] || `تعذّر الإجراء (${d.code || 'غير معروف'}).`
}
