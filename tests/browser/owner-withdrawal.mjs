// Real review page -> synthetic PostgreSQL fixture. No requests reach a hosted service.
import {build} from 'esbuild'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
if(!process.env.WITHDRAWAL_TEST_FIXTURE)throw new Error('An isolated synthetic fixture is required')
const {fixture}=await import(pathToFileURL(process.env.WITHDRAWAL_TEST_FIXTURE));const f=await fixture({migrate:false})
const playwright=await import(process.env.BROWSER_TEST_PLAYWRIGHT || 'playwright')
const dir=await mkdtemp(path.join(tmpdir(),'loan-ui-')),bundle=path.join(dir,'app.js')
import {isRealExpense} from '../../src/lib/financeRules.js'
const card=randomUUID(),otherBank=randomUUID()
const types=['🛒 مصروفات تشغيلية','💼 مسحوبات مالك تجريبي','💼 مسحوبات شريك تجريبي']
const settings={branches:[],transaction_types:types.map(label=>({label}))}
await f.db.query('update project_settings set settings=$2 where project_id=$1',[f.p1,JSON.stringify(settings)])
await f.db.exec(await (await import('node:fs/promises')).readFile('supabase/migrations/20261025161729_category_cleanup_and_required_links.sql','utf8'));
await f.db.query("update project_settings set settings=settings || '{\"category_policy\":{\"require_complete\":true}}'::jsonb where project_id=$1",[f.p1])
await f.db.query("insert into bank_accounts(id,project_id,name) values($1,$2,'Synthetic bank')",[card,f.p1])
const raw={bankAccountId:card,type:'expense',description:'Synthetic financing instalment',date:'2026-01-05',invoiceNumber:'LOAN-TEST',
 amount:100,totalAmount:300,vatAmount:0,paySource:'bank',transType:types[0],items:[{description:'Principal',amount:300}]}
async function makeDoc(inv){await f.claims(f.owner);const id=randomUUID();await f.db.query("insert into documents(id,project_id,file_name,status,analysis_result,uploaded_by,purchase_category) values($1,$2,'Synthetic loan','analyzed',$3,'owner',$4)",[id,f.p1,JSON.stringify(inv),types[0]]);return id}
const single=await makeDoc(raw)
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import Pending from './src/pages/PendingDocuments.jsx';import Loans from './src/pages/Loans.jsx';const root=createRoot(document.getElementById('root'));let n=0;window.mount=(doc,kind='pending',props={})=>{root.render(<MemoryRouter key={++n} initialEntries={['/pending?doc='+doc]}>{kind==='loans'?<Loans/>:<Pending/>}</MemoryRouter>)};`,resolveDir:process.env.WITHDRAWAL_REVIEW_SOURCE || process.cwd(),sourcefile:'loan-ui.jsx',loader:'jsx'},outfile:bundle,bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-transport',setup(b){
 b.onLoad({filter:/[\\/]contexts[\\/]AuthContext\.jsx$/},()=>({contents:'export const useAuth=()=>window.auth',loader:'js'}))
 b.onLoad({filter:/[\\/]lib[\\/]projectSettings\.js$/},()=>({contents:`export const getProjectSettings=async()=>({settings:window.settings});export const getTransactionTypes=async()=>window.types;export const clearProjectCache=()=>{};`,loader:'js'}))
 b.onLoad({filter:/[\\/]lib[\\/]supabase\.js$/},()=>({contents:`class Query{constructor(table){this.table=table;this.filters=[]}select(c){this.columns=c;return this}eq(k,v){this.filters.push(['eq',k,v]);return this}in(k,v){this.filters.push(['in',k,v]);return this}neq(k,v){this.filters.push(['neq',k,v]);return this}range(a,b){this.window=[a,b];return this}order(){return this}limit(){return this}single(){this.singleRow=true;return this}then(resolve,reject){return window.dbSelect(this.table,this.filters,this.columns,this.singleRow,this.window).then(resolve,reject)}}export const supabase={from:t=>new Query(t),rpc:async(n,a={})=>{const data=await window.dbRpc(n,a);if(n==='approval_approve')window.lastApproval=data;return {data}},auth:{getSession:async()=>({data:{session:{user:{id:window.auth.userId}}}})}};`,loader:'js'}))
}}],logLevel:'warning'})
const browser=await playwright.chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--disable-dev-shm-usage',...JSON.parse(process.env.CHROMIUM_ARGS||'[]')]})
const page=await browser.newPage({viewport:{width:1200,height:1100}});page.setDefaultTimeout(8000)
let lastArgs;let queue=Promise.resolve(),checks=0;const errors=[];const serial=run=>{const p=queue.then(run);queue=p.catch(()=>{});return p}
const check=n=>{checks++;console.log('PASS '+n)}
page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept())
await page.route('**/*',r=>r.request().url()==='http://fixture.local/'?r.fulfill({contentType:'text/html',body:'<html dir="rtl"><body><div id="root"></div></body></html>'}):r.abort())
await page.exposeFunction('dbSelect',(table,filters,columns,single,window)=>serial(async()=>{
 if(!['documents','categories','suppliers','payable_suppliers','bank_accounts','item_category_rules','ledger_entries'].includes(table))throw new Error('Unexpected table '+table)
 const args=[];const where=filters.map(([op,k,v])=>{if(!/^[a-z_]+$/.test(k))throw new Error('Invalid column');args.push(v);return op==='in'?`${k}=any($${args.length})`:`${k}${op==='neq'?'<>':'='}$${args.length}`}).join(' and ')
 const result=await f.db.query(`select * from public.${table}${where?' where '+where:''}`,args)
 const rows=window?result.rows.slice(window[0],window[1]+1):result.rows;for(const r of rows)for(const k of ['cash_out','bank_out','custody_out'])if(r[k]!=null)r[k]=Number(r[k]);return {data:single?rows[0]||null:rows,error:null}
}))
await page.exposeFunction('dbRpc',(name,args)=>serial(async()=>{
 if(!['approval_mode','approval_prepare','approval_approve','supplier_payment_context','admin_business_settings'].includes(name))throw new Error('Unexpected RPC '+name)
 if(name==='approval_approve')lastArgs=structuredClone(args);const keys=Object.keys(args);await f.claims((await page.evaluate(()=>window.auth.role))==='superadmin'?f.admin:f.acc);await f.db.exec('set role authenticated')
 try{return(await f.one(`select public.${name}(${keys.map((k,i)=>k+' => $'+(i+1)).join(',')}) as result`,Object.values(args).map(x=>x&&typeof x==='object'?JSON.stringify(x):x))).result}finally{await f.db.exec('reset role')}
}))
async function mount(id,role='accountant',kind='pending',props={}){await page.evaluate(({id,role,kind,props,settings,types,projectId,userId})=>{window.settings=settings;window.types=types;window.auth={projectId,userId,role,isSuperAdmin:role==='superadmin',viewState:'ok',canEdit:true,projectName:'Synthetic A'};window.mount(id,kind,props)},{id,role,kind,props,settings,types,projectId:f.p1,userId:role==='superadmin'?f.admin:f.acc})}

const approve=()=>page.getByRole('button',{name:'اعتماد',exact:true})
async function waitApproved(){await page.waitForFunction(()=>window.lastApproval);assert.equal((await page.evaluate(()=>window.lastApproval)).ok,true,JSON.stringify(await page.evaluate(()=>window.lastApproval)));await queue}
async function submit(button=approve()){await page.evaluate(()=>window.lastApproval=null);await button.click();await waitApproved()}
async function entries(id){return(await f.db.query('select * from ledger_entries where document_id=$1',[id])).rows}
async function verifyEntry(id,type,amount,source,account=null){
 const rows=await entries(id);const row=rows.find(r=>r.type===type);assert.ok(row);assert.equal(Number(row[source+'_out']),amount)
 for(const k of ['cash','bank','custody'])if(k!==source)assert.equal(Number(row[k+'_out']),0)
 assert.equal(Number(row.vat_amount||0),0);assert.equal(isRealExpense(row),false)
 if(account)assert.equal(row.bank_account_id,account)
 return row
}
try {
 await page.goto('http://fixture.local/');await page.addScriptTag({path:bundle});await mount(single)
 await page.getByRole('button',{name:'مسحوبات مالك',exact:true}).click()
 assert.equal(await page.locator('[data-k="withdrawal-type"]').inputValue(),'')
 assert.equal(await approve().isDisabled(),true);check('withdrawals available despite required expense categories; explicit existing owner selection required')
 await page.locator('[data-k="withdrawal-type"]').selectOption(types[1])
 await page.locator('[data-k="withdrawal-vat"]').fill('5');assert.equal(await approve().isDisabled(),true)
 await page.locator('[data-k="withdrawal-vat"]').fill('0');await page.locator('[data-k="withdrawal-amount"]').fill('120.50')
 await page.getByRole('button',{name:'حفظ مسودة',exact:true}).click();await page.getByRole('button',{name:'تجاهل المسودة',exact:true}).waitFor()
 await page.reload();await page.addScriptTag({path:bundle});await mount(single)
 assert.equal(await page.locator('[data-k="withdrawal-type"]').inputValue(),types[1]);assert.equal(await page.locator('[data-k="withdrawal-amount"]').inputValue(),'120.50')
 check('draft restores owner and amount; nonzero read VAT blocks approval')
 await submit();await verifyEntry(single,types[1],120.50,'bank',card);assert.equal((await entries(single)).length,1)
 const saved=await f.one('select original_reading,approved_payload from approval_private.document_invoices where document_id=$1',[single])
 assert.equal(saved.original_reading.type,'expense');assert.equal(saved.approved_payload.transType,types[1]);assert.equal(saved.approved_payload.category_id,null)
 check('real approval records one withdrawal, preserves reading, bypasses expense category requirement without counting expense')
 const retry=await page.evaluate(args=>window.dbRpc('approval_approve',args),lastArgs);assert.equal(retry.ok,true);assert.equal((await entries(single)).length,1);check('retry does not duplicate withdrawal')
 const multi=await makeDoc({invoices:[{...raw,date:'2026-01-06',invoiceNumber:'W-1',paySource:'cash'},{...raw,date:'2026-01-07',invoiceNumber:'W-2',paySource:'cash'}]})
 await mount(multi)
 for(let i=0;i<2;i++){
 const panel=page.locator('details.rp-subinv').nth(i);await panel.locator('summary').click();await panel.locator('[data-k="type-'+i+'"]').selectOption('owner_withdrawal');await panel.locator('[data-k="withdrawal-type"]').selectOption(types[i+1]);await panel.locator('[data-k="withdrawal-amount"]').fill(i===0?'70':'80')
 }
 await submit(page.getByRole('button',{name:'اعتماد الفاتورتين',exact:true}));assert.equal((await entries(multi)).length,2);await verifyEntry(multi,types[1],70,'cash');await verifyEntry(multi,types[2],80,'cash');check('multi-invoice bulk approval preserves independent owner and amount')
 const existing=await makeDoc({...raw,type:'transfer',transType:types[1],items:[],date:'2026-01-09',invoiceNumber:'W-ADMIN'})
 await mount(existing,'superadmin');await page.locator('[data-k="withdrawal-type"]').waitFor();assert.equal(await page.locator('[data-k="withdrawal-type"]').inputValue(),types[1]);await submit();await verifyEntry(existing,types[1],300,'bank',card);check('platform admin inside business can approve an existing withdrawal reading to its bank')
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:checks}))
}finally{await queue;await browser.close();await f.db.close();await rm(dir,{recursive:true,force:true})}
