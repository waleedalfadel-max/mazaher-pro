import { fromHalalas, toHalalas, newRequestId } from './approvalV2.js'

export const MANUAL_CHANNELS = [
  ['cashSales', 'النقدي'], ['networkSales', 'الشبكة / مدى'], ['transferSales', 'التحويل'],
  ['hungerSales', 'هنقرستيشن'], ['jahez', 'جاهز'], ['keeta', 'كيتا'], ['mrsool', 'مرسول'],
]

const amount = (value, label, optional = false) => {
  const n = toHalalas(value)
  if ((n == null && !optional) || Number.isNaN(n) || n < 0) throw new Error(`راجع ${label}: أدخل مبلغًا صحيحًا غير سالب بمنزلتين عشريتين.`)
  return n ?? 0
}

/** Manual entry through the existing approval RPC. Never rescale OCR lines or relax server checks. */
export function manualInvoice(invoice, fields, categories) {
  if (!['expense', 'sales', 'transfer'].includes(invoice?.type)) throw new Error('اختر نوع المستند أولًا.')
  const reason = String(fields.reason || '').trim()
  if (!reason) throw new Error('اكتب ملاحظة المراجعة اليدوية.')
  if (!fields.confirmed) throw new Error('أكّد مراجعة الصورة والأرقام التي ستُسجَّل.')
  const next = { ...invoice, _id: invoice._id || newRequestId(), description: String(fields.description || '').trim(), date: fields.date }
  if (fields.bankAccountId !== undefined) next.bankAccountId = fields.bankAccountId
  if (fields.bankAccounts !== undefined) next.bankAccounts = { ...fields.bankAccounts }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next.date || '')) throw new Error('أدخل تاريخ المستند.')
  if (!next.description) throw new Error('أدخل وصف المستند أو اسم المورد.')
  const review = { version: 1, reason, mode: invoice.type === 'sales' ? 'confirmed_channels' : 'confirmed_total',
    previous_total: invoice.totalAmount ?? invoice.amount ?? invoice.totalSales ?? null,
    previous_vat: invoice.vatAmount ?? null, previous_basis: invoice.amountsBasis ?? null,
    previous_items: invoice.items || [], previous_unknown: invoice.unknownPayments || [],
    previous_discount: invoice.invoiceDiscount ?? null }
  if (invoice.type === 'sales') {
    let total = 0
    for (const [key, label] of MANUAL_CHANNELS) { const n = amount(fields[key], label, true); next[key] = fromHalalas(n); total += n }
    if (total <= 0) throw new Error('أدخل مبلغ المبيعات في قناة واحدة على الأقل.')
    next.totalSales = fromHalalas(total)
    next.unknownPayments = []
    next.salesReadingVersion = 2
    // These are OCR explanations, not the newly confirmed net channel amounts.
    for (const key of ['paymentLines', 'returnLines', 'salesBreakdown', 'reportTotalBeforeReturns', 'reportNetWithTax']) delete next[key]
  } else {
    const total = amount(fields.totalAmount, 'إجمالي المستند')
    const vat = amount(fields.vatAmount, 'الضريبة', true)
    if (total <= 0) throw new Error('إجمالي المستند يجب أن يكون أكبر من صفر.')
    if (vat > total) throw new Error('الضريبة لا تتجاوز إجمالي المستند.')
    next.totalAmount = fromHalalas(total); next.amount = fromHalalas(total); next.vatAmount = fromHalalas(vat)
    if (invoice.type === 'expense') {
      const main = categories.find(c => c.id === fields.categoryId && !c.parent_id && c.is_active !== false)
      const sub = fields.subcategoryId ? categories.find(c => c.id === fields.subcategoryId && c.parent_id === main?.id && c.is_active !== false) : null
      if (!main || (fields.subcategoryId && !sub)) throw new Error('اختر تصنيفًا صحيحًا للمبلغ الذي ستعتمده.')
      next.category_main = main.name; next.category_id = main.id
      next.category_sub = sub?.name || ''; next.subcategory_id = sub?.id || null
      next.transType = main.ledger_type || main.name
      next.amountsBasis = 'inclusive'; next.invoiceDiscount = 0
      // A reviewer-selected single classification, explicitly shown before confirmation.
      next.items = [{ description: next.description, amount: next.totalAmount, discount: 0,
        category_main: main.name, category_sub: sub?.name || '', category_id: main.id, subcategory_id: sub?.id || null }]
    }
  }
  next.manualReview = review
  return next
}

/** Preserve other invoices and immutable original reading; target just the selected invoice. */
export function withManualInvoice(doc, index, invoice) {
  const raw = doc._edit || doc.analysis_result
  const rows = raw?.invoices?.length ? raw.invoices : [raw]
  if (!rows[index] || (rows[index]._id && rows[index]._id !== invoice._id)) throw new Error('تغيّر المستند. أعد فتح المراجعة.')
  return { ...doc, _edit: { ...raw, invoices: rows.map((row, i) => i === index ? invoice : row) } }
}
