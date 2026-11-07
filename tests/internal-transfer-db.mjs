// Runs only against an isolated PostgreSQL fixture; never creates live transactions.
import assert from 'node:assert/strict'
import {journalPostings} from '../src/lib/journalPostings.js'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
if(!process.env.TRANSFER_TEST_FIXTURE)throw Error('Set an isolated TRANSFER_TEST_FIXTURE')
const {fixture}=await import(process.env.TRANSFER_TEST_FIXTURE)
const f=await fixture(),{db,one,rpc,acc,owner,other,admin,p1,p2}=f
const q=(sql,args=[])=>db.query(sql,args),check=x=>console.log('PASS',x)
const b1=randomUUID(),b2=randomUUID(),foreign=randomUUID(),stopped=randomUUID(),type='🔄 تحويل داخلي'
const create=(from,to,amount=13.25,user=acc,request=randomUUID())=>rpc(user,'internal_transfer_create',[request,'2026-11-07',amount,from,to,'Transfer'])
const manage=(id,action='read',version=null,data={},user=acc)=>rpc(user,'internal_transfer_manage',[id,action,version,data])
const count=async()=>Number((await one('select count(*) n from ledger_entries')).n)
try {
 const before=await count()
 await db.exec(await readFile('supabase/migrations/20261107171330_unified_internal_transfers.sql','utf8'))
 assert.equal(await count(),before)
 await q("insert into approval_private.settings(project_id,mode) values($1,'v2') on conflict(project_id) do update set mode='v2'",[p1])
 await q("insert into bank_accounts(id,project_id,name,is_active) values($1,$5,'Main',true),($2,$5,'Purchasing',true),($3,$6,'Foreign',true),($4,$5,'Closed',false)",[b1,b2,foreign,stopped,p1,p2])
 const keys=['cash','custody','bank:'+b1,'bank:'+b2]
 for(const from of keys)for(const to of keys){
  if(from===to)continue
  const req=randomUUID(),r=await create(from,to,13.25,acc,req)
  assert.equal(r.ok,true,JSON.stringify(r));assert.equal((await create(from,to,13.25,acc,req)).id,r.id)
  const rows=(await q('select * from ledger_entries where journal_number=$1',[r.journal_number])).rows
  const journal=journalPostings(rows,{banks:[{id:b1,name:'Main'},{id:b2,name:'Purchasing'}]})
  assert.equal(journal.complete,true);assert.equal(journal.debit,1325);assert.equal(journal.credit,1325)
  assert.equal(rows.length,2);assert.equal(new Set(rows.map(x=>x.journal_number)).size,1)
  const sum=dir=>rows.reduce((s,r)=>s+['cash','bank','custody','receivable','payable'].reduce((n,k)=>n+Number(r[k+'_'+dir]||0),0),0)
  assert.equal(sum('in'),13.25);assert.equal(sum('out'),13.25)
  for(const [k,dir]of[[from,'out'],[to,'in']]){
   const [kind,id]=k.split(':');const row=rows.find(x=>Number(x[kind+'_'+dir])===13.25)
   assert.ok(row,k+' '+dir);assert.equal(row.bank_account_id,id||null);assert.equal(Number(row.vat_amount),0);assert.equal(row.branch,null)
  }
  assert.equal((await create(from,to,14,acc,req)).code,'request_conflict')
 }
 check('12 account directions are balanced, company-wide, tax-free and idempotent')
 const n=await count()
 for(const [from,to,amount]of[['cash','cash',1],['cash','bank:'+foreign,1],['cash','bank:'+stopped,1],['cash','bank:missing',1],['cash','custody',0],['cash','custody',-1],['cash','custody',1.001],['cash','custody','NaN']])assert.equal((await create(from,to,amount)).ok,false)
 assert.equal((await create('cash','bank:'+b1,1,owner)).ok,false)
 assert.equal((await create('cash','bank:'+b1,1,other)).ok,false)
 assert.equal(await count(),n)
 const provider=await create('cash','bank:'+b1,1,admin);assert.equal(provider.ok,true,JSON.stringify(provider))
 await q("update project_settings set settings='{"+'"account_dashboard":{"enabled":true}'+"}' where project_id=$1",[p1])
 assert.equal((await create('cash','custody')).code,'internal_transfer_custody')
 await q("update project_settings set settings='{}' where project_id=$1",[p1])
 check('same, foreign, closed accounts, invalid amounts and unauthorized roles rejected')
 const r=await create('cash','bank:'+b1),read=await manage(r.entry_id)
 assert.equal(read.ok,true);assert.equal((await manage(r.entry_id,'read',null,{},other)).ok,false)
 assert.equal((await manage(r.entry_id,'update',read.version,{from:'bank:'+b1,to:'cash',amount:23,date:'2026-11-06',reason:'Correction'})).ok,true)
 assert.equal((await manage(r.entry_id,'delete',read.version,{reason:'Old version'})).code,'stale')
 const edited=await manage(r.entry_id);assert.equal(edited.amount,23);assert.equal(edited.from,'bank:'+b1)
 const restricted=async(sql,args=[])=>{await f.claims(acc);await db.exec('set role authenticated');try{await assert.rejects(q(sql,args))}finally{await db.exec('reset role')}}
 await restricted('update ledger_entries set cash_out=999 where id=$1',[r.entry_id])
 await restricted('delete from ledger_entries where id=$1',[r.entry_id])
 await restricted("insert into ledger_entries(project_id,date,type,total_amount,cash_in,status) values($1,'2026-11-07',$2,1,1,'approved')",[p1,type])
 assert.equal((await manage(r.entry_id,'delete',edited.version,{reason:'Duplicate receipt'})).ok,true)
 assert.equal((await one('select count(*)::int n from ledger_entries where journal_number=$1',[r.journal_number])).n,0)
 check('editing/deleting controls both legs; stale edits and direct one-leg mutations blocked')
 async function doc(from,to,amount=45){
  await f.claims(acc);const id=randomUUID()
  const inv={type:'transfer',transType:type,internalTransfer:{from,to},amount,totalAmount:amount,vatAmount:0,date:'2026-11-07',description:'Document transfer'}
  await q("insert into documents(id,project_id,file_name,status,analysis_result) values($1,$2,'Transfer receipt','analyzed',$3)",[id,p1,{invoices:[inv]}])
  const prepared=await rpc(acc,'approval_prepare',[id]);assert.equal(prepared.ok,true,JSON.stringify(prepared))
  return{id,prepared,request:randomUUID()}
 }
 const approve=d=>rpc(acc,'approval_approve',[d.id,d.request,d.prepared.version,d.prepared.analysis_result.invoices,{},{}])
 for(const [from,to]of[['cash','bank:'+b1],['bank:'+b1,'bank:'+b2],['bank:'+b2,'cash'],['cash','custody']]){
  const d=await doc(from,to),result=await approve(d)
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal((await approve(d)).ok,true)
  const rows=(await q('select * from ledger_entries where document_id=$1',[d.id])).rows
  assert.equal(rows.length,2);assert.ok(rows.every(r=>r.document_invoice_id===d.prepared.analysis_result.invoices[0]._id))
  const view=await manage(rows[0].id)
  assert.equal((await manage(rows[0].id,'update',view.version,{from:'bank:'+b2,to:'cash',amount:55,date:'2026-11-06',reason:'Reviewed'})).ok,true)
  const updated=await manage(rows[0].id)
  assert.equal((await manage(rows[0].id,'delete',updated.version,{reason:'Reopen for review'})).ok,true)
  assert.equal((await one('select status from documents where id=$1',[d.id])).status,'analyzed')
  d.prepared=await rpc(acc,'approval_prepare',[d.id]);d.request=randomUUID()
  assert.equal((await approve(d)).ok,true)
  assert.equal((await one('select count(*)::int n from ledger_entries where document_id=$1',[d.id])).n,2)
 }
 check('document approval, retry, both-leg correction and reopening/reapproval are atomic')
 const corrected=await doc('cash','bank:'+b1,26);assert.equal((await approve(corrected)).ok,true)
 const invoiceId=corrected.prepared.analysis_result.invoices[0]._id
 const prep=await rpc(acc,'approval_correction_prepare',[corrected.id,invoiceId]);assert.equal(prep.ok,true)
 const oldJournal=prep.corrected_invoice.journal_number
 const payload={...prep.analysis_result.invoices[0],amount:27,totalAmount:27,internalTransfer:{from:'bank:'+b2,to:'cash'}}
 const correction=await rpc(acc,'approval_correct_invoice',[corrected.id,invoiceId,randomUUID(),prep.version,payload,'Corrected from invoice editor',{},{}])
 assert.equal(correction.ok,true,JSON.stringify(correction))
 const correctedRows=(await q('select * from ledger_entries where document_id=$1',[corrected.id])).rows
 assert.equal(correctedRows.length,2);assert.ok(correctedRows.every(r=>r.journal_number===oldJournal));assert.equal((await manage(correctedRows[0].id)).amount,27)
 check('existing whole-invoice correction retains the journal and replaces both transfer legs')

 const bad=await doc('cash','bank:'+foreign);assert.equal((await approve(bad)).ok,false)
 assert.equal((await one('select count(*)::int n from ledger_entries where document_id=$1',[bad.id])).n,0)
 // Force failure after the first ledger leg: the RPC transaction must leave no rows or pair.
 await db.exec("create function public.fail_transfer_test() returns trigger language plpgsql as $$begin if new.type='🔄 تحويل داخلي' and new.bank_in>0 then raise exception 'forced second-leg failure'; end if;return new;end$$; create trigger fail_transfer_test before insert on ledger_entries for each row execute function fail_transfer_test()")
 const beforeFail=await count();assert.equal((await create('cash','bank:'+b1)).ok,false);assert.equal(await count(),beforeFail)
 await db.exec('drop trigger fail_transfer_test on ledger_entries;drop function fail_transfer_test()')
 await q('delete from auth.sessions where id=$1',[f.sessions[acc]])
 assert.equal((await create('cash','bank:'+b1)).code,'no_session')
 assert.equal((await one("select has_function_privilege('anon','public.internal_transfer_create(uuid,date,numeric,text,text,text)','execute') allowed")).allowed,false)
 check('failed approval/second leg rolls back; revoked session and anonymous access blocked')
} catch(e){console.error(e.message,e.where||'');process.exitCode=1}finally{await db.close()}
