// قواعد عرض قسم «الموظفون» في إعدادات المالك (الخادم هو الحكم؛ هذه للتنبيه والعرض).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLastActiveAccountant, memberAction, roleLabel, teamMessage, userChangeMessage } from '../src/lib/teamSettings.js'

const acc1 = { id: 'a1', role: 'accountant', is_active: true }
const acc2 = { id: 'a2', role: 'accountant', is_active: true }
const cashier = { id: 'c1', role: 'cashier', is_active: true }

test('آخر محاسب نشط: وحده، لا حين يوجد محاسب نشط آخر', () => {
  assert.equal(isLastActiveAccountant([acc1, cashier], acc1), true)
  assert.equal(isLastActiveAccountant([acc1, acc2], acc1), false)
  assert.equal(isLastActiveAccountant([acc1, { ...acc2, is_active: false }], acc1), true)
  assert.equal(isLastActiveAccountant([acc1, cashier], cashier), false)
  assert.equal(isLastActiveAccountant([{ ...acc1, is_active: false }], { ...acc1, is_active: false }), false)
})

test('الإجراء: لا شيء لحساب المالك نفسه، وتعطيل أو إعادة تفعيل لغيره', () => {
  assert.equal(memberAction({ ...cashier, is_self: true }).kind, 'none')
  assert.equal(memberAction(cashier).kind, 'deactivate')
  assert.equal(memberAction({ ...cashier, is_active: false }).kind, 'reactivate')
})

test('الرسائل: رموز الخادم بالعربية، والمجهول يُذكر رمزه', () => {
  assert.match(teamMessage({ code: 'self' }), /حسابك/)
  assert.match(teamMessage({ code: 'last_accountant' }), /المحاسب النشط الوحيد/)
  assert.match(teamMessage({ code: 'not_found' }), /منشأتك/)
  assert.match(teamMessage({ code: 'x_unknown' }), /x_unknown/)
  assert.equal(roleLabel('purchasing'), 'المشتريات')
})

test('الكتابة المباشرة المرفوضة: رسالة مفهومة بدل نص الخطأ التقني', () => {
  assert.match(userChangeMessage({ message: 'user_change_forbidden' }), /لمالك المنشأة/)
  assert.match(userChangeMessage({ message: 'use_team_set_active' }), /إعدادات المالك/)
  assert.equal(userChangeMessage({ message: 'other' }), 'other')
  assert.match(userChangeMessage({ message: 'user_delete_forbidden' }), /لا تُحذف/)
  // خطأ صلاحية عام عند الإضافة أو تغيير الرمز: رسالة عامة، لا رسالة الحذف
  for (const message of ['permission denied for table app_users', 'new row violates row-level security policy for table "app_users"']) {
    assert.equal(userChangeMessage({ message }), 'لا تملك صلاحية تنفيذ هذا الإجراء.')
    assert.doesNotMatch(userChangeMessage({ message }), /تُحذف/)
  }
})
