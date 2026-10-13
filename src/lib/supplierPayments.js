// سداد الموردين: مسار واحد. يُسجَّل من «الموردين» (supplier_payment_record) فيخفض المستحق للمورد مع قيد الدفتر، ويُصحَّح بحذفه ذريًا
// (supplier_payment_delete: حركة المورد وقيد الدفتر وسجل إعادة المحاولة معًا) ثم تسجيله صحيحًا. الخادم يرفض أي قيد «سداد مورد» آخر من
// المتصفح وأي تعديل لمبلغه أو حذفه منفردًا (20261013120000)؛ الفحص هنا يُظهر الرسالة قبل حجز رقم القيد وقبل الطلب.

export const SUPPLIER_PAYMENT_TYPE = 'سداد مورد'
export const isSupplierPaymentType = type => String(type || '').includes(SUPPLIER_PAYMENT_TYPE)

export const SUPPLIER_PAYMENT_ONLY_MSG =
  'سداد الموردين يُسجَّل من صفحة «الموردين» وحدها، لأنها تخفض المستحق للمورد مع القيد؛ والمطابقة البنكية تطابق حركة البنك مع الدفعة المسجلة هناك.'
export const SUPPLIER_PAYMENT_EDIT_MSG =
  'لا يُعدَّل مبلغ قيد سداد المورد أو نوعه أو تاريخه من الدفتر: احذف الدفعة (تُحذف معها حركة المورد) ثم سجّلها صحيحة من «الموردين».'

const DELETE_MESSAGES = {
  no_session: 'انتهت الجلسة. سجّل الدخول من جديد.', forbidden: 'حذف دفعات الموردين للمحاسب فقط.', project_inactive: 'المنشأة موقوفة.',
  not_found: 'الدفعة غير موجودة في منشأتك (ربما حُذفت). حدّث الصفحة.', bad_request: 'طلب غير صالح. حدّث الصفحة.',
}
export const supplierPaymentDeleteMessage = code => DELETE_MESSAGES[code] || `لم تُحذف الدفعة (${code || 'غير معروف'}).`

// يعيد null عند النجاح أو نص الخطأ. القيد بلا رقم قيد (تاريخي) يُحذف بمعرّفه.
export async function deleteSupplierPayment(supabase, entry) {
  const { data, error } = await supabase.rpc('supplier_payment_delete', {
    p_journal_number: entry.journal_number || null, p_entry_id: entry.journal_number ? null : entry.id,
  })
  if (error) return error.message || 'خطأ غير معروف'
  return data?.ok ? null : supplierPaymentDeleteMessage(data?.code)
}
