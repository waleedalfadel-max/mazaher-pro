// جولة المراجعة الخامسة (ChatGPT، مراجعة الجولة 4): رسائل الرمزين الجديدين من الخادم.
// (R4-01 وR4-02 في local-test/credit-cycle.test.sql وpayment-delete-retry-concurrency.mjs وsupplier-payment-paths-ui.mjs)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { approvalMessage } from '../src/lib/approvalV2.js'

test('R4-02 رفض «سداد مورد» من الاعتماد برسالة عربية توجّه إلى «الموردين» وتقول إن شيئًا لم يُسجَّل', () => {
  const m = approvalMessage({ ok: false, code: 'supplier_payment_via_suppliers' })
  assert.match(m, /الموردين/)
  assert.match(m, /لم يُسجَّل شيء/)
})
