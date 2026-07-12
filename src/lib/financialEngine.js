import { supabase } from './supabase'

export const SALES_TYPES = [
  'مبيعات كاش', 'مبيعات شبكة', 'مبيعات تحويل', 'مبيعات هنقر ستيشن',
  'مبيعات جاهز', 'مبيعات كيتا', 'مبيعات مرسول', 'مبيعات سلة',
  'مبيعات تابي', 'مبيعات تمارا', 'تحصيل جملة',
  'مبيعات إلكترونية',
]

const EXCLUDED_TYPES = [
  'تحويل داخلي',
  'صرف عهدة',
  'إيداع نقدي',
  'تحويل داخلي — صرف عهدة',
  'تحويل داخلي — إيداع نقدي',
  'تحصيل ذمم',
]

export const WITHDRAWALS_TYPES = [
  'مسحوبات سليمان', 'مسحوبات فايز', 'مسحوبات أم طوبى',
  'مسحوبات الشركاء', '💼 مسحوبات الشركاء', 'مسحوبات',
]

export const DEBT_TYPES = [
  'قسط سيارة', '💳 قسط سيارة',
  'قسط شراء أرض',
  'قرض ١', 'قرض ٢', 'قرض 1', 'قرض 2',
  'قرض نقاط البيع', '💳 قرض نقاط البيع',
  'قسط',
]

export function isSales(type) {
  return SALES_TYPES.some(s => (type || '').includes(s.replace(/^[^؀-ۿ]+/, '').trim()))
}

export function isExcluded(type) {
  return EXCLUDED_TYPES.some(t => (type || '').includes(t))
}

export const COGS_TYPES = [
  '🥩 تكلفة البضاعة المباعة',
  '☕ مشتريات قهوة ومواد',
  '📦 مواد تعبئة وتغليف',
]

export function isCOGS(type) {
  const t = type || ''
  return COGS_TYPES.some(c => t.includes(c.replace(/^[^؀-ۿ]+/, '').trim()))
}

export function isWithdrawal(type) {
  return WITHDRAWALS_TYPES.some(t => (type || '').includes(t))
}

export function isDebt(type) {
  return DEBT_TYPES.some(t => (type || '').includes(t))
}

function isRealExpense(entry) {
  const type = entry.type || ''
  if (isWithdrawal(type)) return false
  if (isDebt(type))       return false
  if (type.includes('ضريبة')) return false
  return true
}

// للتوافق مع الكود القديم
export const isInternal = isExcluded

function sumField(entries, field) {
  return entries.reduce((s, e) => s + (Number(e[field]) || 0), 0)
}

export async function getFinancialSummary(projectId, fromDate, toDate) {
  const { data: entries, error } = await supabase
    .from('ledger_entries')
    .select('type, cash_in, bank_in, custody_in, cash_out, bank_out, custody_out, receivable_in, receivable_out, total_amount, status, date, branch')
    .eq('project_id', projectId)
    .gte('date', fromDate)
    .lte('date', toDate)
    .neq('status', 'cancelled')

  if (error || !entries) return null

  // استثنِ كل أنواع التحويلات والصرف الداخلي من المبيعات والمصروفات
  const active = entries.filter(e => !isExcluded(e.type))

  // المبيعات = cash_in + bank_in + receivable_in (هنقر/جاهز/كيتا → ذمم مدينة في receivable_in)
  const salesEntries = active.filter(e => isSales(e.type))
  const cashSales    = sumField(salesEntries, 'cash_in')
  const networkSales = sumField(salesEntries, 'bank_in')
  const appSales     = sumField(salesEntries, 'receivable_in')
  const totalSales   = cashSales + networkSales + appSales

  // كل مخرجات غير المبيعات وغير المستثنيات
  const expenseEntries = active.filter(e => !isSales(e.type))

  // المصروفات الحقيقية فقط (بدون مسحوبات / أقساط / قروض / ضريبة)
  const realExpenseEntries = expenseEntries.filter(isRealExpense)
  const sumOut = entries => entries.reduce((s, e) =>
    s + (Number(e.cash_out) || 0) + (Number(e.bank_out) || 0) + (Number(e.custody_out) || 0), 0)

  const totalExpenses = sumOut(realExpenseEntries)

  // تكلفة البضاعة المباعة — منفصلة عن المصروفات التشغيلية
  const cogsEntries       = realExpenseEntries.filter(e => isCOGS(e.type))
  const cogs              = sumOut(cogsEntries)
  const operatingExpenses = totalExpenses - cogs
  const grossProfit       = totalSales - cogs

  // مسحوبات وديون — للعرض فقط، لا تدخل في صافي الربح
  const totalWithdrawals = sumOut(expenseEntries.filter(e => isWithdrawal(e.type)))
  const totalDebts       = sumOut(expenseEntries.filter(e => isDebt(e.type)))

  // الأرصدة = كل الحركات بما فيها التحويلات الداخلية
  const all = entries
  const cashBalance        = sumField(all, 'cash_in')       - sumField(all, 'cash_out')
  const bankBalance        = sumField(all, 'bank_in')       - sumField(all, 'bank_out')
  const custodyBalance     = sumField(all, 'custody_in')    - sumField(all, 'custody_out')
  const receivableBalance  = sumField(all, 'receivable_in') - sumField(all, 'receivable_out')

  return {
    totalSales,
    cashSales,
    networkSales,
    appSales,
    totalExpenses,
    cogs,
    operatingExpenses,
    grossProfit,
    netProfit: grossProfit - operatingExpenses,
    totalWithdrawals,
    totalDebts,
    cashBalance,
    bankBalance,
    custodyBalance,
    receivableBalance,
    entries: active,
  }
}
