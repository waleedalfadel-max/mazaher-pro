import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toLoanRepayment, fromLoanRepayment, isLoanRepayment, reviewDocumentType, loanTypes, loanBlockReason } from '../src/lib/loanRepayment.js'
import { buildInvoicePayload } from '../src/lib/approvalV2.js'
import { manualInvoice } from '../src/lib/manualReview.js'
import { isRealExpense } from '../src/lib/financeRules.js'

const types = ['🛒 مصروفات تشغيلية', '💳 قرض ١', '💳 قرض ٢', '💳 قسط سيارة', '💳 قسط شراء أرض', '🔄 تحويل داخلي — صرف عهدة']
const original = { _id:'one',type:'expense',description:'Synthetic finance instalment',date:'2026-01-01',invoiceNumber:'TEST-LOAN',
  amount:200,totalAmount:250,vatAmount:0,transType:types[0],category_id:'expense',category_main:'Expense',supplier_id:'supplier',
  paySource:'bank',bankAccountId:'account-a',items:[{description:'Instalment',amount:250}] }
const loan = () => ({...toLoanRepayment(original),transType:types[1]})
const payload = inv => buildInvoicePayload(inv,{original,categories:[],transTypes:types,purchaseCategory:types[0],supplierId:'supplier'})

test('conversion keeps identity, date, visible amount and bank, clears expense and supplier choices without mutating the reading',()=>{
  const before=structuredClone(original),next=toLoanRepayment(original)
  assert.equal(next.type,'transfer');assert.equal(reviewDocumentType(next),'loan_repayment')
  for(const key of ['_id','date','invoiceNumber','description','paySource','bankAccountId'])assert.equal(next[key],original[key])
  assert.equal(next.amount,250);assert.equal(next.totalAmount,250);assert.equal(next.transType,'')
  assert.deepEqual(next.items,[]);assert.equal(next.category_id,undefined);assert.equal(next.supplier_id,undefined)
  assert.deepEqual(original,before)
})
test('only configured debt types are offered; no implicit loan or credit/custody debt is selected',()=>{
  assert.deepEqual(loanTypes(types),types.slice(1,5));assert.deepEqual(loanTypes([]),[])
  assert.ok(loanBlockReason(toLoanRepayment(original),types))
  assert.equal(toLoanRepayment({...original,paySource:'credit'}).paySource,'')
  for(const patch of [{transType:'unconfigured'},{transType:types[0]},{paySource:'credit'},{paySource:'payable'},
    {paySource:''},{totalAmount:0},{totalAmount:-1},{totalAmount:'broken'},{totalAmount:'1.001'},
    {vatAmount:5},{vatAmount:-1},{vatAmount:'broken'}]) {
    assert.ok(loanBlockReason({...loan(),...patch},types))
    assert.throws(()=>payload({...loan(),...patch}))
  }
})
test('visible amount and selected loan survive stale expense purchaseCategory and stale amount',()=>{
  const next=payload({...loan(),amount:12,totalAmount:'٣١٢٫٥٠'})
  assert.equal(next.transType,types[1]);assert.equal(next.amount,'312.50');assert.equal(next.totalAmount,'312.50')
  assert.equal(next.vatAmount,0);assert.equal(next.category_id,null);assert.equal(next.supplier_id,undefined)
  assert.deepEqual(next.items,[]);assert.ok(next.review_changes.some(s=>s.includes('نوع المستند')))
  assert.ok(next.review_changes.some(s=>s.includes('التصنيف الأساسي')))
  for(const type of loanTypes(types))assert.equal(isRealExpense({type}),false)
})
test('all real payment sources allowed, missing/stale configured loan blocked, existing debt transfers displayed as loans',()=>{
  for(const paySource of ['bank','cash','custody'])assert.equal(loanBlockReason({...loan(),paySource},types),null)
  assert.ok(loanBlockReason(loan(),[]))
  assert.equal(isLoanRepayment({type:'transfer',transType:types[1]}),true)
  assert.equal(isLoanRepayment({type:'expense',transType:types[1]}),false)
  assert.equal(loanBlockReason({type:'expense'},types),null)
})
test('switching away removes loan purpose and never restores a hidden loan classification',()=>{
  for(const type of ['transfer','expense','sales']) {
    const next=fromLoanRepayment(loan(),type)
    assert.equal(next.type,type);assert.equal(isLoanRepayment(next),false);assert.equal(next.transType,'')
    assert.equal(reviewDocumentType(next),type)
  }
  assert.equal(fromLoanRepayment(loan(),'expense').items[0].amount,250)
})
test('manual loan review changes amount/description without changing chosen loan, bank or original reading; tax cannot silently disappear',()=>{
  const inv=loan(),fields={...inv,totalAmount:275,description:'Reviewed principal',reason:'Verified financing statement',confirmed:true}
  const reviewed=manualInvoice(inv,fields,[]),sent=payload(reviewed)
  assert.equal(sent.amount,'275.00');assert.equal(sent.transType,types[1]);assert.equal(sent.bankAccountId,'account-a')
  assert.equal(sent.manualReview.previous_total,250)
  assert.throws(()=>manualInvoice(inv,{...fields,vatAmount:10},[]))
  assert.equal(inv.totalAmount,250)
})
test('expense document choice still applies to expenses; a transfer selection always wins over it',()=>{
  assert.equal(payload(original).transType,types[0])
  assert.equal(payload({...original,type:'transfer',transType:types.at(-1)}).transType,types.at(-1))
})
