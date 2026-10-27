import { exactTotals, toHalalas, fromHalalas } from './approvalV2.js'

const BASES = ['inclusive', 'exclusive']
const positive = v => { const h = toHalalas(v); return h != null && Number.isFinite(h) && h > 0 ? h : null }

// Printed evidence wins over a mistakenly copied unit price. No total-balancing guesses.
export function normalizeExpenseReading(inv) {
  if (inv?.type !== 'expense' || !Array.isArray(inv.items)) return inv
  const read = { ...inv, items: inv.items.map(it => {
    const h = positive(it.printedLineTotal)
    if (h == null || !BASES.includes(inv.amountsBasis) || it.printedLineBasis !== inv.amountsBasis || toHalalas(it.amount) === h) return it
    return { ...it, readingAmount: it.amount, amount: fromHalalas(h) }
  }) }
  return printedLineBasis(read) || read
}

// كل صنف يُطبع أحيانًا بثلاثة أسطر: صافي قبل الضريبة، وضريبته، وإجماليه الشامل. إذا لم تطابق القراءة الإجمالي بالهللة،
// تُستخدم أعمدة الصنف المطبوعة كاملة على أساس واحد فقط حين تطابق ملخص الفاتورة بالهللة: الإجمالي الشامل أولًا،
// ثم الصافي قبل الضريبة. لا تُحسب مبالغ ولا تُضاف بنود، وتبقى القراءة الأولى (readingAmount وreadingBasis).
function printedLineBasis(inv) {
  if (exactTotals(inv).status !== 'mismatch') return null
  const column = {
    inclusive: it => it.printedLineBasis === 'inclusive' ? positive(it.printedLineTotal) : null,
    exclusive: it => positive(it.lineNet),   // عمود الصافي المقروء صراحةً فقط؛ وسم الأساس المختلط يبقى للمراجع
  }
  for (const basis of BASES) {
    const amounts = inv.items.map(column[basis])
    if (amounts.some(h => h == null)) continue
    const next = { ...inv, amountsBasis: basis, items: inv.items.map((it, i) => {
      if (toHalalas(it.amount) === amounts[i]) return it
      return { ...it, readingAmount: it.readingAmount ?? it.amount, amount: fromHalalas(amounts[i]) }
    }) }
    if (exactTotals(next).status !== 'match') continue
    if (basis !== inv.amountsBasis) next.readingBasis = inv.amountsBasis ?? null
    next.lineBasisReading = basis
    return next
  }
  return null
}

/** تأكيد المراجع أن أساس المبالغ الظاهر يطابق الصورة. شرط قبل تسوية أي فرق صغير؛ لا يغيّر المبالغ. */
export function confirmExpenseBasis(inv, basis) {
  if (inv?.type !== 'expense' || !BASES.includes(basis)) return null
  const readBasis = inv.basisReview ? inv.basisReview.from : (inv.amountsBasis ?? null)
  return { ...inv, amountsBasis: basis, basisReview: { basis, from: readBasis } }
}

export const basisConfirmed = inv => !!inv?.basisReview && inv.basisReview.basis === exactTotals(inv).basis

// An explicit reviewer correction to one existing line, only for a maximum two-halalah difference, and only after the
// reviewer confirmed the amounts basis. The server still receives exact matching amounts; its validation is not relaxed.
export function confirmExpenseRounding(inv,index,reason) {
  const t=exactTotals(inv), line=inv?.items?.[index], old=toHalalas(line?.amount)
  if(!basisConfirmed(inv)||t.status!=='mismatch'||Math.abs(t.diff)>2||!t.diff||!line||!Number.isFinite(old)||old-t.diff<=0||!String(reason||'').trim()) return null
  return {...inv,items:inv.items.map((it,i)=>i===index?{...it,amount:fromHalalas(old-t.diff)}:it),roundingReview:{line:index,basis:t.basis,from:fromHalalas(old),to:fromHalalas(old-t.diff),difference:fromHalalas(-t.diff),reason:reason.trim()}}
}
