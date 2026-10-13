import { supabase } from './supabase'

export async function getOrCreateJournalNumber(projectId, date) {
  // كل اعتماد يأخذ رقماً تسلسلياً جديداً — يمنع تعارض الـ unique constraint
  //
  // يمرّ عبر دالة SECURITY DEFINER لأن الكاشير يستدعي هذا أثناء إقفال اليوم،
  // وسنمنعه من SELECT المباشر على ledger_entries عند فرض الأدوار بـRLS.
  // الدالة تتحقق بنفسها أن المستدعي ينتمي للمشروع قبل القراءة.
  const { data, error } = await supabase.rpc('next_journal_number', {
    p_project_id: projectId,
    p_date: date,
  })
  if (!error && data) return data
  // لا حساب بديل في المتصفح: قراءة آخر رقم ثم +1 بلا قفل هي الطريقة المعيبة نفسها (تكرار تحت التزامن، و1000 بعد 999
  // مرة بعد مرة). الرقم يُحجز من العدّاد في القاعدة وحده؛ إن تعذّر، تتوقف العملية عند هذه الخطوة وتظهر رسالة.
  throw new Error('تعذّر حجز رقم القيد، فتوقفت العملية. أعد المحاولة.' + (error?.message ? ` (${error.message})` : ''))
}

// احتفظ بالاسم القديم للتوافق مع أي استخدام مباشر
export async function nextJournalNumber(projectId, _type, date) {
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return getOrCreateJournalNumber(projectId, date || today)
}
