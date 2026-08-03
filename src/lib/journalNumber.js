import { supabase } from './supabase'

export async function getOrCreateJournalNumber(projectId, date) {
  // كل اعتماد يأخذ رقماً تسلسلياً جديداً — يمنع تعارض الـ unique constraint
  const year = new Date(date).getFullYear()
  const { data: last } = await supabase
    .from('ledger_entries')
    .select('journal_number')
    .eq('project_id', projectId)
    .like('journal_number', `QD-${year}-%`)
    .order('journal_number', { ascending: false })
    .limit(1)

  const seq = last?.[0]?.journal_number
    ? (parseInt(last[0].journal_number.split('-').pop()) || 0) + 1
    : 1
  return `QD-${year}-${String(seq).padStart(3, '0')}`
}

// احتفظ بالاسم القديم للتوافق مع أي استخدام مباشر
export async function nextJournalNumber(projectId, _type, date) {
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return getOrCreateJournalNumber(projectId, date || today)
}
