import {test} from 'node:test'
import assert from 'node:assert/strict'
import {salesAmountNet, salesVatOf, netSalesChannels, BALANCE_START_TYPE} from '../src/lib/financeRules.js'
import {summarizeEntries} from '../src/lib/financeSummary.js'
import {salesFigures} from '../src/lib/reportFigures.js'
import {windowFigures} from '../src/lib/financialAnalysis.js'
import {reportModel} from '../src/lib/reportExport.js'
import {reportedSalesVatCheck, salesReportCheck} from '../src/lib/salesReport.js'
import {buildInvoicePayload, salesCorrectionChanges} from '../src/lib/approvalV2.js'
const row=(type,field,amount,vat)=>({type,[field]:amount,output_vat_amount:vat,status:'approved',date:'2026-01-02',branch:'Synthetic'})
const r2=n=>Math.round(n*100)/100
const rows=()=>[row('💵 مبيعات كاش','cash_in',230,27),row('🏦 مبيعات شبكة','bank_in',1380,162),row('🍔 مبيعات هنقر ستيشن','receivable_in',690,81)]
test('printed sales VAT, explicit zero and legacy estimate; input VAT remains separate',()=>{
 const old=row('💵 مبيعات كاش','cash_in',115,null)
 assert.equal(salesAmountNet(old),115/1.15);assert.equal(r2(salesVatOf(old)),15)
 assert.equal(salesAmountNet({...old,output_vat_amount:0}),115)
 const s=summarizeEntries([...rows(),{type:'🛒 مصروفات تشغيلية',status:'approved',cash_out:115,vat_amount:15}])
 assert.equal(s.grossSales,2300);assert.equal(s.totalSales,2030);assert.equal(s.outputVat,270);assert.equal(s.inputVat,15)
 assert.equal(s.vatNetBeforePayment,255);assert.equal(s.totalExpenses,100)
})
test('daily, branch, analysis and export agree, balance-start offsets do not change sales/VAT',()=>{
 const entries=[...rows(),{type:BALANCE_START_TYPE,status:'approved',cash_out:230,bank_out:1380,date:'2026-01-03'}]
 const sum=summarizeEntries(entries)
 assert.equal(sum.cashBalance,0);assert.equal(sum.bankBalance,0);assert.equal(sum.receivableBalance,690)
 const s=salesFigures({engineSummary:sum,selectedBranch:'all',branches:['Synthetic'],from:'2026-01-01',to:'2026-01-31',prevEntries:[]})
 assert.equal(s.curSales,2030);assert.equal(s.branchRows[0].sales,2030)
 assert.deepEqual(s.dailyRows[0],{date:'2026-01-02',cash:203,bank:1218,apps:609})
 const w=windowFigures(entries,{from:'2026-01-01',to:'2026-01-31',days:31})
 assert.equal(w.salesNetH,203000)
 const model=reportModel({tab:'sales',s,org:'Synthetic',from:'2026-01-01',to:'2026-01-31',branch:'all',branches:[]})
 assert.ok(JSON.stringify(model).includes('2030'))
})
test('tax-only and decreasing sales corrections preserve cash movement and change net/VAT',()=>{
 const correction=row('🏦 مبيعات شبكة','bank_in',0,-12)
 assert.deepEqual(netSalesChannels(correction),{cash:0,bank:12,apps:0})
 const s=summarizeEntries([...rows(),correction])
 assert.equal(s.totalSales,2042);assert.equal(s.outputVat,258);assert.equal(s.bankBalance,1380)
 assert.equal(salesAmountNet(row('💵 مبيعات كاش','cash_in',-115,-15)),-100)
 assert.equal(summarizeEntries([...rows(),{...correction,status:'rejected'}]).totalSales,2030)
})
test('reviewed VAT validation and Arabic normalization preserve blank versus zero',()=>{
 for(const val of [undefined,null,''])assert.equal(reportedSalesVatCheck({totalSales:2300,reportedSalesVat:val}).provided,false)
 for(const val of [-1,301,'x',1.234])assert.equal(salesReportCheck({totalSales:2300,cashSales:2300,reportedSalesVat:val}).ok,false)
 for(const val of [0,270,'٢٧٠٫٠٠'])assert.equal(reportedSalesVatCheck({totalSales:2300,reportedSalesVat:val}).ok,true)
 const p=buildInvoicePayload({type:'sales',totalSales:2300,reportedSalesVat:'٢٧٠٫٠٠'},{original:{},categories:[],transTypes:[]})
 assert.equal(p.reportedSalesVat,270)
 assert.match(salesCorrectionChanges({cash:115},{cash:115,_reported_vat:0})[0],/ضريبة التقرير.*0.00/)
})
