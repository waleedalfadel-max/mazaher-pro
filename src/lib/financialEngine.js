import { supabase } from './supabase'
import { fetchEveryRow } from './fetchAll.js'
import { summarizeEntries } from './financeSummary.js'

import { VAT_RATE, WITHDRAWALS_TYPES, DEBT_TYPES, COGS_TYPES, isCOGS, isCOGSEntry, isSales, isExcluded, isWithdrawal, isDebt,
  isTaxType, isRealExpense, isInternal, sumField, salesAmountGross, salesAmountNet, expenseAmountGross, expenseAmountNet } from './financeRules.js'
// القواعد الخالصة في financeRules.js، وتُعاد تصديرها من هنا كما كانت
export { VAT_RATE, WITHDRAWALS_TYPES, DEBT_TYPES, COGS_TYPES, isCOGS, isCOGSEntry, isSales, isExcluded, isWithdrawal, isDebt,
  isTaxType, isInternal, salesAmountGross, salesAmountNet, expenseAmountGross, expenseAmountNet }

export async function getFinancialSummary(projectId, fromDate, toDate, branch = null) {
  // جلب كامل بترتيب ثابت (src/lib/fetchAll.js): لا تنقص القيود بصمت إن تجاوزت حد الصفحة؛ والخطأ يعيد null كما كان
  const { data: entries, error } = await fetchEveryRow(() => {
    let q = supabase
      .from('ledger_entries')
      .select('id, type, financial_class, cash_in, bank_in, custody_in, cash_out, bank_out, custody_out, receivable_in, receivable_out, payable_in, payable_out, vat_amount, total_amount, status, date, branch')
      .eq('project_id', projectId)
      .gte('date', fromDate)
      .lte('date', toDate)
      // كل الحالات عدا «ملغى» القديمة، ومنها بلا حالة: الملخص يحتسب المعتمد والتلقائي ويعرض غيرهما منفصلًا
      .or('status.is.null,status.neq.cancelled')
    if (branch && branch !== 'all') q = q.eq('branch', branch)
    return q.order('id')
  })

  if (error || !entries) return null
  // الحساب نفسه في وحدة خالصة يستعملها التحليل المالي أيضًا (src/lib/financeSummary.js)
  return summarizeEntries(entries)
}
