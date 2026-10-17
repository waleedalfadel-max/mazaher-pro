// الموظفون في إعدادات المالك: أسماء الأدوار ورسائل الخادم وقواعد العرض. وحدة خالصة (تُختبر بلا متصفح).
// الخادم (supabase/migrations/20260930000000_employee_deactivation.sql) هو الحكم؛ هنا العرض والتنبيه المسبق فقط.

export const ROLE_LABELS = { owner: 'المالك', accountant: 'المحاسب', purchasing: 'المشتريات', cashier: 'الكاشير', superadmin: 'مزوّد الخدمة' }
export const roleLabel = r => ROLE_LABELS[r] || r

/** هل تعطيل هذا الموظف يترك المنشأة بلا محاسب نشط؟ (الخادم يطلب إقرارًا صريحًا حينها) */
export function isLastActiveAccountant(members, member) {
  if (!member || member.role !== 'accountant' || member.is_active === false) return false
  return !(members || []).some(m => m.id !== member.id && m.role === 'accountant' && m.is_active !== false)
}

// أدوار يضيفها المالك ويديرها (20261014130000). المالك ومدير المنصة لا يُداران من هنا.
export const STAFF_ROLES = ['accountant', 'purchasing', 'cashier']
export const isManagedStaff = m => !!m && STAFF_ROLES.includes(m.role)
export const ALL_BRANCHES = 'كل الفروع'
export const branchLabel = b => b || ALL_BRANCHES
/** فحص الرمز قبل الإرسال (الخادم هو الحكم): 5 أرقام بالضبط، والتأكيد مطابق. */
export function pinProblem(pin, confirm) {
  if (!/^[0-9]{5}$/.test(pin || '')) return 'الرمز 5 أرقام بالضبط.'
  if (pin !== confirm) return 'التأكيد لا يطابق الرمز.'
  return ''
}

/** زر الإجراء لكل صف: لا شيء لحساب المالك نفسه، وإلا تعطيل أو إعادة تفعيل. */
export function memberAction(member) {
  if (!member) return null
  if (member.is_self) return { kind: 'none', hint: 'حسابك. لا يمكنك تعطيله.' }
  return member.is_active === false ? { kind: 'reactivate', label: 'إعادة تفعيل' } : { kind: 'deactivate', label: 'تعطيل' }
}

const ACTIONS = { deactivate: 'عُطّل', reactivate: 'أُعيد تفعيله', create: 'أُضيف', set_access: 'تغيّر دوره أو فرعه', set_pin: 'عُيّن له رمز جديد' }
export const teamActionLabel = a => ACTIONS[a] || a

/** رسالة عربية لرموز خادم الفريق. */
export function teamMessage(res) {
  const d = res || {}
  const M = {
    no_session: 'انتهت الجلسة أو أُوقف الحساب. سجّل الدخول من جديد.',
    forbidden: 'إدارة الموظفين لمالك المنشأة فقط.',
    not_found: 'الموظف غير موجود في منشأتك. حدّث الصفحة.',
    self: 'لا يمكنك تعطيل حسابك.',
    last_owner: 'لا يُعطَّل آخر مالك نشط في المنشأة.',
    last_accountant: 'هذا المحاسب النشط الوحيد. أضف محاسبًا آخر أولًا، أو أكّد أثر تعطيله إن كان التعطيل هو المطلوب.',
    reason_too_long: 'السبب أطول من 200 حرف.',
    invalid_role: 'اختر دورًا: محاسب أو مشتريات أو كاشير.',
    invalid_branch: 'اختر فرعًا من فروع منشأتك أو «كل الفروع».',
    invalid_pin: 'الرمز 5 أرقام بالضبط.',
    invalid_name: 'أدخل اسمًا من 1 إلى 200 حرف.',
    pin_in_use: 'هذا الرمز مستخدم. اختر رمزًا آخر.',
    try_later: 'بلغت المنشأة حد إضافة الموظفين وتغيير الرموز مؤقتًا. أعد المحاولة لاحقًا.',
    save_failed: 'تعذّر الحفظ. حدّث القائمة وتحقق قبل إعادة المحاولة.',
    invalid: 'طلب غير صالح. حدّث الصفحة.',
    network: 'انقطع الاتصال قبل وصول الرد. حدّث الصفحة وتحقق قبل إعادة المحاولة.',
  }
  return M[d.code] || `تعذّر الحفظ (${d.code || 'غير معروف'}).`
}

/** رسالة للكتابة المباشرة المرفوضة على المستخدمين (شاشة المحاسب). */
export function userChangeMessage(error) {
  const m = String(error?.message || '')
  if (m.includes('user_change_forbidden')) return 'هذا التعديل لمالك المنشأة أو مزوّد الخدمة فقط.'
  if (m.includes('use_team_set_active')) return 'تعطيل الموظفين وإعادة تفعيلهم من إعدادات المالك.'
  if (m.includes('user_delete_forbidden')) return 'لا تُحذف حسابات الموظفين. لإيقاف موظف يعطّله المالك من الإعدادات.'
  // رفض صلاحية عام (إضافة أو تعديل أو غيرهما): لا يُنسب إلى الحذف
  if (/permission denied|row-level security/i.test(m)) return 'لا تملك صلاحية تنفيذ هذا الإجراء.'
  return m || 'تعذّر الحفظ.'
}
