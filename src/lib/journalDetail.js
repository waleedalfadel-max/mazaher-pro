import { fetchByChunks, fetchEveryRow } from './fetchAll.js'
import { loadJournalAccounts } from './journalAccounts.js'

const COLUMNS = 'id,project_id,journal_number,date,type,description,status,branch,total_amount,vat_amount,output_vat_amount,cash_in,cash_out,bank_in,bank_out,custody_in,custody_out,receivable_in,receivable_out,payable_in,payable_out,bank_account_id,supplier_id,document_id,document_invoice_id,file_url,original_name,created_at,created_by_name,category_main,category_sub,financial_class'
const empty = () => Promise.resolve({ data: [], error: null })
const unique = values => [...new Set(values.filter(Boolean))]
const errorResult = (part, error) => ({ data: null, error: error || { message: 'not_found' }, part })

// Anchor by an authorized row ID, then fetch the entire journal independently of
// the originating screen's dates, account, search, pagination, or grouped rows.
export async function loadJournalDetail(client, { projectId, entryId }) {
  if (!projectId || !entryId) return errorResult('القيد')
  try {
    const anchor = await client.from('ledger_entries').select(COLUMNS).eq('project_id', projectId).eq('id', entryId).maybeSingle()
    if (anchor.error || !anchor.data) return errorResult('القيد', anchor.error)
    const journalNumber = anchor.data.journal_number
    const result = journalNumber
      ? await fetchEveryRow(() => client.from('ledger_entries').select(COLUMNS).eq('project_id', projectId)
        .eq('journal_number', journalNumber).order('date').order('created_at').order('id'))
      : { data: [anchor.data], error: null }
    if (result.error || !result.data.some(r => r.id === entryId)) return errorResult('حركات القيد', result.error)
    const rows = result.data
    const documentIds = unique(rows.map(r => r.document_id))
    const byIds = (table, columns, ids) => ids.length ? fetchByChunks(ids, 100, chunk => fetchEveryRow(() => client.from(table)
      .select(columns).eq('project_id', projectId).in('id', chunk).order('id'))) : empty()
    const [accounts, items, documents, legacyDocuments, attachments] = await Promise.all([
      loadJournalAccounts(client, projectId, rows),
      fetchEveryRow(() => {
        const q = client.from('document_items').select('id,ledger_entry_id,document_id,document_invoice_id,description,amount,vat_amount,category_main,category_sub,sort_order').eq('project_id', projectId)
        return (journalNumber ? q.eq('journal_number', journalNumber) : q.eq('ledger_entry_id', entryId)).order('sort_order').order('id')
      }),
      byIds('documents', 'id,file_name,file_url', documentIds),
      journalNumber && rows.some(r => !r.document_id && !r.file_url)
        ? fetchEveryRow(() => client.from('documents').select('id,file_name,file_url').eq('project_id', projectId).eq('journal_number', journalNumber).order('id')) : empty(),
      journalNumber ? fetchEveryRow(() => client.from('attachments').select('id,file_name,file_url').eq('project_id', projectId)
        .eq('journal_number', journalNumber).order('uploaded_at').order('id')) : empty(),
    ])
    for (const [part, res] of [['الحسابات', accounts], ['بنود المستند', items], ['المستندات', documents], ['المستندات', legacyDocuments], ['المرفقات', attachments]]) {
      if (res.error) return errorResult(part, res.error)
    }
    const files = new Map()
    for (const f of [...documents.data, ...legacyDocuments.data, ...attachments.data,
      ...rows.map(r => ({ id: r.id, file_url: r.file_url, file_name: r.original_name || 'مستند القيد' }))]) {
      if (f.file_url && !files.has(f.file_url)) files.set(f.file_url, f)
    }
    return { error: null, data: { journalNumber, rows, ...accounts.data, items: items.data, files: [...files.values()] } }
  } catch (error) { return errorResult('تفاصيل القيد', error) }
}

// Show recorded effects, not inferred double-entry accounts. In/out on receivables
// and payables means an increase/decrease in the balance, not cash received/paid.
export function journalAccountMovements(row, { banks = [], suppliers = [], settings = {} } = {}) {
  const labels = new Map((Array.isArray(settings.statement_accounts) ? settings.statement_accounts : [])
    .filter(a => a && typeof a.label === 'string' && a.label.trim()).map(a => [a.value, a.label.trim()]))
  const bankName = labels.get('bank:' + row.bank_account_id) || banks.find(b => b.id === row.bank_account_id)?.name || 'حساب بنكي غير محدد'
  const supplier = suppliers.find(s => s.id === row.supplier_id)?.name
  const accounts = [
    ['cash', labels.get('cash') || 'الصندوق'], ['bank', bankName], ['custody', 'عهدة موظفين'],
    ['receivable', 'ذمم مدينة'], ['payable', supplier ? `مستحقات المورد — ${supplier}` : 'مستحقات الموردين'],
  ]
  return accounts.map(([key, label]) => ({ key, label, increase: Number(row[key + '_in']) || 0, decrease: Number(row[key + '_out']) || 0 }))
    .filter(m => m.increase !== 0 || m.decrease !== 0)
}

export const journalDetailHref = entry => '/journal-entry/' + encodeURIComponent(entry.id)
