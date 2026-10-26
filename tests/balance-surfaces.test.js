import test from 'node:test'
import assert from 'node:assert/strict'
import { accountBalances, balanceOverview, buildAccountStatement, runningAccountBalances, liquidityBreakdown } from '../src/lib/accountStatement.js'
import { reportModel } from '../src/lib/reportExport.js'
const banks=[{id:'main',name:'Main'},{id:'held',name:'Custody'},{id:'restricted',name:'Restricted'},{id:'closed',name:'Inactive',is_active:false}]
const settings={account_dashboard:{enabled:true,custody_account_id:'held',liability_account_id:'restricted',liabilities:{balance:800,date:'2026-10-10',reference:'Synthetic owner instruction',automatic_sweep:true}},bank_workflow:{version:1,accounts:{restricted:{operating_available:false}}}}
const row=(id,bank,amount,extra={})=>({id,date:'2026-10-01',status:'approved',bank_account_id:bank,bank_in:Math.max(amount,0),bank_out:Math.max(-amount,0),...extra})
const entries=[row('1','main',1000),row('2','held',-80),row('3',null,0,{cash_in:50}),row('4','restricted',300),row('5','closed',100),row('6',null,200),row('7','restricted',100,{date:'2026-10-11'}),row('8','held',600,{status:'pending'}),row('9','main',900,{status:'rejected'}),row('10','main',900,{status:null})]
const to='2026-10-26',from='2026-10-10'
test('home, report, export, statements and ledger use identical signed account scopes',()=>{
 const b=accountBalances(entries,to), view=balanceOverview(b,banks,settings,entries,to,from)
 assert.deepEqual([view.bank,view.cash,view.custody,view.total],[1000,50,-80,970])
 assert.equal(view.liability.signedRemaining,-700)
 const model=reportModel({tab:'balance',from,to,balances:{...b,entries},bankAccounts:banks,projectSettings:settings})
 assert.deepEqual(model.blocks.find(b=>b.id==='balance.cards').items.map(c=>c.value),[1000,50,-80])
 assert.equal(model.blocks.find(b=>b.id==='balance.liquidity').rows.at(-1).value,970)
 assert.equal(model.blocks.find(b=>b.id==='balance.calc').rows.at(-1).value,970)
 assert.equal(model.blocks.find(b=>b.id==='balance.liabilities').rows[0].value,-700)
 assert.equal(view.bankRows.at(-1).value,view.bank)
 assert.equal(view.bankRows.some(r=>r.label==='Restricted'),false)
 for(const c of view.cards) assert.equal(buildAccountStatement(entries,c.account,{to,banks,settings}).closing,c.value)
 const running=runningAccountBalances(entries,banks,settings)
 const last=running.filter(e=>e._bankBal!=null).at(-1)
 assert.deepEqual([last._bankBal,last._cashBal,last._custodyBal],[1000,50,-80])
 for(const id of ['8','9','10']) assert.equal(running.find(e=>e.id===id)._bankBal,null)
 assert.equal(JSON.stringify(entries).includes('_bankBal'),false)
})
test('period filter keeps the closing balance; restricted deposits only affect the separate liability',()=>{
 const b=accountBalances(entries,to), view=balanceOverview(b,banks,settings,entries,to,from)
 assert.equal(view.period.opening,970);assert.equal(view.period.incoming,0);assert.equal(view.total,970)
 assert.equal(balanceOverview(accountBalances(entries,'2026-10-09'),banks,settings,entries,'2026-10-09').liability.signedRemaining,null)
})
test('legacy staff custody and negative bank balances stay signed without the bank-custody feature',()=>{
 const rows=[row('a','main',100),row('b','held',-30),row('c',null,20,{cash_in:10,custody_out:5})]
 const b=accountBalances(rows), v=liquidityBreakdown(b,banks,{})
 assert.deepEqual([v.bank,v.cash,v.custody,v.total],[90,10,-5,95])
 for(const c of v.cards) assert.equal(buildAccountStatement(rows,c.account,{banks,settings:{}}).closing,c.value)
 assert.equal(buildAccountStatement(rows,'liquidity',{banks,settings:{}}).closing,95)
})
test('halalah arithmetic and old ledger history remain exact without synthesizing entries',()=>{
 const rows=[row('1','main',0.1),row('2','main',0.2),row('3','main',-0.1),row('4','restricted',25)]
 assert.equal(balanceOverview(accountBalances(rows),banks,settings,rows,to).total,0.2)
 assert.equal(buildAccountStatement(rows,'bank',{to,banks,settings}).closing,25.2)
 assert.equal(runningAccountBalances(rows,banks,settings).at(-1)._bankBal,0.2)
})
