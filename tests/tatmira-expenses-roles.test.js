import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createInitialState, reduce, ownerDashboard, accountBalances, migrate, DOC_KINDS,
} from '../tatmira-demo/src/lib/ledger.js'
import { expenseReport } from '../tatmira-demo/src/lib/expenses.js'
import { can, documentsFor, OWNER_ID } from '../tatmira-demo/src/lib/permissions.js'
import { INITIAL_EFFECTIVE_FROM } from '../tatmira-demo/src/lib/tax.js'

const TODAY = '2026-09-17'
const run = (state, action) => reduce(state, { today: TODAY, at: '2026-09-17T10:00:00.000Z', ...action })
function must(state, action) {
  const r = run(state, action)
  assert.equal(r.error, undefined, `unexpected error: ${r.code} ${r.error}`)
  return r.state
}
const file = id => ({ id: `file-${id}`, name: `${id}.pdf`, type: 'application/pdf', size: 1000 })
const withTax = state => must(state, { type: 'TAX_SETTING_SAVE', mode: 'exclusive', rateBps: 1500, vatNumber: 'DEMO', effectiveFrom: INITIAL_EFFECTIVE_FROM })

function expenseDoc(state, id, { date = TODAY, payee = '', lines, approve = true, accountId = 'acc-bank' }) {
  state = must(state, { type: 'DOC_ADD', id, kind: 'purchase', file: file(id) })
  state = must(state, { type: 'DOC_UPDATE_FIELDS', id, fields: { date, payee, number: '', accountId, lines } })
  return approve ? must(state, { type: 'DOC_APPROVE', id }) : state
}

/** يتحقق أن كل إجمالي يساوي مجموع ما تحته حتى مستوى الحركة */
function assertReportConsistent(report) {
  for (const section of [report.direct, report.operating]) {
    assert.equal(section.total, section.groups.reduce((s, g) => s + g.total, 0))
    assert.equal(section.vat, section.groups.reduce((s, g) => s + g.vat, 0))
    for (const g of section.groups) {
      assert.equal(g.total, g.categories.reduce((s, c) => s + c.total, 0), `مجموعة ${g.name}`)
      for (const c of g.categories) {
        assert.equal(c.total, c.movements.reduce((s, m) => s + m.amount, 0), `تصنيف ${c.name}`)
        assert.equal(c.vat, c.movements.reduce((s, m) => s + m.separatedVat, 0))
      }
    }
  }
  assert.equal(report.total, report.direct.total + report.operating.total)
}

// ── مستند المصروفات والتقرير ─────────────────────────────────────────────

test('التسمية: «مستند مصروفات» بدل «فاتورة مشتريات»، والجهة ورقم المستند اختياريان', () => {
  assert.equal(DOC_KINDS.purchase, 'مستند مصروفات')
  let s = createInitialState({ today: TODAY })
  s = expenseDoc(s, 'e0', { payee: '', lines: [{ desc: '', categoryId: 'cat-power', net: 30000, vat: 0 }] })
  assert.equal(s.purchases[0].payee, '')
  assert.equal(s.purchases[0].number, '')
  assert.equal(s.purchases[0].lines[0].desc, 'كهرباء وماء', 'الوصف الفارغ يأخذ اسم التصنيف')
})

test('التقرير: مجاميع التصنيفات = المجموعات = الأقسام = لوحة المالك، لمستند مختلط ومصروف بلا ضريبة', () => {
  let s = withTax(createInitialState({ today: TODAY }))
  // مستند مختلط: مواد مباشرة + إيجار سكن
  s = expenseDoc(s, 'mixed', { payee: 'مورد التمور', lines: [
    { desc: 'تمور', categoryId: 'cat-dates', net: 20000, vat: 3000 },
    { desc: 'تغليف', categoryId: 'cat-pack', net: 5000, vat: 750 },
    { desc: 'سكن العمال', categoryId: 'cat-rent-housing', net: 80000, vat: 0 },
  ] })
  // مصروف بلا ضريبة: إيجار ورواتب
  s = expenseDoc(s, 'novat', { payee: 'المؤجر', accountId: 'acc-cash', lines: [
    { desc: 'إيجار سبتمبر', categoryId: 'cat-rent', net: 150000, vat: 0 },
    { desc: 'رواتب سبتمبر', categoryId: 'cat-salary', net: 300000, vat: 0 },
  ] })
  // شهر سابق
  s = expenseDoc(s, 'aug', { date: '2026-08-10', lines: [{ desc: 'كهرباء', categoryId: 'cat-power', net: 30000, vat: 4500 }] })
  // غير معتمد — لا يدخل
  s = expenseDoc(s, 'pending', { approve: false, lines: [{ desc: 'صيانة', categoryId: 'cat-maint', net: 99900, vat: 0 }] })

  const all = expenseReport(s)
  assertReportConsistent(all)
  assert.equal(all.direct.total, 25000)
  assert.equal(all.operating.total, 80000 + 150000 + 300000 + 30000)
  assert.equal(all.vat, 3000 + 750 + 4500)
  assert.ok(!JSON.stringify(all).includes('cat-maint'), 'المستند غير المعتمد لا يظهر')

  const d = ownerDashboard(s)
  assert.equal(d.direct, all.direct.total)
  assert.equal(d.operating, all.operating.total)
  assert.equal(d.inputVat, all.vat)
  assert.equal(d.estimatedProfit, d.salesNet - all.direct.total - all.operating.total)

  // نفس مصدر الحساب: خصم الحسابات = إجمالي المصروفات مع الضريبة
  const outflow = accountBalances(s).reduce((sum, a) => sum + a.outflow, 0)
  assert.equal(outflow, all.total + all.vat)

  // مجموعة الإيجارات تجمع إيجار المعمل وإيجار السكن من مستندين مختلفين
  const rent = all.operating.groups.find(g => g.groupId === 'grp-rent')
  assert.equal(rent.total, 230000)
  assert.deepEqual(rent.categories.map(c => [c.name, c.total]), [['إيجار المعمل', 150000], ['إيجار سكن العمال', 80000]])

  // المصروف بلا ضريبة
  const salary = all.operating.groups.find(g => g.groupId === 'grp-salary').categories[0].movements[0]
  assert.equal(salary.documentVat, 0)
  assert.equal(s.purchases.find(p => p.docId === 'novat').total, 450000)

  // التنقل من التقرير إلى المستند: كل حركة تشير لمستند معتمد موجود
  for (const section of [all.direct, all.operating]) for (const g of section.groups) for (const c of g.categories) for (const m of c.movements) {
    const doc = s.documents.find(x => x.id === m.docId)
    assert.ok(doc, 'رابط المستند صالح')
    assert.equal(doc.status, 'approved')
  }

  // فلتر الفترة
  const sep = expenseReport(s, { from: '2026-09-01', to: '2026-09-30' })
  assertReportConsistent(sep)
  assert.equal(sep.operating.groups.some(g => g.groupId === 'grp-utilities'), false)
  assert.equal(ownerDashboard(s, { from: '2026-09-01', to: '2026-09-30' }).operating, sep.operating.total)
})

test('الإعدادات: إعادة تسمية المجموعة تغيّر الاسم المعروض فقط، ونقل التصنيف لا يعيد تصنيف الماضي', () => {
  let s = withTax(createInitialState({ today: TODAY }))
  s = expenseDoc(s, 'old', { lines: [{ desc: 'صيانة', categoryId: 'cat-maint', net: 40000, vat: 0 }] })
  s = must(s, { type: 'GROUP_SAVE', id: 'grp-maintenance', name: 'الصيانة والإصلاح', kind: 'operating' })
  s = must(s, { type: 'CATEGORY_SAVE', id: 'cat-maint', name: 'صيانة المعدات', groupId: 'grp-other' })
  s = expenseDoc(s, 'new', { lines: [{ desc: 'صيانة', categoryId: 'cat-maint', net: 10000, vat: 0 }] })

  const r = expenseReport(s)
  assertReportConsistent(r)
  const maint = r.operating.groups.find(g => g.groupId === 'grp-maintenance')
  assert.equal(maint.name, 'الصيانة والإصلاح')
  assert.equal(maint.total, 40000, 'المستند القديم بقي في مجموعته')
  assert.equal(r.operating.groups.find(g => g.groupId === 'grp-other').total, 10000, 'الجديد في المجموعة الجديدة')

  // مجموعة وتصنيف جديدان من الإعدادات
  s = must(s, { type: 'GROUP_SAVE', id: 'grp-marketing', name: 'التسويق', kind: 'operating' })
  s = must(s, { type: 'CATEGORY_SAVE', id: 'cat-ads', name: 'إعلانات', groupId: 'grp-marketing' })
  s = expenseDoc(s, 'ads', { lines: [{ desc: 'إعلان', categoryId: 'cat-ads', net: 7000, vat: 1050 }] })
  assert.equal(expenseReport(s).operating.groups.find(g => g.groupId === 'grp-marketing').total, 7000)

  // مجموعة مؤرشفة: تصنيفاتها غير قابلة للاعتماد الجديد، والتقرير السابق باقٍ
  s = must(s, { type: 'GROUP_ARCHIVE', id: 'grp-marketing', archived: true })
  s = must(s, { type: 'DOC_ADD', id: 'ads2', kind: 'purchase', file: file('ads2') })
  s = must(s, { type: 'DOC_UPDATE_FIELDS', id: 'ads2', fields: { lines: [{ categoryId: 'cat-ads', net: 100, vat: 0 }] } })
  assert.equal(run(s, { type: 'DOC_APPROVE', id: 'ads2' }).code, 'CATEGORY_REQUIRED')
  assert.equal(expenseReport(s).operating.groups.find(g => g.groupId === 'grp-marketing').total, 7000)
  assert.equal(run(s, { type: 'CATEGORY_SAVE', name: 'x', groupId: 'grp-marketing' }).code, 'GROUP_REQUIRED')
})

// ── الترقية من الإصدار 2 ─────────────────────────────────────────────────

function legacyV2() {
  const base = createInitialState({ today: TODAY })
  return {
    version: 2,
    lab: base.lab, customers: base.customers, accounts: base.accounts,
    categories: [
      { id: 'cat-dates', name: 'تمور', kind: 'direct', archived: false },
      { id: 'cat-rent', name: 'إيجار', kind: 'operating', archived: false },
      { id: 'cat-power', name: 'كهرباء وماء', kind: 'operating', archived: false },
      { id: 'cat-honey', name: 'عسل', kind: 'direct', archived: false },
    ],
    invoices: [{ id: 'inv-s1', docId: 's1', customerId: 'cust-5', number: 'A-1', date: TODAY, lines: [{ desc: 'معمول', qty: 20, price: 5000 }], net: 100000, vat: 15000, total: 115000, approvedSeq: 1 }],
    payments: [{ id: 'pay-p1', docId: 'p1', customerId: 'cust-5', date: TODAY, amount: 60000, accountId: 'acc-bank', reference: '', allocations: [{ target: 'inv-s1', amount: 60000 }], unallocated: 0, approvedSeq: 2 }],
    creditApplications: [],
    purchases: [{
      id: 'pur-e1', docId: 'e1', supplier: 'مورد التمور', number: 'P-1', date: TODAY, accountId: 'acc-bank', approvedSeq: 3,
      lines: [
        { desc: 'تمور', categoryId: 'cat-dates', categoryName: 'تمور', categoryKind: 'direct', net: 20000, vat: 3000 },
        { desc: 'إيجار', categoryId: 'cat-rent', categoryName: 'إيجار', categoryKind: 'operating', net: 150000, vat: 0 },
        { desc: 'عسل', categoryId: 'cat-honey', categoryName: 'عسل', categoryKind: 'direct', net: 5000, vat: 0 },
        // كان تصنيف الكهرباء «مباشراً» وقت الاعتماد ثم تغيّر — يبقى مباشراً
        { desc: 'كهرباء', categoryId: 'cat-power', categoryName: 'كهرباء وماء', categoryKind: 'direct', net: 1000, vat: 0 },
      ],
      net: 176000, vat: 3000, total: 179000,
    }],
    documents: [
      { id: 'e1', kind: 'purchase', status: 'approved', file: file('e1'), fields: { supplier: 'مورد التمور', date: TODAY, accountId: 'acc-bank', lines: [] } },
      { id: 's1', kind: 'sale', status: 'approved', file: file('s1'), fields: { customerId: 'cust-5', number: 'A-1' } },
      { id: 'e2', kind: 'purchase', status: 'pending', file: file('e2'), fields: { supplier: 'الكهرباء', date: TODAY, accountId: 'acc-bank', lines: [{ id: 'x', desc: 'فاتورة', categoryId: 'cat-power', net: 500, vat: 75 }] } },
    ],
    counters: { sample: 3, approved: 3 },
  }
}

test('الترقية 2 ← 4 تحفظ البيانات التجريبية: الفواتير والدفعات والمستندات والأرقام', () => {
  const v2 = legacyV2()
  const s = migrate(structuredClone(v2), TODAY)
  assert.equal(s.version, 4)
  assert.deepEqual(s.invoices.map(({ taxProfile, ...i }) => i), v2.invoices)
  assert.equal(s.invoices[0].taxProfile.mode, 'exclusive')
  assert.deepEqual(s.payments, v2.payments)
  assert.deepEqual(s.customers, v2.customers)
  assert.deepEqual(s.counters, v2.counters)
  assert.equal(s.documents.length, 3)
  assert.ok(s.documents.every(d => d.uploadedBy === OWNER_ID))
  assert.equal(s.documents.find(d => d.id === 'e2').fields.payee, 'الكهرباء')
  assert.equal(s.documents.find(d => d.id === 'e2').fields.lines[0].net, 500)

  const p = s.purchases[0]
  assert.equal(p.payee, 'مورد التمور')
  assert.equal('supplier' in p, false)
  assert.deepEqual(p.lines.map(l => [l.categoryName, l.categoryKind, l.groupId]), [
    ['تمور', 'direct', 'grp-direct'],
    ['إيجار', 'operating', 'grp-rent'],
    ['عسل', 'direct', 'grp-direct'],
    ['كهرباء وماء', 'direct', 'grp-direct'],
  ])
  assert.equal(s.categories.find(c => c.id === 'cat-rent').name, 'إيجار', 'اسم التصنيف القديم لم يتغير')
  assert.equal(s.categories.find(c => c.id === 'cat-honey').groupId, 'grp-direct')
  assert.ok(s.categories.some(c => c.id === 'cat-rent-housing'), 'أُضيفت التصنيفات الافتراضية الناقصة')
  assert.ok(s.categories.every(c => !('kind' in c)))
  assert.equal(s.employees.length, 3)
  assert.equal(s.taxSettings[0].mode, 'disabled', 'إعداد المنشأة الحالي لا يعيد كتابة الماضي')

  const d = ownerDashboard(s)
  assert.equal(d.salesNet, 100000)
  assert.equal(d.collected, 60000)
  assert.equal(d.direct, 26000)
  assert.equal(d.operating, 150000)
  assertReportConsistent(expenseReport(s))
  assert.equal(migrate(s, TODAY), s, 'الترقية لا تتكرر على بيانات مرقّاة')

  // المستند المعلّق القديم يُعتمد بعد الترقية
  const approved = must(s, { type: 'DOC_APPROVE', id: 'e2' })
  assert.equal(approved.purchases.at(-1).lines[0].groupId, 'grp-utilities')
})

// ── الموظفون والصلاحيات (محاكاة) ───────────────────────────────────────────

const P = 'emp-purchasing'
const S = 'emp-sales'

test('مسؤول المشتريات: يرفع مستند مصروفات فقط، ولا يعتمد ولا يعدّل ولا يرى مستندات غيره', () => {
  let s = createInitialState({ today: TODAY })
  s = must(s, { type: 'DOC_ADD', id: 'own-sale', kind: 'sale', file: file('own-sale'), fields: { customerId: 'cust-1' } }) // المالك
  s = must(s, { type: 'DOC_ADD', id: 'pe', kind: 'purchase', file: file('pe'), actorId: P })
  assert.equal(s.documents.find(d => d.id === 'pe').uploadedBy, P)
  assert.equal(run(s, { type: 'DOC_ADD', id: 'ps', kind: 'sale', file: file('ps'), actorId: P, fields: { customerId: 'cust-1' } }).code, 'FORBIDDEN')
  for (const type of ['DOC_APPROVE', 'DOC_REJECT']) assert.equal(run(s, { type, id: 'pe', actorId: P }).code, 'FORBIDDEN')
  assert.equal(run(s, { type: 'DOC_UPDATE_FIELDS', id: 'pe', actorId: P, fields: { payee: 'x' } }).code, 'FORBIDDEN')
  assert.equal(run(s, { type: 'CUSTOMER_ADD', id: 'c', name: 'x', actorId: P }).code, 'FORBIDDEN')
  assert.equal(run(s, { type: 'CATEGORY_SAVE', name: 'x', groupId: 'grp-other', actorId: P }).code, 'FORBIDDEN')
  const emp = s.employees.find(e => e.id === P)
  assert.deepEqual(documentsFor(s, emp).map(d => d.id), ['pe'])
  for (const cap of ['viewFinancials', 'review', 'manageCustomers', 'manageSettings', 'manageEmployees']) assert.equal(can(emp, cap), false, cap)
  assert.equal(s.documents.find(d => d.id === 'pe').status, 'pending')
})

test('مندوب المبيعات: يرفع فاتورة بيع أو إثبات سداد مع اختيار العميل، ولا يمرر حقولاً أخرى', () => {
  let s = createInitialState({ today: TODAY })
  assert.equal(run(s, { type: 'DOC_ADD', id: 'x', kind: 'sale', file: file('x'), actorId: S }).code, 'CUSTOMER_REQUIRED')
  s = must(s, { type: 'CUSTOMER_ARCHIVE', id: 'cust-9', archived: true })
  assert.equal(run(s, { type: 'DOC_ADD', id: 'x', kind: 'sale', file: file('x'), actorId: S, fields: { customerId: 'cust-9' } }).code, 'CUSTOMER_REQUIRED')
  s = must(s, { type: 'DOC_ADD', id: 'ss', kind: 'sale', file: file('ss'), actorId: S, fields: { customerId: 'cust-2', number: 'HACK', vat: 1 } })
  const doc = s.documents.find(d => d.id === 'ss')
  assert.equal(doc.fields.customerId, 'cust-2')
  assert.notEqual(doc.fields.number, 'HACK', 'حقول غير العميل تُتجاهل')
  s = must(s, { type: 'DOC_ADD', id: 'sp', kind: 'payment', file: file('sp'), actorId: S, fields: { customerId: 'cust-2' } })
  assert.equal(run(s, { type: 'DOC_ADD', id: 'se', kind: 'purchase', file: file('se'), actorId: S }).code, 'FORBIDDEN')
  assert.equal(run(s, { type: 'CREDIT_APPLY', id: 'c', customerId: 'cust-2', allocations: [], actorId: S }).code, 'FORBIDDEN')
  assert.deepEqual(documentsFor(s, s.employees.find(e => e.id === S)).map(d => d.id).sort(), ['sp', 'ss'])
  // المالك يعتمد مستند المندوب
  s = must(s, { type: 'DOC_APPROVE', id: 'ss' })
  assert.equal(s.invoices[0].customerId, 'cust-2')
})

test('المالك يضيف موظفاً ويعدّل أنواع مستنداته ويعطّله، ولا يمكن تعطيل المالك', () => {
  let s = createInitialState({ today: TODAY })
  s = must(s, { type: 'EMPLOYEE_SAVE', id: 'emp-new', name: 'سالم', role: 'sales', docKinds: ['payment'] })
  const newEmp = () => s.employees.find(e => e.id === 'emp-new')
  assert.deepEqual(newEmp().docKinds, ['payment'])
  assert.equal(run(s, { type: 'DOC_ADD', id: 'n1', kind: 'sale', file: file('n1'), actorId: 'emp-new', fields: { customerId: 'cust-1' } }).code, 'FORBIDDEN')

  // توسيع صلاحيات مسؤول المشتريات ليرفع فواتير بيع أيضاً
  s = must(s, { type: 'EMPLOYEE_SAVE', id: P, name: 'مسؤول المشتريات', role: 'purchasing', docKinds: ['purchase', 'sale'] })
  s = must(s, { type: 'DOC_ADD', id: 'p-sale', kind: 'sale', file: file('p-sale'), actorId: P, fields: { customerId: 'cust-3' } })

  assert.equal(run(s, { type: 'EMPLOYEE_SAVE', id: 'emp-x', name: 'x', role: 'sales', docKinds: [] }).code, 'DOC_KINDS_REQUIRED')
  assert.equal(run(s, { type: 'EMPLOYEE_SAVE', id: 'emp-y', name: 'مالك ثانٍ', role: 'owner', docKinds: ['sale'] }).code, 'BAD_ROLE')
  assert.equal(run(s, { type: 'EMPLOYEE_SAVE', id: 'emp-z', name: 'z', role: 'sales', docKinds: ['sale'], actorId: S }).code, 'FORBIDDEN')
  assert.equal(run(s, { type: 'EMPLOYEE_SET_ACTIVE', id: OWNER_ID, active: false }).code, 'OWNER_ALWAYS_ACTIVE')
  // المالك لا يفقد أنواع مستنداته
  s = must(s, { type: 'EMPLOYEE_SAVE', id: OWNER_ID, name: 'أبو محمد', role: 'sales', docKinds: [] })
  assert.equal(s.employees.find(e => e.id === OWNER_ID).role, 'owner')
  assert.equal(s.employees.find(e => e.id === OWNER_ID).docKinds.length, 3)

  s = must(s, { type: 'EMPLOYEE_SET_ACTIVE', id: P, active: false })
  assert.equal(run(s, { type: 'DOC_ADD', id: 'p2', kind: 'purchase', file: file('p2'), actorId: P }).code, 'EMPLOYEE_DISABLED')
  assert.deepEqual(documentsFor(s, s.employees.find(e => e.id === P)), [])
  assert.equal(s.documents.some(d => d.id === 'p-sale'), true, 'مستنداته السابقة تبقى للمالك')
  assert.equal(run(s, { type: 'DOC_ADD', id: 'p3', kind: 'purchase', file: file('p3'), actorId: 'emp-ghost' }).code, 'UNKNOWN_EMPLOYEE')
})
