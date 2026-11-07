import test from 'node:test'
import assert from 'node:assert/strict'
import { CASH_DEPOSIT, CASH_WITHDRAWAL, cashBankMovement } from '../src/lib/cashBankTransfer.js'
import { buildLedgerInsertRow } from '../src/lib/bankReconciliation.js'
import { bankTransferPayment, reviewedPayment } from '../src/lib/paymentWorkflow.js'
import { buildAccountStatement } from '../src/lib/accountStatement.js'
import { summarizeEntries } from '../src/lib/financeSummary.js'
test('cash and bank directions match the two statements without classifying a transfer as income or expense', () => {
  const rows = [[CASH_DEPOSIT,'in',125.4], [CASH_WITHDRAWAL,'out',40.15]].map(([type,direction,amount]) => {
    const row = buildLedgerInsertRow({direction,amount,date:'2026-11-04'}, {transType:type,projectId:'p'})
    assert.equal(row.bank_in || row.bank_out, amount)
    assert.equal(row.cash_out || row.cash_in, amount)
    assert.throws(() => buildLedgerInsertRow({direction:direction==='in'?'out':'in',amount}, {transType:type}))
    return {...row,bank_account_id:'b'}
  })
  assert.equal(buildAccountStatement(rows,'cash').closing,-85.25)
  assert.equal(buildAccountStatement(rows,'bank:b').closing,85.25)
  const summary=summarizeEntries(rows)
  assert.equal(summary.totalSales,0)
  assert.equal(summary.totalExpenses,0)
  assert.equal(summary.netProfit,0)
  assert.equal(summary.vatNetBeforePayment,0)
})
test('a reviewed cash transfer derives its source from the direction and keeps the chosen bank', () => {
  const row={type:'transfer',transType:CASH_DEPOSIT,bankAccountId:'b',paySource:'custody'}
  assert.equal(bankTransferPayment(row).paySource,'cash')
  assert.deepEqual(reviewedPayment(row,{transType:CASH_WITHDRAWAL}),{...row,transType:'🔄 تحويل داخلي',bankAccountId:null,internalTransfer:{from:'bank:b',to:'cash'},paySource:'bank',_paymentInitialized:true,_paymentSuggested:false})
  assert.equal(cashBankMovement(CASH_WITHDRAWAL,10).cash_in,10)
})
