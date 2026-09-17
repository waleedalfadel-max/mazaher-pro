/**
 * منطق نموذج «معمل تتميرا» التجريبي — دوال نقية بلا شبكة ولا تخزين.
 *
 * القواعد:
 * - المستند المرفوع يبقى «بانتظار المراجعة» ولا يؤثر في أي رقم حتى يُعتمد.
 * - اعتماد فاتورة البيع يثبت كامل قيمتها على العميل ويرفع المبيعات، ولا يمس النقد أو البنك.
 * - اعتماد السداد يرفع النقد/البنك ويخفض المستحق، ولا يغيّر المبيعات أو الضريبة.
 * - الزائد عن التوزيع يبقى رصيداً دائناً للعميل، ولا يجعل أي فاتورة سالبة.
 * - الاعتماد لا يتكرر: المستند المعتمد لا يُعتمد مرة ثانية.
 * - الرصيد الافتتاحي مستحق سابق وليس مبيعات.
 *
 * المبالغ بالهللة. كل إجراء يعيد { state, error?, code? } ولا يعدّل الحالة الأصلية.
 */
import { normalizeWhatsapp } from './whatsapp.js'

export const STATE_VERSION = 1

export const DOC_KINDS = {
  sale:     'فاتورة بيع',
  payment:  'إثبات سداد',
  purchase: 'فاتورة مشتريات',
}

export const REVIEW_STATUS = {
  pending:  'بانتظار المراجعة',
  approved: 'معتمد',
  rejected: 'مرفوض',
}

export const PAY_STATUS = {
  unpaid:  'غير مسددة',
  partial: 'مسددة جزئياً',
  paid:    'مسددة بالكامل',
}

export const OPENING = 'opening'

let fallbackCounter = 0
export function newId(prefix = 'id') {
  const uuid = globalThis.crypto?.randomUUID?.()
  return `${prefix}-${uuid || `${Date.now().toString(36)}-${(++fallbackCounter).toString(36)}`}`
}

export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── البذرة ─────────────────────────────────────────────────────────────────

export function createInitialState({ today = todayISO() } = {}) {
  const [y, m] = today.split('-').map(Number)
  const openingDate = todayISO(new Date(y, m - 2, 1)) // أول الشهر السابق
  const openings = { 1: 250000, 2: 120000, 3: 80000 } // أرصدة افتتاحية تجريبية لثلاث نقاط فقط
  return {
    version: STATE_VERSION,
    lab: { name: 'معمل تتميرا', city: '', phone: '', vatNumber: '', crNumber: '' },
    customers: Array.from({ length: 10 }, (_, i) => ({
      id: `cust-${i + 1}`,
      name: `نقطة بيع ${i + 1}`,
      whatsapp: '',
      archived: false,
      openingBalance: openings[i + 1] || 0,
      openingDate,
    })),
    accounts: [
      { id: 'acc-cash', name: 'الصندوق', kind: 'cash', archived: false },
      { id: 'acc-bank', name: 'البنك — الحساب الجاري', kind: 'bank', archived: false },
    ],
    categories: [
      { id: 'cat-dates',   name: 'تمور',                 kind: 'direct',    archived: false },
      { id: 'cat-flour',   name: 'دقيق وسميد',           kind: 'direct',    archived: false },
      { id: 'cat-butter',  name: 'سمن وزبدة',            kind: 'direct',    archived: false },
      { id: 'cat-pack',    name: 'مواد تغليف',           kind: 'direct',    archived: false },
      { id: 'cat-power',   name: 'كهرباء وماء',          kind: 'operating', archived: false },
      { id: 'cat-rent',    name: 'إيجار',                kind: 'operating', archived: false },
      { id: 'cat-salary',  name: 'رواتب',                kind: 'operating', archived: false },
      { id: 'cat-deliver', name: 'نقل وتوصيل',           kind: 'operating', archived: false },
    ],
    documents: [],
    invoices: [],
    payments: [],
    purchases: [],
    counters: { sample: 0 },
  }
}

// ── بيانات الاستخراج التجريبية ─────────────────────────────────────────────
// ليست قراءة للملف: قيم ثابتة معلّمة `sample: true` يعدّلها المستخدم قبل الاعتماد.

export function sampleFields(kind, state, today) {
  const n = (state.counters?.sample || 0) + 1
  if (kind === 'sale') {
    return {
      customerId: '',
      number: `DEMO-${String(n).padStart(4, '0')}`,
      date: today,
      lines: [
        { id: newId('line'), desc: 'معمول تمر — علبة', qty: 10, price: 5000 },
        { id: newId('line'), desc: 'كعك تمر — علبة',   qty: 10, price: 5000 },
      ],
      vatMode: 'standard',
      vat: 15000,
    }
  }
  if (kind === 'payment') {
    return { customerId: '', date: today, amount: 60000, accountId: 'acc-bank', reference: '', allocations: [] }
  }
  return {
    supplier: 'مورد تجريبي', number: `P-DEMO-${String(n).padStart(4, '0')}`, date: today,
    categoryId: 'cat-dates', description: 'تمور خام', net: 20000, vat: 3000, accountId: 'acc-bank',
  }
}

// ── حسابات مساعدة ──────────────────────────────────────────────────────────

export function linesNet(lines = []) {
  return lines.reduce((s, l) => s + Math.round((Number(l.qty) || 0) * (Number(l.price) || 0)), 0)
}

export function saleTotals(fields) {
  const net = linesNet(fields.lines)
  const vat = fields.vatMode === 'none' ? 0 : Math.max(0, Math.round(Number(fields.vat) || 0))
  return { net, vat, total: net + vat }
}

function normalizeNumber(num) {
  return String(num ?? '').trim().replace(/\s+/g, '').toUpperCase()
}

export function findCustomer(state, id) {
  return state.customers.find(c => c.id === id)
}

export function invoicePaid(state, invoiceId) {
  let paid = 0
  for (const p of state.payments) for (const a of p.allocations) if (a.target === invoiceId) paid += a.amount
  return paid
}

export function openingPaid(state, customerId) {
  let paid = 0
  for (const p of state.payments) {
    if (p.customerId !== customerId) continue
    for (const a of p.allocations) if (a.target === OPENING) paid += a.amount
  }
  return paid
}

export function payStatus(total, paid) {
  if (paid <= 0) return 'unpaid'
  if (paid >= total) return 'paid'
  return 'partial'
}

export function invoiceView(state, inv) {
  const paid = invoicePaid(state, inv.id)
  const remaining = Math.max(0, inv.total - paid)
  return { ...inv, paid, remaining, payStatus: payStatus(inv.total, paid) }
}

/** البنود المفتوحة للعميل (الافتتاحي أولاً ثم الأقدم فالأحدث) */
export function openItems(state, customerId) {
  const c = findCustomer(state, customerId)
  if (!c) return []
  const items = []
  const openingRemaining = Math.max(0, (c.openingBalance || 0) - openingPaid(state, customerId))
  if (openingRemaining > 0) {
    items.push({ target: OPENING, label: 'رصيد افتتاحي تجريبي', date: c.openingDate, total: c.openingBalance, remaining: openingRemaining })
  }
  state.invoices
    .filter(i => i.customerId === customerId)
    .map(i => invoiceView(state, i))
    .filter(i => i.remaining > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.approvedSeq - b.approvedSeq)
    .forEach(i => items.push({ target: i.id, label: `فاتورة ${i.number}`, date: i.date, total: i.total, remaining: i.remaining }))
  return items
}

/** اقتراح توزيع المبلغ على الأقدم */
export function suggestAllocations(state, customerId, amount) {
  let left = Math.max(0, Math.round(amount || 0))
  const out = []
  for (const item of openItems(state, customerId)) {
    if (left <= 0) break
    const take = Math.min(left, item.remaining)
    out.push({ target: item.target, amount: take })
    left -= take
  }
  return out
}

export function customerSummary(state, customerId, { to } = {}) {
  const c = findCustomer(state, customerId)
  if (!c) return null
  const within = d => !to || d <= to
  const opening = within(c.openingDate) ? (c.openingBalance || 0) : 0
  const invoiced = state.invoices.filter(i => i.customerId === customerId && within(i.date)).reduce((s, i) => s + i.total, 0)
  const paid = state.payments.filter(p => p.customerId === customerId && within(p.date)).reduce((s, p) => s + p.amount, 0)
  const balance = opening + invoiced - paid
  return { opening, invoiced, paid, balance, due: Math.max(0, balance), credit: Math.max(0, -balance) }
}

export function hasMovements(state, customerId) {
  const c = findCustomer(state, customerId)
  if (!c) return false
  return (c.openingBalance || 0) !== 0
    || state.invoices.some(i => i.customerId === customerId)
    || state.payments.some(p => p.customerId === customerId)
    || state.documents.some(d => d.status !== 'rejected' && d.fields?.customerId === customerId)
}

/** كشف حساب العميل لفترة، مع رصيد سابق للفترة */
export function statement(state, customerId, { from = '', to = '' } = {}) {
  const c = findCustomer(state, customerId)
  if (!c) return null
  const moves = []
  if (c.openingBalance) {
    moves.push({ key: 'opening', date: c.openingDate, seq: -1, kind: 'opening', label: 'رصيد افتتاحي تجريبي', ref: '', debit: c.openingBalance, credit: 0 })
  }
  for (const i of state.invoices.filter(i => i.customerId === customerId)) {
    moves.push({ key: i.id, date: i.date, seq: i.approvedSeq, kind: 'invoice', label: 'فاتورة بيع', ref: i.number, debit: i.total, credit: 0 })
  }
  for (const p of state.payments.filter(p => p.customerId === customerId)) {
    moves.push({ key: p.id, date: p.date, seq: p.approvedSeq, kind: 'payment', label: 'سداد', ref: p.reference || '', debit: 0, credit: p.amount })
  }
  moves.sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq)

  let prior = 0
  const rows = []
  let running = 0
  let started = false
  for (const m of moves) {
    if (from && m.date < from) { prior += m.debit - m.credit; continue }
    if (to && m.date > to) continue
    if (!started) { running = prior; started = true }
    running += m.debit - m.credit
    rows.push({ ...m, balance: running })
  }
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0)
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0)
  return { customer: c, from, to, prior, rows, totalDebit, totalCredit, closing: prior + totalDebit - totalCredit }
}

export function accountBalances(state, { to } = {}) {
  const within = d => !to || d <= to
  return state.accounts.map(a => {
    const inflow = state.payments.filter(p => p.accountId === a.id && within(p.date)).reduce((s, p) => s + p.amount, 0)
    const outflow = state.purchases.filter(p => p.accountId === a.id && within(p.date)).reduce((s, p) => s + p.total, 0)
    return { ...a, inflow, outflow, balance: inflow - outflow }
  })
}

/** لوحة المالك — من المعتمد فقط */
export function ownerDashboard(state, { from = '', to = '' } = {}) {
  const inRange = d => (!from || d >= from) && (!to || d <= to)
  const inv = state.invoices.filter(i => inRange(i.date))
  const pays = state.payments.filter(p => inRange(p.date))
  const purch = state.purchases.filter(p => inRange(p.date))
  const catKind = id => state.categories.find(c => c.id === id)?.kind

  const salesNet = inv.reduce((s, i) => s + i.net, 0)
  const salesVat = inv.reduce((s, i) => s + i.vat, 0)
  const collected = pays.reduce((s, p) => s + p.amount, 0)
  const direct = purch.filter(p => catKind(p.categoryId) === 'direct').reduce((s, p) => s + p.net, 0)
  const operating = purch.filter(p => catKind(p.categoryId) === 'operating').reduce((s, p) => s + p.net, 0)
  const inputVat = purch.reduce((s, p) => s + p.vat, 0)

  let due = 0, credit = 0
  for (const c of state.customers) {
    const sum = customerSummary(state, c.id, { to })
    due += sum.due
    credit += sum.credit
  }
  return {
    salesNet, salesVat, salesGross: salesNet + salesVat,
    invoicesCount: inv.length,
    invoicesWithoutVat: inv.filter(i => i.vat === 0).length,
    collected, paymentsCount: pays.length,
    due, credit,
    direct, operating, inputVat,
    estimatedProfit: salesNet - direct - operating,
    pendingDocs: state.documents.filter(d => d.status === 'pending').length,
    accounts: accountBalances(state, { to }),
  }
}

export function duplicateInvoiceNumber(state, number, { excludeDocId } = {}) {
  const n = normalizeNumber(number)
  if (!n) return null
  const approved = state.invoices.find(i => normalizeNumber(i.number) === n)
  if (approved) return { where: 'approved', invoice: approved }
  const pending = state.documents.find(d => d.id !== excludeDocId && d.kind === 'sale' && d.status === 'pending' && normalizeNumber(d.fields?.number) === n)
  if (pending) return { where: 'pending', document: pending }
  return null
}

// ── الإجراءات ──────────────────────────────────────────────────────────────

const fail = (state, code, error) => ({ state, code, error })
const ok = state => ({ state })

function nextSeq(state) {
  return (state.counters?.approved || 0) + 1
}

function withCounters(state, patch) {
  return { ...state, counters: { ...state.counters, ...patch } }
}

export function reduce(state, action) {
  switch (action.type) {
    case 'LAB_UPDATE':
      return ok({ ...state, lab: { ...state.lab, ...action.patch } })

    case 'CUSTOMER_ADD': {
      const name = String(action.name || '').trim()
      if (!name) return fail(state, 'NAME_REQUIRED', 'اكتب اسم العميل')
      if (state.customers.some(c => c.id === action.id)) return ok(state) // ضغط مكرر
      if (state.customers.some(c => !c.archived && c.name.trim() === name)) return fail(state, 'NAME_EXISTS', 'يوجد عميل بنفس الاسم')
      const whatsapp = normalizeWhatsapp(action.whatsapp)
      if (whatsapp === null) return fail(state, 'BAD_WHATSAPP', 'رقم الواتساب غير صحيح')
      const customer = { id: action.id || newId('cust'), name, whatsapp, archived: false, openingBalance: 0, openingDate: action.today || todayISO() }
      return ok({ ...state, customers: [...state.customers, customer] })
    }

    case 'CUSTOMER_UPDATE': {
      const c = findCustomer(state, action.id)
      if (!c) return fail(state, 'NOT_FOUND', 'العميل غير موجود')
      const patch = {}
      if ('name' in action) {
        const name = String(action.name || '').trim()
        if (!name) return fail(state, 'NAME_REQUIRED', 'اكتب اسم العميل')
        if (state.customers.some(o => o.id !== c.id && !o.archived && o.name.trim() === name)) return fail(state, 'NAME_EXISTS', 'يوجد عميل بنفس الاسم')
        patch.name = name
      }
      if ('whatsapp' in action) {
        const w = normalizeWhatsapp(action.whatsapp)
        if (w === null) return fail(state, 'BAD_WHATSAPP', 'رقم الواتساب غير صحيح')
        patch.whatsapp = w
      }
      return ok({ ...state, customers: state.customers.map(o => o.id === c.id ? { ...o, ...patch } : o) })
    }

    case 'CUSTOMER_ARCHIVE': {
      if (!findCustomer(state, action.id)) return fail(state, 'NOT_FOUND', 'العميل غير موجود')
      return ok({ ...state, customers: state.customers.map(o => o.id === action.id ? { ...o, archived: !!action.archived } : o) })
    }

    case 'CUSTOMER_DELETE': {
      if (!findCustomer(state, action.id)) return ok(state)
      if (hasMovements(state, action.id)) return fail(state, 'HAS_MOVEMENTS', 'لا يمكن حذف عميل لديه حركات — يمكنك أرشفته')
      return ok({ ...state, customers: state.customers.filter(o => o.id !== action.id) })
    }

    case 'ACCOUNT_SAVE': {
      const name = String(action.name || '').trim()
      if (!name) return fail(state, 'NAME_REQUIRED', 'اكتب اسم الحساب')
      if (!['cash', 'bank'].includes(action.kind)) return fail(state, 'BAD_KIND', 'نوع الحساب غير صحيح')
      const exists = state.accounts.find(a => a.id === action.id)
      const accounts = exists
        ? state.accounts.map(a => a.id === action.id ? { ...a, name, kind: action.kind } : a)
        : [...state.accounts, { id: action.id || newId('acc'), name, kind: action.kind, archived: false }]
      return ok({ ...state, accounts })
    }

    case 'ACCOUNT_ARCHIVE':
      return ok({ ...state, accounts: state.accounts.map(a => a.id === action.id ? { ...a, archived: !!action.archived } : a) })

    case 'CATEGORY_SAVE': {
      const name = String(action.name || '').trim()
      if (!name) return fail(state, 'NAME_REQUIRED', 'اكتب اسم التصنيف')
      if (!['direct', 'operating'].includes(action.kind)) return fail(state, 'BAD_KIND', 'نوع التصنيف غير صحيح')
      const exists = state.categories.find(c => c.id === action.id)
      const categories = exists
        ? state.categories.map(c => c.id === action.id ? { ...c, name, kind: action.kind } : c)
        : [...state.categories, { id: action.id || newId('cat'), name, kind: action.kind, archived: false }]
      return ok({ ...state, categories })
    }

    case 'CATEGORY_ARCHIVE':
      return ok({ ...state, categories: state.categories.map(c => c.id === action.id ? { ...c, archived: !!action.archived } : c) })

    case 'DOC_ADD': {
      if (!DOC_KINDS[action.kind]) return fail(state, 'BAD_KIND', 'نوع المستند غير صحيح')
      if (!action.file?.id) return fail(state, 'FILE_REQUIRED', 'اختر ملف المستند')
      if (state.documents.some(d => d.id === action.id)) return ok(state)
      const today = action.today || todayISO()
      const doc = {
        id: action.id || newId('doc'),
        kind: action.kind,
        file: { id: action.file.id, name: action.file.name, type: action.file.type, size: action.file.size },
        uploadedAt: action.uploadedAt || new Date().toISOString(),
        status: 'pending',
        sample: true,
        fields: { ...sampleFields(action.kind, state, today), ...(action.fields || {}) },
      }
      return ok(withCounters({ ...state, documents: [doc, ...state.documents] }, { sample: (state.counters?.sample || 0) + 1 }))
    }

    case 'DOC_UPDATE_FIELDS': {
      const doc = state.documents.find(d => d.id === action.id)
      if (!doc) return fail(state, 'NOT_FOUND', 'المستند غير موجود')
      if (doc.status !== 'pending') return fail(state, 'NOT_PENDING', 'لا يمكن تعديل مستند بعد مراجعته')
      return ok({ ...state, documents: state.documents.map(d => d.id === doc.id ? { ...d, fields: { ...d.fields, ...action.fields } } : d) })
    }

    case 'DOC_REJECT': {
      const doc = state.documents.find(d => d.id === action.id)
      if (!doc || doc.status !== 'pending') return ok(state)
      return ok({ ...state, documents: state.documents.map(d => d.id === doc.id ? { ...d, status: 'rejected', reviewedAt: action.at || new Date().toISOString() } : d) })
    }

    case 'DOC_APPROVE':
      return approveDocument(state, action)

    default:
      return fail(state, 'UNKNOWN_ACTION', 'إجراء غير معروف')
  }
}

function approveDocument(state, action) {
  const doc = state.documents.find(d => d.id === action.id)
  if (!doc) return fail(state, 'NOT_FOUND', 'المستند غير موجود')
  // منع تكرار الاعتماد: الضغطة الثانية لا تنشئ حركة جديدة
  if (doc.status === 'approved') return { state, code: 'ALREADY_APPROVED' }
  if (doc.status !== 'pending') return fail(state, 'NOT_PENDING', 'المستند ليس بانتظار المراجعة')
  if (!doc.file?.id) return fail(state, 'FILE_REQUIRED', 'المستند إلزامي')

  const at = action.at || new Date().toISOString()
  const seq = nextSeq(state)
  const f = doc.fields
  let next

  if (doc.kind === 'sale') {
    const c = findCustomer(state, f.customerId)
    if (!c) return fail(state, 'CUSTOMER_REQUIRED', 'اختر العميل')
    if (c.archived) return fail(state, 'CUSTOMER_ARCHIVED', 'العميل مؤرشف')
    if (!String(f.number || '').trim()) return fail(state, 'NUMBER_REQUIRED', 'اكتب رقم الفاتورة')
    if (!f.date) return fail(state, 'DATE_REQUIRED', 'اختر تاريخ الفاتورة')
    const lines = (f.lines || []).filter(l => String(l.desc || '').trim() || l.qty || l.price)
    if (!lines.length) return fail(state, 'LINES_REQUIRED', 'أضف بنداً واحداً على الأقل')
    if (lines.some(l => !(Number(l.qty) > 0) || !(Number(l.price) >= 0) || !String(l.desc || '').trim())) {
      return fail(state, 'BAD_LINE', 'راجع البنود: الوصف والكمية والسعر')
    }
    const { net, vat, total } = saleTotals({ ...f, lines })
    if (net <= 0) return fail(state, 'BAD_TOTAL', 'صافي الفاتورة يجب أن يكون أكبر من صفر')
    const dup = state.invoices.find(i => normalizeNumber(i.number) === normalizeNumber(f.number))
    if (dup && !action.confirmDuplicate) {
      return fail(state, 'DUPLICATE_NUMBER', `رقم الفاتورة ${f.number} معتمد سابقاً — تأكد أنها ليست مكررة`)
    }
    const invoice = {
      id: `inv-${doc.id}`, docId: doc.id, customerId: c.id, number: String(f.number).trim(), date: f.date,
      lines: lines.map(l => ({ desc: String(l.desc).trim(), qty: Number(l.qty), price: Math.round(Number(l.price)) })),
      net, vat, total, approvedAt: at, approvedSeq: seq,
    }
    next = { ...state, invoices: [...state.invoices, invoice] }
  } else if (doc.kind === 'payment') {
    const c = findCustomer(state, f.customerId)
    if (!c) return fail(state, 'CUSTOMER_REQUIRED', 'اختر العميل')
    if (!f.date) return fail(state, 'DATE_REQUIRED', 'اختر تاريخ السداد')
    const amount = Math.round(Number(f.amount) || 0)
    if (amount <= 0) return fail(state, 'AMOUNT_REQUIRED', 'مبلغ السداد يجب أن يكون أكبر من صفر')
    const account = state.accounts.find(a => a.id === f.accountId)
    if (!account || account.archived) return fail(state, 'ACCOUNT_REQUIRED', 'اختر الحساب المستلم')

    const allocations = (f.allocations || []).filter(a => Math.round(Number(a.amount) || 0) > 0)
      .map(a => ({ target: a.target, amount: Math.round(Number(a.amount)) }))
    const open = new Map(openItems(state, c.id).map(i => [i.target, i]))
    const seen = new Set()
    for (const a of allocations) {
      if (seen.has(a.target)) return fail(state, 'DUPLICATE_ALLOCATION', 'الفاتورة مكررة في التوزيع')
      seen.add(a.target)
      if (a.target !== OPENING) {
        const inv = state.invoices.find(i => i.id === a.target)
        if (!inv) return fail(state, 'ALLOCATION_NOT_FOUND', 'فاتورة التوزيع غير موجودة')
        if (inv.customerId !== c.id) return fail(state, 'ALLOCATION_OTHER_CUSTOMER', 'لا يمكن توزيع الدفعة على فاتورة عميل آخر')
      }
      const item = open.get(a.target)
      if (!item) return fail(state, 'ALLOCATION_CLOSED', 'البند المختار مسدد بالكامل')
      if (a.amount > item.remaining) return fail(state, 'ALLOCATION_EXCEEDS', `المبلغ الموزع على ${item.label} أكبر من المتبقي`)
    }
    const allocated = allocations.reduce((s, a) => s + a.amount, 0)
    if (allocated > amount) return fail(state, 'ALLOCATION_OVER_AMOUNT', 'مجموع التوزيع أكبر من مبلغ السداد')

    const payment = {
      id: `pay-${doc.id}`, docId: doc.id, customerId: c.id, date: f.date, amount, accountId: account.id,
      reference: String(f.reference || '').trim(), allocations, unallocated: amount - allocated,
      approvedAt: at, approvedSeq: seq,
    }
    next = { ...state, payments: [...state.payments, payment] }
  } else {
    if (!String(f.supplier || '').trim()) return fail(state, 'SUPPLIER_REQUIRED', 'اكتب اسم المورد')
    if (!f.date) return fail(state, 'DATE_REQUIRED', 'اختر تاريخ الفاتورة')
    const category = state.categories.find(c => c.id === f.categoryId)
    if (!category || category.archived) return fail(state, 'CATEGORY_REQUIRED', 'اختر التصنيف')
    const account = state.accounts.find(a => a.id === f.accountId)
    if (!account || account.archived) return fail(state, 'ACCOUNT_REQUIRED', 'اختر حساب الدفع')
    const net = Math.round(Number(f.net) || 0)
    const vat = Math.max(0, Math.round(Number(f.vat) || 0))
    if (net <= 0) return fail(state, 'BAD_TOTAL', 'المبلغ قبل الضريبة يجب أن يكون أكبر من صفر')
    const purchase = {
      id: `pur-${doc.id}`, docId: doc.id, supplier: String(f.supplier).trim(), number: String(f.number || '').trim(),
      date: f.date, categoryId: category.id, description: String(f.description || '').trim(),
      net, vat, total: net + vat, accountId: account.id, approvedAt: at, approvedSeq: seq,
    }
    next = { ...state, purchases: [...state.purchases, purchase] }
  }

  next = {
    ...next,
    documents: next.documents.map(d => d.id === doc.id ? { ...d, status: 'approved', reviewedAt: at } : d),
  }
  return ok(withCounters(next, { approved: seq }))
}

export function migrate(saved, today) {
  if (!saved || saved.version !== STATE_VERSION || !Array.isArray(saved.customers)) return createInitialState({ today })
  return saved
}
