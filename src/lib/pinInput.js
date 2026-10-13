// حقل رمز الدخول: يقبل الكتابة واللصق من لوحة الجوال أو الحاسب، بأرقام عربية أو لاتينية. يحوّل الأرقام إلى لاتينية،
// ويحذف ما ليس رقمًا (مسافات أو شرطات من النسخ)، ويحتفظ بالأصفار في البداية. لا يقص رمزًا أطول من المقبول بصمت
// (فيُرسَل رمز غير المقصود)، بل يبقيه ليظهر خطأ الطول.
export const PIN_LENGTH = 5
const MAX_TYPED = 12

export function normalizePin(text) {
  return String(text ?? '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6F0))
    .replace(/\D/g, '')
    .slice(0, MAX_TYPED)
}

export const pinReady = pin => pin.length === PIN_LENGTH && /^\d+$/.test(pin)
export const pinTooLong = pin => pin.length > PIN_LENGTH
