import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptAmount, toLatinNumber } from '../src/lib/amountInput.js'

test('الأرقام العربية والهندية تتحول إلى لاتينية، والفاصلة العشرية العربية إلى نقطة', () => {
  assert.equal(toLatinNumber('١٨١٫٥'), '181.5')
  assert.equal(toLatinNumber('۴۰۰'), '400')
  assert.equal(toLatinNumber('1,391.50'), '1391.50')
  assert.equal(toLatinNumber('١٬٣٩١٫٥٠'), '1391.50')
})

test('المدخل غير الرقمي يُرفض ولا يصير صفرًا', () => {
  assert.equal(acceptAmount('12a'), null)
  assert.equal(acceptAmount('1.2.3'), null)
  assert.equal(acceptAmount('٤٠٠'), '400')
  assert.equal(acceptAmount(''), '')
  assert.equal(acceptAmount('-'), '-')
  assert.equal(acceptAmount('0.'), '0.')
})
