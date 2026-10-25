// One parent/child pair. Names shown to the reviewer take precedence over stale hidden IDs.
export const normCategory = s => String(s || '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
  .replace(/[^A-Za-z0-9؀-ۿ\s]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

export function categoryChoice(categories = [], item = {}, fallback = '') {
  const unique = rows => rows.length === 1 ? rows[0] : null
  const mains = categories.filter(c => !c.parent_id && c.is_active !== false)
  const name = item.category_main || fallback
  const main = name ? unique(mains.filter(c => normCategory(c.name) === normCategory(name)))
    : mains.find(c => c.id === item.category_id) || null
  const children = main ? categories.filter(c => c.parent_id === main.id && c.is_active !== false) : []
  const sub = item.category_sub ? unique(children.filter(c => normCategory(c.name) === normCategory(item.category_sub)))
    : Object.hasOwn(item, 'category_sub') ? null : children.find(c => c.id === item.subcategory_id) || null
  return { category_main: main?.name || name || null, category_sub: sub?.name || item.category_sub || '',
    category_id: main?.id || null, subcategory_id: sub?.id || null, ledger_type: main?.ledger_type || null }
}

export function readingCategoryLinks(reading, categories) {
  if (!reading || !categories?.length) return reading
  const fix = inv => inv?.type !== 'expense' ? inv : { ...inv,
    items: Array.isArray(inv.items) ? inv.items.map(item => ({ ...item, ...categoryChoice(categories, item) })) : inv.items }
  return Array.isArray(reading.invoices) ? { ...reading, invoices: reading.invoices.map(fix) } : fix(reading)
}
