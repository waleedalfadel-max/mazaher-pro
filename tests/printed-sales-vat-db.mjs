// Synthetic isolated PostgreSQL fixture only. No production credentials or tenant data.
// REREAD_TEST_FIXTURE exports fixture() with db/one/rpc/claims/p1/p2/acc/owner/other.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
import {summarizeEntries} from '../src/lib/financeSummary.js'
if(!process.env.REREAD_TEST_FIXTURE)throw Error('An isolated synthetic fixture is required')
const keepAlive=setInterval(()=>{},1000)
let f,checks=0
const pass=s=>{checks++;console.log('PASS '+s)}
try{
 f=await (await import(pathToFileURL(process.env.REREAD_TEST_FIXTURE))).fixture()
 // Schema snapshots may omit identity defaults; restore this fixture-only identity.
 await f.db.exec("alter table approval_private.sales_report_revisions alter column id set default nextval('approval_private.sales_report_revisions_id_seq')")
 await f.db.exec(await readFile('supabase/migrations/20261102164821_printed_sales_vat.sql','utf8'))
 // Reversible before use, preserving legacy rows; reapply and check grants.
 await f.db.exec(await readFile('supabase/rollback/printed-sales-vat.sql','utf8'))
 await f.db.exec(await readFile('supabase/migrations/20261102164821_printed_sales_vat.sql','utf8'))
 const priv=await f.one("select has_function_privilege('authenticated','approval_private.sales_tax_channels(jsonb,numeric)','execute') a,has_function_privilege('anon','approval_private.reported_sales_vat(jsonb,numeric)','execute') b")
 assert.deepEqual(priv,{a:false,b:false});pass('migration/rollback/reapply; helpers not executable by API roles')
 const bank=randomUUID();await f.db.query("insert into bank_accounts(id,project_id,name,is_active)values($1,$2,'Synthetic bank',true)",[bank,f.p1])
 let day=0
 const base=(over={})=>({type:'sales',date:`2026-01-${String(++day).padStart(2,'0')}`,cashSales:230,networkSales:1380,hungerSales:690,transferSales:0,jahez:0,keeta:0,mrsool:0,totalSales:2300,bankAccountId:bank,...over})
 async function prepare(inv){
  await f.claims(f.acc);const id=randomUUID()
  await f.db.query("insert into documents(id,project_id,file_name,status,analysis_result)values($1,$2,'Synthetic POS','analyzed',$3)",[id,f.p1,JSON.stringify({invoices:[inv]})])
  const p=await f.rpc(f.acc,'approval_prepare',[id]);assert.equal(p.ok,true,JSON.stringify(p))
  return{id,p,inv:p.analysis_result.invoices[0]}
 }
 const args=(d,req=randomUUID())=>[d.id,req,d.p.version,JSON.stringify([d.inv]),'{}','{}']
 const rows=async date=>(await f.db.query('select *,date::text date from ledger_entries where project_id=$1 and date=$2',[f.p1,date])).rows
 async function approve(inv){const d=await prepare(inv);d.a=args(d);d.res=await f.rpc(f.acc,'approval_approve',d.a);assert.equal(d.res.ok,true,JSON.stringify(d.res));return d}
 const legacy=await approve(base());let s=summarizeEntries(await rows(legacy.inv.date));assert.equal(Math.round(s.outputVat),300)
 assert.ok((await rows(legacy.inv.date)).every(x=>x.output_vat_amount==null));pass('legacy approval retains NULL and original 15% estimate')
 const printed=await approve(base({reportedSalesVat:270}));s=summarizeEntries(await rows(printed.inv.date))
 assert.equal(s.grossSales,2300);assert.equal(s.totalSales,2030);assert.equal(s.outputVat,270);assert.equal(s.inputVat,0)
 assert.deepEqual((await rows(printed.inv.date)).map(x=>Number(x.output_vat_amount)).sort((a,b)=>a-b),[27,81,162]);pass('real prepare → approve allocates printed VAT exactly, input VAT unchanged')
 assert.deepEqual(await f.rpc(f.acc,'approval_approve',printed.a),{...printed.res,replayed:true});assert.equal((await rows(printed.inv.date)).length,3);pass('idempotent retry does not duplicate approval')
 const zero=await approve(base({reportedSalesVat:0}));assert.equal(summarizeEntries(await rows(zero.inv.date)).outputVat,0);pass('explicit zero never estimates 15%')
 for(const tax of [-1,301,'x','1.234']){const d=await prepare(base({reportedSalesVat:tax}));const r=await f.rpc(f.acc,'approval_approve',args(d));assert.equal(r.code,'sales_vat_invalid',JSON.stringify(r));assert.equal((await rows(d.inv.date)).length,0)}
 pass('negative, over-limit, malformed and sub-halala VAT rejected without writing')
 const guarded=await prepare(base({reportedSalesVat:270}));assert.equal((await f.rpc(f.owner,'approval_approve',args(guarded))).code,'forbidden');assert.equal((await f.rpc(f.other,'approval_approve',args(guarded))).code,'not_found');const stale=args(guarded);stale[2]--;assert.equal((await f.rpc(f.acc,'approval_approve',stale)).code,'stale');assert.equal((await rows(guarded.inv.date)).length,0);pass('tenant/role/stale-version guards retained')
 async function correct(original,vat,revision,over={}){
  const inv={...original.inv,...over};delete inv._id
  if(vat===undefined)delete inv.reportedSalesVat;else inv.reportedSalesVat=vat
  const d=await prepare(inv);d.a=[d.id,randomUUID(),d.p.version,JSON.stringify(d.inv),'Synthetic reviewed correction',revision,'{}'];d.res=await f.rpc(f.acc,'approval_correct_sales_report',d.a);return d
 }
 let c=await correct(printed,258,0);assert.equal(c.res.ok,true,JSON.stringify(c.res));s=summarizeEntries(await rows(printed.inv.date));assert.equal(s.outputVat,258);assert.equal(s.totalSales,2042);assert.equal(s.bankBalance,1380);assert.equal(s.cashBalance,230);assert.equal(s.receivableBalance,690)
 assert.deepEqual(await f.rpc(f.acc,'approval_correct_sales_report',c.a),{...c.res,replayed:true});pass('tax-only correction has zero balance movement and is replay-safe')
 c=await correct(printed,undefined,1);assert.equal(c.res.code,'sales_vat_required');c=await correct(printed,250,0);assert.equal(c.res.code,'report_changed');pass('printed-tax corrections cannot silently omit VAT; stale revisions rejected')
 c=await correct(printed,250,1,{networkSales:1265,totalSales:2185});assert.equal(c.res.ok,true,JSON.stringify(c.res));s=summarizeEntries(await rows(printed.inv.date));assert.equal(s.bankBalance,1265);assert.equal(s.outputVat,250);assert.equal(s.totalSales,1935);pass('amount correction after tax-only correction still proves original bank routing')
 c=await correct(legacy,270,0);assert.equal(c.res.ok,true,JSON.stringify(c.res));s=summarizeEntries(await rows(legacy.inv.date));assert.equal(Math.round(s.outputVat*100),27000);assert.equal(Math.round(s.totalSales*100),203000);pass('legacy estimate → printed VAT correction reaches exact reviewed total')
 const split=await approve(base({cashSales:1.01,networkSales:1.01,hungerSales:1.01,totalSales:3.03,reportedSalesVat:.38}));assert.equal((await f.one('select sum(output_vat_amount)::text t from ledger_entries where document_id=$1',[split.id])).t,'0.38');pass('largest remainder allocation preserves halalas')
 await assert.rejects(f.db.exec(await readFile('supabase/rollback/printed-sales-vat.sql','utf8')),/reported_sales_vat_in_use/);await f.db.exec('rollback');pass('unsafe rollback refused after recorded VAT exists')
 console.log('RESULT '+JSON.stringify({checks}))
}catch(e){console.error(e.message,e.where||'');process.exitCode=1}finally{if(f)await f.db.close();clearInterval(keepAlive)}
