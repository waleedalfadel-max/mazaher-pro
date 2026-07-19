import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://dnuxevxxgmgptptmuzdy.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRudXhldnh4Z21ncHRwdG11emR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MjY1OTAsImV4cCI6MjA5NTEwMjU5MH0.o7lx6HiTU8a3XPF501WNFYk7NOxfYoBrphqVunhOk2s'
)

// ابحث أولاً عن project_id لـ تشورميك
const { data: projects } = await supabase.from('projects').select('id,name')
const proj = (projects || []).find(p => p.name?.includes('تشورميك') || p.name?.includes('شورم'))
if (!proj) {
  console.log('المشاريع المتاحة:', (projects||[]).map(p=>`${p.id} → ${p.name}`).join('\n'))
  console.log('لم يُعثر على تشورميك — جرّب project_id يدوياً')
  process.exit(1)
}
const PID = proj.id
console.log(`تشورميك → ${PID}`)

// جلب كل القيود
const { data: rows, error } = await supabase
  .from('ledger_entries')
  .select('type,cash_in,bank_in,custody_in,cash_out,bank_out,custody_out,status')
  .eq('project_id', PID)
  .neq('status', 'cancelled')

if (error) { console.error('خطأ:', error.message); process.exit(1) }
console.log(`\nإجمالي القيود: ${(rows||[]).length}`)

// GROUP BY type
const byType = {}
;(rows||[]).forEach(r => {
  const t = r.type || '—'
  if (!byType[t]) byType[t] = { cash_in:0, bank_in:0, custody_in:0, cash_out:0, bank_out:0, custody_out:0 }
  byType[t].cash_in    += Number(r.cash_in)    || 0
  byType[t].bank_in    += Number(r.bank_in)    || 0
  byType[t].custody_in += Number(r.custody_in) || 0
  byType[t].cash_out   += Number(r.cash_out)   || 0
  byType[t].bank_out   += Number(r.bank_out)   || 0
  byType[t].custody_out+= Number(r.custody_out)|| 0
})

console.log('\n══ حسب النوع (كما في SQL) ══')
console.log('النوع'.padEnd(40) + 'cash_in'.padStart(10) + 'bank_in'.padStart(10) + 'cash_out'.padStart(10) + 'bank_out'.padStart(10) + 'cust_out'.padStart(10))
console.log('─'.repeat(90))
Object.entries(byType).sort(([a],[b])=>a.localeCompare(b,'ar')).forEach(([t,v]) => {
  console.log(
    t.padEnd(40) +
    (v.cash_in    ?v.cash_in.toFixed(2):'—').padStart(10) +
    (v.bank_in    ?v.bank_in.toFixed(2):'—').padStart(10) +
    (v.cash_out   ?v.cash_out.toFixed(2):'—').padStart(10) +
    (v.bank_out   ?v.bank_out.toFixed(2):'—').padStart(10) +
    (v.custody_out?v.custody_out.toFixed(2):'—').padStart(10)
  )
})

// محاكاة financialEngine
const SALES_TYPES = ['مبيعات كاش','مبيعات شبكة','مبيعات هنقر ستيشن','مبيعات جاهز','مبيعات كيتا','مبيعات سلة','مبيعات تابي','مبيعات تمارا','تحصيل جملة','مبيعات إلكترونية']
const isSales    = t => SALES_TYPES.some(s => (t||'').includes(s.replace(/^[^؀-ۿ]+/,'').trim()))
const isInternal = t => (t||'').includes('تحويل داخلي')

const active        = (rows||[]).filter(r => !isInternal(r.type))
const salesEntries  = active.filter(r => isSales(r.type))
const expEntries    = active.filter(r => !isSales(r.type))
const cashSales     = salesEntries.reduce((s,r)=>s+(Number(r.cash_in)||0),0)
const networkSales  = salesEntries.reduce((s,r)=>s+(Number(r.bank_in)||0),0)
const totalSales    = cashSales + networkSales
const totalExpenses = expEntries.reduce((s,r)=>s+(Number(r.cash_out)||0)+(Number(r.bank_out)||0)+(Number(r.custody_out)||0),0)
const netProfit     = totalSales - totalExpenses

console.log('\n══ محاكاة financialEngine ══')
console.log(`  cashSales    = ${cashSales.toFixed(2)}`)
console.log(`  networkSales = ${networkSales.toFixed(2)}`)
console.log(`  totalSales   = ${totalSales.toFixed(2)}`)
console.log(`  totalExpenses= ${totalExpenses.toFixed(2)}`)
console.log(`  netProfit    = ${netProfit.toFixed(2)}`)

// محاكاة Dashboard القديم (sales table)
const { data: salesRows } = await supabase.from('sales')
  .select('cash_sales,network_sales,hunger_sales,jahez_sales,keeta_sales')
  .eq('project_id', PID)
const salesTotal = (salesRows||[]).reduce((s,r)=>
  s+(r.cash_sales||0)+(r.network_sales||0)+(r.hunger_sales||0)+(r.jahez_sales||0)+(r.keeta_sales||0),0)
console.log(`\n  sales table (القديم) = ${salesTotal.toFixed(2)}`)

// ما لا يُصنَّف كـ sales من العينة
console.log('\n══ الأنواع التي لا تُعدّ مبيعات (أو مصروفات) حسب engine ══')
Object.entries(byType).forEach(([t,v]) => {
  const tot_in  = v.cash_in + v.bank_in + v.custody_in
  const tot_out = v.cash_out + v.bank_out + v.custody_out
  if (!tot_in && !tot_out) return
  const sal = isSales(t) ? '✅مبيعات' : isInternal(t) ? '⟳داخلي' : tot_out > 0 ? '🔴مصروف' : '⬛وارد-لا-مصروف'
  if (!isSales(t) && !isInternal(t) && tot_in > 0)
    console.log(`  ⚠️ وارد غير مصنف: ${t.padEnd(35)} in=${tot_in.toFixed(2)}`)
})
