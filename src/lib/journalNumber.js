import { supabase } from './supabase'

function prefix(type) {
  if (!type) return 'JV'
  if (type.includes('مبيعات')) return 'POS'
  if (type.includes('مصروفات')) return 'EXP'
  return 'JV'
}

export async function nextJournalNumber(projectId, type) {
  const pre  = prefix(type)
  const year = new Date().getFullYear()

  const { data } = await supabase
    .from('ledger_entries')
    .select('journal_number')
    .eq('project_id', projectId)
    .like('journal_number', `${pre}-${year}-%`)
    .order('journal_number', { ascending: false })
    .limit(1)

  const last = data?.[0]?.journal_number
  const seq  = last ? (parseInt(last.split('-').pop()) || 0) + 1 : 1
  return `${pre}-${year}-${String(seq).padStart(3, '0')}`
}
