// Real React pages + isolated PostgreSQL data/RPC + the real reading module with synthetic proxy replies. Every outbound network request is blocked.
// 2026-10-30: an unparseable reading reply (complete but invalid, or cut off) saves nothing, keeps an earlier reading,
// shows a short Arabic message without reply text and without widening the page, and the next valid reading works.
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
 await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route}from'react-router-dom';import Dashboard from './src/pages/Dashboard.jsx';import Accounts from './src/pages/Accounts.jsx';import Pending from './src/pages/PendingDocuments.jsx';import Reports from './src/pages/Reports.jsx';import Config from './src/components/AccountDashboardSettings.jsx';import{compressImage,fitImageBase64}from'./src/lib/imageCompress.js';import'./src/ui/fonts.js';import'./src/ui/theme.css';import'./src/ui/app.css';const root=createRoot(document.getElementById('root'));let n=0;window.imageFunctions={compressImage,fitImageBase64};window.mount=(route,config)=>root.render(<MemoryRouter key={++n} initialEntries={[route]}><Routes><Route path='/dashboard' element={<Dashboard/>}/><Route path='/accounts' element={<Accounts/>}/><Route path='/pending' element={<Pending/>}/><Route path='/reports' element={<Reports/>}/><Route path='/config' element={<Config settings={config?.settings||{}} banks={config?.banks||[]} onSaved={()=>{window.saved=true}}/>}/></Routes></MemoryRouter>);`,resolveDir:process.cwd(),sourcefile:'account-ui.jsx',loader:'jsx'},outfile:bundle,bundle:true,platform:'browser',format:'iife',jsx:'automatic',loader:{'.woff2':'dataurl','.woff':'dataurl'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-transport',setup(b){
 b.onLoad({filter:/[\\/]contexts[\\/]AuthContext\.jsx$/},()=>({contents:'export const useAuth=()=>window.auth',loader:'js'}))
 // Real reading module; only the network call is replaced: each request takes the next synthetic proxy reply.
 b.onLoad({filter:/[\\/]lib[\\/]analyzeRequest\.js$/},()=>({contents:'export const createAnalyzeFetch=()=>async init=>{const body=JSON.parse(init.body);window.readingRequests.push(body.max_tokens);const reply=window.replies.shift();if(!reply)throw new Error("no synthetic reply");return {ok:true,status:200,json:async()=>reply}};export const AUTH_ERROR_CODES=new Set();export class AnalysisAuthError extends Error{}',loader:'js'}))
 b.onLoad({filter:/[\\/]lib[\\/]supabase\.js$/},()=>({contents:queryStub,loader:'js'}))
 }}],logLevel:'warning'})
 browser=await playwright.chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--disable-dev-shm-usage',...JSON.parse(process.env.CHROMIUM_ARGS||'[]')]})
 page=await browser.newPage({viewport:{width:375,height:1000},timezoneId:'Asia/Riyadh'});page.setDefaultTimeout(10000)
 await page.clock.setFixedTime(new Date('2026-10-24T10:00:00Z'))
 page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept())
 await page.route('**/*',r=>r.request().url()==='http://fixture.local/'?r.fulfill({contentType:'text/html',body:'<html dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:12px"><div id="root"></div></body></html>'}):r.abort())
 const ident=s=>{assert.match(s,/^[a-z_]+$/);return s}
 const numeric=new Set(['cash_in','cash_out','bank_in','bank_out','custody_in','custody_out','receivable_in','receivable_out','payable_in','payable_out','total_amount','vat_amount','amount','opening_balance'])
 const wire=rows=>rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v instanceof Date?(k==='date'?v.toISOString().slice(0,10):v.toISOString()):numeric.has(k)&&v!=null?Number(v):v])))
 await page.exposeFunction('dbSelect',q=>serial(async()=>{
  assert(['ledger_entries','documents','categories','suppliers','supplier_transactions','payable_suppliers','bank_accounts','item_category_rules','project_settings','sales','document_items'].includes(q.table),'table '+q.table);queries.push(q)
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
  assert(['approval_mode','approval_prepare','approval_approve','supplier_payment_context','admin_account_dashboard_save','get_purchase_entries','document_reread_save','document_readings'].includes(name),'RPC '+name)
  const auth=await page.evaluate(()=>window.auth);await f.claims(auth.userId,auth.projectId);await f.db.exec('set role authenticated')
  try{if(name==='get_purchase_entries')return wire((await f.db.query(`select * from public.${name}(${Object.keys(args).map((k,i)=>ident(k)+' => $'+(i+1)).join(',')})`,Object.values(args))).rows);return(await f.one(`select public.${name}(${Object.keys(args).map((k,i)=>ident(k)+' => $'+(i+1)).join(',')}) result`,Object.values(args).map(x=>x&&typeof x==='object'?JSON.stringify(x):x))).result}finally{await f.db.exec('reset role')}
 }))
 async function mount(route,role='owner',config,projectId=f.p1){await page.evaluate(({route,role,config,projectId,userId})=>{window.saved=false;window.auth={projectId,userId,role,isSuperAdmin:role==='superadmin',viewState:'ok',canEdit:role!=='owner',projectName:'Synthetic Company',userName:'Synthetic reviewer',roleLabel:role};window.mount(route,config)},{route,role,config,projectId,userId:role==='superadmin'?f.admin:role==='owner'?f.owner:f.acc});await queue}
 const loc=k=>page.locator(`[data-k="${k}"]`)
 const number=async locator=>Number((await locator.innerText()).match(/-?\d[\d,]*(?:\.\d+)?/)[0].replaceAll(',',''))
 await page.goto('http://fixture.local/');await page.addStyleTag({path:dir+'/app.css'});await page.addScriptTag({path:bundle})

 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=300;c.height=500;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,300,500);x.fillStyle='black';x.fillText('Synthetic receipt',20,30);return c.toDataURL('image/png').split(',')[1]})
 const SECRET='SYNTHETIC-RECEIPT-TEXT'
 const reading=amount=>JSON.stringify({rotation:0,invoices:[{type:'expense',description:SECRET+' supplier',date:'2026-10-29',totalAmount:amount,vatAmount:0,amountsBasis:'inclusive',paySource:'cash',transType:'🛒 مصروفات تشغيلية',items:[{description:SECRET+' item',amount,category_main:'Synthetic expense'}]}]})
 // Proxy-shaped replies: a valid reading, and the content-free error the server returns for an unparseable reply.
 const ok=amount=>({content:[{type:'text',text:reading(amount)}],stop_reason:'end_turn'})
 const bad={error:'JSON_PARSE_ERROR',reason:'invalid',stopReason:'end_turn',outputTokens:300,length:992+SECRET.length,position:992}
 const cut={error:'JSON_PARSE_ERROR',reason:'truncated',stopReason:'max_tokens',outputTokens:4000,length:12000,position:null}
 async function uploaded(){await f.claims(f.acc);const id=randomUUID();await f.db.query("insert into documents(id,project_id,file_name,file_type,file_data,status,branch) values($1,$2,'Synthetic scan.png','image/png',$3,'uploaded','North')",[id,f.p1,png]);return id}
 const state=async id=>serial(()=>f.one('select status,version,analysis_result,(select count(*)::int from approval_private.document_readings r where r.document_id=d.id) readings,(select count(*)::int from approval_private.document_invoices i where i.document_id=d.id) invoices,(select count(*)::int from ledger_entries l where l.document_id=d.id) ledger from documents d where id=$1',[id]))
 const noOverflow=()=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1&&[...document.querySelectorAll('.ts-note')].every(n=>n.scrollWidth<=n.clientWidth+1))
 async function readNew(id,replies){await page.evaluate(r=>{window.replies=r;window.readingRequests=[]},replies);await page.getByRole('button',{name:'قراءة المستند',exact:true}).click();await page.waitForFunction(()=>!document.body.innerText.includes('جارٍ القراءة'));await queue;return page.evaluate(()=>window.readingRequests)}

 // 1. New document, the service sends an invalid reply twice: nothing saved, short message, no reply text, page not widened.
 const id=await uploaded();const before=await state(id)
 await mount('/pending?doc='+id,'accountant');await page.getByRole('button',{name:'قراءة المستند',exact:true}).waitFor()
 assert.deepEqual(await readNew(id,[bad,bad]),[4000,4000])
 const note=page.locator('.ts-note--error');await note.waitFor()
 assert.match(await note.innerText(),/وصل من خدمة القراءة رد غير صالح مرتين، ولم يُحفظ منه شيء\. اضغط «قراءة المستند» لإعادة المحاولة\./)
 const body=await page.locator('body').innerText();assert.ok(!body.includes(SECRET)&&!/JSON|position|النص الخام/.test(body),body.slice(0,400))
 assert.equal(await noOverflow(),true)
 assert.deepEqual(await state(id),before);assert.equal(before.status,'uploaded');assert.equal(before.analysis_result,null);assert.equal(before.ledger,0)
 check('invalid reply twice: nothing saved, short Arabic message with retry, no reply text, page not widened')

 // 2. The next attempt (one invalid reply, then a valid one) reads and saves the document; no approval, no entry.
 assert.deepEqual(await readNew(id,[bad,ok(136.5)]),[4000,4000])
 const read1=await state(id);assert.equal(read1.status,'analyzed');assert.equal(read1.analysis_result.invoices[0].totalAmount,136.5);assert.equal(read1.ledger,0)
 assert.equal(await page.locator('.ts-note--error').count(),0)
 check('next reading after the failure succeeds and is saved for review only (no entry)')

 // 3. A reply cut off at the length limit: retried once with a higher limit; a second cut-off saves nothing.
 const id2=await uploaded();await mount('/pending?doc='+id2,'accountant');await page.getByRole('button',{name:'قراءة المستند',exact:true}).waitFor()
 const before2=await state(id2)
 assert.deepEqual(await readNew(id2,[cut,cut]),[4000,8000])
 assert.match(await page.locator('.ts-note--error').innerText(),/رد غير صالح مرتين، ولم يُحفظ منه شيء/)
 assert.deepEqual(await state(id2),before2)
 check('cut-off reply: one retry with a higher limit, then nothing saved')

 // 4. Re-reading an analyzed document: an invalid reply twice keeps the earlier reading exactly; a valid one replaces it.
 await mount('/pending?doc='+id,'accountant');await loc('reread').waitFor();await page.waitForFunction(()=>!document.body.innerText.includes('جارٍ تجهيز'));await queue
 const kept=await state(id)
 await page.evaluate(r=>{window.replies=r;window.readingRequests=[]},[bad,bad]);await loc('reread').click();await loc('reread-confirm').click()
 await page.locator('.ts-note--error').waitFor();await queue
 assert.match(await page.locator('.ts-note--error').innerText(),/رد غير صالح مرتين، ولم يُحفظ منه شيء\. بقيت القراءة السابقة كما هي؛ يمكنك إعادة المحاولة\./)
 assert.deepEqual(await state(id),kept);assert.equal(kept.readings,0)
 assert.ok(!(await page.locator('body').innerText()).includes('JSON'));assert.equal(await noOverflow(),true)
 check('failed re-read keeps the earlier reading, version and review state unchanged; no entry')
 await page.evaluate(r=>{window.replies=r;window.readingRequests=[]},[ok(150)]);await loc('reread').click();await loc('reread-confirm').click()
 await page.waitForFunction(()=>window.readingRequests.length===1);await page.waitForFunction(()=>!document.querySelector('[data-k=reread-fields]')?.disabled);await queue
 const reread=await state(id);assert.equal(reread.analysis_result.invoices[0].totalAmount,150);assert.equal(reread.readings,1);assert.equal(reread.ledger,0)
 check('the following re-read succeeds; earlier reading archived, still no entry')

 assert.deepEqual(errors,[]);check('no browser runtime errors')
 console.log('RESULT '+JSON.stringify({checks,artifacts:dir}))
}catch(e){console.log('DIAGNOSTIC '+JSON.stringify({errors,body:page?await page.locator('body').innerText().catch(()=>'?'):'none',queries:queries.slice(-8)}));throw e}finally{await queue;if(browser)await browser.close();await f.db.close()}
