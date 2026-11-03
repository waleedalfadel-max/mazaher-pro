// Synthetic, offline UI fixture: no accounts, credentials or production requests.
// node tests/browser/prepare-upload-history.mjs /path/to/empty/output
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
if (!process.argv[2]) throw Error('Supply an output directory')
const out = path.resolve(process.argv[2])
await mkdir(out, { recursive: true })
const transport = String.raw`
const own='00000000-0000-0000-0000-000000000001', purchaser='00000000-0000-0000-0000-000000000002', second='00000000-0000-0000-0000-000000000003';
export let rows=Array.from({length:37},(_,i)=>({id:String(i).padStart(4,'0'),project_id:'a',file_name:'مستند تجريبي '+(i+1)+'.pdf',file_type:'application/pdf',file_url:'synthetic-document',status:['approved','analyzed','uploaded','rejected'][i%4],uploaded_at:i<3?'2026-11-02T21:00:00Z':'2026-11-02T10:00:00Z',created_by_user_id:i%3===0?own:i%3===1?purchaser:second,created_by_name:i%3===0?'مالك تجريبي':i%3===1?'مشتريات أول':'مشتريات ثانٍ',created_by_role:i%3===0?'owner':'purchasing',uploaded_by_name:i%3===0?'مالك تجريبي':i%3===1?'مشتريات أول':'مشتريات ثانٍ',uploaded_by:i%3===0?'owner':'purchasing'}));
rows.push({...rows[3],id:'other',project_id:'b',file_name:'مستند المنشأة الثانية.pdf'});
rows.push({...rows[0],id:'legacy',file_name:'مستند قديم.pdf',created_by_user_id:null,created_by_name:null,created_by_role:null,uploaded_by_name:'رافع سابق',uploaded_by:'cashier',uploaded_at:'2026-10-01T10:00:00Z'});
export const remove=id=>{rows=rows.filter(d=>d.id!==id)};
export const failure={enabled:false};
class Query {
 constructor(table){this.table=table;this.filters=[];this.orders=[];this.start=0;this.end=Infinity}
 select(){return this} eq(k,v){this.filters.push(r=>r[k]===v);return this} is(k,v){return this.eq(k,v)}
 gte(k,v){this.filters.push(r=>r[k]>=v);return this} lt(k,v){this.filters.push(r=>r[k]<v);return this}
 order(k,{ascending}){this.orders.push([k,ascending]);return this} range(a,b){this.start=a;this.end=b+1;return this}
 abortSignal(s){this.signal=s;return this} maybeSingle(){this.single=true;return this}
 or(s){const parts=s.match(/^([a-z_]+)\.eq\.(.*),and\(\1\.is\.null,([a-z_]+)\.eq\.(.*)\)$/);if(!parts)throw Error('Unsupported synthetic filter '+s);const unquote=v=>v.startsWith('"')?JSON.parse(v):v;this.filters.push(r=>r[parts[1]]===unquote(parts[2])||(r[parts[1]]==null&&r[parts[3]]===unquote(parts[4])));return this}
 async then(resolve,reject){try{await new Promise(r=>setTimeout(r,50));if(this.signal?.aborted)throw Error('Aborted');if(failure.enabled&&this.table==='documents')return resolve({error:{message:'Synthetic failure'}});let data=this.table==='app_users'?[{id:own}]:rows.filter(r=>this.filters.every(f=>f(r)));data=[...data].sort((a,b)=>{for(const[k,asc]of this.orders){if(a[k]!==b[k])return(a[k]<b[k]?-1:1)*(asc?1:-1)}return 0});return resolve({data:this.single?data[0]:data.slice(this.start,this.end),count:data.length,error:null})}catch(e){return reject(e)}}
}
export const supabase={from:t=>new Query(t),auth:{getSession:async()=>({data:{session:{user:{id:'synthetic-auth'}}}})}};
`
const contents = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import UploadHistory from './src/components/UploadHistory.jsx';import{MyUploads}from'./src/components/UploadKit.jsx';import{canViewAllUploads}from'./src/lib/uploadHistory.js';import{rows,remove,failure}from'./src/lib/supabase.js';import './src/ui/fonts.js';import './src/ui/theme.css';import './src/ui/app.css';
function App(){const[role,setRole]=useState('owner'),[project,setProject]=useState('a'),[opened,setOpened]=useState(''),[refresh,setRefresh]=useState(0);return <main className='rp-upload' style={{padding:16}}><h1>معاينة سجل المستندات — بيانات تجريبية</h1><label>حساب الاختبار <select value={role} onChange={e=>setRole(e.target.value)}>{['owner','accountant','superadmin','purchasing','cashier'].map(r=><option key={r}>{r}</option>)}</select></label><label>منشأة الاختبار <select value={project} onChange={e=>setProject(e.target.value)}><option value='a'>الأولى</option><option value='b'>الثانية</option></select></label><label><input type='checkbox' onChange={e=>{failure.enabled=e.target.checked;setRefresh(n=>n+1)}}/>تعطّل التحميل التجريبي</label><output>{opened}</output>{canViewAllUploads(role)?<UploadHistory key={role+project} projectId={project} role={role} userName='مالك تجريبي' refreshKey={refresh} onOpen={()=>setOpened('تم فتح المستند التجريبي')} onDelete={async d=>{remove(d.id);setRefresh(n=>n+1);return true}}/>:<MyUploads docs={rows.filter(r=>r.project_id===project&&r.created_by_name==='مشتريات أول').slice(0,10)} loading={false} onOpen={()=>setOpened('تم فتح المستند التجريبي')} onDelete={()=>{}}/>}</main>};createRoot(document.getElementById('root')).render(<App/>);`
await build({ stdin: { contents, resolveDir: root, loader: 'jsx' }, outfile: out+'/app.js', bundle:true, format:'esm',
  define: { 'process.env.NODE_ENV':'"production"' }, loader:{'.woff2':'dataurl','.woff':'dataurl'},
  plugins:[{name:'offline-only',setup(b){b.onLoad({filter:/[\\/]lib[\\/]supabase\.js$/},()=>({contents:transport,loader:'js'}))}}],logLevel:'warning',
})
await writeFile(out+'/index.html','<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="connect-src \'none\';object-src \'none\'"><link rel="stylesheet" href="./app.css"></head><body><div id="root"></div><script type="module" src="./app.js"></script></body></html>')
console.log(out)
