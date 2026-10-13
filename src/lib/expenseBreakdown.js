// تفصيل المصروفات حسب تصنيف البنود (تقرير المشتريات في Reports.jsx).
// • الاعتماد الجديد يكتب قيدًا لكل تصنيف أساسي، والقيود تتشارك رقم القيد؛ كل بند مربوط بقيده (ledger_entry_id).
// • التصنيف بمعرّفه الثابت (category_id) حين يوجد: يُجمع به ويُعرض باسمه الحالي. البيانات السابقة تُربط بمعرّفها حيث
//   يثبت الربط بالاسم (supabase/migrations/20260928000600)، فيبقى التصنيف صفًّا واحدًا بعد إعادة تسميته.
// • المعالجة (تكلفة بضاعة أو مصروف) مما حُفظ مع القيد لا من التصنيف اليوم: الرمز المالي للقيد (يكتبه الاعتماد الجديد)،
//   وإلا الاستنتاج من الاسم المحفوظ كما كان. تغيير اسم التصنيف أو رمزه لاحقًا لا يغيّر أرقام فترة سابقة.
// • ما بقي بلا معرّف (ملتبس أو غير مطابق): مطابقة برقم القيد، والتصنيف بالاسم المحفوظ.
import { isCOGS } from './financeClass.js'

export function itemsForEntry(entry, items) {
  if (!entry?.journal_number) return []
  return (items || []).filter(it => (it.ledger_entry_id ? it.ledger_entry_id === entry.id : it.journal_number === entry.journal_number))
}

/**
 * يوزّع مبلغ القيد (الصافي) على بنوده تناسبيًا بالهللات: كل حصة عدد هللات صحيح، والباقي يُسند هللةً هللةً للأكبر كسرًا ثم بترتيب
 * البنود، فمجموع الحصص = المبلغ بالهللة بالضبط (موجبًا أو سالبًا للمرتجع). بلا بنود: القيد كله بتصنيفه.
 * التقارير والتحليل وتفاصيله والتصدير تستعمل هذه النتيجة نفسها.
 */
export function allocateEntry(entry, amount, items, categoriesById = {}) {
  const cat = id => (id ? categoriesById[id] : null)
  const cls = storedName => entry.financial_class || (isCOGS(storedName) ? 'cogs' : 'opex')
  const matching = itemsForEntry(entry, items)
  const weights = matching.map(it => Math.max(0, Math.round((Number(it.amount) || 0) * 100)))
  const totalW = weights.reduce((s, w) => s + w, 0)
  if (!matching.length || totalW <= 0) {
    const c = cat(entry.category_id)
    const main = c?.name || entry.type || '— غير محدد'
    return [{ key: c ? 'id:' + c.id : null, subKey: null, main, sub: entry.category_sub || null, amount, label: entry.description, cls: cls(entry.type), item: null }]
  }
  const totalH = Math.round((Number(amount) || 0) * 100)
  const sign = totalH < 0 ? -1 : 1, absH = Math.abs(totalH)
  const shares = weights.map(w => Math.floor(absH * w / totalW))
  let rest = absH - shares.reduce((s, x) => s + x, 0)
  const order = weights.map((w, i) => ({ i, frac: (absH * w) % totalW })).sort((x, y) => y.frac - x.frac || x.i - y.i)
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) shares[order[k].i]++
  return matching.map((it, i) => {
    const c = cat(it.category_id)
    const main = c?.name || it.category_main || entry.type || '— غير محدد'
    const sub = (it.subcategory_id && categoriesById[it.subcategory_id]?.name) || it.category_sub || null
    return { key: c ? 'id:' + c.id : null, subKey: it.subcategory_id && categoriesById[it.subcategory_id] ? 'id:' + it.subcategory_id : null, main, sub,
      amount: sign * shares[i] / 100, label: it.description || entry.description, cls: cls(it.category_main || entry.type), item: it }
  })
}
