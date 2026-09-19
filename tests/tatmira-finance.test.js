import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createFinanceHandler } from '../tatmira-accounts/server/finance-handler.js';
import { emptyLedger, executeCommand, projectLedger, canCommand } from '../tatmira-accounts/server/finance-model.js';
const owner = { id: 'owner', name: 'Owner', role: 'owner', active: true, grants: [] };
const sales = { id: 'sales', name: 'Sales', role: 'sales', active: true, grants: ['upload_sale','upload_payment'] };
const purchasing = { id: 'purchasing', name: 'Purchasing', role: 'purchasing', active: true, grants: ['upload_expense'] };
const accountant = { id: 'accountant', name: 'Accountant', role: 'accountant', active: true, grants: ['review','view_reports'] };
const manager = { id: 'manager', name: 'Manager', role: 'manager', active: true, grants: ['view_reports'] };
const attachment = { id: 'org/file.pdf', name: 'test.pdf', type: 'application/pdf', size: 20 };
test('finance migration stays private, least-privileged and versioned with the deployed schema', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260918150034_tatmira_shared_finance.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table tatmira_private\.ledgers/i);
  assert.match(sql, /create table tatmira_private\.finance_requests/i);
  assert.match(sql, /enable row level security/gi);
  assert.match(sql, /values \('tatmira-documents', 'tatmira-documents', false,/i);
  assert.match(sql, /language plpgsql security invoker set search_path = ''/i);
  assert.match(sql, /revoke all on function public\.tatmira_finance[\s\S]+from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.tatmira_finance[\s\S]+to service_role/i);
  assert.doesNotMatch(sql, /security definer/i);
});
function apply(state, actor, command, id = randomUUID()) {
  const r = executeCommand(state, actor, command, { requestId: id, file: attachment, now: '2026-09-19T10:00:00Z' });
  assert.equal(r.error, undefined, `${r.code}: ${r.error}`); return r.state;
}
test('finance role matrix denies escalation and unknown/prototype commands', () => {
  for (const actor of [sales,purchasing,accountant,manager]) {
    for (const type of ['TAX_SETTING_SAVE','ACCOUNT_SAVE','LAB_UPDATE','EMPLOYEE_SAVE','constructor','toString']) assert.equal(canCommand(actor,{type}),false);
  }
  assert.equal(canCommand(sales,{type:'DOC_ADD',kind:'purchase'}),false);
  assert.equal(canCommand(purchasing,{type:'DOC_ADD',kind:'sale'}),false);
  assert.equal(canCommand(sales,{type:'DOC_APPROVE'}),false);
  assert.equal(canCommand({...owner,active:false},{type:'ACCOUNT_SAVE'}),false);
});
test('complete sale, collection and expense cycle keeps actor identity and accurate balances', () => {
  let s = emptyLedger('Test');
  assert.deepEqual(s.customers,[]); assert.equal(projectLedger(s,owner).dashboard.due,0);
  s = apply(s,owner,{type:'CUSTOMER_ADD',name:'Test customer',whatsapp:''},'customer');
  s = apply(s,sales,{type:'DOC_ADD',kind:'sale',customerId:'customer',actorId:'forged',fields:{amount:999}},'sale');
  assert.equal(s.documents[0].uploadedBy,'sales'); assert.deepEqual(s.documents[0].fields.lines,[]);
  assert.equal(projectLedger(s,manager).dashboard.salesNet,0);
  s = apply(s,accountant,{type:'DOC_UPDATE_FIELDS',id:'sale',fields:{customerId:'customer',date:'2026-09-19',number:'S1',lines:[{desc:'Goods',qty:2,price:5000}]}});
  s = apply(s,accountant,{type:'DOC_APPROVE',id:'sale'});
  assert.equal(s.documents[0].reviewedBy,'accountant');
  s = apply(s,sales,{type:'DOC_ADD',kind:'payment',customerId:'customer'},'payment');
  s = apply(s,accountant,{type:'DOC_UPDATE_FIELDS',id:'payment',fields:{customerId:'customer',date:'2026-09-19',amount:6000,accountId:'acc-bank',allocations:[{target:'inv-sale',amount:6000}]}});
  s = apply(s,accountant,{type:'DOC_APPROVE',id:'payment'});
  s = apply(s,purchasing,{type:'DOC_ADD',kind:'purchase'},'expense');
  s = apply(s,accountant,{type:'DOC_UPDATE_FIELDS',id:'expense',fields:{date:'2026-09-19',payee:'Vendor',accountId:'acc-bank',lines:[{desc:'Supplies',categoryId:s.categories[0].id,net:2000,vat:0}]}});
  s = apply(s,accountant,{type:'DOC_APPROVE',id:'expense'});
  const report = projectLedger(s,manager).dashboard;
  assert.equal(report.salesNet,10000); assert.equal(report.collected,6000); assert.equal(report.due,4000); assert.equal(report.estimatedProfit,8000);
  assert.equal(report.accounts.find(a=>a.id==='acc-bank').balance,4000);
  assert.equal(executeCommand(s,accountant,{type:'DOC_APPROVE',id:'sale'},{requestId:randomUUID()}).code,'NOT_PENDING');
  const view = projectLedger(s,sales);
  assert.equal(view.documents.length,2); assert.equal(view.dashboard,undefined); assert.equal(view.documents[0].file.id,undefined);
  assert.equal(projectLedger(s,purchasing).customers.length,0);
  assert.equal(projectLedger(s,manager).documents.length,3);
});
test('malformed financial inputs cannot alter ledger and rejection has no financial effect',()=>{
  let s=emptyLedger('Test');
  s=apply(s,purchasing,{type:'DOC_ADD',kind:'purchase'},'expense');
  for(const fields of [{date:'2026-99-99'},{lines:[{desc:'x',categoryId:'x',net:-1,vat:0}]},{lines:[{desc:'x',categoryId:'x',net:Number.MAX_SAFE_INTEGER,vat:0}]}]) {
    const r=executeCommand(s,accountant,{type:'DOC_UPDATE_FIELDS',id:'expense',fields},{requestId:randomUUID()});assert.ok(r.error);assert.equal(r.state,s);
  }
  s=apply(s,accountant,{type:'DOC_REJECT',id:'expense'});
  assert.equal(projectLedger(s,owner).dashboard.estimatedProfit,0);
  assert.equal(projectLedger(s,manager).documents.length,0);
});
function fixture(actor=owner) {
  const calls=[],files=new Map(),receipts=new Map();let state=emptyLedger('Test'),revision=0,revoked=false,failCommit=false;
  const admin={auth:{getUser:async token=>({data:{user:token==='owner-token'?{id:'owner'}:null}})},rpc:async(name,args)=>{
    calls.push(args);if(revoked) return {data:{error:'INVALID_SESSION'}};
    if(args.p_slug!=='tatmira') return {data:{error:'TENANT_UNAVAILABLE'}};
    const p=args.p_payload;
    if(args.p_operation==='snapshot') return {data:{actor,organization:{id:'org',name:'Test'},state,revision}};
    const receipt=receipts.get(p.requestId);
    if(receipt) return {data:receipt.fingerprint!==p.fingerprint?{error:'REQUEST_ID_REUSED'}:args.p_operation==='receipt'?{result:receipt.result}:{...receipt.result,duplicate:true}};
    if(args.p_operation==='receipt') return {data:{result:null}};
    if(failCommit)return {data:{error:'CONFLICT'}};
    state=p.state;revision++;const result={ok:true,revision,documentId:p.documentId};receipts.set(p.requestId,{fingerprint:p.fingerprint,result});return {data:result};
  },storage:{from:()=>({upload:async(path,bytes)=>{files.set(path,bytes);return {};},remove:async paths=>{paths.forEach(p=>files.delete(p));return {};},download:async path=>({data:files.has(path)?new Blob([files.get(path)]):null})})}};
  const handle=createFinanceHandler({admin,allowedOrigins:['https://tatmira-preview.vercel.app']});
  const send=(body,{token='owner-token',file,origin='https://tatmira-preview.vercel.app'}={})=>{
    const headers={origin,...(token?{authorization:`Bearer ${token}`}:{})};let data;
    if(file){data=new FormData();data.set('request',JSON.stringify({tenant:'tatmira',...body}));data.set('file',file,'test.pdf');}
    else{headers['content-type']='application/json';data=JSON.stringify({tenant:'tatmira',...body});}
    return handle(new Request('https://example.test',{method:'POST',headers,body:data}));
  };
  return {send,calls,files,revision:()=>revision,revoke:()=>{revoked=true;},failCommit:()=>{failCommit=true;}};
}
test('HTTP authentication, tenant scope and server grant enforcement',async()=>{
  const f=fixture(sales);
  assert.equal((await f.send({operation:'read'},{token:null})).status,401);
  assert.equal((await f.send({operation:'read'},{token:'forged'})).status,401);
  assert.equal((await f.send({operation:'read'},{origin:'https://evil.test'})).status,403);
  const token=`tm_${'a'.repeat(64)}`;
  assert.equal((await f.send({operation:'read',tenant:'other'},{token})).status,403);
  assert.equal((await f.send({operation:'mutate',revision:0,requestId:randomUUID(),command:{type:'DOC_APPROVE',actorId:'owner'}},{token})).status,403);
  f.revoke();assert.equal((await f.send({operation:'read'},{token})).status,401);
});
test('HTTP duplicate retry is idempotent and stale revision cannot overwrite',async()=>{
  const f=fixture(),body={operation:'mutate',revision:0,requestId:randomUUID(),command:{type:'CUSTOMER_ADD',name:'Customer',whatsapp:''}};
  assert.equal((await f.send(body)).status,200);assert.equal(f.revision(),1);
  const retry=await f.send(body);assert.equal((await retry.json()).duplicate,true);assert.equal(f.revision(),1);
  assert.equal((await f.send({...body,command:{...body.command,name:'Changed'}})).status,409);
  assert.equal((await f.send({...body,requestId:randomUUID()})).status,409);
});
test('HTTP stores a validated attachment, filters its path, and cleans a rejected commit',async()=>{
  const body={operation:'mutate',revision:0,requestId:randomUUID(),command:{type:'DOC_ADD',kind:'purchase'}};
  const f=fixture(),file=new Blob(['%PDF-1.4\nTest fixture']);
  assert.equal((await f.send(body,{file:new Blob(['<script>'])})).status,400);
  assert.equal((await f.send(body,{file})).status,200);assert.equal(f.files.size,1);
  const view=await (await f.send({operation:'read'})).json();assert.equal(view.data.documents[0].file.id,undefined);
  const download=await f.send({operation:'file',documentId:body.requestId});assert.equal(download.status,200);assert.equal(await download.text(),'%PDF-1.4\nTest fixture');
  f.revoke();assert.equal((await f.send({operation:'file',documentId:body.requestId})).status,401);
  const conflict=fixture();conflict.failCommit();assert.equal((await conflict.send(body,{file})).status,409);assert.equal(conflict.files.size,0);
});
