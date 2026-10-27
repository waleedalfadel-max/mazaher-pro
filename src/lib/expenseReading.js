import { exactTotals, toHalalas, fromHalalas } from './approvalV2.js'

const BASES = ['inclusive', 'exclusive']
const positive = v => { const h = toHalalas(v); return h != null && Number.isFinite(h) && h > 0 ? h : null }
const number = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
// حقول يكتبها التطبيق أو المراجع فقط؛ لا تُقبل من نتيجة القراءة.
const REVIEW_KEYS = ['basisReview', 'roundingReview']
const DERIVED_KEYS = ['readingCorrection', 'readingBasis']

/** نتيجة قراءة بلا تأكيدات مراجع: تأكيد الأساس وتسوية الفرق لا يأتيان جاهزين من القراءة. */
export function withoutReviewConfirmations(reading) {
  if (!reading || typeof reading !== 'object' || Array.isArray(reading)) return reading
  const copy = { ...reading }
  for (const k of REVIEW_KEYS) delete copy[k]
  if (Array.isArray(copy.invoices)) copy.invoices = copy.invoices.map(withoutReviewConfirmations)
  return copy
}

// Printed evidence wins over a mistakenly copied unit price. No total-balancing guesses.
export function normalizeExpenseReading(inv) {
  if (inv?.type !== 'expense' || !Array.isArray(inv.items)) return inv
  const raw = withoutReviewConfirmations(inv)
  for (const k of DERIVED_KEYS) delete raw[k]
  raw.items = raw.items.map(({ readingAmount, ...it }) => it)
  const read = { ...raw, items: raw.items.map(it => {
    const h = positive(it.printedLineTotal)
    if (h == null || !BASES.includes(raw.amountsBasis) || it.printedLineBasis !== raw.amountsBasis || toHalalas(it.amount) === h) return it
    return { ...it, readingAmount: it.amount, amount: fromHalalas(h) }
  }) }
  return printedLineColumn(read) || read
}

// سطر الصنف مؤيَّد من أرقامه المطبوعة الأخرى: الصافي + الضريبة = الإجمالي الشامل بالهللة، أو الكمية × سعر الوحدة يقارب
// المبلغ (هللة واحدة للتقريب). أي تعارض بين الأرقام المطبوعة يُسقط التأييد.
function lineSupported(it, basis, h) {
  const net = positive(it.lineNet), vat = toHalalas(it.lineVat), gross = it.printedLineBasis === 'inclusive' ? positive(it.printedLineTotal) : null
  const pair = net != null && vat != null && Number.isFinite(vat) && vat >= 0 && gross != null
  if (pair && net + vat !== gross) return false
  const q = number(it.quantity), u = number(it.unitPrice)
  const product = q != null && u != null && q > 0 && u > 0 ? Math.round(q * u * 100) : null
  const near = target => product != null && target != null && Math.abs(product - target) <= 1
  if (basis === 'inclusive') return pair || near(h)
  return pair || near(h) || near(gross)
}

// عدد الأصناف إن طُبع: يطابق عدد البنود المقروءة أو مجموع الكميات (بعض الفواتير تعدّ القطع). وإلا فقد نقص صنف أو تكرر.
function countMismatch(inv) {
  const n = number(inv.printedItemCount)
  if (n == null) return null
  const qty = inv.items.map(it => number(it.quantity))
  const pieces = qty.every(q => q != null) ? qty.reduce((a, b) => a + b, 0) : null
  return n === inv.items.length || (pieces != null && Math.abs(n - pieces) < 1e-9) ? null : n
}

// كل صنف يُطبع أحيانًا بثلاثة أسطر: صافي قبل الضريبة، وضريبته، وإجماليه الشامل. إذا لم تطابق القراءة الإجمالي بالهللة،
// يُستخدم عمود مطبوع كامل على أساس واحد فقط حين: يطابق ملخص الفاتورة بالهللة (الخصم على الفاتورة يُطرح مرة واحدة)،
// وكل سطر مؤيَّد من أرقامه المطبوعة الأخرى، ولا يخالف عدد الأصناف المطبوع. الإجمالي الشامل أولًا ثم الصافي.
// لا تُحسب مبالغ ولا تُضاف بنود، ويُحفظ مصدر الأرقام قبل التصحيح وبعده (readingCorrection وreadingAmount وreadingBasis).
function printedLineColumn(inv) {
  if (exactTotals(inv).status !== 'mismatch') return null
  const column = {
    inclusive: it => it.printedLineBasis === 'inclusive' ? positive(it.printedLineTotal) : null,
    exclusive: it => positive(it.lineNet),   // عمود الصافي المقروء صراحةً فقط؛ وسم الأساس المختلط يبقى للمراجع
  }
  const field = { inclusive: 'printedLineTotal', exclusive: 'lineNet' }
  for (const basis of BASES) {
    const amounts = inv.items.map(column[basis])
    if (amounts.some(h => h == null)) continue
    const next = { ...inv, amountsBasis: basis, items: inv.items.map((it, i) => toHalalas(it.amount) === amounts[i] ? it
      : { ...it, readingAmount: it.readingAmount ?? it.amount, amount: fromHalalas(amounts[i]) }) }
    if (exactTotals(next).status !== 'match') continue
    const missing = countMismatch(inv)
    if (missing != null) return { ...inv, readingWarnings: [...(inv.readingWarnings || []), `عدد الأصناف المطبوع ${missing} لا يساوي عدد البنود المقروءة ${inv.items.length}؛ قد يكون صنف ناقصًا أو مكررًا`] }
    if (!inv.items.every((it, i) => lineSupported(it, basis, amounts[i]))) return null
    if (basis !== inv.amountsBasis) next.readingBasis = inv.amountsBasis ?? null
    next.readingCorrection = { rule: 'printed_line_column',
      from: { basis: inv.amountsBasis ?? null, field: 'amount' }, to: { basis, field: field[basis] },
      lines: inv.items.flatMap((it, i) => toHalalas(it.amount) === amounts[i] ? [] : [{ line: i, from: it.amount ?? null, to: fromHalalas(amounts[i]) }]) }
    return next
  }
  return null
}

// بصمة ما أكّده المراجع: الأساس ومبالغ البنود والضريبة والإجمالي والخصم بالهللة. أي تغيير بعدها يُسقط التأكيد.
const reviewKey = inv => { const t = exactTotals(inv); return [t.basis, (inv.items || []).map(it => toHalalas(it.amount)).join(','), t.vat, t.total, t.discount].join('|') }

/** تأكيد المراجع أن أساس المبالغ الظاهر يطابق الصورة. شرط قبل تسوية أي فرق صغير؛ لا يغيّر المبالغ. */
export function confirmExpenseBasis(inv, basis) {
  if (inv?.type !== 'expense' || !BASES.includes(basis)) return null
  const readBasis = inv.basisReview ? inv.basisReview.from : (inv.amountsBasis ?? null)
  const next = { ...inv, amountsBasis: basis }
  delete next.roundingReview
  return { ...next, basisReview: { basis, from: readBasis, key: reviewKey(next) } }
}

/** التأكيد قائم ما دام الأساس والمبالغ والضريبة والإجمالي والخصم كما كانت لحظة تأكيده. */
export const basisConfirmed = inv => !!inv?.basisReview && inv.basisReview.basis === exactTotals(inv).basis && inv.basisReview.key === reviewKey(inv)

/** تأكيدات المراجع السارية فقط: تأكيد سقط بتغيير لاحق لا يُرسل ولا يُسجَّل. */
export function validExpenseReviews(inv) {
  if (!inv || (!inv.basisReview && !inv.roundingReview)) return inv
  const next = { ...inv }
  if (!basisConfirmed(inv)) { delete next.basisReview; delete next.roundingReview }
  else if (inv.roundingReview && inv.roundingReview.key !== inv.basisReview.key) delete next.roundingReview
  return next
}

// An explicit reviewer correction to one existing line, only for a maximum two-halalah difference, and only after the
// reviewer confirmed the amounts basis. The server still receives exact matching amounts; its validation is not relaxed.
export function confirmExpenseRounding(inv,index,reason) {
  const t=exactTotals(inv), line=inv?.items?.[index], old=toHalalas(line?.amount)
  if(!basisConfirmed(inv)||t.status!=='mismatch'||Math.abs(t.diff)>2||!t.diff||!line||!Number.isFinite(old)||old-t.diff<=0||!String(reason||'').trim()) return null
  const next={...inv,items:inv.items.map((it,i)=>i===index?{...it,amount:fromHalalas(old-t.diff)}:it)}
  const key=reviewKey(next)
  return {...next,basisReview:{...inv.basisReview,key},roundingReview:{line:index,basis:t.basis,from:fromHalalas(old),to:fromHalalas(old-t.diff),difference:fromHalalas(-t.diff),reason:reason.trim(),key}}
}
