import {isExcluded,isSales} from '../src/lib/financeRules.js'
import {reportModel} from '../src/lib/reportExport.js'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {suggestInvoicePayment,suggestDocumentPayments,reviewedPayment,documentPaymentChoices,operatingBankFigures,operatingBankRows,paymentBranch,BANK_TRANSFER_TYPE} from '../src/lib/paymentWorkflow.js'
import {saveDraft,loadDraft} from '../src/lib/reviewDraft.js'
import {buildInvoicePayload,reviewChanges} from '../src/lib/approvalV2.js'
const accounts=[{id:'main',name:'Primary',branches:['North']},{id:'purchase',name:'Purchases',branches:[]},{id:'restricted',name:'Restricted',branches:['South']},{id:'old',name:'Closed',is_active:false}]
const settings={expenses_scope:'project',bank_workflow:{version:1,uploaders:{owner:{source:'bank',account_id:'main'},purchasing:{source:'bank',account_id:'purchase'},cashier:{source:'cash'}},network_by_branch:{North:'main',South:'restricted'},apps_collection_account:'restricted',accounts:{restricted:{operating_available:false,purpose:'Existing obligations'}}}}
const expense={_id:'one',type:'expense',paySource:'custody',amount:'12.50'}
const propose=(role,inv=expense,extra={})=>suggestInvoicePayment(inv,{created_by_role:role,branch:'North',...extra},settings,accounts)
test('uploader identity determines suggestion, regardless of approver or old role label',()=>{
 assert.equal(propose('owner',expense,{uploaded_by:'purchasing',approved_by_role:'accountant'}).bankAccountId,'main')
 assert.equal(propose('purchasing').bankAccountId,'purchase');assert.equal(propose('cashier').paySource,'cash')
 assert.equal(propose('accountant').paySource,'custody')
 assert.equal(suggestInvoicePayment(expense,{uploaded_by:'owner'},settings,accounts).bankAccountId,'main')
})
test('no policy, stale default, credit, receipts linked to existing payments are not reassigned',()=>{
 assert.equal(suggestInvoicePayment(expense,{}, {},accounts),expense)
 for(const paySource of ['credit','payable'])assert.equal(propose('owner',{...expense,paySource}).paySource,paySource)
 assert.equal(propose('owner',{type:'supplier_payment',paymentMode:'link',bankAccountId:'purchase'}).bankAccountId,'purchase')
 assert.equal(suggestInvoicePayment(expense,{uploaded_by:'owner'},settings,accounts.filter(a=>a.id!=='main')).paySource,'custody')
 assert.equal(propose('owner',{type:'supplier_payment',paymentMode:'new'}).bankAccountId,'main')
})
test('manual choice and deliberately cleared field survive browser draft reload',()=>{
 const edited=reviewedPayment(propose('owner'),{bankAccountId:'purchase'})
 const doc={id:'doc',status:'analyzed',analysis_result:expense},scope={projectId:'p',userId:'u'}
 const m=new Map(),storage={getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}
 assert(saveDraft(storage,scope,doc,edited));const restored=loadDraft(storage,scope,doc).edit
 assert.equal(propose('owner',restored).bankAccountId,'purchase')
 const clear=reviewedPayment(restored,{bankAccountId:''});assert.equal(propose('owner',clear).bankAccountId,'')
 const cash=reviewedPayment(restored,{paySource:'cash'});assert.equal(cash.bankAccountId,'');assert.equal(propose('owner',cash).paySource,'cash')
})
test('multi-invoice defaults remain independent and confirmed choices are the actual payload',()=>{
 const r=suggestDocumentPayments({invoices:[expense,{...expense,_id:'two',paySource:'credit'}]},{uploaded_by:'owner'},settings,accounts)
 r.invoices[0]=reviewedPayment(r.invoices[0],{bankAccountId:'purchase'})
 const p=buildInvoicePayload(r.invoices[0],{categories:[],transTypes:[],original:expense})
 assert.equal(p.bankAccountId,'purchase');assert.equal(p._paymentSuggested,undefined);assert.equal(r.invoices[1].paySource,'credit')
 assert.equal(documentPaymentChoices(r).one.bankAccountId,'purchase')
})
test('network defaults are by branch; existing channel accounts always win',()=>{
 assert.equal(propose('owner',{type:'sales',networkSales:40}).bankAccounts.network,'main')
 assert.equal(propose('owner',{type:'sales',networkSales:40,bankAccounts:{network:'purchase'}}).bankAccounts.network,'purchase')
 assert.equal(propose('cashier',{type:'sales',networkSales:40},{branch:'South'}).bankAccounts.network,'restricted')
})
test('app receipts settle receivables across company branches; other transfers never use uploader defaults',()=>{
 const app={type:'transfer',transType:'📥 تحصيل ذمم هنقر',amount:50}
 assert.equal(propose('owner',app).bankAccountId,'restricted');assert.equal(paymentBranch({branch:'North'},app,settings),null)
 for(const transType of ['تحصيل ذمم عميل','صرف عهدة',BANK_TRANSFER_TYPE])assert.equal(propose('owner',{type:'transfer',transType}).bankAccountId,undefined)
})
test('liquidity retains signed restricted balances, excludes them and inactive/unassigned funds from available',()=>{
 const f=operatingBankFigures(accounts,{main:10000,purchase:2500,restricted:-50000,old:3000,'':4000},settings)
 assert.equal(f.available,125);assert.equal(f.restricted,-470);assert.equal(f.overdrafts,-500);assert.equal(f.unassigned,40)
 assert.equal(operatingBankRows(accounts,{restricted:60000},settings)[0].value,0)
 assert.equal(operatingBankFigures(accounts,{},{}),null)
})
test('internal transfer payload preserves both accounts even on an old expense-classified document',()=>{
 const inv=reviewedPayment({...expense,type:'transfer'},{transType:BANK_TRANSFER_TYPE,bankTransfer:{from:'main',to:'purchase'}})
 const p=buildInvoicePayload(inv,{categories:[],transTypes:[],purchaseCategory:'Old expense',original:expense})
 assert.equal(p.transType,BANK_TRANSFER_TYPE);assert.equal(p.paySource,'bank');assert.deepEqual(p.bankTransfer,{from:'main',to:'purchase'})
})

test('audit records changes to each nested bank choice, not an opaque object string',()=>{
 const changes=reviewChanges({bankTransfer:{from:'a',to:'b'}},{bankTransfer:{from:'a',to:'c'}})
 assert.equal(changes.length,1);assert(changes[0].includes('"to":"c"'));assert(!changes[0].includes('[object Object]'))
})

test('internal transfer is excluded from revenue and expense classification',()=>{assert.equal(isExcluded(BANK_TRANSFER_TYPE),true);assert.equal(isSales(BANK_TRANSFER_TYPE),false)})
test('export uses exactly the operating figures shown on the balance screen',()=>{
 const by={main:10000,purchase:2500,restricted:-50000}
 const model=reportModel({tab:'balance',from:'2026-10-01',to:'2026-10-21',branch:'all',branches:[],generatedAt:new Date('2026-10-21T00:00:00Z'),balances:{cash:0,bank:-375,custody:0,bankByAccount:by},data:{totalIn:0,totalOut:0},bankAccounts:accounts,projectSettings:settings})
 assert.deepEqual(model.blocks.find(b=>b.id==='balance.operating').rows,operatingBankRows(accounts,by,settings))
 assert.equal(model.blocks.find(b=>b.id==='balance.cards').items.find(i=>i.key==='balance.bank').value,-375)
})
