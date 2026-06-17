import { supabase } from './supabase'

export const SALES_TYPES = [
  'مبيعات كاش', 'مبيعات شبكة', 'مبيعات هنقر ستيشن',
  'مبيعات جاهز', 'مبيعات كيتا', 'مبيعات سلة',
  'مبيعات تابي', 'مبيعات تمارا', 'تحصيل جملة',
  'مبيعات إلكترونية',
]

const EXCLUDED_TYPES = [
  'تحويل داخلي',
  'صرف عهدة',
  'إيداع نقدي',
  'تحويل داخلي — صرف عهدة',
  'تحويل داخلي — إيداع نقدي',
]

export function isSales(type) {
  return SALES_TYPES.some(s => (type || '').includes(s.replace(/^[^؀-ۿ]+/, '').trim()))
}

export function isExcluded(type) {
  return EXCLUDED_TYPES.some(t => (type || '').includes(t))
}

// للتوافق مع الكود القديم
export const isInternal = isExcluded

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

  // استثنِ كل أنواع التحويلات والصرف الداخلي من المبيعات والمصروفات
  const active = entries.filter(e => !isExcluded(e.type))

  // المبيعات = cash_in + bank_in من أنواع المبيعات فقط
  const salesEntries = active.filter(e => isSales(e.type))
  const cashSales    = sumField(salesEntries, 'cash_in')
  const networkSales = sumField(salesEntries, 'bank_in')
  const totalSales   = cashSales + networkSales

  // المصروفات = كل المخرجات من غير المبيعات وغير المستثنيات
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
