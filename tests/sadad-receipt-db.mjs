// Run in an isolated in-memory PostgreSQL. PGLITE_MODULE may point to an installed PGlite entry point.
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite')
const db = await PGlite.create()
const migrations = new URL('../supabase/migrations/', import.meta.url)
const read = name => readFile(new URL(name, migrations), 'utf8')
async function installFunction(file, name) {
  const source = await read(file)
  const start = source.search(new RegExp('create (?:or replace )?function ' + name.replace('.', '\\.') + '\\(', 'i'))
  assert.ok(start >= 0, name)
  const def = source.slice(start)
  const tag = def.match(/\bas\s+(\$[\w]*\$)/i)[1]
  await db.exec(def.slice(0, def.indexOf(tag, def.indexOf(tag) + tag.length) + tag.length))
}
const setup = `
  create role anon; create role authenticated; create schema approval_private;
  create table documents(id uuid primary key, project_id uuid, file_name text, branch text, purchase_category text,
    status text default 'analyzed', version int default 1, journal_number text, approved_at timestamptz);
  create table categories(id uuid primary key, name text, is_active boolean, financial_class text, ledger_type text);
  create table ledger_entries(project_id uuid, document_invoice_id uuid, journal_number text, date date, total_amount numeric, description text);
  create table approval_private.document_invoices(id uuid primary key, project_id uuid, document_id uuid, kind text, status text,
    supplier_key text, supplier_label text, invoice_number_norm text, invoice_number_raw text, original_reading jsonb,
    invoice_date date,total numeric,journal_number text);
  create function approval_private.resolve_item_category(uuid,text,text,text,text,text) returns jsonb language sql as $$select '{}'::jsonb$$;
`
const origin = '20260928000000_approval_v2.sql'
const change = '20261121101851_sadad_receipt_duplicate_identity.sql'
const q = (s, args = []) => db.query(s, args)
const p1 = randomUUID(), doc = randomUUID()
const bank = (date, seq = '000001') => ({ kind: 'bank_receipt', bankName: 'مصرف الراجحي', date,
  reference: '12345678901234567' + date.replaceAll('-', '') + seq })
const invoice = (date, totalAmount) => ({ _id: randomUUID(), date, totalAmount, type: 'expense', transType: 'مصروف',
  description: 'مورد - فواتير نظام سداد', paySource: 'bank', invoiceNumber: '111222', vatAmount: 0 })
const fresh = invoice('2026-01-21', 125.50)
fresh.bankReceipt = bank(fresh.date)
const old = invoice('2026-01-08', 130)
const write = async (r, approved = false, norm = r.invoiceNumber, tenant = p1) => {
  await q(`insert into approval_private.document_invoices values($1,$2,$3,'expense',$4,
    'n:'||approval_private.norm_name($5),$5,$6,$7,$8,$9,$10,'J')`, [r._id,tenant,doc,approved?'approved':'pending',
    r.description,norm,r.invoiceNumber,JSON.stringify(r),r.date,r.totalAmount])
}
const plan = async r => (await q("select approval_private.plan_invoice_core(d,$2,'{}','{}',true) as p from documents d where id=$1",
  [doc,JSON.stringify(r)])).rows[0].p
const remove = r => q('delete from approval_private.document_invoices where id=$1',[r._id])
try {
  await db.exec(setup)
  for (const f of ['latin_digits','norm_invoice_number','norm_name','money','err']) await installFunction(origin,'approval_private.'+f)
  await installFunction('20261107104425_invoice_vat_rounding.sql','approval_private.plan_invoice_core')
  await installFunction('20261020120000_supplier_payment_receipts.sql','public.approval_approve')
  await q('insert into documents(id,project_id) values($1,$2)',[doc,p1])
  await write(old,true); await write(fresh)
  assert.equal((await plan(fresh)).code,'duplicate_invoice')
  await db.exec(await read(change))
  const good = await plan(fresh)
  assert.equal(good.ok,true,JSON.stringify(good)); assert.match(good.number,/^sadad:[0-9a-f]{64}$/)
  assert.equal(good.number_raw,fresh.invoiceNumber); assert.deepEqual(good.payload,fresh)
  for (const amended of [{date:old.date},{totalAmount:old.totalAmount}]) {
    assert.equal((await plan({...fresh,...amended})).code,'duplicate_invoice')
  }
  const noEvidence = {...fresh,_id:randomUUID()}; delete noEvidence.bankReceipt
  await write(noEvidence)
  assert.equal((await plan({...noEvidence,bankReceipt:fresh.bankReceipt})).code,'duplicate_invoice')
  for (const receipt of [{...fresh.bankReceipt,reference:'111222'}, {...fresh.bankReceipt,date:'2026-01-20'},
    {...fresh.bankReceipt,kind:'supplier_invoice'}]) {
    const insufficient = {...fresh,_id:randomUUID(),bankReceipt:receipt}; await write(insufficient)
    assert.equal((await plan(insufficient)).code,'duplicate_invoice')
  }
  await remove(old)
  const ordinary = {...old,description:fresh.description,paySource:'cash'}
  await write(ordinary,true)
  assert.equal((await plan(fresh)).code,'duplicate_invoice')
  await remove(ordinary)
  const prior = {...fresh,_id:randomUUID(),description:'SADAD - other label'}
  await write(prior,true) // approved before the change, under the printed biller number
  assert.equal((await plan({...fresh,description:'revised',invoiceNumber:'changed'})).code,'duplicate_invoice')
  await remove(prior); await write(prior,true,good.number)
  assert.equal((await plan(fresh)).code,'duplicate_invoice')
  await assert.rejects(write({...prior,_id:randomUUID(),description:'different'},true,good.number),{code:'23505'})
  await write({...prior,_id:randomUUID()},true,good.number,randomUUID())
  await remove(prior)
  assert.equal((await plan(fresh)).ok,true)
  const repeatAmount = {...fresh,_id:randomUUID(),bankReceipt:bank(fresh.date,'000002')}
  await write(repeatAmount,true)
  assert.equal((await plan(fresh)).ok,true)
  await remove(repeatAmount)
  // Exercise the real batch loop, without any ledger writer or hosted connection.
  await db.exec(`
    create function approval_private.actor() returns table(id uuid,project_id uuid,role text) language sql as $$select '${randomUUID()}'::uuid,'${p1}'::uuid,'accountant'::text$$;
    create function approval_private.can_approve(text,uuid) returns boolean language sql as $$select true$$;
    create function approval_private.replay(uuid,uuid,uuid,uuid,text) returns jsonb language sql as $$select null::jsonb$$;
    create function approval_private.mode_of(uuid) returns text language sql as $$select 'v2'::text$$;
    create function approval_private.plan_invoice(doc documents,inv jsonb,decisions jsonb,meta jsonb,known boolean) returns jsonb language sql
      as $$select approval_private.plan_invoice_core(doc,inv,decisions,meta,known)$$;`)
  const batch = async invoices => (await q("select approval_approve($1,$2,1,$3,'{}','{}') as r",
    [doc,randomUUID(),JSON.stringify(invoices)])).rows[0].r
  await write(prior)
  assert.equal((await batch([fresh,prior])).code,'duplicate_in_batch')
  assert.equal((await batch([fresh,noEvidence])).code,'duplicate_in_batch')
  assert.equal((await batch([noEvidence,fresh])).code,'duplicate_in_batch')
  console.log('PASS independent and repeated payments, legacy receipts, ordinary invoices, date/amount edits, saved evidence, tenant isolation, batch and unique constraint')
} finally { await db.close() }
