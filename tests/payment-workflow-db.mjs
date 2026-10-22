// Run with PAYMENT_TEST_FIXTURE pointing to an isolated PostgreSQL fixture; never production.
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {readFile} from 'node:fs/promises'
if(!process.env.PAYMENT_TEST_FIXTURE)throw new Error('An isolated synthetic fixture is required')
const {fixture}=await import(pathToFileURL(process.env.PAYMENT_TEST_FIXTURE));const f=await fixture()
const {db,one,rpc,p1,p2,admin,acc,owner}=f;let checks=0
const check=n=>{checks++;console.log('PASS '+n)}
const bank=randomUUID(),purchase=randomUUID(),restricted=randomUUID(),foreign=randomUUID()
const workflow={version:1,uploaders:{owner:{source:'bank',account_id:bank},purchasing:{source:'bank',account_id:purchase},cashier:{source:'cash'}},network_by_branch:{North:bank,South:restricted},transfer_by_branch:{North:purchase},apps_collection_account:restricted,accounts:{[restricted]:{purpose:'Existing obligations',operating_available:false},[bank]:{transfer_to:purchase}}}
const save=(user,v=workflow,expected=null)=>rpc(user,'admin_bank_workflow_save',[JSON.stringify(v),expected&&JSON.stringify(expected)])
const transferType='🔄 تحويل داخلي — بين الحسابات البنكية'
try{
 await db.query("insert into bank_accounts(id,project_id,name,branches) values($1,$5,'Main',array['North']),($2,$5,'Purchases','{}'),($3,$5,'Restricted',array['South']),($4,$6,'Other tenant','{}')",[bank,purchase,restricted,foreign,p1,p2])
 await db.query("insert into approval_private.settings(project_id,mode) values($1,'v2'),($2,'v2')",[p1,p2])
 for(const user of [acc,owner])assert.equal((await save(user)).code,'forbidden');check('only platform admin can change workflow')
 assert.equal((await save(admin,{...workflow,apps_collection_account:foreign})).code,'invalid');check('cross-tenant bank is rejected')
 assert.equal((await save(admin,{...workflow,network_by_branch:{North:restricted}})).code,'invalid');check('branch network account membership is checked')
 for(const transfer_by_branch of [{North:foreign},{North:restricted},{Unknown:bank},[],null]) {
  assert.equal((await save(admin,{...workflow,transfer_by_branch})).code,'invalid')
 }
 check('sales-transfer defaults reject foreign banks, wrong branches and malformed settings')
 assert.equal((await save(admin)).ok,true);check('admin can save validated company settings')
 const audit=await one("select actor_name,after_value from admin_private.action_log where project_id=$1 and entity='project_settings' order by id desc limit 1",[p1])
 assert.equal(audit.actor_name,'Synthetic admin');assert.deepEqual(audit.after_value.settings.bank_workflow,workflow);check('audit records real admin and actual workflow')
 assert.equal((await save(admin)).code,'stale');check('stale settings cannot overwrite newer settings')
 const originalSettings=await one('select settings from project_settings where project_id=$1',[p2]);assert.equal(originalSettings.settings.bank_workflow,undefined);check('other business settings unchanged')
 await db.query('delete from auth.sessions where id=$1',[f.session]);assert.equal((await save(admin,workflow,workflow)).code,'no_session');await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[f.session,admin]);check('revoked admin session rejected')
 assert.equal((await one("select has_function_privilege('anon','public.admin_bank_workflow_save(jsonb,jsonb)','execute') as ok")).ok,false)
 assert.equal((await one("select has_function_privilege('authenticated','approval_private.check_bank_transfer_pair()','execute') as ok")).ok,false);check('anonymous and internal execute grants are closed')
 async function document(inv){const id=randomUUID();await f.claims(acc);await db.query("insert into documents(id,project_id,file_name,status,analysis_result,branch) values($1,$2,'Synthetic report','analyzed',$3,'North')",[id,p1,JSON.stringify(inv)]);const prep=await rpc(acc,'approval_prepare',[id]);assert.equal(prep.ok,true);return {id,prep,inv:prep.analysis_result.invoices[0]}}
 async function approve(d,inv=d.inv,request=randomUUID(),user=acc){return {request,result:await rpc(user,'approval_approve',[d.id,request,d.prep.version,JSON.stringify([inv]),'{}','{}'])}}
 const base={type:'transfer',transType:transferType,paySource:'bank',amount:'47.25',date:'2026-10-21',description:'Synthetic internal transfer',bankTransfer:{from:bank,to:purchase}}
 let d=await document(base)
 assert.equal((await approve(d,{...d.inv,bankTransfer:{from:bank,to:bank}})).result.code,'bank_transfer_accounts');check('same account transfer rejected')
 assert.equal((await approve(d,{...d.inv,bankTransfer:{from:bank,to:foreign}})).result.code,'bank_account_invalid');check('foreign transfer destination rejected')
 assert.equal((await approve(d,d.inv,randomUUID(),owner)).result.code,'forbidden');check('owner cannot approve despite being uploader')
 const approved=await approve(d);assert.equal(approved.result.ok,true,JSON.stringify(approved.result));
 let entries=(await db.query('select * from ledger_entries where document_id=$1 order by bank_out desc',[d.id])).rows
 assert.equal(entries.length,2);assert.equal(entries[0].bank_out,'47.25');assert.equal(entries[1].bank_in,'47.25');assert.equal(entries[0].bank_account_id,bank);assert.equal(entries[1].bank_account_id,purchase)
 assert.equal(entries[0].journal_number,entries[1].journal_number);assert.equal(entries[0].branch,null);assert.equal(entries[0].created_by_name,'Synthetic accountant');check('approval atomically records two correct legs and real actor')
 assert.equal((await approve(d,d.inv,approved.request)).result.ok,true);assert.equal((await one('select count(*)::int as n from ledger_entries where document_id=$1',[d.id])).n,2);check('lost-response retry does not duplicate transfer')
 assert.equal((await one('select sum(bank_in-bank_out) as n,sum(cash_in+cash_out+vat_amount+payable_in) as x from ledger_entries where document_id=$1',[d.id])).n,'0.00');check('transfer changes no net company bank/cash/VAT amounts')
 await assert.rejects(db.query('update ledger_entries set bank_out=48 where id=$1',[entries[0].id]),/bank_transfer_pair_edit/);check('direct single-leg edit rejected')
 await assert.rejects(db.query('delete from ledger_entries where id=$1',[entries[0].id]),/bank_transfer_pair_edit|foreign key/);check('direct single-leg delete rejected')
 for(const user of [acc,admin]) {
  await f.claims(user);await db.exec('set role authenticated')
  try {
   for(const assignment of [
    'bank_out=case when bank_out>0 then 99 else 0 end,bank_in=case when bank_in>0 then 99 else 0 end,total_amount=99',
    "date='2026-10-20'", "description='Changed without review'", "journal_number='UNREVIEWED'",
   ])await assert.rejects(db.query('update ledger_entries set '+assignment+' where document_id=$1',[d.id]),/bank_transfer_pair_edit/)
   await assert.rejects(db.query('update ledger_entries set bank_account_id=case when bank_account_id=$2 then $3::uuid else $2::uuid end where document_id=$1',[d.id,bank,purchase]),/bank_transfer_pair_edit/)
  }finally{await db.exec('reset role')}
  check('balanced direct edits are rejected without the private approval record for '+(user===acc?'accountant':'admin'))
 }
 assert.deepEqual((await db.query('select * from ledger_entries where document_id=$1 order by bank_out desc',[d.id])).rows,entries)
 check('rejected direct pair edits leave both original ledger rows intact')
 let pair=await rpc(admin,'bank_transfer_manage',[d.inv._id]);assert.equal(pair.ok,true)
 assert.equal((await rpc(owner,'bank_transfer_manage',[d.inv._id])).code,'forbidden');assert.equal((await rpc(admin,'bank_transfer_manage',[d.inv._id],p2)).code,'not_found');check('pair management enforces role and selected business')
 const update={amount:'55.10',date:'2026-10-22',description:'Confirmed transfer',from:bank,to:purchase,reason:'Synthetic correction'}
 assert.equal((await rpc(admin,'bank_transfer_manage',[d.inv._id,'update',pair.version,JSON.stringify({...update,reason:''})])).code,'reason_required');check('paired edit cannot omit its reason')
 assert.equal((await rpc(admin,'bank_transfer_manage',[d.inv._id,'update','old',JSON.stringify(update)])).code,'stale');check('stale edit rejected')
 assert.equal((await rpc(admin,'bank_transfer_manage',[d.inv._id,'update',pair.version,JSON.stringify(update)])).ok,true)
 pair=await rpc(admin,'bank_transfer_manage',[d.inv._id]);assert.equal(pair.source.bank_out,55.1);assert.equal(pair.destination.bank_in,55.1);check('pair edit updates both legs consistently')
 const reviewed=await one('select approved_payload,history from approval_private.document_invoices where id=$1',[d.inv._id])
 const actor=await one('select id from app_users where auth_id=$1',[admin])
 assert.equal(reviewed.approved_payload.amount,55.1);assert.equal(reviewed.approved_payload.description,update.description)
 assert.equal(reviewed.history.at(-1).reason,update.reason);assert.equal(reviewed.history.at(-1).by,actor.id)
 assert.equal(reviewed.history.at(-1).by_name,'Synthetic admin');assert(reviewed.history.at(-1).at)
 check('approved record and history match the new amount, real actor and correction reason')
 assert.equal((await rpc(admin,'bank_transfer_manage',[d.inv._id,'delete',pair.version,JSON.stringify({reason:'Synthetic removal'})])).ok,true)
 assert.equal((await one('select count(*)::int as n from ledger_entries where document_id=$1',[d.id])).n,0)
 const reopened=await rpc(acc,'approval_prepare',[d.id]);assert.equal(reopened.analysis_result.invoices[0].amount,55.1);assert.equal(reopened.invoices[0].original_reading.amount,'47.25');check('delete removes both legs and reopens confirmed values, preserves original reading')
 d={id:d.id,prep:reopened,inv:reopened.analysis_result.invoices[0]};assert.equal((await approve(d)).result.ok,true);check('reopened transfer can be approved once again')
 const app=await document({type:'transfer',transType:'📥 تحصيل ذمم هنقر',paySource:'bank',amount:12,date:'2026-10-21',bankAccountId:restricted,description:'Synthetic collection'})
 assert.equal((await approve(app)).result.ok,true);const appRow=await one('select * from ledger_entries where document_id=$1',[app.id]);assert.equal(appRow.bank_account_id,restricted);assert.equal(appRow.branch,null);assert.equal(Number(appRow.receivable_out),12);check('app collection uses company bank and reduces receivable, no new sale')
 const sale=await document({type:'sales',date:'2026-10-20',cashSales:0,networkSales:40,transferSales:12,totalSales:52,bankAccounts:{network:bank,transfer:purchase}})
 assert.equal((await approve(sale)).result.ok,true)
 const saleRows=(await db.query('select bank_account_id,bank_in from ledger_entries where document_id=$1 order by bank_in desc',[sale.id])).rows
 assert.equal(saleRows.length,2);assert.equal(saleRows[0].bank_account_id,bank);assert.equal(Number(saleRows[0].bank_in),40)
 assert.equal(saleRows[1].bank_account_id,purchase);assert.equal(Number(saleRows[1].bank_in),12)
 check('network and transfer sales reach their independently chosen bank accounts')
 const before=(await db.query('select * from ledger_entries order by id')).rows
 await db.exec(await readFile('supabase/rollback/payment-account-workflows.sql','utf8'))
 assert.deepEqual((await db.query('select * from ledger_entries order by id')).rows,before);check('rollback preserves transfer legs and all financial rows')
 const retainedPair=await rpc(admin,'bank_transfer_manage',[d.inv._id]);await assert.rejects(db.query('update ledger_entries set bank_out=1 where id=$1',[retainedPair.source.id]),/bank_transfer_pair_edit/);check('rollback retains paired-transfer integrity guard')
 await assert.rejects(db.query("update ledger_entries set description='Bypass after rollback' where document_id=$1",[d.id]),/bank_transfer_pair_edit/);check('rollback also retains protection against balanced unaudited edits')
 await db.exec(await readFile('supabase/migrations/20261021045837_payment_account_workflows.sql','utf8'))
 assert.deepEqual((await db.query('select * from ledger_entries order by id')).rows,before);check('reapply preserves all rows and existing pair links')
 console.log(JSON.stringify({passed:checks}))
}finally{await db.close()}
