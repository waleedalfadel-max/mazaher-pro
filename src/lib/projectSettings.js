import { supabase } from './supabase'

const FALLBACK_TYPES = [
  '💵 مبيعات كاش','🏦 مبيعات شبكة','🛒 مصروفات تشغيلية','💰 مصروفات ثابتة',
  '👤 صرف عهدة','🏛️ ضريبة القيمة المضافة',
  '🔄 تحويل داخلي — صرف عهدة','🏧 تحويل داخلي — إيداع نقدي','📥 تحصيل جملة',
]

const _cache = {}

export function clearProjectCache(projectId) {
  delete _cache[projectId]
}

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
    .select('settings, active, modules')
    .eq('project_id', projectId)
    .maybeSingle()
  return data
}

export async function getProjectModules(projectId) {
  if (!projectId) return []
  const data = await getProjectSettings(projectId)
  return data?.modules || data?.settings?.modules || []
}
