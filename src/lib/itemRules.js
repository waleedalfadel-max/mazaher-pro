// قاموس ربط الأصناف (20261014140000): اقتراح تصنيف البند من وصفه. وحدة خالصة تُختبر بلا متصفح.
// active ⇒ يُقترح التصنيف (المحاسب يغيّره إن شاء)؛ review ⇒ لا تصنيف، ملاحظة للمراجعة فقط. البند الذي له تصنيف لا يُمس.

/** التوحيد نفسه في الخادم (approval_private.norm_item): المسافات، والهمزات على الألف، والتطويل. */
export function normItem(s) {
  const n = String(s || '').replace(/[أإآٱ]/g, 'ا').replace(/ـ/g, '').trim().replace(/\s+/g, ' ')
  return n || null
}

/** فهرس القواعد بالوصف الموحّد. */
export function indexRules(rules) {
  const m = new Map()
  for (const r of rules || []) if (r?.description_norm) m.set(r.description_norm, r)
  return m
}

/**
 * يقترح لكل بند بلا تصنيف من القاموس. يعيد بنودًا جديدة (لا يغيّر الأصل) وعدد ما اقتُرح.
 * التصنيفات بالاسم كما تعمل الشاشة، من قائمة تصنيفات المنشأة نفسها (معرّف لا يوجد فيها لا يُستعمل).
 */
export function applyItemRules(items, index, categories) {
  const byId = new Map((categories || []).map(c => [c.id, c]))
  let applied = 0, review = 0
  const out = (items || []).map(it => {
    if (!it || it.category_main) return it
    const rule = index?.get(normItem(it.description))
    if (!rule) return it
    if (rule.status !== 'active') { review++; return { ...it, _dictionary: 'review', _dictionaryNote: rule.note || '' } }
    const main = byId.get(rule.category_id), sub = rule.subcategory_id ? byId.get(rule.subcategory_id) : null
    if (!main || main.parent_id || main.is_active === false || (sub && (sub.parent_id !== main.id || sub.is_active === false))) return it
    applied++
    return { ...it, category_main: main.name, category_sub: sub?.name || '', _dictionary: 'active' }
  })
  return { items: out, applied, review }
}

/** يطبّق القاموس على كل فواتير المستند (فاتورة واحدة أو عدة). */
export function applyRulesToDocument(edit, index, categories) {
  if (!edit) return { edit, applied: 0, review: 0 }
  let applied = 0, review = 0
  const one = inv => {
    if (!inv || inv.type === 'sales' || !Array.isArray(inv.items) || !inv.items.length) return inv
    const r = applyItemRules(inv.items, index, categories)
    applied += r.applied; review += r.review
    return r.applied || r.review ? { ...inv, items: r.items } : inv
  }
  const next = Array.isArray(edit.invoices) ? { ...edit, invoices: edit.invoices.map(one) } : one(edit)
  return { edit: applied || review ? next : edit, applied, review }
}
