// Requires an isolated synthetic PostgreSQL fixture, never a hosted database.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { expenseVatRounding } from '../src/lib/expenseVatRounding.js'
if (!process.env.VAT_TEST_FIXTURE) throw Error('Set VAT_TEST_FIXTURE to an isolated synthetic fixture')
const { fixture } = await import(pathToFileURL(process.env.VAT_TEST_FIXTURE)), f = await fixture()
const migration = process.env.VAT_MIGRATION || 'supabase/migrations/20261107104425_invoice_vat_rounding.sql'
const category = randomUUID()
const base = () => ({ type: 'expense', amountsBasis: 'inclusive', totalAmount: 82, vatAmount: 10.7,
  description: 'Synthetic supplier', invoiceNumber: randomUUID(), paySource: 'cash', date: '2026-01-03', transType: '🛒 مصروفات تشغيلية',
  items: [{ description: 'Synthetic A', category_id: category, amount: 52, lineNet: 45.22, lineVat: 6.78, printedLineTotal: 52 },
    { description: 'Synthetic B', category_id: category, amount: 30, lineNet: 26.09, lineVat: 3.91, printedLineTotal: 30 }] })
async function prep(invoices) {
  const id = randomUUID()
  await f.db.query("insert into documents(id,project_id,file_name,status,analysis_result) values($1,$2,'Synthetic invoices','analyzed',$3)", [id, f.p1, JSON.stringify({ invoices })])
  const p = await f.rpc(f.acc, 'approval_prepare', [id]); assert.equal(p.ok, true, JSON.stringify(p))
  return { id, p, invoices: p.analysis_result.invoices }
}
const approve = (d, request = randomUUID(), user = f.acc) => f.rpc(user, 'approval_approve', [d.id, request, d.p.version, JSON.stringify(d.invoices), '{}', '{}'])
const count = async d => Number((await f.one('select count(*) n from ledger_entries where document_id=$1', [d.id])).n)
try {
  await f.db.query("insert into categories(id,project_id,name,type,ledger_type,financial_class) values($1,$2,'Synthetic expense','expense','🛒 مصروفات تشغيلية','opex')", [category, f.p1])
  const first = base(); first.vatAmount = 10.69
  const third = base(); third.items[1].lineNet = 26.10 // existing unknown-line remainder path
  const d = await prep([first, base(), third]), before = structuredClone(d.invoices)
  let result = await approve(d)
  assert.equal(result.code, 'line_vat_conflict'); assert.equal(result.reason, 'sum_mismatch'); assert.equal(await count(d), 0)
  console.log('PASS reproduced one-halalah rejection blocking entire batch with no writes')
  await f.db.exec(await readFile(migration, 'utf8'))
  const request = randomUUID(); result = await approve(d, request)
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal((await approve(d, request)).replayed, true)
  assert.equal(await count(d), 3)
  const records = (await f.db.query('select id,original_reading,approved_payload,review_changes from approval_private.document_invoices where document_id=$1', [d.id])).rows
  const audited = d.invoices.map(inv => records.find(r => r.id === inv._id))
  assert.deepEqual(audited[1].original_reading.items, before[1].items)
  assert.deepEqual(audited[1].approved_payload.items, before[1].items)
  assert.deepEqual(audited[1].approved_payload.vatRoundingAllocation.vats, [6.79, 3.91])
  assert.equal(audited[1].approved_payload.vatRoundingAllocation.difference, .01)
  assert.ok(audited[1].review_changes.some(x => x.includes('توزيع فرق تقريب')))
  assert.equal(audited[0].approved_payload.vatRoundingAllocation, undefined)
  assert.equal(audited[2].approved_payload.vatRoundingAllocation, undefined)
  const totals = await f.one('select sum(total_amount)::float8 gross,sum(vat_amount)::float8 vat,sum(cash_out)::float8 paid from ledger_entries where document_id=$1', [d.id])
  assert.deepEqual(totals, { gross: 246, vat: 32.09, paid: 246 })
  const rows = (await f.db.query('select amount::float8 amount,vat_amount::float8 vat from document_items where document_invoice_id=$1 order by sort_order', [d.invoices[1]._id])).rows
  assert.deepEqual(rows, [{ amount: 52, vat: 6.79 }, { amount: 30, vat: 3.91 }])
  console.log('PASS full batch, exact ledger/report amounts, unchanged source, server audit, idempotent retry')

  for (const change of [
    x => { x.vatAmount = 10.71 },
    x => { x.vatAmount = 10.68 },
    x => { x.totalAmount = 82.01 },
    x => { x.items[0].vatCorrection = { value: 6.78 } },
  ]) {
    const inv = base(); change(inv); const blocked = await prep([inv]); result = await approve(blocked)
    assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(await count(blocked), 0)
  }
  const duplicate = await prep([base()]); duplicate.invoices[0].invoiceNumber = d.invoices[1].invoiceNumber
  assert.equal((await approve(duplicate)).code, 'duplicate_invoice'); assert.equal(await count(duplicate), 0)
  const cross = await prep([base()]); assert.equal((await approve(cross, randomUUID(), f.other)).ok, false); assert.equal(await count(cross), 0)
  const fake = base(); fake.vatAmount = 10.69; fake.vatRoundingAllocation = { mode: 'forged' }
  const clean = await prep([fake]); assert.equal((await approve(clean)).ok, true)
  assert.equal((await f.one('select approved_payload from approval_private.document_invoices where document_id=$1', [clean.id])).approved_payload.vatRoundingAllocation, undefined)
  console.log('PASS genuine mismatches, corrections, duplicates, cross-tenant access and forged audit rejected')

  // Numeric parity on both bases, including half-up boundaries, explicit zero, upward/downward and many-line rounding.
  let comparisons = 0
  for (const basis of ['inclusive', 'exclusive']) for (let a = 1; a <= 25; a++) for (const b of [5, 10, 52, 99]) {
    const amounts = [a, b], den = basis === 'inclusive' ? 115 : 100
    const lines = amounts.map(h => { const vat = Math.floor((h * 15 + den / 2) / den); return { amount: h / 100, lineVat: vat / 100,
      lineNet: (basis === 'inclusive' ? h - vat : h) / 100, printedLineTotal: (basis === 'inclusive' ? h : h + vat) / 100 } })
    const tax = Math.floor(((a + b) * 15 + den / 2) / den)
    const inv = { type: 'expense', amountsBasis: basis, totalAmount: (a + b + (basis === 'exclusive' ? tax : 0)) / 100, vatAmount: tax / 100, items: lines }
    const client = expenseVatRounding(inv)
    const server = (await f.one('select approval_private.item_vat_rounding($1,$2,$3,$4,0) result', [JSON.stringify(lines), amounts.map(h => h / 100), tax / 100, basis])).result
    assert.equal(!!server, !!client, JSON.stringify(inv))
    if (client) assert.deepEqual(server.vats.map(v => Math.round(v * 100)), client.vats)
    comparisons++
  }
  assert.equal((await f.one("select has_function_privilege('authenticated','approval_private.item_vat_rounding(jsonb,numeric[],numeric,text,numeric)','execute') allowed")).allowed, false)
  console.log('PASS '+comparisons+' browser/server rounding comparisons; private function has no public execution grant')
} finally { await f.db.close() }
