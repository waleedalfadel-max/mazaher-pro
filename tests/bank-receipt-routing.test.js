import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBankIdentifier, receiptAccountMatch } from '../src/lib/bankReceiptRouting.js'
import { suggestInvoicePayment, reviewedPayment, documentPaymentChoices } from '../src/lib/paymentWorkflow.js'
const accounts = [{id:'main', name:'Main'}, {id:'purchases',name:'Purchases'}, {id:'inactive',name:'Inactive',is_active:false}]
const main='123456789012345', purchases='987654321098765', detailed='123000010001234567890'
const settings={bank_workflow:{version:1,uploaders:{purchasing:{source:'bank',account_id:'purchases'}},accounts:{main:{receipt_identifiers:[main,detailed]},purchases:{receipt_identifiers:[purchases]},inactive:{receipt_identifiers:['111111111111111']}}}}
const evidence=(source=main,dest='777777777777777')=>({kind:'bank_receipt',fromAccount:{label:'من حساب',number:source},toAccount:{label:'إلى حساب',number:dest}})
const inv={_id:'I',type:'expense',paySource:'bank',totalAmount:90,items:[{description:'Expense',amount:90}],bankReceipt:evidence()}
const doc={uploaded_by:'purchasing'}
const suggest=(i=inv,s=settings,a=accounts,saved=null)=>suggestInvoicePayment(i,doc,s,a,saved)
test('complete printed account overrides uploader while an ordinary invoice still uses uploader',()=>{
 assert.equal(suggest().bankAccountId,'main')
 assert.equal(suggest({...inv,bankReceipt:null}).bankAccountId,'purchases')
 assert.equal(suggest({...inv,paySource:'credit'}).paySource,'credit')
})
test('two registered endpoints create one directional internal transfer regardless of uploader',()=>{
 const out=suggest({...inv,bankReceipt:evidence(main,purchases)})
 assert.equal(out.type,'transfer');assert.deepEqual(out.internalTransfer,{from:'bank:main',to:'bank:purchases'})
 assert.equal(out.amount,90)
})
test('external bank transfer becomes a reviewable expense with no invented category',()=>{
 const out=suggest({...inv,type:'transfer',transType:'🔄 تحويل داخلي — بين الحسابات البنكية',amount:90})
 assert.equal(out.type,'expense');assert.equal(out.bankAccountId,'main');assert.equal(out.items[0].category_main,'')
})
test('missing, masked, duplicated, inactive and other-company identifiers never fall back to uploader',()=>{
 for(const source of [null,'***12345','111111111111111','555555555555555'])assert.equal(suggest({...inv,bankReceipt:evidence(source)}).bankAccountId,'')
 const duplicate=structuredClone(settings);duplicate.bank_workflow.accounts.purchases.receipt_identifiers.push(main)
 assert.equal(suggest(inv,duplicate).bankAccountId,'')
 assert.equal(suggest(inv,{bank_workflow:{version:1,accounts:{}}}).bankAccountId,'')
 assert.equal(suggest(inv,settings,[accounts[1]]).bankAccountId,'')
})
test('reviewer choices and saved cleared choices survive subsequent suggestions',()=>{
 const edited=reviewedPayment(suggest(),{bankAccountId:'purchases'})
 assert.equal(suggest(edited).bankAccountId,'purchases')
 const saved=documentPaymentChoices({invoices:[reviewedPayment(edited,{bankAccountId:''})]}).I
 assert.equal(suggest(inv,settings,accounts,saved).bankAccountId,'')
})
test('only a full registered reference prefix with exact date matches Al Rajhi source',()=>{
 const receipt={kind:'bank_receipt',bankName:'مصرف الراجحي',date:'2026-01-02',reference:detailed+'20260102'+'9000001'}
 assert.equal(receiptAccountMatch(receipt,settings,accounts).from.id,'main')
 for(const patch of [{bankName:'Other bank'},{date:'2026-01-03'},{reference:'9'+receipt.reference},{fromAccount:{label:'من',number:'555555555555555'}}])assert.equal(receiptAccountMatch({...receipt,...patch},settings,accounts).from,null)
})
test('same-account receipt cannot generate an internal transfer to itself; Arabic digits normalize',()=>{
 assert.equal(suggest({...inv,bankReceipt:evidence(main,main)}).type,'expense')
 assert.equal(normalizeBankIdentifier('١٢٣٤٥٦٧٨٩٠١٢٣٤٥'),main)
 assert.equal(normalizeBankIdentifier('***2345'),'')
})
