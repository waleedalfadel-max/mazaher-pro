import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://dnuxevxxgmgptptmuzdy.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRudXhldnh4Z21ncHRwdG11emR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MjY1OTAsImV4cCI6MjA5NTEwMjU5MH0.o7lx6HiTU8a3XPF501WNFYk7NOxfYoBrphqVunhOk2s'
)

const PID = '50b7ed07-1faa-4882-b0bc-ad3823a2a417' // تشورميك

// حساب الفترات كما يفعل الكود تماماً
const n   = new Date()
const today = n.toISOString().split('T')[0]
const monthFrom = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-01`
const yearFrom  = `${n.getFullYear()}-01-01`

console.log(`اليوم:       ${today}`)
console.log(`الشهر الحالي: ${monthFrom} → ${today}`)
console.log(`السنة:        ${yearFrom} → ${today}`)

async function simulateEngine(from, to, label) {
  const { data: entries } = await supabase
    .from('ledger_entries')
    .select('type,cash_in,bank_in,custody_in,cash_out,bank_out,custody_out')
    .eq('project_id', PID)
    .gte('date', from).lte('date', to)
    .neq('status', 'cancelled')

  const SALES = ['مبيعات كاش','مبيعات شبكة','مبيعات هنقر ستيشن','مبيعات جاهز','مبيعات كيتا','مبيعات سلة','مبيعات تابي','مبيعات تمارا','تحصيل جملة','مبيعات إلكترونية']
  const isSales = t => SALES.some(s => (t||'').includes(s.replace(/^[^؀-ۿ]+/,'')))
  const isInt   = t => (t||'').includes('تحويل داخلي')
  const active  = (entries||[]).filter(r => !isInt(r.type))
  const sales   = active.filter(r => isSales(r.type))
  const exp     = active.filter(r => !isSales(r.type))

  const cashSales    = sales.reduce((s,r)=>s+(Number(r.cash_in)||0),0)
  const networkSales = sales.reduce((s,r)=>s+(Number(r.bank_in)||0),0)
  const totalSales   = cashSales + networkSales
  const totalExpenses= exp.reduce((s,r)=>s+(Number(r.cash_out)||0)+(Number(r.bank_out)||0)+(Number(r.custody_out)||0),0)
  return { label, cashSales, networkSales, totalSales, totalExpenses, netProfit: totalSales-totalExpenses, count: (entries||[]).length }
}

async function simulateDashboardOld(from, to, label) {
  const [{ data: salesRows }, { data: ledgerRows }] = await Promise.all([
    supabase.from('sales')
      .select('cash_sales,network_sales,hunger_sales,jahez_sales,keeta_sales')
      .eq('project_id', PID).gte('date', from).lte('date', to),
    supabase.from('ledger_entries')
      .select('type,cash_out,bank_out,custody_out')
      .eq('project_id', PID).neq('status','cancelled').gte('date',from).lte('date',to),
  ])
  const totalSales = (salesRows||[]).reduce((s,r)=>
    s+(r.cash_sales||0)+(r.network_sales||0)+(r.hunger_sales||0)+(r.jahez_sales||0)+(r.keeta_sales||0),0)
  const totalExpenses = (ledgerRows||[])
    .filter(r=>!(r.type||'').includes('تحويل داخلي'))
    .reduce((s,r)=>s+(r.cash_out||0)+(r.bank_out||0)+(r.custody_out||0),0)
  return { label, totalSales, totalExpenses, netProfit: totalSales-totalExpenses }
}

const fmt = v => v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',')

// ── الشهر الحالي ──
const [engMonth, oldMonth] = await Promise.all([
  simulateEngine(monthFrom, today, 'شهر — engine'),
  simulateDashboardOld(monthFrom, today, 'شهر — dashboard قديم'),
])

// ── السنة ──
const [engYear, oldYear] = await Promise.all([
  simulateEngine(yearFrom, today, 'سنة — engine'),
  simulateDashboardOld(yearFrom, today, 'سنة — dashboard قديم'),
])

console.log('\n══════════════════════════════════════════════════════')
console.log('                  الشهر الحالي')
console.log('══════════════════════════════════════════════════════')
console.log(`  العدد:           ${engMonth.count} قيد`)
console.log(`                   DASHBOARD (بعد engine)      REPORTS قائمة الدخل`)
console.log(`  إجمالي المبيعات: ${fmt(engMonth.totalSales).padStart(15)}        ${fmt(engMonth.totalSales).padStart(15)}`)
console.log(`  إجمالي المصروفات:${fmt(engMonth.totalExpenses).padStart(15)}        ${fmt(engMonth.totalExpenses).padStart(15)}`)
console.log(`  صافي الربح:      ${fmt(engMonth.netProfit).padStart(15)}        ${fmt(engMonth.netProfit).padStart(15)}`)
console.log(`\n  Dashboard القديم (قبل engine):`)
console.log(`    totalSales    = ${fmt(oldMonth.totalSales)}`)
console.log(`    totalExpenses = ${fmt(oldMonth.totalExpenses)}`)
console.log(`    netProfit     = ${fmt(oldMonth.netProfit)}`)

console.log('\n══════════════════════════════════════════════════════')
console.log('                  السنة الحالية')
console.log('══════════════════════════════════════════════════════')
console.log(`  إجمالي المبيعات:  ${fmt(engYear.totalSales)}`)
console.log(`  إجمالي المصروفات: ${fmt(engYear.totalExpenses)}`)
console.log(`  صافي الربح:       ${fmt(engYear.netProfit)}`)
console.log(`  Dashboard قديم:   sales=${fmt(oldYear.totalSales)}  expenses=${fmt(oldYear.totalExpenses)}`)

// ── تفاصيل حسب التاريخ ──
const { data: allWithDate } = await supabase
  .from('ledger_entries')
  .select('type,date,cash_in,bank_in,cash_out,bank_out')
  .eq('project_id', PID).neq('status','cancelled')
  .order('date')
console.log('\n══ كل القيود بالتاريخ ══')
;(allWithDate||[]).forEach(r => {
  const inAmt  = (Number(r.cash_in)||0)+(Number(r.bank_in)||0)
  const outAmt = (Number(r.cash_out)||0)+(Number(r.bank_out)||0)
  console.log(`  ${r.date}  ${(r.type||'').padEnd(30)}  IN:${inAmt?fmt(inAmt):' —    '}  OUT:${outAmt?fmt(outAmt):' —    '}`)
})
