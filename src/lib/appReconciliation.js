// دوال خالصة لمنطق مطابقة تطبيقات التوصيل — بدون أي تبعية على React أو Supabase مباشرة

export const APPS = [
  { key: 'hunger', label: 'هنقر ستيشن', keyword: 'هنقر' },
  { key: 'jahez',  label: 'جاهز',        keyword: 'جاهز' },
  { key: 'keeta',  label: 'كيتا',        keyword: 'كيتا' },
  { key: 'ninja',  label: 'نينجا',       keyword: 'نينجا' },
  { key: 'mrsool', label: 'مرسول',       keyword: 'مرسول' },
  { key: 'chefz',  label: 'ذا شيفز',     keyword: 'شيفز' },
]

// إجمالي المبيعات المسجّلة بتحسيب لهذا التطبيق ضمن الفترة —
// receivable_in فقط (قيود التحصيل لا تضع receivable_in فتُستبعد تلقائياً)
export function computeSystemTotal(entries, keyword) {
  return entries
    .filter(e => (e.type || '').includes(keyword))
    .reduce((s, e) => s + (Number(e.receivable_in) || 0), 0)
}

// فرق كبير بين مبيعات التطبيق المعلَنة وما هو مسجَّل بتحسيب — يستحق تنبيهاً منفصلاً عن العمولة
export function hasSalesMismatch(systemTotal, reportedSales, marginPct = 0.03) {
  if (reportedSales == null) return false
  if (systemTotal === 0) return reportedSales !== 0
  return Math.abs(systemTotal - reportedSales) / systemTotal >= marginPct
}
