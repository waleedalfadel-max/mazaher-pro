// دوال خالصة لمطابقة أسماء الموردين — بدون أي تبعية على React أو Supabase مباشرة

const STOPWORDS = [
  'مؤسسة', 'شركة', 'محل', 'مطعم', 'مقهى',
  'للتجارة', 'التجارية', 'العامة', 'المحدودة', 'مجموعة',
]

// تطبيع: إزالة كلمات المنشآت الشائعة + توحيد المسافات
export function normalizeSupplierName(name) {
  let s = (name || '').trim()
  for (const w of STOPWORDS) {
    s = s.replace(new RegExp(w, 'g'), '')
  }
  return s.replace(/\s+/g, ' ').trim()
}

// مسافة Levenshtein الكلاسيكية
function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

// نسبة تشابه 0..1 مبنية على Levenshtein
export function similarityRatio(a, b) {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

// يقارن اسماً مستخرَجاً بقائمة موردين مسجَّلين، ويرجع أفضل تصنيف مطابقة:
// 'exact'  → ربط صامت تلقائي (نفس الاسم تماماً بعد التطبيع)
// 'fuzzy'  → يحتاج تأكيد من المحاسب (احتواء نصي أو تشابه ≥ threshold)
// 'none'   → مورد جديد كلياً
export function matchSupplier(extractedName, suppliers, { threshold = 0.75 } = {}) {
  const norm = normalizeSupplierName(extractedName)
  if (!norm) return { matchType: 'none', supplier: null }

  for (const s of suppliers) {
    if (normalizeSupplierName(s.name) === norm) {
      return { matchType: 'exact', supplier: s }
    }
  }

  let best = null
  let bestScore = 0
  for (const s of suppliers) {
    const sNorm = normalizeSupplierName(s.name)
    if (!sNorm) continue
    const contains = sNorm.includes(norm) || norm.includes(sNorm)
    const ratio    = similarityRatio(norm, sNorm)
    if (contains || ratio >= threshold) {
      const score = contains ? Math.max(ratio, threshold) : ratio
      if (score > bestScore) { bestScore = score; best = s }
    }
  }
  if (best) return { matchType: 'fuzzy', supplier: best }

  return { matchType: 'none', supplier: null }
}
