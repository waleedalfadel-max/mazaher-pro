import test from 'node:test'
import assert from 'node:assert/strict'
import { accountBalances, balanceCards, buildAccountStatement, liabilityFigures, suppliersOutstanding, accountOptions } from '../src/lib/accountStatement.js'
import { exactTotals, buildInvoicePayload } from '../src/lib/approvalV2.js'
import { confirmExpenseBasis, confirmExpenseRounding, normalizeExpenseReading } from '../src/lib/expenseReading.js'
import { suggestInvoicePayment, BANK_TRANSFER_TYPE } from '../src/lib/paymentWorkflow.js'
import { reportModel } from '../src/lib/reportExport.js'
const banks=[{id:'m',name:'Main'},{id:'p',name:'Custody'},{id:'l',name:'Other'}]
const cfg={account_dashboard:{enabled:true,custody_account_id:'p',liability_account_id:'l',liabilities:{balance:1000,date:'2026-10-01',reference:'Synthetic closing statement',automatic_sweep:false}},bank_workflow:{version:1,uploaders:{purchasing:{source:'bank',account_id:'p'}}}}
const row=(id,date,account,into,out,status='approved',extra={})=>({id,date,bank_account_id:account,bank_in:into,bank_out:out,status,...extra})
const entries=[row('1','2026-09-30','m',1000,0),row('2','2026-10-02','m',0,300),row('3','2026-10-02','p',300,0),row('4','2026-10-03','p',0,40),row('5','2026-10-04','p',0,900,'pending'),row('6','2026-10-04','p',0,900,'cancelled'),row('7','2026-11-01','p',0,200),row('8','2026-10-03','l',50,0)]
test('account balances: transfer + expense, no double-counting custody bank, non-counted rows excluded',()=>{
 const b=accountBalances(entries,'2026-10-31');assert.equal(b.bank,1010);assert.equal(b.bankByAccount.p,26000)
 const cards=balanceCards(b,cfg,banks);assert.deepEqual(cards.map(c=>c.value),[750,0,260]);assert.equal(cards.reduce((s,c)=>s+c.value,0),1010)
 assert.equal(balanceCards({...b,custody:90},{})[2].value,90)
})
test('statement opening, search and each running balance use the complete account history',()=>{
 const st=buildAccountStatement(entries,'bank:p',{from:'2026-10-03',to:'2026-10-31',settings:cfg});assert.deepEqual([st.opening,st.closing,st.incoming,st.outgoing],[300,260,0,40]);assert.equal(st.rows.length,1)
 const search=buildAccountStatement(entries,'bank:p',{from:'2026-10-01',to:'2026-10-31',settings:cfg,search:'does not exist'});assert.equal(search.rows.length,0);assert.equal(search.closing,260)
 assert.equal(buildAccountStatement(entries,'bank:foreign',{to:'2026-10-31'}).closing,0)
})
test('all-account transfer is two sides once; cash and historical custody stay distinct',()=>{
 const both=buildAccountStatement(entries,'bank',{to:'2026-10-31'});assert.equal(both.closing,1010)
 const mixed=[row('c','2026-10-01',null,0,0,'auto',{cash_in:80,custody_out:20})]
 assert.equal(buildAccountStatement(mixed,'cash').closing,80);assert.equal(buildAccountStatement(mixed,'custody').closing,-20)
 assert.equal(accountOptions([{id:'p',name:'حساب العهدة',is_active:false}],cfg).some(o=>o.value==='bank:p'),true)
})
test('liabilities: missing is unknown; deposit is not repayment until explicitly confirmed; no negative remaining',()=>{
 assert.equal(liabilityFigures(entries,{account_dashboard:{enabled:true,liability_account_id:'l'}},'2026-10-31').remaining,null)
 const pending=liabilityFigures(entries,cfg,'2026-10-31');assert.equal(pending.remaining,1000);assert.equal(pending.directed,50);assert.equal(pending.confirmed,false)
 const confirmed={...cfg,account_dashboard:{...cfg.account_dashboard,liabilities:{...cfg.account_dashboard.liabilities,automatic_sweep:true}}}
 assert.equal(liabilityFigures(entries,confirmed,'2026-10-31').remaining,950)
 const over=liabilityFigures([...entries,row('x','2026-10-05','l',1200,0)],confirmed,'2026-10-31');assert.equal(over.remaining,0);assert.equal(over.excess,250)
 assert.equal(liabilityFigures(entries,confirmed,'2026-09-01').remaining,null)
})
test('supplier debt sums positive supplier balances and payable debt without netting unrelated supplier credits',()=>{
 assert.equal(suppliersOutstanding([{id:'s',opening_balance:100},{id:'t',opening_balance:0}],[{supplier_id:'s',type:'invoice',amount:20,date:'2026-10-01'},{supplier_id:'s',type:'payment',amount:30,date:'2026-10-02'},{supplier_id:'t',type:'payment',amount:50,date:'2026-10-02'}],[{supplier_id:'p',status:'approved',payable_in:10,payable_out:0,date:'2026-10-01'},{supplier_id:'p',status:'pending',payable_in:90,date:'2026-10-01'}],'2026-10-31'),100)
})
test('purchasing suggestion uses same bank id and credit stays credit; internal transfer retains both accounts',()=>{
 const bank=[{id:'p',name:'حساب العهدة',is_active:true}];const inv={type:'expense',paySource:'cash',amount:10}
 const suggested=suggestInvoicePayment(inv,{created_by_role:'purchasing'},cfg,bank);assert.equal(suggested.bankAccountId,'p');assert.equal(suggested.paySource,'bank');assert.equal(inv.paySource,'cash')
 assert.equal(suggestInvoicePayment({...inv,paySource:'credit'},{created_by_role:'purchasing'},cfg,bank).paySource,'credit')
 const transfer={type:'transfer',transType:BANK_TRANSFER_TYPE,bankTransfer:{from:'m',to:'p'}};assert.deepEqual(suggestInvoicePayment(transfer,{},cfg,bank).bankTransfer,{from:'m',to:'p'})
})
test('expense reading: printed quantity total replaces unit price once, never guesses from the invoice difference',()=>{
 const raw={type:'expense',amountsBasis:'inclusive',totalAmount:24,items:[{description:'Synthetic item',amount:8,quantity:3,unitPrice:8,printedLineTotal:24,printedLineBasis:'inclusive'}]}
 const out=normalizeExpenseReading(raw);assert.equal(out.items[0].amount,'24.00');assert.equal(out.items[0].readingAmount,8);assert.equal(raw.items[0].amount,8);assert.equal(exactTotals(out).status,'match')
 const absent=normalizeExpenseReading({...raw,items:[{amount:8,quantity:3,unitPrice:8}]});assert.equal(absent.items[0].amount,8)
 const wrongBasis=normalizeExpenseReading({...raw,items:[{amount:8,printedLineTotal:24,printedLineBasis:'exclusive'}]});assert.equal(wrongBasis.items[0].amount,8)
})
test('rounding: explicit reason and selected line, max two halalas, exact server payload, original preserved',()=>{
 const read={type:'expense',amountsBasis:'inclusive',totalAmount:30,vatAmount:0,items:[{amount:10},{amount:19.99}]}
 // 2026-10-28: a small difference is not called rounding until the reviewer confirms the amounts basis from the image
 assert.equal(confirmExpenseRounding(read,1,'reviewed'),null);const inv=confirmExpenseBasis(read,'inclusive')
 assert.equal(confirmExpenseRounding(inv,0,''),null);assert.equal(confirmExpenseRounding(inv,5,'reviewed'),null)
 const fixed=confirmExpenseRounding(inv,1,'راجعت التقريب');assert.equal(fixed.items[1].amount,'20.00');assert.equal(fixed.items.length,2);assert.equal(exactTotals(fixed).status,'match');assert.equal(inv.items[1].amount,19.99)
 const payload=buildInvoicePayload(fixed,{original:inv,categories:[],transTypes:[]});assert.equal(payload.roundingReview.reason,'راجعت التقريب')
 assert.equal(confirmExpenseRounding({...inv,totalAmount:31},1,'reason'),null)
})
test('balance report export keeps custody split and total bank unchanged',()=>{
 const b=accountBalances(entries,'2026-10-31');const model=reportModel({tab:'balance',org:'Synthetic',from:'2026-10-01',to:'2026-10-31',balances:b,data:{totalIn:0,totalOut:0},projectSettings:cfg,bankAccounts:banks})
 const cards=model.blocks.find(b=>b.id==='balance.cards').items;assert.equal(cards.find(c=>c.key==='balance.custody').value,260);assert.equal(cards.find(c=>c.key==='balance.bank').value,750)
 assert.equal(model.blocks.find(b=>b.id==='balance.calc').rows.at(-1).value,1010)
})
