// Real React pages + isolated PostgreSQL data/RPC (real approval_prepare / approval_approve). Every outbound network request is blocked.
// 2026-11-01: a fully synthetic multi-category invoice whose totals are right but one line VAT was read as 0. Clicking approve is refused
// (line_vat_conflict) with nothing written; the reviewer corrects that line's VAT with a reason on the review screen and approves once;
// the line that is truly zero stays 0; the original reading, corrected value and reason are saved. A correction that no longer fits
// the amount or the VAT basis is not approved (blocked before sending); cancelling restores the original reading.
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

 // Fully synthetic multi-category invoice: the invoice totals are right (548.00, VAT 48.00), but line 3's VAT was read as 0 (printed 18.00).
 if(!(await f.db.query("select count(*)::int n from pg_proc where proname='item_vats'")).rows[0].n)await f.db.exec(await readFile('supabase/migrations/20261031130000_invoice_line_vat.sql','utf8'))
 const FOOD=randomUUID(),CLEAN=randomUUID()
 await f.db.query("insert into categories(id,project_id,name,type,ledger_type,financial_class) values($1,$3,'Synthetic food','expense','🥩 تكلفة البضاعة المباعة','cogs'),($2,$3,'Synthetic cleaning','expense','🛒 مصروفات تشغيلية','opex')",[FOOD,CLEAN,f.p1])
 const inv={type:'expense',transType:'🛒 مصروفات تشغيلية',paySource:'cash',date:'2026-10-20',description:'Synthetic supplier',invoiceNumber:'SYN-LV-1',amountsBasis:'exclusive',totalAmount:548,vatAmount:48,items:[
  {description:'Synthetic oil can',amount:200,lineNet:200,lineVat:30,printedLineTotal:230,category_main:'Synthetic food'},
  {description:'Synthetic gloves',amount:180,lineNet:180,lineVat:0,printedLineTotal:180,category_main:'Synthetic cleaning'},
  {description:'Synthetic detergent',amount:120,lineNet:120,lineVat:0,printedLineTotal:120,category_main:'Synthetic cleaning'}]}
 await f.claims(f.acc);const id=randomUUID()
 await f.db.query("insert into documents(id,project_id,file_name,status,analysis_result,branch) values($1,$2,'Synthetic line VAT invoice','analyzed',$3,'North')",[id,f.p1,JSON.stringify({invoices:[inv]})])
 const written=async()=>serial(async()=>(await f.one('select (select count(*)::int from ledger_entries where document_id=$1) ledger,(select count(*)::int from document_items where document_id=$1) items,(select status from documents where id=$1) status,(select count(*)::int from approval_private.document_invoices where document_id=$1 and status=$2) approved',[id,'approved'])))
 const approveBtn=page.getByRole('button',{name:'اعتماد',exact:true})
 await mount('/pending?doc='+id,'accountant');await approveBtn.waitFor();await page.waitForFunction(()=>!document.body.innerText.includes('جارٍ تجهيز'));await queue
 assert.match(await loc('line-vat-text-3').innerText(),/ضريبة البند المقروءة: 0\.00/)
 assert.match(await loc('line-vat-text-2').innerText(),/ضريبة البند المقروءة: 0\.00/)
 check('review screen shows each line\'s read VAT (line 2 and line 3 both read 0.00)')

 // 1. Approve as read: the server stops for review; nothing written; the read VAT is not dropped
 let calls=0;await page.exposeFunction('countApprove',()=>{calls++})
 await page.evaluate(()=>{window.lastApproval=null})
 await approveBtn.click();await page.waitForFunction(()=>window.lastApproval!==null);await queue
 assert.equal((await page.evaluate(()=>window.lastApproval)).code,'line_vat_conflict')
 const note=page.locator('.ts-note--error');await note.waitFor()
 assert.match(await note.innerText(),/مجموع ضريبة الأسطر المطبوعة 30\.00 لا يساوي ضريبة الفاتورة 48\.00.*لم يُسجَّل شيء/)
 assert.deepEqual(await written(),{ledger:0,items:0,status:'analyzed',approved:0})
 assert.match(await loc('line-vat-text-3').innerText(),/0\.00/);assert.match(await loc('line-vat-text-1').innerText(),/30\.00/)
 check('approve as read: stopped (line_vat_conflict, Arabic message with the figures); nothing written; read VAT kept on screen')

 // 2. Correction needs a reason; then the reviewer corrects line 3 only
 await loc('line-vat-fix-3').click()
 await page.getByLabel('ضريبة البند 3 المصححة').fill('18')
 await loc('line-vat-save-3').click()
 assert.match(await loc('line-vat-3').locator('[role=alert]').innerText(),/اكتب سبب تصحيح ضريبة البند/)
 await page.getByLabel('سبب تصحيح ضريبة البند 3').fill('قُرئت صفرًا والمطبوع في المستند 18.00')
 await loc('line-vat-save-3').click()
 assert.match(await loc('line-vat-text-3').innerText(),/صُحّحت: 0\.00 ← 18\.00 — قُرئت صفرًا والمطبوع في المستند 18\.00/)
 assert.match(await loc('line-vat-text-2').innerText(),/ضريبة البند المقروءة: 0\.00/)
 assert.deepEqual(await written(),{ledger:0,items:0,status:'analyzed',approved:0})
 check('correction requires a reason; line 3 corrected 0.00 → 18.00 with its reason; line 2 (true zero) untouched; still nothing written')

 // 2b. A correction that no longer fits the figures is not approved. For each change the cause is proven, not just a disabled button:
 //     the line warning, the reason shown for the blocked button is the stale correction itself, nothing is sent or written, and
 //     cancelling only the correction (other figures still changed) makes approval available — so no other condition blocked it.
 const totalInput=page.getByLabel('إجمالي المستند')
 const proveStale=async(label,why,msg)=>{
  assert.match(await loc('line-vat-stale-3').innerText(),new RegExp('تغيّر '+why+' بعد التصحيح'),label+' line warning')
  assert.equal(await approveBtn.isDisabled(),true,label+' approve disabled')
  assert.match(await loc('line-vat-stale-blocked').innerText(),msg,label+' reason shown for the blocked button')
  await page.evaluate(()=>{window.lastApproval=null});await approveBtn.click({force:true}).catch(()=>{});await queue
  assert.equal(await page.evaluate(()=>window.lastApproval),null,label+' not sent');assert.deepEqual(await written(),{ledger:0,items:0,status:'analyzed',approved:0},label+' nothing written')
  await loc('line-vat-undo-3').click()
  assert.equal(await loc('line-vat-stale-blocked').count(),0,label+' stale reason gone after cancel');assert.equal(await approveBtn.isEnabled(),true,label+' only the stale correction blocked approval')
  assert.match(await loc('line-vat-text-3').innerText(),/ضريبة البند المقروءة: 0\.00/,label+' original reading restored')}
 const recorrect=async()=>{await loc('line-vat-fix-3').click();await page.getByLabel('ضريبة البند 3 المصححة').fill('18');await page.getByLabel('سبب تصحيح ضريبة البند 3').fill('قُرئت صفرًا والمطبوع في المستند 18.00');await loc('line-vat-save-3').click()
  assert.match(await loc('line-vat-text-3').innerText(),/صُحّحت: 0\.00 ← 18\.00/);assert.equal(await loc('line-vat-stale-3').count(),0)}
 // amount: line 3 120 → 125 and line 1 200 → 195 (invoice totals still match)
 await page.getByLabel('مبلغ البند 3').fill('125');await page.getByLabel('مبلغ البند 1').fill('195')
 await proveStale('amount','مبلغ البند',/صُحّحت ضريبة البند 3 ثم تغيّر مبلغه؛ التصحيح القديم لا يُعتمد.*لم يُسجَّل شيء/)
 await page.getByLabel('مبلغ البند 3').fill('120');await page.getByLabel('مبلغ البند 1').fill('200');await recorrect()
 // basis: exclusive → inclusive, with the document total 500 so the totals still match under the new basis
 await page.getByRole('group',{name:'أساس مبالغ البنود'}).getByRole('button',{name:'البنود شاملة الضريبة',exact:true}).click();await totalInput.fill('500')
 await proveStale('basis','أساس الضريبة',/صُحّحت ضريبة البند 3 ثم تغيّر أساس الضريبة/)
 await page.getByRole('group',{name:'أساس مبالغ البنود'}).getByRole('button',{name:'البنود قبل الضريبة',exact:true}).click();await totalInput.fill('548');await recorrect()
 // line discount on line 3 after the correction (amount kept)
 await page.getByLabel('خصم البند 3').fill('5')
 await proveStale('discount','خصم البند',/صُحّحت ضريبة البند 3 ثم تغيّر خصمه/)
 await page.getByLabel('خصم البند 3').fill('');await recorrect()
 check('stale correction (amount, basis, line discount): line warning + blocked with the stale reason itself, nothing sent or written; cancelling only the correction re-enables approval (no other blocker); re-correcting restores a valid correction')

 // 3. Approve once with the correct details
 await page.evaluate(()=>{window.lastApproval=null});await approveBtn.click();await page.waitForFunction(()=>window.lastApproval?.ok===true);await queue
 assert.deepEqual(await written(),{ledger:2,items:3,status:'approved',approved:1})
 const items=(await serial(()=>f.db.query('select description,category_main,amount::float8 amount,vat_amount::float8 vat from document_items where document_id=$1 order by sort_order',[id]))).rows
 assert.deepEqual(items.map(i=>[i.description,i.category_main,i.amount,i.vat]),[['Synthetic oil can','Synthetic food',230,30],['Synthetic gloves','Synthetic cleaning',180,0],['Synthetic detergent','Synthetic cleaning',138,18]])
 const led=(await serial(()=>f.db.query('select category_main,cash_out::float8 gross,vat_amount::float8 vat from ledger_entries where document_id=$1 order by category_main',[id]))).rows
 assert.deepEqual(led.map(l=>[l.category_main,l.gross,l.vat]),[['Synthetic cleaning',318,18],['Synthetic food',230,30]])
 const di=await serial(()=>f.one('select approved_payload,original_reading,review_changes from approval_private.document_invoices where document_id=$1',[id]))
 const c=di.approved_payload.items[2].vatCorrection
 assert.deepEqual([c.original.lineVat,c.original.lineNet,c.original.printedLineTotal,c.value,c.reason,c.amount,c.discount,c.basis],[0,120,120,18,'قُرئت صفرًا والمطبوع في المستند 18.00',120,0,'exclusive'])
 assert.deepEqual([di.approved_payload.items[2].lineNet,di.approved_payload.items[2].printedLineTotal,Number(di.approved_payload.items[2].amount)],[120,138,120])
 assert.equal(di.approved_payload.items[2].lineVat,18);assert.equal(di.approved_payload.items[1].lineVat,0);assert.equal(di.approved_payload.items[1].vatCorrection,undefined)
 assert.equal(di.original_reading.items[2].lineVat,0,'original reading kept unchanged')
 assert.ok((di.review_changes||[]).some(s=>s.includes('بند 3 — ضريبة البند: «0» ← «18»؛ السبب: قُرئت صفرًا')),JSON.stringify(di.review_changes))
 check('approved once: items 230/30, 180/0, 138/18 in their categories; entries cleaning 318/18 and food 230/30; original reading, corrected value and reason saved')

 // 4. The approve button cannot approve again (document approved); still exactly one set of rows
 assert.equal(await page.getByRole('button',{name:'اعتماد',exact:true}).count(),0)
 assert.deepEqual(await written(),{ledger:2,items:3,status:'approved',approved:1})
 check('no second approval possible; rows written once')

 assert.deepEqual(errors,[]);check('no browser runtime errors')
 console.log('RESULT '+JSON.stringify({checks}))
}catch(e){console.log('DIAGNOSTIC '+JSON.stringify({errors,body:page?await page.locator('body').innerText().catch(()=>'?'):'none',queries:queries.slice(-6)}));throw e}finally{await queue;if(browser)await browser.close();await f.db.close()}
