import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim()
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_KEY || '').trim()

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// PostgREST يقصّ أي استعلام عند 1000 صف افتراضياً — بلا خطأ وبلا أي إشارة بالنتيجة،
// فيبدو الرد ناجحاً بينما البيانات ناقصة. أي حساب مالي فوق هذا الحد يخرج خاطئاً بصمت.
// buildQuery دالة تُنشئ استعلاماً جديداً بكل نداء (لا يمكن إعادة استخدام نفس الكائن).
export async function fetchAllRows(buildQuery, pageSize = 1000) {
  let all = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) return { data: null, error }
    const batch = data || []
    all = all.concat(batch)
    if (batch.length < pageSize) return { data: all, error: null }
  }
}
