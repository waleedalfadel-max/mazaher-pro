// Integration against an isolated synthetic PostgreSQL fixture (REREAD_TEST_FIXTURE). Never connect to production.
// 2026-10-31 (20261031130000): approval keeps each item's printed VAT when the printed lines describe the reviewed amounts exactly;
// otherwise the proportional split exactly as before. Real path: approval_prepare → approval_approve as the accountant, then the
// expense report (expenseFigures), the financial analysis (windowFigures), the export model, Excel (modelToXlsx) and PDF (buildPages in a
// real browser) are built from the stored rows. Synthetic categories, documents and amounts only.
import assert from 'node:assert/strict'
import {readFile,mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
import {inflateRawSync} from 'node:zlib'
import {build} from 'esbuild'
import {expenseFigures} from '../src/lib/reportFigures.js'
import {windowFigures} from '../src/lib/financialAnalysis.js'
import {reportModel,sheetRows,modelToXlsx} from '../src/lib/reportExport.js'
import {inputVatOf,expenseAmountNet} from '../src/lib/financeRules.js'
if(!process.env.REREAD_TEST_FIXTURE)throw Error('Set REREAD_TEST_FIXTURE to an isolated synthetic fixture')
const {fixture}=await import(pathToFileURL(process.env.REREAD_TEST_FIXTURE)),f=await fixture()
let checks=0;const pass=s=>{checks++;console.log('PASS '+s)}
const r2=x=>Math.round(x*100)/100,sum=(a,k)=>r2(a.reduce((s,x)=>s+Number(x[k]),0))
const FOOD=randomUUID(),OIL=randomUUID(),CLEAN=randomUUID(),GLOVES=randomUUID(),DET=randomUUID()
const names={[FOOD]:'Synthetic food',[OIL]:'Synthetic oil',[CLEAN]:'Synthetic cleaning',[GLOVES]:'Synthetic gloves',[DET]:'Synthetic detergent'}
let day=0
// Printed lines (exclusive): oil 196 + 29.40 = 225.40; gloves 225 + 0.00 = 225.00 (printed zero); detergent 145 + 21.75 = 166.75. VAT 51.15, total 617.15
const lines=()=>[
  {description:'Synthetic oil 17L',amount:196,lineNet:196,lineVat:29.4,printedLineTotal:225.4,category_id:FOOD,subcategory_id:OIL},
  {description:'Synthetic gloves',amount:225,lineNet:225,lineVat:0,printedLineTotal:225,category_id:CLEAN,subcategory_id:GLOVES},
  {description:'Synthetic detergent',amount:145,lineNet:145,lineVat:21.75,printedLineTotal:166.75,category_id:CLEAN,subcategory_id:DET}]
const base=(over={})=>({type:'expense',transType:'🛒 مصروفات تشغيلية',paySource:'cash',date:new Date(Date.UTC(2026,0,++day)).toISOString().slice(0,10),
  description:'Synthetic supplier',invoiceNumber:'SYN-'+randomUUID().slice(0,8),amountsBasis:'exclusive',totalAmount:617.15,vatAmount:51.15,items:lines(),...over})
const docs={}
async function approve(key,inv){
  await f.claims(f.acc);const id=randomUUID()
  await f.db.query("insert into documents(id,project_id,file_name,status,analysis_result) values($1,$2,$3,'analyzed',$4)",[id,f.p1,'Synthetic '+key,JSON.stringify({invoices:[inv]})])
  const prep=await f.rpc(f.acc,'approval_prepare',[id]);assert.equal(prep.ok,true,key+' '+JSON.stringify(prep))
  const res=await f.rpc(f.acc,'approval_approve',[id,randomUUID(),prep.version,JSON.stringify(prep.analysis_result.invoices),'{}','{}']);assert.equal(res.ok,true,key+' '+JSON.stringify(res))
  const items=(await f.db.query('select id,journal_number,ledger_entry_id,category_id,subcategory_id,description,amount::float8 amount,vat_amount::float8 vat_amount,category_main,category_sub from document_items where document_id=$1 order by sort_order',[id])).rows
  const ledger=(await f.db.query("select id,journal_number,date::text date,type,status,category_id,category_main,category_sub,financial_class,cash_out::float8 cash_out,bank_out::float8 bank_out,custody_out::float8 custody_out,payable_in::float8 payable_in,payable_out::float8 payable_out,cash_in::float8 cash_in,bank_in::float8 bank_in,custody_in::float8 custody_in,receivable_in::float8 receivable_in,receivable_out::float8 receivable_out,vat_amount::float8 vat_amount,total_amount::float8 total_amount,description,document_id from ledger_entries where document_id=$1 order by category_id",[id])).rows
  docs[key]={id,inv,items,ledger};return docs[key]
}
const vats=d=>d.items.map(i=>i.vat_amount),nets=d=>d.items.map(i=>r2(i.amount-i.vat_amount))
const cat=(d,c)=>d.ledger.find(l=>l.category_id===c)
const totalsMatch=(d,label)=>{const t=Number(d.inv.totalAmount),v=Number(d.inv.vatAmount)
  assert.equal(sum(d.items,'amount'),t,label+' items total');assert.equal(sum(d.items,'vat_amount'),v,label+' items VAT')
  assert.equal(r2(d.ledger.reduce((s,l)=>s+l.cash_out,0)),t,label+' ledger total');assert.equal(sum(d.ledger,'vat_amount'),v,label+' ledger VAT')}
const categories=[{id:FOOD,name:names[FOOD],parent_id:null},{id:OIL,name:names[OIL],parent_id:FOOD},{id:CLEAN,name:names[CLEAN],parent_id:null},{id:GLOVES,name:names[GLOVES],parent_id:CLEAN},{id:DET,name:names[DET],parent_id:CLEAN}]
const categoriesById=Object.fromEntries(categories.map(c=>[c.id,c]))
// expense report, analysis and export from the stored rows of one document: sub-category nets, no double count of VAT or discount
function reports(d){
  const entries=d.ledger.map(l=>({...l,status:'approved'})),docItems=d.items
  const x=expenseFigures({entries,docItems,categoriesById,engineSummary:{totalSales:0},data:{}})
  const subs=Object.fromEntries(x.mainRows.flatMap(m=>m.subs.map(s=>[s.label,r2(s.total)])))
  const mains=Object.fromEntries(x.mainRows.map(m=>[m.label,r2(m.total)]))
  const w={key:'all',start:'2026-01-01',end:'2026-12-31',from:'2026-01-01',to:'2026-12-31'}
  const fig=windowFigures(entries,w,{docItems,categoriesById})
  const aSubs=Object.fromEntries(fig.mains.flatMap(m=>m.subs.map(s=>[s.label,s.h/100])))
  const model=reportModel({tab:'purchases',org:'Synthetic',from:'2026-01-01',to:'2026-12-31',branch:'all',branches:[],generatedAt:new Date(2026,9,31),x})
  const rows=sheetRows(model)
  const netTotal=r2(entries.reduce((s,e)=>s+expenseAmountNet(e),0)),vatTotal=r2(entries.reduce((s,e)=>s+inputVatOf(e),0))
  return {x,subs,mains,aSubs,model,rows,netTotal,vatTotal}
}
const rowsHave=(rows,label,amount)=>rows.some(r=>r.cells.some(c=>c.v===label)&&r.cells.some(c=>typeof c.v==='number'&&Math.abs(c.v-amount)<0.005))
const XLSX=model=>{const buf=Buffer.from(modelToXlsx(model));let o=0,out={};while(buf.readUInt32LE(o)===0x04034b50){const m=buf.readUInt16LE(o+8),s=buf.readUInt32LE(o+18),n=buf.readUInt16LE(o+26),e=buf.readUInt16LE(o+28);const name=buf.slice(o+30,o+30+n).toString();const st=o+30+n+e;const data=buf.slice(st,st+s);out[name]=(m===0?data:inflateRawSync(data)).toString();o=st+s}return out['xl/worksheets/sheet1.xml']}
const pdfModels={}
try{
 await f.db.query("insert into categories(id,project_id,name,type,ledger_type,financial_class,parent_id) values($1,$6,$7,'expense','🥩 تكلفة البضاعة المباعة','cogs',null),($2,$6,$8,'expense','🥩 تكلفة البضاعة المباعة','cogs',$1),($3,$6,$9,'expense','🛒 مصروفات تشغيلية','opex',null),($4,$6,$10,'expense','🛒 مصروفات تشغيلية','opex',$3),($5,$6,$11,'expense','🛒 مصروفات تشغيلية','opex',$3)",
  [FOOD,OIL,CLEAN,GLOVES,DET,f.p1,names[FOOD],names[OIL],names[CLEAN],names[GLOVES],names[DET]])
 await f.db.query("insert into approval_private.settings(project_id,mode) values($1,'v2')",[f.p1])
 // A template that already has the fix (lv_fix) is returned to the current production state first, so "before" is always the current behaviour
 if((await f.db.query("select count(*)::int n from pg_proc where proname='item_vats'")).rows[0].n)await f.db.exec(await readFile('supabase/rollback/invoice-line-vat.sql','utf8'))

 // ── Current production behaviour (before the migration): same invoice
 const before=await approve('before',base()),bR=reports(before)
 assert.ok(before.items[1].vat_amount>0);totalsMatch(before,'before')
 assert.deepEqual(nets(before),[196,225,145],'exclusive nets are right even with the old split')
 pass('current version: exempt line gets VAT '+before.items[1].vat_amount+'; totals right; category VAT wrong (cleaning '+cat(before,CLEAN).vat_amount+' vs printed 21.75)')
 const legacyIn=base({items:lines().map(({lineNet,lineVat,printedLineTotal,...i})=>i)});const legacyBefore=await approve('legacy-before',legacyIn)

 await f.db.exec(await readFile('supabase/migrations/20261031130000_invoice_line_vat.sql','utf8'))

 // ── 1. Mixed invoice, exclusive: each line keeps net/VAT/gross as printed and reviewed; printed zero stays zero
 const ex=await approve('mixed-exclusive',base())
 assert.deepEqual(ex.items.map(i=>[r2(i.amount-i.vat_amount),i.vat_amount,i.amount]),[[196,29.4,225.4],[225,0,225],[145,21.75,166.75]])
 assert.deepEqual([cat(ex,FOOD).cash_out,cat(ex,FOOD).vat_amount],[225.4,29.4]);assert.deepEqual([cat(ex,CLEAN).cash_out,cat(ex,CLEAN).vat_amount],[391.75,21.75]);totalsMatch(ex,'exclusive')
 pass('mixed exclusive: every line net/VAT/gross as printed; printed zero kept as 0; category VAT = printed; totals 617.15 / 51.15')

 // ── 2. Mixed invoice, inclusive basis
 const inc=await approve('mixed-inclusive',base({amountsBasis:'inclusive',items:lines().map(i=>({...i,amount:i.printedLineTotal}))}))
 assert.deepEqual(inc.items.map(i=>[r2(i.amount-i.vat_amount),i.vat_amount,i.amount]),[[196,29.4,225.4],[225,0,225],[145,21.75,166.75]]);totalsMatch(inc,'inclusive')
 pass('mixed inclusive: same exact lines (net 225 for the zero-VAT line, not 225 minus a share)')

 // ── 3. Known + explicit zero + missing VAT: known keeps printed VAT, explicit zero stays 0, missing takes the remainder (not zero, no inference from names)
 const mix=base();mix.items[2].description='Synthetic detergent (exempt)';delete mix.items[2].lineVat
 const m=await approve('known-zero-missing',mix);assert.deepEqual(vats(m),[29.4,0,21.75]);totalsMatch(m,'mixed missing')
 const nul=base();nul.items[2].lineVat=null;assert.deepEqual(vats(await approve('null-vat',nul)),[29.4,0,21.75])
 const str=base();str.items[2].lineVat='21.75';assert.deepEqual(vats(await approve('string-vat',str)),[29.4,0,21.75])
 pass('known + explicit zero + missing (also null or text): 29.40 / 0 / 21.75 — missing gets the remainder, the zero line none, name ignored')
 // missing line whose remainder is larger than 15% of its net: inconsistent → whole VAT over non-zero lines, zero line still 0
 const big=base({vatAmount:80,totalAmount:646});delete big.items[2].lineVat
 const bg=await approve('missing-too-big',big);assert.equal(bg.items[1].vat_amount,0);assert.equal(sum(bg.items,'vat_amount'),80);totalsMatch(bg,'too big')
 pass('remainder impossible for the missing line: proportional over non-zero lines only; explicit zero still 0; totals 646 / 80')

 // ── 4. Reviewer changed an amount: that line's printed VAT is no longer used; remainder logic; zero line unaffected
 const ed=base({totalAmount:622.15});ed.items[2].amount=150
 const e=await approve('reviewer-edit',ed);assert.equal(e.items[1].vat_amount,0);assert.equal(e.items[0].vat_amount,29.4)
 assert.equal(r2(e.items[2].amount-e.items[2].vat_amount),150);assert.equal(e.items[2].vat_amount,21.75);totalsMatch(e,'edited')
 const edz=base({totalAmount:612.15});edz.items[1].amount=220
 const ez=await approve('reviewer-edit-zero-line',edz);assert.equal(ez.items[1].vat_amount,0,'remainder 0');totalsMatch(ez,'edited zero')
 pass('reviewer-edited amount: edited line treated as unknown and takes the remainder; reviewed nets kept; explicit zero untouched')

 // ── 5. Invoice discount changes every reviewed amount: printed VAT no longer matches → not used (old split); discount and VAT counted once
 const di=await approve('invoice-discount',base({invoiceDiscount:10,totalAmount:607.15}))
 assert.deepEqual(vats(di).map(v=>v>0),[true,true,true],'printed figures invalidated by the discount');totalsMatch(di,'discount')
 assert.equal(r2(sum(di.items,'amount')-sum(di.items,'vat_amount')),556)
 const dR=reports(di);assert.equal(dR.netTotal,556);assert.equal(r2(Object.values(dR.subs).reduce((s,v)=>s+v,0)),556);assert.equal(dR.vatTotal,51.15)
 pass('invoice discount: printed line VAT invalidated (amounts changed); report nets 556 (discount once), VAT 51.15 once')

 // ── 6. Line discount: valid when the printed net is the discounted amount; invalid when it no longer matches
 const ld=base();ld.items[2].discount=5;assert.deepEqual(vats(await approve('line-discount-matching',ld)),[29.4,0,21.75])
 const ld2=base({totalAmount:612.15});ld2.items[2].discount=5;ld2.items[2].amount=140
 const l2=await approve('line-discount-changed',ld2);assert.equal(l2.items[1].vat_amount,0);assert.equal(r2(l2.items[2].amount-l2.items[2].vat_amount),140);totalsMatch(l2,'line discount changed')
 pass('line discount: exact when printed net = discounted amount; when the discount changes the amount the old printed VAT is not used for that line; explicit zero still 0')

 // ── 7. Old data shape (no per-line VAT fields): identical to the current version
 const leg=await approve('legacy-after',{...legacyIn,date:new Date(Date.UTC(2026,0,++day)).toISOString().slice(0,10),invoiceNumber:'SYN-L2'})
 assert.deepEqual(leg.items.map(i=>[i.amount,i.vat_amount]),legacyBefore.items.map(i=>[i.amount,i.vat_amount]))
 pass('old data shape without line VAT: stored values identical to the current version')

 // ── 8. Inconsistent printed lines: zero line never takes VAT while it is valid; totals always intact
 const bad={
  'net + VAT ≠ printed line total':[i=>{i.items[0].printedLineTotal=225.5},[29.4,0,21.75]],
  'line VAT above 15% of net':[i=>{i.items[0].lineVat=36.3;i.items[0].printedLineTotal=232.3;i.items[2].lineVat=14.85;i.items[2].printedLineTotal=159.85},null],
  'three decimals':[i=>{i.items[0].lineVat=29.395;i.items[0].printedLineTotal=225.395;i.items[2].lineVat=21.755;i.items[2].printedLineTotal=166.755},[29.4,0,21.75]],
  'sum ≠ invoice VAT':[i=>{i.vatAmount=51.25;i.totalAmount=617.25},null]}
 for(const [name,[mut,exp]] of Object.entries(bad)){const inv=base();mut(inv);const d=await approve('bad-'+name,inv)
  assert.equal(d.items[1].vat_amount,0,name+' zero line');if(exp)assert.deepEqual(vats(d),exp,name);totalsMatch(d,name)}
 pass('inconsistent printed lines (4 cases): explicit zero stays 0, totals intact')

 // ── 8b. Every line printed with VAT 0 but the invoice has VAT: approval stops for review (no VAT pushed onto zero lines)
 {await f.claims(f.acc);const id=randomUUID();const inv=base({vatAmount:10,totalAmount:586,items:[{...lines()[1]},{...lines()[1],description:'Synthetic gloves 2'},{description:'Synthetic box',amount:126,lineNet:126,lineVat:0,printedLineTotal:126,category_id:CLEAN,subcategory_id:GLOVES}]})
  await f.db.query("insert into documents(id,project_id,file_name,status,analysis_result) values($1,$2,'Synthetic conflict','analyzed',$3)",[id,f.p1,JSON.stringify({invoices:[inv]})])
  const prep=await f.rpc(f.acc,'approval_prepare',[id]);const res=await f.rpc(f.acc,'approval_approve',[id,randomUUID(),prep.version,JSON.stringify(prep.analysis_result.invoices),'{}','{}'])
  assert.equal(res.ok,false);assert.equal(res.code,'line_vat_conflict')
  assert.equal((await f.db.query('select count(*)::int n from ledger_entries where document_id=$1',[id])).rows[0].n,0);assert.equal((await f.db.query('select status from documents where id=$1',[id])).rows[0].status,'analyzed')
  pass('all lines VAT 0 but invoice VAT 10: approval stops (line_vat_conflict), nothing written, document stays for review')}

 // ── 9. Reports, analysis, export from stored rows (mixed exclusive and inclusive): sub-category nets as printed, nothing counted twice
 for(const key of ['mixed-exclusive','mixed-inclusive']){
  const R=reports(docs[key])
  assert.deepEqual(R.subs,{[names[OIL]]:196,[names[GLOVES]]:225,[names[DET]]:145},key+' report subs')
  assert.deepEqual(R.aSubs,{[names[OIL]]:196,[names[GLOVES]]:225,[names[DET]]:145},key+' analysis subs')
  assert.equal(R.netTotal,566);assert.equal(R.vatTotal,51.15)
  assert.ok(rowsHave(R.rows,names[GLOVES],225)&&rowsHave(R.rows,names[DET],145),key+' sheet rows '+JSON.stringify(R.rows).slice(0,400))
  const sheet=XLSX(R.model);assert.ok(sheet.includes('>225<')||sheet.includes('<v>225</v>'),key+' xlsx 225')
  pdfModels[key]=R.model
 }
 pass('report, analysis, export rows and Excel: oil 196, gloves 225, detergent 145; net 566 and VAT 51.15 counted once (exclusive and inclusive)')
 // current version rows through the new report code: still consistent (category totals unchanged, sub split by stored nets)
 assert.deepEqual(reports(before).mains,bR.mains);pass('stored rows from the current version: category totals in the report unchanged by the report change')

 // ── 10. PDF from the same export model in a real browser
 {const require=createRequire(import.meta.url);let pw;try{pw=require('playwright')}catch{pw=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'.','../package.json'))('playwright')}
  const dir=await mkdtemp(path.join(tmpdir(),'linevat-pdf-')),bundle=path.join(dir,'pdf.js')
  await build({stdin:{contents:"import {buildPages} from './src/lib/reportPdf.js';window.buildPages=buildPages",resolveDir:process.cwd(),loader:'js'},outfile:bundle,bundle:true,platform:'browser',format:'iife',define:{'import.meta.env':'{}'},logLevel:'warning'})
  const browser=await pw.chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:900,height:1200}})
  try{await page.setContent('<html dir="rtl"><body></body></html>');await page.addScriptTag({path:bundle})
   for(const [key,model] of Object.entries(pdfModels)){
    const text=await page.evaluate(m=>{const pages=window.buildPages(m);const t=(pages?.root||document.querySelector('.rpdf-root'))?.innerText||'';document.querySelectorAll('.rpdf-root').forEach(n=>n.remove());return t},JSON.parse(JSON.stringify(model)))
    for(const [label,amount] of [[names[GLOVES],'225.00'],[names[DET],'145.00'],[names[OIL],'196.00']])assert.ok(text.includes(label)&&text.includes(amount),key+' pdf '+label+' '+text.slice(0,300))
   }}finally{await browser.close()}
  pass('PDF pages (real browser, same model): gloves 225.00, detergent 145.00, oil 196.00')}

 // ── 11. Rollback after an approval made with the fix: stored rows untouched; new approvals proportional again; re-apply identical
 const snap=async()=>(await f.db.query("select md5(string_agg(t::text,'|' order by t::text)) h from (select to_jsonb(l)-'created_at' t from ledger_entries l where project_id=$1 union all select to_jsonb(i)-'created_at' from document_items i where project_id=$1 union all select to_jsonb(d)-'created_at'-'decided_at' from approval_private.document_invoices d where project_id=$1) x",[f.p1])).rows[0].h
 const h1=await snap()
 await f.db.exec(await readFile('supabase/rollback/invoice-line-vat.sql','utf8'))
 assert.equal(await snap(),h1,'rollback changed stored data');assert.equal((await f.db.query("select count(*)::int n from pg_proc where proname='item_vats'")).rows[0].n,0)
 const ex2=(await f.db.query('select vat_amount::float8 v from document_items where document_id=$1 order by sort_order',[ex.id])).rows.map(r=>r.v);assert.deepEqual(ex2,[29.4,0,21.75])
 const after=await approve('after-rollback',base());assert.deepEqual(vats(after),vats(before))
 await f.db.exec(await readFile('supabase/migrations/20261031130000_invoice_line_vat.sql','utf8'))
 const again=await approve('reapplied',base());assert.deepEqual(vats(again),[29.4,0,21.75])
 pass('rollback after a fixed approval: stored rows byte-identical, fixed invoice still exact, new approval proportional; re-apply exact again')
 console.log('RESULT '+JSON.stringify({checks}))
}finally{await f.db.close()}
