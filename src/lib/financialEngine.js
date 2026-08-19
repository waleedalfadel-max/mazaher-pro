import { supabase, fetchAllRows } from './supabase'

// نسبة ضريبة القيمة المضافة بالسعودية
export const VAT_RATE = 0.15

const SALES_KEYWORD = 'مبيعات'
const SALES_EXTRA_TYPES = ['تحصيل جملة']  // النوع الوحيد المصنَّف مبيعات بلا كلمة "مبيعات" بنصه

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
  const t = type || ''
  return t.includes(SALES_KEYWORD) || SALES_EXTRA_TYPES.some(s => t.includes(s))
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

export async function getFinancialSummary(projectId, fromDate, toDate, branch = null) {
  const { data: entries, error } = await fetchAllRows(() => {
    let q = supabase
      .from('ledger_entries')
      .select('type, cash_in, bank_in, custody_in, cash_out, bank_out, custody_out, receivable_in, receivable_out, payable_in, payable_out, vat_amount, total_amount, status, date, branch')
      .eq('project_id', projectId)
      .gte('date', fromDate)
      .lte('date', toDate)
      .neq('status', 'cancelled')
    if (branch && branch !== 'all') q = q.eq('branch', branch)
    return q
  })

  if (error || !entries) return null

  // استثنِ كل أنواع التحويلات والصرف الداخلي من المبيعات والمصروفات
  const active = entries.filter(e => !isExcluded(e.type))

  // المبيعات = cash_in + bank_in + receivable_in (هنقر/جاهز/كيتا → ذمم مدينة في receivable_in)
  const salesEntries = active.filter(e => isSales(e.type))
  const cashSales    = sumField(salesEntries, 'cash_in')
  const networkSales = sumField(salesEntries, 'bank_in')
  const appSales     = sumField(salesEntries, 'receivable_in')

  // الحركة النقدية المقبوضة فعلاً — شاملة ضريبة المخرجات
  const grossSales = cashSales + networkSales + appSales

  // ضريبة المخرجات ليست إيراداً بل التزام لهيئة الزكاة، فتُستبعَد من المبيعات.
  // تُشتقّ بالقسمة لا تُقرأ من vat_amount: قيود المبيعات لا تكتب ذلك العمود
  // إطلاقاً (انظر mkEntry/mkReceivable بـPendingDocuments و QuickSale)، فطرحه
  // منها كان سيُبقيها إجمالية ويرفع صافي الربح خطأً.
  // ⚠️ يفترض أن كل المبيعات خاضعة لـ15% — مؤكَّد لمزاهر. أي مبيعات معفاة
  // مستقبلاً تحتاج تخزين vat_amount على قيد المبيعة نفسها بدل الاشتقاق.
  const totalSales = grossSales / (1 + VAT_RATE)

  // كل مخرجات غير المبيعات وغير المستثنيات
  const expenseEntries = active.filter(e => !isSales(e.type))

  // المصروفات الحقيقية فقط (بدون مسحوبات / أقساط / قروض / ضريبة)
  const realExpenseEntries = expenseEntries.filter(isRealExpense)
  const sumOut = entries => entries.reduce((s, e) =>
    s + (Number(e.cash_out) || 0) + (Number(e.bank_out) || 0) + (Number(e.custody_out) || 0) + (Number(e.receivable_out) || 0), 0)
  // ضريبة المدخلات أصل قابل للاسترداد، لا مصروف — وهي مخزَّنة فعلاً على قيود
  // المصروفات، فتُطرَح مباشرة بلا اشتقاق
  const sumVat = entries => entries.reduce((s, e) => s + (Number(e.vat_amount) || 0), 0)

  const grossExpenses = sumOut(realExpenseEntries)
  const totalExpenses = grossExpenses - sumVat(realExpenseEntries)

  // تكلفة البضاعة المباعة — منفصلة عن المصروفات التشغيلية
  const cogsEntries       = realExpenseEntries.filter(e => isCOGS(e.type))
  const cogs              = sumOut(cogsEntries) - sumVat(cogsEntries)
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
  const payableBalance     = sumField(all, 'payable_in')    - sumField(all, 'payable_out')

  return {
    totalSales,        // صافية بدون ضريبة المخرجات
    grossSales,        // شاملة الضريبة — للعرض المنفصل وحساب ضريبة المخرجات
    outputVat: grossSales - totalSales,
    cashSales,
    networkSales,
    appSales,
    totalExpenses,     // صافية بعد طرح ضريبة المدخلات
    grossExpenses,
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
    payableBalance,
    entries: active,
  }
}
