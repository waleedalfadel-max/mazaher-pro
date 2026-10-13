import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeCategories, categoryMessage, categoryTree, nameError, normCat } from '../src/lib/categorySettings.js'
import { itemMainCategory } from '../src/lib/approvalV2.js'

const cats = [
  { id: 'm1', name: 'تكلفة البضاعة المباعة', parent_id: null, sort_order: 2, is_active: true },
  { id: 'm2', name: 'مخبوزات', parent_id: null, sort_order: 1, is_active: false },
  { id: 's1', name: 'خضار', parent_id: 'm1', sort_order: 2, is_active: true },
  { id: 's2', name: 'لحوم', parent_id: 'm1', sort_order: 1, is_active: false },
  { id: 's3', name: 'خبز', parent_id: 'm2', sort_order: 1, is_active: true },
  { id: 's4', name: 'أخرى', parent_id: 'm1', sort_order: 3, is_active: true },
  { id: 's5', name: 'أخرى', parent_id: 'm2', sort_order: 2, is_active: true },
]

test('التطبيع يطابق الخادم: الرموز تُحذف، والحروف اللاتينية والأرقام تبقى', () => {
  assert.equal(normCat('☕ قهوة'), normCat('قهوة'))
  assert.notEqual(normCat('Coffee 1'), normCat('Coffee 2'))
  assert.equal(normCat('فرع ١٢'), normCat('فرع 12'))
  assert.equal(normCat('PEPSI'), normCat('pepsi'))
})

test('الشجرة بالترتيب، والمعطّل مخفي إلا عند طلبه', () => {
  assert.deepEqual(categoryTree(cats).map(m => [m.id, m.subs.map(s => s.id)]), [['m1', ['s1', 's4']]])
  assert.deepEqual(categoryTree(cats, { showInactive: true }).map(m => [m.id, m.subs.map(s => s.id)]), [['m2', ['s3', 's5']], ['m1', ['s2', 's1', 's4']]])
})

test('المتاح للاستعمال الجديد: فرعي فعّال تحت رئيسي فعّال فقط', () => {
  assert.deepEqual(activeCategories(cats).map(c => c.id), ['m1', 's1', 's4'])
})

test('التحقق من الاسم: فارغ، ورموز فقط، ومكرر في المستوى مع ذكر المعطّل', () => {
  const mains = cats.filter(c => !c.parent_id)
  assert.match(nameError('  ', mains), /اكتب اسم/)
  assert.match(nameError('!!! 12', mains), /بحروف/)
  assert.match(nameError('🍞 مخبوزات', mains), /معطّل/)
  assert.equal(nameError('مخبوزات', mains, 'm2'), null)          // التصنيف نفسه عند التسمية
  assert.equal(nameError('Coffee 2', [{ id: 'x', name: 'Coffee 1' }]), null)
})

test('الفرعي الملتبس بلا رئيسي لا يحسم الرئيسي في العميل (الخادم يطلب الاختيار)', () => {
  assert.equal(itemMainCategory(cats, { category_sub: 'أخرى' }, ''), null)
  assert.equal(itemMainCategory(cats, { category_main: 'مخبوزات', category_sub: 'أخرى' }, ''), 'مخبوزات')
  assert.equal(itemMainCategory(cats, { category_sub: 'خضار' }, ''), 'تكلفة البضاعة المباعة')
})

test('رسائل الخادم بالعربية، ومنها الاسم المكرر المعطّل', () => {
  assert.match(categoryMessage({ code: 'duplicate_name', existing: 'مخبوزات', existing_active: false }), /أعد تفعيله/)
  assert.match(categoryMessage({ code: 'forbidden' }), /لمالك المنشأة فقط/)
  assert.match(categoryMessage({ code: 'class_locked', entries: 3, items: 2 }), /5/)
})
