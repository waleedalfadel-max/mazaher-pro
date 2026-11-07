// Display only. Preserve the original statement text for search, export and audit.
export function compactEntryDescription(row) {
  const text = String(row?.description || row?.type || '—').replace(/\s+/g, ' ').trim()
  const commission = /\bcommission\b|عمول[ةه]/i.test(text)
  const pointOfSale = /نقاط\s*(?:ال)?بيع|مدين\s*التاجر|\bpos\b|\bterm\b/i.test(text)
  if (commission && pointOfSale) return 'عمولة نقاط البيع'
  const limit = 60
  if (text.length <= limit) return text
  const prefix = text.slice(0, limit - 1)
  const space = prefix.lastIndexOf(' ')
  return `${space > limit / 2 ? prefix.slice(0, space) : prefix}…`
}
