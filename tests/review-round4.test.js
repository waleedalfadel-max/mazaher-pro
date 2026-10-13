// جولة المراجعة الرابعة (ChatGPT، مراجعة الجولة 3): R3-01 وG3-01 — مسار سداد الموردين الواحد في الواجهة.
// (حماية الخادم في local-test/credit-cycle.test.sql، والواجهة بهوية محاسب في local-test/supplier-payment-paths-ui.mjs، وR3-02 في history-inventory.mjs)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSupplierPaymentType, deleteSupplierPayment, supplierPaymentDeleteMessage, SUPPLIER_PAYMENT_ONLY_MSG } from '../src/lib/supplierPayments.js'
import { buildLedgerInsertRow } from '../src/lib/bankReconciliation.js'
import { summarizeEntries } from '../src/lib/financeSummary.js'

const fakeClient = result => {
  const calls = []
  return { calls, rpc: async (name, args) => { calls.push({ name, args }); return result } }
}

test('R3-01 نوع «سداد مورد» يُعرف بأي رمز قبله، ولا يلتبس بغيره', () => {
  assert.equal(isSupplierPaymentType('🏪 سداد مورد'), true)
  assert.equal(isSupplierPaymentType('سداد مورد'), true)
  for (const t of ['🛒 مصروفات تشغيلية', '📦 مواد تعبئة وتغليف', '🏛️ ضريبة القيمة المضافة', '', null, undefined]) assert.equal(isSupplierPaymentType(t), false)
  assert.match(SUPPLIER_PAYMENT_ONLY_MSG, /الموردين/)
})

test('R3-01 صف المطابقة البنكية بنوع «سداد مورد» بلا تخفيض التزام: المحرك يحسبه تكلفة ثانية (215) — لذلك يُرفض من الخادم', () => {
  const invoice = { date: '2026-10-01', type: '📦 مواد تعبئة وتغليف', status: 'approved', payable_in: 115, vat_amount: 15, total_amount: 115 }
  const recon = buildLedgerInsertRow({ date: '2026-10-05', amount: 115, direction: 'out', description: 'تحويل' }, { transType: '🏪 سداد مورد', projectId: 'p', journalNumber: 'J', fileUrl: '' })
  assert.equal(recon.payable_out, undefined)
  const cost = rows => { const s = summarizeEntries(rows); return Math.round((s.cogs + s.operatingExpenses) * 100) / 100 }
  assert.equal(cost([invoice]), 100)
  assert.equal(cost([invoice, recon]), 215)
  // السداد من «الموردين» (supplier_payment_record): خروج يساويه تخفيض الالتزام → لا تكلفة جديدة
  assert.equal(cost([invoice, { date: '2026-10-05', type: '🏪 سداد مورد', status: 'approved', bank_out: 115, payable_out: 115, vat_amount: 0, total_amount: 115 }]), 100)
})

test('G3-01 حذف قيد السداد: برقم القيد إن وُجد، وبمعرّف الصف لقيد تاريخي بلا رقم', async () => {
  const c1 = fakeClient({ data: { ok: true }, error: null })
  assert.equal(await deleteSupplierPayment(c1, { id: 'e1', journal_number: 'QD-1' }), null)
  assert.deepEqual(c1.calls, [{ name: 'supplier_payment_delete', args: { p_journal_number: 'QD-1', p_entry_id: null } }])
  const c2 = fakeClient({ data: { ok: true }, error: null })
  await deleteSupplierPayment(c2, { id: 'e2', journal_number: null })
  assert.deepEqual(c2.calls[0].args, { p_journal_number: null, p_entry_id: 'e2' })
})

test('G3-01 رسائل الحذف: رمز الخادم برسالة عربية، وخطأ الطلب كما هو', async () => {
  assert.equal(await deleteSupplierPayment(fakeClient({ data: { ok: false, code: 'forbidden' }, error: null }), { id: 'e', journal_number: 'J' }), 'حذف دفعات الموردين للمحاسب فقط.')
  assert.match(await deleteSupplierPayment(fakeClient({ data: { ok: false, code: 'not_found' }, error: null }), { id: 'e', journal_number: 'J' }), /غير موجودة/)
  assert.equal(await deleteSupplierPayment(fakeClient({ data: null, error: { message: 'Failed to fetch' } }), { id: 'e', journal_number: 'J' }), 'Failed to fetch')
  assert.match(supplierPaymentDeleteMessage('weird'), /weird/)
})
