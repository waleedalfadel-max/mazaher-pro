import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isCOGSEntry } from '../src/lib/financeClass.js'

test('الرمز المالي الثابت يحدد تكلفة البضاعة، لا نص النوع', () => {
  assert.equal(isCOGSEntry({ type: 'مشتريات المطبخ', financial_class: 'cogs' }), true)
  assert.equal(isCOGSEntry({ type: '🥩 تكلفة البضاعة المباعة', financial_class: 'opex' }), false)
})
test('القيود السابقة بلا رمز: الاستنتاج من النوع كما كان', () => {
  assert.equal(isCOGSEntry({ type: '📦 مواد تعبئة وتغليف' }), true)
  assert.equal(isCOGSEntry({ type: '🛒 مصروفات تشغيلية' }), false)
})
