// تصحيح ضريبة بند من المراجعة (src/lib/lineVat.js): الأصل والقيمة والسبب، وسطر متسق مع قاعدة الاعتماد، ولا يمس غير البند. أرقام مصطنعة.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { correctLineVat, hasLineVat, lineVatText } from '../src/lib/lineVat.js'

const at = new Date('2026-11-01T10:00:00Z')
test('قبل الضريبة: الضريبة المصححة على الصافي المراجَع، والأصل محفوظ، والقيم أرقام', () => {
  const it = { description: 'منظف تجريبي', amount: 120, lineNet: 120, lineVat: 0, printedLineTotal: 120, category_main: 'تنظيف' }
  const c = correctLineVat(it, '18', 'قُرئت صفرًا', 'exclusive', at)
  assert.deepEqual([c.lineNet, c.lineVat, c.printedLineTotal, c.amount, c.category_main], [120, 18, 138, 120, 'تنظيف'])
  assert.deepEqual(c.vatCorrection, { original: { lineVat: 0, lineNet: 120, printedLineTotal: 120 }, value: 18, reason: 'قُرئت صفرًا', basis: 'exclusive', at: '2026-11-01T10:00:00.000Z' })
  assert.equal(typeof c.lineVat, 'number')
})
test('الشامل: الإجمالي يبقى مبلغ البند والصافي = الإجمالي − الضريبة', () => {
  const c = correctLineVat({ amount: 138, lineNet: 138, lineVat: 0, printedLineTotal: 138 }, 18, 'سبب', 'inclusive', at)
  assert.deepEqual([c.lineNet, c.lineVat, c.printedLineTotal], [120, 18, 138])
})
test('تصحيح ثانٍ لا يمحو القراءة الأصلية', () => {
  const once = correctLineVat({ amount: 120, lineNet: 120, lineVat: 0, printedLineTotal: 120 }, 17, 'أولى', 'exclusive', at)
  const twice = correctLineVat(once, 18, 'ثانية', 'exclusive', at)
  assert.deepEqual(twice.vatCorrection.original, { lineVat: 0, lineNet: 120, printedLineTotal: 120 }); assert.equal(twice.vatCorrection.reason, 'ثانية')
})
test('السبب والقيمة والمبلغ إلزامية؛ ضريبة غير المعروفة تُصحَّح أيضًا', () => {
  assert.throws(() => correctLineVat({ amount: 120 }, 18, '  ', 'exclusive'), /سبب/)
  assert.throws(() => correctLineVat({ amount: 120 }, '-1', 'سبب', 'exclusive'), /موجب أو صفر/)
  assert.throws(() => correctLineVat({ amount: 120 }, '1.234', 'سبب', 'exclusive'), /موجب أو صفر/)
  assert.throws(() => correctLineVat({ amount: '' }, 18, 'سبب', 'exclusive'), /مبلغ البند/)
  assert.throws(() => correctLineVat({ amount: 18 }, 18, 'سبب', 'inclusive'), /أقل من مبلغه/)
  const u = correctLineVat({ amount: 120, lineNet: 120, printedLineTotal: 120 }, 18, 'لم تُقرأ', 'exclusive', at)
  assert.equal(u.vatCorrection.original.lineVat, null); assert.match(lineVatText(u), /غير مقروءة ← 18\.00 — لم تُقرأ/)
  assert.equal(hasLineVat({ amount: 1 }), false); assert.equal(hasLineVat({ lineVat: 0 }), true)
})
