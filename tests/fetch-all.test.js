// الجلب الكامل (src/lib/fetchAll.js): لا نقص صامت عند حد الخادم، ولا بيانات ناقصة عند فشل صفحة.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchEveryRow, fetchByChunks } from '../src/lib/fetchAll.js'

// طلب مصطنع: جدول بـ n صف، وخادم يعيد في الطلب الواحد cap صفًا على الأكثر، ويفشل عند إزاحة معيّنة إن طُلب
const fake = (n, cap, failAt = null) => {
  const calls = []
  const build = () => ({ range: async (from, to) => { calls.push(from); if (from === failAt) return { data: null, error: { message: 'boom' } }
    const end = Math.min(n, to + 1, from + cap); return { data: Array.from({ length: Math.max(0, end - from) }, (_, i) => ({ i: from + i })), error: null } } })
  return { build, calls }
}

test('1001 صف بحد خادم 1000: كلها تصل (الصف 1001 لا يضيع)', async () => {
  const f = fake(1001, 1000)
  const { data, error } = await fetchEveryRow(f.build)
  assert.equal(error, null); assert.equal(data.length, 1001); assert.equal(data.at(-1).i, 1000)
})

test('حد خادم أصغر من حجم الصفحة (500): لا يتوقف عند أول صفحة ناقصة', async () => {
  const f = fake(1234, 500)
  const { data } = await fetchEveryRow(f.build, 1000)
  assert.equal(data.length, 1234); assert.deepEqual(f.calls, [0, 500, 1000, 1234])
})

test('فشل صفحة بعد الأولى: خطأ لا بيانات ناقصة', async () => {
  const f = fake(1500, 1000, 1000)
  const { data, error } = await fetchEveryRow(f.build)
  assert.equal(data, null); assert.equal(error.message, 'boom')
})

test('الدفعات: كل الدفعات أو خطأ', async () => {
  const ok = await fetchByChunks([1, 2, 3, 4, 5], 2, async c => ({ data: c.map(x => ({ x })), error: null }))
  assert.deepEqual(ok.data.map(r => r.x), [1, 2, 3, 4, 5])
  const bad = await fetchByChunks([1, 2, 3, 4, 5], 2, async c => (c.includes(3) ? { data: null, error: { message: 'x' } } : { data: c, error: null }))
  assert.equal(bad.data, null); assert.equal(bad.error.message, 'x')
})
