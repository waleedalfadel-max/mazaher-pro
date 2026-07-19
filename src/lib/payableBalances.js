export function aggregateSupplierBalances(suppliers, entries) {
  return suppliers.map(s => {
    const rows = entries.filter(e => e.supplier_id === s.id)
    const invoiced = rows.reduce((sum, e) => sum + (Number(e.payable_in) || 0), 0)
    const paid     = rows.reduce((sum, e) => sum + (Number(e.payable_out) || 0), 0)
    return { id: s.id, name: s.name, invoiced, paid, balance: invoiced - paid }
  })
}
