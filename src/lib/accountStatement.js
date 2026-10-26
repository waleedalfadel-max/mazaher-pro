import { isCounted } from './financeRules.js'
import { bankAccountLabel } from './branchSetup.js'

export const accountDashboard = settings => settings?.account_dashboard?.enabled === true ? settings.account_dashboard : null
export const cents = v => Math.round((Number(v) || 0) * 100)
export const accountHref = (account, to, from = '') => '/accounts?' + new URLSearchParams({ account, ...(from ? { from } : {}), ...(to ? { to } : {}) })
const order = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id))

export function accountOptions(banks, settings) {
  const cfg = accountDashboard(settings)
  return [{ value: 'cash', label: 'الصندوق' },
    { value: 'available-bank', label: cfg ? 'البنوك المتاحة — دون حساب العهدة' : 'البنوك المتاحة' },
    { value: 'available-custody', label: cfg ? 'حساب العهدة المتاح' : 'عهدة الموظفين' },
    { value: 'liquidity', label: 'الكاش الفعلي — البنوك المتاحة والصندوق والعهدة' },
    { value: 'bank', label: 'الحركات البنكية الدفترية — تشمل الحسابات المقيّدة' },
    ...(cfg ? [{ value: 'other-bank', label: 'حركات البنوك الدفترية دون حساب العهدة' }] : []),
    ...(banks || []).map(a => ({ value: `bank:${a.id}`, label: bankAccountLabel(a) + (a.is_active === false ? ' (موقوف)' : '') })),
    { value: 'bank:unassigned', label: 'حركات بنك بلا حساب محدد' },
    { value: 'custody', label: cfg ? 'عهدة موظفين سابقة (إن وجدت)' : 'العهدة' }]
}

const availableBank = (bank, settings) => bank && bank.is_active !== false && settings?.bank_workflow?.accounts?.[bank.id]?.operating_available !== false
const scopedBanks = settings => !!accountDashboard(settings) || !!settings?.bank_workflow?.accounts || settings?.bank_workflow?.version === 1

export function accountMovement(row, key, settings, banks = []) {
  const cfg = accountDashboard(settings)
  if (['available-bank', 'available-custody', 'liquidity'].includes(key)) {
    const bank = banks.find(a => a.id === row.bank_account_id)
    const held = cfg && bank?.id === cfg.custody_account_id
    const included = (availableBank(bank, settings) || !bank && !scopedBanks(settings)) && (key === 'liquidity' || (key === 'available-custody' ? held : !held))
    const staffCustody = !cfg && key !== 'available-bank'
    return { incoming: (included ? cents(row.bank_in) : 0) + (key === 'liquidity' ? cents(row.cash_in) : 0) + (staffCustody ? cents(row.custody_in) : 0), outgoing: (included ? cents(row.bank_out) : 0) + (key === 'liquidity' ? cents(row.cash_out) : 0) + (staffCustody ? cents(row.custody_out) : 0) }
  }
  if (key === 'cash' || key === 'custody') return { incoming: cents(row[`${key}_in`]), outgoing: cents(row[`${key}_out`]) }
  const match = key === 'bank' || (key === 'other-bank' && cfg && row.bank_account_id !== cfg.custody_account_id)
    || (key === 'bank:unassigned' && !row.bank_account_id) || key === `bank:${row.bank_account_id}`
  return match ? { incoming: cents(row.bank_in), outgoing: cents(row.bank_out) } : { incoming: 0, outgoing: 0 }
}

// Account statements and cards share integer-halalah arithmetic and approved/auto status rules.
// Search filters display rows only, never recomputes the running balance from a partial ledger.
export function buildAccountStatement(entries, key, { from = '', to = '', settings = {}, search = '', banks = [] } = {}) {
  let opening = 0, balance = 0, incoming = 0, outgoing = 0
  const rows = []
  for (const e of (entries || []).filter(isCounted).slice().sort(order)) {
    if (to && e.date > to) continue
    const m = accountMovement(e, key, settings, banks)
    if (!m.incoming && !m.outgoing) continue
    balance += m.incoming - m.outgoing
    if (from && e.date < from) { opening = balance; continue }
    incoming += m.incoming; outgoing += m.outgoing
    rows.push({ ...e, incoming: m.incoming / 100, outgoing: m.outgoing / 100, balance: balance / 100 })
  }
  const q = search.trim().toLocaleLowerCase()
  return { opening: opening / 100, closing: balance / 100, incoming: incoming / 100, outgoing: outgoing / 100,
    rows: q ? rows.filter(e => [e.description, e.type, e.journal_number, e.created_by_name, e.approved_by_name].join(' ').toLocaleLowerCase().includes(q)) : rows,
    movementCount: rows.length }
}

export function accountBalances(entries, to) {
  const out = { cash: 0, bank: 0, custody: 0, bankByAccount: {} }
  for (const e of entries || []) {
    if (!isCounted(e) || (to && e.date > to)) continue
    for (const k of ['cash', 'bank', 'custody']) out[k] += cents(e[k + '_in']) - cents(e[k + '_out'])
    const id = e.bank_account_id || ''
    out.bankByAccount[id] = (out.bankByAccount[id] || 0) + cents(e.bank_in) - cents(e.bank_out)
  }
  return { ...out, cash: out.cash / 100, bank: out.bank / 100, custody: out.custody / 100 }
}

export function runningAccountBalances(entries, banks, settings) {
  const sums = {cash:0, bank:0, custody:0, receivable:0}
  return (entries || []).slice().sort(order).map(row => {
    if (!isCounted(row)) return {...row,_cashBal:null,_bankBal:null,_custodyBal:null,_receivableBal:null}
    for (const [name,key] of [['cash','cash'],['bank','available-bank'],['custody','available-custody']]) {
      const m = accountMovement(row,key,settings,banks)
      sums[name] += m.incoming-m.outgoing
    }
    sums.receivable += cents(row.receivable_in)-cents(row.receivable_out)
    return {...row,...Object.fromEntries(Object.entries(sums).map(([name,value])=>[`_${name}Bal`,value/100]))}
  })
}

export function balanceCards(b, settings, banks = []) {
  return liquidityBreakdown(b, banks, settings).cards
}

// A documented closing balance is a separate business checkpoint, not a fabricated bank opening entry.
// Credits are only treated as repayments when the admin explicitly confirms an automatic bank sweep.
// No expenses, sales, bank rows or debt rows are created here.
export function liabilityFigures(entries, settings, to) {
  const cfg = accountDashboard(settings), rule = cfg?.liabilities
  const id = cfg?.liability_account_id
  const baselineKnown = rule && Number.isFinite(rule.balance) && rule.balance >= 0 && rule.date && (!to || rule.date <= to)
  const rows = (entries || []).filter(e => id && isCounted(e) && e.bank_account_id === id && (!to || e.date <= to) && (!baselineKnown || e.date > rule.date))
  const credits = rows.reduce((sum, e) => sum + cents(e.bank_in), 0)
  const confirmed = baselineKnown && rule.automatic_sweep === true
  const remaining = confirmed ? Math.max(0, cents(rule.balance) - credits) / 100 : baselineKnown ? rule.balance : null
  return { accountId: id, baseline: baselineKnown ? rule : null, directed: credits / 100, confirmed,
    remaining, signedRemaining: remaining == null ? null : remaining === 0 ? 0 : -remaining,
    excess: confirmed ? Math.max(0, credits - cents(rule.balance)) / 100 : 0 }
}

export function suppliersOutstanding(suppliers, transactions, ledger, to) {
  const byId = Object.fromEntries((suppliers || []).map(s => [s.id, cents(s.opening_balance)]))
  for (const t of transactions || []) {
    if (to && t.date > to) continue
    byId[t.supplier_id] = (byId[t.supplier_id] || 0) + (t.type === 'invoice' ? cents(t.amount) : t.type === 'payment' ? -cents(t.amount) : 0)
  }
  const payable = {}
  for (const e of ledger || []) if (isCounted(e) && (!to || e.date <= to) && e.supplier_id)
    payable[e.supplier_id] = (payable[e.supplier_id] || 0) + cents(e.payable_in) - cents(e.payable_out)
  return [...Object.values(byId), ...Object.values(payable)].reduce((s, c) => s + Math.max(0, c), 0) / 100
}

// Booked net liquidity: include overdrafts, count the purchasing bank once,
// and exclude restricted/inactive banks and movements without an account.
export function netLiquidity(balances, banks, settings) {
  return liquidityBreakdown(balances, banks, settings).total
}

// The home cards and their statements use the same account scope and signed balances.
// Restricted balances remain visible separately; they are not spendable cash.
export function liquidityBreakdown(balances, banks = [], settings = {}) {
  const cfg = accountDashboard(settings), known = new Set()
  let bank = 0, custody = cfg ? 0 : cents(balances.custody)
  const cash = cents(balances.cash), excluded = []
  for (const a of banks) {
    known.add(a.id)
    const value = balances.bankByAccount?.[a.id] || 0
    if (availableBank(a, settings)) {
      if (a.id === cfg?.custody_account_id) custody += value
      else bank += value
    } else if (value) excluded.push({ account: `bank:${a.id}`, label: a.name, value: value / 100, reason: a.is_active === false ? 'حساب موقوف' : settings?.bank_workflow?.accounts?.[a.id]?.purpose || 'غير متاح للتشغيل' })
  }
  const unknown = Object.entries(balances.bankByAccount || {}).filter(([id]) => !known.has(id)).reduce((s, [, v]) => s + v, 0)
  if (unknown && scopedBanks(settings)) excluded.push({ account: 'bank', label: 'حركات بلا حساب بنكي معروف', value: unknown / 100, reason: 'يلزم تحديد الحساب' })
  else bank += unknown
  return { bank: bank / 100, cash: cash / 100, custody: custody / 100, total: (bank + cash + custody) / 100, excluded,
    cards: [
      { label: 'رصيد البنوك المتاحة', value: bank / 100, account: 'available-bank', hint: cfg ? 'دون حساب العهدة والمبالغ المقيّدة' : 'بإشارتها؛ دون الحسابات المقيّدة والموقوفة' },
      { label: 'رصيد الصندوق', value: cash / 100, account: 'cash', hint: 'النقد المسجل في الدفتر' },
      { label: cfg ? 'رصيد حساب العهدة' : 'رصيد العهدة', value: custody / 100, account: 'available-custody', hint: 'ضمن الكاش الفعلي؛ السالب يُخصم' },
    ] }
}

// A single presentation contract for the dashboard, reports, exports and account drill-downs.
export const BALANCE_SCOPE = 'الأرصدة للمنشأة كاملة، من القيود المعتمدة والتلقائية حتى التاريخ المختار. الكاش الفعلي = البنوك المتاحة + الصندوق + العهدة بإشاراتها؛ السالب يُخصم. الحسابات المقيّدة والموقوفة خارج السيولة. لا يتصل هذا العرض بالبنك ولا ينشئ رصيدًا افتتاحيًا.'

export function balanceOverview(balances, banks = [], settings = {}, entries = [], to = '', from = '') {
  const liquidity = liquidityBreakdown(balances, banks, settings)
  const cfg = accountDashboard(settings), liability = liabilityFigures(entries, settings, to)
  const bankRows = banks.filter(a => availableBank(a, settings) && a.id !== cfg?.custody_account_id)
    .map(a => ({ label: bankAccountLabel(a), value: (balances.bankByAccount?.[a.id] || 0) / 100 }))
  if (!scopedBanks(settings)) {
    const known = new Set(banks.map(a => a.id))
    const unassigned = Object.entries(balances.bankByAccount || {}).filter(([id]) => !known.has(id)).reduce((s, [, v]) => s + v, 0)
    if (unassigned) bankRows.push({ label: 'حركات بنكية سابقة بلا حساب محدد', value: unassigned / 100 })
  }
  bankRows.push({ label: 'إجمالي البنوك المتاحة (دون العهدة)', value: liquidity.bank, strong: true })
  const excludedRows = liquidity.excluded.filter(e => e.account !== `bank:${liability.accountId}`)
    .map(e => ({ label: `${e.label} — حركة دفترية خارج السيولة (${e.reason})`, value: e.value }))
  const period = buildAccountStatement(entries, 'liquidity', { from, to, banks, settings })
  return { ...liquidity, bankRows, excludedRows, liability, period, scope: BALANCE_SCOPE }
}
