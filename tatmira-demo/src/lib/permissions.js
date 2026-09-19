/**
 * الموظفون والصلاحيات — **محاكاة داخل المتصفح**.
 *
 * النموذج مفتوح بلا تسجيل دخول، و«الموظف الحالي» يُختار من معاينة الأدوار. هذه القواعد تمنع
 * الأخطاء في الواجهة وتوضح التصميم، لكنها **ليست حماية**: أي شخص يملك الجهاز يستطيع تغيير
 * الدور. في النظام الفعلي تُنقل جداول الصلاحيات هذه إلى الخادم، ويُستنتج الموظف من جلسة موثّقة.
 */

export const DOC_KIND_IDS = ['sale', 'payment', 'purchase']
export const OWNER_ID = 'emp-owner'

export const ROLES = {
  owner:      { label: 'المالك',           docKinds: ['sale', 'payment', 'purchase'] },
  purchasing: { label: 'مسؤول المشتريات',  docKinds: ['purchase'] },
  sales:      { label: 'مندوب المبيعات',   docKinds: ['sale', 'payment'] },
}

export function defaultEmployees() {
  return [
    { id: OWNER_ID,         name: 'المالك',                    role: 'owner',      docKinds: ROLES.owner.docKinds,      active: true },
    { id: 'emp-purchasing', name: 'مسؤول المشتريات (تجريبي)',  role: 'purchasing', docKinds: ROLES.purchasing.docKinds, active: true },
    { id: 'emp-sales',      name: 'مندوب المبيعات (تجريبي)',   role: 'sales',      docKinds: ROLES.sales.docKinds,      active: true },
  ]
}

export function findEmployee(state, id) {
  return (state.employees || []).find(e => e.id === id)
}

/** غياب actorId يعني المالك (استدعاءات داخلية واختبارات المنطق) */
export function actorOf(state, actorId) {
  return findEmployee(state, actorId ?? OWNER_ID)
}

export const isOwner = emp => emp?.role === 'owner'

/**
 * القدرات:
 * - upload(kind): رفع نوع مستند محدد
 * - ownDocuments: متابعة حالة مستنداته
 * - review: تعديل بيانات المستند واعتماده ورفضه وتسوية الرصيد
 * - viewFinancials: لوحة المالك والتقارير والأرصدة والأرباح وكشوف الحساب
 * - manageCustomers / manageSettings / manageEmployees
 */
export function can(emp, capability, arg) {
  if (!emp || !emp.active) return false
  if (capability === 'ownDocuments') return true
  if (capability === 'upload') return (emp.docKinds || []).includes(arg)
  return isOwner(emp)
}

/** جدول الإجراء ← القدرة المطلوبة (ما سيُنقل إلى الخادم لاحقاً) */
const ACTION_CAPABILITY = {
  LAB_UPDATE: 'manageSettings', TAX_SETTING_SAVE: 'manageSettings',
  CUSTOMER_ADD: 'manageCustomers', CUSTOMER_UPDATE: 'manageCustomers', CUSTOMER_ARCHIVE: 'manageCustomers', CUSTOMER_DELETE: 'manageCustomers',
  ACCOUNT_SAVE: 'manageSettings', ACCOUNT_ARCHIVE: 'manageSettings',
  GROUP_SAVE: 'manageSettings', GROUP_ARCHIVE: 'manageSettings',
  CATEGORY_SAVE: 'manageSettings', CATEGORY_ARCHIVE: 'manageSettings',
  EMPLOYEE_SAVE: 'manageEmployees', EMPLOYEE_SET_ACTIVE: 'manageEmployees',
  DOC_UPDATE_FIELDS: 'review', DOC_REJECT: 'review', DOC_APPROVE: 'review', CREDIT_APPLY: 'review',
}

/** يعيد null إن كان الإجراء مسموحاً، أو { code, error } */
export function authorize(state, action) {
  const actor = actorOf(state, action.actorId)
  if (!actor) return { code: 'UNKNOWN_EMPLOYEE', error: 'الموظف غير موجود' }
  if (!actor.active) return { code: 'EMPLOYEE_DISABLED', error: 'هذا الموظف معطّل' }
  if (action.type === 'DOC_ADD') {
    if (!can(actor, 'upload', action.kind)) return { code: 'FORBIDDEN', error: 'غير مسموح لك برفع هذا النوع من المستندات' }
    return null
  }
  const capability = ACTION_CAPABILITY[action.type]
  if (capability && !can(actor, capability)) return { code: 'FORBIDDEN', error: 'هذا الإجراء للمالك فقط' }
  return null
}

/** المستندات التي يراها الموظف: المالك يرى الكل، وغيره مستنداته فقط */
export function documentsFor(state, emp) {
  if (!emp || !emp.active) return []
  if (isOwner(emp)) return state.documents
  return state.documents.filter(d => d.uploadedBy === emp.id)
}
