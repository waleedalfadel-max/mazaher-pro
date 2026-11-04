import test from 'node:test'
import assert from 'node:assert/strict'
import { usesCompactHome, usesMazaherHome, usesSimplifiedHome, groupsCreditInvoices } from '../src/lib/businessPresentation.js'

test('the Waha demo combines the VAT overview, financial record and grouped credit invoices while retaining loans', () => {
  const presentation = name => [usesMazaherHome(name), usesSimplifiedHome(name), groupsCreditInvoices(name), usesCompactHome(name)]
  assert.deepEqual(presentation('الواحة'), [true, true, true, false])
  assert.deepEqual(presentation('مزاهر'), [true, true, false, false])
  assert.deepEqual(presentation('تشورميك'), [false, true, true, true])
  assert.deepEqual(presentation('مطعم آخر'), [false, false, false, false])
})
