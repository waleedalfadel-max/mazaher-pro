// Real review page -> synthetic PostgreSQL fixture. No requests reach a hosted service.
import {build} from 'esbuild'
import {createRequire} from 'node:module'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
if(!process.env.SALES_TEST_FIXTURE)throw new Error('An isolated synthetic fixture is required')
const {fixture}=await import(pathToFileURL(process.env.SALES_TEST_FIXTURE));const f=await fixture({migrate:false})
const require=createRequire(import.meta.url);let playwright
try{playwright=require('playwright')}catch{playwright=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'../package.json'))('playwright')}
const dir=await mkdtemp(path.join(tmpdir(),'sales-bank-ui-')),bundle=path.join(dir,'app.js')
import {normalizeSalesReading} from '../../src/lib/salesReport.js'
const card=randomUUID(),transfer=randomUUID()
const settings={branches:['North','South']}
await f.db.query("insert into bank_accounts(id,project_id,name,branches) values($1,$3,'Card account',array['North']),($2,$3,'Transfer account',array['North'])",[card,transfer,f.p1])
await f.db.query("insert into approval_private.settings(project_id,mode) values($1,'v2')",[f.p1])
const raw={type:'sales',date:'2026-01-05',paymentLines:[{label:'بنك - Bank',amount:624.75},{label:'كاش - Cash',amount:125.25}],returnLines:[],reportNetTotal:750}
async function makeDoc(inv){await f.claims(f.owner);const id=randomUUID();await f.db.query("insert into documents(id,project_id,file_name,status,analysis_result,uploaded_by,branch) values($1,$2,'Synthetic POS','analyzed',$3,'owner','North')",[id,f.p1,JSON.stringify(inv)]);return id}
const fresh=await makeDoc(normalizeSalesReading(raw))
const savedReading={...normalizeSalesReading(raw),date:'2026-01-06',networkSales:0,unknownPayments:[{label:'بنك - Bank',amount:'624.75',kind:'payment'}]}
const saved=await makeDoc(savedReading)
const mixed=await makeDoc(normalizeSalesReading({...raw,date:'2026-01-07',paymentLines:[...raw.paymentLines,{label:'Bank Transfer',amount:50}],reportNetTotal:800}))
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import Pending from './src/pages/PendingDocuments.jsx';const root=createRoot(document.getElementById('root'));let n=0;window.mount=(doc,kind='pending',props={})=>{root.render(<MemoryRouter key={++n} initialEntries={['/pending?doc='+doc]}><Pending/></MemoryRouter>)};`,resolveDir:process.cwd(),sourcefile:'sales-bank-ui.jsx',loader:'jsx'},outfile:bundle,bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-transport',setup(b){
 b.onLoad({filter:/[\\/]contexts[\\/]AuthContext\.jsx$/},()=>({contents:'export const useAuth=()=>window.auth',loader:'js'}))
 b.onLoad({filter:/[\\/]lib[\\/]projectSettings\.js$/},()=>({contents:`export const getProjectSettings=async()=>({settings:window.settings});export const getTransactionTypes=async()=>[];export const clearProjectCache=()=>{};`,loader:'js'}))
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
 if(!['approval_mode','approval_prepare','approval_approve','supplier_payment_context','admin_business_settings'].includes(name))throw new Error('Unexpected RPC '+name)
 const keys=Object.keys(args);await f.claims((await page.evaluate(()=>window.auth.role))==='superadmin'?f.admin:f.acc);await f.db.exec('set role authenticated')
 try{return(await f.one(`select public.${name}(${keys.map((k,i)=>k+' => $'+(i+1)).join(',')}) as result`,Object.values(args).map(x=>x&&typeof x==='object'?JSON.stringify(x):x))).result}finally{await f.db.exec('reset role')}
}))
async function mount(id,role='accountant',kind='pending',props={}){await page.evaluate(({id,role,kind,props,settings,projectId,userId})=>{window.settings=settings;window.auth={projectId,userId,role,isSuperAdmin:role==='superadmin',viewState:'ok',canEdit:true,projectName:'Synthetic A'};window.mount(id,kind,props)},{id,role,kind,props,settings,projectId:f.p1,userId:role==='superadmin'?f.admin:f.acc})}
const approve=()=>page.getByRole('button',{name:'اعتماد',exact:true})
async function submit(){await page.evaluate(()=>window.lastApproval=null);await approve().click();await page.waitForFunction(()=>window.lastApproval);assert.equal((await page.evaluate(()=>window.lastApproval)).ok,true);await queue}
async function verifyLedger(id,hasTransfer=false){
 const entries=(await f.db.query('select cash_in,bank_in,bank_account_id from ledger_entries where document_id=$1',[id])).rows
 const total=key=>entries.reduce((n,e)=>n+Number(e[key]||0),0)
 assert.equal(total('cash_in'),125.25);assert.equal(total('bank_in'),hasTransfer?674.75:624.75)
 assert.equal(entries.filter(e=>Number(e.bank_in)>0&&e.bank_account_id===card).reduce((n,e)=>n+Number(e.bank_in),0),624.75)
 if(hasTransfer)assert.equal(entries.filter(e=>e.bank_account_id===transfer).reduce((n,e)=>n+Number(e.bank_in),0),50)
}
try{
 await page.goto('http://fixture.local/');await page.addScriptTag({path:bundle});await mount(fresh)
 await page.locator('[data-k="bank-account"]').selectOption(card)
 assert.equal(await page.getByLabel('شبكة / مدى',{exact:true}).inputValue(),'624.75')
 assert.equal(await page.locator('[data-k="unknown-payment"]').count(),0)
 await submit();await verifyLedger(fresh);check('new Bank reading approves from actual screen into card account and cash box')
 await mount(saved);await page.locator('[data-k="unknown-channel-0"]').waitFor()
 assert.equal(await approve().isDisabled(),true);check('saved unresolved Bank remains blocked before reviewer assignment')
 await page.locator('[data-k="unknown-channel-0"]').selectOption('network');await page.locator('[data-k="unknown-apply-0"]').click()
 await page.locator('[data-k="bank-account"]').selectOption(card)
 assert.equal(await page.getByLabel('شبكة / مدى',{exact:true}).inputValue(),'624.75')
 assert.equal(await page.locator('[data-k="unknown-payment"]').count(),0)
 await submit();await verifyLedger(saved)
 const invoice=await f.one('select original_reading,approved_payload from approval_private.document_invoices where document_id=$1',[saved])
 assert.equal(invoice.original_reading.networkSales,0);assert.equal(invoice.original_reading.unknownPayments.length,1)
 assert.equal(invoice.approved_payload.networkSales,624.75);assert.equal(invoice.approved_payload.resolvedPayments[0].channel,'network')
 check('saved Bank mapping records reviewer decision, preserves original and reaches correct ledger once')
 await mount(mixed)
 await page.locator('[data-k="bank-account-network"]').selectOption(card)
 await page.locator('[data-k="bank-account-transfer"]').selectOption(transfer)
 await submit();await verifyLedger(mixed,true);check('explicit Bank Transfer remains separate on its chosen account')
 assert.deepEqual(errors,[]);check('no browser errors')
 console.log(JSON.stringify({passed:checks}))
}finally{await queue;await browser.close();await f.db.close();await rm(dir,{recursive:true,force:true})}
