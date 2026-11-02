// Real React pages + isolated PostgreSQL data/RPC (real approval_approve / approval_correction_prepare / approval_correct_invoice). Every outbound
// network request is blocked. 2026-11-03: an approved synthetic invoice is corrected from the operations ledger: the ledger offers «تصحيح الفاتورة»
// instead of deletion for document entries (manual entries keep deletion); the correction page opens the approved invoice in the review editor,
// requires a reason, a duplicate invoice number is refused with nothing changed, then the corrected category is saved under the same journal number
// with the previous rows and the reason in the invoice history. Direct deletion of the document entry is refused by the database.
import {build} from 'esbuild'
import {createRequire} from 'node:module'
import {readFile,mkdtemp,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
if(!process.env.REREAD_TEST_FIXTURE)throw new Error('An isolated synthetic fixture is required')
const {fixture}=await import(pathToFileURL(process.env.REREAD_TEST_FIXTURE)),f=await fixture()
const require=createRequire(import.meta.url);let playwright
try{playwright=require('playwright')}catch{playwright=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'../package.json'))('playwright')}
const dir=await mkdtemp(path.join(tmpdir(),'reread-ui-')),bundle=path.join(dir,'app.js')
let browser,page,checks=0,queue=Promise.resolve();const errors=[],queries=[]
const check=n=>{checks++;console.log('PASS '+n)}
const serial=run=>{const r=queue.then(run);queue=r.catch(()=>{});return r}
const main=randomUUID(),purchase=randomUUID(),restricted=randomUUID(),category=randomUUID(),purchasingUser=randomUUID(),purchasingSession=randomUUID()
const workflow={version:1,uploaders:{owner:{source:'bank',account_id:main},purchasing:{source:'bank',account_id:purchase},cashier:{source:'cash'}},network_by_branch:{North:main,South:restricted},transfer_by_branch:{North:main},apps_collection_account:restricted,accounts:{[restricted]:{operating_available:false,purpose:'Synthetic obligations'}}}
const settings={branches:['North','South'],expenses_scope:'project',bank_workflow:workflow}
try{
 await f.db.exec(await readFile('supabase/migrations/20261024135418_account_dashboard.sql','utf8'))
 await f.db.exec(await readFile('supabase/migrations/20261025120000_document_reread.sql','utf8'))
 await f.db.query("insert into bank_accounts(id,project_id,name,branches) values($1,$4,'Synthetic Main',array['North']),($2,$4,'Synthetic Purchasing','{}'),($3,$4,'Synthetic Restricted',array['South'])",[main,purchase,restricted,f.p1])
 await f.db.query("insert into categories(id,project_id,name,type,ledger_type,financial_class) values($1,$2,'Synthetic expense','expense','🛒 مصروفات تشغيلية','opex')",[category,f.p1])
 await f.db.query("insert into approval_private.settings(project_id,mode) values($1,'v2')",[f.p1])
 await f.db.query('update project_settings set settings=$2 where project_id=$1',[f.p1,JSON.stringify(settings)])
 await f.db.query('insert into auth.users(id) values($1)',[purchasingUser]);await f.db.query('insert into auth.sessions(id,user_id) values($1,$2)',[purchasingSession,purchasingUser]);f.sessions[purchasingUser]=purchasingSession
 await f.db.query("insert into app_users(name,role,auth_id,project_id,is_active) values('Synthetic purchaser','purchasing',$1,$2,true)",[purchasingUser,f.p1])
 async function doc(inv,u=f.acc){await f.claims(u);const id=randomUUID();await f.db.query("insert into documents(id,project_id,file_name,status,analysis_result,branch) values($1,$2,'Synthetic invoice','analyzed',$3,'North')",[id,f.p1,JSON.stringify(inv)]);return id}
 async function approve(id){const prep=await f.rpc(f.acc,'approval_prepare',[id]);assert.equal(prep.ok,true);const result=await f.rpc(f.acc,'approval_approve',[id,randomUUID(),prep.version,JSON.stringify(prep.analysis_result.invoices),'{}','{}']);assert.equal(result.ok,true,JSON.stringify(result))}
 const queryStub=`class Query{constructor(table){this.table=table;this.filters=[];this.orders=[]}select(c){this.columns=c;return this}eq(k,v){this.filters.push(['eq',k,v]);return this}neq(k,v){this.filters.push(['neq',k,v]);return this}gte(k,v){this.filters.push(['gte',k,v]);return this}lte(k,v){this.filters.push(['lte',k,v]);return this}not(k,op,v){this.filters.push(['not',k,v,op]);return this}in(k,v){this.filters.push(['in',k,v]);return this}or(v){this.filters.push(['or','',v]);return this}order(k,o){this.orders.push([k,o?.ascending!==false]);return this}limit(v){this.max=v;return this}range(a,b){this.offset=a;this.max=b-a+1;return this}single(){this.singleRow=true;return this}maybeSingle(){this.singleRow=true;return this}update(v){this.patch=v;return this}then(resolve,reject){return (this.patch?window.dbUpdate:window.dbSelect)(JSON.parse(JSON.stringify(this))).then(resolve,reject)}}export const supabase={from:t=>new Query(t),rpc:async(n,a={})=>{if(n==='document_reread_save'&&window.delaySave){window.savingStarted=true;await new Promise(r=>window.finishSaving=r)}const data=await window.dbRpc(n,a);if(n==='approval_approve')window.lastApproval=data;if(n==='document_reread_save'&&window.loseSaveResponse){window.loseSaveResponse=false;return {error:{message:'Synthetic lost response'}}}return {data}},auth:{getSession:async()=>({data:{session:{user:{id:window.auth.userId}}}})}};export async function fetchAllRows(fn){let out=[],start=0;for(;;){const r=await fn().range(start,start+999);if(r.error)return r;if(!r.data.length)return {data:out,error:null};out.push(...r.data);start+=r.data.length}};`
 await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route}from'react-router-dom';import JournalLedger from './src/pages/JournalLedger.jsx';import CorrectInvoice from './src/pages/CorrectInvoice.jsx';import{compressImage,fitImageBase64}from'./src/lib/imageCompress.js';import'./src/ui/fonts.js';import'./src/ui/theme.css';import'./src/ui/app.css';const root=createRoot(document.getElementById('root'));let n=0;window.imageFunctions={compressImage,fitImageBase64};window.mount=(route,config)=>root.render(<MemoryRouter key={++n} initialEntries={[route]}><Routes><Route path='/operations' element={<JournalLedger unified/>}/><Route path='/correct/:docId/:invId' element={<CorrectInvoice/>}/></Routes></MemoryRouter>);`,resolveDir:process.cwd(),sourcefile:'account-ui.jsx',loader:'jsx'},outfile:bundle,bundle:true,platform:'browser',format:'iife',jsx:'automatic',loader:{'.woff2':'dataurl','.woff':'dataurl'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-transport',setup(b){
 b.onLoad({filter:/[\\/]contexts[\\/]AuthContext\.jsx$/},()=>({contents:'export const useAuth=()=>window.auth',loader:'js'}))
 // Real reading module; only the network call is replaced: each request takes the next synthetic proxy reply.
 b.onLoad({filter:/[\\/]lib[\\/]analyzeRequest\.js$/},()=>({contents:'export const createAnalyzeFetch=()=>async init=>{const body=JSON.parse(init.body);window.readingRequests.push(body.max_tokens);const reply=window.replies.shift();if(!reply)throw new Error("no synthetic reply");return {ok:true,status:200,json:async()=>reply}};export const AUTH_ERROR_CODES=new Set();export class AnalysisAuthError extends Error{}',loader:'js'}))
 b.onLoad({filter:/[\\/]lib[\\/]supabase\.js$/},()=>({contents:queryStub,loader:'js'}))
 }}],logLevel:'warning'})
 browser=await playwright.chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--disable-dev-shm-usage',...JSON.parse(process.env.CHROMIUM_ARGS||'[]')]})
 page=await browser.newPage({viewport:{width:1280,height:1000},timezoneId:'Asia/Riyadh'});page.setDefaultTimeout(10000)
 await page.clock.setFixedTime(new Date('2026-10-24T10:00:00Z'))
 page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept())
 await page.route('**/*',r=>r.request().url()==='http://fixture.local/'?r.fulfill({contentType:'text/html',body:'<html dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:12px"><div id="root"></div></body></html>'}):r.abort())
 const ident=s=>{assert.match(s,/^[a-z_]+$/);return s}
 const numeric=new Set(['cash_in','cash_out','bank_in','bank_out','custody_in','custody_out','receivable_in','receivable_out','payable_in','payable_out','total_amount','vat_amount','amount','opening_balance'])
 const wire=rows=>rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v instanceof Date?(k==='date'?v.toISOString().slice(0,10):v.toISOString()):numeric.has(k)&&v!=null?Number(v):v])))
 await page.exposeFunction('dbSelect',q=>serial(async()=>{
  assert(['ledger_entries','documents','categories','suppliers','supplier_transactions','payable_suppliers','bank_accounts','item_category_rules','project_settings','sales','document_items','attachments'].includes(q.table),'table '+q.table);queries.push(q)
  const args=[];const pred=([op,k,v,sub])=>{if(op==='or')return '('+v.split(',').map(x=>{const[k,o,...r]=x.split('.');return pred([o,k,r.join('.')==='null'?null:r.join('.')])}).join(' or ')+')';ident(k);if(op==='is')return k+' is null';if(op==='not'&&sub==='is')return k+' is not null';args.push(v);return `${k} ${op==='in'?'= any(':op==='neq'||op==='not'?'<>':op==='lte'?'<=':op==='gte'?'>=':'='}$${args.length}${op==='in'?')':''}`}
  const where=q.filters.map(pred).join(' and '),orders=q.orders.map(([k,asc])=>ident(k)+(asc?' asc':' desc')).join(',')
  const auth=await page.evaluate(()=>window.auth);await f.claims(auth.userId,auth.projectId);await f.db.exec('set role authenticated')
  try{const r=await f.db.query(`select * from public.${q.table}${where?' where '+where:''}${orders?' order by '+orders:''}${q.max!=null?' limit '+Number(q.max):''}${q.offset?' offset '+Number(q.offset):''}`,args);const rows=wire(r.rows);return {data:q.singleRow?rows[0]||null:rows,error:null}}
  finally{await f.db.exec('reset role')}
 }))
 // Only the reading save of PendingDocuments.analyze: documents.status/analysis_result by id, as the signed-in reviewer.
 await page.exposeFunction('dbUpdate',q=>serial(async()=>{
  assert.equal(q.table,'documents');assert.deepEqual(Object.keys(q.patch).sort(),['analysis_result','status']);assert.deepEqual(q.filters.map(x=>x.slice(0,2)),[['eq','id']])
  const auth=await page.evaluate(()=>window.auth);await f.claims(auth.userId,auth.projectId);await f.db.exec('set role authenticated')
  try{await f.db.query('update public.documents set status=$2,analysis_result=$3 where id=$1',[q.filters[0][2],q.patch.status,JSON.stringify(q.patch.analysis_result)]);return {data:null,error:null}}finally{await f.db.exec('reset role')}
 }))
 await page.exposeFunction('dbRpc',(name,args)=>serial(async()=>{
  assert(['approval_mode','approval_prepare','approval_approve','supplier_payment_context','admin_account_dashboard_save','get_purchase_entries','document_reread_save','document_readings','approval_correction_prepare','approval_correct_invoice'].includes(name),'RPC '+name)
  const auth=await page.evaluate(()=>window.auth);await f.claims(auth.userId,auth.projectId);await f.db.exec('set role authenticated')
  try{if(name==='get_purchase_entries')return wire((await f.db.query(`select * from public.${name}(${Object.keys(args).map((k,i)=>ident(k)+' => $'+(i+1)).join(',')})`,Object.values(args))).rows);return(await f.one(`select public.${name}(${Object.keys(args).map((k,i)=>ident(k)+' => $'+(i+1)).join(',')}) result`,Object.values(args).map(x=>x&&typeof x==='object'?JSON.stringify(x):x))).result}finally{await f.db.exec('reset role')}
 }))
 async function mount(route,role='owner',config,projectId=f.p1){await page.evaluate(({route,role,config,projectId,userId})=>{window.saved=false;window.auth={projectId,userId,role,isSuperAdmin:role==='superadmin',viewState:'ok',canEdit:role!=='owner',projectName:'Synthetic Company',userName:'Synthetic reviewer',roleLabel:role};window.mount(route,config)},{route,role,config,projectId,userId:role==='superadmin'?f.admin:role==='owner'?f.owner:f.acc});await queue}
 const loc=k=>page.locator(`[data-k="${k}"]`)
 const number=async locator=>Number((await locator.innerText()).match(/-?\d[\d,]*(?:\.\d+)?/)[0].replaceAll(',',''))
 await page.goto('http://fixture.local/');await page.addStyleTag({path:dir+'/app.css'});await page.addScriptTag({path:bundle})
 const FOOD=randomUUID(),CLEAN=randomUUID()
 await f.db.query("insert into categories(id,project_id,name,type,ledger_type,financial_class) values($1,$3,'Synthetic food','expense','🥩 تكلفة البضاعة المباعة','cogs'),($2,$3,'Synthetic cleaning','expense','🛒 مصروفات تشغيلية','opex')",[FOOD,CLEAN,f.p1])
 const base={type:'expense',transType:'🛒 مصروفات تشغيلية',paySource:'cash',date:'2026-10-20',amountsBasis:'inclusive',totalAmount:115,vatAmount:15}
 const first=await doc({...base,description:'Synthetic supplier',invoiceNumber:'SYN-CR-1',items:[{description:'Synthetic soap',amount:115,category_main:'Synthetic cleaning'}]})
 const other=await doc({...base,description:'Synthetic supplier',invoiceNumber:'SYN-CR-2',date:'2026-10-21',items:[{description:'Synthetic soap',amount:115,category_main:'Synthetic cleaning'}]})
 await approve(first);await approve(other)
 const inv=await f.one("select id,journal_number from approval_private.document_invoices where document_id=$1",[first]),jn=inv.journal_number
 const entry=await f.one("select id,category_id,financial_class from ledger_entries where document_invoice_id=$1",[inv.id])
 assert.equal(entry.category_id,CLEAN);assert.equal(entry.financial_class,'opex')
 await f.db.query("insert into ledger_entries(project_id,date,type,description,cash_out,total_amount,status,journal_number) values($1,'2026-10-22','🛒 مصروفات تشغيلية','Synthetic manual entry',10,10,'approved','QD-2026-900')",[f.p1])

 // 1. Operations ledger: the document entry offers correction, not deletion; the manual entry keeps deletion
 await mount('/operations','accountant')
 const docRow=page.locator('tr',{hasText:jn}).first(),manRow=page.locator('tr',{hasText:'QD-2026-900'}).first()
 await docRow.waitFor()
 assert.equal(await docRow.locator('[data-k="jl-correct"]').count(),1);assert.equal(await docRow.locator('.ldg-del').count(),0)
 assert.equal(await manRow.locator('.ldg-del').count(),1);assert.equal(await manRow.locator('[data-k="jl-correct"]').count(),0)
 check('ledger: document entry shows «تصحيح الفاتورة» and no delete; manual entry keeps delete')

 // 2. The correction page opens the approved invoice in the review editor
 await docRow.locator('[data-k="jl-correct"]').click()
 await loc('correct-invoice').waitFor();await page.getByText('القيد '+jn).first().waitFor()
 assert.equal(await page.getByLabel('وصف البند 1').inputValue(),'Synthetic soap')
 check('correction page opens the approved invoice ('+jn+') with its approved item')

 // 3. No reason: refused on the screen, nothing sent
 await page.getByLabel('التصنيف الأساسي للبند 1').selectOption({label:'Synthetic food'})
 await page.getByRole('button',{name:'حفظ التصحيح'}).click()
 await loc('correct-error').waitFor();assert.match(await loc('correct-error').innerText(),/سبب/)
 assert.equal((await f.one("select category_id from ledger_entries where document_invoice_id=$1",[inv.id])).category_id,CLEAN)
 check('without a reason the correction is refused on the screen and nothing changes')

 // 4. Duplicate invoice number (the other approved invoice of the same supplier): refused by the server, nothing changed
 const snapshot=async()=>JSON.stringify((await f.db.query("select id,category_id,cash_out,journal_number from ledger_entries where project_id=$1 order by id",[f.p1])).rows)
 const before=await snapshot()
 const prepDup=await f.rpc(f.acc,'approval_correction_prepare',[first,inv.id])
 const dup=await f.rpc(f.acc,'approval_correct_invoice',[first,inv.id,randomUUID(),prepDup.version,JSON.stringify({...base,_id:inv.id,description:'Synthetic supplier',invoiceNumber:'SYN-CR-2',items:[{description:'Synthetic soap',amount:115,category_id:CLEAN}]}),'dup','{}','{}'])
 assert.equal(dup.code,'duplicate_invoice');assert.equal(await snapshot(),before)
 check('correcting into another approved invoice number is refused (duplicate_invoice) with nothing changed')

 // 5. Save from the screen: corrected category under the same journal number, no number consumed, history keeps reason and previous rows
 await loc('correct-reason').fill('Synthetic: wrong category')
 await page.getByRole('button',{name:'حفظ التصحيح'}).click()
 await loc('correct-done').waitFor();assert.match(await loc('correct-done').innerText(),new RegExp(jn))
 const after=await f.one("select id,category_id,financial_class,journal_number,cash_out from ledger_entries where document_invoice_id=$1",[inv.id])
 assert.notEqual(after.id,entry.id);assert.equal(after.category_id,FOOD);assert.equal(after.financial_class,'cogs');assert.equal(after.journal_number,jn);assert.equal(Number(after.cash_out),115)
 // the next approval takes the number it would have taken without the correction (manual QD-2026-900 is the highest): no gap
 const third=await doc({...base,description:'Synthetic supplier',invoiceNumber:'SYN-CR-3',date:'2026-10-23',items:[{description:'Synthetic soap',amount:115,category_main:'Synthetic cleaning'}]})
 await approve(third)
 assert.equal((await f.one("select journal_number from approval_private.document_invoices where document_id=$1",[third])).journal_number,'QD-2026-901')
 const h=(await f.one("select history->-1 h from approval_private.document_invoices where id=$1",[inv.id])).h
 assert.equal(h.event,'corrected');assert.equal(h.reason,'Synthetic: wrong category');assert.equal(h.previous.ledger[0].category_id,CLEAN)
 check('saved: category food/cogs under the same '+jn+', next approval takes QD-2026-901 (no gap), history keeps reason and previous category')

 // 6. Direct deletion of the document entry is refused by the database, as the signed-in accountant
 await f.claims(f.acc);await f.db.exec('set role authenticated')
 let blocked=false;try{await f.db.query('delete from ledger_entries where id=$1',[after.id])}catch(e){blocked=/تصحيح/.test(e.message)}finally{await f.db.exec('reset role')}
 assert.ok(blocked);check('direct deletion of the document entry is refused with the correction message')

 assert.deepEqual(errors,[]);check('no browser runtime errors')
 console.log('RESULT '+JSON.stringify({checks}))
}catch(e){console.log('DIAGNOSTIC '+JSON.stringify({errors,body:page?await page.locator('body').innerText().catch(()=>'?'):'none',queries:queries.slice(-6)}));throw e}finally{await queue;if(browser)await browser.close();await f.db.close()}
