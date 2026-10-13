// إدخال المبالغ في نموذج المراجعة: أرقام لاتينية في العرض، وقبول الأرقام العربية والهندية
// المكتوبة من لوحة مفاتيح عربية، ورفض أي حرف آخر فلا يصل نص يتحول صفرًا عند الاعتماد.

/** «١٬٢٣٤٫٥» → «1234.5»؛ فواصل الآلاف والمسافات تُحذف. */
export function toLatinNumber(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/٫/g, '.')
    .replace(/[,٬\s]/g, '')
}

/** مدخل جزئي مقبول أثناء الكتابة: فارغ، أو رقم بعلامة عشرية واحدة على الأكثر وسالب اختياري. */
export const isAmountDraft = text => /^-?\d*\.?\d*$/.test(text)

/** يعيد النص المحوَّل إن كان مقبولًا، أو null ليبقى الحقل على قيمته السابقة. */
export function acceptAmount(raw) {
  const v = toLatinNumber(raw)
  return isAmountDraft(v) ? v : null
}
