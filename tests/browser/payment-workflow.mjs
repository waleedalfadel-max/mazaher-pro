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
await f.db.exec(await readFile('supabase/migrations/20261107171330_unified_internal_transfers.sql','utf8'))
const require=createRequire(import.meta.url);let playwright
try{playwright=require('playwright')}catch{playwright=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'../package.json'))('playwright')}
const dir=await mkdtemp(path.join(tmpdir(),'bank-workflow-ui-')),bundle=path.join(dir,'app.js')
const main=randomUUID(),purchase=randomUUID(),restricted=randomUUID(),network=randomUUID(),category=randomUUID()
await f.db.query("insert into bank_accounts(id,project_id,name,branches) values($1,$4,'Primary',array['North']),($2,$4,'Purchases','{}'),($3,$4,'Restricted',array['South'])",[main,purchase,restricted,f.p1])
await f.db.query("insert into bank_accounts(id,project_id,name,branches) values($1,$2,'Network bank',array['North'])",[network,f.p1])
await f.db.query("insert into categories(id,project_id,name,type,ledger_type,financial_class) values($1,$2,'Synthetic expense','expense','🛒 مصروفات تشغيلية','opex')",[category,f.p1])
await f.db.query("insert into approval_private.settings(project_id,mode) values($1,'v2') on conflict(project_id) do update set mode='v2'",[f.p1])
const settings={branches:['North','South'],expenses_scope:'project',bank_workflow:{version:1,uploaders:{owner:{source:'bank',account_id:main},purchasing:{source:'bank',account_id:purchase},cashier:{source:'cash'}},network_by_branch:{North:network},transfer_by_branch:{North:main},apps_collection_account:restricted,accounts:{[restricted]:{operating_available:false,purpose:'Obligations'},[main]:{transfer_to:purchase}}}}
await f.db.query('update project_settings set settings=$2 where project_id=$1',[f.p1,JSON.stringify(settings)])
const expense={type:'expense',description:'Synthetic purchase',date:'2026-10-21',totalAmount:'25.00',vatAmount:'0',paySource:'custody',transType:'🛒 مصروفات تشغيلية',category_main:'Synthetic expense',items:[{description:'Synthetic item',amount:'25.00',category_main:'Synthetic expense'}]}
async function makeDoc(role,inv=expense){
 let user=role==='owner'?f.owner:null
 if(!user){user=randomUUID();const session=randomUUID();await f.db.query('insert into auth.users(id) values($1)',[user]);await f.db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,user]);f.sessions[user]=session;await f.db.query("insert into app_users(name,role,auth_id,project_id,branch,is_active) values('Synthetic uploader',$1,$2,$3,'North',true)",[role,user,f.p1])}
 await f.claims(user);const id=randomUUID();await f.db.query("insert into documents(id,project_id,file_name,status,analysis_result,uploaded_by,branch) values($1,$2,'Synthetic document','analyzed',$3,$4,'North')",[id,f.p1,JSON.stringify(inv),role]);return id
}
const doc=await makeDoc('owner'),pdoc=await makeDoc('purchasing'),cdoc=await makeDoc('cashier')
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import Pending from './src/pages/PendingDocuments.jsx';import Controls from './src/pages/AdminBusinessSettings.jsx';import Manage from './src/components/InternalTransferManage.jsx';import Ledger from './src/pages/Ledger.jsx';const root=createRoot(document.getElementById('root'));let n=0;window.mount=(doc,kind='pending',props={})=>{root.render(<MemoryRouter key={++n} initialEntries={['/pending?doc='+doc]}>{kind==='ledger'?<Ledger/>:kind==='admin'?<Controls/>:kind==='manage'?<Manage {...props} onClose={()=>window.closed=true} onSaved={()=>window.saved=true}/>:<Pending/>}</MemoryRouter>)};`,resolveDir:process.cwd(),sourcefile:'bank-workflow-ui.jsx',loader:'jsx'},outfile:bundle,bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-transport',setup(b){
 b.onLoad({filter:/[\\/]contexts[\\/]AuthContext\.jsx$/},()=>({contents:'export const useAuth=()=>window.auth',loader:'js'}))
 b.onLoad({filter:/[\\/]lib[\\/]projectSettings\.js$/},()=>({contents:`export const getProjectSettings=async()=>({settings:window.settings});export const getTransactionTypes=async()=>['🛒 مصروفات تشغيلية','📥 تحصيل ذمم هنقر','🔄 تحويل داخلي — بين الحسابات البنكية','🏧 تحويل داخلي — إيداع نقدي','🏧 تحويل داخلي — سحب نقدي','👤 صرف عهدة','🔄 تحويل داخلي — صرف عهدة','💳 قرض ١'];export const clearProjectCache=()=>{};`,loader:'js'}))
 b.onLoad({filter:/[\\/]lib[\\/]supabase\.js$/},()=>({contents:`class Query{constructor(table){this.table=table;this.filters=[]}select(c){this.columns=c;return this}eq(k,v){this.filters.push(['eq',k,v]);return this}in(k,v){this.filters.push(['in',k,v]);return this}order(){return this}range(from,to){this.page=[from,to];return this}limit(){return this}maybeSingle(){this.singleRow=true;return this}single(){this.singleRow=true;return this}then(resolve,reject){return window.dbSelect(this.table,this.filters,this.columns,this.singleRow,this.page).then(resolve,reject)}}export const supabase={from:t=>new Query(t),rpc:async(n,a={})=>{const data=await window.dbRpc(n,a);if(n==='approval_approve')window.lastApproval=data;if(n==='internal_transfer_create'){window.lastTransfer=data;window.lastTransferArgs=a;}return {data}},auth:{getSession:async()=>({data:{session:{user:{id:window.auth.userId}}}})}};`,loader:'js'}))
}}],logLevel:'warning'})
const browser=await playwright.chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--disable-dev-shm-usage',...JSON.parse(process.env.CHROMIUM_ARGS||'[]')]})
const page=await browser.newPage({viewport:{width:1200,height:1100}});page.setDefaultTimeout(8000)
let queue=Promise.resolve(),checks=0;const errors=[];const serial=run=>{const p=queue.then(run);queue=p.catch(()=>{});return p}
const check=n=>{checks++;console.log('PASS '+n)}
page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept())
await page.route('**/*',r=>r.request().url()==='http://localhost/'?r.fulfill({contentType:'text/html',body:'<html dir="rtl"><body><div id="root"></div></body></html>'}):r.abort())
await page.exposeFunction('dbSelect',(table,filters,columns,single,range)=>serial(async()=>{
 if(!['documents','categories','suppliers','payable_suppliers','bank_accounts','item_category_rules','ledger_entries'].includes(table))throw new Error('Unexpected table '+table)
 const args=[];const where=filters.map(([op,k,v])=>{if(!/^[a-z_]+$/.test(k))throw new Error('Invalid column');args.push(v);return op==='in'?`${k}=any($${args.length})`:`${k}=$${args.length}`}).join(' and ')
 const result=await f.db.query(`select * from public.${table}${where?' where '+where:''}`,args)
 const rows=range?result.rows.slice(range[0],range[1]+1):result.rows;return {data:single?rows[0]||null:rows,error:null}
}))
await page.exposeFunction('dbRpc',(name,args)=>serial(async()=>{
 if(!['approval_mode','approval_prepare','approval_approve','supplier_payment_context','admin_business_settings','admin_bank_workflow_save','bank_transfer_manage','internal_transfer_create','internal_transfer_manage'].includes(name))throw new Error('Unexpected RPC '+name)
 const keys=Object.keys(args);await f.claims((await page.evaluate(()=>window.auth.role))==='superadmin'?f.admin:f.acc);await f.db.exec('set role authenticated')
 try{return(await f.one(`select public.${name}(${keys.map((k,i)=>k+' => $'+(i+1)).join(',')}) as result`,Object.values(args).map(x=>x&&typeof x==='object'?JSON.stringify(x):x))).result}finally{await f.db.exec('reset role')}
}))
async function mount(id,role='accountant',kind='pending',props={}){await page.evaluate(({id,role,kind,props,settings,projectId,userId})=>{window.settings=settings;window.auth={projectId,userId,role,isSuperAdmin:role==='superadmin',viewState:'ok',canEdit:true,projectName:'Synthetic A'};window.mount(id,kind,props)},{id,role,kind,props,settings,projectId:f.p1,userId:role==='superadmin'?f.admin:f.acc})}
const account=()=>page.locator('[data-k="bank-account"]')
async function reviewRegressions(){
 const policy=settings.bank_workflow
 const setPolicy=async enabled=>{
  if(enabled)settings.bank_workflow=policy;else delete settings.bank_workflow
  await f.db.query('update project_settings set settings=$2 where project_id=$1',[f.p1,JSON.stringify(settings)])
 }
 const approveButton=async button=>{
  await page.evaluate(()=>window.lastApproval=null);await button.click()
  await page.waitForFunction(()=>window.lastApproval)
  assert.equal((await page.evaluate(()=>window.lastApproval)).ok,true,JSON.stringify(await page.evaluate(()=>window.lastApproval)))
  await queue
 }
 const savedPayment=async(id,expected)=>{
  await page.waitForFunction(({id,expected})=>Object.keys(sessionStorage).some(k=>{
   if(!k.endsWith(':'+id))return false
   const e=JSON.parse(sessionStorage.getItem(k)).edit,inv=e?.invoices?.[0]||e
   return inv&&Object.entries(expected).every(([key,value])=>JSON.stringify(inv[key])===JSON.stringify(value))
  }),{id,expected})
 }
 // The payment suggestion is applied after the policy and accounts load: wait for the expected value as an explicit condition
 // (bounded by the default timeout), never a fixed delay; a wrong or missing suggestion still fails.
 const valueIs=async(locator,expected)=>{const h=await locator.elementHandle();await page.waitForFunction(([el,exp])=>el.value===exp,[h,expected]);return locator.inputValue()}
 if(process.env.PAYMENT_REVIEW_ONLY!=='bank') {
  for(const enabled of [false,true]) {
   await setPolicy(enabled)
   const id=await makeDoc('accountant',{type:'transfer',transType:'📥 تحصيل ذمم جاهز',amount:17,date:'2026-10-18',description:'Collection without a source'})
   await mount(id);const source=page.getByLabel('مصدر الدفع',{exact:true});await source.waitFor()
   assert.equal(enabled?await valueIs(source,'bank'):await source.inputValue(),enabled?'bank':'')
   await source.selectOption('bank');await account().selectOption(purchase)
   if(!enabled)await page.getByRole('button',{name:'حفظ مسودة',exact:true}).click()
   await savedPayment(id,{paySource:'bank',bankAccountId:purchase})
   await mount(id);await source.waitFor();assert.equal(await valueIs(source,'bank'),'bank');assert.equal(await valueIs(account(),purchase),purchase)
   await approveButton(page.getByRole('button',{name:'اعتماد',exact:true}))
   const row=await f.one('select bank_account_id,bank_in,receivable_out,branch from ledger_entries where document_id=$1',[id])
   assert.equal(row.bank_account_id,purchase);assert.equal(Number(row.bank_in),17);assert.equal(Number(row.receivable_out),17)
   assert.equal(row.branch,enabled?null:'North')
   check('app source is editable and survives reload, then approves to the visible bank: workflow '+enabled)
  }
  await setPolicy(false)
  const multi=await makeDoc('accountant',{invoices:[
   {type:'transfer',transType:'📥 تحصيل ذمم هنقر',amount:18,date:'2026-10-18',description:'First app'},
   {type:'transfer',transType:'📥 تحصيل ذمم جاهز',amount:19,date:'2026-10-18',description:'Second app'}]})
  await mount(multi);await page.locator('.rp-subinv').first().waitFor()
  for(let n=0;n<2;n++){
   const panel=page.locator('.rp-subinv').nth(n);await panel.locator('summary').click()
   await panel.locator(`[data-k="pay-source-${n}"]`).selectOption('bank')
   await panel.locator('[data-k="bank-account"]').selectOption(n===0?main:purchase)
  }
  await approveButton(page.getByRole('button',{name:'اعتماد هذه الفاتورة وحدها',exact:true}).first())
  await approveButton(page.getByRole('button',{name:'اعتماد الفاتورة المتبقية',exact:true}))
  const rows=(await f.db.query('select bank_account_id,bank_in from ledger_entries where document_id=$1 order by bank_in',[multi])).rows
  assert.equal(rows.length,2);assert.equal(rows[0].bank_account_id,main);assert.equal(rows[1].bank_account_id,purchase)
  check('multi-invoice app collections without workflow approve individually and as the remaining batch')
 }
 if(process.env.PAYMENT_REVIEW_ONLY!=='app'){
  for(const enabled of [true,false]){
   await setPolicy(enabled)
   const id=await makeDoc('accountant',{type:'transfer',transType:'🔄 تحويل داخلي — بين الحسابات البنكية',amount:21,date:'2026-10-18',description:'Preclassified bank pair without source'})
   await mount(id);await page.locator('[data-k="internal-transfer-from"]').selectOption('bank:'+main)
   await page.locator('[data-k="internal-transfer-to"]').selectOption('bank:'+purchase)
   if(!enabled)await page.getByRole('button',{name:'حفظ مسودة',exact:true}).click()
   await savedPayment(id,{internalTransfer:{from:'bank:'+main,to:'bank:'+purchase}})
   await mount(id);await page.locator('[data-k="internal-transfer-from"]').waitFor()
   assert.equal(await page.locator('[data-k="internal-transfer-from"]').inputValue(),'bank:'+main)
   await approveButton(page.getByRole('button',{name:'اعتماد',exact:true}))
   const rows=(await f.db.query('select bank_in,bank_out from ledger_entries where document_id=$1 order by bank_out desc',[id])).rows
   assert.equal(rows.length,2);assert.equal(Number(rows[0].bank_out),21);assert.equal(Number(rows[1].bank_in),21)
   const reading=await f.one('select original_reading,approved_payload from approval_private.document_invoices where document_id=$1',[id])
   assert.equal(reading.original_reading.paySource,undefined);assert.equal(reading.approved_payload.paySource,'bank')
   check('preclassified bank pair without source approves after draft reload, original preserved: workflow '+enabled)
  }
  await setPolicy(true)
  const multi=await makeDoc('accountant',{invoices:[22,23].map(amount=>({type:'transfer',transType:'🔄 تحويل داخلي — بين الحسابات البنكية',amount,date:'2026-10-18',description:'Preclassified pair '+amount}))})
  await mount(multi);await page.locator('.rp-subinv').first().waitFor()
  for(let n=0;n<2;n++){
   const panel=page.locator('.rp-subinv').nth(n);await panel.locator('summary').click()
   await panel.locator('[data-k="internal-transfer-from"]').selectOption('bank:'+main)
   await panel.locator('[data-k="internal-transfer-to"]').selectOption('bank:'+purchase)
  }
  await approveButton(page.getByRole('button',{name:'اعتماد هذه الفاتورة وحدها',exact:true}).first())
  await approveButton(page.getByRole('button',{name:'اعتماد الفاتورة المتبقية',exact:true}))
  const rows=(await f.db.query('select bank_in,bank_out from ledger_entries where document_id=$1',[multi])).rows
  assert.equal(rows.length,4);assert.equal(rows.reduce((sum,r)=>sum+Number(r.bank_in),0),45)
  assert.equal(rows.reduce((sum,r)=>sum+Number(r.bank_out),0),45)
  check('two preclassified bank pairs without source approve individually and in the remaining batch')
 }
 await setPolicy(true)
}
try{
 await page.goto('http://localhost/');await page.addScriptTag({path:bundle})
 await page.addStyleTag({content:(await Promise.all(['src/ui/theme.css','src/ui/app.css','src/ui/frame.css'].map(p=>readFile(p,'utf8')))).join('\n')});await reviewRegressions()
 if(!process.env.PAYMENT_REVIEW_ONLY){
 await mount(doc)
 await page.getByText(/المصدر المقترح لأن الرافع .*المالك/).waitFor();assert.equal(await account().inputValue(),main);check('real review page suggests owner main account')
 await account().selectOption(purchase);await page.getByText(/مسودة محفوظة في هذه النافذة فقط/).first().waitFor();await mount(doc);await account().waitFor();assert.equal(await account().inputValue(),purchase);check('manual account survives page remount with real browser draft')
 await account().selectOption('');await mount(doc);await account().waitFor();assert.equal(await account().inputValue(),'');check('explicitly cleared choice is not replaced on reload')
 await account().selectOption(purchase);await page.evaluate(()=>window.lastApproval=null);await page.getByRole('button',{name:'اعتماد',exact:true}).click();await page.waitForFunction(()=>window.lastApproval);assert.equal((await page.evaluate(()=>window.lastApproval)).ok,true);await queue
 const leg=await f.one('select bank_account_id,bank_out from ledger_entries where document_id=$1',[doc]);assert.equal(leg.bank_account_id,purchase);assert.equal(Number(leg.bank_out),25);check('visible overridden account reaches actual approval and ledger')
 await mount(pdoc);await page.getByText(/المصدر المقترح لأن الرافع .*مسؤول المشتريات/).waitFor();assert.equal(await account().inputValue(),purchase);check('purchasing upload suggests purchases account')
 await mount(cdoc);await page.getByText(/المصدر المقترح لأن الرافع .*الكاشير/).waitFor();assert.equal(await page.getByLabel('مصدر الدفع',{exact:true}).inputValue(),'cash');assert.equal(await account().count(),0);check('cashier upload suggests cash box')
 const sales=await makeDoc('cashier',{type:'sales',date:'2026-10-20',cashSales:0,networkSales:40,transferSales:12,totalSales:52})
 await mount(sales);await page.getByText(/حساب كل قناة مقترح للفرع/).waitFor()
 assert.equal(await page.locator('[data-k="bank-account-network"]').inputValue(),network)
 assert.equal(await page.locator('[data-k="bank-account-transfer"]').inputValue(),main)
 check('sales review shows independent network and transfer account proposals')
 await page.evaluate(()=>window.lastApproval=null);await page.getByRole('button',{name:'اعتماد',exact:true}).click();await page.waitForFunction(()=>window.lastApproval)
 assert.equal((await page.evaluate(()=>window.lastApproval)).ok,true);await queue
 const salesRows=(await f.db.query('select bank_account_id,bank_in from ledger_entries where document_id=$1 order by bank_in desc',[sales])).rows
 assert.equal(salesRows.length,2);assert.equal(salesRows[0].bank_account_id,network);assert.equal(Number(salesRows[0].bank_in),40)
 assert.equal(salesRows[1].bank_account_id,main);assert.equal(Number(salesRows[1].bank_in),12)
 check('each visible sales channel reaches its own bank in the actual ledger')
 const loan=await makeDoc('owner',{type:'transfer',transferPurpose:'loan_repayment',transType:'💳 قرض ١',amount:33,totalAmount:33,vatAmount:0,paySource:'cash',date:'2026-10-19',description:'Synthetic principal',
   loanPrincipalConfirmation:{version:1,confirmed:true,transType:'💳 قرض ١',amount:'33.00',vatAmount:'0.00'}})
 await mount(loan);await page.getByText(/المصدر المقترح لأن الرافع .*المالك/).waitFor()
 assert.equal(await account().inputValue(),main)
 assert.equal(await page.locator('[data-k="loan-principal-confirmed"]').isChecked(),false)
 assert.equal(await page.getByRole('button',{name:'اعتماد',exact:true}).isDisabled(),true)
 await page.locator('[data-k="loan-principal-confirmed"]').check();await page.evaluate(()=>window.lastApproval=null)
 await page.getByRole('button',{name:'اعتماد',exact:true}).click();await page.waitForFunction(()=>window.lastApproval)
 assert.equal((await page.evaluate(()=>window.lastApproval)).ok,true);await queue
 const loanRow=await f.one('select type,bank_account_id,bank_out from ledger_entries where document_id=$1',[loan])
 assert.equal(loanRow.type,'💳 قرض ١');assert.equal(loanRow.bank_account_id,main);assert.equal(Number(loanRow.bank_out),33)
 check('uploader proposal for a loan requires fresh principal confirmation and preserves the chosen account')
 const transfer=await makeDoc('owner',{type:'transfer',transType:'🔄 تحويل داخلي — بين الحسابات البنكية',paySource:'bank',amount:35,date:'2026-10-21',description:'Synthetic bank transfer'})
 await mount(transfer);await page.locator('[data-k="internal-transfer-from"]').selectOption('bank:'+main);await page.locator('[data-k="internal-transfer-to"]').selectOption('bank:'+purchase)
 await page.evaluate(()=>window.lastApproval=null);await page.getByRole('button',{name:'اعتماد',exact:true}).click();await page.waitForFunction(()=>window.lastApproval);assert.equal((await page.evaluate(()=>window.lastApproval)).ok,true);await queue
 const pair=await f.one('select p.* from approval_private.internal_transfers p join approval_private.document_invoices i on i.id=p.invoice_id where i.document_id=$1',[transfer]);assert(pair);check('one internal transfer form approves both chosen ledger legs')
 const banks=(await f.db.query('select * from bank_accounts where project_id=$1',[f.p1])).rows
 await mount('', 'superadmin','manage',{entryId:pair.source_entry,action:'update',accounts:banks,settings});await page.getByLabel('مبلغ التحويل',{exact:true}).fill('39.50');await page.getByLabel('سبب الإجراء').fill('Reviewed on screen');await page.getByRole('button',{name:'حفظ التحويل'}).click();await page.waitForFunction(()=>window.saved)
 const updated=await f.rpc(f.admin,'internal_transfer_manage',[pair.source_entry]);assert.equal(updated.amount,39.5);assert.equal(updated.to,'bank:'+purchase);check('bank transfer dialog edits both sides from actual screen')
 await mount('', 'superadmin','admin');await page.getByRole('tab',{name:'الحسابات البنكية',exact:true}).click();await page.getByLabel('المصدر المقترح عند رفع المالك').selectOption(purchase)
 await page.getByLabel('حساب حوالات المبيعات — North',{exact:true}).selectOption(purchase)
 await page.getByRole('button',{name:'حفظ مهام الحسابات'}).click();await page.getByText('حُفظت مهام الحسابات وسُجّل التعديل باسم إدارة تحسيب.').waitFor();const stored=await f.one('select settings from project_settings where project_id=$1',[f.p1]);assert.equal(stored.settings.bank_workflow.uploaders.owner.account_id,purchase)
 assert.equal(stored.settings.bank_workflow.transfer_by_branch.North,purchase);assert.equal(stored.settings.bank_workflow.network_by_branch.North,network)
 check('admin workflow screen saves uploader and per-channel defaults independently')
 }

 // Actual manual entry page uses the same accounts and one amount, no separate action.
 settings.account_dashboard={enabled:true,custody_account_id:purchase}
 settings.statement_accounts=[{value:'cash',label:'الصندوق'},{value:'bank:'+main,label:'الراجحي الرئيسي'},{value:'bank:'+purchase,label:'حساب المشتريات'}]
 await f.db.query('update project_settings set settings=$2 where project_id=$1',[f.p1,JSON.stringify(settings)])
 await mount('', 'accountant','ledger');await page.getByRole('button',{name:'إضافة قيد',exact:true}).click()
 assert.equal(await page.getByRole('button',{name:'تحويل بين الصندوق والبنك',exact:true}).count(),0)
 const modal=page.getByRole('dialog')
 const type=modal.getByLabel('النوع',{exact:true})
 await type.waitFor()
 const options=await type.locator('option').allTextContents()
 assert.equal(options.filter(x=>x==='تحويل داخلي').length,1)
 assert.equal(options.some(x=>/صرف عهدة|من الصندوق إلى البنك|من البنك إلى الصندوق/.test(x)),false)
 await type.selectOption('🔄 تحويل داخلي')
 assert.equal(await modal.locator('[data-amount]').count(),0)
 await modal.getByLabel('تحويل من',{exact:true}).selectOption('cash')
 await modal.getByLabel('تحويل إلى',{exact:true}).selectOption('bank:'+purchase)
 await modal.getByLabel('مبلغ التحويل',{exact:true}).fill('75.25')
 await modal.getByLabel('الوصف',{exact:true}).fill('Manual custody funding')
 assert.equal(await modal.getByLabel('تحويل إلى',{exact:true}).locator('option[value="cash"]').count(),0)
 assert.equal(await modal.getByLabel('تحويل من',{exact:true}).locator('option[value="custody"]').count(),0)
 await page.screenshot({path:'/tmp/unified-transfer-desktop.png',animations:'disabled'})
 await page.setViewportSize({width:390,height:844})
 await page.screenshot({path:'/tmp/unified-transfer-mobile.png',animations:'disabled'})
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth))
 await page.setViewportSize({width:1200,height:1100})
 await page.evaluate(()=>window.lastTransfer=null)
 await modal.getByRole('button',{name:'حفظ القيد',exact:true}).click()
 await page.waitForFunction(()=>window.lastTransfer)
 const manualResult=await page.evaluate(()=>window.lastTransfer)
 assert.equal(manualResult.ok,true,JSON.stringify(manualResult));await queue
 const posted=(await f.db.query('select * from ledger_entries where journal_number=$1',[manualResult.journal_number])).rows
 assert.equal(posted.length,2);assert.equal(posted.reduce((s,r)=>s+Number(r.cash_out),0),75.25);assert.equal(posted.reduce((s,r)=>s+Number(r.bank_in),0),75.25)
 check('manual page has one classification and two company accounts; desktop/mobile and actual ledger save pass')
 assert.deepEqual(errors,[]);check('no page errors')
 console.log(JSON.stringify({passed:checks}))
}catch(e){console.error('Page errors:',errors);throw e}finally{await queue;await browser.close();await f.db.close();await rm(dir,{recursive:true,force:true})}
