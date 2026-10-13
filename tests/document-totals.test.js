import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareItemsToTotal } from '../src/lib/documentTotals.js'

test('فاتورة متطابقة (البنود شاملة الضريبة كما يطلب اصطلاح القراءة): لا فرق بسبب الضريبة', () => {
  const r = compareItemsToTotal({ totalAmount: 862.5, vatAmount: 112.5, items: [{ amount: 517.5 }, { amount: 345 }] })
  assert.equal(r.status, 'match')
  assert.equal(r.diff, 0)
})

test('فاتورة ناقصة بندًا: يظهر الفرق الحقيقي', () => {
  // الإجمالي 862.50 شامل؛ قُرئ بند واحد فقط (517.50) وسقط الآخر (345.00)
  const r = compareItemsToTotal({ totalAmount: 862.5, vatAmount: 112.5, items: [{ amount: 517.5 }] })
  assert.equal(r.status, 'mismatch')
  assert.equal(r.diff, -345)
})

test('بنود مقروءة قبل الضريبة: أساس مختلف لا بند ناقص (المثال الذي ظهر في الصورة 03)', () => {
  const r = compareItemsToTotal({ totalAmount: 862.5, vatAmount: 112.5, items: [{ amount: 450 }, { amount: 300 }] })
  assert.equal(r.status, 'net-basis')
  assert.equal(r.diff, 0)
})

test('بنود قبل الضريبة وينقصها بند: يبقى فرقًا حقيقيًا', () => {
  const r = compareItemsToTotal({ totalAmount: 862.5, vatAmount: 112.5, items: [{ amount: 450 }] })
  assert.equal(r.status, 'mismatch')
  assert.equal(r.diff, -412.5)
})

test('لا تُفترض نسبة ضريبة: نسبة غير 15% تُقرأ من المستند نفسه', () => {
  // ضريبة 5% مقروءة: 1000 + 50 = 1050
  assert.equal(compareItemsToTotal({ totalAmount: 1050, vatAmount: 50, items: [{ amount: 1000 }] }).status, 'net-basis')
  // بلا ضريبة مقروءة: البنود قبل الضريبة لا تُفسَّر ضمنًا، فالفرق يظهر
  assert.equal(compareItemsToTotal({ totalAmount: 1150, vatAmount: 0, items: [{ amount: 1000 }] }).status, 'mismatch')
  // مستند بلا ضريبة ومتطابق
  assert.equal(compareItemsToTotal({ totalAmount: 28400, vatAmount: 0, items: [{ amount: 28400 }] }).status, 'match')
})

test('الهامش نفسه في المنطق السابق (0.5) وبلا بنود لا مقارنة', () => {
  assert.equal(compareItemsToTotal({ totalAmount: 100, items: [{ amount: 100.4 }] }).status, 'match')
  assert.equal(compareItemsToTotal({ totalAmount: 100, items: [] }).status, 'none')
  assert.equal(compareItemsToTotal({ amount: 57.5, items: [{ amount: '57.50' }] }).status, 'match')
})
