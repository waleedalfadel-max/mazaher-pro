import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSalesReading, applySalesRows, reconcileSalesColumns, salesReportCheck } from '../src/lib/salesReport.js'
import { paymentAccountKey, suggestSalesPaymentAccounts } from '../src/lib/salesPaymentAccounts.js'
import { suggestDocumentPayments, documentPaymentChoices } from '../src/lib/paymentWorkflow.js'
const settings={bank_workflow:{version:1,network_by_branch:{North:'main',South:'main'}},pos_payment_accounts:[{label:'مدى 036',aliases:['مدى 036','Mada 036'],channel:'network',account_id:'liability'}]}
const accounts=[{id:'main',branches:[]},{id:'liability',branches:[]}]
const invoice=(label='مدى (036)')=>normalizeSalesReading({_id:'one',type:'sales',paymentLines:[{label:'Mada',amount:1220},{label:'مدى توصيل',amount:578.5},{label,amount:224}],returnLines:[{label:'مدى توصيل',amount:29}],reportGrossTotal:2022.5,reportNetTotal:1993.5})
test('terminal digits and Arabic digits survive exact account-name matching across branches',()=>{
 for (const name of ['مدى 036','مدى (036)','مدى ٠٣٦','MADA (036)','mada036']) {
  for (const branch of ['North','South','Future branch']) {
   const result=suggestDocumentPayments({invoices:[invoice(name)]},{branch},settings,accounts).invoices[0]
   assert.equal(result.networkSales,1993.5)
   assert.deepEqual(result.salesBankRoutes,[{label:'مدى 036',channel:'network',amount:'224.00',accountId:'liability'}])
  }
 }
 assert.notEqual(paymentAccountKey('مدى 136'),paymentAccountKey('مدى 036'))
 for (const name of ['Mada','مدى توصيل','مدى 136','مدى 0360','مدى 36']) assert.equal(suggestSalesPaymentAccounts(invoice(name),settings).salesBankRoutes,undefined)
})
test('matching refunds, corrected rows, saved choice and repeated suggestions retain exact amounts',()=>{
 let inv=suggestSalesPaymentAccounts(invoice(),settings)
 inv={...inv,salesBankRoutes:inv.salesBankRoutes.map(r=>({...r,accountId:'manual'}))}
 inv=applySalesRows(inv,[{kind:'payment',label:'Mada',amount:'1220',channel:'network'},{kind:'payment',label:'مدى (036)',amount:'224',channel:'network'},{kind:'return',label:'مدى ٠٣٦',amount:'24',channel:'network'}],'Checked receipt')
 const next=suggestSalesPaymentAccounts(inv,settings)
 assert.equal(next.salesBankRoutes[0].amount,'200.00');assert.equal(next.salesBankRoutes[0].accountId,'manual')
 assert.equal(suggestSalesPaymentAccounts(next,settings),next)
 assert.deepEqual(documentPaymentChoices({invoices:[next]}).one.salesBankRoutes,next.salesBankRoutes)
 assert.equal(suggestSalesPaymentAccounts(invoice(),{}).salesBankRoutes,undefined)
 assert.equal(reconcileSalesColumns({...invoice(),salesBankRoutes:[{accountId:'model'}]}).salesBankRoutes,undefined)
})
test('channel edits cannot silently over-allocate, missing account and negative routes block approval',()=>{
 const inv=suggestSalesPaymentAccounts(invoice(),settings)
 assert.equal(salesReportCheck(inv).ok,true)
 for (const route of [{...inv.salesBankRoutes[0],amount:'2999.00'},{...inv.salesBankRoutes[0],amount:'-1.00'},{...inv.salesBankRoutes[0],accountId:''}]) {
  assert.equal(salesReportCheck({...inv,salesBankRoutes:[route]}).ok,false)
 }
})
