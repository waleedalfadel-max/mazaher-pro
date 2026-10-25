import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupCreditInvoices } from '../src/lib/creditInvoicePresentation.js'
const base = { project_id:'p',document_id:'d',document_invoice_id:'invoice',journal_number:'J-1',date:'2026-01-20',status:'approved',supplier_id:'supplier',description:'Synthetic supplier',_bankBal:500 }
const rows = [{...base,id:'a',type:'COGS',category_main:'Food',total_amount:115,vat_amount:15,payable_in:115},{...base,id:'b',type:'Expense',category_main:'Cleaning',total_amount:230,vat_amount:30,payable_in:230}]
test('one invoice presents one summary with exact total and original category rows',()=>{const before=JSON.stringify(rows),out=groupCreditInvoices(rows);assert.equal(out.length,1);assert.equal(out[0].total_amount,345);assert.equal(out[0].vat_amount,45);assert.equal(out[0].payable_in,345);assert.equal(out[0]._bankBal,500);assert.deepEqual(out[0]._creditRows,rows);assert.equal(JSON.stringify(rows),before)})
test('same supplier, amount or journal never merges different invoice identities',()=>{assert.equal(groupCreditInvoices([rows[0],{...rows[0],id:'c',document_invoice_id:'other'}]).length,2);assert.equal(groupCreditInvoices([rows[0],{...rows[0],id:'c',project_id:'other'}]).length,2)})
test('filters explicitly mark a partial invoice without pretending it is its whole total',()=>{const out=groupCreditInvoices([rows[0]],rows);assert.equal(out[0]._creditPartial,true);assert.equal(out[0].total_amount,115);assert.match(out[0].type,/جزء/)})
test('cash, split supplier payments, manual rows and mixed statuses retain separate identities',()=>{for(const extra of [{payable_in:0,bank_out:115},{payable_in:0,payable_out:115,bank_out:115},{document_invoice_id:null},{status:'pending'}])assert.equal(groupCreditInvoices([rows[0],{...rows[0],id:'c',...extra}]).length,2)})
test('presentation never conceals repeated stored money by deduplicating equal rows',()=>{const out=groupCreditInvoices([rows[0],{...rows[0],id:'c'}]);assert.equal(out[0].total_amount,230);assert.equal(out[0]._creditRows.length,2)})

test('unapproved or cancelled credit rows are not described as posted supplier debt',()=>{for(const status of ['pending','rejected','cancelled',undefined]){const row={...rows[0],status};assert.equal(groupCreditInvoices([row])[0]._creditRows,undefined)}})
