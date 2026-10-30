// صور صفحات فاتورة واحدة (2026-10-30): تُجمع بالترتيب الذي يختاره الرافع في ملف PDF واحد، صفحة لكل صورة بأبعادها كاملة
// (بلا قص ولا تصغير إضافي فوق ضغط الرفع المعتاد)، فتُحفظ مستندًا واحدًا وتُقرأ في طلب واحد. الرفع المستقل يبقى الافتراضي.
// بناء PDF وعدّ صفحاته في invoicePagesPdf.js (يُحمَّل عند الحاجة فقط).

export const MAX_INVOICE_PAGES = 5
export const PAGE_TYPES = ['image/jpeg', 'image/png']

/** نقل صفحة إلى موضع آخر؛ نسخة جديدة دون تعديل الأصل. */
export function movePage(pages, from, to) {
  if (from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length) return pages
  const next = [...pages]
  const [page] = next.splice(from, 1)
  next.splice(to, 0, page)
  return next
}

export const removePage = (pages, index) => pages.filter((_, i) => i !== index)

/** سبب رفض مجموعة الصفحات قبل الرفع، أو null. */
export function pagesProblem(pages) {
  if (pages.length < 2) return 'اختر صفحتين على الأقل؛ الصفحة الواحدة تُرفع كمستند عادي.'
  if (pages.length > MAX_INVOICE_PAGES) return `الحد ${MAX_INVOICE_PAGES} صفحات للفاتورة الواحدة.`
  if (pages.some(p => !PAGE_TYPES.includes(p.type))) return 'صفحات الفاتورة صور فقط (JPG أو PNG)؛ ملف PDF يُرفع كمستند مستقل.'
  return null
}

const norm = s => String(s || '').normalize('NFKC').replace(/[\s.\-_/\\|()«»"'،,]+/g, '').toLowerCase()
const supplierOf = inv => norm(inv?.supplier_name || inv?.supplierName || inv?.description)
const missingTotal = inv => inv?.totalAmount == null || inv.totalAmount === '' || Number(inv.totalAmount) === 0

/**
 * اشتباه بأن القراءة قسمت فاتورة واحدة إلى عدة فواتير: فاتورتا مصروفات أو أكثر في المستند نفسه من المورد نفسه، ومعها دليل
 * استمرار: رقم الفاتورة نفسه، أو غياب الرقم في إحداهما، أو غياب الإجمالي في إحداهما. تنبيه للمراجع فقط؛ لا دمج تلقائي ولا
 * تغيير على فحوص الاعتماد. يعيد null أو { invoices: [فهارس] }.
 */
export function splitSuspicion(invoices) {
  const list = (Array.isArray(invoices) ? invoices : []).map((inv, i) => ({ inv, i })).filter(x => x.inv?.type === 'expense')
  for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
    const x = list[a].inv, y = list[b].inv
    if (!supplierOf(x) || supplierOf(x) !== supplierOf(y)) continue
    const nx = norm(x.invoiceNumber), ny = norm(y.invoiceNumber)
    if ((nx && nx === ny) || !nx || !ny || missingTotal(x) || missingTotal(y)) return { invoices: [list[a].i, list[b].i] }
  }
  return null
}
