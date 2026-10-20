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

test('مراجعة 0e0a5f1: هوية مورد «آجل — باسم المورد» ثابتة من فتح النافذة؛ تعديل الوصف لا يغيّر المورد المرسل (مفردة ومتعددة)', async () => {
  const { invoiceSupplierContext, payableDecision, buildInvoicePayload } = await import('../src/lib/approvalV2.js')
  const cats = [{ id: 'm', name: 'مصروفات', ledger_type: 'مصروفات', is_active: true }]
  const inv = { _id: 'p1', type: 'expense', paySource: 'payable', description: 'مورد الألبان', date: '2026-01-05', totalAmount: 70, vatAmount: 0, items: [], _supplierResolution: 'existing', _matchedSupplierId: 'ps-1' }
  const fields = { description: 'وصف معدّل للفاتورة', date: '2026-01-05', totalAmount: '70', vatAmount: '0', categoryId: 'm', reason: 'مراجعة', confirmed: true }
  // متعددة: الهوية المعروضة = invoiceSupplierContext عند الفتح
  const shown = invoiceSupplierContext({}, inv, true).name
  const next = manualInvoice(inv, { ...fields, supplierName: shown }, cats)
  assert.equal(next.description, 'وصف معدّل للفاتورة')
  assert.equal(next.supplier_name, 'مورد الألبان')
  const ctx = invoiceSupplierContext({}, next, true)
  assert.equal(ctx.name, 'مورد الألبان')                                 // المرسل = المعروض، لا الوصف المعدّل
  assert.deepEqual(payableDecision({ matchType: 'fuzzy', supplier: { id: 'ps-1' } }, ctx), { resolution: 'existing', supplier_id: 'ps-1' })   // تأكيد المشابه باقٍ
  assert.equal(buildInvoicePayload(next, { categories: cats }).supplier_name, 'مورد الألبان')
  // مفردة بلا اسم مورد على المستند: الهوية من القراءة الأصلية لا من الوصف المعدّل
  const single = manualInvoice(inv, fields, cats)                         // بلا supplierName (احتياطي: القراءة الأصلية)
  assert.equal(invoiceSupplierContext({}, single, false).name, 'مورد الألبان')
  // مفردة باسم مورد مكتوب على المستند: هو المعروض والمرسل
  const doc = { _supplierName: 'مورد الألبان والأجبان' }
  const shownSingle = invoiceSupplierContext(doc, inv, false).name
  assert.equal(invoiceSupplierContext(doc, manualInvoice(inv, { ...fields, supplierName: shownSingle }, cats), false).name, 'مورد الألبان والأجبان')
  // «مورد من القائمة» بمعرّفه كما هو؛ والآجل بلا أي اسم يُرفض بدل إرساله فارغًا
  const credit = manualInvoice({ ...inv, paySource: 'credit', supplier_id: 's-9' }, fields, cats)
  assert.equal(credit.supplier_id, 's-9'); assert.equal(credit.supplier_name, undefined)
  assert.throws(() => manualInvoice({ ...inv, description: '' }, { ...fields, supplierName: '' }, cats), /اسم المورد غير محدد/)
})
