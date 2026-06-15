import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://dnuxevxxgmgptptmuzdy.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRudXhldnh4Z21ncHRwdG11emR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MjY1OTAsImV4cCI6MjA5NTEwMjU5MH0.o7lx6HiTU8a3XPF501WNFYk7NOxfYoBrphqVunhOk2s'
)

const { data: proj } = await supabase.from('projects').select('id').eq('name', 'ديوانية مزاهر').single()
const PID = proj.id
const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

// ── المستندات ────────────────────────────────────────────────────────────────
console.log('═══ DOCUMENTS آخر 24 ساعة ═══')
const { data: docs } = await supabase
  .from('documents')
  .select('id,file_name,status,journal_number,uploaded_by,uploaded_at')
  .eq('project_id', PID)
  .gte('uploaded_at', since)
  .order('uploaded_at', { ascending: false })

docs?.forEach((d, i) => {
  console.log(`\n[${i+1}] ${d.uploaded_at?.slice(0,19)}`)
  console.log(`  ID:      ${d.id}`)
  console.log(`  الاسم:   ${d.file_name}`)
  console.log(`  الحالة:  ${d.status}`)
  console.log(`  القيد:   ${d.journal_number || '—'}`)
  console.log(`  رُفع بواسطة: ${d.uploaded_by}`)
})

// ── القيود ────────────────────────────────────────────────────────────────────
console.log('\n═══ LEDGER ENTRIES آخر 24 ساعة ═══')
const { data: entries } = await supabase
  .from('ledger_entries')
  .select('id,date,type,description,total_amount,cash_out,bank_out,custody_out,status,journal_number,created_at')
  .eq('project_id', PID)
  .gte('created_at', since)
  .order('created_at', { ascending: false })

entries?.forEach((r, i) => {
  console.log(`\n[${i+1}] ${r.created_at?.slice(0,19)}`)
  console.log(`  ID:      ${r.id}`)
  console.log(`  التاريخ: ${r.date}`)
  console.log(`  الوصف:   ${r.description}`)
  console.log(`  المبلغ:  ${r.total_amount}  |  صندوق:${r.cash_out||0}  بنك:${r.bank_out||0}  عهدة:${r.custody_out||0}`)
  console.log(`  الحالة:  ${r.status}  |  رقم القيد: ${r.journal_number}`)
})
