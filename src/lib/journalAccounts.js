import { fetchByChunks, fetchEveryRow } from './fetchAll.js'

export async function loadJournalAccounts(client, projectId, rows = []) {
  if (!projectId) return { data: null, error: { message: 'project_required' } }
  const ids = [...new Set(rows.map(r => r.supplier_id).filter(Boolean))]
  const references = [...new Set(rows.filter(r => !r.supplier_id && (Number(r.payable_in) || Number(r.payable_out))).map(r => r.journal_number).filter(Boolean))]
  const suppliers = table => ids.length ? fetchByChunks(ids, 100, chunk => fetchEveryRow(() => client.from(table)
    .select('id,name').eq('project_id', projectId).in('id', chunk).order('id'))) : Promise.resolve({ data: [], error: null })
  try {
    const [banks, settings, regular, payable, linked] = await Promise.all([
      fetchEveryRow(() => client.from('bank_accounts').select('id,name,bank,is_active').eq('project_id', projectId).order('id')),
      client.from('project_settings').select('settings').eq('project_id', projectId).maybeSingle(),
      suppliers('suppliers'), suppliers('payable_suppliers'),
      references.length ? fetchByChunks(references, 100, chunk => fetchEveryRow(() => client.from('supplier_transactions').select('id,supplier_id,journal_number').eq('project_id',projectId).in('journal_number',chunk).order('id'))) : Promise.resolve({data:[],error:null}),
    ])
    const failure = [banks, settings, regular, payable, linked].find(r => r.error)
    if (failure) return {data:null,error:failure.error}
    const linkedIds = [...new Set(linked.data.map(t=>t.supplier_id).filter(Boolean))]
    const names = linkedIds.length ? await fetchByChunks(linkedIds,100,chunk=>fetchEveryRow(()=>client.from('suppliers').select('id,name').eq('project_id',projectId).in('id',chunk).order('id'))) : {data:[],error:null}
    if(names.error)return {data:null,error:names.error}
    const byReference=references.flatMap(ref=>{const matched=[...new Set(linked.data.filter(t=>t.journal_number===ref).map(t=>t.supplier_id))];const name=matched.length===1&&names.data.find(s=>s.id===matched[0])?.name;return name?[{journal_number:ref,name}]:[]})
    return { data: { banks: banks.data, settings: settings.data?.settings || {}, suppliers: [...regular.data, ...payable.data, ...byReference] }, error: null }
  } catch (error) { return { data: null, error } }
}
