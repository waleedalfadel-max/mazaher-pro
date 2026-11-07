import test from 'node:test'
import assert from 'node:assert/strict'
import { INTERNAL_TRANSFER_TYPE as TYPE, isInternalTransferType, internalTransferTypes, internalTransferAccounts, normalizeInternalTransfer, internalTransferError } from '../src/lib/internalTransfer.js'
import { buildInvoicePayload } from '../src/lib/approvalV2.js'
import { suggestInvoicePayment, reviewedPayment, paymentChoice } from '../src/lib/paymentWorkflow.js'
import { isExcluded, isSales } from '../src/lib/financeRules.js'
const banks=[{id:'a',name:'Main',branches:['North']},{id:'b',name:'Purchasing',branches:['South']},{id:'closed',is_active:false}]
const settings={account_dashboard:{enabled:true},statement_accounts:[{value:'cash',label:'الصندوق'},{value:'bank:a',label:'الراجحي الرئيسي'},{value:'bank:b',label:'حساب المشتريات'}]}
test('only internal classifications collapse; collections, withdrawals and suspense resolutions remain separate',()=>{
 const types=internalTransferTypes(['صرف عهدة','🔄 تحويل داخلي — صرف عهدة','🏧 تحويل داخلي — إيداع نقدي','🏧 تحويل داخلي — سحب نقدي','🔄 تحويل داخلي — بين الحسابات البنكية','📥 تحصيل ذمم جاهز','مسحوبات الشركاء'])
 assert.equal(types.filter(isInternalTransferType).length,1)
 for(const type of ['📥 تحصيل ذمم جاهز','مسحوبات الشركاء','سداد مورد','تحويل داخلي — معالجة فرق'])assert.equal(isInternalTransferType(type),false)
 assert.equal(isExcluded(TYPE),true);assert.equal(isSales(TYPE),false)
})
test('company account options use business labels, cross branches, omit stopped accounts and duplicate custody',()=>{
 assert.deepEqual(internalTransferAccounts(banks,settings),settings.statement_accounts)
 assert.equal(internalTransferError({type:'transfer',transType:TYPE,internalTransfer:{from:'bank:a',to:'bank:b'}},banks,settings),'')
 assert.ok(internalTransferError({type:'transfer',transType:TYPE,internalTransfer:{from:'bank:a',to:'bank:a'}}))
 assert.ok(internalTransferError({type:'transfer',transType:TYPE,internalTransfer:{from:'cash',to:'custody'}},banks,settings))
})
test('old custody/cash/bank directions normalize without inventing a missing bank; reviewer pair survives draft',()=>{
 assert.deepEqual(normalizeInternalTransfer({type:'transfer',transType:'صرف عهدة',paySource:'bank',bankAccountId:'a'}).internalTransfer,{from:'bank:a',to:'custody'})
 assert.deepEqual(normalizeInternalTransfer({type:'transfer',transType:'🏧 تحويل داخلي — سحب نقدي'}).internalTransfer,{from:'',to:'cash'})
 let inv=reviewedPayment({type:'transfer',transType:TYPE,amount:5},{internalTransfer:{from:'bank:a',to:'bank:b'}})
 const saved=paymentChoice(inv)
 assert.deepEqual(suggestInvoicePayment(inv,{},settings,banks,saved).internalTransfer,inv.internalTransfer)
 inv=reviewedPayment(inv,{internalTransfer:{from:'cash',to:''}})
 assert.equal(suggestInvoicePayment(inv,{},settings,banks,paymentChoice(inv)).internalTransfer.to,'')
})
test('visible transfer amount is authoritative; stale tax/items/category do not create a purchase',()=>{
 const inv={type:'transfer',transType:TYPE,internalTransfer:{from:'cash',to:'bank:a'},amount:1,totalAmount:'115.50',vatAmount:15,items:[{amount:1}],category_main:'Old expense'}
 const payload=buildInvoicePayload(inv,{categories:[],transTypes:[],purchaseCategory:'Old expense'})
 assert.equal(payload.amount,'115.50');assert.equal(payload.totalAmount,'115.50');assert.equal(payload.vatAmount,0);assert.deepEqual(payload.items,[]);assert.equal(payload.category_main,null)
 for(const amount of ['',0,-1,'1.001','NaN'])assert.throws(()=>buildInvoicePayload({...inv,totalAmount:amount},{categories:[],transTypes:[]}))
 assert.equal(inv.amount,1);assert.equal(inv.vatAmount,15)
})
