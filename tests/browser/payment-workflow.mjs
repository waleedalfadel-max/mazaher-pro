// Real review page -> synthetic PostgreSQL fixture. No requests reach a hosted service.
import {build} from 'esbuild'
import {createRequire} from 'node:module'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
if(!process.env.PAYMENT_TEST_FIXTURE)throw new Error('An isolated synthetic fixture is required')
const {fixture}=await import(pathToFileURL(process.env.PAYMENT_TEST_FIXTURE));const f=await fixture()
const require=createRequire(import.meta.url);let playwright
try{playwright=require('playwright')}catch{playwright=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'../package.json'))('playwright')}
const dir=await mkdtemp(path.join(tmpdir(),'bank-workflow-ui-')),bundle=path.join(dir,'app.js')
const main=randomUUID(),purchase=randomUUID(),restricted=randomUUID(),category=randomUUID()
await f.db.query("insert into bank_accounts(id,project_id,name,branches) values($1,$4,'Primary',array['North']),($2,$4,'Purchases','{}'),($3,$4,'Restricted',array['South'])",[main,purchase,restricted,f.p1])
await f.db.query("insert into categories(id,project_id,name,type,ledger_type,financial_class) values($1,$2,'Synthetic expense','expense','🛒 مصروفات تشغيلية','opex')",[category,f.p1])
await f.db.query("insert into approval_private.settings(project_id,mode) values($1,'v2')",[f.p1])
const settings={branches:['North','South'],expenses_scope:'project',bank_workflow:{version:1,uploaders:{owner:{source:'bank',account_id:main},purchasing:{source:'bank',account_id:purchase},cashier:{source:'cash'}},network_by_branch:{North:main},apps_collection_account:restricted,accounts:{[restricted]:{operating_available:false,purpose:'Obligations'},[main]:{transfer_to:purchase}}}}
await f.db.query('update project_settings set settings=$2 where project_id=$1',[f.p1,JSON.stringify(settings)])
const expense={type:'expense',description:'Synthetic purchase',date:'2026-10-21',totalAmount:'25.00',vatAmount:'0',paySource:'custody',transType:'🛒 مصروفات تشغيلية',category_main:'Synthetic expense',items:[{description:'Synthetic item',amount:'25.00',category_main:'Synthetic expense'}]}
async function makeDoc(role,inv=expense){
 let user=role==='owner'?f.owner:null
 if(!user){user=randomUUID();const session=randomUUID();await f.db.query('insert into auth.users(id) values($1)',[user]);await f.db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,user]);f.sessions[user]=session;await f.db.query("insert into app_users(name,role,auth_id,project_id,branch,is_active) values('Synthetic uploader',$1,$2,$3,'North',true)",[role,user,f.p1])}
 await f.claims(user);const id=randomUUID();await f.db.query("insert into documents(id,project_id,file_name,status,analysis_result,uploaded_by,branch) values($1,$2,'Synthetic document','analyzed',$3,$4,'North')",[id,f.p1,JSON.stringify(inv),role]);return id
}
const doc=await makeDoc('owner'),pdoc=await makeDoc('purchasing'),cdoc=await makeDoc('cashier')
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import Pending from './src/pages/PendingDocuments.jsx';import Controls from './src/pages/AdminBusinessSettings.jsx';import Manage from './src/components/BankTransferManage.jsx';const root=createRoot(document.getElementById('root'));let n=0;window.mount=(doc,kind='pending',props={})=>{root.render(<MemoryRouter key={++n} initialEntries={['/pending?doc='+doc]}>{kind==='admin'?<Controls/>:kind==='manage'?<Manage {...props} onClose={()=>window.closed=true} onSaved={()=>window.saved=true}/>:<Pending/>}</MemoryRouter>)};`,resolveDir:process.cwd(),sourcefile:'bank-workflow-ui.jsx',loader:'jsx'},outfile:bundle,bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-transport',setup(b){
 b.onLoad({filter:/[\\/]contexts[\\/]AuthContext\.jsx$/},()=>({contents:'export const useAuth=()=>window.auth',loader:'js'}))
 b.onLoad({filter:/[\\/]lib[\\/]projectSettings\.js$/},()=>({contents:`export const getProjectSettings=async()=>({settings:window.settings});export const getTransactionTypes=async()=>['🛒 مصروفات تشغيلية','📥 تحصيل ذمم هنقر','🔄 تحويل داخلي — بين الحسابات البنكية'];export const clearProjectCache=()=>{};`,loader:'js'}))
 b.onLoad({filter:/[\\/]lib[\\/]supabase\.js$/},()=>({contents:`class Query{constructor(table){this.table=table;this.filters=[]}select(c){this.columns=c;return this}eq(k,v){this.filters.push(['eq',k,v]);return this}in(k,v){this.filters.push(['in',k,v]);return this}order(){return this}limit(){return this}single(){this.singleRow=true;return this}then(resolve,reject){return window.dbSelect(this.table,this.filters,this.columns,this.singleRow).then(resolve,reject)}}export const supabase={from:t=>new Query(t),rpc:async(n,a={})=>{const data=await window.dbRpc(n,a);if(n==='approval_approve')window.lastApproval=data;return {data}},auth:{getSession:async()=>({data:{session:{user:{id:window.auth.userId}}}})}};`,loader:'js'}))
}}],logLevel:'warning'})
const browser=await playwright.chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--disable-dev-shm-usage',...JSON.parse(process.env.CHROMIUM_ARGS||'[]')]})
const page=await browser.newPage({viewport:{width:1200,height:1100}});page.setDefaultTimeout(8000)
let queue=Promise.resolve(),checks=0;const errors=[];const serial=run=>{const p=queue.then(run);queue=p.catch(()=>{});return p}
const check=n=>{checks++;console.log('PASS '+n)}
page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept())
await page.route('**/*',r=>r.request().url()==='http://fixture.local/'?r.fulfill({contentType:'text/html',body:'<html dir="rtl"><body><div id="root"></div></body></html>'}):r.abort())
await page.exposeFunction('dbSelect',(table,filters,columns,single)=>serial(async()=>{
 if(!['documents','categories','suppliers','payable_suppliers','bank_accounts','item_category_rules'].includes(table))throw new Error('Unexpected table '+table)
 const args=[];const where=filters.map(([op,k,v])=>{if(!/^[a-z_]+$/.test(k))throw new Error('Invalid column');args.push(v);return op==='in'?`${k}=any($${args.length})`:`${k}=$${args.length}`}).join(' and ')
 const result=await f.db.query(`select * from public.${table}${where?' where '+where:''}`,args)
 return {data:single?result.rows[0]||null:result.rows,error:null}
}))
await page.exposeFunction('dbRpc',(name,args)=>serial(async()=>{
 if(!['approval_mode','approval_prepare','approval_approve','supplier_payment_context','admin_business_settings','admin_bank_workflow_save','bank_transfer_manage'].includes(name))throw new Error('Unexpected RPC '+name)
 const keys=Object.keys(args);await f.claims((await page.evaluate(()=>window.auth.role))==='superadmin'?f.admin:f.acc);await f.db.exec('set role authenticated')
 try{return(await f.one(`select public.${name}(${keys.map((k,i)=>k+' => $'+(i+1)).join(',')}) as result`,Object.values(args).map(x=>x&&typeof x==='object'?JSON.stringify(x):x))).result}finally{await f.db.exec('reset role')}
}))
async function mount(id,role='accountant',kind='pending',props={}){await page.evaluate(({id,role,kind,props,settings,projectId,userId})=>{window.settings=settings;window.auth={projectId,userId,role,isSuperAdmin:role==='superadmin',viewState:'ok',canEdit:true,projectName:'Synthetic A'};window.mount(id,kind,props)},{id,role,kind,props,settings,projectId:f.p1,userId:role==='superadmin'?f.admin:f.acc})}
const account=()=>page.locator('[data-k="bank-account"]')
try{
 await page.goto('http://fixture.local/');await page.addScriptTag({path:bundle});await mount(doc)
 await page.getByText(/المصدر المقترح لأن الرافع المالك/).waitFor();assert.equal(await account().inputValue(),main);check('real review page suggests owner main account')
 await account().selectOption(purchase);await page.getByText(/مسودة محفوظة في هذه النافذة فقط/).first().waitFor();await mount(doc);await account().waitFor();assert.equal(await account().inputValue(),purchase);check('manual account survives page remount with real browser draft')
 await account().selectOption('');await mount(doc);await account().waitFor();assert.equal(await account().inputValue(),'');check('explicitly cleared choice is not replaced on reload')
 await account().selectOption(purchase);await page.evaluate(()=>window.lastApproval=null);await page.getByRole('button',{name:'اعتماد',exact:true}).click();await page.waitForFunction(()=>window.lastApproval);assert.equal((await page.evaluate(()=>window.lastApproval)).ok,true);await queue
 const leg=await f.one('select bank_account_id,bank_out from ledger_entries where document_id=$1',[doc]);assert.equal(leg.bank_account_id,purchase);assert.equal(Number(leg.bank_out),25);check('visible overridden account reaches actual approval and ledger')
 await mount(pdoc);await page.getByText(/المصدر المقترح لأن الرافع مسؤول المشتريات/).waitFor();assert.equal(await account().inputValue(),purchase);check('purchasing upload suggests purchases account')
 await mount(cdoc);await page.getByText(/المصدر المقترح لأن الرافع الكاشير/).waitFor();assert.equal(await page.getByLabel('مصدر الدفع',{exact:true}).inputValue(),'cash');assert.equal(await account().count(),0);check('cashier upload suggests cash box')
 const transfer=await makeDoc('owner',{type:'transfer',transType:'🔄 تحويل داخلي — بين الحسابات البنكية',paySource:'bank',amount:35,date:'2026-10-21',description:'Synthetic bank transfer'})
 await mount(transfer);await page.locator('[data-k="bank-transfer-from"]').selectOption(main);assert.equal(await page.locator('[data-k="bank-transfer-to"]').inputValue(),purchase)
 await page.evaluate(()=>window.lastApproval=null);await page.getByRole('button',{name:'اعتماد',exact:true}).click();await page.waitForFunction(()=>window.lastApproval);assert.equal((await page.evaluate(()=>window.lastApproval)).ok,true);await queue
 const pair=await f.one('select * from approval_private.bank_transfers where project_id=$1',[f.p1]);assert(pair);check('bank transfer shows suggested destination and approves both ledger legs')
 const banks=(await f.db.query('select * from bank_accounts where project_id=$1',[f.p1])).rows
 await mount('', 'superadmin','manage',{invoiceId:pair.invoice_id,action:'update',accounts:banks});await page.getByLabel('مبلغ التحويل',{exact:true}).fill('39.50');await page.getByLabel('سبب الإجراء').fill('Reviewed on screen');await page.getByRole('button',{name:'حفظ طرفي التحويل'}).click();await page.waitForFunction(()=>window.saved)
 const updated=await f.rpc(f.admin,'bank_transfer_manage',[pair.invoice_id]);assert.equal(updated.source.bank_out,39.5);assert.equal(updated.destination.bank_in,39.5);check('bank transfer dialog edits both sides from actual screen')
 await mount('', 'superadmin','admin');await page.getByRole('tab',{name:'الحسابات البنكية',exact:true}).click();await page.getByLabel('المصدر المقترح عند رفع المالك').selectOption(purchase);await page.getByRole('button',{name:'حفظ مهام الحسابات'}).click();await page.getByText('حُفظت مهام الحسابات وسُجّل التعديل باسم إدارة تحسيب.').waitFor();const stored=await f.one('select settings from project_settings where project_id=$1',[f.p1]);assert.equal(stored.settings.bank_workflow.uploaders.owner.account_id,purchase);check('admin workflow screen persists to actual database')
 assert.deepEqual(errors,[]);check('no page errors')
 console.log(JSON.stringify({passed:checks}))
}finally{await queue;await browser.close();await f.db.close();await rm(dir,{recursive:true,force:true})}
