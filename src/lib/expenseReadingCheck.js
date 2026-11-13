import { exactTotals, toHalalas, vatExcess } from './approvalV2.js'
import { expenseVatRounding } from './expenseVatRounding.js'
import { normalizeExpenseReading } from './expenseReading.js'

const present = v => v !== null && v !== undefined && v !== ''
const money = h => (h / 100).toFixed(2)

// Diagnostics for a second look at the IMAGE, never a recipe for balancing totals.
export function expenseReadingIssues(inv) {
  if (inv?.type !== 'expense') return []
  const items = inv.items || [], t = exactTotals(inv), issues = []
  if (!Number.isSafeInteger(toHalalas(inv.totalAmount ?? inv.amount)) || t.total <= 0)
    issues.push('إجمالي الفاتورة غير مقروء؛ راجع خانة الإجمالي والمبلغ بالحروف.')
  if (t.status === 'mismatch') issues.push(`مجموع البنود ${money(t.itemsTotal)}، والإجمالي ${money(t.total)}، والفرق ${money(t.diff)} ر.س. راجع الكمية وسعر الوحدة والتفاف وصف الصنف.`)
  if (t.status === 'invalid') issues.push('أحد مبالغ الفاتورة غير صالح؛ انقله من الصورة.')
  if (vatExcess(inv)) issues.push('ضريبة الفاتورة المقروءة تتجاوز الحد الممكن لإجماليها؛ راجع ملخص الضريبة.')
  if (present(inv.printedItemCount) && Number(inv.printedItemCount) !== items.length)
    issues.push(`عدد الأصناف المطبوع ${Number(inv.printedItemCount)}، والمقروء ${items.length}. راجع الأصناف المكررة أو الناقصة.`)
  if (present(inv.printedQuantityTotal) && items.every(it => present(it.quantity) && Number.isFinite(Number(it.quantity)))
      && Math.abs(items.reduce((s, it) => s + Number(it.quantity), 0) - Number(inv.printedQuantityTotal)) > 1e-6)
    issues.push('مجموع الكميات المقروءة لا يطابق مجموع الكميات المطبوع.')
  for (const [i, it] of items.entries()) {
    if (['lineNet', 'lineVat', 'printedLineTotal'].every(k => present(it[k]))) {
      const [net, vat, gross] = ['lineNet', 'lineVat', 'printedLineTotal'].map(k => toHalalas(it[k]))
      if (![net, vat, gross].every(Number.isSafeInteger) || net + vat !== gross)
        issues.push(`البند ${i + 1}: الصافي والضريبة لا يطابقان إجمالي الصنف المقروء.`)
      else if (vat < 0 || net < 0 || vat > Math.round(net * 0.15) + 2)
        issues.push(`البند ${i + 1}: ضريبة الصنف المقروءة لا تناسب صافيه.`)
    }
  }
  // A proven invoice-level rounding difference is already supported by the server.
  if (items.length && !t.discount && items.every(it => Number.isSafeInteger(toHalalas(it.lineVat)))) {
    const sum = items.reduce((s, it) => s + toHalalas(it.lineVat), 0)
    if (sum !== t.vat && !expenseVatRounding(inv))
      issues.push(`مجموع ضريبة الأصناف ${money(sum)}، وضريبة الفاتورة ${money(t.vat)}؛ فرق ${money(Math.abs(sum - t.vat))} ر.س في تفاصيل الضريبة.`)
  }
  return issues
}

export function expenseVerificationPrompt(invoices) {
  const targets = invoices.flatMap((inv, i) => {
    const issues = expenseReadingIssues(inv)
    return issues.length ? [{ invoice: i + 1, issues }] : []
  })
  if (!targets.length) return null
  return `إعادة فحص من الصورة الأصلية قبل عرض القراءة للمراجع. الفحص الحسابي وجد هذه المواضع:
${JSON.stringify(targets)}
أعد قراءة فواتير المشتريات المحددة من الصورة، خصوصًا رأس الأعمدة وجميع أسطر كل صنف والملخص النهائي. استخرج إجمالي الكمية، لا سعر الوحدة. تكملة وصف الصنف ليست صنفًا جديدًا. راجع كل رقم ضريبة من موضعه، ولا تستنتجه من الفرق.
لا تغيّر الإجمالي أو الضريبة المطبوعة لإجبار التطابق، ولا تختلق خصمًا أو بندًا ولا تحذف صنفًا حقيقيًا. إذا لم تحسم الصورة الفرق فأبقِ الأرقام كما قرأتها واذكر موضع الشك. لا تستبدل البنود المفصلة ببند إجمالي.
أعد invoices بنفس العدد والترتيب، وبنفس هوية كل فاتورة. اترك المبيعات وإيصالات الدفع والتحويلات كما هي. JSON فقط بنفس الحقول المطلوبة.`
}

// Accept a consistent rereading only within the same invoice and printed summary.
// Keep the first reading when the second guess changes its identity/summary or hides evidence.
export function verifiedExpenseReading(original, candidate) {
  if (candidate?.type !== 'expense' || !Array.isArray(candidate.items) || !candidate.items.length) return null
  for (const key of ['invoiceNumber', 'date'])
    if (present(original[key]) && original[key] !== candidate[key]) return null
  for (const key of ['totalAmount', 'vatAmount', 'invoiceDiscount']) {
    const before = toHalalas(key === 'totalAmount' ? original.totalAmount ?? original.amount : original[key])
    const after = toHalalas(key === 'totalAmount' ? candidate.totalAmount ?? candidate.amount : candidate[key])
    if (key === 'totalAmount' && (!Number.isSafeInteger(before) || before <= 0)) continue
    if ((before ?? 0) !== (after ?? 0)) return null
  }
  for (const key of ['printedItemCount', 'printedQuantityTotal'])
    if (present(original[key]) && Number(original[key]) !== Number(candidate[key])) return null
  if (original.items?.length > 1 && candidate.items.length === 1) return null
  if (original.items?.some(it => present(it.lineVat)) && !candidate.items.every(it => ['lineNet', 'lineVat', 'printedLineTotal'].every(k => present(it[k])))) return null
  const next = normalizeExpenseReading(candidate)
  if (exactTotals(next).status !== 'match' || expenseReadingIssues(next).length
      || next.items.some(it => !Number.isSafeInteger(toHalalas(it.amount)) || toHalalas(it.amount) <= 0)) return null
  // Only extraction fields change. Payment choices, supplier identity and routing stay intact.
  const result = { ...original }
  for (const key of ['items', 'amountsBasis', 'readingWarnings', 'readingCorrection', 'readingBasis']) {
    delete result[key]
    if (next[key] !== undefined) result[key] = next[key]
  }
  if (!present(original.totalAmount ?? original.amount) || toHalalas(original.totalAmount ?? original.amount) <= 0)
    result.totalAmount = next.totalAmount ?? next.amount
  result.readingVerification = { status: 'corrected', previous: original }
  return result
}
