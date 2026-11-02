import test from 'node:test'
import assert from 'node:assert/strict'
import { BALANCE_START_TYPE, isExcluded, isRealExpense } from '../src/lib/financeRules.js'
import { summarizeEntries } from '../src/lib/financeSummary.js'
import { accountBalances, buildAccountStatement, balanceOverview, runningAccountBalances } from '../src/lib/accountStatement.js'
import { windowFigures } from '../src/lib/financialAnalysis.js'
import { expenseFigures } from '../src/lib/reportFigures.js'
import { reportModel } from '../src/lib/reportExport.js'

// All figures and identities are synthetic; no customer balances belong in this repository.
const from = '2026-10-01', date = '2026-11-02'
const banks = [{ id: 'main', name: 'Main' }, { id: 'held', name: 'Custody' }, { id: 'debt', name: 'Restricted' }]
const settings = {
  account_dashboard: { enabled: true, custody_account_id: 'held', liability_account_id: 'debt',
    liabilities: { balance: 900, date: '2026-10-01', reference: 'Synthetic instruction', automatic_sweep: true } },
  bank_workflow: { version: 1, accounts: { debt: { operating_available: false } } },
}
const row = (id, extra = {}) => ({ id, date, status: 'approved', cash_in: 0, cash_out: 0, bank_in: 0, bank_out: 0,
  custody_in: 0, custody_out: 0, receivable_in: 0, receivable_out: 0, payable_in: 0, payable_out: 0,
  vat_amount: 0, total_amount: 0, ...extra })
const history = [
  row('sales', { date: from, type: 'مبيعات شبكة', bank_account_id: 'main', bank_in: 1150 }),
  row('expense', { date: from, type: 'مصروفات تشغيلية', cash_out: 230, vat_amount: 30, total_amount: 230 }),
  row('held', { date: from, type: 'تحويل داخلي', bank_account_id: 'held', bank_in: 20 }),
  row('app-payment', { type: 'تحصيل ذمم هنقر', bank_account_id: 'debt', bank_in: 100, receivable_out: 100 }),
]
const adjustments = [
  row('start-bank', { type: BALANCE_START_TYPE, description: 'Documented balance; no actual receipt', bank_account_id: 'main', bank_in: 350, total_amount: 350 }),
  row('start-cash', { type: BALANCE_START_TYPE, description: 'Documented cash count; no actual receipt', cash_in: 330, total_amount: 330 }),
]
const pnl = s => Object.fromEntries(['grossSales', 'totalSales', 'totalExpenses', 'grossExpenses', 'cogs', 'operatingExpenses', 'netProfit',
  'inputVat', 'outputVat', 'vatNetBeforePayment', 'totalWithdrawals', 'totalDebts', 'receivableBalance', 'payableBalance'].map(k => [k, s[k]]))

test('an approved balance-start adjustment changes bank/cash balances without creating sales, costs, VAT, debt or receivables', () => {
  assert.equal(isExcluded(BALANCE_START_TYPE), true)
  assert.equal(isRealExpense(adjustments[0]), false)
  const before = summarizeEntries(history), after = summarizeEntries([...history, ...adjustments])
  assert.deepEqual(pnl(after), pnl(before))
  assert.equal(Math.round(after.cashBalance * 100), 10000)
  assert.equal(Math.round(after.bankBalance * 100), 162000)
  assert.equal(after.entries.some(e => e.type === BALANCE_START_TYPE), false)
  const window = { from, to: date }
  const oldAnalysis = windowFigures(history, window), newAnalysis = windowFigures([...history, ...adjustments], window)
  for (const k of ['salesGrossH', 'salesNetH', 'costsH', 'cogsH', 'resultH', 'withdrawalsH', 'debtsH', 'taxOutH'])
    assert.equal(newAnalysis[k], oldAnalysis[k], k)
  assert.deepEqual(newAnalysis.mains, oldAnalysis.mains)
  const oldPurchases = expenseFigures({ entries: history, docItems: [], engineSummary: before })
  const newPurchases = expenseFigures({ entries: [...history, ...adjustments], docItems: [], engineSummary: after })
  assert.deepEqual(newPurchases, oldPurchases)
})

test('cash and bank cards, account statements, running ledger and export share the corrected balances', () => {
  const entries = [...history, ...adjustments]
  const b = accountBalances(entries, date), view = balanceOverview(b, banks, settings, entries, date, from)
  assert.deepEqual([view.bank, view.cash, view.custody, view.total], [1500, 100, 20, 1620])
  assert.equal(view.liability.signedRemaining, -800)
  for (const c of view.cards) assert.equal(buildAccountStatement(entries, c.account, { from, to: date, settings, banks }).closing, c.value)
  assert.equal(buildAccountStatement(entries, 'bank:main', { to: date, settings, banks }).closing, 1500)
  assert.equal(buildAccountStatement(entries, 'cash', { to: date, settings, banks }).closing, 100)
  const last = runningAccountBalances(entries, banks, settings).at(-1)
  assert.deepEqual([last._bankBal, last._cashBal, last._custodyBal], [1500, 100, 20])
  const model = reportModel({ tab: 'balance', from, to: date, balances: { ...b, entries }, bankAccounts: banks, projectSettings: settings })
  assert.deepEqual(model.blocks.find(b => b.id === 'balance.cards').items.map(c => c.value), [1500, 100, 20])
  assert.equal(model.blocks.find(b => b.id === 'balance.liquidity').rows.at(-1).value, 1620)
})

test('historical balances stay unchanged; future receipts and payments move the new starting balance normally', () => {
  const entries = [...history, ...adjustments]
  assert.deepEqual(accountBalances(entries, '2026-11-01'), accountBalances(history, '2026-11-01'))
  const later = [...entries,
    row('new-sale', { date: '2026-11-03', type: 'مبيعات شبكة', bank_account_id: 'main', bank_in: 230 }),
    row('new-payment', { date: '2026-11-03', type: 'مصروفات تشغيلية', cash_out: 40 }),
  ]
  assert.equal(buildAccountStatement(later, 'bank:main', { from: '2026-11-03', to: '2026-11-03', settings, banks }).opening, 1500)
  assert.equal(buildAccountStatement(later, 'bank:main', { to: '2026-11-03', settings, banks }).closing, 1730)
  assert.equal(buildAccountStatement(later, 'cash', { to: '2026-11-03', settings, banks }).closing, 60)
})

test('decreasing a starting balance is not an expense; unapproved adjustments do not affect balances', () => {
  const decrease = row('decrease', { type: BALANCE_START_TYPE, bank_account_id: 'main', bank_out: 100, total_amount: 100 })
  assert.deepEqual(pnl(summarizeEntries([...history, decrease])), pnl(summarizeEntries(history)))
  assert.equal(buildAccountStatement([...history, decrease], 'bank:main', { to: date, settings, banks }).closing, 1050)
  for (const status of ['pending', 'rejected', null]) {
    const rows = [...history, ...adjustments.map(e => ({ ...e, status }))]
    assert.deepEqual(accountBalances(rows), accountBalances(history))
  }
})
