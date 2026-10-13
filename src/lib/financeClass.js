// التصنيف المالي للقيود — وحدة خالصة بلا اتصال بالقاعدة.

export const COGS_TYPES = [
  '🥩 تكلفة البضاعة المباعة',
  '☕ مشتريات قهوة ومواد',
  '📦 مواد تعبئة وتغليف',
]

/**
 * تكلفة البضاعة لقيد: بالرمز المالي الثابت (financial_class) الذي يكتبه الاعتماد الجديد من التصنيف،
 * وإلا (قيود سابقة) بالاستنتاج من نوع القيد كما كان. تسمية التصنيف لا تغيّر أيًّا منهما.
 */
export function isCOGSEntry(e) {
  return e?.financial_class ? e.financial_class === 'cogs' : isCOGS(e?.type)
}

export function isCOGS(type) {
  const t = type || ''
  return COGS_TYPES.some(c => t.includes(c.replace(/^[^؀-ۿ]+/, '').trim()))
}
