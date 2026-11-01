// رسالة توقف الاعتماد عند تعارض ضريبة الأسطر المطبوعة (20261031130000): عربية، بالسبب والأرقام، وتقول إنه لم يُسجَّل شيء
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { approvalMessage } from '../src/lib/approvalV2.js'

test('line_vat_conflict: لكل سبب رسالة بأرقامه، ولا يُسجَّل شيء', () => {
  const m = d => approvalMessage({ code: 'line_vat_conflict', ...d })
  assert.match(m({ reason: 'line_over_limit', line: 3, line_vat: 50, limit: 18.02 }), /ضريبة البند 3 .*50\.00.*15%.*18\.02.*لم يُسجَّل شيء/)
  assert.match(m({ reason: 'sum_mismatch', printed_vat: 48, invoice_vat: 48.1 }), /48\.00.*لا يساوي ضريبة الفاتورة 48\.10/)
  assert.match(m({ reason: 'negative_remainder', printed_vat: 48, invoice_vat: 20 }), /أكبر من ضريبة الفاتورة 20\.00/)
  assert.match(m({ reason: 'all_zero' }), /كل البنود مطبوعة بضريبة صفر/)
  assert.match(m({}), /لا تتسق مع ضريبة الفاتورة.*لم يُسجَّل شيء/)
  assert.match(approvalMessage({ ok: false, code: 'line_vat_conflict', reason: 'correction_invalid', line: 3, cause: 'over_limit', limit: 18.02, invoice_vat: 48, corrected_vat: 19, invoice_id: 'x' }), /ضريبة البند 3 المصححة 19\.00 تتجاوز 15% من صافيه \(الحد 18\.02\)؛ لا تُستبدل بتوزيع.*لم يُسجَّل شيء/)
  assert.match(approvalMessage({ ok: false, code: 'line_vat_conflict', reason: 'correction_invalid', line: 3, cause: 'value_mismatch', limit: 18.02, invoice_vat: 48, corrected_vat: 17, invoice_id: 'x' }), /لا تطابق القيمة المسجلة في التصحيح/)
})
