import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clearDraft, draftKey, dropLegacyDrafts, fingerprint, loadDraft, purgeDrafts, saveDraft } from '../src/lib/reviewDraft.js'

function memoryStorage() {
  const m = new Map()
  return {
    get length() { return m.size },
    key: i => [...m.keys()][i] ?? null,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _map: m,
  }
}

const reading = { type: 'expense', totalAmount: 694.6, vatAmount: 90.6, items: [{ description: 'مياه', amount: 172.5 }] }
const doc = { id: 'doc-1', status: 'analyzed', analysis_result: reading }
const me = { projectId: 'p-A', userId: 'u-1' }
const edit = { ...reading, description: 'بعد تعديل المحاسب' }

test('المسودة تُسترجع للمستخدم نفسه في المنشأة نفسها وللمستند نفسه', () => {
  const s = memoryStorage()
  assert.equal(saveDraft(s, me, doc, edit, { branch: 'الفرع 1' }, 1000), true)
  const got = loadDraft(s, me, doc)
  assert.equal(got.edit.description, 'بعد تعديل المحاسب')
  assert.equal(got.extras.branch, 'الفرع 1')
  assert.equal(got.savedAt, 1000)
})

test('معزولة: مستخدم آخر، أو منشأة أخرى، أو مستند آخر لا يرى المسودة', () => {
  const s = memoryStorage()
  saveDraft(s, me, doc, edit)
  assert.equal(loadDraft(s, { projectId: 'p-A', userId: 'u-2' }, doc), null)
  assert.equal(loadDraft(s, { projectId: 'p-B', userId: 'u-1' }, doc), null)
  assert.equal(loadDraft(s, me, { ...doc, id: 'doc-2' }), null)
  assert.notEqual(draftKey(me, 'doc-1'), draftKey({ projectId: 'p-B', userId: 'u-1' }, 'doc-1'))
})

test('بلا هوية مستخدم لا تُحفظ مسودة', () => {
  const s = memoryStorage()
  assert.equal(saveDraft(s, { projectId: 'p-A', userId: null }, doc, edit), false)
  assert.equal(s.length, 0)
})

test('لا تُطبَّق على مستند تغيّرت حالته، وتُحذف', () => {
  const s = memoryStorage()
  saveDraft(s, me, doc, edit)
  assert.deepEqual(loadDraft(s, me, { ...doc, status: 'approved' }), { stale: true })
  assert.equal(s.length, 0)
  assert.equal(loadDraft(s, me, doc), null)
})

test('لا تُطبَّق إن أُعيدت قراءة المستند (تغيّرت نتيجة القراءة)', () => {
  const s = memoryStorage()
  saveDraft(s, me, doc, edit)
  const reread = { ...doc, analysis_result: { ...reading, totalAmount: 700 } }
  assert.deepEqual(loadDraft(s, me, reread), { stale: true })
})

test('البصمة لا تتأثر بترتيب المفاتيح', () => {
  assert.equal(fingerprint({ a: 1, b: [1, { c: 2, d: 3 }] }), fingerprint({ b: [1, { d: 3, c: 2 }], a: 1 }))
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }))
})

test('تُزال بعد الاعتماد أو الرفض، وتُحذف مسودات المستندات التي خرجت من القائمة لهذا المستخدم فقط', () => {
  const s = memoryStorage()
  saveDraft(s, me, doc, edit)
  saveDraft(s, me, { ...doc, id: 'doc-2' }, edit)
  saveDraft(s, { projectId: 'p-A', userId: 'u-2' }, { ...doc, id: 'doc-3' }, edit)
  clearDraft(s, me, 'doc-1')
  assert.equal(loadDraft(s, me, doc), null)
  assert.equal(purgeDrafts(s, me, []), 1)                       // doc-2 لهذا المستخدم
  assert.ok(loadDraft(s, { projectId: 'p-A', userId: 'u-2' }, { ...doc, id: 'doc-3' }).edit)   // مسودة غيره تبقى
})

test('مسودات النسخة السابقة (بلا عزل) تُحذف ولا تُطبَّق', () => {
  const s = memoryStorage()
  s.setItem('pd-draft-doc-1', JSON.stringify(edit))
  s.setItem('mz_role', 'accountant')
  dropLegacyDrafts(s)
  assert.equal(s.getItem('pd-draft-doc-1'), null)
  assert.equal(s.getItem('mz_role'), 'accountant')
})

test('مسودة تالفة لا تكسر الصفحة', () => {
  const s = memoryStorage()
  s.setItem(draftKey(me, 'doc-1'), '{bad json')
  assert.equal(loadDraft(s, me, doc), null)
})
