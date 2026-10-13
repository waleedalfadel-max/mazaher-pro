// جلب كامل لا يكتفي بحد الصفحة — وحدة خالصة (تُختبر في Node بطلبات مصطنعة).
// fetchAllRows (src/lib/supabase.js) يتوقف حين تعود صفحة أقل من حجمها؛ إن كان حد الخادم أصغر من حجم الصفحة، أو تغيّر
// ترتيب الصفوف بين صفحة وأخرى، نقصت البيانات بصمت. هنا: ترتيب ثابت يحدده المستدعي (مثل .order('id'))، والتقدم بعدد ما وصل
// فعلًا، والتوقف عند صفحة فارغة؛ وأي خطأ في أي صفحة يُعاد خطأً لا بيانات ناقصة.

export async function fetchEveryRow(buildQuery, pageSize = 1000, maxPages = 10000) {
  let all = [], from = 0
  for (let page = 0; page < maxPages; page++) {
    const res = await buildQuery().range(from, from + pageSize - 1)
    if (!res || res.error) return { data: null, error: res?.error || { message: 'no_response' } }
    const batch = Array.isArray(res.data) ? res.data : []
    if (!batch.length) return { data: all, error: null }
    all = all.concat(batch)
    from += batch.length
  }
  return { data: null, error: { message: 'too_many_pages' } }
}

/** يجلب لكل مجموعة من القيم (مثل أرقام القيود) على دفعات صغيرة كي لا يطول عنوان الطلب؛ أي خطأ ← خطأ. */
export async function fetchByChunks(values, chunkSize, fetchChunk) {
  let all = []
  for (let i = 0; i < values.length; i += chunkSize) {
    const res = await fetchChunk(values.slice(i, i + chunkSize))
    if (!res || res.error) return { data: null, error: res?.error || { message: 'no_response' } }
    all = all.concat(res.data || [])
  }
  return { data: all, error: null }
}
