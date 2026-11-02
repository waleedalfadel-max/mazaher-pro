// Offline UI wiring check; real PendingDocuments page, synthetic transport. DB rules tested separately.
import {build} from 'esbuild'
import {mkdir,cp,readdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
const out=path.resolve(process.argv[2]);await mkdir(out,{recursive:true})
const stub=`
const project='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222',did='33333333-3333-4333-8333-333333333333',iid='44444444-4444-4444-8444-444444444444';
const inv={_id:iid,type:'supplier_payment',supplierKind:'list',supplierId:sid,beneficiary:'مورد تجريبي',amount:150,date:'2026-01-20',paySource:'cash',paymentMode:'new',reference:'SYN-1',paymentEvidence:'سند قبض تجريبي'};
const doc={id:did,project_id:project,file_name:'سند تجريبي',file_type:'application/pdf',status:'analyzed',uploaded_at:'2026-11-02T08:00:00Z',uploaded_by:'owner',version:1,analysis_result:{invoices:[inv]}};
let balance=100,writes=0;window.fixtureChangeBalance=()=>{balance=80;document.getElementById('qa-balance').textContent='الرصيد الحالي: '+balance};
const tables={documents:[doc],suppliers:[{id:sid,project_id:project,name:'مورد تجريبي',is_active:true}],payable_suppliers:[],bank_accounts:[],categories:[],item_category_rules:[]};
class Query{constructor(t){this.t=t;this.fs=[]}select(){return this}order(){return this}limit(){return this}range(){return this}eq(k,v){this.fs.push(x=>x[k]===v);return this}in(k,v){this.fs.push(x=>v.includes(x[k]));return this}single(){this.one=true;return this}then(a,b){return Promise.resolve({data:this.one?tables[this.t]?.[0]:(tables[this.t]||[]).filter(x=>this.fs.every(f=>f(x))),error:null}).then(a,b)}}
export const supabase={from:t=>new Query(t),auth:{getSession:async()=>({data:{session:{user:{id:'synthetic-user'}}}})},rpc:async(n,a)=>{
 if(n==='approval_mode')return {data:'v2'};
 if(n==='approval_prepare')return {data:{ok:true,status:'analyzed',version:1,mode:'v2',analysis_result:doc.analysis_result,invoices:[{id:iid,status:'pending',original_reading:inv}]}};
 if(n==='document_readings')return {data:{ok:true,readings:[]}};
 if(n==='supplier_payment_context')return {data:{ok:true,name:'مورد تجريبي',balance,payments:[],pending_receipts:[]}};
 if(n==='approval_approve'){
 const x=a.p_invoices[0],confirmation={document_id:did,invoice_id:iid,supplier_kind:'list',supplier_id:sid,date:x.date,amount:Number(x.amount),balance};
 if(Number(x.amount)>balance&&JSON.stringify(a.p_decisions?.overpayments?.[iid])!==JSON.stringify(confirmation))return {data:{ok:false,code:'supplier_overpayment_confirmation',invoice_id:iid,name:'مورد تجريبي',balance,amount:Number(x.amount),excess:Number(x.amount)-Math.max(balance,0),after:balance-Number(x.amount),confirmation}};
 writes++;balance-=Number(x.amount);document.getElementById('qa-writes').textContent='الدفعات المسجلة: '+writes;document.getElementById('qa-balance').textContent='الرصيد الحالي: '+balance;
 return {data:{ok:true,version:2,document_status:'approved',journals:[{invoice_id:iid,journal_number:'SYN-APPROVED'}]}};
 }throw Error('Unexpected RPC '+n)}};
`
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import Pending from './src/pages/PendingDocuments.jsx';window.auth={projectId:'11111111-1111-4111-8111-111111111111',projectName:'تشورميك',role:'accountant',viewState:'ok',isSuperAdmin:false};createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/pending?doc=33333333-3333-4333-8333-333333333333']}><Pending/></MemoryRouter>);`,resolveDir:process.cwd(),loader:'jsx'},outfile:out+'/fixture.js',bundle:true,format:'iife',platform:'browser',jsx:'automatic',define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic-only',setup(b){b.onLoad({filter:/[\\/]contexts[\\/]AuthContext\.jsx$/},()=>({contents:'export const useAuth=()=>window.auth',loader:'js'}));b.onLoad({filter:/[\\/]lib[\\/]projectSettings\.js$/},()=>({contents:"export const getProjectSettings=async()=>({settings:{}});export const getTransactionTypes=async()=>['سداد مورد'];export const clearProjectCache=()=>{}",loader:'js'}));b.onLoad({filter:/[\\/]lib[\\/]supabase\.js$/},()=>({contents:stub,loader:'js'}))}}],logLevel:'warning'})
await cp('dist/assets',out+'/assets',{recursive:true});const css=(await readdir(out+'/assets')).find(x=>x.endsWith('.css'))
await writeFile(out+'/app.html',`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="connect-src 'none';object-src 'none'"><link rel="stylesheet" href="/assets/${css}"></head><body><div style="padding:12px;background:#eee"><output id="qa-writes">الدفعات المسجلة: 0</output> · <output id="qa-balance">الرصيد الحالي: 100</output> <button onclick="window.fixtureChangeBalance()">تغيير الرصيد تجريبيًا</button></div><div id="root"></div><script src="/fixture.js"></script></body></html>`)
await writeFile(out+'/index.html',`<!doctype html><html><head><meta charset="utf-8"><title>Supplier credit synthetic QA</title></head><body><nav><button onclick="document.querySelector('iframe').width=320">320</button><button onclick="document.querySelector('iframe').width=1280">1280</button></nav><iframe title="معاينة السداد" src="/app.html" width="1280" height="1600" style="border:0;display:block;margin:auto"></iframe></body></html>`)
console.log(out)
