import { isCounted } from './financeRules.js'
import { bankAccountLabel } from './branchSetup.js'

export const accountDashboard = settings => settings?.account_dashboard?.enabled === true ? settings.account_dashboard : null
export const cents = v => Math.round((Number(v) || 0) * 100)
export const accountHref = (account, to, from = '') => '/accounts?' + new URLSearchParams({ account, ...(from ? { from } : {}), ...(to ? { to } : {}) })
const order = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id))

export function accountOptions(banks, settings) {
  const cfg = accountDashboard(settings)
  return [{ value: 'cash', label: 'الصندوق' }, { value: 'bank', label: cfg ? 'جميع الحسابات البنكية (يشمل حساب العهدة)' : 'جميع الحسابات البنكية' },
    ...(cfg ? [{ value: 'available-bank', label: 'البنوك المتاحة — دون حساب العهدة' }, { value: 'available-custody', label: 'حساب العهدة المتاح' }, { value: 'liquidity', label: 'الكاش الفعلي — البنوك المتاحة والصندوق وحساب العهدة' }, { value: 'other-bank', label: 'البنوك الأخرى — دون حساب العهدة' }] : []),
    ...(banks || []).map(a => ({ value: `bank:${a.id}`, label: bankAccountLabel(a) + (a.is_active === false ? ' (موقوف)' : '') })),
    { value: 'bank:unassigned', label: 'حركات بنك بلا حساب محدد' },
    { value: 'custody', label: cfg ? 'عهدة موظفين سابقة (إن وجدت)' : 'العهدة' }]
}

const availableBank = (bank, settings) => bank && bank.is_active !== false && settings?.bank_workflow?.accounts?.[bank.id]?.operating_available !== false

export function accountMovement(row, key, settings, banks = []) {
  const cfg = accountDashboard(settings)
  if (['available-bank', 'available-custody', 'liquidity'].includes(key)) {
    const bank = banks.find(a => a.id === row.bank_account_id)
    const held = cfg && bank?.id === cfg.custody_account_id
    const included = availableBank(bank, settings) && (key === 'liquidity' || (key === 'available-custody' ? held : !held))
    return { incoming: (included ? cents(row.bank_in) : 0) + (key === 'liquidity' ? cents(row.cash_in) : 0), outgoing: (included ? cents(row.bank_out) : 0) + (key === 'liquidity' ? cents(row.cash_out) : 0) }
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

export function balanceCards(b, settings) {
  const cfg = accountDashboard(settings)
  const held = cfg ? (b.bankByAccount?.[cfg.custody_account_id] || 0) / 100 : b.custody
  return [
    { label: 'رصيد البنك', value: cfg ? (cents(b.bank) - cents(held)) / 100 : b.bank, account: cfg ? 'other-bank' : 'bank', hint: cfg ? 'البنوك الأخرى؛ لا يشمل حساب العهدة' : 'جميع الحسابات البنكية' },
    { label: 'رصيد الصندوق', value: b.cash, account: 'cash', hint: 'النقد المسجل في الدفتر' },
    { label: cfg ? 'رصيد حساب العهدة' : 'رصيد العهدة', value: held, account: cfg ? `bank:${cfg.custody_account_id}` : 'custody', hint: cfg ? 'حساب المشتريات البنكي نفسه' : 'عهدة الموظفين' },
  ]
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
  let bank = 0, custody = 0
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
  if (unknown) excluded.push({ account: 'bank', label: 'حركات بلا حساب بنكي معروف', value: unknown / 100, reason: 'يلزم تحديد الحساب' })
  return { bank: bank / 100, cash: cash / 100, custody: custody / 100, total: (bank + cash + custody) / 100, excluded,
    cards: [
      { label: 'رصيد البنوك المتاحة', value: bank / 100, account: 'available-bank', hint: 'دون حساب العهدة والمبالغ المقيّدة' },
      { label: 'رصيد الصندوق', value: cash / 100, account: 'cash', hint: 'النقد المسجل في الدفتر' },
      { label: 'رصيد حساب العهدة', value: custody / 100, account: 'available-custody', hint: 'ضمن الكاش الفعلي؛ السالب يُخصم' },
    ] }
}
