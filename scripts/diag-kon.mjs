import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://dnuxevxxgmgptptmuzdy.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRudXhldnh4Z21ncHRwdG11emR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MjY1OTAsImV4cCI6MjA5NTEwMjU5MH0.o7lx6HiTU8a3XPF501WNFYk7NOxfYoBrphqVunhOk2s'
)

// Project ID محمصة كون
const PID = 'ab1c819e-441f-46ce-919b-db9f0711910b'
console.log('Project ID:', PID)

// ── جلب كل القيود (مع الوارد والصادر كليهما) ──
const { data: allRows, error: err1 } = await supabase
  .from('ledger_entries')
  .select('type,description,cash_out,bank_out,custody_out,cash_in,bank_in,custody_in,journal_number,date')
  .eq('project_id', PID)
  .neq('status', 'cancelled')
  .order('date', { ascending: false })

if (err1) { console.error('خطأ:', err1.message); process.exit(1) }
console.log(`\nإجمالي القيود: ${(allRows||[]).length}`)

const rows = allRows || []

// ── القيود الصادرة (مصروفات) ──
const expRows = rows.filter(r =>
  (Number(r.cash_out)||0) + (Number(r.bank_out)||0) + (Number(r.custody_out)||0) > 0
)
const rawTotal = expRows.reduce((s,r) =>
  s + (Number(r.cash_out)||0) + (Number(r.bank_out)||0) + (Number(r.custody_out)||0), 0)

console.log(`\n══ إجمالي الصادر الخام (كل قيود out > 0) ══`)
console.log(`   TOTAL: ${rawTotal.toFixed(2)}   (${expRows.length} قيد)`)

// ── حسب النوع ──
const byType = {}
expRows.forEach(r => {
  const out = (Number(r.cash_out)||0)+(Number(r.bank_out)||0)+(Number(r.custody_out)||0)
  const t = r.type || '—'
  byType[t] = (byType[t] || 0) + out
})
console.log('\n══ الصادر حسب النوع ══')
Object.entries(byType).sort(([,a],[,b])=>b-a).forEach(([t,v]) => {
  const flag = t.includes('مبيعات') ? ' ⚠️مبيعات' : t.includes('تحصيل') ? ' ⚠️تحصيل' : ''
  console.log(`  ${String(v.toFixed(2)).padStart(10)}  ${t}${flag}`)
})

// ── salesIncomeJNs ──
const salesIncomeJNs = new Set(
  rows.filter(r =>
    (r.type||'').includes('مبيعات') &&
    ((Number(r.bank_in)||0)+(Number(r.cash_in)||0)+(Number(r.custody_in)||0)) > 0 &&
    r.journal_number
  ).map(r => r.journal_number)
)
console.log(`\n   salesIncomeJNs (قيود بها إيراد مبيعات): ${salesIncomeJNs.size} → [${[...salesIncomeJNs].join(', ')}]`)

// ── document_items ──
const { data: docItems, error: err2 } = await supabase
  .from('document_items')
  .select('journal_number,description,amount,category_main,category_sub')
  .eq('project_id', PID)

if (err2) { console.error('خطأ document_items:', err2.message); process.exit(1) }
console.log(`   document_items: ${(docItems||[]).length} بند`)

// ── محاكاة الكود الجديد ──
const mainMap = {}
const addItem = (rawMain, amount) => {
  if (!rawMain || rawMain.includes('مبيعات') || !amount) return
  mainMap[rawMain] = (mainMap[rawMain] || 0) + amount
}

// المصدر 1: docItems مع تتبع docItemJNs فقط من البنود التي مرّت
const docItemJNs = new Set()
;(docItems||[]).forEach(item => {
  const rawMain = item.category_main || '— غير محدد'
  const amount  = Number(item.amount) || 0
  if (salesIncomeJNs.has(item.journal_number) && rawMain === '— غير محدد') return
  if (!rawMain || rawMain.includes('مبيعات') || !amount) return
  if (item.journal_number) docItemJNs.add(item.journal_number)
  addItem(rawMain, amount)
})

// المصدر 2: entries
expRows.forEach(r => {
  const out = (Number(r.cash_out)||0)+(Number(r.bank_out)||0)+(Number(r.custody_out)||0)
  const t = r.type || ''
  if (t.includes('تحويل داخلي') || t.includes('مبيعات') || t.includes('تحصيل')) return
  if (r.journal_number && docItemJNs.has(r.journal_number)) return
  addItem(t || '— غير محدد', out)
})

const simulatedTotal = Object.values(mainMap).reduce((s,v)=>s+v, 0)
console.log(`\n══ محاكاة Reports.jsx (الكود الحالي) ══`)
console.log(`   grandTotal = ${simulatedTotal.toFixed(2)}`)
Object.entries(mainMap).sort(([,a],[,b])=>b-a).forEach(([k,v]) =>
  console.log(`     ${v.toFixed(2).padStart(10)}  ${k}`)
)

// ── ما يُستبعد من entries بسبب النوع ──
console.log('\n══ مستبعد من entries بسبب نوعه (مبيعات/تحصيل/تحويل) ══')
const skippedByType = expRows.filter(r => {
  const t = r.type || ''
  return t.includes('تحويل داخلي') || t.includes('مبيعات') || t.includes('تحصيل')
})
let skippedTotal = 0
skippedByType.forEach(r => {
  const out = (Number(r.cash_out)||0)+(Number(r.bank_out)||0)+(Number(r.custody_out)||0)
  skippedTotal += out
  console.log(`  SKIP  ${r.date}  ${out.toFixed(2).padStart(10)}  ${r.type}`)
})
console.log(`  مجموع المستبعد بالنوع: ${skippedTotal.toFixed(2)}`)

// ── ما يُستبعد من entries بسبب docItemJNs ──
console.log('\n══ مستبعد من entries بسبب docItemJNs (مغطى بـ docItems) ══')
const skippedByJN = expRows.filter(r => {
  const t = r.type || ''
  if (t.includes('تحويل داخلي') || t.includes('مبيعات') || t.includes('تحصيل')) return false
  return r.journal_number && docItemJNs.has(r.journal_number)
})
let skippedJNTotal = 0
skippedByJN.forEach(r => {
  const out = (Number(r.cash_out)||0)+(Number(r.bank_out)||0)+(Number(r.custody_out)||0)
  skippedJNTotal += out
  console.log(`  EXCL  ${r.date}  ${out.toFixed(2).padStart(10)}  ${r.type}  JN:${r.journal_number}`)
})
console.log(`  مجموع المستبعد بـ JN: ${skippedJNTotal.toFixed(2)}`)

// ── ملخص الفجوة ──
console.log('\n══ ملخص الفجوة ══')
console.log(`  الصادر الخام (لوحة التحكم):  ${rawTotal.toFixed(2)}`)
console.log(`  المحاكى (بطاقة التقارير):     ${simulatedTotal.toFixed(2)}`)
console.log(`  الفجوة:                        ${(rawTotal - simulatedTotal).toFixed(2)}`)
console.log(`    - مستبعد بالنوع:             ${skippedTotal.toFixed(2)}`)
console.log(`    - مستبعد بـ docItemJNs:      ${skippedJNTotal.toFixed(2)}`)
