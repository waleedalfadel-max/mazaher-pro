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
export function correctLineVat(item, value, reason, basis, now = new Date(), invoiceDiscount = 0) {
  const why = String(reason ?? '').trim()
  if (!why) throw new Error('اكتب سبب تصحيح ضريبة البند.')
  const vat = toHalalas(value)
  if (!Number.isFinite(vat) || vat < 0) throw new Error('ضريبة البند رقم موجب أو صفر، بهللتين على الأكثر.')
  // خصم على إجمالي الفاتورة يغيّر مبلغ كل بند بعد حصته، فلا يصف سطر البند المبلغ المعتمد: لا تصحيح هنا (قواعد الاعتماد تحكم)
  if ((toHalalas(invoiceDiscount) || 0) !== 0) throw new Error('لا تُصحَّح ضريبة بند في فاتورة عليها خصم على الإجمالي؛ راجع ضريبة الفاتورة ومبالغ البنود.')
  const amount = toHalalas(item?.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('اكتب مبلغ البند قبل تصحيح ضريبته.')
  if (basis === 'inclusive' && vat >= amount) throw new Error('ضريبة البند يجب أن تكون أقل من مبلغه الشامل.')
  const net = basis === 'inclusive' ? amount - vat : amount
  const total = basis === 'inclusive' ? amount : amount + vat
  // الأصل يبقى أول قراءة؛ تصحيح ثانٍ لا يمحوه
  const original = item?.vatCorrection?.original ?? Object.fromEntries(LINE_FIELDS.map(k => [k, item?.[k] ?? null]))
  return { ...item, lineVat: num(vat), lineNet: num(net), printedLineTotal: num(total),
    // الأرقام التي صُحّح عليها: أي تغيير لاحق فيها يجعل التصحيح قديمًا (staleLineVatCorrection) فلا يُعتمد
    vatCorrection: { original, value: num(vat), reason: why, basis: basis === 'inclusive' ? 'inclusive' : 'exclusive', amount: num(amount),
      discount: num(toHalalas(item?.discount) || 0), at: now.toISOString() } }
}

/** نص قصير للمراجع: الضريبة المقروءة والمصححة وسببها */
export function lineVatText(item) {
  if (!item?.vatCorrection) return typeof item?.lineVat === 'number' ? `ضريبة البند المقروءة: ${item.lineVat.toFixed(2)}` : 'ضريبة البند غير مقروءة'
  const o = item.vatCorrection.original?.lineVat
  return `ضريبة البند صُحّحت: ${o == null ? 'غير مقروءة' : Number(o).toFixed(2)} ← ${Number(item.vatCorrection.value).toFixed(2)} — ${item.vatCorrection.reason}`
}

/**
 * تصحيح لم يعد يناسب الأرقام: تغيّر بعده مبلغ البند أو خصمه أو أساس الضريبة، أو صار على الفاتورة خصم على الإجمالي، أو عُدّل سطر البند.
 * يعيد أول بند قديم { line, why } أو null. الاعتماد لا يُرسل قبل تصحيح الضريبة من جديد أو إلغاء التصحيح.
 */
export function staleLineVatCorrection(inv) {
  const basis = inv?.amountsBasis === 'exclusive' ? 'exclusive' : 'inclusive'
  const disc = toHalalas(inv?.invoiceDiscount) || 0
  for (const [i, it] of (inv?.items || []).entries()) {
    const c = it?.vatCorrection
    if (!c) continue
    const why = c.basis !== basis ? 'basis' : disc !== 0 ? 'invoice_discount'
      : toHalalas(it.amount) !== toHalalas(c.amount) ? 'amount'
      : (toHalalas(it.discount) || 0) !== (toHalalas(c.discount) || 0) ? 'discount'
      : toHalalas(it.lineVat) !== toHalalas(c.value) ? 'line' : null
    if (why) return { line: i + 1, why }
  }
  return null
}

/** إلغاء التصحيح: سطر البند كما قُرئ أول مرة، دون أي أثر للتصحيح */
export function undoLineVatCorrection(item) {
  if (!item?.vatCorrection) return item
  // vatCorrection: undefined صراحةً: شاشة المراجعة تدمج التعديل مع البند، فغياب المفتاح كان سيُبقي التصحيح القديم
  const { vatCorrection, ...rest } = item
  return { ...rest, ...vatCorrection.original, vatCorrection: undefined }
}
