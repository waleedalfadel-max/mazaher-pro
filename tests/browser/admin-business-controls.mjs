// Browser -> actual isolated PostgreSQL functions, with synthetic session claims.
// ADMIN_TEST_FIXTURE exports fixture(): {db,one,rpc,p1,p2,admin}.
// The private baseline factory contains schema metadata, never production row data.
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

if (!process.env.ADMIN_TEST_FIXTURE) throw new Error('Set ADMIN_TEST_FIXTURE to an isolated synthetic database fixture; production is not supported.')
const { fixture } = await import(pathToFileURL(path.resolve(process.env.ADMIN_TEST_FIXTURE)))
const f = await fixture()
const require = createRequire(import.meta.url)
let playwright
try { playwright=require('playwright') } catch { playwright=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'../package.json'))('playwright') }
const temp=await mkdtemp(path.join(tmpdir(),'admin-business-ui-'))
const bundle=path.join(temp,'fixture.js')
await build({stdin:{contents:`
 import React from 'react'; import {createRoot} from 'react-dom/client';
 import {MemoryRouter} from 'react-router-dom';
 import Controls,{AdminActionHistory} from './src/pages/AdminBusinessSettings';
 const root=createRoot(document.getElementById('root'));
 window.render=(projectId,kind='controls',role='superadmin')=>{
  window.auth={role,projectId,viewState:'ok'};
  root.render(<MemoryRouter>{kind==='history'?<AdminActionHistory key={projectId+role}/>:<Controls key={projectId+role}/>}</MemoryRouter>);
 };
`,resolveDir:process.cwd(),sourcefile:'admin-business-fixture.jsx',loader:'jsx'},bundle:true,outfile:bundle,
 platform:'browser',format:'iife',jsx:'automatic',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},
 plugins:[{name:'isolated-transport',setup(b){
  b.onLoad({filter:/[\\/]contexts[\\/]AuthContext\.jsx$/},()=>({contents:'export const useAuth=()=>window.auth',loader:'js'}));
  b.onLoad({filter:/[\\/]lib[\\/]supabase\.js$/},()=>({contents:'export const supabase={rpc:async(name,args={})=>({data:await window.dbRpc(name,args,window.auth.projectId)})}',loader:'js'}));
  b.onLoad({filter:/[\\/]lib[\\/]projectSettings\.js$/},()=>({contents:'export const clearProjectCache=()=>{}',loader:'js'}));
 }}],logLevel:'warning'})
const browser=await playwright.chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']})
const page=await browser.newPage({viewport:{width:1200,height:900}})
page.setDefaultTimeout(7000)
let queue=Promise.resolve()
const errors=[],passed=[]
page.on('pageerror',e=>errors.push(String(e)))
page.on('dialog',d=>d.accept())
await page.route('**/*',r=>r.abort())
await page.exposeFunction('dbRpc',(name,args,project)=>{
 const run=async()=>{
  const parameters=name==='admin_business_write'?[args.p_entity,args.p_action,args.p_id,JSON.stringify(args.p_data)]:name==='admin_action_history'?[args.p_before??null]:[]
  if(!['admin_business_write','admin_action_history','admin_business_settings'].includes(name))throw new Error('Unexpected RPC')
  return f.rpc(f.admin,name,parameters,project)
 }
 const next=queue.then(run);queue=next.catch(()=>{});return next
})
const check=n=>{passed.push(n);console.log('PASS '+n)}
const render=(pid=f.p1,kind='controls',role='superadmin')=>page.evaluate(({pid,kind,role})=>window.render(pid,kind,role),{pid,kind,role})
const save=async()=>{await page.getByRole('dialog').getByRole('button',{name:'حفظ',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'})}
const add=()=>page.getByRole('button',{name:'إضافة',exact:true}).click()
try{
 await page.setContent('<html dir="rtl"><body><div id="root"></div></body></html>');await page.addScriptTag({path:bundle});await render()
 await page.getByText('إدارة Synthetic A',{exact:true}).waitFor()
 await add();await page.getByLabel('الاسم',{exact:true}).fill('UI supplier');await page.getByLabel('الرصيد الافتتاحي',{exact:true}).fill('75.25');await save()
 const supplier=await f.one("select id,opening_balance from public.suppliers where name='UI supplier'")
 assert.equal(supplier.opening_balance,'75.25');check('supplier form saves to actual database')
 const row=page.locator('[data-config-row="'+supplier.id+'"]')
 await row.getByRole('button',{name:'تعديل',exact:true}).click();await page.getByLabel('الرصيد الافتتاحي',{exact:true}).fill('80.25')
 await page.getByRole('dialog').getByRole('button',{name:'حفظ',exact:true}).click();await page.getByRole('dialog').getByText('اكتب سبب تعديل الرصيد الافتتاحي.').waitFor()
 assert.equal((await f.one('select opening_balance from public.suppliers where id=$1',[supplier.id])).opening_balance,'75.25')
 await page.getByLabel('سبب تعديل الرصيد',{exact:true}).fill('Synthetic correction');await save();check('opening edit requires reason and saves after correction')
 await row.getByRole('button',{name:'إزالة',exact:true}).click();await row.getByText('موقوف',{exact:true}).waitFor()
 assert.equal((await f.one('select opening_balance from public.suppliers where id=$1',[supplier.id])).opening_balance,'80.25');check('removal archives linked opening balance instead of losing it')
 await page.getByRole('tab',{name:'الحسابات البنكية',exact:true}).click();await add();await page.getByLabel('الاسم',{exact:true}).fill('UI bank');await page.getByLabel('اسم البنك',{exact:true}).fill('Synthetic');await page.getByLabel('North',{exact:true}).check();await save()
 assert.deepEqual((await f.one("select branches from public.bank_accounts where name='UI bank'")).branches,['North']);check('bank form persists branch selection')
 await page.getByRole('tab',{name:'الفروع والقنوات',exact:true}).click();await add();await page.getByLabel('الاسم',{exact:true}).fill('West');await page.getByLabel('هنقرستيشن',{exact:true}).uncheck();await save()
 const ps=await f.one('select settings from public.project_settings where project_id=$1',[f.p1]);assert(ps.settings.branches.includes('West'));assert(!ps.settings.branch_channels.West.includes('hunger'));check('branch and channel form saves selected channels')
 await page.getByRole('tab',{name:'القاموس',exact:true}).click();await add();await page.getByLabel('وصف الصنف',{exact:true}).fill('UI item');await save()
 const item=await f.one("select id,status from public.item_category_rules where description='UI item'");assert.equal(item.status,'review')
 await page.locator('[data-config-row="'+item.id+'"]').getByRole('button',{name:'إزالة',exact:true}).click();await page.getByText('UI item',{exact:true}).waitFor({state:'hidden'});check('dictionary add and delete works through UI')
 await page.getByLabel('تسجيل المصروفات',{exact:true}).selectOption('project');await page.getByRole('button',{name:'حفظ طريقة المصروفات',exact:true}).click();await page.getByRole('button',{name:'حفظ طريقة المصروفات',exact:true}).isDisabled()
 await queue;assert.equal((await f.one('select settings from public.project_settings where project_id=$1',[f.p1])).settings.expenses_scope,'project');check('expense scope saves for selected business')
 await render(f.p1,'history');await page.getByText(/Synthetic superadmin — تعديل — الموردون/).first().waitFor();await page.locator('details').filter({hasText:'السبب: Synthetic correction'}).locator('summary').click();await page.getByText('السبب: Synthetic correction').waitFor();check('audit displays actual actor and recorded reason')
 await render(f.p2);await page.getByText('إدارة Synthetic B',{exact:true}).waitFor();assert.equal(await page.getByText('UI supplier',{exact:true}).count(),0);check('switching tenant removes previous tenant records')
 await render(f.p1,'controls','owner');await page.getByText('اختر منشأة من لوحة مدير المنصة أولًا.').waitFor();assert.equal(await page.getByRole('button',{name:'إضافة',exact:true}).count(),0);check('ordinary owner cannot see platform controls')
 assert.deepEqual(errors,[]);check('no browser errors')
 console.log(JSON.stringify({passed:passed.length,checks:passed},null,2))
}finally{await queue;await browser.close();await f.db.close();await rm(temp,{recursive:true,force:true})}
