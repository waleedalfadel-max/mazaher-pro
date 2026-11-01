// Read-only synthetic QA fixture. Build the app first, then pass an empty output directory.
// Uses the real Dashboard, Layout, Accounts and unified JournalLedger, with no production access.
import {build} from 'esbuild'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {writeFile, readdir, cp, mkdir} from 'node:fs/promises'
if (!process.argv[2]) throw Error('Pass an empty preview output directory')
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), out=path.resolve(process.argv[2])
await mkdir(out, {recursive:true})
const stub = `
const day = new Date().toISOString().slice(0,10)
const previousDate=new Date(new Date().getFullYear(),new Date().getMonth(),0).toISOString().slice(0,10)
const project_id='synthetic'
const row=(id,type,extra={})=>({id,type,date:day,status:'approved',project_id,journal_number:'SYN-'+id,description:'حركة تجريبية '+id,...extra})
const entries=[row('1','رصيد افتتاحي',{date:previousDate,bank_account_id:'main',bank_in:1500}),row('2','💵 مبيعات كاش',{cash_in:1150}),row('3','🛒 مصروفات تشغيلية',{bank_account_id:'main',bank_out:230,vat_amount:30}),row('4','رصيد افتتاحي',{date:previousDate,custody_out:80}),row('5','💳 قرض ١',{bank_account_id:'main',bank_out:50}),row('6','رصيد افتتاحي',{supplier_id:'credit',payable_in:70}),row('7','رصيد افتتاحي',{date:previousDate,bank_account_id:'held',bank_out:40}),row('8','مبيعات شبكة',{bank_account_id:'main',bank_in:900,total_amount:900,status:'pending'})]
const tables={ledger_entries:entries,bank_accounts:[{id:'main',name:'البنك التجريبي',project_id,is_active:true},{id:'held',name:'حساب ثانٍ',project_id,is_active:true}],suppliers:[{id:'due',opening_balance:100,project_id},{id:'overpaid',opening_balance:-20,project_id}],supplier_transactions:[{id:'t1',supplier_id:'due',type:'payment',amount:40,date:day,project_id}],documents:[{id:'doc1',status:'analyzed',uploaded_at:day,project_id}],attachments:[],sales:[],categories:[],document_items:[]}
class Query{
 constructor(table){this.table=table;this.filters=[]} select(){return this} order(){return this} or(){return this}
 eq(k,v){this.filters.push(r=>r[k]===v);return this} neq(k,v){this.filters.push(r=>r[k]!==v);return this} not(k,op,v){this.filters.push(r=>r[k]!==v);return this}
 in(k,v){this.filters.push(r=>v.includes(r[k]));return this} gte(k,v){this.filters.push(r=>r[k]>=v);return this} lte(k,v){this.filters.push(r=>r[k]<=v);return this}
 range(a,b){this.start=a;this.end=b+1;return this} single(){this.one=true;return this} maybeSingle(){this.one=true;return this}
 then(resolve,reject){return Promise.resolve().then(()=>{
 if(window.fixtureFailure===this.table)return {data:null,error:{message:'Synthetic read failure'}}
 const settings=window.fixtureProject==='تشورميك'?{account_dashboard:{enabled:true,custody_account_id:'held'}}:{}
 const source=this.table==='project_settings'?[{project_id,settings,modules:['suppliers'],active:true}]:tables[this.table]
 if(!source)throw Error('Unexpected table '+this.table)
 const rows=source.filter(r=>this.filters.every(f=>f(r))).slice(this.start||0,this.end)
 return {data:this.one?rows[0]:rows,error:null,count:rows.length}
 }).then(resolve,reject)}
}
export const supabase={from:t=>new Query(t),rpc:async name=>{if(name!=='get_purchase_entries')throw Error('Unexpected RPC '+name);return {data:[],error:null}}}
export const fetchAllRows=async f=>f()
`
const entry=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route}from'react-router-dom';import Dashboard from './src/pages/Dashboard.jsx';import Layout from './src/components/Layout.jsx';import Accounts from './src/pages/Accounts.jsx';import JournalLedger from './src/pages/JournalLedger.jsx';
function Fixture(){const[project,setProject]=useState('ديوانية مزاهر'),[role,setRole]=useState('accountant'),[failure,setFailure]=useState('');window.fixtureProject=project;window.fixtureFailure=failure;window.auth={projectId:'synthetic',projectName:project,role,roleLabel:role==='owner'?'المالك':role==='superadmin'?'إدارة تحسيب':'المحاسب',userName:'مستخدم تجريبي',sessionEpoch:1,viewState:'ok',isSuperAdmin:role==='superadmin',modules:['suppliers'],logout:()=>{},leaveProjectView:()=>{}};return <><div style={{padding:'8px',background:'#e3edee',display:'flex',gap:'6px',flexWrap:'wrap'}}><label>المنشأة التجريبية <select aria-label="المنشأة التجريبية" value={project} onChange={e=>setProject(e.target.value)}>{['ديوانية مزاهر','تشورميك','منشأة أخرى'].map(p=><option key={p}>{p}</option>)}</select></label><label>الدور التجريبي <select aria-label="الدور التجريبي" value={role} onChange={e=>setRole(e.target.value)}><option value="accountant">المحاسب</option><option value="owner">المالك</option><option value="superadmin">إدارة تحسيب</option></select></label><label>حالة التحميل <select aria-label="حالة التحميل" value={failure} onChange={e=>setFailure(e.target.value)}><option value="">سليم</option><option value="suppliers">فشل الموردين</option><option value="documents">فشل المستندات</option></select></label></div><MemoryRouter key={project+role+failure}><Layout><Routes><Route path="/" element={<Dashboard/>}/><Route path="/accounts" element={<Accounts/>}/><Route path="/operations" element={<JournalLedger unified/>}/><Route path="*" element={<p>وجهة تجريبية</p>}/></Routes></Layout></MemoryRouter></>};createRoot(document.getElementById('root')).render(<Fixture/>);`
await build({stdin:{contents:entry,resolveDir:repo,loader:'jsx'},outfile:out+'/fixture.js',bundle:true,format:'iife',platform:'browser',jsx:'automatic',loader:{'.png':'dataurl','.woff2':'dataurl','.woff':'dataurl'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic-only',setup(b){b.onLoad({filter:/[\\/]contexts[\\/]AuthContext\.jsx$/},()=>({contents:'export const useAuth=()=>window.auth',loader:'js'}));b.onLoad({filter:/[\\/]lib[\\/]supabase\.js$/},()=>({contents:stub,loader:'js'}))}}],logLevel:'warning'})
await cp(repo+'/dist/assets',out+'/assets',{recursive:true})
const css=(await readdir(out+'/assets')).find(f=>f.endsWith('.css'))
await writeFile(out+'/app.html',`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="connect-src 'none';object-src 'none'"><link rel="stylesheet" href="/assets/${css}"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`)
await writeFile(out+'/index.html',`<!doctype html><html><head><meta charset="utf-8"><title>Mazaher synthetic QA</title></head><body style="margin:0;background:#ddd"><nav style="padding:8px"><button onclick="document.querySelector('iframe').width=320">320</button><button onclick="document.querySelector('iframe').width=375">375</button><button onclick="document.querySelector('iframe').width=1280">1280</button> Synthetic data only</nav><iframe title="معاينة مزاهر" src="/app.html" width="375" height="1500" style="border:0;display:block;margin:auto"></iframe></body></html>`)
console.log(out)
