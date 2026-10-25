// Real React pages + isolated PostgreSQL data/RPC. Every outbound network request is blocked.
import {build} from 'esbuild'
import {createRequire} from 'node:module'
import {readFile,mkdtemp,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
if(!process.env.PAYMENT_TEST_FIXTURE)throw new Error('An isolated synthetic fixture is required')
const {fixture}=await import(pathToFileURL(process.env.PAYMENT_TEST_FIXTURE)),f=await fixture()
const require=createRequire(import.meta.url);let playwright
try{playwright=require('playwright')}catch{playwright=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'../package.json'))('playwright')}
const dir=await mkdtemp(path.join(tmpdir(),'account-dashboard-ui-')),bundle=path.join(dir,'app.js')
let browser,page,checks=0,queue=Promise.resolve();const errors=[],queries=[]
const check=n=>{checks++;console.log('PASS '+n)}
const serial=run=>{const r=queue.then(run);queue=r.catch(()=>{});return r}
const main=randomUUID(),purchase=randomUUID(),restricted=randomUUID(),supplier=randomUUID()
const settings={branches:['North','South'],expenses_scope:'project',account_dashboard:{enabled:true,custody_account_id:purchase,liability_account_id:restricted},bank_workflow:{version:1,uploaders:{purchasing:{source:'bank',account_id:purchase}},accounts:{[restricted]:{operating_available:false}},network_by_branch:{},transfer_by_branch:{}}}
try{
 await f.claims(f.acc)
 await f.db.query("insert into bank_accounts(id,project_id,name,branches) values($1,$4,'Synthetic Main','{}'),($2,$4,'حساب العهدة','{}'),($3,$4,'Synthetic Restricted','{}')",[main,purchase,restricted,f.p1])
 await f.db.query("update project_settings set settings=$2,modules='[\"suppliers\"]' where project_id=$1",[f.p1,JSON.stringify(settings)])
 await f.db.query("insert into suppliers(id,project_id,name,opening_balance) values($1,$2,'Synthetic supplier',500)",[supplier,f.p1])
 await f.db.query("insert into ledger_entries(project_id,date,type,status,bank_in,bank_account_id,total_amount,description) values($1,'2026-10-01','رصيد افتتاحي','approved',500,$2,500,'Synthetic main opening'),($1,'2026-10-01','رصيد افتتاحي','approved',100,$3,100,'Synthetic purchase opening'),($1,'2026-10-01','رصيد افتتاحي','approved',1000,$4,1000,'Synthetic restricted opening')",[f.p1,main,purchase,restricted])
 await f.db.query("insert into ledger_entries(project_id,date,type,status,cash_in,total_amount,description) values($1,'2026-10-02','مبيعات كاش','approved',115,115,'Synthetic sales')",[f.p1])
 const document=randomUUID()
 await f.db.query("insert into documents(id,project_id,status,file_name,file_url,analysis_result) values($1,$2,'analyzed','Synthetic receipt','synthetic.png',$3)",[document,f.p1,JSON.stringify({invoices:[{type:'supplier_payment',supplierKind:'list',supplierId:supplier,paymentMode:'new',date:'2026-10-02',amount:150,reference:'SYNTHETIC-1',description:'Synthetic settlement',paySource:'bank',bankAccountId:main}]})])
 const queryStub=`class Query{constructor(table){this.table=table;this.filters=[];this.orders=[]}select(c){this.columns=c;return this}eq(k,v){this.filters.push(['eq',k,v]);return this}neq(k,v){this.filters.push(['neq',k,v]);return this}gte(k,v){this.filters.push(['gte',k,v]);return this}lte(k,v){this.filters.push(['lte',k,v]);return this}not(k,op,v){this.filters.push(['not',k,v,op]);return this}in(k,v){this.filters.push(['in',k,v]);return this}or(v){this.filters.push(['or','',v]);return this}order(k,o){this.orders.push([k,o?.ascending!==false]);return this}limit(v){this.max=v;return this}range(a,b){this.offset=a;this.max=b-a+1;return this}single(){this.singleRow=true;return this}maybeSingle(){this.singleRow=true;return this}then(resolve,reject){return window.dbSelect(JSON.parse(JSON.stringify(this))).then(resolve,reject)}}export const supabase={from:t=>new Query(t),rpc:async(n,a={})=>{const data=await window.dbRpc(n,a);if(n==='approval_approve')window.lastApproval=data;return {data}},auth:{getSession:async()=>({data:{session:{user:{id:window.auth.userId}}}})}};export async function fetchAllRows(fn){let out=[],start=0;for(;;){const r=await fn().range(start,start+999);if(r.error)return r;if(!r.data.length)return {data:out,error:null};out.push(...r.data);start+=r.data.length}};`
 await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route}from'react-router-dom';import Dashboard from './src/pages/Dashboard.jsx';import Accounts from './src/pages/Accounts.jsx';import Pending from './src/pages/PendingDocuments.jsx';import Reports from './src/pages/Reports.jsx';import Operations from './src/pages/JournalLedger.jsx';import Layout from './src/components/Layout.jsx';import Config from './src/components/AccountDashboardSettings.jsx';import{compressImage,fitImageBase64}from'./src/lib/imageCompress.js';import'./src/ui/fonts.js';import'./src/ui/theme.css';import'./src/ui/app.css';const root=createRoot(document.getElementById('root'));let n=0;window.imageFunctions={compressImage,fitImageBase64};window.mount=(route,config)=>root.render(<MemoryRouter key={++n} initialEntries={[route]}><Routes><Route path='/operations' element={<Operations unified/>}/><Route path='/nav' element={<Layout><span>Navigation</span></Layout>}/><Route path='/dashboard' element={<Dashboard/>}/><Route path='/accounts' element={<Accounts/>}/><Route path='/pending' element={<Pending/>}/><Route path='/reports' element={<Reports/>}/><Route path='/config' element={<Config settings={config?.settings||{}} banks={config?.banks||[]} onSaved={()=>{window.saved=true}}/>}/></Routes></MemoryRouter>);`,resolveDir:process.cwd(),sourcefile:'account-ui.jsx',loader:'jsx'},outfile:bundle,bundle:true,platform:'browser',format:'iife',jsx:'automatic',loader:{'.woff2':'dataurl','.woff':'dataurl'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-transport',setup(b){
 b.onLoad({filter:/[\\/]components[\\/]VersionNotice\.jsx$/},()=>({contents:'export default function V(){return null}',loader:'jsx'}))
 b.onLoad({filter:/[\\/]contexts[\\/]AuthContext\.jsx$/},()=>({contents:'export const useAuth=()=>window.auth',loader:'js'}))
 b.onLoad({filter:/[\\/]lib[\\/]supabase\.js$/},()=>({contents:queryStub,loader:'js'}))
 }}],logLevel:'warning'})
 browser=await playwright.chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--disable-dev-shm-usage',...JSON.parse(process.env.CHROMIUM_ARGS||'[]')]})
 page=await browser.newPage({viewport:{width:375,height:1000},timezoneId:'Asia/Riyadh'});page.setDefaultTimeout(10000)
 await page.clock.setFixedTime(new Date('2026-10-25T10:00:00Z'))
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
 await page.exposeFunction('dbRpc',(name,args)=>serial(async()=>{
  assert(['approval_mode','approval_prepare','approval_approve','supplier_payment_context','admin_account_dashboard_save','get_purchase_entries','document_readings'].includes(name),'RPC '+name)
  const auth=await page.evaluate(()=>window.auth);await f.claims(auth.userId,auth.projectId);await f.db.exec('set role authenticated')
  try{if(name==='get_purchase_entries')return wire((await f.db.query(`select * from public.${name}(${Object.keys(args).map((k,i)=>ident(k)+' => $'+(i+1)).join(',')})`,Object.values(args))).rows);return(await f.one(`select public.${name}(${Object.keys(args).map((k,i)=>ident(k)+' => $'+(i+1)).join(',')}) result`,Object.values(args).map(x=>x&&typeof x==='object'?JSON.stringify(x):x))).result}finally{await f.db.exec('reset role')}
 }))
 async function mount(route,role='owner',config,projectId=f.p1){await page.evaluate(({route,role,config,projectId,userId,projectName})=>{window.saved=false;window.auth={projectId,userId,role,isSuperAdmin:role==='superadmin',viewState:'ok',canEdit:role!=='owner',projectName,modules:['suppliers'],userName:'Synthetic reviewer',roleLabel:role};window.mount(route,config)},{route,role,config,projectId,projectName:projectId===f.p1?'تشورميك':'مزاهر',userId:role==='superadmin'?f.admin:role==='owner'?f.owner:f.acc});await queue}
 const loc=k=>page.locator(`[data-k="${k}"]`)
 const number=async locator=>Number((await locator.innerText()).match(/-?\d[\d,]*(?:\.\d+)?/)[0].replaceAll(',',''))
 await page.goto('http://fixture.local/');await page.addStyleTag({path:dir+'/app.css'});await page.addScriptTag({path:bundle})

 await mount('/dashboard','owner');await loc('overview-liquidity').waitFor();assert.equal(await number(loc('overview-liquidity')),715);assert.equal(await number(loc('overview-gross-sales')),115)
 for(const label of ['أكبر 5 بنود مصروفات','مبيعات ومصروفات الأسابيع','المبيعات اليومية','توزيع قنوات المبيعات'])assert.equal(await page.getByRole('heading',{name:new RegExp(label)}).count(),0)
 assert.match(await loc('pending-notice').innerText(),/1 مستند/);assert.equal(await loc('pending-notice').getByRole('link').count(),0)
 const notice=await loc('pending-notice').boundingBox(),cards=await loc('account-overview').boundingBox();assert.ok(notice.y<cards.y)
 for(const width of [320,375]){await page.setViewportSize({width,height:1000});const a=await loc('overview-gross-sales').boundingBox(),b=await loc('overview-liquidity').boundingBox();assert.ok(Math.abs(a.y-b.y)<2);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 check('compact dashboard: no charts, two cards in one mobile row, correct liquidity and top pending notice')
 await mount('/nav','accountant');await page.getByRole('link',{name:'سجل العمليات',exact:true}).first().waitFor();assert.equal(await page.getByRole('link',{name:'القروض',exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'سجل الحركات',exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'أرشيف الحركات',exact:true}).count(),0)
 await mount('/nav','accountant',null,f.p2);assert.ok(await page.getByRole('link',{name:'القروض',exact:true}).count());assert.equal(await page.getByRole('link',{name:'سجل العمليات',exact:true}).count(),0);check('Tashormik navigation merged; other businesses retain their navigation')
 await mount('/operations','owner');await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'));await page.getByRole('heading',{name:'سجل العمليات'}).waitFor();await page.getByLabel('الحساب',{exact:true}).selectOption('bank:'+purchase);assert.equal(await loc('jl.totalCount').innerText(),'1');assert.match(await page.locator('body').innerText(),/Synthetic purchase opening/);assert.equal(await page.getByRole('button',{name:'حذف',exact:true}).count(),0)
 await page.getByRole('button',{name:'حسب اليوم / PDF',exact:true}).click();await page.getByRole('button',{name:'تصدير اليوم PDF',exact:true}).waitFor();assert.match(await page.locator('body').innerText(),/Synthetic purchase opening/);check('owner can filter and switch daily/list views without delete controls')
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'تصدير اليوم PDF',exact:true}).click();const pdf=await download;const pdfPath=await pdf.path();assert.ok((await readFile(pdfPath)).length>1000);check('filtered daily PDF generated from unified operations page')
 await mount('/pending?doc='+document,'accountant');await loc('receipt-source-0').waitFor();assert.equal(await loc('receipt-split-toggle-0').isChecked(),false);assert.equal(await loc('receipt-bank-0').inputValue(),main)
 await loc('receipt-split-toggle-0').check();assert.equal(await loc('receipt-source-0').count(),0);await loc('receipt-split-bank-1-0').selectOption(purchase);await loc('receipt-split-amount-0-0').fill('100');await loc('receipt-split-amount-1-0').fill('49');assert.equal(await page.getByRole('button',{name:'اعتماد',exact:true}).isEnabled(),false)
 await loc('receipt-split-amount-1-0').fill('50');assert.equal(await page.getByRole('button',{name:'اعتماد',exact:true}).isEnabled(),true)
 await loc('receipt-split-toggle-0').uncheck();assert.equal(await loc('receipt-source-0').inputValue(),'bank');assert.equal(await loc('receipt-bank-0').inputValue(),main);check('split optional; invalid sum blocks approval; disabling restores single account')
 await loc('receipt-split-toggle-0').check();await loc('receipt-split-bank-1-0').selectOption(purchase);await loc('receipt-split-amount-0-0').fill('100');await loc('receipt-split-amount-1-0').fill('50')
 await page.getByRole('button',{name:'اعتماد',exact:true}).click();await page.waitForFunction(()=>window.lastApproval?.ok===true);await queue
 const legs=(await f.db.query('select bank_account_id,bank_out,payable_out,total_amount,journal_number from ledger_entries where document_id=$1 order by bank_out desc',[document])).rows
 assert.equal(legs.length,2);assert.deepEqual(legs.map(r=>[r.bank_account_id,Number(r.bank_out)]),[[main,100],[purchase,50]])
 assert.equal(Number((await f.one("select sum(amount) as amount from supplier_transactions where type='payment' and supplier_id=$1",[supplier])).amount),150);check('screen approval records one total supplier payment and exact selected bank amounts')
 await mount('/dashboard','owner');await loc('overview-liquidity').waitFor();assert.equal(await number(loc('overview-liquidity')),565);assert.equal(await number(loc('overview-gross-sales')),115);assert.equal(await number(loc('overview-suppliers')),350);check('approval updates liquidity and supplier balance once without affecting sales')
 await mount('/operations','accountant');await page.getByLabel('الحساب',{exact:true}).selectOption('bank:'+purchase);await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'));assert.equal(await loc('jl.totalCount').innerText(),'2');assert.equal(await number(loc('jl.totalCredit')),50);check('account filter shows custody funding and its own payment part only')
 await f.claims(f.acc);await f.db.query("insert into ledger_entries(project_id,date,type,status,cash_out,bank_in,bank_account_id,total_amount,description) values($1,'2026-10-03','تحويل','approved',20,20,$2,20,'Synthetic cash deposit')",[f.p1,main]);
 await mount('/operations','accountant');await page.getByLabel('الحساب',{exact:true}).selectOption('cash');await loc('jl.totalCredit').waitFor();assert.equal(await number(loc('jl.totalCredit')),20);assert.equal(await number(loc('jl.totalDebit')),115);check('cash filter excludes the bank side of a combined transfer from totals')
 assert.deepEqual(errors,[]);console.log(checks+'/'+checks+' browser checks passed with isolated PostgreSQL')
}finally{if(browser)await browser.close();await queue;await f.db.close()}
