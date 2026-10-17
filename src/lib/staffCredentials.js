// لا تُقرأ الرموز المخزنة. الخادم يتحقق من الجلسة والنطاق ويعيد نتيجة الحفظ فقط.
import { waitText } from './waitText.js'
import { STALE_MESSAGE } from './appVersion.js'

const MESSAGES = {
  no_session: 'انتهت الجلسة أو أُوقف الحساب. سجّل الدخول من جديد.',
  forbidden: 'لا تملك صلاحية إدارة هؤلاء المستخدمين.',
  not_found: 'المستخدم غير موجود ضمن الحسابات التي يمكنك إدارتها.',
  invalid: 'طلب غير صالح. حدّث الصفحة وحاول مرة أخرى.',
  invalid_pin: 'رمز الدخول 5 أرقام بالضبط.',
  invalid_name: 'أدخل اسمًا من 1 إلى 200 حرف.',
  pin_in_use: 'هذا الرمز مستخدم بالفعل.',
  try_later: 'بلغت المنشأة حد إضافة الموظفين وتغيير الرموز مؤقتًا. انتظر قليلًا ثم أعد المحاولة.',
  save_failed: 'تعذّر الحفظ. حدّث القائمة وتحقق قبل إعادة المحاولة.',
  invalid_role: 'اختر دورًا صالحًا.',
  invalid_branch: 'اختر فرعًا من فروع المنشأة أو «كل الفروع».',
  owner_all_branches: 'المالك لكل فروع المنشأة؛ اختر «كل الفروع».',
  branch_required: 'الكاشير لفرع محدد؛ اختر الفرع.',
  last_owner: 'هذا آخر مالك نشط في المنشأة. أضف مالكًا آخر أولًا.',
  network: 'تعذّر تأكيد الحفظ. تحقق من الاتصال وحدّث القائمة قبل إعادة المحاولة.',
}

// extra: حقول نتيجة مسماة يُسمح بتمريرها (لا غيرها)، لإجراءات مدير المنصة التي تحتاج نتيجتها (الجلسات، حذف أو أرشفة)
async function save(client, name, args, extra = []) {
  try {
    const { data, error } = await client.rpc(name, args)
    if (error) return { ok: false, message: error.code === 'APP_VERSION_STALE' ? STALE_MESSAGE : MESSAGES.network }
    if (data?.ok !== true || typeof data.id !== 'string') {
      if (data?.code === 'try_later' && Number(data.retry_after) > 0) {
        return { ok: false, message: `بلغت المنشأة حد إضافة الموظفين وتغيير الرموز مؤقتًا. أعد المحاولة بعد ${waitText(data.retry_after)}.` }
      }
      return { ok: false, message: MESSAGES[data?.code] || MESSAGES.save_failed }
    }
    const more = Object.fromEntries(extra.filter(k => typeof data[k] === 'string').map(k => [k, data[k]]))
    return { ok: true, id: data.id, ...more }
  } catch {
    return { ok: false, message: MESSAGES.network }
  }
}

export const createStaff = (client, { name, role, pin }) =>
  save(client, 'staff_create', { p_name: name.trim(), p_role: role, p_pin: pin })

export const setStaffPin = (client, userId, pin) =>
  save(client, 'staff_set_pin', { p_user_id: userId, p_pin: pin })

// مدير المنصة: إضافة موظف لمنشأة عبر الخادم (يُخزَّن الرمز للتحقق فقط، لا مقروءًا). لم يعد الإدراج المباشر ممكنًا.
export const adminCreateStaff = (client, { projectId, name, role, branch, pin }) =>
  save(client, 'admin_staff_create', { p_project_id: projectId, p_name: name.trim(), p_role: role, p_branch: branch?.trim() || null, p_pin: pin })

// مدير المنصة: إدارة مستخدمي المنشآت عبر الخادم (admin_write_user): التعديل، والرمز الجديد (يلغي الجلسات)، والتعطيل/التفعيل، والحذف أو الأرشفة
export const adminUpdateStaff = (client, { userId, name, role, branch }) =>
  save(client, 'admin_staff_update', { p_user_id: userId, p_name: name.trim(), p_role: role, p_branch: branch?.trim() || null })
export const adminSetStaffPin = (client, userId, pin) =>
  save(client, 'admin_staff_set_pin', { p_user_id: userId, p_pin: pin }, ['sessions'])
export const adminSetStaffActive = (client, userId, active) =>
  save(client, 'admin_staff_set_active', { p_user_id: userId, p_active: !!active })
export const adminRemoveStaff = (client, userId) =>
  save(client, 'admin_staff_remove', { p_user_id: userId }, ['result'])
