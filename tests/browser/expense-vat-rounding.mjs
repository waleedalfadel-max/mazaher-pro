// Real review page -> synthetic PostgreSQL fixture. No requests reach a hosted service.
import {build} from 'esbuild'
import {createRequire} from 'node:module'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
if(!process.env.VAT_TEST_FIXTURE)throw new Error('An isolated synthetic fixture is required')
const {fixture}=await import(pathToFileURL(process.env.VAT_TEST_FIXTURE));const f=await fixture();await f.db.exec(await readFile(process.env.VAT_MIGRATION || 'supabase/migrations/20261107104425_invoice_vat_rounding.sql','utf8'))
const require=createRequire(import.meta.url);let playwright
try{playwright=require('playwright')}catch{playwright=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'../package.json'))('playwright')}
const dir=await mkdtemp(path.join(tmpdir(),'expense-vat-ui-')),bundle=path.join(dir,'app.js')
const main=randomUUID(),purchase=randomUUID(),restricted=randomUUID(),network=randomUUID(),category=randomUUID()
await f.db.query("insert into bank_accounts(id,project_id,name,branches) values($1,$4,'Primary',array['North']),($2,$4,'Purchases','{}'),($3,$4,'Restricted','{}')",[main,purchase,restricted,f.p1])
await f.db.query("insert into bank_accounts(id,project_id,name,branches) values($1,$2,'Network bank','{}')",[network,f.p1])
await f.db.query("insert into categories(id,project_id,name,type,ledger_type,financial_class) values($1,$2,'Synthetic expense','expense','🛒 مصروفات تشغيلية','opex')",[category,f.p1])

const settings={branches:['North','South'],expenses_scope:'project',bank_workflow:{version:1,uploaders:{owner:{source:'bank',account_id:main},purchasing:{source:'bank',account_id:purchase},cashier:{source:'cash'}},payment_name_accounts:[{label:'مدى 036',aliases:['مدى 036','Mada 036'],channel:'network',account_id:restricted}],network_by_branch:{North:network,South:network},transfer_by_branch:{North:main},apps_collection_account:restricted,accounts:{[restricted]:{operating_available:false,purpose:'Obligations'},[main]:{transfer_to:purchase}}}}
settings.pos_payment_accounts=settings.bank_workflow.payment_name_accounts;delete settings.bank_workflow.payment_name_accounts
await f.db.query('update project_settings set settings=$2 where project_id=$1',[f.p1,JSON.stringify(settings)])
const expense={type:'expense',description:'Synthetic purchase',date:'2026-10-21',totalAmount:'25.00',vatAmount:'0',paySource:'custody',transType:'🛒 مصروفات تشغيلية',category_main:'Synthetic expense',items:[{description:'Synthetic item',amount:'25.00',category_main:'Synthetic expense'}]}
async function makeDoc(role,inv=expense){
 let user=role==='owner'?f.owner:null
 if(!user){user=randomUUID();const session=randomUUID();await f.db.query('insert into auth.users(id) values($1)',[user]);await f.db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,user]);f.sessions[user]=session;await f.db.query("insert into app_users(name,role,auth_id,project_id,branch,is_active) values('Synthetic uploader',$1,$2,$3,'North',true)",[role,user,f.p1])}
 await f.claims(user);const id=randomUUID();await f.db.query("insert into documents(id,project_id,file_name,status,analysis_result,uploaded_by,branch) values($1,$2,'Synthetic document','analyzed',$3,$4,'North')",[id,f.p1,JSON.stringify(inv),role]);return id
}

await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import Pending from './src/pages/PendingDocuments.jsx';import Controls from './src/pages/AdminBusinessSettings.jsx';import Manage from './src/components/BankTransferManage.jsx';const root=createRoot(document.getElementById('root'));let n=0;window.mount=(doc,kind='pending',props={})=>{root.render(<MemoryRouter key={++n} initialEntries={['/pending?doc='+doc]}>{kind==='admin'?<Controls/>:kind==='manage'?<Manage {...props} onClose={()=>window.closed=true} onSaved={()=>window.saved=true}/>:<Pending/>}</MemoryRouter>)};`,resolveDir:process.cwd(),sourcefile:'expense-vat-ui.jsx',loader:'jsx'},outfile:bundle,bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-transport',setup(b){
 b.onLoad({filter:/[\\/]contexts[\\/]AuthContext\.jsx$/},()=>({contents:'export const useAuth=()=>window.auth',loader:'js'}))
 b.onLoad({filter:/[\\/]lib[\\/]projectSettings\.js$/},()=>({contents:`export const getProjectSettings=async()=>({settings:window.settings});export const getTransactionTypes=async()=>['🛒 مصروفات تشغيلية','📥 تحصيل ذمم هنقر','🔄 تحويل داخلي — بين الحسابات البنكية','💳 قرض ١'];export const clearProjectCache=()=>{};`,loader:'js'}))
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

try {
 await page.goto('http://fixture.local/');await page.addScriptTag({path:bundle})
 const invoice=()=>({type:'expense',description:'Synthetic supplier',invoiceNumber:randomUUID(),date:'2026-01-03',amountsBasis:'inclusive',totalAmount:82,vatAmount:10.7,paySource:'cash',transType:'🛒 مصروفات تشغيلية',
  items:[{description:'Synthetic A',category_main:'Synthetic expense',category_id:category,amount:52,lineNet:45.22,lineVat:6.78,printedLineTotal:52},
    {description:'Synthetic B',category_main:'Synthetic expense',category_id:category,amount:30,lineNet:26.09,lineVat:3.91,printedLineTotal:30}]})
 const first=invoice();first.vatAmount=10.69
 const third=invoice();third.items[1].lineNet=26.10
 const id=await makeDoc('cashier',{invoices:[first,invoice(),third]})
 await mount(id)
 const approve=page.getByRole('button',{name:'اعتماد 3 فواتير',exact:true})
 await approve.waitFor();await page.waitForFunction(()=>!document.body.textContent.includes('جارٍ تجهيز'))
 const panels=page.locator('.rp-subinv')
 await panels.nth(1).locator(':scope > summary').click()
 await panels.nth(1).locator('[data-k="vat-document-rounding"]').waitFor()
 assert.ok((await panels.nth(1).textContent()).includes('0.01'))
 check('rounding explanation visible for the affected invoice, unchanged 82 total')
 await approve.click();await page.waitForFunction(()=>window.lastApproval)
 assert.equal((await page.evaluate(()=>window.lastApproval)).ok,true,JSON.stringify(await page.evaluate(()=>window.lastApproval)))
 await queue
 const amounts=await f.one('select sum(total_amount)::float8 total,sum(vat_amount)::float8 vat from ledger_entries where document_id=$1',[id])
 assert.deepEqual(amounts,{total:246,vat:32.09})
 check('actual review page approves three invoices atomically with exact totals')
 const bad=invoice();bad.vatAmount=10.71
 const secondId=await makeDoc('cashier',{invoices:[invoice(),bad]})
 await page.evaluate(()=>window.lastApproval=null);await mount(secondId)
 await page.getByRole('button',{name:'اعتماد الفاتورتين',exact:true}).click()
 await page.waitForFunction(()=>window.lastApproval)
 assert.equal((await page.evaluate(()=>window.lastApproval)).code,'line_vat_conflict')
 await page.getByText(/فاتورة 2 — Synthetic supplier:/).waitFor()
 assert.equal(await page.locator('.rp-subinv').nth(1).getAttribute('open'),'')
 assert.equal(Number((await f.one('select count(*) n from ledger_entries where document_id=$1',[secondId])).n),0)
 check('unexplained discrepancy blocks writes and names and expands the affected invoice')
 assert.deepEqual(errors,[])
} finally {await browser.close();await f.db.close();await rm(dir,{recursive:true,force:true})}
