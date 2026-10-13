// حقل رمز الدخول: التطبيع والطول (شاشة الدخول بهوية تحسيب)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PIN_LENGTH, normalizePin, pinReady, pinTooLong } from '../src/lib/pinInput.js'

test('أرقام عربية وفارسية ولاتينية تتحول إلى الرمز نفسه، والأصفار الأولى تبقى', () => {
  assert.equal(normalizePin('٠١٢٣٤'), '01234')
  assert.equal(normalizePin('۰۱۲۳۴'), '01234')
  assert.equal(normalizePin('01234'), '01234')
  assert.equal(normalizePin(' 0 12-34 '), '01234')
  assert.equal(PIN_LENGTH, 5)
})

test('الطول المقبول 5 أرقام بالضبط؛ الأطول لا يُقص بصمت', () => {
  assert.ok(pinReady('00001'))
  assert.ok(!pinReady('1234'))
  assert.ok(!pinReady('123456'))
  assert.equal(normalizePin('123456'), '123456')
  assert.ok(pinTooLong('123456'))
  assert.equal(normalizePin('abc'), '')
})
