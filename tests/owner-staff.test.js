// إدارة الموظفين للمالك (20261014130000): قواعد العرض والفحص المسبق. الخادم هو الحكم (local-test/owner-staff.test.sql).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STAFF_ROLES, branchLabel, isManagedStaff, pinProblem, teamActionLabel, teamMessage } from '../src/lib/teamSettings.js'

test('المالك يدير المحاسب والمشتريات والكاشير وحدهم، لا المالك ولا مدير المنصة', () => {
  assert.deepEqual(STAFF_ROLES, ['accountant', 'purchasing', 'cashier'])
  for (const role of STAFF_ROLES) assert.equal(isManagedStaff({ role }), true)
  for (const role of ['owner', 'superadmin']) assert.equal(isManagedStaff({ role }), false)
})

test('الفرع الفارغ يُعرض «كل الفروع»', () => {
  assert.equal(branchLabel(null), 'كل الفروع')
  assert.equal(branchLabel('فرع الشمال'), 'فرع الشمال')
})

test('فحص الرمز قبل الإرسال: 5 أرقام بالضبط والتأكيد مطابق', () => {
  assert.equal(pinProblem('12345', '12345'), '')
  assert.match(pinProblem('1234', '1234'), /5 أرقام/)
  assert.match(pinProblem('12a45', '12a45'), /5 أرقام/)
  assert.match(pinProblem('12345', '12346'), /لا يطابق/)
})

test('رسائل الخادم الجديدة وأسماء السجل بالعربية', () => {
  for (const code of ['invalid_role', 'invalid_branch', 'invalid_pin', 'invalid_name', 'pin_in_use', 'try_later', 'save_failed'])
    assert.doesNotMatch(teamMessage({ code }), /تعذّر الحفظ \(/, code)
  assert.equal(teamActionLabel('create'), 'أُضيف')
  assert.equal(teamActionLabel('set_access'), 'تغيّر دوره أو فرعه')
  assert.equal(teamActionLabel('set_pin'), 'عُيّن له رمز جديد')
})
