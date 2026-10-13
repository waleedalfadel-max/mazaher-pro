// معالجة قيود الضريبة في التقارير (src/lib/vatTreatment.js) واستبعادها من تفصيل المصروفات (src/lib/reportFigures.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyTaxEntry, vatFigures, REVIEW_REASONS } from '../src/lib/vatTreatment.js'
import { expenseFigures } from '../src/lib/reportFigures.js'
import { isRealExpense, isTaxType } from '../src/lib/financeRules.js'

const VAT = '🏛️ ضريبة القيمة المضافة'
const e = (o) => ({ id: o.id || Math.random().toString(36), date: '2026-09-15', cash_in: 0, bank_in: 0, custody_in: 0, cash_out: 0, bank_out: 0, custody_out: 0, vat_amount: null, status: 'approved', ...o })   // قيود معتمدة: غير المعتمد لا يُحتسب (financeRules.isCounted)

test('سداد مؤكد: نوع ضريبة القيمة المضافة وخروج نقدي بلا ضريبة مسجلة ولا بنود', () => {
  const c = classifyTaxEntry(e({ type: VAT, bank_out: 5000 }))
  assert.equal(c.kind, 'payment'); assert.equal(c.amount, 5000); assert.equal(c.source, 'البنك')
  assert.equal(classifyTaxEntry(e({ type: VAT, cash_out: 100, custody_out: 50 })).source, 'الصندوق والعهدة')
})

test('استرداد: دخول فقط بالنوع نفسه', () => {
  const c = classifyTaxEntry(e({ type: VAT, bank_in: 800 }))
  assert.equal(c.kind, 'refund'); assert.equal(c.amount, 800)
})

test('لا يُخمَّن: ضريبة مسجلة، أو بنود مستند، أو اتجاهان، أو بلا حركة نقدية، أو نوع ضريبي آخر → تأكيد المحاسب', () => {
  assert.equal(classifyTaxEntry(e({ type: VAT, custody_out: 230, vat_amount: 30 })).reason, 'vat_recorded')
  const linked = e({ id: 'L1', type: VAT, bank_out: 1150, journal_number: 'J-9' })
  assert.equal(classifyTaxEntry(linked, [{ ledger_entry_id: 'L1', journal_number: 'J-9', amount: 1150 }]).reason, 'has_items')
  assert.equal(classifyTaxEntry(e({ type: VAT, bank_out: 10, cash_in: 10 })).reason, 'both_directions')
  assert.equal(classifyTaxEntry(e({ type: VAT, payable_in: 500 })).reason, 'no_cash')
  assert.equal(classifyTaxEntry(e({ type: '🧾 ضريبة استقطاع', bank_out: 300 })).reason, 'other_tax')
  for (const r of Object.keys(REVIEW_REASONS)) assert.ok(REVIEW_REASONS[r].length > 20)
})

test('غير الضريبي لا يُصنَّف', () => {
  assert.equal(classifyTaxEntry(e({ type: '🛒 مصروفات تشغيلية', bank_out: 115, vat_amount: 15 })), null)
})

test('ضريبة الفترة: المدخلات من الفواتير وحدها، والمدفوعات منفصلة ولا تُطرح، ولا «متبقٍ»', () => {
  const entries = [
    e({ type: '🛒 مصروفات تشغيلية', bank_out: 1150, vat_amount: 150, description: 'فاتورة مشتريات' }),
    e({ type: '🥩 تكلفة البضاعة المباعة', custody_out: 230, vat_amount: 30 }),
    e({ type: VAT, bank_out: 5000, description: 'سداد ضريبة الفترة' }),
    e({ type: VAT, bank_out: 7000, description: 'سداد إقرار فترة سابقة' }),
    e({ type: VAT, bank_in: 800, description: 'استرداد' }),
    e({ type: VAT, custody_out: 230, vat_amount: 30, description: 'مستند ملتبس' }),
    e({ type: '🧾 ضريبة استقطاع', bank_out: 300, vat_amount: 0 }),
  ]
  const v = vatFigures({ entries, docItems: [], outputVat: 2000 })
  assert.equal(v.inputVat, 180)                       // 150 + 30 فقط
  assert.equal(v.inputVatEntries.length, 2)
  assert.equal(v.netBeforePayment, 1820)              // 2000 − 180، والمدفوعات لا تُطرح
  assert.equal(v.paymentsTotal, 12000); assert.equal(v.payments.length, 2)
  assert.equal(v.refundsTotal, 800)
  assert.deepEqual(v.review.map(r => r.reason).sort(), ['other_tax', 'vat_recorded'])
  assert.ok(!('remaining' in v) && !('due' in v))
  // السداد لفترة سابقة لا يغيّر صافي أي فترة: الصافي نفسه بلا قيود السداد
  const without = vatFigures({ entries: entries.filter(x => x.type !== VAT), docItems: [], outputVat: 2000 })
  assert.equal(without.netBeforePayment, v.netBeforePayment)
})

test('تفصيل المصروفات يستبعد القيود الضريبية بشرط المحرك نفسه، ويعيدها في taxEntries', () => {
  const entries = [
    e({ type: '🛒 مصروفات تشغيلية', bank_out: 1150, vat_amount: 150, description: 'كهرباء', category_main: 'مصروفات تشغيلية' }),
    e({ type: VAT, bank_out: 5000, description: 'سداد' }),
    e({ type: '🧾 ضريبة استقطاع', bank_out: 300 }),
  ]
  const x = expenseFigures({ entries, docItems: [], categoriesById: {}, engineSummary: { totalSales: 10000 }, data: null })
  assert.deepEqual(x.mainRows.map(r => r.total), [1000])
  assert.equal(x.taxEntries.length, 2)
  // الشرط نفسه في المحرك: القيد الضريبي ليس مصروفًا
  for (const t of entries) assert.equal(isRealExpense(t), !isTaxType(t.type))
})

test('بنود غير محمّلة لا تُعامل كقائمة فارغة: الحساب يرفض بدل تصنيف القيد سدادًا', () => {
  const entries = [e({ type: VAT, bank_out: 300, journal_number: 'J-1', id: 'L3' })]
  assert.throws(() => vatFigures({ entries, docItems: null, outputVat: 0 }), /vat_items_unavailable/)
  assert.throws(() => vatFigures({ entries, outputVat: 0 }), /vat_items_unavailable/)
  // ومع البنود المحمّلة: المرتبط يجعله للمراجعة
  const v = vatFigures({ entries, docItems: [{ ledger_entry_id: 'L3', journal_number: 'J-1' }], outputVat: 0 })
  assert.equal(v.paymentsTotal, 0); assert.equal(v.review[0].reason, 'has_items')
})
