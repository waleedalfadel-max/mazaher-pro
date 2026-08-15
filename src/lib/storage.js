import { supabase } from './supabase'

const PUBLIC_MARKER = '/object/public/documents/'

// يستخلص المسار داخل الـbucket من رابط عام مخزَّن سابقاً (getPublicUrl)،
// بصرف النظر عن حالة الـbucket الفعلية اليوم — الشكل النصي ثابت دائماً
function extractStoragePath(storedUrl) {
  const idx = (storedUrl || '').indexOf(PUBLIC_MARKER)
  if (idx === -1) return null
  return decodeURIComponent(storedUrl.slice(idx + PUBLIC_MARKER.length))
}

// يولّد رابطاً موقَّعاً مؤقتاً من رابط file_url المخزَّن (عام أو خاص، لا فرق)
export async function getSignedUrl(storedUrl, expiresIn = 300) {
  const path = extractStoragePath(storedUrl)
  if (!path) return null
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, expiresIn)
  if (error) return null
  return data.signedUrl
}

export async function uploadToStorage(file, projectId) {
  const ext  = file.name.split('.').pop().toLowerCase()
  const path = `${projectId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const { error } = await supabase.storage
    .from('documents')
    .upload(path, file, { contentType: file.type, upsert: false })

  if (error) throw new Error(error.message)

  const { data } = supabase.storage.from('documents').getPublicUrl(path)
  return data.publicUrl
}

// Returns { base64, mimeType } — mimeType taken from the actual response, not what's stored in DB
export async function fetchAsBase64(url) {
  const res  = await fetch(url)
  if (!res.ok) throw new Error(`فشل تحميل الملف: ${res.status}`)
  const blob = await res.blob()
  // Use the real Content-Type from the response (fixes image/jpg → image/jpeg issues)
  const mimeType = blob.type || res.headers.get('content-type') || ''
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result.split(',')[1])
    reader.onerror  = reject
    reader.readAsDataURL(blob)
  })
  return { base64, mimeType }
}
