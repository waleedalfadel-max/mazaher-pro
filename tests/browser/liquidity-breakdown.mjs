// Real dashboard/account pages and exports, synthetic read-only transport, no external network.
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const output = await mkdtemp(path.join(tmpdir(),'liquidity-browser-'))
const settings = { branches:['North','South'], account_dashboard:{enabled:true,custody_account_id:'held'},bank_workflow:{version:1,accounts:{restricted:{operating_available:false,purpose:'مخصص للالتزامات'}}} }
const banks = [{id:'main',name:'البنك الرئيسي'},{id:'second',name:'البنك الثاني'},{id:'held',name:'حساب العهدة'},{id:'restricted',name:'حساب الالتزامات'}].map(a=>({...a,project_id:'synthetic',is_active:true}))
const row=(id,account,amount,extra={})=>({id,date:'2026-10-01',status:'approved',type:'رصيد افتتاحي',description:'Synthetic '+id,project_id:'synthetic',bank_account_id:account,bank_in:Math.max(0,amount),bank_out:Math.max(0,-amount),...extra})
const entries=[row('1','main',1000),row('2','second',200),row('3','held',-80),row('4','restricted',400),row('5',null,0,{cash_in:50}),row('6','held',900,{status:'pending'})]
const tables={ledger_entries:entries,bank_accounts:banks,project_settings:[{project_id:'synthetic',settings,active:true,modules:[]}],suppliers:[],supplier_transactions:[],documents:[],sales:[],categories:[],document_items:[]}
const stub=`class Query {
  constructor(table){this.table=table;this.filters=[]}
  select(){return this}order(){return this}or(){return this}not(k,op,v){if(op!=='is')throw Error('unsupported not '+op);this.filters.push(['not',k,v]);return this}
  eq(k,v){this.filters.push(['eq',k,v]);return this}neq(k,v){this.filters.push(['neq',k,v]);return this}
  in(k,v){this.filters.push(['in',k,v]);return this}gte(k,v){this.filters.push(['gte',k,v]);return this}lte(k,v){this.filters.push(['lte',k,v]);return this}
  range(a,b){this.start=a;this.end=b+1;return this}single(){this.one=true;return this}maybeSingle(){this.one=true;return this}
  then(resolve,reject){return window.readRows(JSON.parse(JSON.stringify(this))).then(resolve,reject)}
}export const supabase={from:t=>new Query(t),rpc:async(name)=>{if(name!=='get_purchase_entries')throw Error('unexpected RPC '+name);return {data:[],error:null}}};export const fetchAllRows=async f=>await f();`
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route}from'react-router-dom';import Dashboard from './src/pages/Dashboard.jsx';import Accounts from './src/pages/Accounts.jsx';import Reports from './src/pages/Reports.jsx';import Ledger from './src/pages/Ledger.jsx';import {Metric,Tabs,Segment,Panel,Money} from './src/ui/components.jsx';import'./src/ui/fonts.js';import'./src/ui/theme.css';import'./src/ui/app.css';let n=0;const root=createRoot(document.getElementById('root'));window.mount=(route='/')=>root.render(<MemoryRouter key={++n} initialEntries={[route]}><Routes><Route path='/' element={<Dashboard/>}/><Route path='/accounts' element={<Accounts/>}/><Route path='/reports' element={<Reports/>}/><Route path='/ledger' element={<Ledger/>}/><Route path='/alignment' element={<Panel title='Synthetic title'><Metric label='Synthetic metric'><Money value={-123456.78}/></Metric><Tabs label='Synthetic tabs' value='0' onChange={()=>{}} tabs={Array.from({length:8},(_,i)=>({value:String(i),label:'تبويب '+i}))}/><Segment label='Synthetic segment' value='a' onChange={()=>{}} options={[{value:'a',label:'الخيار الأول'},{value:'b',label:'الخيار الثاني'}]}/>{['fa-card','sls-card','lns-card','ldg-card','rp-card rp-card--button'].map(c=><div key={c} className={c}>عنوان تجريبي <Money value={-1234.56}/></div>)}</Panel>}/></Routes></MemoryRouter>);`,resolveDir:process.cwd(),loader:'jsx'},outfile:path.join(output,'app.js'),bundle:true,format:'iife',platform:'browser',jsx:'automatic',loader:{'.woff2':'dataurl','.woff':'dataurl'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic-read-only',setup(b){
  b.onLoad({filter:/[\\/]contexts[\\/]AuthContext\.jsx$/},()=>({contents:'export const useAuth=()=>window.auth',loader:'js'}))
  b.onLoad({filter:/[\\/]lib[\\/]supabase\.js$/},()=>({contents:stub,loader:'js'}))
}}],logLevel:'warning'})

const browser=await playwright.chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--disable-dev-shm-usage',...JSON.parse(process.env.CHROMIUM_ARGS||'[]')]})
let checks=0;const errors=[];const check=s=>{checks++;console.log('PASS '+s)}
try {
  let failBanks=false
  const page=await browser.newPage({viewport:{width:375,height:1000},timezoneId:'Asia/Riyadh',acceptDownloads:true});page.setDefaultTimeout(10000)
  page.on('pageerror',e=>errors.push(String(e)))
  await page.clock.setFixedTime(new Date('2026-10-26T08:00:00Z'))
  await page.route('**/*',r=>r.request().url()==='http://fixture.local/'?r.fulfill({contentType:'text/html',body:'<html dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:12px"><div id="root"></div></body></html>'}):r.abort())
  await page.exposeFunction('readRows',q=>{
    assert.ok(Object.hasOwn(tables,q.table),'unexpected table '+q.table)
    if(failBanks&&q.table==='bank_accounts')return {data:null,error:{message:'Synthetic failure'}}
    let rows=tables[q.table].filter(r=>q.filters.every(([op,k,v])=>op==='not'?r[k]!=v:op==='eq'?r[k]===v:op==='neq'?r[k]!==v:op==='in'?v.includes(r[k]):op==='gte'?r[k]>=v:r[k]<=v)).slice(q.start||0,q.end)
    return {data:q.one?rows[0]||null:rows,error:null}
  })
  await page.goto('http://fixture.local/')
  await page.evaluate(()=>{window.auth={role:'owner',roleLabel:'المالك',userName:'Synthetic',projectId:'synthetic',projectName:'تشورميك',sessionEpoch:1}})
  await page.addScriptTag({path:path.join(output,'app.js')});await page.addStyleTag({path:path.join(output,'app.css')})
  const loc=k=>page.locator(`[data-k="${k}"]`)
  const number=async l=>Number((await l.locator('.ts-num').first().innerText()).replaceAll(',',''))
  const home=async()=>{await page.evaluate(()=>window.mount());await loc('overview-liquidity').waitFor()}
  await home()
  assert.deepEqual(await Promise.all(['overview-available-bank','overview-cash','overview-available-custody','overview-liquidity'].map(k=>number(loc(k)))),[1200,50,-80,1170]);check('actual dashboard sums the three signed cards')
  assert.match(await loc('liquidity-excluded').innerText(),/400\.00/);assert.match(await loc('liquidity-excluded').innerText(),/حساب الالتزامات/);check('restricted balance is visible separately')
  assert.ok(await loc('overview-available-custody').evaluate(e=>e.classList.contains('account-card-negative')));check('negative custody retains its sign and warning colour')
  for(const width of [320,375]){
    await page.setViewportSize({width,height:1100})
    const fit=await page.evaluate(()=>{const cards=[...document.querySelectorAll('.account-card')];return cards.every(e=>e.scrollWidth<=e.clientWidth+1&&e.getBoundingClientRect().right<=innerWidth)&&document.documentElement.scrollWidth<=innerWidth})
    assert.equal(fit,true);check('mobile cards fit '+width+'px')
  }
  await page.screenshot({path:path.join(output,'dashboard.png'),fullPage:true})
  for(const [key,expected] of [['available-bank',1200],['cash',50],['available-custody',-80],['liquidity',1170]]){
    await home();await loc('overview-'+key).click();await loc('account-closing').waitFor()
    assert.equal(await number(loc('account-closing')),expected);assert.equal(await loc('account-select').inputValue(),key);check('card opens matching statement: '+key)
  }
  assert.equal(await loc('account-movements').locator('tbody tr').count(),4)
  assert.equal(await loc('account-movements').innerText().then(t=>t.includes('Synthetic 4')),false);check('cash statement excludes the restricted account and pending entries')
  await page.locator('input').last().fill('no matching description');assert.equal(await number(loc('account-closing')),1170);assert.equal(await loc('account-movements').locator('tbody tr').count(),0);await page.locator('input').last().fill('');check('search does not change statement balance')
  const xlsxPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Excel',exact:true}).click();const xlsx=await xlsxPromise;const xlsxPath=await xlsx.path();const xml=(await readFile(xlsxPath)).toString('utf8');assert.ok(xml.includes('1170'));assert.ok(xml.includes('نطاق الحسابات'));assert.ok(xml.includes('الصندوق'));check('Excel includes the same closing balance and scope')
  const pdfPromise=page.waitForEvent('download');await page.getByRole('button',{name:'PDF',exact:true}).click();const pdf=await pdfPromise;const bytes=await readFile(await pdf.path());assert.equal(bytes.subarray(0,4).toString(),'%PDF');assert.ok(bytes.length>1000);check('PDF export completes for the cash statement')
  settings.account_dashboard.liability_account_id='restricted'
  settings.account_dashboard.liabilities={balance:500,date:'2026-10-25',reference:'Synthetic owner statement',automatic_sweep:true}
  await home();assert.equal(await number(loc('overview-liabilities')),-500);assert.ok(await loc('overview-liabilities').evaluate(e=>e.classList.contains('account-card-negative')));check('current liability displays negative without deducting previous deposits again')
  assert.match(await loc('liquidity-excluded').innerText(),/بطاقة «التزامات أخرى»/);assert.equal((await loc('liquidity-excluded').innerText()).includes('400.00'),false);check('restricted historical movements are not presented as spendable balance')
  entries.push(row('7','restricted',100,{date:'2026-10-26',type:'مبيعات شبكة'}),row('8','restricted',900,{date:'2026-10-26',status:'pending'}))
  await home();assert.equal(await number(loc('overview-liabilities')),-400);assert.equal(await number(loc('overview-liquidity')),1170);check('new approved network deposit reduces debt; pending deposit and available cash stay unaffected')
  await loc('overview-liabilities').click();await loc('liability-remaining').waitFor();assert.equal(await number(loc('liability-remaining')),-400);check('liability details match the negative dashboard balance')
  assert.equal(await number(loc('account-closing')),-400);check('restricted bank detail shows the tracked liability, not accumulated receipts')
  const report=async(branch='all')=>{await page.evaluate(b=>window.mount('/reports?tab=balance&period=custom&from=2026-10-01&to=2026-10-26&branch='+b),branch);await loc('balance.bank').waitFor()}
  await report()
  assert.deepEqual(await Promise.all(['balance.bank','balance.cash','balance.custody'].map(k=>number(loc(k)))),[1200,50,-80])
  const calc=async key=>Number((await loc(key).locator('dd').last().innerText()).replaceAll(',',''))
  assert.equal(await calc('balance.liquidity'),1170);assert.equal(await calc('balance.calc'),1170);assert.equal(await calc('balance.liabilities'),-400)
  assert.equal((await loc('balance.byAccount').innerText()).includes('حساب الالتزامات'),false);check('balance report and breakdown match home; debt is separate')
  await report('North');assert.equal(await calc('balance.liquidity'),1170);assert.match(await loc('balance.companyScope').innerText(),/منشأة كاملة/);check('branch filter cannot turn company account balances into branch flows')
  const reportX=page.waitForEvent('download');await page.getByRole('button',{name:/Excel/}).click();const reportFile=await reportX
  const reportXml=(await readFile(await reportFile.path())).toString('utf8')
  const exported=await page.evaluate(()=>window.__rptLastExport)
  assert.deepEqual(exported.blocks.find(b=>b.id==='balance.cards').items.map(c=>c.value),[1200,50,-80])
  assert.equal(exported.blocks.find(b=>b.id==='balance.liabilities').rows[0].value,-400)
  assert.ok(reportXml.includes('1170')&&reportXml.includes('-400'));check('report Excel carries the exact displayed bank, negative custody, cash and debt')
  const reportP=page.waitForEvent('download');await page.getByRole('button',{name:/PDF/}).click();assert.equal((await readFile(await (await reportP).path())).subarray(0,4).toString(),'%PDF');check('report PDF is generated from the same balance model')
  await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>window.mount('/ledger'));await page.locator('table[data-table="ledger.rows"] tbody tr[data-id="7"]').waitFor()
  const ledgerLast=page.locator('table[data-table="ledger.rows"] tr[data-id="7"]')
  assert.deepEqual(await Promise.all(['_bankBal','_cashBal','_custodyBal'].map(k=>number(ledgerLast.locator('[data-k="'+k+'"]')))),[1200,50,-80])
  assert.equal((await page.locator('table[data-table="ledger.rows"] tr[data-id="8"] [data-k="_bankBal"]').innerText()).trim(),'—');check('ledger running balances use the same account scopes and exclude pending entries')
  for(const width of [320,375,1280]){
    await page.setViewportSize({width,height:1100});await report()
    assert.ok(await page.locator('.ts-metric').evaluateAll(es=>es.every(e=>getComputedStyle(e).textAlign==='center')))
    assert.ok(await page.locator('.ts-tab').evaluateAll(es=>es.every(e=>getComputedStyle(e).justifyContent==='center')))
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));check('report cards and tabs centered without page overflow at '+width)
  }
  await page.setViewportSize({width:320,height:1100});await page.evaluate(()=>window.mount('/alignment'));await page.getByText('Synthetic metric').waitFor()
  assert.ok(await page.locator('.ts-metric,.fa-card,.sls-card,.lns-card,.ldg-card,.rp-card').evaluateAll(es=>es.every(e=>getComputedStyle(e).textAlign==='center')))
  assert.ok(await page.locator('.ts-metric .ts-money,.fa-card .ts-money,.sls-card .ts-money,.lns-card .ts-money,.ldg-card .ts-money').evaluateAll(es=>es.every(e=>getComputedStyle(e).justifyContent==='center')))
  const tabs=page.getByRole('tab');for(const pos of [0,7]){await tabs.nth(pos).scrollIntoViewIfNeeded();const r=await tabs.nth(pos).boundingBox();assert.ok(r.x>=-1&&r.x+r.width<=321)}
  assert.ok(await page.locator('.ts-segment button').evaluateAll(es=>es.every(e=>getComputedStyle(e).textAlign==='center')));check('shared card families and overflow tabs remain centered and reachable on narrow phones')
  await page.screenshot({path:path.join(output,'global-alignment.png'),fullPage:true})
  await report();await page.screenshot({path:path.join(output,'report-balance.png'),fullPage:true})
  failBanks=true;await page.evaluate(()=>window.mount('/reports?tab=balance'));await page.getByText('لم يكتمل تحميل إعدادات الحسابات؛ لا تُعرض أرصدة جزئية. أعد تحميل الصفحة.').waitFor();assert.equal(await loc('balance.bank').count(),0);check('missing bank metadata never shows a partial balance');failBanks=false
  // Other businesses keep employee custody as a separate signed asset; no bank custody double-counting.
  const saved=structuredClone(settings);delete settings.account_dashboard;delete settings.bank_workflow
  entries.push(row('9',null,0,{custody_out:20}))
  await report();assert.deepEqual(await Promise.all(['balance.bank','balance.cash','balance.custody'].map(k=>number(loc(k)))),[1620,50,-20]);assert.equal(await calc('balance.liquidity'),1650)
  await page.evaluate(()=>{window.auth.projectName='Synthetic other business';window.mount()});await page.getByText('البنوك المتاحة',{exact:true}).waitFor()
  assert.equal(await number(page.locator('.ts-metric').filter({has:page.getByText('البنوك المتاحة',{exact:true})})),1620);check('other-business dashboard and reports agree including signed employee custody')
  Object.assign(settings,saved)
  assert.deepEqual(errors,[]);check('no browser errors')
  console.log(JSON.stringify({checks,output,status:'PASS'}))
} finally {await browser.close()}
