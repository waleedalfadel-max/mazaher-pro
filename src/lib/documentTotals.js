// مقارنة مجموع البنود بإجمالي الفاتورة على الأساس نفسه — للعرض فقط، لا يمس الاعتماد ولا القيود.
//
// اصطلاح القراءة في التطبيق (src/lib/claude.js): مبالغ البنود شاملة الضريبة، ومجموعها = totalAmount.
// فالمقارنة الأساسية: مجموع البنود (شامل) مع الإجمالي (شامل).
// إن لم تتطابق، لكن مجموع البنود + الضريبة المقروءة في المستند نفسه = الإجمالي، فالبنود قُرئت قبل
// الضريبة: أساس مختلف، لا بند ناقص. لا تُفترض نسبة ضريبة؛ تُستعمل قيمة vatAmount المقروءة فقط.

const round2 = v => Math.round((Number(v) || 0) * 100) / 100

export const TOTALS_TOLERANCE = 0.5

/**
 * @returns {{ status: 'none'|'match'|'net-basis'|'mismatch', itemsTotal: number, total: number, vat: number, diff: number }}
 *   diff: البنود − الإجمالي (موجب = البنود أكثر) عند mismatch فقط.
 */
export function compareItemsToTotal(invoice, tolerance = TOTALS_TOLERANCE) {
  const items = Array.isArray(invoice?.items) ? invoice.items : []
  const itemsTotal = round2(items.reduce((s, it) => s + (Number(it.amount) || 0), 0))
  const total = round2(Number(invoice?.totalAmount || invoice?.amount) || 0)
  const vat = round2(Number(invoice?.vatAmount) || 0)
  const base = { itemsTotal, total, vat, diff: 0 }
  if (!items.length || itemsTotal <= 0) return { ...base, status: 'none' }
  const gross = round2(itemsTotal - total)
  if (Math.abs(gross) <= tolerance) return { ...base, status: 'match' }
  if (vat > 0 && Math.abs(round2(itemsTotal + vat - total)) <= tolerance) return { ...base, status: 'net-basis' }
  return { ...base, status: 'mismatch', diff: gross }
}
