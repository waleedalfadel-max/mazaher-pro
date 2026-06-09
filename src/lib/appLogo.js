import { supabase } from './supabase'

const BUCKET      = 'documents'
const PATH        = '__app__/logo.png'
const FOLDER      = '__app__'
const CACHE_TTL   = 5 * 60 * 1000  // 5 دقائق

function getBaseUrl() {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(PATH)
  return data.publicUrl
}

export async function uploadAppLogo(file) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(PATH, file, { upsert: true, contentType: file.type })
  if (error) throw error
  const ts = String(Date.now())
  localStorage.setItem('mz_logo_ts',      ts)
  localStorage.setItem('mz_logo_cached',  ts)
  localStorage.setItem('mz_logo_fetched', String(Date.now()))
  return `${getBaseUrl()}?t=${ts}`
}

// يجلب timestamp من Storage للمزامنة مع كل الأجهزة
export async function fetchLogoUrl() {
  const now        = Date.now()
  const lastFetch  = Number(localStorage.getItem('mz_logo_fetched') || 0)
  const cachedTs   = localStorage.getItem('mz_logo_cached')

  // استخدم الكاش إذا لم يمرّ 5 دقائق
  if (cachedTs && now - lastFetch < CACHE_TTL) {
    return `${getBaseUrl()}?t=${cachedTs}`
  }

  try {
    const { data, error } = await supabase.storage.from(BUCKET).list(FOLDER)
    if (error || !data) return null
    const logoFile = data.find(f => f.name === 'logo.png')
    if (!logoFile) return null
    const ts = String(new Date(logoFile.updated_at).getTime())
    localStorage.setItem('mz_logo_cached',  ts)
    localStorage.setItem('mz_logo_fetched', String(now))
    return `${getBaseUrl()}?t=${ts}`
  } catch {
    return null
  }
}
