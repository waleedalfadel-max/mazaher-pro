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
const settings = { account_dashboard:{enabled:true,custody_account_id:'held'},bank_workflow:{version:1,accounts:{restricted:{operating_available:false,purpose:'مخصص للالتزامات'}}} }
const banks = [{id:'main',name:'البنك الرئيسي'},{id:'second',name:'البنك الثاني'},{id:'held',name:'حساب العهدة'},{id:'restricted',name:'حساب الالتزامات'}].map(a=>({...a,project_id:'synthetic',is_active:true}))
const row=(id,account,amount,extra={})=>({id,date:'2026-10-01',status:'approved',type:'رصيد افتتاحي',description:'Synthetic '+id,project_id:'synthetic',bank_account_id:account,bank_in:Math.max(0,amount),bank_out:Math.max(0,-amount),...extra})
const entries=[row('1','main',1000),row('2','second',200),row('3','held',-80),row('4','restricted',400),row('5',null,0,{cash_in:50}),row('6','held',900,{status:'pending'})]
const tables={ledger_entries:entries,bank_accounts:banks,project_settings:[{project_id:'synthetic',settings,active:true,modules:[]}],suppliers:[],supplier_transactions:[],documents:[]}
const stub=`class Query {
  constructor(table){this.table=table;this.filters=[]}
  select(){return this}order(){return this}or(){return this}
  eq(k,v){this.filters.push(['eq',k,v]);return this}neq(k,v){this.filters.push(['neq',k,v]);return this}
  in(k,v){this.filters.push(['in',k,v]);return this}gte(k,v){this.filters.push(['gte',k,v]);return this}lte(k,v){this.filters.push(['lte',k,v]);return this}
  range(a,b){this.start=a;this.end=b+1;return this}single(){this.one=true;return this}maybeSingle(){this.one=true;return this}
  then(resolve,reject){return window.readRows(JSON.parse(JSON.stringify(this))).then(resolve,reject)}
}export const supabase={from:t=>new Query(t)};`
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route}from'react-router-dom';import Dashboard from './src/pages/Dashboard.jsx';import Accounts from './src/pages/Accounts.jsx';import'./src/ui/fonts.js';import'./src/ui/theme.css';import'./src/ui/app.css';let n=0;const root=createRoot(document.getElementById('root'));window.mount=(route='/')=>root.render(<MemoryRouter key={++n} initialEntries={[route]}><Routes><Route path='/' element={<Dashboard/>}/><Route path='/accounts' element={<Accounts/>}/></Routes></MemoryRouter>);`,resolveDir:process.cwd(),loader:'jsx'},outfile:path.join(output,'app.js'),bundle:true,format:'iife',platform:'browser',jsx:'automatic',loader:{'.woff2':'dataurl','.woff':'dataurl'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic-read-only',setup(b){
  b.onLoad({filter:/[\\/]contexts[\\/]AuthContext\.jsx$/},()=>({contents:'export const useAuth=()=>window.auth',loader:'js'}))
  b.onLoad({filter:/[\\/]lib[\\/]supabase\.js$/},()=>({contents:stub,loader:'js'}))
}}],logLevel:'warning'})

const browser=await playwright.chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--disable-dev-shm-usage',...JSON.parse(process.env.CHROMIUM_ARGS||'[]')]})
let checks=0;const errors=[];const check=s=>{checks++;console.log('PASS '+s)}
try {
  const page=await browser.newPage({viewport:{width:375,height:1000},timezoneId:'Asia/Riyadh',acceptDownloads:true});page.setDefaultTimeout(10000)
  page.on('pageerror',e=>errors.push(String(e)))
  await page.clock.setFixedTime(new Date('2026-10-26T08:00:00Z'))
  await page.route('**/*',r=>r.request().url()==='http://fixture.local/'?r.fulfill({contentType:'text/html',body:'<html dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:12px"><div id="root"></div></body></html>'}):r.abort())
  await page.exposeFunction('readRows',q=>{
    assert.ok(Object.hasOwn(tables,q.table),'unexpected table '+q.table)
    let rows=tables[q.table].filter(r=>q.filters.every(([op,k,v])=>op==='eq'?r[k]===v:op==='neq'?r[k]!==v:op==='in'?v.includes(r[k]):op==='gte'?r[k]>=v:r[k]<=v)).slice(q.start||0,q.end)
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
  assert.deepEqual(errors,[]);check('no browser errors')
  console.log(JSON.stringify({checks,output,status:'PASS'}))
} finally {await browser.close()}
