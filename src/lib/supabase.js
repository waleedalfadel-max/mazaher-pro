import { createClient } from '@supabase/supabase-js'
import { guardedFetch } from './appVersion.js'

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim()
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_KEY || '').trim()

// منشأة يعرضها مدير المنصة للقراءة فقط: تُرسل مع كل طلب في x-tahseeb-view-project. الترويسة لا تمنح شيئًا وحدها؛ الخادم
// (public.auth_view_project_id، 20261009150000) يقبلها لمدير منصة نشط فقط، ولسياسات القراءة وحدها.
let viewProject = null
export const setViewProject = id => { viewProject = id || null }
const withViewProject = (input, init = {}) => {
  if (!viewProject) return [input, init]
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined))
  headers.set('x-tahseeb-view-project', viewProject)
  return [input, { ...init, headers }]
}

// بعد اكتشاف إصدار أحدث من الواجهة تُرفض الكتابة من هذه الصفحة القديمة (src/lib/appVersion.js)؛ القراءة والجلسة كما هما
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { global: { fetch: guardedFetch((input, init) => fetch(...withViewProject(input, init))) } })

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
