// رسالة توقف الاعتماد عند تعارض ضريبة الأسطر المطبوعة (20261031130000): عربية، بالسبب والأرقام، وتقول إنه لم يُسجَّل شيء
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { approvalMessage } from '../src/lib/approvalV2.js'

test('line_vat_conflict: لكل سبب رسالة بأرقامه، ولا يُسجَّل شيء', () => {
  const m = d => approvalMessage({ code: 'line_vat_conflict', ...d })
  assert.match(m({ reason: 'line_over_limit', line: 3, line_vat: 50.6, limit: 21.77 }), /ضريبة البند 3 .*50\.60.*15%.*21\.77.*لم يُسجَّل شيء/)
  assert.match(m({ reason: 'sum_mismatch', printed_vat: 51.15, invoice_vat: 51.25 }), /51\.15.*لا يساوي ضريبة الفاتورة 51\.25/)
  assert.match(m({ reason: 'negative_remainder', printed_vat: 51.15, invoice_vat: 20 }), /أكبر من ضريبة الفاتورة 20\.00/)
  assert.match(m({ reason: 'all_zero' }), /كل البنود مطبوعة بضريبة صفر/)
  assert.match(m({}), /لا تتسق مع ضريبة الفاتورة.*لم يُسجَّل شيء/)
})
