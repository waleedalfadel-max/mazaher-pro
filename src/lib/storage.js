import { supabase } from './supabase'

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

export async function fetchAsBase64(url) {
  const res  = await fetch(url)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result.split(',')[1])
    reader.onerror  = reject
    reader.readAsDataURL(blob)
  })
}
