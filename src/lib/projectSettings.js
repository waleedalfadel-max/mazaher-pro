import { supabase } from './supabase'

const FALLBACK_TYPES = [
  '💵 مبيعات كاش','🏦 مبيعات شبكة','🛒 مصروفات تشغيلية','💰 مصروفات ثابتة',
  '💳 قسط سيارة','💳 قسط شراء أرض','💳 قرض ١','💳 قرض ٢',
  '👤 صرف عهدة','💼 مسحوبات سليمان','💼 مسحوبات أم طوبى','🏛️ ضريبة القيمة المضافة',
]

// cache per projectId to avoid re-fetching on every render
const _cache = {}

export async function getTransactionTypes(projectId) {
  if (!projectId) return FALLBACK_TYPES
  if (_cache[projectId]) return _cache[projectId]

  const { data } = await supabase
    .from('project_settings')
    .select('settings')
    .eq('project_id', projectId)
    .maybeSingle()

  const types = data?.settings?.transaction_types?.map(t => t.label) || FALLBACK_TYPES
  _cache[projectId] = types
  return types
}

export async function getProjectSettings(projectId) {
  if (!projectId) return null
  const { data } = await supabase
    .from('project_settings')
    .select('settings, active')
    .eq('project_id', projectId)
    .maybeSingle()
  return data
}
