// Presentation only: preserve every original row and amount; never deduplicate by name or amount.
const cents = value => Math.round((Number(value) || 0) * 100)
const movementKeys = ['cash_in','cash_out','bank_in','bank_out','custody_in','custody_out','receivable_in','receivable_out','payable_out']
export const isCreditPurchaseRow = r => !!r.document_invoice_id && !!r.document_id && !!r.journal_number
  && ['approved', 'auto'].includes(r.status) && Number(r.payable_in) > 0 && movementKeys.every(k => !Number(r[k]))
const keyOf = r => JSON.stringify([r.project_id,r.document_id,r.document_invoice_id,r.journal_number,r.date,r.status,r.supplier_id])

export function groupCreditInvoices(rows, fullRows = rows) {
  const counts = new Map()
  for (const r of fullRows) if (isCreditPurchaseRow(r)) counts.set(keyOf(r), (counts.get(keyOf(r)) || 0) + 1)
  const groups = new Map(), out = []
  for (const r of rows) {
    if (!isCreditPurchaseRow(r)) { out.push(r); continue }
    const key = keyOf(r)
    let group = groups.get(key)
    if (!group) {
      group = { ...r, type: 'فاتورة شراء آجلة', _creditRows: [], _creditPartial: false }
      groups.set(key, group); out.push(group)
    }
    group._creditRows.push(r)
  }
  for (const [key, group] of groups) {
    for (const field of ['total_amount','vat_amount','payable_in'])
      group[field] = group._creditRows.reduce((n,r) => n + cents(r[field]), 0) / 100
    group._creditPartial = group._creditRows.length !== counts.get(key)
    if (group._creditPartial) group.type = 'جزء من فاتورة آجلة — حسب الفلتر'
  }
  return out
}
