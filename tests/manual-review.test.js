import { test } from 'node:test'
import assert from 'node:assert/strict'
import { manualInvoice, withManualInvoice } from '../src/lib/manualReview.js'
import { buildInvoicePayload, exactTotals } from '../src/lib/approvalV2.js'
import { salesReportCheck } from '../src/lib/salesReport.js'
import { operatesBusiness } from '../src/lib/adminAccess.js'

const categories = [{id:'main',name:'Test expense',ledger_type:'Test expense',is_active:true},
  {id:'sub',parent_id:'main',name:'Test sub',is_active:true}, {id:'other',parent_id:'elsewhere',name:'Wrong sub'}]
const original = {_id:'one',type:'expense',date:'2026-01-01',description:'Synthetic supplier',totalAmount:230,vatAmount:30,
  paySource:'bank',bankAccountId:'bank-a',invoiceNumber:'TEST-1',invoiceDiscount:20,
  items:[{description:'A',amount:80},{description:'B',amount:120},{description:'Unit price',amount:60}]}
const fields = {date:original.date,description:original.description,totalAmount:230,vatAmount:30,
  categoryId:'main',subcategoryId:'sub',reason:'Reviewed the original document; reading duplicated a price.',confirmed:true}

test('manual total replaces OCR detail only after explicit review, with unchanged original and payment identity',()=>{
  const before=structuredClone(original)
  const next=manualInvoice(original,fields,categories)
  assert.equal(exactTotals(original).status,'mismatch')
  assert.equal(exactTotals(next).status,'match')
  assert.equal(next.totalAmount,'230.00');assert.equal(next.vatAmount,'30.00')
  assert.equal(next.items.length,1);assert.equal(next.items[0].amount,'230.00')
  assert.equal(next.items[0].category_id,'main');assert.equal(next.items[0].subcategory_id,'sub')
  assert.equal(next.invoiceDiscount,0);assert.equal(next.amountsBasis,'inclusive')
  for(const key of ['_id','invoiceNumber','paySource','bankAccountId'])assert.equal(next[key],original[key])
  assert.deepEqual(original,before)
  const payload=buildInvoicePayload(next,{original,categories,transTypes:['Test expense']})
  assert.equal(payload.items[0].category_id,'main')
  assert.ok(payload.review_changes.some(s=>s.includes('اعتماد بمراجعة يدوية')))
  assert.deepEqual(payload.manualReview.previous_items,original.items)
})

test('reason, confirmation, explicit classification and valid final amounts are required',()=>{
  for(const patch of [{reason:''},{confirmed:false},{categoryId:''},{subcategoryId:'other'},
    {totalAmount:0},{totalAmount:'bad'},{totalAmount:'10.001'},{vatAmount:-1},{vatAmount:231},{date:''}])
    assert.throws(()=>manualInvoice(original,{...fields,...patch},categories))
  assert.throws(()=>manualInvoice(original,fields,[{...categories[0],is_active:false},categories[1]]))
})

test('sales use confirmed net channels, with original discrepancy retained and no second return deduction',()=>{
  const read={_id:'sale',type:'sales',date:'2026-01-02',description:'Synthetic report',cashSales:90,networkSales:100,totalSales:500,
    unknownPayments:[{label:'Unclear',amount:310}],salesReadingVersion:2,salesBreakdown:{returns:{cash:10}},bankAccounts:{network:'bank-a'}}
  assert.equal(salesReportCheck(read).ok,false)
  const next=manualInvoice(read,{...fields,date:read.date,cashSales:120,networkSales:80,transferSales:20},[])
  assert.equal(next.totalSales,'220.00');assert.equal(next.cashSales,'120.00')
  assert.equal(salesReportCheck(next).ok,true)
  assert.deepEqual(next.manualReview.previous_unknown,read.unknownPayments)
  assert.equal(next.manualReview.previous_total,500)
  assert.deepEqual(next.bankAccounts,read.bankAccounts)
  assert.equal(next.salesBreakdown,undefined)
  assert.equal(read.unknownPayments.length,1)
})

test('manual transfer keeps its type, source and bank; cannot change another invoice by index',()=>{
  const inv={...original,type:'transfer',transType:'Internal transfer'}
  const next=manualInvoice(inv,fields,[])
  assert.equal(next.transType,inv.transType);assert.equal(next.paySource,inv.paySource)
  const doc={analysis_result:{invoices:[original,{...original,_id:'two'}]}}
  const changed=withManualInvoice(doc,0,next)
  assert.deepEqual(changed.analysis_result,doc.analysis_result)
  assert.equal(changed._edit.invoices[1],doc.analysis_result.invoices[1])
  assert.throws(()=>withManualInvoice(doc,1,next))
  assert.throws(()=>withManualInvoice(doc,3,next))
  const added=manualInvoice({...original,_id:undefined},fields,categories)
  assert.match(added._id,/^[0-9a-f-]{36}$/)
})

test('manual entry action is for verified platform-admin business context only',()=>{
  assert.equal(operatesBusiness('superadmin','business-a','ok'),true)
  for(const role of ['owner','accountant','cashier','purchasing',null])assert.equal(operatesBusiness(role,'business-a','ok'),false)
  assert.equal(operatesBusiness('superadmin',null,'ok'),false)
  assert.equal(operatesBusiness('superadmin','business-a','error'),false)
})
