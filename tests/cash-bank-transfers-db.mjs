// Synthetic fixture, never use a production connection.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { CASH_DEPOSIT, CASH_WITHDRAWAL } from '../src/lib/cashBankTransfer.js'
if (!process.env.PAYMENT_TEST_FIXTURE) throw Error('An isolated fixture is required')
const {fixture}=await import(pathToFileURL(process.env.PAYMENT_TEST_FIXTURE))
const f=await fixture()
try {
  const query=(sql,args=[])=>f.db.query(sql,args)
  const one=f.one
  await f.db.exec(await readFile('supabase/migrations/20261102164821_printed_sales_vat.sql','utf8'))
  await query("update project_settings set settings=jsonb_build_object('transaction_types','[]'::jsonb) where project_id=$1",[f.p1])
  await f.db.exec(await readFile(new URL('../supabase/migrations/20261104192108_cash_bank_transfer_directions.sql',import.meta.url),'utf8'))
  const b1=randomUUID(),b2=randomUUID(),foreign=randomUUID(),stopped=randomUUID()
  await query("insert into bank_accounts(id,project_id,name,is_active) values($1,$5,'A',true),($2,$5,'B',true),($3,$6,'Elsewhere',true),($4,$5,'Closed',false)",[b1,b2,foreign,stopped,f.p1,f.p2])
  async function doc(type,amount,bank) {
    await f.claims(f.acc)
    const id=randomUUID()
    const invoice={type:'transfer',transType:type,amount,date:'2026-11-04',description:id,bankAccountId:bank}
    await query("insert into documents(id,project_id,file_name,status,analysis_result) values($1,$2,'Test receipt','analyzed',$3)",[id,f.p1,JSON.stringify({invoices:[invoice]})])
    const prepared=await f.rpc(f.acc,'approval_prepare',[id])
    assert.equal(prepared.ok,true,JSON.stringify(prepared))
    return {id,prepared,request:randomUUID()}
  }
  const approve=(d,actor=f.acc)=>f.rpc(actor,'approval_approve',[d.id,d.request,d.prepared.version,JSON.stringify(d.prepared.analysis_result.invoices),'{}','{}'])
  const rows=async d=>(await query('select * from ledger_entries where document_id=$1',[d.id])).rows
  for(const [type,amount,bank,deposit] of [[CASH_DEPOSIT,125.4,b1,true],[CASH_WITHDRAWAL,40.15,b2,false]]){
    const d=await doc(type,amount,bank)
    const deny=await approve(d,f.other)
    assert.equal(deny.ok,false)
    assert.equal((await rows(d)).length,0)
    const result=await approve(d)
    assert.equal(result.ok,true,JSON.stringify(result))
    assert.equal((await approve(d)).ok,true)
    const [row,...extra]=await rows(d)
    assert.equal(extra.length,0)
    assert.equal(row.bank_account_id,bank)
    assert.deepEqual([row.cash_out,row.bank_in,row.cash_in,row.bank_out].map(Number),deposit?[amount,amount,0,0]:[0,0,amount,amount])
  }
  for(const bank of [null,stopped,foreign]) {
    const d=await doc(CASH_WITHDRAWAL,5,bank)
    assert.equal((await approve(d)).ok,false)
    assert.equal((await rows(d)).length,0)
  }
  for(const type of [CASH_DEPOSIT,CASH_WITHDRAWAL]) {
    await assert.rejects(query("insert into ledger_entries(project_id,date,type,bank_out,total_amount,bank_account_id) values($1,'2026-11-04',$2,12,12,$3)",[f.p1,type,b1]),e=>e.code==='23514')
  }
  console.log('passed: both receipt directions, replay, tenant/closed/missing accounts and manual unbalanced transfers')
} finally {await f.db.close()}
