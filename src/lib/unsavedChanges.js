// تعديلات غير محفوظة في الصفحة الحالية (مثل مراجعة المستند)، لتعرف رسالة التحديث أن عليها عرض الحفظ قبل إعادة التحميل.
// الصفحة تسجّل { count, save, discard } ما دامت فيها تعديلات، وتمسح تسجيلها عند زوالها.
let current = null
const listeners = new Set()
export function setUnsaved(entry) { current = entry && entry.count > 0 ? entry : null; listeners.forEach(fn => fn(current)) }
export const getUnsaved = () => current
export function onUnsaved(fn) { listeners.add(fn); return () => listeners.delete(fn) }
