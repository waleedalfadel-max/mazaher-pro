import { accountMovement, cents } from './accountStatement.js'
import { isCounted, isSales } from './financeRules.js'
import { compactEntryDescription } from './entryDescription.js'
import { fetchEveryRow } from './fetchAll.js'

export const JOURNAL_SUMMARY_COLUMNS = 'id,project_id,date,created_at,type,description,status,journal_number,branch,cash_in,cash_out,bank_in,bank_out,custody_in,custody_out,receivable_in,receivable_out,payable_in,payable_out,bank_account_id,total_amount'
const keyOf = r => JSON.stringify([r.project_id, r.date, r.journal_number || r.id, r.status])
const clean = s => String(s || '').replace(/^[^\p{L}\p{N}]+/u, '').trim()

export function summaryMovement(row, account = 'all', settings = {}, banks = []) {
  return account === 'all' ? {
    incoming: cents(row.cash_in) + cents(row.bank_in) + cents(row.custody_in),
    outgoing: cents(row.cash_out) + cents(row.bank_out) + cents(row.custody_out),
  } : accountMovement(row, account, settings, banks)
}

// Group by the actual reference, never by amount, vendor, uploaded file, or an
// arbitrary number of rows. No source row or posting is modified or created.
export function journalSummaries(visibleRows, fullRows = visibleRows, { account = 'all', settings = {}, banks = [] } = {}) {
  const full = new Map(), groups = new Map()
  for (const row of fullRows) {
    const key = keyOf(row)
    if (!full.has(key)) full.set(key, [])
    full.get(key).push(row)
  }
  for (const row of visibleRows) {
    if (row.status === 'cancelled') continue
    const key = keyOf(row)
    if (!groups.has(key)) groups.set(key, { key, entry: row, date: row.date, status: row.status, rows: [], incoming: 0, outgoing: 0, receivable: 0, payable: 0 })
    const group = groups.get(key), move = summaryMovement(row, account, settings, banks)
    group.rows.push(row); group.incoming += move.incoming; group.outgoing += move.outgoing
    if (account === 'all') {
      group.receivable += cents(row.receivable_in) - cents(row.receivable_out)
      group.payable += cents(row.payable_in) - cents(row.payable_out)
    }
  }
  return [...groups.values()].map(group => {
    const all = full.get(group.key) || group.rows, types = [...new Set(all.map(r => clean(r.type)).filter(Boolean))]
    const branches = [...new Set(all.map(r => r.branch).filter(Boolean))]
    const creditPurchase = all.every(r => cents(r.payable_in) > 0 && !summaryMovement(r).incoming && !summaryMovement(r).outgoing)
    const title = all.every(r => isSales(r.type)) ? 'مبيعات اليوم' : creditPurchase ? 'مشتريات آجلة'
      : types.length === 1 ? types[0] : 'عملية متعددة البنود'
    const description = compactEntryDescription(group.entry)
    return { ...group, title, branch: branches.length === 1 ? branches[0] : '',
      description: title === 'مبيعات اليوم' || clean(description) === title ? '' : description, partial: group.rows.length !== all.length,
      incoming: group.incoming / 100, outgoing: group.outgoing / 100, receivable: group.receivable / 100, payable: group.payable / 100 }
  })
}

export function summaryDays(groups) {
  const days = new Map()
  for (const group of groups) {
    if (!days.has(group.date)) days.set(group.date, { date: group.date, groups: [], incoming: 0, outgoing: 0 })
    const day = days.get(group.date); day.groups.push(group)
    if (isCounted(group.entry)) { day.incoming += cents(group.incoming); day.outgoing += cents(group.outgoing) }
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date))
    .map(d => ({ ...d, incoming: d.incoming / 100, outgoing: d.outgoing / 100 }))
}

export async function loadJournalDay(client, { projectId, date }) {
  if (!projectId || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
    return { data: null, error: { message: 'invalid_date' } }
  try {
    return await fetchEveryRow(() => client.from('ledger_entries').select(JOURNAL_SUMMARY_COLUMNS)
      .eq('project_id', projectId).eq('date', date).not('status', 'eq', 'cancelled').order('created_at').order('id'))
  } catch (error) { return { data: null, error } }
}
