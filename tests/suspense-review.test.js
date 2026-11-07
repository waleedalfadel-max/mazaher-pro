import test from 'node:test'
import assert from 'node:assert/strict'
import {suspenseTotals,writeSuspense} from '../src/lib/suspenseReview.js'
import {summarizeEntries} from '../src/lib/financeSummary.js'
import {journalPostings} from '../src/lib/journalPostings.js'
import {loadJournalAccounts} from '../src/lib/journalAccounts.js'
import {journalClient,journalFixture} from './fixtures/journal-detail.js'
const base={id:'entry',project_id:'p1',status:'approved',date:'2026-10-01',journal_number:'S1',output_vat_amount:null,vat_amount:0}
test('unresolved increases and shortages stay separate even when net is zero',()=>{
 assert.deepEqual(suspenseTotals([{status:'open',direction:'in',amount:100},{status:'proposed',direction:'out',amount:100},{status:'resolved',direction:'in',amount:999}]),{count:2,incoming:100,outgoing:100})
})
test('suspense changes cash but never revenue, expenses or VAT; named counterpart balances',()=>{
 const rows=[{...base,type:'فروقات قيد المراجعة',cash_in:53.58,total_amount:53.58}]
 const s=summarizeEntries(rows);assert.equal(s.cashBalance,53.58);for(const k of ['totalSales','totalExpenses','netProfit','outputVat','inputVat'])assert.equal(s[k],0,k)
 const p=journalPostings(rows);assert.equal(p.complete,true);assert.equal(p.debit,5358);assert.equal(p.credit,5358);assert.ok(p.segments[0].lines.some(l=>l.account==='فروقات قيد المراجعة'&&l.credit===5358))
})
test('owner reclassification changes profit correctly without changing bank movement',()=>{
 const rows=[{...base,type:'فروقات قيد المراجعة',bank_out:115,total_amount:115}]
 const before=summarizeEntries(rows),after=summarizeEntries([{...rows[0],type:'🛒 مصروفات تشغيلية',financial_class:'opex',vat_amount:15}]);assert.equal(before.bankBalance,after.bankBalance);assert.equal(after.totalExpenses,100);assert.equal(after.inputVat,15)
 const sale=summarizeEntries([{...base,type:'مبيعات كاش',cash_in:115,output_vat_amount:15}]);assert.equal(sale.totalSales,100);assert.equal(sale.outputVat,15)
})
test('mistaken receipt/refund and supplier settlement never create income or expense',()=>{
 for(const e of [{type:'حوالة واردة بالخطأ',bank_in:54},{type:'رد حوالات واردة بالخطأ',bank_out:54},{type:'🏪 سداد مورد',bank_out:54,payable_out:54}]){const s=summarizeEntries([{...base,...e}]);assert.equal(s.totalSales,0);assert.equal(s.totalExpenses,0);assert.equal(s.netProfit,0)}
})
test('list supplier name resolves from exact tenant journal, including pagination',async()=>{
 const tables=journalFixture();tables.supplier_transactions=[{id:'t1',project_id:'p1',supplier_id:'s1',journal_number:'S1'},{id:'foreign',project_id:'p2',supplier_id:'secret',journal_number:'S1'}]
 const rows=[{...base,type:'🏪 سداد مورد',cash_out:50,payable_out:50}];const context=await loadJournalAccounts(journalClient(tables,{max:1}),'p1',rows);assert.equal(context.error,null)
 const p=journalPostings(rows,context.data);assert.equal(p.complete,true);assert.ok(p.segments[0].lines.some(l=>l.account==='المورد — المورد التجريبي'&&l.debit===5000))
})
test('server errors are definitive; network failures keep retry identity uncertain',async()=>{
 await assert.rejects(writeSuspense({rpc:async()=>({data:{ok:false,code:'owner_required'}})},'approve',{id:'x',version:2},{confirmed:true}),e=>e.definitive&&e.message.includes('مالك'))
 await assert.rejects(writeSuspense({rpc:async()=>({error:{}})},'new',null,{},'r'),e=>!e.definitive)
})
