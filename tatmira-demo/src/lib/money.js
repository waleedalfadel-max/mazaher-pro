// المبالغ تُخزَّن بالهللة (أعداد صحيحة) لتفادي أخطاء الكسور العشرية.

// يحوّل الأرقام العربية (٠-٩) والفارسية (۰-۹) إلى إنجليزية، والفاصلة العشرية العربية «٫» إلى نقطة
export function normalizeDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6F0))
    .replace(/٫/g, '.')
}

function parseDecimal(value) {
  const cleaned = normalizeDigits(value).replace(/[,\s٬]/g, '')
  if (cleaned === '' || cleaned === '.') return 0
  if (!/^\d*\.?\d*$/.test(cleaned)) return NaN
  return Number(cleaned)
}

export function toHalalas(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : 0
  const n = parseDecimal(value)
  return Number.isFinite(n) ? Math.round(n * 100) : NaN
}

/** كمية بند: تقبل أرقاماً عربية أو إنجليزية وكسراً عشرياً. تعيد NaN للنص غير الصالح. */
export function toQuantity(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  return parseDecimal(value)
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
