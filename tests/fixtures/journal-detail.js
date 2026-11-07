export function journalFixture() {
  const base = { project_id: 'p1', journal_number: 'QD-2026-100', date: '2026-11-01', created_at: '2026-11-01T10:00:00Z', status: 'approved', branch: 'الفرع الأول', document_id: 'd1', document_invoice_id: 'i1', created_by_name: 'مراجع تجريبي' }
  return {
    ledger_entries: [
      { ...base, id: 'cash', type: 'مبيعات كاش', total_amount: 115, cash_in: 115, output_vat_amount: 15, description: 'CASH-MOVEMENT' },
      { ...base, id: 'bank', type: 'مبيعات شبكة', total_amount: 230, bank_in: 230, bank_account_id: 'main', description: 'BANK-MOVEMENT' },
      { ...base, id: 'delivery', type: 'مبيعات تطبيقات', total_amount: 34.5, receivable_in: 34.5, description: 'DELIVERY-MOVEMENT' },
      { ...base, id: 'credit', type: 'مشتريات آجلة', total_amount: 82, vat_amount: 10.7, payable_in: 82, supplier_id: 's1', description: 'CREDIT-MOVEMENT' },
      { ...base, id: 'transfer', type: 'تحويل داخلي', total_amount: 50, cash_out: 50, bank_in: 50, bank_account_id: 'purchase', description: 'TRANSFER-MOVEMENT' },
      { ...base, id: 'cancelled', status: 'cancelled', total_amount: 3, bank_out: 3, bank_account_id: 'main', description: 'CANCELLED-MOVEMENT' },
      { ...base, id: 'other-invoice', journal_number: 'QD-2026-101', document_invoice_id: 'i2', total_amount: 999, cash_out: 999, description: 'OTHER-INVOICE-SECRET' },
      { ...base, id: 'foreign', project_id: 'p2', total_amount: 9999, cash_in: 9999, description: 'FOREIGN-SECRET' },
      { ...base, id: 'no-number', journal_number: null, document_id: null, document_invoice_id: null, total_amount: 10, cash_in: 10 },
      { ...base, id: 'no-number-2', journal_number: null, document_id: null, document_invoice_id: null, total_amount: 20, cash_in: 20 },
    ],
    bank_accounts: [{ id: 'main', project_id: 'p1', name: 'اسم البنك القديم' }, { id: 'purchase', project_id: 'p1', name: 'حساب المشتريات' }],
    project_settings: [{ project_id: 'p1', settings: { statement_accounts: [{ value: 'cash', label: 'الصندوق' }, { value: 'bank:main', label: 'الراجحي الرئيسي' }, { value: 'bank:purchase', label: 'حساب المشتريات' }] } }],
    suppliers: [{ id: 's1', project_id: 'p1', name: 'المورد التجريبي' }],
    documents: [{ id: 'd1', project_id: 'p1', journal_number: 'QD-2026-100', file_url: 'https://example.invalid/original.pdf', file_name: 'الفاتورة الأصلية.pdf' }],
    attachments: [{ id: 'a1', project_id: 'p1', journal_number: 'QD-2026-100', file_url: 'https://example.invalid/receipt.pdf', file_name: 'سند السداد.pdf', uploaded_at: '2026-11-01' }],
    document_items: [
      { id: 'item1', project_id: 'p1', journal_number: 'QD-2026-100', ledger_entry_id: 'credit', document_id: 'd1', document_invoice_id: 'i1', description: 'بند مشتريات تجريبي', amount: 82, vat_amount: 10.7, sort_order: 1 },
      { id: 'item2', project_id: 'p1', journal_number: 'QD-2026-101', ledger_entry_id: 'other-invoice', document_id: 'd1', document_invoice_id: 'i2', description: 'OTHER-INVOICE-ITEM', amount: 999, sort_order: 2 },
    ],
  }
}

// Synthetic PostgREST transport; every query must carry explicit tenant scope.
export function journalClient(tables, { max = 2, fail = () => false, log = [] } = {}) {
  return { from(table) {
    const q = { table, filters: [], orders: [], offset: 0 }
    const builder = {
      select() { return this }, eq(k, v) { q.filters.push(['eq', k, v]); return this },
      in(k, v) { q.filters.push(['in', k, v]); return this },
      order(k, { ascending = true } = {}) { q.orders.push([k, ascending]); return this },
      maybeSingle() { q.single = true; return this },
      range(a, b) { q.offset = a; q.limit = b - a + 1; return this },
      then(resolve, reject) {
        log.push(structuredClone(q))
        if (!q.filters.some(([op, k]) => op === 'eq' && k === 'project_id')) return Promise.reject(new Error('Missing tenant filter')).then(resolve, reject)
        if (fail(q)) return Promise.resolve({ data: null, error: { message: 'test_failure' } }).then(resolve, reject)
        const rows = (tables[table] || []).filter(r => q.filters.every(([op, k, v]) => op === 'in' ? v.includes(r[k]) : r[k] === v)).sort((a, b) => {
          for (const [k, asc] of q.orders) { if (a[k] < b[k]) return asc ? -1 : 1; if (a[k] > b[k]) return asc ? 1 : -1 } return 0
        })
        return Promise.resolve({ data: q.single ? rows[0] || null : rows.slice(q.offset, q.offset + Math.min(max, q.limit || max)), error: null }).then(resolve, reject)
      },
    }
    return builder
  } }
}
