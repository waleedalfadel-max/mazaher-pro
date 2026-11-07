// Production business functions in an isolated Postgres fixture. Never connects to a live database.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
if(!process.env.SUSPENSE_TEST_FIXTURE)throw new Error('Set SUSPENSE_TEST_FIXTURE to an isolated fixture module')
const {fixture}=await import(process.env.SUSPENSE_TEST_FIXTURE)
const f=await fixture(),{db,one,rpc,p1,p2,acc,owner,other,admin}=f
const check=s=>console.log('PASS',s), reason='سبب واضح بعد مطابقة المستندات', bank=randomUUID(),foreign=randomUUID(),category=randomUUID(),foreignCat=randomUUID(),supplier=randomUUID(),payable=randomUUID()
const call=(u,action,c=null,p={},request=null)=>rpc(u,'suspense_write',[action,c?.id||null,c?.version||null,p,request])
const get=id=>one('select * from suspense_cases where id=$1',[id])
const source=c=>one('select * from ledger_entries where id=$1',[c.entry_id])
const make=async(direction='out',amount=100,account='cash')=>{const r=await call(acc,'new',null,{amount,date:'2026-10-01',direction,account,reason,confirmed:true},randomUUID());assert.equal(r.ok,true,JSON.stringify(r));return get(r.id)}
const propose=async(c,p)=>{const r=await call(acc,'propose',c,{reason,...p});assert.equal(r.ok,true,JSON.stringify(r));return get(c.id)}
const approve=async c=>{const r=await call(owner,'approve',c,{confirmed:true});assert.equal(r.ok,true,JSON.stringify(r));return get(c.id)}
try{
 const before=(await db.query('select * from ledger_entries')).rows
 await db.exec(await readFile('supabase/migrations/20261107163108_suspense_review.sql','utf8'))
 assert.deepEqual((await db.query('select * from ledger_entries')).rows,before);check('migration does not change existing movements')
 await db.query("insert into bank_accounts(id,project_id,name) values($1,$3,'Main'),($2,$4,'Foreign')",[bank,foreign,p1,p2])
 await db.query("insert into categories(id,project_id,name,financial_class,ledger_type) values($1,$3,'مستلزمات','opex','🛒 مصروفات تشغيلية'),($2,$4,'Foreign','opex','🛒 مصروفات تشغيلية')",[category,foreignCat,p1,p2])
 await db.query("update project_settings set settings=$2 where project_id=$1",[p1,{branches:['Main'],onboarding:{tax:{status:'مسجل'}}}])
 const payload={amount:53.58,date:'2026-10-01',direction:'in',account:'bank:'+bank,reason,confirmed:true},req=randomUUID()
 const first=await call(acc,'new',null,payload,req);assert.equal(first.ok,true)
 assert.equal((await call(acc,'new',null,payload,req)).id,first.id)
 assert.equal((await call(acc,'new',null,{...payload,amount:54},req)).code,'request_conflict')
 assert.equal((await one('select count(*)::int n from ledger_entries')).n,1)
 let c=await get(first.id);let e=await source(c);assert.equal(Number(e.bank_in),53.58);assert.equal(e.output_vat_amount,null);check('new difference is recorded once; request retries and conflicts are safe')
 for(const bad of [{amount:'NaN'},{amount:'Infinity'},{amount:1.001},{date:'garbage'},{date:'2100-01-01'},{account:'bank:'+foreign},{confirmed:false},{reason:'x'}])assert.equal((await call(acc,'new',null,{...payload,...bad},randomUUID())).ok,false,JSON.stringify(bad))
 assert.equal((await one('select count(*)::int n from ledger_entries')).n,1);check('bad amounts, dates, confirmations and foreign accounts create nothing')
 assert.equal((await call(other,'propose',c,{kind:'expense',category_id:category,reason})).code,'not_found')
 assert.equal((await call(acc,'propose',c,{kind:'expense',category_id:foreignCat,reason})).code,'category_required')
 c=await propose(c,{kind:'sales',vat:0,branch:'Main'});assert.equal((await source(c)).type,'فروقات قيد المراجعة')
 assert.equal((await call(acc,'approve',c,{confirmed:true})).code,'owner_required');assert.equal((await call(admin,'approve',c,{confirmed:true})).code,'owner_required')
 assert.equal((await call(owner,'approve',{...c,version:1},{confirmed:true})).code,'stale');assert.equal((await call(owner,'approve',c,{})).code,'confirmation_required')
 c=await approve(c);assert.equal((await source(c)).type,'💸 مبيعات تحويل');assert.equal(Number((await source(c)).bank_in),53.58)
 assert.equal((await call(owner,'approve',c,{confirmed:true})).resolved,true);check('only actual owner approves; stale and unconfirmed requests fail; retries do not duplicate')
 const restricted=async(sql,args)=>{await f.claims(acc);await db.exec('set role authenticated');try{await assert.rejects(db.query(sql,args))}finally{await db.exec('reset role')}}
 await restricted("update ledger_entries set bank_in=999 where id=$1",[c.entry_id]);await restricted('delete from ledger_entries where id=$1',[c.entry_id]);await restricted("update suspense_cases set status='resolved' where id=$1",[c.id]);await restricted('delete from suspense_events where case_id=$1',[c.id]);check('source and audit cannot be edited or deleted around owner review')
 // Existing eligible movement is linked without adding another physical movement.
 const old=randomUUID();await db.query("insert into ledger_entries(id,project_id,date,type,description,total_amount,cash_out,status,journal_number) values($1,$2,'2026-10-02','تسوية مطابقة بنكية','Existing difference',31,31,'approved','OLD-1')",[old,p1]);const n=(await one('select count(*)::int n from ledger_entries')).n
 const opened=await call(acc,'open',null,{entry_id:old,reason});assert.equal(opened.ok,true);assert.equal((await call(acc,'open',null,{entry_id:old,reason})).id,opened.id);assert.equal((await one('select count(*)::int n from ledger_entries')).n,n)
 c=await get(opened.id);c=await propose(c,{kind:'expense',category_id:category,vat:1})
 await db.query('update categories set is_active=false where id=$1',[category]);assert.equal((await call(owner,'approve',c,{confirmed:true})).code,'category_required');assert.equal((await get(c.id)).status,'proposed');await db.query('update categories set is_active=true where id=$1',[category]);c=await approve(c);assert.equal(Number((await source(c)).cash_out),31);assert.equal(Number((await source(c)).vat_amount),1);check('existing source is linked once; approval revalidates category; VAT and money preserved')
 c=await make('out');c=await propose(c,{kind:'shortage'});assert.equal((await call(owner,'return',c,{reason})).ok,true);c=await get(c.id);assert.equal(c.status,'open');assert.equal(c.proposal,null);c=await propose(c,{kind:'withdrawal'});c=await approve(c);assert.equal((await source(c)).type,'مسحوبات الشركاء');check('owner return preserves history and requires a fresh proposal')
 c=await make('in',54);c=await propose(c,{kind:'liability'});c=await approve(c);assert.equal((await source(c)).type,'حوالة واردة بالخطأ')
 c=await make('out',54);c=await propose(c,{kind:'liability'});c=await approve(c);assert.equal((await source(c)).type,'رد حوالات واردة بالخطأ');check('mistaken receipt and refund are liabilities, not sales or costs')
 c=await make('out',100,'bank:'+bank);c=await propose(c,{kind:'transfer',target:'cash'});c=await approve(c);assert.ok(c.counter_entry_id);const counter=await one('select * from ledger_entries where id=$1',[c.counter_entry_id]);assert.equal(Number(counter.cash_in),100);assert.equal(Number((await source(c)).bank_out),100);await approve(c);assert.equal((await one('select count(*)::int n from ledger_entries where journal_number=$1',[counter.journal_number])).n,2);check('transfer adds only the missing opposite leg once')
 await db.query("insert into suppliers(id,project_id,name,opening_balance) values($1,$2,'List supplier',200)",[supplier,p1])
 await db.query("insert into payable_suppliers(id,project_id,name) values($1,$2,'Payable supplier')",[payable,p1])
 await db.query("insert into ledger_entries(project_id,date,type,description,total_amount,payable_in,supplier_id,status,journal_number) values($1,'2026-09-01','مشتريات آجلة','Existing invoice',200,200,$2,'approved','INV-PAY')",[p1,payable])
 for(const[k,id]of[['list',supplier],['payable',payable]]){c=await make('out',50);c=await propose(c,{kind:'supplier',supplier_kind:k,supplier_id:id});c=await approve(c);assert.equal(Number((await source(c)).payable_out),50);assert.equal((await source(c)).supplier_id,k==='payable'?id:null);await approve(c)}
 assert.equal((await one("select count(*)::int n from supplier_transactions where supplier_id=$1 and type='payment'",[supplier])).n,1);check('both supplier systems lower the payable once without a second payment')
 c=await make('out',500);c=await propose(c,{kind:'supplier',supplier_kind:'list',supplier_id:supplier});assert.equal((await call(owner,'approve',c,{confirmed:true})).code,'exceeds_balance');assert.equal((await get(c.id)).status,'proposed');assert.equal((await source(c)).type,'فروقات قيد المراجعة');assert.equal((await one('select count(*)::int n from suspense_private.write_permits')).n,0);check('failed resolution rolls back financial writes and private permits')
 await f.claims(other);await db.exec('set role authenticated');assert.equal((await one('select count(*)::int n from suspense_cases')).n,0);assert.equal((await one('select count(*)::int n from suspense_events')).n,0);await db.exec('reset role');check('RLS separates tenants and event history')
 await db.query('delete from auth.sessions where id=$1',[f.sessions[owner]]);assert.equal((await call(owner,'approve',c,{confirmed:true})).code,'no_session');check('revoked owner session cannot approve')
 assert.equal((await one("select has_function_privilege('anon','public.suspense_write(text,uuid,integer,jsonb,uuid)','execute') allowed")).allowed,false)
 check('anonymous access is revoked')
 // Cashiers/purchasing cannot bypass the finance route; known classifications cannot enter suspense.
 for(const role of ['cashier','purchasing']){
  const u=randomUUID();f.sessions[u]=randomUUID();await db.query('insert into auth.users(id) values($1)',[u]);await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[f.sessions[u],u]);await db.query("insert into app_users(name,role,auth_id,project_id) values('Staff',$1,$2,$3)",[role,u,p1]);
  assert.equal((await call(u,'new',null,payload,randomUUID())).code,'forbidden');await f.claims(u);await db.exec('set role authenticated');assert.equal((await one('select count(*)::int n from suspense_cases')).n,0);await db.exec('reset role')
 }
 await restricted("insert into ledger_entries(project_id,date,type,total_amount,cash_out,status) values($1,'2026-10-01','فروقات قيد المراجعة',1,1,'approved')",[p1]);
 await restricted("delete from supplier_transactions where supplier_id=$1 and type='payment'",[supplier]);
 c=await make('in',115);for(const p of [{kind:'sales',vat:116,branch:'Main'},{kind:'sales',vat:15,branch:'Foreign'},{kind:'shortage'},{kind:'expense',category_id:category,vat:'NaN'}])assert.equal((await call(acc,'propose',c,{reason,...p})).ok,false)
 assert.equal((await one('select count(*)::int n from suspense_private.write_permits')).n,0);check('staff roles, direct inserts, linked supplier deletes and invalid sales/VAT are blocked')

} catch(e){console.error(e.message,e.where||'');process.exitCode=1}finally{await db.close()}
