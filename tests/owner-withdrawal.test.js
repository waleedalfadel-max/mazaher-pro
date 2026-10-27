import {test} from 'node:test'
import assert from 'node:assert/strict'
import {toOwnerWithdrawal,fromOwnerWithdrawal,withdrawalBlockReason,withdrawalTypes} from '../src/lib/ownerWithdrawal.js'
import {reviewDocumentType} from '../src/lib/loanRepayment.js'
import {buildInvoicePayload} from '../src/lib/approvalV2.js'
import {isRealExpense} from '../src/lib/financeRules.js'
const types=['مصروفات تشغيلية','💼 مسحوبات مالك تجريبي','💳 قرض ١']
const original={_id:'a',type:'expense',totalAmount:120,amount:20,vatAmount:0,paySource:'bank',bankAccountId:'b',transType:types[0],supplier_id:'supplier',items:[{amount:120,category_main:'expenses'}]}
const make=()=>({...toOwnerWithdrawal(original),transType:types[1]})
const payload=inv=>buildInvoicePayload(inv,{original,categories:[],transTypes:types,purchaseCategory:types[0],supplierId:'supplier'})
test('owner withdrawals retain document identity and amount; clear expense and supplier selections',()=>{
 const copy=structuredClone(original),n=toOwnerWithdrawal(original)
 assert.equal(reviewDocumentType(n),'owner_withdrawal');assert.equal(n._id,'a');assert.equal(n.amount,120);assert.equal(n.bankAccountId,'b');assert.deepEqual(n.items,[]);assert.equal(n.supplier_id,undefined);assert.equal(n.transType,'');assert.deepEqual(original,copy)
 assert.deepEqual(withdrawalTypes(types),[types[1]])
})
test('visible total and configured withdrawal reach ledger payload despite old expense category',()=>{
 const p=payload({...make(),totalAmount:'١٢٣٫٥٠'})
 assert.equal(p.transType,types[1]);assert.equal(p.amount,'123.50');assert.equal(p.totalAmount,'123.50');assert.equal(p.vatAmount,0);assert.equal(p.category_id,null);assert.equal(p.supplier_id,undefined);assert.deepEqual(p.items,[]);assert.equal(isRealExpense({type:p.transType}),false)
})
test('missing owner, invalid source/amount or read VAT cannot silently pass',()=>{
 for(const patch of [{transType:''},{transType:types[0]},{transType:'unknown'},{paySource:'credit'},{paySource:'custody'},{totalAmount:0},{totalAmount:-1},{totalAmount:'2.001'},{vatAmount:5}]){
 assert.ok(withdrawalBlockReason({...make(),...patch},types));assert.throws(()=>payload({...make(),...patch}))
 }
 assert.equal(withdrawalBlockReason(make(),types),null)
})
test('switching back requires fresh expense classification and removes withdrawal purpose',()=>{
 const n=fromOwnerWithdrawal(make(),'expense');assert.equal(n.transferPurpose,undefined);assert.equal(n.transType,'');assert.equal(n.items[0].category_main,'');assert.equal(n.items[0].amount,120)
})
