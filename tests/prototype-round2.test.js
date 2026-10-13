import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockState } from '../src/prototype/data/mock.js'
import { applyApproval, applySave, approvalState, docTotals, invalidNumbers, periodRange, reviewAlerts, summarize } from '../src/prototype/model.js'
import { ROLE_TEMPLATES, addEmployee, createSettings, roleLabel, setEmployeeActive, templateOf, updateEmployee } from '../src/prototype/settings.js'
import { parseDecimal } from '../src/ui/format.js'

const mismatchDoc = state => state.documents.find(d => d.status === 'pending' && Math.abs(docTotals(d).difference) > 0)

test('المسودة تُحفظ مع وجود فرق، والاعتماد يبقى ممنوعًا', () => {
  const state = createMockState()
  const doc = mismatchDoc(state)
  const saved = applySave(state, doc.id, { invoiceNo: 'A-9999' })
  assert.equal(saved.error, null)
  const updated = saved.state.documents.find(d => d.id === doc.id)
  assert.equal(updated.invoiceNo, 'A-9999')
  assert.equal(approvalState(updated, reviewAlerts(updated, saved.state)).can, false)
  assert.equal(applyApproval(saved.state, doc.id).error, 'BLOCKED')
})

test('المدخلات غير الصالحة لا تصير صفرًا: تُرفض ولا تُحفظ', () => {
  assert.ok(Number.isNaN(parseDecimal('')))
  assert.ok(Number.isNaN(parseDecimal('abc')))
  assert.ok(Number.isNaN(parseDecimal('12..5')))
  assert.equal(parseDecimal('٤١٫٥'), 41.5)
  assert.equal(parseDecimal('1,250.75'), 1250.75)
  const state = createMockState()
  const doc = mismatchDoc(state)
  const lines = [...doc.lines.slice(0, -1), { ...doc.lines.at(-1), price: parseDecimal('') }]
  assert.equal(applySave(state, doc.id, { lines }).error, 'INVALID_NUMBER')
  assert.deepEqual(invalidNumbers({ lines, printedTotal: null }), [{ line: lines.length - 1, field: 'price' }])
  const current = { ...doc, lines }
  const alerts = reviewAlerts(current, state)
  assert.equal(alerts[0].type, 'invalid')
  assert.equal(approvalState(current, alerts).reason, 'صحّح القيم غير الصالحة أولًا.')
})

test('تنبيه الفرق مختصر بثلاث حقائق، والتفاصيل منفصلة', () => {
  const state = createMockState()
  const doc = mismatchDoc(state)
  const alert = reviewAlerts(doc, state).find(a => a.type === 'mismatch')
  assert.deepEqual(alert.facts.map(f => f.label), ['المطبوع', 'المحسوب', 'الفرق'])
  const t = docTotals(doc)
  assert.deepEqual(alert.facts.map(f => f.value), [t.printed, t.total, Math.abs(t.difference)])
  assert.ok(!reviewAlerts(doc, state).some(a => a.type === 'machine'), 'لا تنبيه منفصل للقراءة الآلية: التظليل والشرح الواحد يكفيان')
})

test('البيانات القاسية: أرقام كبيرة متسقة، والفرق المقصود يبقى', () => {
  const normal = createMockState()
  const hard = createMockState({ stress: true })
  const month = periodRange('month')
  assert.ok(summarize(hard, month).sales.amount > 10_000_000)
  const approvedDiffs = hard.documents.filter(d => d.status === 'approved').map(d => docTotals(d).difference)
  assert.ok(approvedDiffs.every(x => x === 0), 'المعتمد يبقى مطابقًا لورقته')
  assert.ok(Math.abs(docTotals(mismatchDoc(hard)).difference) > 0)
  assert.equal(hard.documents.length, normal.documents.length)
  assert.ok(hard.documents.some(d => d.party.length > 50))
})

test('قوالب الأدوار: التخصيص يُعرف مصدره، والمالك لا يُقيَّد ولا يُعطَّل', () => {
  const s = createSettings()
  assert.equal(templateOf(ROLE_TEMPLATES[0].perms), 'accountant')
  const khaled = s.employees.find(e => e.name === 'خالد')
  assert.equal(roleLabel(khaled), 'مخصص (من مشتريات)')
  const owner = s.employees.find(e => e.owner)
  assert.equal(updateEmployee(s, owner.id, { perms: [] }).error, 'OWNER_LOCKED')
  assert.equal(setEmployeeActive(s, owner.id, false, '2026-09-26T11:00').error, 'OWNER_LOCKED')
})

test('إضافة موظف تتطلب اسمًا وصلاحية، ولا تكرر اسمًا نشطًا', () => {
  const s = createSettings()
  assert.equal(addEmployee(s, { name: '  ', perms: ['upload_sales'] }).error, 'NAME_REQUIRED')
  assert.equal(addEmployee(s, { name: 'فهد', perms: [] }).error, 'PERMS_REQUIRED')
  assert.equal(addEmployee(s, { name: 'نورة', perms: ['upload_sales'] }).error, 'NAME_TAKEN')
  const r = addEmployee(s, { name: 'فهد', template: 'cashier', perms: ['upload_sales'] })
  assert.equal(r.error, null)
  assert.equal(r.settings.employees.length, s.employees.length + 1)
  assert.equal(r.employee.active, true)
})

test('التعطيل لا يحذف الموظف، وإعادة التفعيل ممكنة', () => {
  const s = createSettings()
  const majed = s.employees.find(e => e.name === 'ماجد')
  const off = setEmployeeActive(s, majed.id, false, '2026-09-26T11:00')
  assert.equal(off.settings.employees.length, s.employees.length)
  assert.equal(off.settings.employees.find(e => e.id === majed.id).active, false)
  const on = setEmployeeActive(off.settings, majed.id, true)
  assert.equal(on.settings.employees.find(e => e.id === majed.id).active, true)
})

test('التصدير يتطلب العرض: سحب العرض يسحب التصدير، والخادم يرفض التصدير بلا عرض', async () => {
  const { normalizePerms, validatePerms } = await import('../src/prototype/settings.js')
  assert.deepEqual(normalizePerms(['view_reports', 'export_reports', 'upload_sales']).sort(), ['export_reports', 'upload_sales', 'view_reports'])
  assert.deepEqual(normalizePerms(['export_reports', 'upload_sales']), ['upload_sales'])
  assert.equal(validatePerms(['export_reports', 'upload_sales']), 'EXPORT_NEEDS_VIEW')
  const s = createSettings()
  const noura = s.employees.find(e => e.name === 'نورة')
  assert.equal(updateEmployee(s, noura.id, { perms: ['upload_sales', 'export_reports'] }).error, 'EXPORT_NEEDS_VIEW')
  assert.equal(addEmployee(s, { name: 'فهد', perms: ['export_reports'] }).error, 'EXPORT_NEEDS_VIEW')
})

test('إدارة الموظفين للمالك وحده: لا تظهر خيارًا، ولا تُقبل لموظف', async () => {
  const { GRANTABLE, OWNER_ONLY, PERMISSION_GROUPS } = await import('../src/prototype/settings.js')
  assert.ok(!GRANTABLE.includes('manage_staff'))
  assert.ok(!PERMISSION_GROUPS.some(g => g.items.some(i => i.key === 'manage_staff')))
  assert.deepEqual(OWNER_ONLY.map(o => o.key), ['manage_staff'])
  const s = createSettings()
  assert.equal(addEmployee(s, { name: 'فهد', perms: ['upload_sales', 'manage_staff'] }).error, 'OWNER_ONLY')
  const noura = s.employees.find(e => e.name === 'نورة')
  assert.equal(updateEmployee(s, noura.id, { perms: [...noura.perms, 'manage_staff'] }).error, 'OWNER_ONLY')
  assert.ok(ROLE_TEMPLATES.every(t => !t.perms.includes('manage_staff') && (!t.perms.includes('export_reports') || t.perms.includes('view_reports'))))
})
