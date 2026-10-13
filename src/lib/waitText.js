// مدة الانتظار بالعربية من ثوانٍ (كما يعيدها الخادم في retry_after)، مقرّبة للأعلى: دقائق حتى 59، ثم ساعات.
export function waitText(seconds) {
  const s = Math.max(1, Number(seconds) || 60)
  const m = Math.ceil(s / 60)
  if (m < 60) return m === 1 ? 'دقيقة' : m === 2 ? 'دقيقتين' : m <= 10 ? `${m} دقائق` : `${m} دقيقة`
  const h = Math.ceil(s / 3600)
  return h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : h <= 10 ? `${h} ساعات` : `${h} ساعة`
}
