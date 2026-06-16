import { supabase } from './supabase'

const INTERNAL_TRANSFER = 'تحويل داخلي'
export const SALES_TYPES = [
  'مبيعات كاش', 'مبيعات شبكة', 'مبيعات هنقر ستيشن',
  'مبيعات جاهز', 'مبيعات كيتا', 'مبيعات سلة',
  'مبيعات تابي', 'مبيعات تمارا', 'تحصيل جملة',
  'مبيعات إلكترونية',
]

export function isSales(type) {
  return SALES_TYPES.some(s => (type || '').includes(s.replace(/^[^؀-ۿ]+/, '').trim()))
}

export function isInternal(type) {
  return (type || '').includes(INTERNAL_TRANSFER)
}

function sumField(entries, field) {
  return entries.reduce((s, e) => s + (Number(e[field]) || 0), 0)
}

export async function getFinancialSummary(projectId, fromDate, toDate) {
  const { data: entries, error } = await supabase
    .from('ledger_entries')
    .select('type, cash_in, bank_in, custody_in, cash_out, bank_out, custody_out, total_amount, status, date')
    .eq('project_id', projectId)
    .gte('date', fromDate)
    .lte('date', toDate)
    .neq('status', 'cancelled')

  if (error || !entries) return null

  // استثنِ التحويلات الداخلية من كل الحسابات
  const active = entries.filter(e => !isInternal(e.type))

  // المبيعات = cash_in + bank_in من أنواع المبيعات فقط
  const salesEntries = active.filter(e => isSales(e.type))
  const cashSales    = sumField(salesEntries, 'cash_in')
  const networkSales = sumField(salesEntries, 'bank_in')
  const totalSales   = cashSales + networkSales

  // المصروفات = كل المخرجات من غير المبيعات وغير التحويلات
  const expenseEntries = active.filter(e => !isSales(e.type))
  const totalExpenses  = expenseEntries.reduce((s, e) =>
    s + (Number(e.cash_out) || 0) + (Number(e.bank_out) || 0) + (Number(e.custody_out) || 0), 0)

  // الأرصدة = كل الحركات بما فيها التحويلات الداخلية
  const all = entries
  const cashBalance    = sumField(all, 'cash_in')    - sumField(all, 'cash_out')
  const bankBalance    = sumField(all, 'bank_in')    - sumField(all, 'bank_out')
  const custodyBalance = sumField(all, 'custody_in') - sumField(all, 'custody_out')

  return {
    totalSales,
    cashSales,
    networkSales,
    totalExpenses,
    netProfit: totalSales - totalExpenses,
    cashBalance,
    bankBalance,
    custodyBalance,
    entries: active,
  }
}
