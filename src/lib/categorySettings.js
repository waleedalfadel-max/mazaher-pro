// إعدادات التصنيفات — وحدة خالصة (بلا اتصال): الشجرة، وما يُتاح للاستعمال الجديد، ورسائل الخادم بالعربية.
// الإدارة نفسها في الخادم (supabase/migrations/20260928000800_category_settings.sql)؛ هنا العرض والتحقق المبدئي فقط.

export { normCat } from './approvalV2.js'
import { normCat } from './approvalV2.js'
export const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim()

/** المعالجة المالية بلغة المالك: ما يعنيه اختيارها في التقارير. */
export const CLASSES = [
  { value: 'cogs', label: 'تكلفة بضاعة (مشتريات)', short: 'تكلفة بضاعة',
    effect: 'مشتريات تدخل في الأطباق والمشروبات والتغليف. تُحسب في «تكلفة البضاعة المباعة»، فتنقص مجمل الربح.' },
  { value: 'opex', label: 'مصروف تشغيلي', short: 'مصروف تشغيلي',
    effect: 'تكاليف تشغيل مثل الكهرباء والغاز والصيانة والنظافة. تُحسب في «المصروفات التشغيلية»، لا في تكلفة البضاعة.' },
  { value: 'fixed', label: 'مصروف ثابت', short: 'مصروف ثابت',
    effect: 'تكاليف ثابتة شهريًا مثل الإيجار والرواتب. تُحسب ضمن «المصروفات التشغيلية» في الأرقام، وتظهر باسمها في تقرير المصروفات.' },
]
export const classOf = value => CLASSES.find(c => c.value === value) || null

/** الشجرة: الرئيسيات بترتيبها، وتحت كل رئيسي فروعه بترتيبها. showInactive=false يخفي المعطّل. */
export function categoryTree(categories, { showInactive = false } = {}) {
  const byOrder = (a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || String(a.name).localeCompare(String(b.name), 'ar')
  const all = categories || []
  return all.filter(c => !c.parent_id && (showInactive || c.is_active !== false)).sort(byOrder)
    .map(main => ({ ...main, subs: all.filter(s => s.parent_id === main.id && (showInactive || s.is_active !== false)).sort(byOrder) }))
}

/**
 * ما يُتاح للاستعمال الجديد (القراءة الآلية والاختيار): رئيسي فعّال، وفرعي فعّال تحت رئيسي فعّال.
 * المعطّل يبقى في التقارير والقيود السابقة، لكنه لا يُعرض للاختيار.
 */
export function activeCategories(categories) {
  const all = categories || []
  const activeMain = new Set(all.filter(c => !c.parent_id && c.is_active !== false).map(c => c.id))
  return all.filter(c => (c.parent_id ? activeMain.has(c.parent_id) && c.is_active !== false : activeMain.has(c.id)))
}

/** تحقق مبدئي قبل الإرسال (الخادم يعيده ويبقى الحكم). siblings: التصنيفات في المستوى نفسه. */
export function nameError(name, siblings, selfId = null) {
  const v = cleanName(name)
  if (!v) return 'اكتب اسم التصنيف.'
  if (v.length > 60) return 'الاسم أطول من 60 حرفًا.'
  if (!/[A-Za-zء-ي]/.test(normCat(v))) return 'اكتب الاسم بحروف؛ الأرقام والرموز وحدها لا تميّز التصنيف.'
  const dup = (siblings || []).find(c => c.id !== selfId && normCat(c.name) === normCat(v))
  if (dup) return `يوجد تصنيف بالاسم نفسه: «${dup.name}»${dup.is_active === false ? ' (معطّل — أعد تفعيله بدل إنشاء جديد)' : ''}.`
  return null
}

const ACTIONS = { create: 'أُضيف', rename: 'أُعيدت تسميته', set_class: 'تغيّرت معالجته', disable: 'عُطّل', enable: 'أُعيد تفعيله', move: 'تغيّر ترتيبه' }
export const actionLabel = a => ACTIONS[a] || a

/** رسالة عربية لرموز خادم إعدادات التصنيفات. */
export function categoryMessage(res) {
  const d = res || {}
  const M = {
    no_session: 'انتهت الجلسة. سجّل الدخول من جديد.',
    forbidden: 'إدارة التصنيفات لمالك المنشأة فقط.',
    project_inactive: 'المنشأة موقوفة؛ لا يمكن تعديل التصنيفات الآن.',
    approval_v2_required: 'تُدار التصنيفات بعد تفعيل الاعتماد الجديد للمنشأة، حتى تبقى القيود مرتبطة بالتصنيف لا باسمه.',
    not_found: 'التصنيف غير موجود في منشأتك. حدّث الصفحة.',
    parent_not_found: 'التصنيف الرئيسي غير موجود. حدّث الصفحة.',
    parent_is_sub: 'لا يُضاف فرعي تحت تصنيف فرعي.',
    parent_inactive: `التصنيف الرئيسي «${d.parent || ''}» معطّل. فعّله أولًا ثم أضف الفرعي.`,
    class_required: 'اختر معالجة التصنيف الرئيسي.',
    class_invalid: 'المعالجة غير معروفة.',
    class_locked: `لا تتغير معالجة تصنيف مستخدم (${Number(d.entries || 0) + Number(d.items || 0) + Number(d.sub_items || 0)} قيدًا وبندًا). أنشئ تصنيفًا جديدًا بالمعالجة المطلوبة.`,
    sub_follows_parent: 'التصنيف الفرعي يتبع معالجة رئيسيه.',
    name_required: 'اكتب اسم التصنيف.',
    name_too_long: 'الاسم أطول من 60 حرفًا.',
    name_needs_letters: 'اكتب الاسم بحروف؛ الأرقام والرموز وحدها لا تميّز التصنيف.',
    duplicate_name: `يوجد تصنيف بالاسم نفسه: «${d.existing || ''}»${d.parent ? ` تحت «${d.parent}»` : ''}${d.existing_active === false ? ' (معطّل — أعد تفعيله بدل إنشاء جديد)' : ''}.`,
    no_change: 'لا تغيير لحفظه.',
    at_edge: 'التصنيف في طرف القائمة.',
    bad_request: 'طلب غير صالح. حدّث الصفحة.',
    network: 'انقطع الاتصال قبل وصول الرد. حدّث الصفحة وتحقق قبل إعادة المحاولة.',
  }
  return M[d.code] || `تعذّر الحفظ (${d.code || 'غير معروف'}).`
}
