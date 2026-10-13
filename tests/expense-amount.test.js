// مبلغ القيد في المصروفات (src/lib/financeRules.js) — الأساس المشترك للوحة التحكم والتقارير والتحليل المالي.
// الحالات الثلاث الأخيرة كانت تعطي «سالب الضريبة» قبل الإصلاح (انظر تسليم التحليل المالي): شراء آجل، ومرتجع مشتريات، وقيد ضريبة بلا مبلغ.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expenseAmountGross, expenseAmountNet } from '../src/lib/financeRules.js'

const meat = '🥩 تكلفة البضاعة المباعة'

test('شراء نقدي 115 منه ضريبة 15: الصافي 100 (كما كان)', () => {
  assert.equal(expenseAmountNet({ type: meat, cash_out: 115, vat_amount: 15 }), 100)
  assert.equal(expenseAmountNet({ type: meat, bank_out: 50, custody_out: 65, vat_amount: 15 }), 100)
})

test('شراء بلا ضريبة (غير خاضع أو معفى): المبلغ كاملًا', () => {
  assert.equal(expenseAmountNet({ type: meat, cash_out: 115, vat_amount: 0 }), 115)
})

test('شراء آجل 115 منه ضريبة 15 (payable_in): تكلفة 100 مرة واحدة بتاريخ الفاتورة، لا سالب الضريبة', () => {
  assert.equal(expenseAmountGross({ type: meat, payable_in: 115, vat_amount: 15 }), 115)
  assert.equal(expenseAmountNet({ type: meat, payable_in: 115, vat_amount: 15 }), 100)
})

test('مرتجع مشتريات 115 داخل منه ضريبة 15: ينقص التكلفة 100، لا 15', () => {
  assert.equal(expenseAmountNet({ type: meat, cash_in: 115, vat_amount: 15 }), -100)
  assert.equal(expenseAmountNet({ type: meat, bank_in: 46, vat_amount: 6 }), -40)
})

test('قيد بلا أي مبلغ نقدي أو آجل وعليه ضريبة: لا يُحتسب تكلفة سالبة', () => {
  assert.equal(expenseAmountNet({ type: meat, vat_amount: 15 }), 0)
  assert.equal(expenseAmountNet({ type: meat }), 0)
})

test('قيد فيه خروج ودخول معًا: الخروج ناقص الضريبة كما كان (الدخول لا يُخمَّن معناه)', () => {
  assert.equal(expenseAmountNet({ type: meat, cash_out: 115, bank_in: 20, vat_amount: 15 }), 100)
})
