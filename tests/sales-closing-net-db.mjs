// Run only against the isolated synthetic fixture used by the approval integration suites.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const { fixture } = await import(pathToFileURL(process.env.REREAD_TEST_FIXTURE))
const f = await fixture()
const migration = await readFile('supabase/migrations/20261105150000_sales_closing_net.sql', 'utf8')
const rollback = await readFile('supabase/rollback/sales-closing-net.sql', 'utf8')
try {
  await f.db.exec(await readFile('supabase/migrations/20261102164821_printed_sales_vat.sql','utf8'))
  await f.db.exec("alter table approval_private.sales_report_revisions alter column id set default nextval('approval_private.sales_report_revisions_id_seq')")
  await f.db.exec(migration)
  await f.db.exec(rollback)
  await f.db.exec(migration)
  assert.equal((await f.one("select settings #>> '{pos_payment_aliases,triple hunger}' as alias from project_settings where project_id=$1",[f.p1])).alias,'hunger')
  assert.equal((await f.one("select settings ? 'pos_payment_aliases' as found from project_settings where project_id=$1",[f.p2])).found,false)
  const bank=randomUUID()
  await f.db.query("insert into bank_accounts(id,project_id,name,is_active) values($1,$2,'Synthetic account',true)",[bank,f.p1])
  const inv={type:'sales',date:'2026-01-20',cashSales:20,networkSales:90,reportNetTotal:110,totalSales:110,bankAccountId:bank}
  async function prepare(raw) {
    const id=randomUUID()
    await f.db.query("insert into documents(id,project_id,file_name,status,analysis_result)values($1,$2,'Synthetic POS','analyzed',$3)",[id,f.p1,JSON.stringify({invoices:[raw]})])
    const p=await f.rpc(f.acc,'approval_prepare',[id])
    assert.equal(p.ok,true)
    return {id,version:p.version,invoice:p.analysis_result.invoices[0]}
  }
  const approve=(d,i)=>f.rpc(f.acc,'approval_approve',[d.id,randomUUID(),d.version,JSON.stringify([i]),'{}','{}'])
  const correct=(d,i,req)=>f.rpc(f.acc,'approval_correct_sales_report',[d.id,req,d.version,JSON.stringify(i),'Verified synthetic closing',0,'{}'])
  const count=async d=>Number((await f.one('select count(*) n from ledger_entries where document_id=$1',[d.id])).n)
  const original=await prepare(inv)
  const inflated={...original.invoice,totalSales:115,networkSales:95}
  // Simulate an old or malformed client removing or rewriting the OCR total in its payload.
  await assert.rejects(approve(original,{...inflated,reportNetTotal:115}),{code:'P0521'})
  await assert.rejects(approve(original,{...inflated,printedNetReview:{value:'114.00',reason:'Stale'}}),{code:'P0521'})
  await assert.rejects(approve(original,{...original.invoice,manualReview:{mode:'confirmed_channels'}}),{code:'P0521'})
  assert.equal(await count(original),0)
  assert.equal((await approve(original,original.invoice)).ok,true)
  const d=await prepare({...inv,networkSales:84,reportNetTotal:104,totalSales:104})
  const wrong={...d.invoice,networkSales:87,totalSales:107}
  await assert.rejects(correct(d,wrong,randomUUID()),{code:'P0521'})
  assert.equal(await count(d),0)
  assert.equal((await f.one('select revision from approval_private.sales_reports where document_id=$1',[original.id])).revision,0)
  const req=randomUUID()
  const good=await correct(d,d.invoice,req)
  assert.equal(good.ok,true,JSON.stringify(good))
  assert.equal((await correct(d,d.invoice,req)).replayed,true)
  assert.equal(await count(d),1)
  const movement=await f.one('select bank_in-bank_out as delta,bank_account_id from ledger_entries where document_id=$1',[d.id])
  assert.equal(Number(movement.delta),-6); assert.equal(movement.bank_account_id,bank)
  const disputed=await prepare({...inv,date:'2026-01-21',salesAlignmentUnclear:true})
  await assert.rejects(approve(disputed,disputed.invoice),{code:'P0521'})
  const reviewed={...disputed.invoice,networkSales:91,totalSales:111,printedNetReview:{value:'111.00',reason:'Read the original'},manualReview:{mode:'confirmed_channels'}}
  assert.equal((await approve(disputed,reviewed)).ok,true)
  console.log('PASS migration/rollback, scoped alias, stored-source checks, ordinary and manual approval, atomic correction, net bank delta and retry')
} finally { await f.db.close() }
