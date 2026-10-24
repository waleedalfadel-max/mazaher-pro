// Integration against an isolated synthetic PostgreSQL fixture. Never connect to production.
// REREAD_TEST_FIXTURE must export fixture() with db, rpc, claims, p1, acc and owner.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
import {buildInvoicePayload,exactTotals,invoiceSupplierContext,newRequestId,payableDecision,callError} from '../src/lib/approvalV2.js'
import {loanBlockReason,withoutLoanPrincipalConfirmation} from '../src/lib/loanRepayment.js'
import {isReceipt,buildReceiptPayload} from '../src/lib/supplierReceipts.js'
import {salesReportCheck} from '../src/lib/salesReport.js'
import {matchSupplier} from '../src/lib/supplierMatching.js'
import {readingReplaced,resetReplacedReview} from '../src/lib/documentReread.js'
if(!process.env.REREAD_TEST_FIXTURE)throw Error('Set REREAD_TEST_FIXTURE to an isolated synthetic fixture')
const {fixture}=await import(pathToFileURL(process.env.REREAD_TEST_FIXTURE)),f=await fixture()
const source=await readFile('src/pages/PendingDocuments.jsx','utf8')
const actual=source.slice(source.indexOf('  async function prepareV2(doc)'),source.indexOf('  function v2Done(doc, data)'))
let checks=0;const pass=s=>{checks++;console.log('PASS '+s)}
let day=0
const invoice=(amount,description='Synthetic expense')=>({type:'expense',transType:'مصروفات تشغيلية',paySource:'cash',date:new Date(Date.UTC(2026,0,++day)).toISOString().slice(0,10),description,amountsBasis:'inclusive',totalAmount:amount,vatAmount:0,items:[{description:'Synthetic item',category:'مصروفات تشغيلية',amount}]})
async function create(amount=40){const id=randomUUID();await f.claims(f.acc);await f.db.query("insert into documents(id,project_id,file_name,status,analysis_result,branch) values($1,$2,'Synthetic reread','analyzed',$3,'North')",[id,f.p1,JSON.stringify({invoices:[invoice(amount)]})]);const prep=await f.rpc(f.acc,'approval_prepare',[id]);assert.equal(prep.ok,true);return {id,prep}}
const save=(id,version,invoices,user=f.acc)=>f.rpc(user,'document_reread_save',[id,version,JSON.stringify({invoices})])
const ledger=async id=>(await f.db.query('select cash_out,total_amount from ledger_entries where document_id=$1',[id])).rows
try{
 await f.db.exec(await readFile('supabase/migrations/20261025120000_document_reread.sql','utf8'))
 await f.db.query("insert into approval_private.settings(project_id,mode) values($1,'v2')",[f.p1])
 for(const inv of [{},{type:'expense',paySource:'cash'},{description:' \t ',items:[{}]},{items:[],amount:null}]){
  const {id,prep}=await create();const before=await f.db.query('select analysis_result,version from documents where id=$1',[id]);assert.equal((await save(id,prep.version,[inv])).ok,false);assert.deepEqual(await f.db.query('select analysis_result,version from documents where id=$1',[id]),before);assert.deepEqual(await ledger(id),[])
 }pass('four empty forms rejected without mutation')
 const partial=await create();assert.equal((await save(partial.id,partial.prep.version,[{date:'2026-10-01'}])).ok,true);pass('partial date-only evidence accepted')
 for(const evidence of [{paymentLines:[{label:'Cash',amount:0}]},{reportNetTotal:0},{beneficiary:'Synthetic supplier'}]){const d=await create();assert.equal((await save(d.id,d.prep.version,[evidence])).ok,true)}pass('sales and supplier partial evidence remain reviewable')
 const owner=await create();assert.equal((await save(owner.id,owner.prep.version,[invoice(60)],f.owner)).code,'forbidden');pass('owner cannot reread')
 for(const scenario of ['other-window','lost-response']){
  const {id,prep:old}=await create();let state=[{id,project_id:f.p1,branch:'North',status:'analyzed',analysis_result:old.analysis_result,_edit:old.analysis_result,_v2:{version:old.version,invoices:old.invoices,mode:old.mode}}];const responses=[]
  const env={rereadLocks:{current:new Set()},readingReplaced,resetReplacedReview,bankAccountsReady:true,projectSettings:{},projectId:f.p1,pidRef:{current:f.p1},isSuperAdmin:false,categories:[],transTypes:['مصروفات تشغيلية'],payableSuppliers:[],buildInvoicePayload,exactTotals,invoiceSupplierContext,newRequestId,payableDecision,callError,loanBlockReason,withoutLoanPrincipalConfirmation,isReceipt,buildReceiptPayload,salesReportCheck,matchSupplier,modeOf:()=> 'v2',readableName:()=> 'Synthetic invoice',clearDraftOf:()=>{},setListNotice:()=>{},setDocs:fn=>{state=fn(state)},updateDoc:(id,patch)=>{state=state.map(d=>d.id===id?{...d,...patch}:d)},supabase:{rpc:async(name,args)=>{try{const data=await f.rpc(f.acc,name,Object.values(args).map(v=>v&&typeof v==='object'?JSON.stringify(v):v));responses.push({name,data});return {data,error:null}}catch(error){return {error}}}},v2Done:(doc,data)=>{env.lastDone=data}}
  const ui=new Function('env',`with(env){${actual};return {prepareV2,approveV2};}`)(env)
  const saved=await save(id,old.version,[invoice(60)]);assert.equal(saved.ok,true)
  // Both scenarios leave the page with exactly the old version and reading.
  if(scenario==='lost-response')state[0]._error='Save result unknown'
  await ui.approveV2(state[0]);for(let i=0;i<200&&state[0]._v2.version===old.version;i++)await new Promise(r=>setTimeout(r,5))
  assert.equal(responses.find(x=>x.name==='approval_approve').data.code,'stale')
  assert.equal(state[0]._edit.invoices[0].totalAmount,60);assert.equal(state[0]._readingReviewRequired,true)
  await ui.approveV2(state[0]);assert.deepEqual(await ledger(id),[]);assert.equal(responses.filter(x=>x.name==='approval_approve').length,1)
  state[0]._readingReviewRequired=false;await ui.approveV2(state[0]);assert.equal(env.lastDone.ok,true);const rows=await ledger(id);assert.equal(rows.length,1);assert.equal(Number(rows[0].cash_out),60)
  pass(scenario+': repeated approve produces only 60 after review')
 }
 const {id,prep:old}=await create();assert.equal((await save(id,old.version,[invoice(60)])).ok,true);const fresh=await f.rpc(f.acc,'approval_prepare',[id]);
 // Place the old invoice LAST: failure must undo even a valid write earlier in the batch.
 await assert.rejects(f.rpc(f.acc,'approval_approve',[id,randomUUID(),fresh.version,JSON.stringify([...fresh.analysis_result.invoices,...old.analysis_result.invoices]),'{}','{}']),e=>e.code==='P0023')
 assert.deepEqual(await ledger(id),[]);assert.equal((await f.rpc(f.acc,'approval_prepare',[id])).invoices.every(i=>i.status==='pending'),true);pass('retired id rejects entire batch with current version')
 const manual={...invoice(5,'Synthetic manual addition'),_id:randomUUID()};const req=randomUUID(),payload=JSON.stringify([...fresh.analysis_result.invoices,manual]);const approved=await f.rpc(f.acc,'approval_approve',[id,req,fresh.version,payload,'{}','{}']);assert.equal(approved.ok,true);assert.equal((await ledger(id)).reduce((n,r)=>n+Number(r.cash_out),0),65);pass('new manual addition accepted: total 65')
 const replay=await f.rpc(f.acc,'approval_approve',[id,req,fresh.version,payload,'{}','{}']);assert.equal(replay.replayed,true);assert.equal((await ledger(id)).length,2);pass('retry does not duplicate manual addition')
 const rollbackDoc=await create();await save(rollbackDoc.id,rollbackDoc.prep.version,[invoice(60)]);const rolledPrep=await f.rpc(f.acc,'approval_prepare',[rollbackDoc.id]);
 const before=await f.db.query('select * from approval_private.document_readings order by id');await f.db.exec(await readFile('supabase/rollback/document-reread.sql','utf8'));assert.deepEqual(await f.db.query('select * from approval_private.document_readings order by id'),before)
 await assert.rejects(f.rpc(f.acc,'approval_approve',[rollbackDoc.id,randomUUID(),rolledPrep.version,JSON.stringify(rollbackDoc.prep.analysis_result.invoices),'{}','{}']),e=>e.code==='P0023');pass('rollback keeps history and rejects retired invoices')
 await f.db.exec(await readFile('supabase/migrations/20261025120000_document_reread.sql','utf8'));assert.equal((await f.rpc(f.acc,'document_readings',[rollbackDoc.id])).ok,true);pass('reapply preserves history access')
 console.log(`${checks}/${checks} integration checks passed`)
}finally{await f.db.close()}
