// OCR metadata (type, payment defaults, ids) alone is not an invoice.
const evidenceKeys = new Set(['description', 'date', 'invoiceNumber', 'invoice_number', 'supplier_name', 'amount', 'totalAmount', 'vatAmount', 'items', 'sales', 'payments', 'returns', 'paymentLines', 'returnLines', 'reportGrossTotal', 'reportNetTotal', 'totalSales', 'cashSales', 'networkSales', 'transferSales', 'hungerSales', 'jahez', 'keeta', 'mrsool', 'reference', 'beneficiary'])
const meaningful = value => typeof value === 'number' ? Number.isFinite(value)
  : typeof value === 'string' ? !!value.trim()
  : Array.isArray(value) ? value.some(meaningful)
  : value && typeof value === 'object' ? Object.entries(value).some(([key, v]) => !key.startsWith('_') && meaningful(v)) : false

export function validRereading(result) {
  return Array.isArray(result?.invoices) && result.invoices.length > 0 && result.invoices.length <= 30
    && result.invoices.every(inv => inv && !Array.isArray(inv) && typeof inv === 'object'
      && Object.entries(inv).some(([key, value]) => evidenceKeys.has(key) && meaningful(value)))
}

export function readingReplaced(previous, current) {
  if ((previous?._readingId || null) !== (current?._readingId || null)) return true
  const ids = new Set((current?.invoices || []).map(x => x._id).filter(Boolean))
  return (previous?.invoices || []).some(x => x._id && !ids.has(x._id))
}

// Discard reviewer decisions, but retain the image viewer and server document fields.
export function resetReplacedReview(doc, reading) {
  const next = Object.fromEntries(Object.entries(doc).filter(([key]) => !key.startsWith('_') || ['_imageData', '_isUrl', '_showImage'].includes(key)))
  return { ...next, analysis_result: reading, _state: 'analyzed', _dirty: false,
    _draftSavedAt: null, _origBranch: doc._origBranch ?? doc.branch,
    branch: doc._origBranch ?? doc.branch, _branchEditable: !doc._origBranch,
    _readingReviewRequired: true,
    _rereadNotice: 'استُبدلت قراءة المستند. أُلغيت التعديلات والتأكيدات القديمة؛ راجع القراءة الجديدة قبل الاعتماد.' }
}
