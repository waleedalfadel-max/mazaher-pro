// ملخص الأرقام من القيود — وحدة خالصة بلا اتصال (تُختبر في Node). نُقل جسم getFinancialSummary من financialEngine.js كما هو، فيستعمله
// المحرك (لوحة التحكم والتقارير) والتحليل المالي معًا بتعريف واحد للمبيعات والمصروفات والنتيجة. التغيير الوحيد في الحساب: مبلغ القيد في
// المصروفات من expenseAmountNet (src/lib/financeRules.js) بدل «الخروج ناقص الضريبة» — انظر سبب ذلك هناك.
import { VAT_RATE, isCOGSEntry, isSales, isExcluded, isWithdrawal, isDebt, isRealExpense, sumField,
  expenseAmountGross, expenseAmountNet, isCounted, uncountedSummary } from './financeRules.js'

export function summarizeEntries(rows) {
  // القيود المحتسبة وحدها (financeRules: المعتمد والتلقائي)؛ غيرها يُعاد ملخصًا منفصلًا للعرض
  const entries = rows.filter(isCounted)
  const uncounted = uncountedSummary(rows)
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
  // إطلاقاً (انظر mkEntry/mkReceivable بـPendingDocuments)، فطرحه
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
  // ضريبة المدخلات أصل قابل للاسترداد، لا مصروف — وهي مخزَّنة فعلاً على قيود المصروفات، فتُطرَح من مبلغ كل قيد (expenseAmountNet)
  const sumNet = entries => entries.reduce((s, e) => s + expenseAmountNet(e), 0)

  const grossExpenses = realExpenseEntries.reduce((s, e) => s + expenseAmountGross(e), 0)
  const totalExpenses = sumNet(realExpenseEntries)

  // تكلفة البضاعة المباعة — منفصلة عن المصروفات التشغيلية
  const cogsEntries       = realExpenseEntries.filter(isCOGSEntry)
  const cogs              = sumNet(cogsEntries)
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
    uncounted,
  }
}
