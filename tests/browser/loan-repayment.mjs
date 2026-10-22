// Real review page -> synthetic PostgreSQL fixture. No requests reach a hosted service.
import {build} from 'esbuild'
import {createRequire} from 'node:module'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
if(!process.env.LOAN_TEST_FIXTURE)throw new Error('An isolated synthetic fixture is required')
const {fixture}=await import(pathToFileURL(process.env.LOAN_TEST_FIXTURE));const f=await fixture({migrate:false})
const require=createRequire(import.meta.url);let playwright
try{playwright=require('playwright')}catch{playwright=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'../package.json'))('playwright')}
const dir=await mkdtemp(path.join(tmpdir(),'loan-ui-')),bundle=path.join(dir,'app.js')
import {isRealExpense} from '../../src/lib/financeRules.js'
const card=randomUUID(),otherBank=randomUUID()
const types=['🛒 مصروفات تشغيلية','💳 قرض ١','💳 قرض ٢','💳 قسط سيارة','💳 قسط شراء أرض']
const settings={branches:[],transaction_types:types.map(label=>({label}))}
await f.db.query('update project_settings set settings=$2 where project_id=$1',[f.p1,JSON.stringify(settings)])
await f.db.query("insert into approval_private.settings(project_id,mode) values($1,'v2')",[f.p1])
const raw={type:'expense',description:'Synthetic financing instalment',date:'2026-01-05',invoiceNumber:'LOAN-TEST',
 amount:100,totalAmount:300,vatAmount:0,paySource:'bank',transType:types[0],items:[{description:'Principal',amount:300}]}
async function makeDoc(inv){await f.claims(f.owner);const id=randomUUID();await f.db.query("insert into documents(id,project_id,file_name,status,analysis_result,uploaded_by,purchase_category) values($1,$2,'Synthetic loan','analyzed',$3,'owner',$4)",[id,f.p1,JSON.stringify(inv),types[0]]);return id}
const single=await makeDoc(raw)
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import Pending from './src/pages/PendingDocuments.jsx';import Loans from './src/pages/Loans.jsx';const root=createRoot(document.getElementById('root'));let n=0;window.mount=(doc,kind='pending',props={})=>{root.render(<MemoryRouter key={++n} initialEntries={['/pending?doc='+doc]}>{kind==='loans'?<Loans/>:<Pending/>}</MemoryRouter>)};`,resolveDir:process.env.LOAN_REVIEW_SOURCE || process.cwd(),sourcefile:'loan-ui.jsx',loader:'jsx'},outfile:bundle,bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-transport',setup(b){
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
const chooseLoan=()=>page.getByRole('button',{name:'سداد قرض / قسط',exact:true}).click()
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
try{
 await page.goto('http://fixture.local/');await page.addScriptTag({path:bundle})
 // Reviewer finding: the uploader can supply a perfectly shaped confirmation inside analysis_result.
 // Test the actual review page and server preparation, not only the pure checkbox helper.
 const forged={...raw,type:'transfer',transferPurpose:'loan_repayment',transType:types[4],amount:300,paySource:'cash',items:[],
   invoiceNumber:'FORGED-SINGLE',date:'2026-01-12',
   loanPrincipalConfirmation:{version:1,confirmed:true,transType:types[4],amount:'300.00',vatAmount:'0.00'}}
 const injected=await makeDoc(forged)
 await mount(injected)
 const incomingPrincipal=page.locator('[data-k="loan-principal-confirmed"]')
 await incomingPrincipal.waitFor()
 assert.equal(await incomingPrincipal.isChecked(),false,'An uploader-supplied confirmation must never arrive checked')
 assert.equal(await approve().isDisabled(),true);assert.equal((await entries(injected)).length,0)
 check('review #20: forged reading confirmation arrives unchecked and cannot authorize an approval')
 await page.locator('[data-k="loan-amount"]').fill('303');await incomingPrincipal.check()
 await page.getByRole('button',{name:'حفظ مسودة',exact:true}).click()
 await page.getByRole('button',{name:'تجاهل المسودة',exact:true}).waitFor()
 await page.reload();await page.addScriptTag({path:bundle});await mount(injected)
 await page.getByRole('button',{name:'تجاهل المسودة',exact:true}).waitFor()
 assert.equal(await page.locator('[data-k="loan-amount"]').inputValue(),'303')
 assert.equal(await incomingPrincipal.isChecked(),false);assert.equal(await approve().isDisabled(),true)
 check('review #20: restoring a draft preserves edited amounts but requires a fresh reviewer confirmation')
 await page.getByRole('button',{name:'تجاهل المسودة',exact:true}).click()
 assert.equal(await page.locator('[data-k="loan-amount"]').inputValue(),'300')
 assert.equal(await incomingPrincipal.isChecked(),false);assert.equal(await approve().isDisabled(),true)
 assert.equal((await entries(injected)).length,0)
 check('review #20: discarding a draft cannot restore the forged original confirmation')
 await incomingPrincipal.check();await submit()
 assert.equal((await entries(injected)).length,1);await verifyEntry(injected,types[4],300,'cash')
 const injectedSaved=await f.one('select original_reading,approved_payload from approval_private.document_invoices where document_id=$1',[injected])
 assert.deepEqual(injectedSaved.original_reading.loanPrincipalConfirmation,forged.loanPrincipalConfirmation)
 assert.deepEqual(injectedSaved.approved_payload.loanPrincipalConfirmation,forged.loanPrincipalConfirmation)
 assert.ok(injectedSaved.approved_payload.review_changes.some(x=>x.includes('أصل قرض فقط')&&x.includes('300.00')))
 check('review #20: only a fresh reviewer click creates the repayment and its audit assertion; original reading is preserved')
 const forgedMulti=await makeDoc({invoices:[{...forged,invoiceNumber:'FORGED-1',date:'2026-01-10'},
   {...forged,invoiceNumber:'FORGED-2',date:'2026-01-11'}]})
 await mount(forgedMulti)
 const injectedPanels=page.locator('details.rp-subinv')
 await injectedPanels.nth(1).waitFor()
 for(let i=0;i<2;i++){
   await injectedPanels.nth(i).locator('summary').click()
   assert.equal(await injectedPanels.nth(i).locator('[data-k="loan-principal-confirmed"]').isChecked(),false)
   assert.equal(await injectedPanels.nth(i).getByRole('button',{name:'اعتماد هذه الفاتورة وحدها',exact:true}).isDisabled(),true)
 }
 assert.equal(await page.getByRole('button',{name:'اعتماد الفاتورتين',exact:true}).isDisabled(),true)
 assert.equal((await entries(forgedMulti)).length,0)
 check('review #20: nested forged assertions cannot authorize individual or bulk approval')
 await mount(single)
 await chooseLoan();assert.equal(await page.locator('[data-k="loan-type"]').inputValue(),'');assert.equal(await approve().isDisabled(),true)
 assert.equal(await page.locator('[data-k="loan-amount"]').inputValue(),'300');check('no loan is guessed; missing selection blocks approval, visible total retained')
 await page.locator('[data-k="loan-type"]').selectOption(types[1])
 assert.equal(await approve().isDisabled(),true,'A chosen loan and unchanged read total must not approve without principal confirmation')
 const principal=page.locator('[data-k="loan-principal-confirmed"]')
 assert.equal(await principal.isChecked(),false);await principal.check();assert.equal(await approve().isEnabled(),true)
 check('review #20: selecting the loan and retaining the full read amount is blocked until explicit principal confirmation')
 await page.locator('[data-k="loan-amount"]').fill('301');await page.locator('[data-k="loan-amount"]').fill('300')
 assert.equal(await principal.isChecked(),false);assert.equal(await approve().isDisabled(),true)
 await principal.check();await page.locator('[data-k="loan-type"]').selectOption(types[2]);await page.locator('[data-k="loan-type"]').selectOption(types[1])
 assert.equal(await principal.isChecked(),false);assert.equal(await approve().isDisabled(),true)
 await principal.check();await page.locator('[data-k="loan-vat"]').fill('1');await page.locator('[data-k="loan-vat"]').fill('0')
 assert.equal(await principal.isChecked(),false);assert.equal(await approve().isDisabled(),true)
 check('review #20: amount, loan and tax edits invalidate confirmation even when changed back')
 await page.locator('[data-k="loan-amount"]').fill('425.25');await principal.check();await principal.uncheck()
 assert.equal(await approve().isDisabled(),true);await principal.check()
 await submit();await verifyEntry(single,types[1],425.25,'bank');assert.equal((await entries(single)).length,1)
 const saved=await f.one('select original_reading,approved_payload from approval_private.document_invoices where document_id=$1',[single])
 assert.equal(saved.original_reading.type,'expense');assert.equal(saved.original_reading.amount,100)
 assert.equal(saved.approved_payload.type,'transfer');assert.equal(saved.approved_payload.transType,types[1]);assert.equal(saved.approved_payload.amount,'425.25')
 assert.ok(saved.approved_payload.review_changes.some(x=>x.includes('نوع المستند')))
 assert.deepEqual(saved.approved_payload.loanPrincipalConfirmation,{version:1,confirmed:true,transType:types[1],amount:'425.25',vatAmount:'0.00'})
 assert.ok(saved.approved_payload.review_changes.some(x=>x.includes('أصل قرض فقط')&&x.includes('425.25')))
 check('review #20: the exact principal assertion persists with the approved payload and review audit')
 check('single expense reclassified through real approval into one bank loan entry; original reading and review trail retained')
 const retry=await page.evaluate(args=>window.dbRpc('approval_approve',args),lastArgs);assert.equal(retry.ok,true);assert.equal((await entries(single)).length,1)
 check('retry of the same approval creates no second repayment')
 await mount(single,'accountant','loans');await page.locator('[data-loan="loan1"] [data-k="paid"]').waitFor()
 assert.match(await page.locator('[data-loan="loan1"] [data-k="paid"]').textContent(),/425[.,]25/)
 check('actual Loans page includes the new repayment in the chosen loan total')
 await f.db.query("insert into bank_accounts(id,project_id,name) values($1,$3,'Account A'),($2,$3,'Account B')",[card,otherBank,f.p1])
 const multi=await makeDoc({invoices:[{...raw,date:'2026-01-06',invoiceNumber:'M-1'},{...raw,date:'2026-01-07',invoiceNumber:'M-2',paySource:'cash'}]})
 await mount(multi)
 for(let i=0;i<2;i++){
   const panel=page.locator('details.rp-subinv').nth(i);await panel.locator('summary').click()
   await panel.locator('[data-k="type-'+i+'"]').selectOption('loan_repayment')
   await panel.locator('[data-k="loan-type"]').selectOption(types[i+1])
   await panel.locator('[data-k="loan-amount"]').fill(i===0?'120':'80')
   if(i===0){await panel.locator('[data-k="bank-account"]').selectOption(card);await panel.locator('[data-k="loan-principal-confirmed"]').check()}
 }
 const bulk=page.getByRole('button',{name:'اعتماد الفاتورتين',exact:true}),second=page.locator('details.rp-subinv').nth(1)
 assert.equal(await bulk.isDisabled(),true)
 assert.equal(await second.getByRole('button',{name:'اعتماد هذه الفاتورة وحدها',exact:true}).isDisabled(),true)
 await second.locator('[data-k="loan-principal-confirmed"]').check();assert.equal(await bulk.isEnabled(),true)
 await second.locator('[data-k="loan-amount"]').fill('81');await second.locator('[data-k="loan-amount"]').fill('80')
 assert.equal(await bulk.isDisabled(),true);assert.equal(await page.locator('[data-k="loan-principal-confirmed"]').first().isChecked(),true)
 await second.locator('[data-k="loan-principal-confirmed"]').check()
 check('review #20: bulk and per-invoice approval require each invoice own current confirmation')
 await submit(bulk)
 await verifyEntry(multi,types[1],120,'bank',card);await verifyEntry(multi,types[2],80,'cash');assert.equal((await entries(multi)).length,2)
 check('bulk approval keeps each invoice loan, amount and payment source independently')
 const manual=await makeDoc({...raw,date:'2026-01-08',invoiceNumber:'MANUAL-1',vatAmount:10})
 await mount(manual,'superadmin');await chooseLoan();await page.locator('[data-k="loan-type"]').selectOption(types[3])
 assert.equal(await approve().isDisabled(),true);check('a nonzero read tax cannot silently become an untaxed principal repayment')
 await page.locator('[data-k="loan-vat"]').fill('0');await page.locator('[data-k="bank-account"]').selectOption(otherBank)
 await page.locator('[data-k="loan-principal-confirmed"]').check()
 await page.getByRole('button',{name:'اعتماد يدوي',exact:true}).click()
 const manualPrincipal=page.locator('[data-k="manual-loan-principal-confirmed"]'),manualGeneral=page.locator('[data-k="manual-review-confirmed"]')
 const manualSubmit=page.getByRole('button',{name:'تأكيد واعتماد الأرقام اليدوية',exact:true})
 assert.equal(await manualPrincipal.isChecked(),false)
 await manualGeneral.check();assert.equal(await manualSubmit.isDisabled(),true)
 await manualPrincipal.check();await manualGeneral.check();assert.equal(await manualSubmit.isEnabled(),true)
 await page.getByLabel('مبلغ سداد أصل القرض المعتمد',{exact:true}).fill('301')
 await page.getByLabel('مبلغ سداد أصل القرض المعتمد',{exact:true}).fill('300')
 assert.equal(await manualPrincipal.isChecked(),false);assert.equal(await manualGeneral.isChecked(),false)
 check('review #20: manual dialog requires a fresh principal assertion and resets it after amount edits')
 assert.equal(await page.locator('[data-k="manual-loan-type"]').textContent(),types[3])
 await page.getByLabel('مبلغ سداد أصل القرض المعتمد',{exact:true}).fill('210')
 await page.getByLabel('ملاحظة المراجعة اليدوية',{exact:true}).fill('Principal verified on synthetic statement; fees separated.')
 await manualGeneral.check();assert.equal(await manualSubmit.isDisabled(),true)
 await manualPrincipal.check();await manualGeneral.check()
 await submit(page.getByRole('button',{name:'تأكيد واعتماد الأرقام اليدوية',exact:true}))
 await verifyEntry(manual,types[3],210,'bank',otherBank)
 const manualSaved=await f.one('select approved_payload from approval_private.document_invoices where document_id=$1',[manual])
 assert.equal(manualSaved.approved_payload.manualReview.previous_total,300)
 assert.deepEqual(manualSaved.approved_payload.loanPrincipalConfirmation,{version:1,confirmed:true,transType:types[3],amount:'210.00',vatAmount:'0.00'})
 assert.ok(manualSaved.approved_payload.review_changes.some(x=>x.includes('مراجعة يدوية')))
 check('manual admin approval keeps chosen loan and bank while recording corrected principal and reason')
 assert.deepEqual(errors,[]);check('no browser errors')
 console.log(JSON.stringify({passed:checks}))
}finally{await queue;await browser.close();await f.db.close();await rm(dir,{recursive:true,force:true})}
