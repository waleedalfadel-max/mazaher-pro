import { fetchByChunks, fetchEveryRow } from './fetchAll.js'

export async function loadJournalAccounts(client, projectId, rows = []) {
  if (!projectId) return { data: null, error: { message: 'project_required' } }
  const ids = [...new Set(rows.map(r => r.supplier_id).filter(Boolean))]
  const suppliers = table => ids.length ? fetchByChunks(ids, 100, chunk => fetchEveryRow(() => client.from(table)
    .select('id,name').eq('project_id', projectId).in('id', chunk).order('id'))) : Promise.resolve({ data: [], error: null })
  try {
    const [banks, settings, regular, payable] = await Promise.all([
      fetchEveryRow(() => client.from('bank_accounts').select('id,name,bank,is_active').eq('project_id', projectId).order('id')),
      client.from('project_settings').select('settings').eq('project_id', projectId).maybeSingle(),
      suppliers('suppliers'), suppliers('payable_suppliers'),
    ])
    const failure = [banks, settings, regular, payable].find(r => r.error)
    return failure ? { data: null, error: failure.error } : { data: { banks: banks.data, settings: settings.data?.settings || {}, suppliers: [...regular.data, ...payable.data] }, error: null }
  } catch (error) { return { data: null, error } }
}
