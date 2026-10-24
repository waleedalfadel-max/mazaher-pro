// Isolated synthetic PostgreSQL fixture only. No production connection is supported.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { accountBalances, balanceCards, buildAccountStatement } from '../src/lib/accountStatement.js'
if (!process.env.PAYMENT_TEST_FIXTURE) throw new Error('An isolated synthetic fixture is required')
const { fixture } = await import(pathToFileURL(process.env.PAYMENT_TEST_FIXTURE))
const f = await fixture(), { db, one, rpc, p1, p2, admin, acc, owner } = f
let checks=0
const check = s => { checks++; console.log('PASS '+s) }
const migration = await readFile('supabase/migrations/20261024135418_account_dashboard.sql','utf8')
const rollback = await readFile('supabase/rollback/account-dashboard.sql','utf8')
const main=randomUUID(), purchasing=randomUUID(), debt=randomUUID(), foreign=randomUUID()
const workflow={version:1,uploaders:{owner:{source:'bank',account_id:main},purchasing:{source:'bank',account_id:purchasing},cashier:{source:'cash'}},network_by_branch:{North:main,South:debt},transfer_by_branch:{North:main},apps_collection_account:debt,accounts:{[debt]:{purpose:'Synthetic liabilities',operating_available:false}}}
const config={enabled:true,custody_account_id:purchasing,liability_account_id:debt,liabilities:null}
const save=(user,value=config,expected=null,reason='Synthetic reviewed settings',project=p1)=>rpc(user,'admin_account_dashboard_save',[JSON.stringify(value),expected&&JSON.stringify(expected),reason],project)
const snapshot=async()=>({banks:(await db.query('select * from bank_accounts order by id')).rows,settings:(await db.query('select * from project_settings order by project_id')).rows,ledger:(await db.query('select * from ledger_entries order by id')).rows,log:(await db.query('select * from admin_private.action_log order by id')).rows})
try {
 const before=await snapshot(); await db.exec(migration); assert.deepEqual(await snapshot(),before);check('migration is additive and does not activate or change any business data')
 await db.query("insert into bank_accounts(id,project_id,name,branches) values($1,$5,'Synthetic Main',array['North']),($2,$5,'Synthetic Purchasing','{}'),($3,$5,'Synthetic Restricted',array['South']),($4,$6,'Synthetic Foreign','{}')",[main,purchasing,debt,foreign,p1,p2])
 for(const user of [owner,acc])assert.equal((await save(user)).code,'forbidden');check('owner and accountant cannot activate or modify dashboard configuration')
 assert.equal((await save(admin)).code,'workflow_required');check('activation requires the existing bank-workflow feature')
 assert.equal((await rpc(admin,'admin_bank_workflow_save',[JSON.stringify(workflow),null])).ok,true)
 const s=await snapshot()
 for(const cfg of [{...config,custody_account_id:foreign},{...config,liability_account_id:foreign},{...config,liability_account_id:purchasing},{...config,enabled:'true'},{...config,unexpected:1}])assert.equal((await save(admin,cfg)).code,'invalid')
 assert.equal((await save(admin,config,null,' ')).code,'reason_required')
 assert.deepEqual(await snapshot(),s);check('foreign accounts, same accounts, malformed config and absent reason leave everything unchanged')
 await db.query('delete from auth.sessions where id=$1',[f.session]);assert.equal((await save(admin)).code,'no_session');await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[f.session,admin]);check('revoked session cannot save settings')
 assert.equal((await one("select has_function_privilege('anon','public.admin_account_dashboard_save(jsonb,jsonb,text)','execute') ok")).ok,false);check('anonymous execute is revoked')
 const other=await one('select settings from project_settings where project_id=$1',[p2])
 const bankBefore=await one('select * from bank_accounts where id=$1',[purchasing])
 assert.equal((await save(admin)).ok,true)
 const bankAfter=await one('select * from bank_accounts where id=$1',[purchasing])
 assert.equal(bankAfter.name,'حساب العهدة');for(const k of Object.keys(bankBefore).filter(k=>!['name','updated_at'].includes(k)))assert.deepEqual(bankAfter[k],bankBefore[k])
 assert.equal((await one('select count(*)::int n from bank_accounts')).n,4);assert.equal((await one('select count(*)::int n from ledger_entries')).n,0)
 let settings=(await one('select settings from project_settings where project_id=$1',[p1])).settings
 assert.deepEqual(settings.bank_workflow,workflow);assert.deepEqual(settings.account_dashboard,config);assert.deepEqual(await one('select settings from project_settings where project_id=$1',[p2]),other)
 check('activation renames the same account ID with history/branches intact, preserves other rules and tenants, creates no account or ledger entry')
 const log=await one("select * from admin_private.action_log where entity='account_dashboard' order by id desc limit 1")
 assert.equal(log.actor_name,'Synthetic admin');assert.deepEqual(log.after_value,config);assert.equal(log.reason,'Synthetic reviewed settings');check('server audit records actual admin, reason and full configuration')
 assert.equal((await save(admin)).code,'stale');check('stale configuration cannot overwrite a newer one')
 for(const liability of [{balance:-1,date:'2026-10-01',reference:'Synthetic',automatic_sweep:true},{balance:1.001,date:'2026-10-01',reference:'Synthetic',automatic_sweep:true},{balance:1,date:'2026-02-31',reference:'Synthetic',automatic_sweep:true},{balance:1,date:'2999-01-01',reference:'Synthetic',automatic_sweep:true},{balance:1,date:'2026-10-01',reference:' ',automatic_sweep:true}])assert.equal((await save(admin,{...config,liabilities:liability},config)).code,'invalid')
 assert.deepEqual((await one('select settings from project_settings where project_id=$1',[p1])).settings,settings);check('invalid liability balances, dates and sources cannot change settings')
 const documented={...config,liabilities:{balance:200,date:'2026-10-01',reference:'Synthetic creditor statement',automatic_sweep:true}}
 assert.equal((await save(admin,documented,config)).ok,true);settings=(await one('select settings from project_settings where project_id=$1',[p1])).settings;check('documented zero-or-positive liability checkpoint is separate from the ledger')
 await db.query("insert into approval_private.settings(project_id,mode) values($1,'v2'),($2,'v2')",[p1,p2])
 async function document(inv) {const id=randomUUID();await f.claims(acc);await db.query("insert into documents(id,project_id,file_name,status,analysis_result,branch) values($1,$2,'Synthetic only','analyzed',$3,'North')",[id,p1,JSON.stringify(inv)]);const prep=await rpc(acc,'approval_prepare',[id]);assert.equal(prep.ok,true);return {id,prep,inv:prep.analysis_result.invoices[0]}}
 async function approve(d,request=randomUUID()){const r=await rpc(acc,'approval_approve',[d.id,request,d.prep.version,JSON.stringify([d.inv]),'{}','{}']);assert.equal(r.ok,true,JSON.stringify(r));return request}
 const transfer=await document({type:'transfer',transType:'🔄 تحويل داخلي — بين الحسابات البنكية',paySource:'bank',bankTransfer:{from:main,to:purchasing},amount:120,date:'2026-10-02',description:'Synthetic internal funding'})
 const req=await approve(transfer);await approve(transfer,req)
 let rows=(await db.query('select * from ledger_entries order by id')).rows
 assert.equal(rows.length,2);assert.equal(rows.filter(r=>r.bank_account_id===purchasing&&Number(r.bank_in)===120).length,1)
 assert.equal(rows.filter(r=>r.bank_account_id===main&&Number(r.bank_out)===120).length,1)
 assert.equal(rows.reduce((s,r)=>s+Number(r.cash_in)+Number(r.cash_out)+Number(r.custody_in)+Number(r.custody_out)+Number(r.vat_amount),0),0);check('internal transfer reaches both selected banks once with no cash/custody/VAT movements, retry is idempotent')
 const expense=await document({type:'expense',transType:'مصروفات تشغيلية',paySource:'bank',bankAccountId:purchasing,date:'2026-10-03',description:'Synthetic purchase',amountsBasis:'inclusive',totalAmount:23,vat:3,items:[{description:'Synthetic materials',category:'مصروفات تشغيلية',amount:23}]})
 await approve(expense)
 rows=(await db.query('select * from ledger_entries order by id')).rows.map(r=>({...r,date:r.date instanceof Date?r.date.toISOString().slice(0,10):r.date}))
 const expenseRows=rows.filter(r=>r.document_id===expense.id);assert.equal(expenseRows.length,1);assert.equal(expenseRows[0].bank_account_id,purchasing);assert.equal(Number(expenseRows[0].bank_out),23);assert.equal(Number(expenseRows[0].custody_out),0)
 const stmt=buildAccountStatement(rows,'bank:'+purchasing,{settings});assert.equal(stmt.closing,97);assert.deepEqual(stmt.rows.map(r=>r.balance),[120,97])
 const cards=balanceCards(accountBalances(rows),settings);assert.deepEqual(cards.map(c=>c.value),[-120,0,97]);check('approved purchase debits custody bank once, statement and nonoverlapping dashboard balances reconcile')
 assert.equal(expenseRows[0].created_by_name,'Synthetic accountant');check('movements identify the approver, not the uploader')
 await f.claims(owner);await db.exec('set role authenticated');try {const visible=(await db.query('select * from ledger_entries')).rows;assert.equal(visible.length,3);assert(visible.every(r=>r.project_id===p1))}finally{await db.exec('reset role')};check('owner can read own account movements under actual row security')
 const afterUse=await snapshot();await db.exec(rollback);assert.deepEqual(await snapshot(),afterUse);assert.equal((await one("select to_regprocedure('public.admin_account_dashboard_save(jsonb,jsonb,text)')::text f")).f,null);check('rollback removes new management function only and preserves all data, account IDs and audit')
 await db.exec(migration);assert.deepEqual(await snapshot(),afterUse);assert.equal((await one("select has_function_privilege('anon','public.admin_account_dashboard_save(jsonb,jsonb,text)','execute') ok")).ok,false);check('reapply preserves existing data and restores restricted permissions')
 console.log(JSON.stringify({passed:checks}))
} finally { await db.close() }
