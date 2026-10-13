// إعدادات المالك في نموذج التصميم: بيانات مصطنعة ومنطق نقي، بلا خادم.
import { CATEGORIES, CHANNELS } from './model.js'

/** الصلاحيات مجمّعة حسب المهمة. المالك يملكها كلها دائمًا ولا تُعدَّل. */
export const PERMISSION_GROUPS = [
  { key: 'upload', title: 'الرفع', items: [
    { key: 'upload_purchase', label: 'رفع فواتير المشتريات' },
    { key: 'upload_expense', label: 'رفع المصروفات' },
    { key: 'upload_sales', label: 'رفع تقارير الإغلاق وإدخال المبيعات' },
  ] },
  { key: 'review', title: 'المراجعة والاعتماد', items: [
    { key: 'review', label: 'مراجعة المستندات وتصحيح بياناتها' },
    { key: 'approve', label: 'اعتماد المستندات' },
    { key: 'reject', label: 'رفض المستندات' },
  ] },
  { key: 'reports', title: 'التقارير', items: [
    { key: 'view_reports', label: 'عرض الأرقام والتقارير' },
    { key: 'export_reports', label: 'تصدير التقارير', requires: 'view_reports' },
  ] },
  { key: 'settings', title: 'إدارة الإعدادات', items: [
    { key: 'manage_business', label: 'بيانات المنشأة والحسابات والتصنيفات' },
  ] },
]
/** صلاحيات لا تُمنح لموظف: للمالك وحده. */
export const OWNER_ONLY = [{ key: 'manage_staff', label: 'إدارة الموظفين وصلاحياتهم' }]
export const GRANTABLE = PERMISSION_GROUPS.flatMap(g => g.items.map(i => i.key))
export const ALL_PERMISSIONS = [...GRANTABLE, ...OWNER_ONLY.map(p => p.key)]
export const PERMISSION_LABEL = Object.fromEntries([...PERMISSION_GROUPS.flatMap(g => g.items.map(i => [i.key, i.label])), ...OWNER_ONLY.map(p => [p.key, p.label])])
const REQUIRES = Object.fromEntries(PERMISSION_GROUPS.flatMap(g => g.items.filter(i => i.requires).map(i => [i.key, i.requires])))

/** يطبّق التبعيات في الواجهة: سحب «العرض» يسحب «التصدير». */
export function normalizePerms(perms) {
  let out = perms.filter(p => GRANTABLE.includes(p))
  for (let changed = true; changed;) {
    const next = out.filter(p => !REQUIRES[p] || out.includes(REQUIRES[p]))
    changed = next.length !== out.length
    out = next
  }
  return out
}

/** فحص الخادم (محاكى هنا): يرفض ما لا يُمنح وما ينقصه شرطه، ولا يصحّحه بصمت. */
export function validatePerms(perms) {
  if (perms.some(p => OWNER_ONLY.some(o => o.key === p))) return 'OWNER_ONLY'
  if (perms.some(p => !GRANTABLE.includes(p))) return 'UNKNOWN_PERMISSION'
  if (perms.some(p => REQUIRES[p] && !perms.includes(REQUIRES[p]))) return 'EXPORT_NEEDS_VIEW'
  if (!perms.length) return 'PERMS_REQUIRED'
  return null
}

/** قوالب الأدوار: نقطة بداية تُخصَّص لكل موظف. */
export const ROLE_TEMPLATES = [
  { key: 'accountant', label: 'محاسب', hint: 'يرفع ويراجع ويعتمد، ويرى التقارير',
    perms: ['upload_purchase', 'upload_expense', 'upload_sales', 'review', 'approve', 'reject', 'view_reports', 'export_reports'] },
  { key: 'manager', label: 'مدير فرع', hint: 'يرفع ويراجع دون اعتماد، ويرى التقارير',
    perms: ['upload_purchase', 'upload_expense', 'upload_sales', 'review', 'view_reports'] },
  { key: 'purchasing', label: 'مشتريات', hint: 'يرفع فواتير المشتريات والمصروفات فقط', perms: ['upload_purchase', 'upload_expense'] },
  { key: 'cashier', label: 'كاشير', hint: 'يرفع تقارير الإغلاق ويدخل المبيعات فقط', perms: ['upload_sales'] },
]
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x))

/** القالب المطابق لمجموعة صلاحيات، أو «مخصص». */
export function templateOf(perms) {
  return ROLE_TEMPLATES.find(t => sameSet(t.perms, perms))?.key || 'custom'
}
export function roleLabel(employee) {
  if (employee.owner) return 'المالك'
  const key = templateOf(employee.perms)
  if (key !== 'custom') return ROLE_TEMPLATES.find(t => t.key === key).label
  const base = ROLE_TEMPLATES.find(t => t.key === employee.template)
  return base ? `مخصص (من ${base.label})` : 'مخصص'
}

export function createSettings({ stress = false } = {}) {
  return {
    business: {
      name: stress ? 'مطعم ومقهى الضيافة العربية للمأكولات الشعبية والمشويات' : 'مطعم تجريبي',
      legalName: stress ? 'مؤسسة الضيافة العربية للوجبات السريعة والمأكولات الشعبية والتموين' : 'مؤسسة المطعم التجريبي للوجبات',
      cr: '1010000000', vat: '300000000000003', city: 'الرياض', phone: '0500000000',
      branches: ['الفرع الرئيسي'],
    },
    employees: [
      { id: 'u-owner', name: 'عبدالله', owner: true, perms: [...ALL_PERMISSIONS], active: true, branch: 'الفرع الرئيسي', lastSeen: '2026-09-26T11:02' },
      { id: 'u-noura', name: stress ? 'نورة بنت عبدالرحمن بن عبدالعزيز الحربي' : 'نورة', template: 'accountant', perms: [...ROLE_TEMPLATES[0].perms], active: true, branch: 'الفرع الرئيسي', lastSeen: '2026-09-26T10:05' },
      { id: 'u-khaled', name: 'خالد', template: 'purchasing', perms: ['upload_purchase', 'upload_expense', 'view_reports'], active: true, branch: 'الفرع الرئيسي', lastSeen: '2026-09-26T09:20' },
      { id: 'u-majed', name: 'ماجد', template: 'cashier', perms: ['upload_sales'], active: true, branch: 'الفرع الرئيسي', lastSeen: '2026-09-26T00:15' },
      { id: 'u-saeed', name: 'سعيد', template: 'cashier', perms: ['upload_sales'], active: false, branch: 'الفرع الرئيسي', lastSeen: '2026-08-14T23:40', disabledAt: '2026-08-15T09:00' },
    ],
    accounts: [
      { id: 'cash', name: 'الصندوق', kind: 'cash', active: true },
      { id: 'bank', name: stress ? 'الحساب البنكي الجاري الرئيسي للمؤسسة' : 'الحساب البنكي', kind: 'bank', detail: 'ينتهي بـ 0000', active: true },
      { id: 'custody-khaled', name: 'عهدة خالد', kind: 'custody', detail: 'عهدة المشتريات', active: true },
    ],
    payments: [
      { key: 'cash', label: 'نقدًا', account: 'cash', active: true },
      { key: 'bank', label: 'تحويل بنكي أو بطاقة', account: 'bank', active: true },
      { key: 'custody', label: 'من العهدة', account: 'custody-khaled', active: true },
      { key: 'credit', label: 'آجل على المورد', account: '', active: true },
    ],
    channels: CHANNELS.map(name => ({
      name, active: true,
      settles: name === 'نقدي' ? 'cash' : name === 'شبكة (مدى)' ? 'bank' : 'app',
    })),
    categories: {
      purchase: CATEGORIES.purchase.map(name => ({ name, active: true })),
      expense: CATEGORIES.expense.map(name => ({ name, active: true })),
    },
    tax: { registered: true, vatNumber: '300000000000003', rate: 15, salesIncludeVat: true, effectiveFrom: '2026-01-01' },
    reading: { enabled: true, kinds: { purchase: true, expense: true, sales: true } },
  }
}

// ── إجراءات الموظفين (محاكاة) ──────────────────────────────────────────────
export function addEmployee(settings, { name, template, perms = [], branch }) {
  const clean = String(name || '').trim()
  if (!clean) return { settings, error: 'NAME_REQUIRED' }
  const invalid = validatePerms(perms)
  if (invalid) return { settings, error: invalid }
  if (settings.employees.some(e => e.name.trim() === clean && e.active)) return { settings, error: 'NAME_TAKEN' }
  const employee = { id: `u-${Date.now().toString(36)}`, name: clean, template, perms: [...perms], active: true, branch: branch || settings.business.branches[0], lastSeen: null }
  return { settings: { ...settings, employees: [...settings.employees, employee] }, error: null, employee }
}

export function updateEmployee(settings, id, patch) {
  const e = settings.employees.find(x => x.id === id)
  if (!e) return { settings, error: 'NOT_FOUND' }
  if (e.owner) return { settings, error: 'OWNER_LOCKED' }
  if (patch.perms) { const invalid = validatePerms(patch.perms); if (invalid) return { settings, error: invalid } }
  return { settings: { ...settings, employees: settings.employees.map(x => (x.id === id ? { ...x, ...patch } : x)) }, error: null }
}

/** التعطيل يمنع الدخول ولا يحذف: تبقى عمليات الموظف السابقة باسمه. */
export function setEmployeeActive(settings, id, active, at) {
  const e = settings.employees.find(x => x.id === id)
  if (!e) return { settings, error: 'NOT_FOUND' }
  if (e.owner) return { settings, error: 'OWNER_LOCKED' }
  return updateEmployee(settings, id, active ? { active: true, disabledAt: null } : { active: false, disabledAt: at })
}
