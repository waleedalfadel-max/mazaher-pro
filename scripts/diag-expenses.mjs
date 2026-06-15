import { createClient } from '@supabase/supabase-js'
const supabase = createClient(
  'https://dnuxevxxgmgptptmuzdy.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRudXhldnh4Z21ncHRwdG11emR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MjY1OTAsImV4cCI6MjA5NTEwMjU5MH0.o7lx6HiTU8a3XPF501WNFYk7NOxfYoBrphqVunhOk2s'
)

const { data: proj } = await supabase.from('projects').select('id').eq('name','ديوانية مزاهر').single()
const PID = proj.id

const { data: rows } = await supabase
  .from('ledger_entries')
  .select('cash_out,bank_out,custody_out,cash_in,bank_in,custody_in,date,type,description,total_amount')
  .eq('project_id', PID)
  .neq('status','cancelled')

// ── إجماليات ──
let cashOut=0, bankOut=0, custodyOut=0
rows.forEach(r => {
  cashOut    += Number(r.cash_out   ||0)
  bankOut    += Number(r.bank_out   ||0)
  custodyOut += Number(r.custody_out||0)
})
console.log('══ إجماليات الصادر (كل الوقت) ══')
console.log('cash_out:    ', cashOut.toFixed(2))
console.log('bank_out:    ', bankOut.toFixed(2))
console.log('custody_out: ', custodyOut.toFixed(2))
console.log('TOTAL OUT:   ', (cashOut+bankOut+custodyOut).toFixed(2))
console.log('عدد القيود:  ', rows.length)

// ── حسب النوع ──
const byType = {}
rows.forEach(r => {
  const out = Number(r.cash_out||0)+Number(r.bank_out||0)+Number(r.custody_out||0)
  if (!byType[r.type]) byType[r.type]=0
  byType[r.type]+=out
})
console.log('\n══ حسب النوع (الصادر فقط) ══')
Object.entries(byType)
  .filter(([,v])=>v>0)
  .sort(([,a],[,b])=>b-a)
  .forEach(([t,v])=>console.log(`  ${t.padEnd(40)} ${v.toFixed(2)}`))

// ── حسب الشهر ──
const byMonth = {}
rows.forEach(r => {
  const m = r.date?.slice(0,7) || 'unknown'
  const out = Number(r.cash_out||0)+Number(r.bank_out||0)+Number(r.custody_out||0)
  if (!byMonth[m]) byMonth[m]=0
  byMonth[m]+=out
})
console.log('\n══ توزيع الصادر حسب الشهر ══')
Object.entries(byMonth).sort().forEach(([m,v])=>console.log(`  ${m}   ${v.toFixed(2)}`))

// ── أكبر القيود ──
const outRows = rows
  .map(r=>({ ...r, out: Number(r.cash_out||0)+Number(r.bank_out||0)+Number(r.custody_out||0) }))
  .filter(r=>r.out>0)
  .sort((a,b)=>b.out-a.out)
  .slice(0,15)
console.log('\n══ أكبر 15 قيد صادر ══')
outRows.forEach(r=>console.log(`  ${r.date}  ${r.type?.slice(0,25).padEnd(26)} ${String(r.out).padStart(8)}  ${r.description?.slice(0,40)}`))
