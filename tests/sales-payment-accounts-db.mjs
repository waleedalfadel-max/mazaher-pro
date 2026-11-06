import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {readFile} from 'node:fs/promises'
// Fixture must be an isolated synthetic database at the production schema baseline.
if (!process.env.SALES_ACCOUNT_TEST_FIXTURE) throw new Error('An isolated synthetic fixture is required')
const {fixture}=await import(pathToFileURL(process.env.SALES_ACCOUNT_TEST_FIXTURE))
const f=await fixture()
await f.db.exec(await readFile('supabase/migrations/20261106142136_sales_payment_name_accounts.sql','utf8'))
try {
 const main=randomUUID(),restricted=randomUUID(),foreign=randomUUID()
 await f.db.query("insert into bank_accounts(id,project_id,name,branches,is_active) values($1,$4,'Main','{}',true),($2,$4,'Liabilities','{}',true),($3,$5,'Other business','{}',true)",[main,restricted,foreign,f.p1,f.p2])
 const setting={branches:['North','South'],bank_workflow:{version:1,payment_name_accounts:[{label:'مدى 036',aliases:['مدى 036','mada 036'],channel:'network',account_id:restricted}]}}
 setting.pos_payment_accounts=setting.bank_workflow.payment_name_accounts;delete setting.bank_workflow.payment_name_accounts
 await f.db.query('update project_settings set settings=$2 where project_id=$1',[f.p1,JSON.stringify(setting)])
 const inv={type:'sales',date:'2026-01-20',cashSales:112.5,networkSales:1993.5,hungerSales:431,jahez:436,totalSales:2973,reportNetTotal:2973,
  paymentLines:[{label:'مدى (036)',amount:224}],bankAccounts:{network:main},salesBankRoutes:[{channel:'network',label:'مدى 036',amount:'224.00',accountId:restricted}]}
 async function prepare(raw,branch='North') {
  raw={...raw};delete raw._id;
  const id=randomUUID();await f.db.query("insert into documents(id,project_id,file_name,status,analysis_result,branch)values($1,$2,'Synthetic POS','analyzed',$3,$4)",[id,f.p1,JSON.stringify({invoices:[raw]}),branch])
  const p=await f.rpc(f.acc,'approval_prepare',[id]);assert.equal(p.ok,true,JSON.stringify(p));return {id,version:p.version,invoice:p.analysis_result.invoices[0]}
 }
 const approve=(d,i,req=randomUUID())=>f.rpc(f.acc,'approval_approve',[d.id,req,d.version,JSON.stringify([i]),'{}','{}'])
 const correct=(d,i,revision,req=randomUUID())=>f.rpc(f.acc,'approval_correct_sales_report',[d.id,req,d.version,JSON.stringify(i),'Verified synthetic closing',revision,'{}'])
 const amountRows=async id=>(await f.db.query("select bank_account_id,bank_in,output_vat_amount from ledger_entries where document_id=$1 and type='🏦 مبيعات شبكة' order by bank_in",[id])).rows
 const original=await prepare(inv)
 let result=await approve(original,{...original.invoice,salesBankRoutes:[{...inv.salesBankRoutes[0],accountId:foreign}]});assert.equal(result.code,'bank_account_invalid')
 result=await approve(original,{...original.invoice,salesBankRoutes:[{...inv.salesBankRoutes[0],amount:'2999'}]});assert.equal(result.code,'sales_bank_routes_invalid')
 const missing={...original.invoice};delete missing.salesBankRoutes;result=await approve(original,missing);assert.equal(result.code,'sales_bank_routes_required')
 assert.equal(Number((await f.one('select count(*) n from ledger_entries where document_id=$1',[original.id])).n),0)
 const req=randomUUID();result=await approve(original,original.invoice,req);assert.equal(result.ok,true,JSON.stringify(result));assert.equal((await approve(original,original.invoice,req)).replayed,true)
 let rows=await amountRows(original.id);assert.deepEqual(rows.map(r=>Number(r.bank_in)),[224,1769.5]);assert.equal(rows[0].bank_account_id,restricted);assert.equal(rows[1].bank_account_id,main)
 // Same rules on a different branch, with explicit printed tax preserved exactly.
 const south=await prepare({...inv,reportedSalesVat:387.78},'South');result=await approve(south,south.invoice);assert.equal(result.ok,true,JSON.stringify(result))
 assert.equal(Number((await f.one('select sum(output_vat_amount) vat from ledger_entries where document_id=$1',[south.id])).vat),387.78)
 const correction=await prepare({...inv,totalSales:2949,reportNetTotal:2949,networkSales:1969.5,salesBankRoutes:[{...inv.salesBankRoutes[0],amount:'200.00'}]})
 const correctionReq=randomUUID();result=await correct(correction,correction.invoice,0,correctionReq);assert.equal(result.ok,true,JSON.stringify(result));assert.equal((await correct(correction,correction.invoice,0,correctionReq)).replayed,true)
 rows=await amountRows(correction.id);assert.equal(rows.length,1);assert.equal(Number(rows[0].bank_in),-24);assert.equal(rows[0].bank_account_id,restricted)
 // Account-only correction keeps sales constant and moves the exact previous amount once.
 const reassign=await prepare({...correction.invoice,salesBankRoutes:[{...inv.salesBankRoutes[0],amount:'200.00',accountId:main}]})
 result=await correct(reassign,reassign.invoice,1);assert.equal(result.ok,true,JSON.stringify(result));rows=await amountRows(reassign.id);assert.deepEqual(rows.map(r=>Number(r.bank_in)),[-200,200])
 assert.equal(Number((await f.one('select network_sales from sales where project_id=$1 and branch=$2',[f.p1,'North'])).network_sales),1969.5)
 const other=await prepare({...inv,date:'2026-01-22'});assert.equal((await f.rpc(f.other,'approval_approve',[other.id,randomUUID(),other.version,JSON.stringify([other.invoice]),'{}','{}'])).ok,false)
 console.log('PASS atomic split, precise account totals, independent branches, refunds, correction, account-only correction, VAT, retry and cross-tenant rejection')
} finally {await f.db.close()}
