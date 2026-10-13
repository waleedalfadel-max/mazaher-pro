// نموذج التصميم: منطق عرض نقي على بيانات مصطنعة. لا يستورد شيئًا من التطبيق الحالي،
// ولا يلمس منطق الاعتماد فيه (PendingDocuments.jsx). يُختبر في tests/prototype-model.test.js.
import { addDays, daysBetween, formatDate, formatNumber, parseDate, plural, toISO, weekday } from '../ui/format.js'

/** "اليوم" ثابت في النموذج حتى تبقى الصور والأرقام قابلة للمقارنة بين جولات المراجعة. */
export const TODAY = '2026-09-26'
export const NOW = '2026-09-26T11:05'
export const VAT_RATE = 0.15

export const USERS = {
  owner: { name: 'عبدالله', role: 'المالك' },
  accountant: { name: 'نورة', role: 'المحاسبة' },
  purchasing: { name: 'خالد', role: 'المشتريات' },
  cashier: { name: 'ماجد', role: 'الكاشير' },
}
export const CURRENT_USER = USERS.owner

// ── نطاق كل رقم ─────────────────────────────────────────────────────────────
// كل مستند معتمد يقع في نوع واحد فقط، فلا تُحسب المشتريات ضمن المصروفات ولا العكس.
export const KINDS = {
  purchase: { label: 'مشتريات', hint: 'مواد تدخل في الأطباق والمشروبات، والتغليف' },
  expense: { label: 'مصروف تشغيلي', hint: 'إيجار، رواتب، كهرباء، صيانة، عمولات التطبيقات…' },
  sales: { label: 'مبيعات', hint: 'تقرير إغلاق نقاط البيع' },
}

export const SCOPES = [
  { key: 'sales', title: 'المبيعات', text: 'مبيعات مسجّلة لأيام الفترة من كل القنوات (الصندوق والشبكة وتطبيقات التوصيل)، قبل ضريبة القيمة المضافة. تقرير الإغلاق لا يُحسب قبل اعتماده.' },
  { key: 'purchases', title: 'المشتريات', text: 'فواتير موردين معتمدة لمواد تدخل في الأطباق والمشروبات والتغليف، بتاريخ الفاتورة، قبل الضريبة.' },
  { key: 'expenses', title: 'المصروفات التشغيلية', text: 'مستندات معتمدة لتكاليف التشغيل: إيجار، رواتب، كهرباء وماء، غاز، صيانة، عمولات التطبيقات وغيرها، قبل الضريبة. لا تشمل المشتريات.' },
  { key: 'waiting', title: 'بانتظار المراجعة', text: 'مستندات مرفوعة لم تُعتمد ولم تُرفض بعد، من كل التواريخ. لا يدخل أي منها في الأرقام الثلاثة قبل اعتماده.' },
]

export const CATEGORIES = {
  purchase: ['خضار وفواكه', 'لحوم ودواجن', 'مخبوزات', 'ألبان وأجبان', 'مواد جافة وبهارات', 'مشروبات', 'تغليف وأدوات تقديم'],
  expense: ['رواتب وأجور', 'إيجار', 'كهرباء وماء', 'غاز', 'صيانة ونظافة', 'عمولات تطبيقات التوصيل', 'تسويق وإعلان', 'اشتراكات وأنظمة', 'مصروفات أخرى'],
  sales: ['تقرير إغلاق نقاط البيع'],
}

export const PAYMENTS = [
  { value: 'cash', label: 'من الصندوق (نقدًا)' },
  { value: 'bank', label: 'من البنك' },
  { value: 'custody', label: 'من العهدة' },
  { value: 'credit', label: 'آجل على المورد' },
]

export const STATUSES = {
  reading: { label: 'قيد القراءة الآلية', tone: 'info', busy: true },
  pending: { label: 'بانتظار المراجعة', tone: 'warning' },
  approved: { label: 'معتمد', tone: 'success' },
  rejected: { label: 'مرفوض', tone: 'danger' },
}

export const CHANNELS = ['نقدي', 'شبكة (مدى)', 'هنقر ستيشن', 'جاهز', 'كيتا', 'مرسول']

export const REJECT_REASONS = [
  { value: 'unclear', label: 'الصورة غير واضحة' },
  { value: 'duplicate', label: 'المستند مكرر' },
  { value: 'not-ours', label: 'ليس مستندًا ماليًا للمنشأة' },
  { value: 'incomplete', label: 'المستند ناقص (صفحة أو بيانات مفقودة)' },
  { value: 'other', label: 'سبب آخر' },
]

// ── الفترات ─────────────────────────────────────────────────────────────────
export const PERIODS = [
  { value: 'today', label: 'اليوم' },
  { value: 'week', label: 'الأسبوع' },
  { value: 'month', label: 'الشهر' },
  { value: 'last-month', label: 'الشهر الماضي' },
  { value: 'custom', label: 'مخصص' },
]

/** نطاق الفترة شاملًا طرفيه. الأسبوع يبدأ الأحد. */
export function periodRange(key, today = TODAY, custom = {}) {
  const { y, m } = parseDate(today)
  switch (key) {
    case 'today': return { from: today, to: today }
    case 'week': return { from: addDays(today, -weekday(today)), to: today }
    case 'last-month': return { from: toISO(y, m - 1, 1), to: addDays(toISO(y, m, 1), -1) }
    case 'custom': {
      const from = custom.from || toISO(y, m, 1)
      const to = custom.to || today
      return from <= to ? { from, to } : { from: to, to: from }
    }
    default: return { from: toISO(y, m, 1), to: today }
  }
}

export const inRange = (date, { from, to }) => !!date && date >= from && date <= to

// ── المبالغ ─────────────────────────────────────────────────────────────────
export const round2 = v => Math.round((Number(v) || 0) * 100) / 100
const sum = (list, pick) => round2(list.reduce((t, x) => t + pick(x), 0))

export function lineAmount(line) {
  return round2((Number(line.qty) || 0) * (Number(line.price) || 0))
}

/** مجموع البنود قبل الضريبة، والضريبة، والإجمالي المحسوب، والفرق عن الرقم المطبوع. */
export function docTotals(doc) {
  const subtotal = sum(doc.lines || [], lineAmount)
  const vat = round2(subtotal * (doc.vatRate ?? VAT_RATE))
  const total = round2(subtotal + vat)
  const printed = doc.printedTotal === '' || doc.printedTotal == null ? null : round2(doc.printedTotal)
  const difference = printed == null ? 0 : round2(printed - total)
  return { subtotal, vat, total, printed, difference }
}

// ── ملخص الرئيسية ───────────────────────────────────────────────────────────
export function summarize(state, range) {
  const approved = state.documents.filter(d => d.status === 'approved' && inRange(d.invoiceDate, range))
  const purchases = approved.filter(d => d.kind === 'purchase')
  const expenses = approved.filter(d => d.kind === 'expense')
  const sales = state.sales.filter(s => inRange(s.date, range))
  const pending = state.documents.filter(d => d.status === 'pending')
  const reading = state.documents.filter(d => d.status === 'reading')
  const oldest = pending.reduce((min, d) => (!min || d.uploadedAt < min ? d.uploadedAt : min), null)
  return {
    sales: { amount: sum(sales, s => s.amount), days: new Set(sales.map(s => s.date)).size },
    purchases: { amount: sum(purchases, d => docTotals(d).subtotal), count: purchases.length },
    expenses: { amount: sum(expenses, d => docTotals(d).subtotal), count: expenses.length },
    waiting: { count: pending.length, reading: reading.length, oldestDays: oldest ? daysBetween(oldest.slice(0, 10), TODAY) : null },
  }
}

/** المصروفات التشغيلية المعتمدة حسب التصنيف (المشتريات خارجها). */
export function expenseBreakdown(state, range) {
  const byCategory = new Map()
  for (const d of state.documents) {
    if (d.status !== 'approved' || d.kind !== 'expense' || !inRange(d.invoiceDate, range)) continue
    byCategory.set(d.category, round2((byCategory.get(d.category) || 0) + docTotals(d).subtotal))
  }
  const total = sum([...byCategory.values()], v => v)
  return {
    total,
    rows: [...byCategory.entries()]
      .map(([category, amount]) => ({ category, amount, share: total ? amount / total : 0 }))
      .sort((a, b) => b.amount - a.amount),
  }
}

/** آخر الحركات المعتمدة: المستندات، ومبيعات كل يوم مجمّعة. */
export function recentActivity(state, limit = 6) {
  const events = state.documents
    .filter(d => d.status === 'approved')
    .map(d => ({ id: d.id, kind: d.kind, title: d.party, sub: d.category, date: d.invoiceDate, at: d.approvedAt, amount: docTotals(d).subtotal, docId: d.id }))
  const days = new Map()
  for (const s of state.sales) {
    const day = days.get(s.date) || { amount: 0, channels: 0, at: s.enteredAt }
    day.amount = round2(day.amount + s.amount)
    day.channels += 1
    if (s.enteredAt > day.at) day.at = s.enteredAt
    days.set(s.date, day)
  }
  for (const [date, day] of days) {
    events.push({ id: `sales-${date}`, kind: 'sales', title: `مبيعات ${formatDate(date)}`, sub: plural(day.channels, 'قناة واحدة', 'قناتان', 'قنوات', 'قناة'), date, at: day.at, amount: day.amount })
  }
  return events.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit)
}

// ── تنبيهات المراجعة ────────────────────────────────────────────────────────
/** يوحّد رقم الفاتورة للمقارنة: الأرقام العربية والفارسية، المسافات والشرطات، الأصفار البادئة. */
export function normalizeRef(value) {
  return String(value || '')
    .replace(/[٠-٩]/g, ch => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, ch => String(ch.charCodeAt(0) - 0x06F0))
    .replace(/[\s\-_/.]/g, '')
    .toUpperCase()
    .replace(/^0+(?=\d)/, '')
}

export function findDuplicate(doc, documents) {
  const ref = normalizeRef(doc.invoiceNo)
  if (!ref || doc.kind === 'sales') return null
  const party = String(doc.party || '').trim()
  return documents.find(o => o.id !== doc.id && o.status !== 'rejected' && o.status !== 'reading'
    && o.kind === doc.kind && String(o.party || '').trim() === party && normalizeRef(o.invoiceNo) === ref) || null
}

export const FIELD_LABELS = {
  party: 'المورد أو الجهة', invoiceNo: 'رقم الفاتورة', invoiceDate: 'تاريخ المستند', category: 'التصنيف',
  payment: 'طريقة الدفع', printedTotal: 'الإجمالي المطبوع', kind: 'نوع المستند', lines: 'البنود',
}

/** رقم صالح؟ الفارغ والنص ليسا صفرًا: لا تُحوَّل المدخلات غير الصالحة إلى صفر بصمت. */
export const isAmount = v => typeof v === 'number' ? Number.isFinite(v) && v >= 0 : false

export function invalidNumbers(doc) {
  const bad = []
  ;(doc.lines || []).forEach((l, i) => {
    if (!isAmount(l.qty)) bad.push({ line: i, field: 'qty' })
    if (!isAmount(l.price)) bad.push({ line: i, field: 'price' })
  })
  if (doc.printedTotal != null && !isAmount(doc.printedTotal)) bad.push({ field: 'printedTotal' })
  return bad
}

export function reviewAlerts(doc, state) {
  if (doc.status === 'reading') return []
  const alerts = []
  if (invalidNumbers(doc).length) {
    alerts.push({ type: 'invalid', tone: 'error', blocking: true, title: 'قيم غير صالحة', reason: 'صحّح القيم غير الصالحة أولًا.',
      text: 'بعض الكميات أو الأسعار أو الإجمالي المطبوع ليست أرقامًا. صحّحها؛ لا تُحوَّل إلى صفر.' })
  }
  const missing = []
  if (!String(doc.party || '').trim()) missing.push(FIELD_LABELS.party)
  if (doc.kind !== 'sales' && !String(doc.invoiceNo || '').trim()) missing.push(FIELD_LABELS.invoiceNo)
  if (!doc.invoiceDate) missing.push(FIELD_LABELS.invoiceDate)
  if (!doc.category) missing.push(FIELD_LABELS.category)
  if (doc.kind !== 'sales' && !doc.payment) missing.push(FIELD_LABELS.payment)
  if (missing.length) {
    alerts.push({ type: 'missing', tone: 'error', blocking: true, title: 'بيانات ناقصة', reason: 'أكمل البيانات الناقصة أولًا.', text: `أكمل قبل الاعتماد: ${missing.join('، ')}.` })
  }
  const totals = docTotals(doc)
  if (totals.printed != null && isAmount(totals.printed) && Math.abs(totals.difference) >= 0.01) {
    alerts.push({
      type: 'mismatch', tone: 'warning', blocking: true, title: 'الإجمالي المطبوع لا يطابق البنود', reason: 'صحّح الفرق بين المطبوع والبنود أولًا.',
      facts: [
        { label: 'المطبوع', value: totals.printed },
        { label: 'المحسوب', value: totals.total },
        { label: 'الفرق', value: Math.abs(totals.difference) },
      ],
      text: 'المحسوب = مجموع البنود مع الضريبة. الفرق يعني غالبًا بندًا لم يُقرأ أو خصمًا أو رقمًا مطبوعًا مقروءًا خطأ. طابق البنود مع الصورة، أو صحّح الرقم المطبوع. يمكنك حفظ المسودة الآن، ويبقى الاعتماد ممنوعًا حتى يُعالج الفرق.',
    })
  }
  const duplicate = findDuplicate(doc, state.documents)
  if (duplicate) {
    alerts.push({
      type: 'duplicate', tone: 'warning', needsConfirm: true, title: 'قد يكون مكررًا', otherId: duplicate.id,
      text: `الرقم ${doc.invoiceNo} من «${doc.party}» موجود في المستند ${duplicate.seq} (${STATUSES[duplicate.status].label}، ${formatDate(duplicate.invoiceDate)}).`,
    })
  }
  if (doc.invoiceDate && doc.uploadedAt) {
    const age = daysBetween(doc.invoiceDate, doc.uploadedAt.slice(0, 10))
    if (age > 30) alerts.push({ type: 'old', tone: 'info', title: 'تاريخ قديم', text: `تاريخ المستند أقدم بـ${age} يومًا من يوم رفعه. تأكد أنه يخص الفترة الصحيحة.` })
  }
  return alerts
}

/** هل يمكن الاعتماد الآن؟ ولماذا لا؟ */
export function approvalState(doc, alerts, { duplicateConfirmed = false } = {}) {
  if (doc.status !== 'pending') return { can: false, reason: 'المستند ليس بانتظار المراجعة.' }
  const blocking = alerts.find(a => a.blocking)
  if (blocking) return { can: false, reason: blocking.reason }
  if (alerts.some(a => a.needsConfirm) && !duplicateConfirmed) return { can: false, reason: 'أكّد أنه ليس مكررًا أولًا.' }
  return { can: true, reason: '' }
}

// ── إجراءات المراجعة (محاكاة داخل المتصفح) ──────────────────────────────────
const replaceDoc = (state, doc) => ({ ...state, documents: state.documents.map(d => (d.id === doc.id ? doc : d)) })
const who = user => `${user.name} (${user.role})`

export function applyApproval(state, docId, { user = CURRENT_USER, at = NOW, duplicateConfirmed = false } = {}) {
  const doc = state.documents.find(d => d.id === docId)
  if (!doc) return { state, error: 'NOT_FOUND' }
  if (doc.status !== 'pending') return { state, error: 'NOT_PENDING' }
  const verdict = approvalState(doc, reviewAlerts(doc, state), { duplicateConfirmed })
  if (!verdict.can) return { state, error: 'BLOCKED', reason: verdict.reason }
  const approved = {
    ...doc, status: 'approved', approvedAt: at, approvedBy: who(user), machineFields: [],
    history: [...doc.history, { at, by: who(user), text: duplicateConfirmed ? 'اعتُمد بعد تأكيد أنه ليس مكررًا' : 'اعتُمد' }],
  }
  let next = replaceDoc(state, approved)
  if (doc.kind === 'sales') {
    // تقرير الإغلاق يصير مبيعات مسجّلة ليومه، مرة واحدة (الاعتماد الثاني يُرفض أعلاه)
    const records = doc.lines.map(line => ({ date: doc.invoiceDate, channel: line.name, amount: lineAmount(line), enteredAt: at, source: 'document', docId }))
    next = { ...next, sales: [...next.sales, ...records] }
  }
  return { state: next, error: null }
}

export function applyRejection(state, docId, { reason, note = '', user = CURRENT_USER, at = NOW } = {}) {
  const doc = state.documents.find(d => d.id === docId)
  if (!doc) return { state, error: 'NOT_FOUND' }
  if (doc.status !== 'pending') return { state, error: 'NOT_PENDING' }
  const choice = REJECT_REASONS.find(r => r.value === reason)
  if (!choice) return { state, error: 'REASON_REQUIRED' }
  if (reason === 'other' && !note.trim()) return { state, error: 'NOTE_REQUIRED' }
  // «سبب آخر» يصير النص المكتوب نفسه هو السبب
  const reasonText = reason === 'other' ? note.trim() : choice.label
  const extra = reason === 'other' ? '' : note.trim()
  const rejected = {
    ...doc, status: 'rejected', rejection: { reason: reasonText, note: extra, by: who(user), at },
    history: [...doc.history, { at, by: who(user), text: `رُفض: ${reasonText}${extra ? ` — ${extra}` : ''}` }],
  }
  return { state: replaceDoc(state, rejected), error: null }
}

export function applySave(state, docId, patch, { user = CURRENT_USER, at = NOW } = {}) {
  const doc = state.documents.find(d => d.id === docId)
  if (!doc) return { state, error: 'NOT_FOUND' }
  if (doc.status !== 'pending') return { state, error: 'NOT_PENDING' }
  // المسودة تُحفظ ولو بقي فرق أو نقص، لكن لا تُحفظ قيمة غير رقمية على أنها صفر
  if (invalidNumbers({ ...doc, ...patch }).length) return { state, error: 'INVALID_NUMBER' }
  const changed = Object.keys(patch).filter(k => JSON.stringify(patch[k]) !== JSON.stringify(doc[k]))
  if (!changed.length) return { state, error: null, changed }
  const saved = {
    ...doc, ...patch,
    machineFields: (doc.machineFields || []).filter(f => !changed.includes(f)),
    history: [...doc.history, { at, by: who(user), text: `عُدّل: ${changed.map(k => FIELD_LABELS[k] || k).join('، ')}` }],
  }
  return { state: replaceDoc(state, saved), error: null, changed }
}

// ── قائمة المستندات ─────────────────────────────────────────────────────────
export const DATE_FILTERS = [
  { value: 'all', label: 'كل التواريخ' },
  { value: '7d', label: 'آخر 7 أيام' },
  { value: 'month', label: 'هذا الشهر' },
  { value: 'last-month', label: 'الشهر الماضي' },
  { value: 'custom', label: 'من… إلى…' },
]

function dateFilterRange(filters, today) {
  switch (filters.date) {
    case '7d': return { from: addDays(today, -6), to: today }
    case 'month': return periodRange('month', today)
    case 'last-month': return periodRange('last-month', today)
    case 'custom': return { from: filters.from || '0000-01-01', to: filters.to || '9999-12-31' }
    default: return null
  }
}

function matchesQuery(doc, q) {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const totals = docTotals(doc)
  const hay = [doc.party, doc.invoiceNo, String(doc.seq), doc.category, KINDS[doc.kind]?.label, formatNumber(totals.total), String(totals.total)]
    .filter(Boolean).join(' ').toLowerCase()
  return hay.includes(needle) || (normalizeRef(needle) && normalizeRef(doc.invoiceNo).includes(normalizeRef(needle)))
}

/** تطبيق الفلاتر، مع عدّ كل حالة ضمن بقية الفلاتر لتظهر على التبويبات. */
export function filterDocuments(documents, filters, today = TODAY) {
  const range = dateFilterRange(filters, today)
  const base = documents.filter(d =>
    matchesQuery(d, filters.q || '')
    && (!filters.kind || filters.kind === 'all' || d.kind === filters.kind)
    && (!range || inRange(d.invoiceDate || d.uploadedAt.slice(0, 10), range)))
  const counts = { all: base.length, pending: 0, reading: 0, approved: 0, rejected: 0 }
  for (const d of base) counts[d.status] += 1
  const rows = base
    .filter(d => !filters.status || filters.status === 'all' || d.status === filters.status)
    .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1))
  return { rows, counts }
}

// ── ما يحتاج إجراء ──────────────────────────────────────────────────────────
export function needsAction(state, today = TODAY) {
  const items = []
  const pending = state.documents.filter(d => d.status === 'pending')
  if (pending.length) {
    const oldest = pending.reduce((a, b) => (a.uploadedAt < b.uploadedAt ? a : b))
    const days = daysBetween(oldest.uploadedAt.slice(0, 10), today)
    items.push({
      key: 'pending', tone: 'warning', to: '/documents?status=pending', action: 'راجعها',
      title: pending.length === 1 ? 'مستند واحد بانتظار مراجعتك' : pending.length === 2 ? 'مستندان بانتظار مراجعتك' : `${pending.length} ${pending.length <= 10 ? 'مستندات' : 'مستندًا'} بانتظار مراجعتك`,
      text: days > 0 ? `أقدمها رُفع ${days === 1 ? 'أمس' : days === 2 ? 'منذ يومين' : `منذ ${days} أيام`}.` : 'كلها رُفعت اليوم.',
    })
  }
  for (const d of pending) {
    const alerts = reviewAlerts(d, state)
    const duplicate = alerts.find(a => a.type === 'duplicate')
    if (duplicate) items.push({ key: `dup-${d.id}`, tone: 'warning', to: `/documents/${d.id}`, action: 'افتحه', title: 'فاتورة قد تكون مكررة', text: `${d.party} — رقم ${d.invoiceNo}.` })
    const mismatch = alerts.find(a => a.type === 'mismatch')
    if (mismatch) items.push({ key: `mis-${d.id}`, tone: 'warning', to: `/documents/${d.id}`, action: 'افتحه', title: 'إجمالي مطبوع لا يطابق البنود', text: `${d.party} — فرق ${formatNumber(Math.abs(docTotals(d).difference))} ر.س.` })
  }
  // يوم مضى بلا مبيعات مسجّلة ولا تقرير إغلاق مرفوع (اليوم الجاري لم يُغلق بعد)
  const covered = new Set([
    ...state.sales.map(s => s.date),
    ...state.documents.filter(d => d.kind === 'sales' && d.status !== 'rejected').map(d => d.invoiceDate),
  ])
  for (let i = 1; i <= 7; i++) {
    const day = addDays(today, -i)
    if (!covered.has(day)) items.push({ key: `sales-${day}`, tone: 'info', to: '/soon/sales', action: 'أدخلها', title: 'مبيعات يوم لم تُسجّل', text: `${formatDate(day, { day: true })}.` })
  }
  return items
}
