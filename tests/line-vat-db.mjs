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
import {approvalMessage} from '../src/lib/approvalV2.js'
if(!process.env.REREAD_TEST_FIXTURE)throw Error('Set REREAD_TEST_FIXTURE to an isolated synthetic fixture')
const {fixture}=await import(pathToFileURL(process.env.REREAD_TEST_FIXTURE)),f=await fixture()
let checks=0;const pass=s=>{checks++;console.log('PASS '+s)}
const r2=x=>Math.round(x*100)/100,sum=(a,k)=>r2(a.reduce((s,x)=>s+Number(x[k]),0))
const FOOD=randomUUID(),OIL=randomUUID(),CLEAN=randomUUID(),GLOVES=randomUUID(),DET=randomUUID()
const names={[FOOD]:'Synthetic food',[OIL]:'Synthetic oil',[CLEAN]:'Synthetic cleaning',[GLOVES]:'Synthetic gloves',[DET]:'Synthetic detergent'}
let day=0
// Fully synthetic printed lines (exclusive): oil 200 + 30.00 = 230.00; gloves 180 + 0.00 = 180.00 (printed zero); detergent 120 + 18.00 = 138.00. VAT 48.00, total 548.00
const lines=()=>[
  {description:'Synthetic oil can',amount:200,lineNet:200,lineVat:30,printedLineTotal:230,category_id:FOOD,subcategory_id:OIL},
  {description:'Synthetic gloves',amount:180,lineNet:180,lineVat:0,printedLineTotal:180,category_id:CLEAN,subcategory_id:GLOVES},
  {description:'Synthetic detergent',amount:120,lineNet:120,lineVat:18,printedLineTotal:138,category_id:CLEAN,subcategory_id:DET}]
const base=(over={})=>({type:'expense',transType:'🛒 مصروفات تشغيلية',paySource:'cash',date:new Date(Date.UTC(2026,0,++day)).toISOString().slice(0,10),
  description:'Synthetic supplier',invoiceNumber:'SYN-'+randomUUID().slice(0,8),amountsBasis:'exclusive',totalAmount:548,vatAmount:48,items:lines(),...over})
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
 assert.deepEqual(nets(before),[200,180,120],'exclusive nets are right even with the old split')
 pass('current version: exempt line gets VAT '+before.items[1].vat_amount+'; totals right; category VAT wrong (cleaning '+cat(before,CLEAN).vat_amount+' vs printed 18.00)')
 const legacyIn=base({items:lines().map(({lineNet,lineVat,printedLineTotal,...i})=>i)});const legacyBefore=await approve('legacy-before',legacyIn)

 await f.db.exec(await readFile('supabase/migrations/20261031130000_invoice_line_vat.sql','utf8'))

 // ── 1. Mixed invoice, exclusive: each line keeps net/VAT/gross as printed and reviewed; printed zero stays zero
 const ex=await approve('mixed-exclusive',base())
 assert.deepEqual(ex.items.map(i=>[r2(i.amount-i.vat_amount),i.vat_amount,i.amount]),[[200,30,230],[180,0,180],[120,18,138]])
 assert.deepEqual([cat(ex,FOOD).cash_out,cat(ex,FOOD).vat_amount],[230,30]);assert.deepEqual([cat(ex,CLEAN).cash_out,cat(ex,CLEAN).vat_amount],[318,18]);totalsMatch(ex,'exclusive')
 pass('mixed exclusive: every line net/VAT/gross as printed; printed zero kept as 0; category VAT = printed; totals 548.00 / 48.00')

 // ── 2. Mixed invoice, inclusive basis
 const inc=await approve('mixed-inclusive',base({amountsBasis:'inclusive',items:lines().map(i=>({...i,amount:i.printedLineTotal}))}))
 assert.deepEqual(inc.items.map(i=>[r2(i.amount-i.vat_amount),i.vat_amount,i.amount]),[[200,30,230],[180,0,180],[120,18,138]]);totalsMatch(inc,'inclusive')
 pass('mixed inclusive: same exact lines (net 180 for the zero-VAT line, not 180 minus a share)')

 // A conflict stops approval for review: the code, the reason, nothing written, document still waiting for review
 async function conflict(key,inv,reason){
  await f.claims(f.acc);const id=randomUUID()
  await f.db.query("insert into documents(id,project_id,file_name,status,analysis_result) values($1,$2,$3,'analyzed',$4)",[id,f.p1,'Synthetic '+key,JSON.stringify({invoices:[inv]})])
  const prep=await f.rpc(f.acc,'approval_prepare',[id]);assert.equal(prep.ok,true,key)
  const res=await f.rpc(f.acc,'approval_approve',[id,randomUUID(),prep.version,JSON.stringify(prep.analysis_result.invoices),'{}','{}'])
  assert.equal(res.ok,false,key+' '+JSON.stringify(res));assert.equal(res.code,'line_vat_conflict',key);assert.equal(res.reason,reason,key+' '+JSON.stringify(res))
  assert.equal((await f.db.query('select count(*)::int n from ledger_entries where document_id=$1',[id])).rows[0].n,0,key+' ledger')
  assert.equal((await f.db.query('select count(*)::int n from document_items where document_id=$1',[id])).rows[0].n,0,key+' items')
  assert.equal((await f.db.query('select status from documents where id=$1',[id])).rows[0].status,'analyzed',key)
  return res}

 // ── 3. Known + explicit zero + missing VAT: known keeps printed VAT, explicit zero stays 0, missing takes the remainder (not zero, no inference from names)
 const mix=base();mix.items[2].description='Synthetic detergent (exempt)';delete mix.items[2].lineVat
 const m=await approve('known-zero-missing',mix);assert.deepEqual(vats(m),[30,0,18]);totalsMatch(m,'mixed missing')
 const nul=base();nul.items[2].lineVat=null;assert.deepEqual(vats(await approve('null-vat',nul)),[30,0,18])
 const str=base();str.items[2].lineVat='18';assert.deepEqual(vats(await approve('string-vat',str)),[30,0,18])
 pass('known + explicit zero + missing (also null or text): 30.00 / 0 / 18.00 — missing gets the remainder within its own 15% limit, the zero line none, name ignored')

 // ── 4. Missing line whose share of the remainder exceeds its own 15% limit (invoice VAT 80): stops for review, no silent redistribution
 const big=base({vatAmount:80,totalAmount:580});delete big.items[2].lineVat
 const bg=await conflict('missing-too-big',big,'line_over_limit');assert.equal(bg.line,3);assert.equal(Number(bg.line_vat),50);assert.equal(Number(bg.limit),18.02)
 pass('missing line would carry 50.00 on a 120 net (limit 18.02): line_vat_conflict / line_over_limit, line 3; nothing written')

 // ── 5. Valid printed VAT that does not match the invoice VAT: stops for review
 await conflict('sum-mismatch',base({vatAmount:48.1,totalAmount:548.1}),'sum_mismatch')
 const ng=await conflict('printed-above-invoice',base({vatAmount:40,totalAmount:540}),'sum_mismatch');assert.equal(Number(ng.printed_vat),48)
 const nr=base({vatAmount:20,totalAmount:520});delete nr.items[1].lineVat;await conflict('negative-remainder',nr,'negative_remainder')
 pass('valid printed VAT ≠ invoice VAT (48.00 vs 48.10 and 40), and printed above invoice with an unknown line: stop for review; nothing written')

 // ── 6. Reviewer changed an amount: that line becomes unknown and takes the remainder only within its own limit
 const ed=base({totalAmount:553});ed.items[2].amount=125
 const e=await approve('reviewer-edit',ed);assert.deepEqual(vats(e),[30,0,18]);assert.equal(r2(e.items[2].amount-e.items[2].vat_amount),125);totalsMatch(e,'edited')
 const edz=base({totalAmount:538});edz.items[1].amount=170
 const ez=await approve('reviewer-edit-zero-line',edz);assert.equal(ez.items[1].vat_amount,0,'remainder 0');totalsMatch(ez,'edited zero')
 const edb=base({totalAmount:543});edb.items[2].amount=115;await conflict('reviewer-edit-over-limit',edb,'line_over_limit')
 pass('reviewer-edited amount: edited line takes the remainder (18.00 on 125 ok; 18.00 on 115 exceeds 17.27 → stop); explicit zero untouched')

 // ── 7. Invoice discount changes every reviewed amount: printed VAT no longer matches → all lines unknown → remainder over all, each within its limit
 const di=await approve('invoice-discount',base({invoiceDiscount:10,totalAmount:538}))
 assert.deepEqual(vats(di).map(v=>v>0),[true,true,true],'printed figures invalidated by the discount');totalsMatch(di,'discount')
 assert.equal(r2(sum(di.items,'amount')-sum(di.items,'vat_amount')),490)
 const dR=reports(di);assert.equal(dR.netTotal,490);assert.equal(r2(Object.values(dR.subs).reduce((s,v)=>s+v,0)),490);assert.equal(dR.vatTotal,48)
 pass('invoice discount: printed line VAT invalidated (amounts changed), every line within 15%; report nets 490 (discount once), VAT 48 once')

 // ── 8. Line discount: valid when the printed net is the discounted amount; when the discount changes the amount the old printed VAT is not used
 const ld=base();ld.items[2].discount=5;assert.deepEqual(vats(await approve('line-discount-matching',ld)),[30,0,18])
 const ld2=base({totalAmount:543});ld2.items[2].discount=5;ld2.items[2].amount=115;await conflict('line-discount-changed',ld2,'line_over_limit')
 pass("line discount: exact when printed net = discounted amount; changed amount → old VAT not used, and here the remainder exceeds that line's limit → stop")

 // ── 9a. Old readings with no line VAT data at all: the previous proportional split exactly, no new checks
 const leg=await approve('legacy-after',{...legacyIn,date:new Date(Date.UTC(2026,0,++day)).toISOString().slice(0,10),invoiceNumber:'SYN-L2'})
 assert.deepEqual(leg.items.map(i=>[i.amount,i.vat_amount]),legacyBefore.items.map(i=>[i.amount,i.vat_amount]))
 pass('old readings without line VAT data: stored values identical to the current version (no conflict checks applied)')

 // ── 9b. Malformed printed lines are unknown (not trusted), then remainder within each line's limit, or stop
 const bad={
  'net + VAT ≠ printed line total':[i=>{i.items[0].printedLineTotal=230.5},[30,0,18],null],
  'three decimals':[i=>{i.items[0].lineVat=29.995;i.items[0].printedLineTotal=229.995;i.items[2].lineVat=18.005;i.items[2].printedLineTotal=138.005},[30,0,18],null],
  'line VAT above 15% of net':[i=>{i.items[0].lineVat=36;i.items[0].printedLineTotal=236;i.items[2].lineVat=12;i.items[2].printedLineTotal=132},null,'line_over_limit']}
 for(const [name,[mut,exp,reason]] of Object.entries(bad)){const inv=base();mut(inv)
  if(reason){await conflict('bad-'+name,inv,reason);continue}
  const d=await approve('bad-'+name,inv);assert.deepEqual(vats(d),exp,name);totalsMatch(d,name)}
 pass('malformed printed lines (3 cases): treated as unknown; within limits → remainder, otherwise stop; explicit zero stays 0')

 // ── 9c. Every line printed with VAT 0 but the invoice has VAT: stop for review
 await conflict('all-zero',base({vatAmount:10,totalAmount:510,items:[{...lines()[1]},{...lines()[1],description:'Synthetic gloves 2'},{description:'Synthetic box',amount:140,lineNet:140,lineVat:0,printedLineTotal:140,category_id:CLEAN,subcategory_id:GLOVES}]}),'all_zero')
 pass('all lines VAT 0 but invoice VAT 10: line_vat_conflict / all_zero; nothing written')

 // ── 9d. Reviewer corrections reach the server: the approved VAT must equal the recorded corrected value; an invalid correction stops
 //        (it never falls back to "unknown" and gets the remainder instead)
 const corrected=(vat,extra={})=>{const inv=base();inv.items[2]={...inv.items[2],lineVat:vat,printedLineTotal:120+vat,vatCorrection:{original:{lineVat:0,lineNet:120,printedLineTotal:120},value:vat,reason:'synthetic correction',basis:'exclusive',amount:120,discount:0,...extra}};return inv}
 const c19=await conflict('correction-19',corrected(19),'correction_invalid');assert.equal(c19.line,3);assert.equal(c19.cause,'over_limit');assert.equal(Number(c19.corrected_vat),19);assert.equal(Number(c19.limit),18.02)
 const c18=await approve('correction-18',corrected(18));assert.deepEqual(vats(c18),[30,0,18])
 const c18p=(await f.db.query("select approved_payload->'items'->2->'vatCorrection'->>'value' v, approved_payload->'items'->2->>'lineVat' lv from approval_private.document_invoices where document_id=$1",[c18.id])).rows[0]
 assert.equal(Number(c18p.v),18);assert.equal(Number(c18p.lv),18);assert.equal(c18.items[2].vat_amount,Number(c18p.v),'stored VAT = recorded corrected value')
 const tampered=corrected(18,{value:17});const ct=await conflict('correction-tampered',tampered,'correction_invalid');assert.equal(ct.cause,'value_mismatch')
 const moved=corrected(18);moved.items[2].amount=125;moved.totalAmount=553;const cm=await conflict('correction-amount-changed',moved,'correction_invalid');assert.equal(cm.cause,'not_matching_amount')
 // The screen message is built from the server's actual response (code line_vat_conflict, reason correction_invalid, line/corrected_vat/limit/cause)
 assert.equal(c19.code,'line_vat_conflict');assert.equal(c19.reason,'correction_invalid')
 assert.equal(approvalMessage(c19),'ضريبة البند 3 المصححة 19.00 تتجاوز 15% من صافيه (الحد 18.02)؛ لا تُستبدل بتوزيع. صحّح ضريبة البند أو ألغِ التصحيح. لم يُسجَّل شيء.')
 assert.match(approvalMessage(ct),/ضريبة البند 3 المصححة 17.00 لا تطابق القيمة المسجلة في التصحيح.*لم يُسجَّل شيء/)
 assert.match(approvalMessage(cm),/ضريبة البند 3 المصححة 18.00 لا تطابق مبلغ البند المراجَع.*لم يُسجَّل شيء/)
 pass('server: correction 19 stops (correction_invalid / over_limit, limit 18.02) with nothing written; correction 18 approved, stored VAT 18 = recorded value; tampered value and changed amount stop; the screen message from each real response names the line, the corrected VAT and the cause')

 // ── 9. Reports, analysis, export from stored rows (mixed exclusive and inclusive): sub-category nets as printed, nothing counted twice
 for(const key of ['mixed-exclusive','mixed-inclusive']){
  const R=reports(docs[key])
  assert.deepEqual(R.subs,{[names[OIL]]:200,[names[GLOVES]]:180,[names[DET]]:120},key+' report subs')
  assert.deepEqual(R.aSubs,{[names[OIL]]:200,[names[GLOVES]]:180,[names[DET]]:120},key+' analysis subs')
  assert.equal(R.netTotal,500);assert.equal(R.vatTotal,48)
  assert.ok(rowsHave(R.rows,names[GLOVES],180)&&rowsHave(R.rows,names[DET],120),key+' sheet rows '+JSON.stringify(R.rows).slice(0,400))
  const sheet=XLSX(R.model);assert.ok(sheet.includes('>180<')||sheet.includes('<v>180</v>'),key+' xlsx 180')
  pdfModels[key]=R.model
 }
 pass('report, analysis, export rows and Excel: oil 200, gloves 180, detergent 120; net 500 and VAT 48 counted once (exclusive and inclusive)')
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
    for(const [label,amount] of [[names[GLOVES],'180.00'],[names[DET],'120.00'],[names[OIL],'200.00']])assert.ok(text.includes(label)&&text.includes(amount),key+' pdf '+label+' '+text.slice(0,300))
   }}finally{await browser.close()}
  pass('PDF pages (real browser, same model): gloves 180.00, detergent 120.00, oil 200.00')}

 // ── 11. Rollback after an approval made with the fix: stored rows untouched; new approvals proportional again; re-apply identical
 const snap=async()=>(await f.db.query("select md5(string_agg(t::text,'|' order by t::text)) h from (select to_jsonb(l)-'created_at' t from ledger_entries l where project_id=$1 union all select to_jsonb(i)-'created_at' from document_items i where project_id=$1 union all select to_jsonb(d)-'created_at'-'decided_at' from approval_private.document_invoices d where project_id=$1) x",[f.p1])).rows[0].h
 const h1=await snap()
 await f.db.exec(await readFile('supabase/rollback/invoice-line-vat.sql','utf8'))
 assert.equal(await snap(),h1,'rollback changed stored data');assert.equal((await f.db.query("select count(*)::int n from pg_proc where proname='item_vats'")).rows[0].n,0)
 const ex2=(await f.db.query('select vat_amount::float8 v from document_items where document_id=$1 order by sort_order',[ex.id])).rows.map(r=>r.v);assert.deepEqual(ex2,[30,0,18])
 const after=await approve('after-rollback',base());assert.deepEqual(vats(after),vats(before))
 await f.db.exec(await readFile('supabase/migrations/20261031130000_invoice_line_vat.sql','utf8'))
 const again=await approve('reapplied',base());assert.deepEqual(vats(again),[30,0,18])
 pass('rollback after a fixed approval: stored rows byte-identical, fixed invoice still exact, new approval proportional; re-apply exact again')
 console.log('RESULT '+JSON.stringify({checks}))
}finally{await f.db.close()}
