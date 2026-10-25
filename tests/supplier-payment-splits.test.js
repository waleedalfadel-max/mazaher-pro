import {test} from 'node:test'
import assert from 'node:assert/strict'
import {paymentSplitCheck,buildReceiptPayload,receiptBlockReason,normalizeReceiptReading} from '../src/lib/supplierReceipts.js'
import {accountBalances,netLiquidity} from '../src/lib/accountStatement.js'
const receipt={_id:'invoice',type:'supplier_payment',supplierKind:'list',supplierId:'supplier',amount:150,date:'2026-01-20',paySource:'bank',bankAccountId:'main',paymentMode:'new'}
const split={...receipt,splitPayment:true,paymentAllocations:[{bankAccountId:'main',amount:100},{bankAccountId:'purchases',amount:50}]}
test('single account remains default; toggling split off or linking never sends old allocations',()=>{
 for(const inv of [receipt,{...split,splitPayment:false}]){const p=buildReceiptPayload(inv);assert.equal(p.paymentAllocations,undefined);assert.equal(p.splitPayment,undefined);assert.equal(p.bankAccountId,'main')}
 const p=buildReceiptPayload({...split,paymentMode:'link',linkJournal:'jn'});assert.equal(p.paymentAllocations,undefined);assert.equal(p.paySource,undefined)
})
test('exact cents, Arabic amounts, different banks, positive amounts and matching total required',()=>{
 assert.equal(paymentSplitCheck(split).error,null)
 assert.equal(paymentSplitCheck({...split,paymentAllocations:[{bankAccountId:'main',amount:'١٠٠'},{bankAccountId:'purchases',amount:'٥٠'}]}).error,null)
 for(const parts of [[],[{amount:150}], [{bankAccountId:'main',amount:100},{bankAccountId:'main',amount:50}], [{bankAccountId:'main',amount:0},{bankAccountId:'purchases',amount:150}], [{bankAccountId:'main',amount:100.001},{bankAccountId:'purchases',amount:49.999}], [{bankAccountId:'main',amount:100},{bankAccountId:'purchases',amount:49.99}]])assert.ok(receiptBlockReason({...split,paymentAllocations:parts}))
})
test('approved payload and audit contain exact allocations; a changed allocation is visible',()=>{
 const out=buildReceiptPayload(split,{original:receipt});assert.deepEqual(out.paymentAllocations,split.paymentAllocations);assert.ok(out.review_changes.some(x=>x.includes('100')&&x.includes('main')))
 const changed=buildReceiptPayload({...split,paymentAllocations:[{bankAccountId:'main',amount:90},{bankAccountId:'purchases',amount:60}]},{original:split});assert.ok(changed.review_changes.some(x=>x.includes('90')))
})
test('OCR cannot activate split payments on behalf of the reviewer',()=>{
 const n=normalizeReceiptReading({...split,paymentEvidence:'Synthetic printed payment'});assert.equal(n.splitPayment,undefined);assert.equal(n.paymentAllocations,undefined)
})
test('liquidity is net counted operational banks plus cash, custody once, restricted and unknown excluded',()=>{
 const banks=[{id:'main'},{id:'purchases'},{id:'blocked'},{id:'closed',is_active:false}]
 const cfg={bank_workflow:{accounts:{blocked:{operating_available:false}}}}
 const rows=[{status:'approved',cash_in:20},{status:'auto',bank_account_id:'main',bank_in:100},{status:'approved',bank_account_id:'purchases',bank_out:30},{status:'approved',bank_account_id:'blocked',bank_in:1000},{status:'approved',bank_account_id:'closed',bank_in:300},{status:'pending',bank_account_id:'main',bank_in:999},{status:'approved',bank_in:500}]
 assert.equal(netLiquidity(accountBalances(rows),banks,cfg),90)
})
