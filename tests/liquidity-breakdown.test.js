import test from 'node:test'
import assert from 'node:assert/strict'
import { accountBalances, accountOptions, balanceCards, buildAccountStatement, liabilityFigures, liquidityBreakdown, netLiquidity } from '../src/lib/accountStatement.js'

const settings = { account_dashboard: { enabled: true, custody_account_id: 'held' }, bank_workflow: { accounts: { restricted: { operating_available: false, purpose: 'مخصص للالتزامات' } } } }
const banks = [{ id: 'main', name: 'Main' }, { id: 'second', name: 'Second' }, { id: 'held', name: 'حساب العهدة' }, { id: 'restricted', name: 'Restricted' }, { id: 'closed', name: 'Closed', is_active: false }]
const row = (id, account, amount, extra = {}) => ({ id, date: '2026-10-01', status: 'approved', bank_account_id: account, bank_in: amount > 0 ? amount : 0, bank_out: amount < 0 ? -amount : 0, ...extra })
const entries = [row('1','main',1000),row('2','second',200),row('3','held',-80),row('4','restricted',400),row('5',null,0,{cash_in:50}),row('6','closed',90),row('7',null,70),row('8','held',900,{status:'pending'}),row('9','main',900,{date:'2026-11-01'})]
const to = '2026-10-31'
const statement = (key, rows = entries, extra = {}) => buildAccountStatement(rows,key,{ settings, banks, to, ...extra })

test('home cash is available banks + cash box + signed custody, excluding restricted funds once', () => {
  const b = accountBalances(entries,to), result = liquidityBreakdown(b,banks,settings)
  assert.deepEqual([result.bank,result.cash,result.custody,result.total],[1200,50,-80,1170])
  assert.equal(result.cards.reduce((s,c)=>s+Math.round(c.value*100),0),117000)
  assert.equal(netLiquidity(b,banks,settings),1170)
  assert.deepEqual(result.excluded.map(e=>e.value),[400,90,70])
  assert.equal(result.cards[2].account,'available-custody')
})

test('every home card and the total open a statement with the same balance and scope', () => {
  const result=liquidityBreakdown(accountBalances(entries,to),banks,settings)
  for(const c of result.cards) assert.equal(statement(c.account).closing,c.value)
  assert.equal(statement('liquidity').closing,1170)
  assert.deepEqual(statement('liquidity').rows.map(r=>r.balance),[1000,1200,1120,1170])
  assert.deepEqual(statement('available-bank').rows.map(r=>r.id),['1','2'])
  assert.ok(accountOptions(banks,settings).some(o=>o.value==='liquidity'))
})

test('negative balances in other available banks and cash are subtracted, not clamped', () => {
  const rows=[row('1','main',-100),row('2','held',-80),row('3',null,0,{cash_out:20})]
  assert.equal(liquidityBreakdown(accountBalances(rows,to),banks,settings).total,-200)
  assert.equal(statement('liquidity',rows).closing,-200)
})

test('period opening and search preserve the complete signed balance', () => {
  const rows=[...entries,row('10','main',-35,{date:'2026-10-02',description:'purchase'})]
  const st=statement('liquidity',rows,{from:'2026-10-02',search:'not present'})
  assert.deepEqual([st.opening,st.closing,st.incoming,st.outgoing,st.rows.length],[1170,1135,0,35,0])
})

test('internal funding moves both cards and never changes total cash; cash-bank movement on one row nets once', () => {
  const rows=[...entries,row('10','main',-100),row('11','held',100),row('12','main',-20,{cash_in:20})]
  const r=liquidityBreakdown(accountBalances(rows,to),banks,settings)
  assert.deepEqual([r.bank,r.cash,r.custody,r.total],[1080,70,20,1170])
  assert.equal(statement('liquidity',rows).closing,1170)
})

test('a restricted custody bank is excluded consistently from the cards and their statements', () => {
  const restricted={...settings,bank_workflow:{accounts:{...settings.bank_workflow.accounts,held:{operating_available:false}}}}
  const r=liquidityBreakdown(accountBalances(entries,to),banks,restricted)
  assert.deepEqual([r.custody,r.total],[0,1250])
  assert.ok(r.excluded.some(e=>e.account==='bank:held'&&e.value===-80))
  assert.equal(statement('available-custody',entries,{settings:restricted}).closing,0)
  assert.equal(statement('liquidity',entries,{settings:restricted}).closing,1250)
})

test('existing booked balances, all-bank statements and non-feature account choices are unchanged', () => {
  const b=accountBalances(entries,to)
  assert.deepEqual(balanceCards(b,settings).map(c=>c.value),[1760,50,-80])
  assert.equal(statement('bank').closing,1680)
  assert.equal(accountOptions(banks,{}).some(o=>o.value==='liquidity'),false)
  assert.deepEqual(balanceCards({...b,custody:12},{}).map(c=>c.value),[1680,50,12])
})

test('a current liability checkpoint excludes old deposits; new approved network receipts reduce its negative balance', () => {
  const cfg={...settings,account_dashboard:{...settings.account_dashboard,liability_account_id:'restricted',liabilities:{balance:500,date:'2026-10-25',reference:'Synthetic owner statement',automatic_sweep:true}}}
  const before=liabilityFigures(entries,cfg,to)
  assert.deepEqual([before.remaining,before.signedRemaining,before.directed],[500,-500,0])
  const added=[...entries,row('10','restricted',100,{date:'2026-10-26',type:'مبيعات شبكة'}),row('11','restricted',900,{date:'2026-10-26',status:'pending'}),row('12','main',800,{date:'2026-10-26'})]
  const after=liabilityFigures(added,cfg,to)
  assert.deepEqual([after.remaining,after.signedRemaining,after.directed],[400,-400,100])
  assert.equal(liabilityFigures(added,cfg,'2026-10-24').signedRemaining,null)
  const paid=liabilityFigures([...added,row('13','restricted',450,{date:'2026-10-27'})],cfg,to)
  assert.deepEqual([paid.remaining,paid.signedRemaining,paid.excess],[0,0,50])
  assert.equal(Object.is(paid.signedRemaining,-0),false)
})
