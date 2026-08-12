import { createClient } from '@supabase/supabase-js'

/**
 * عميل Supabase بمفتاح service_role — يتجاوز RLS بالكامل.
 * يُستخدم من api/ فقط. لا يُستورد من src/ إطلاقاً — لو حدث بالخطأ، البناء
 * عبر Vite لن يجد المتغيّر أصلاً لأنه غير مسبوق بـVITE_.
 */

let cached = null

export function getSupabaseAdmin() {
  if (cached) return cached

  const url = (process.env.VITE_SUPABASE_URL || '').trim()
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY (or URL) not configured on server')
  }

  cached = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cached
}
