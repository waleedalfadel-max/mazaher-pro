// تصحيح ضريبة بند مقروءة خطأ من شاشة المراجعة (2026-11-01).
// الاعتماد يستعمل ضريبة السطر المطبوعة متى وصفت المبلغ المراجَع (approval_private.item_vats، 20261031130000)، ويتوقف للمراجعة عند التعارض.
// هنا يصحح المراجع ضريبة بند بعينه: تُحفظ القراءة الأصلية (lineVat وlineNet وprintedLineTotal كما قُرئت) والقيمة المصححة والسبب في
// vatCorrection على البند نفسه، ويُعاد بناء سطر البند على المبلغ المراجَع فيتسق مع القاعدة (صافي + ضريبة = الإجمالي). لا تتغير
// البنود الأخرى ولا مبلغ البند ولا تصنيفه، ولا تُحذف بيانات الضريبة لتجاوز الرفض. وحدة خالصة بلا React ولا شبكة.
import { toHalalas } from './approvalV2.js'

// أرقام لا نصوص: الخادم يعدّ ضريبة السطر صالحة فقط متى كانت رقمًا
const num = h => Number((h / 100).toFixed(2))

const LINE_FIELDS = ['lineVat', 'lineNet', 'printedLineTotal']

/** هل للبند ضريبة سطر مقروءة أو مصححة (يظهر له حقل الضريبة في المراجعة) */
export const hasLineVat = item => typeof item?.lineVat === 'number' || item?.lineVat === 0 || !!item?.vatCorrection
  || typeof item?.lineNet === 'number' || typeof item?.printedLineTotal === 'number'

/**
 * التصحيح: يعيد البند بعد التصحيح أو يرمي خطأ بالعربية.
 * basis: أساس مبالغ البنود في الفاتورة ('exclusive' | 'inclusive'). مبلغ البند المراجَع هو صافيه (قبل الضريبة) أو إجماليه (الشامل).
 */
export function correctLineVat(item, value, reason, basis, now = new Date()) {
  const why = String(reason ?? '').trim()
  if (!why) throw new Error('اكتب سبب تصحيح ضريبة البند.')
  const vat = toHalalas(value)
  if (!Number.isFinite(vat) || vat < 0) throw new Error('ضريبة البند رقم موجب أو صفر، بهللتين على الأكثر.')
  const amount = toHalalas(item?.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('اكتب مبلغ البند قبل تصحيح ضريبته.')
  if (basis === 'inclusive' && vat >= amount) throw new Error('ضريبة البند يجب أن تكون أقل من مبلغه الشامل.')
  const net = basis === 'inclusive' ? amount - vat : amount
  const total = basis === 'inclusive' ? amount : amount + vat
  // الأصل يبقى أول قراءة؛ تصحيح ثانٍ لا يمحوه
  const original = item?.vatCorrection?.original ?? Object.fromEntries(LINE_FIELDS.map(k => [k, item?.[k] ?? null]))
  return { ...item, lineVat: num(vat), lineNet: num(net), printedLineTotal: num(total),
    vatCorrection: { original, value: num(vat), reason: why, basis: basis === 'inclusive' ? 'inclusive' : 'exclusive', at: now.toISOString() } }
}

/** نص قصير للمراجع: الضريبة المقروءة والمصححة وسببها */
export function lineVatText(item) {
  if (!item?.vatCorrection) return typeof item?.lineVat === 'number' ? `ضريبة البند المقروءة: ${item.lineVat.toFixed(2)}` : 'ضريبة البند غير مقروءة'
  const o = item.vatCorrection.original?.lineVat
  return `ضريبة البند صُحّحت: ${o == null ? 'غير مقروءة' : Number(o).toFixed(2)} ← ${Number(item.vatCorrection.value).toFixed(2)} — ${item.vatCorrection.reason}`
}
