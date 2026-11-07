// Display-only counterpart of approval_private.item_vat_rounding. The server derives
// the allocation independently; printed evidence and invoice totals are never edited.
import { allocateHalalas, exactTotals, toHalalas } from './approvalV2.js'

export function expenseVatRounding(inv) {
  const t = exactTotals(inv), items = inv?.items || []
  if (inv?.type !== 'expense' || t.status !== 'match' || t.discount || items.length < 2 || t.vat <= 0) return null
  const denominator = t.basis === 'inclusive' ? 115 : 100
  const weights = [], printed = []
  for (const it of items) {
    if (it.vatCorrection || !['lineNet', 'lineVat', 'printedLineTotal'].every(k => typeof it[k] === 'number')) return null
    const net = toHalalas(it.lineNet), vat = toHalalas(it.lineVat), gross = toHalalas(it.printedLineTotal), amount = toHalalas(it.amount)
    if (![net, vat, gross, amount].every(Number.isSafeInteger) || Math.min(net, vat, gross, amount) < 0
      || net + vat !== gross || amount !== (t.basis === 'inclusive' ? gross : net)) return null
    if (vat && vat !== Math.floor((amount * 15 + denominator / 2) / denominator)) return null
    weights.push(vat ? amount : 0) // An explicit zero is never assigned tax.
    printed.push(vat)
  }
  const sum = printed.reduce((a, b) => a + b, 0), taxable = weights.reduce((a, b) => a + b, 0)
  if (sum === t.vat || !taxable || t.vat !== Math.floor((taxable * 15 + denominator / 2) / denominator)) return null
  const vats = allocateHalalas(weights, t.vat)
  if (vats.some((v, i) => Math.abs(v - printed[i]) > 1 || (printed[i] === 0 && v !== 0))) return null
  return { printed: sum, invoice: t.vat, difference: t.vat - sum, vats,
    lines: vats.flatMap((v, i) => v === printed[i] ? [] : [{ line: i + 1, from: printed[i], to: v }]) }
}
