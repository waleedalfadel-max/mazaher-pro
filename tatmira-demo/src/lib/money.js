// المبالغ تُخزَّن بالهللة (أعداد صحيحة) لتفادي أخطاء الكسور العشرية.

export function toHalalas(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : 0
  const cleaned = String(value ?? '')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/[,\s٬]/g, '')
  if (cleaned === '' || cleaned === '.') return 0
  const n = Number(cleaned)
  return Number.isFinite(n) ? Math.round(n * 100) : NaN
}

export function fromHalalas(h) {
  return (h || 0) / 100
}

export function fmt(h) {
  return fromHalalas(h).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtSar(h) {
  return `${fmt(h)} ر.س`
}

// قيمة حقل إدخال (نص) من الهللات، بلا فواصل آلاف
export function inputValue(h) {
  if (!h) return ''
  const v = fromHalalas(h)
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

export const VAT_RATE = 0.15

export function vatFor(netHalalas, rate = VAT_RATE) {
  return Math.round(netHalalas * rate)
}
