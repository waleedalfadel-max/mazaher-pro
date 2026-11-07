import { cents } from './accountStatement.js'
import { isSales, isCounted, isCOGSEntry, isWithdrawal, isBalanceStart, salesVatOf } from './financeRules.js'
import { isSupplierPaymentType } from './supplierPayments.js'
import { compactEntryDescription } from './entryDescription.js'

const clean = s => String(s || '').replace(/^[^\p{L}\p{N}]+/u, '').trim()
const sum = lines => lines.reduce((n, l) => n + l.debit - l.credit, 0)
const line = (account, signed, row, description = '') => ({ account, debit: Math.max(signed, 0), credit: Math.max(-signed, 0), entryId: row.id, description })
const order = lines => lines.filter(l => l.debit || l.credit).sort((a, b) => Number(!a.debit) - Number(!b.debit))
const expenseTypes = new Set(['مصروفات تشغيلية', 'مصروفات ثابتة', 'مشتريات آجلة', 'مشتريات', 'مشتريات نقدية'])

// Read-only accounting presentation of the recorded movements and classifications.
// No suspense/equity account is invented to balance an unknown or incomplete row.
export function journalPostings(rows, { banks = [], suppliers = [], settings = {} } = {}) {
  const labels = new Map((Array.isArray(settings.statement_accounts) ? settings.statement_accounts : [])
    .filter(a => a && typeof a.label === 'string' && a.label.trim()).map(a => [a.value, a.label.trim()]))
  const taxStatus = settings.onboarding?.tax?.status
  const segments = [], transfers = new Map()
  for (const row of rows) {
    const type = clean(row.type), issues = [], lines = [], desc = compactEntryDescription(row)
    const bank = labels.get('bank:' + row.bank_account_id) || banks.find(b => b.id === row.bank_account_id)?.name
    const supplier = suppliers.find(s => row.supplier_id ? s.id === row.supplier_id : row.journal_number && s.journal_number === row.journal_number)?.name
    const bankEffect = cents(row.bank_in) || cents(row.bank_out)
    const payableEffect = cents(row.payable_in) || cents(row.payable_out)
    if (bankEffect && !bank) issues.push('الحساب البنكي غير محدد')
    if (payableEffect && !supplier) issues.push('اسم المورد غير محدد')
    const apps = /هنقر|جاهز|كيتا|مرسول/.exec(type)?.[0]
    const names = { cash: labels.get('cash') || 'الصندوق', bank: bank || 'حساب بنكي غير محدد', custody: labels.get('custody') || 'عهدة الموظفين',
      receivable: apps ? `ذمم ${apps}` : 'ذمم مدينة', payable: supplier ? `المورد — ${supplier}` : 'المورد غير محدد' }
    for (const key of ['cash', 'bank', 'custody', 'receivable', 'payable']) {
      const sign = key === 'payable' ? -1 : 1
      for (const [suffix, direction] of [['in', sign], ['out', -sign]]) {
        const value = cents(row[key + '_' + suffix]) * direction
        if (value) lines.push(line(names[key], value, row))
      }
    }
    const net = sum(lines), vat = cents(row.vat_amount)
    if (!lines.length && cents(row.total_amount) && !cents(row.output_vat_amount)) issues.push('حركات المبلغ غير مسجلة')
    const transfer = /تحويل داخلي|صرف عهدة|إيداع نقدي/.test(type)
    const settlement = isSupplierPaymentType(type) || type.includes('تحصيل ذمم')
    const expense = ['cogs', 'opex', 'fixed'].includes(row.financial_class) || isCOGSEntry(row) || expenseTypes.has(type)
    if (row.status === 'cancelled') {
      segments.push({ row, lines: [], issues: [], cancelled: true }); continue
    }
    if (transfer) {
      if (vat || cents(row.output_vat_amount)) issues.push('ضريبة التحويل تحتاج مراجعة')
      const key = JSON.stringify([row.project_id, row.journal_number || row.id, row.date, row.status])
      if (!transfers.has(key)) transfers.set(key, { rows: [], issues: [] })
      transfers.get(key).rows.push({ row, lines, desc }); transfers.get(key).issues.push(...issues); continue
    }
    if (row.type === 'فروقات قيد المراجعة' && !vat && !cents(row.output_vat_amount)) lines.push(line('فروقات قيد المراجعة', -net, row))
    else if (isBalanceStart(row.type)) issues.push('الحساب المقابل لتسوية البداية يحتاج مراجعة')
    else if (settlement) {
      if (net !== 0) issues.push('طرف السداد أو التحصيل غير مكتمل')
      if (vat) issues.push('ضريبة السداد تحتاج مراجعة')
    } else if (isSales(row.type)) {
      const explicit = row.output_vat_amount != null
      let outputVat = explicit ? cents(row.output_vat_amount) : 0
      if (!explicit && taxStatus === 'مسجل') outputVat = cents(salesVatOf(row))
      if (!explicit && !['مسجل', 'غير مسجل'].includes(taxStatus)) issues.push('ضريبة المبيعات غير محددة')
      if ((net && (Math.abs(outputVat) > Math.abs(net) || outputVat * net < 0)) || cents(row.payable_in) || cents(row.payable_out)) issues.push('مبالغ المبيعات تحتاج مراجعة')
      if (!issues.length) {
        lines.push(line('المبيعات', -(net - outputVat), row))
        if (outputVat) lines.push(line(explicit ? 'ضريبة المبيعات' : 'ضريبة المبيعات (تقديرية)', -outputVat, row))
      }
    } else if (expense) {
      const gross = -net, sign = Math.sign(gross)
      if (!gross || vat < 0 || vat > Math.abs(gross) || cents(row.output_vat_amount)) issues.push('مبالغ المشتريات أو المصروف تحتاج مراجعة')
      if (vat && !['مسجل', 'غير مسجل'].includes(taxStatus)) issues.push('معالجة ضريبة المشتريات غير محددة')
      if (!issues.length) {
        const inputVat = taxStatus === 'مسجل' ? vat * sign : 0
        const account = [clean(row.category_main), clean(row.category_sub)].filter(x => x && x !== 'أخرى').join(' — ') || type
        lines.push(line(account, gross - inputVat, row))
        if (inputVat) lines.push(line('ضريبة المشتريات', inputVat, row))
      }
    } else if (isWithdrawal(row.type) && !vat && !cents(row.output_vat_amount)) lines.push(line(type, -net, row))
    else if (['حوالة واردة بالخطأ', 'رد حوالات واردة بالخطأ'].includes(type) && !vat) lines.push(line('مبالغ واجبة الرد', -net, row))
    else issues.push('الحساب المقابل يحتاج تحديدًا')
    const sorted = order(lines)
    if (sorted.length) sorted[0].description = desc
    segments.push({ row, lines: sorted, issues: [...new Set(issues)], cancelled: false })
  }
  for (const { rows: transferRows, issues: transferIssues } of transfers.values()) {
    // Only the explicitly classified transfer legs of this actual reference can
    // complete one another. Never net unrelated transactions to hide omissions.
    const lines = order(transferRows.flatMap(t => t.lines)), row = transferRows[0].row
    if (sum(lines)) transferIssues.push('طرف التحويل غير مكتمل')
    if (lines.length) lines[0].description = transferRows[0].desc
    segments.push({ row, lines, issues: [...new Set(transferIssues)], cancelled: false })
  }
  const posted = segments.filter(s => isCounted(s.row) && !s.cancelled)
  const debit = posted.reduce((n, s) => n + s.lines.reduce((m, l) => m + l.debit, 0), 0)
  const credit = posted.reduce((n, s) => n + s.lines.reduce((m, l) => m + l.credit, 0), 0)
  return { segments, debit, credit, complete: posted.every(s => !s.issues.length) && debit === credit }
}
