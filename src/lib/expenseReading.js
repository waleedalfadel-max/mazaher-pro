import { exactTotals, toHalalas, fromHalalas } from './approvalV2.js'

// Printed evidence wins over a mistakenly copied unit price. No total-balancing guesses.
export function normalizeExpenseReading(inv) {
  if (inv?.type !== 'expense' || !Array.isArray(inv.items)) return inv
  return { ...inv, items: inv.items.map(it => {
    const h=toHalalas(it.printedLineTotal)
    if (h == null || !Number.isFinite(h) || h <= 0 || !['inclusive','exclusive'].includes(inv.amountsBasis) || it.printedLineBasis !== inv.amountsBasis) return it
    return { ...it, readingAmount: it.amount, amount: fromHalalas(h) }
  }) }
}

// An explicit reviewer correction to one existing line, only for a maximum two-halalah difference.
// The server still receives exact matching amounts; its validation is not relaxed.
export function confirmExpenseRounding(inv,index,reason) {
  const t=exactTotals(inv), line=inv?.items?.[index], old=toHalalas(line?.amount)
  if(t.status!=='mismatch'||Math.abs(t.diff)>2||!t.diff||!line||!Number.isFinite(old)||old-t.diff<=0||!String(reason||'').trim()) return null
  return {...inv,items:inv.items.map((it,i)=>i===index?{...it,amount:fromHalalas(old-t.diff)}:it),roundingReview:{line:index,from:fromHalalas(old),to:fromHalalas(old-t.diff),difference:fromHalalas(-t.diff),reason:reason.trim()}}
}
