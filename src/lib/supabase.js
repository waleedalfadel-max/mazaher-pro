import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/[^\x20-\x7E]/g, '')
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_KEY || '').trim().replace(/[^\x20-\x7E]/g, '')

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
