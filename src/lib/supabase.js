import { createClient } from '@supabase/supabase-js'

const clean = s => (s || '').trim().replace(/[^\x20-\x7E]/g, '')

const SUPABASE_URL = clean(import.meta.env.VITE_SUPABASE_URL)
const SUPABASE_KEY = clean(import.meta.env.VITE_SUPABASE_KEY)

// custom fetch — sanitizes every header value to ASCII before sending
function safeFetch(url, options = {}) {
  if (options.headers) {
    const entries = options.headers instanceof Headers
      ? [...options.headers.entries()]
      : Object.entries(options.headers)
    const sanitized = {}
    for (const [k, v] of entries) sanitized[k] = clean(String(v))
    options = { ...options, headers: sanitized }
  }
  return fetch(url, options)
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { fetch: safeFetch },
})
