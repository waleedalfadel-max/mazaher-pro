// تحميل «سجل الحركات» و«أرشيف الحركات» (src/lib/journalEntries.js) بعميل مصطنع يحاكي حد الخادم (1000 صف) وفشل طلب بعينه.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadAttachmentCounts, loadPeriodEntries } from '../src/lib/journalEntries.js'

// عميل يحاكي PostgREST: يطبّق eq/not/gte/lte/in ثم الترتيب ثم range بحد خادم؛ ويفشل إن طابق fail(table, state)
function fakeClient(tables, { serverMax = 1000, fail = () => false, log = [] } = {}) {
  return {
    from(table) {
      const st = { table, filters: [], orders: [], inList: null }
      const b = {
        select() { return b },
        eq(c, v) { st.filters.push(r => r[c] === v); return b },
        not(c, op, v) { st.filters.push(op === 'eq' ? (r => r[c] !== v) : (r => r[c] != null)); return b },
        gte(c, v) { st.filters.push(r => r[c] >= v); return b },
        lte(c, v) { st.filters.push(r => r[c] <= v); return b },
        in(c, vs) { st.inList = vs; st.filters.push(r => vs.includes(r[c])); return b },
        order(c, { ascending = true } = {}) { st.orders.push([c, ascending]); return b },
        async range(a, z) {
          log.push({ table, from: a, inSize: st.inList?.length })
          if (fail(table, { from: a, inList: st.inList })) return { data: null, error: { message: 'Failed to fetch' } }
          const rows = tables[table].filter(r => st.filters.every(f => f(r))).sort((x, y) => {
            for (const [c, asc] of st.orders) { if (x[c] < y[c]) return asc ? -1 : 1; if (x[c] > y[c]) return asc ? 1 : -1 }
            return 0
          })
          return { data: rows.slice(a, Math.min(z + 1, a + serverMax)), error: null }
        },
      }
      return b
    },
  }
}

const P = 'p1'
const day = i => `2026-${String(1 + Math.floor(i / 200) % 12).padStart(2, '0')}-${String(1 + i % 28).padStart(2, '0')}`
function data(n) {
  const ledger = Array.from({ length: n }, (_, i) => ({ id: `e${String(i).padStart(5, '0')}`, project_id: P, date: day(i), created_at: 't' + (i % 3),
    status: i % 50 === 0 ? 'cancelled' : 'approved', journal_number: i % 4 === 0 ? null : `QD-${i}`, file_url: i % 7 === 0 ? `f${i}` : '' }))
  ledger.push({ id: 'other', project_id: 'p2', date: '2026-03-03', created_at: 't', status: 'approved', journal_number: 'QD-x', file_url: '' })
  const documents = ledger.filter((r, i) => r.journal_number && i % 5 === 1).flatMap((r, k) => [
    { id: `d${k}a`, journal_number: r.journal_number, file_url: `old-${r.journal_number}`, file_name: 'قديم', uploaded_at: '2026-01-01' },
    { id: `d${k}b`, journal_number: r.journal_number, file_url: `doc-${r.journal_number}`, file_name: 'مستند', uploaded_at: '2026-02-01' }])
  const attachments = ledger.filter((r, i) => r.journal_number && i % 3 === 1).flatMap((r, k) => [{ id: `a${k}x`, project_id: P, journal_number: r.journal_number }, { id: `a${k}y`, project_id: P, journal_number: r.journal_number }])
  return { ledger_entries: ledger, documents, attachments }
}
const cols = '*'

test('أكثر من 2000 قيد بحد خادم 1000: كلها، بلا الملغاة ولا منشأة أخرى، بترتيب ثابت (التاريخ ثم وقت الإنشاء ثم المعرّف)', async () => {
  const t = data(2600), log = []
  const res = await loadPeriodEntries(fakeClient(t, { log }), { projectId: P, columns: cols, dateAscending: true })
  const want = t.ledger_entries.filter(r => r.project_id === P && r.status !== 'cancelled')
  assert.equal(res.error, null)
  assert.equal(res.data.length, want.length)
  assert.equal(new Set(res.data.map(r => r.id)).size, want.length)
  for (let i = 1; i < res.data.length; i++) {
    const a = res.data[i - 1], b = res.data[i]
    assert.ok(a.date < b.date || (a.date === b.date && (a.created_at < b.created_at || (a.created_at === b.created_at && a.id < b.id))), `ترتيب ${i}`)
  }
  assert.ok(log.filter(l => l.table === 'ledger_entries').length >= 3)
  const desc = await loadPeriodEntries(fakeClient(t), { projectId: P, columns: cols, dateAscending: false })
  assert.equal(desc.data.length, want.length); assert.ok(desc.data[0].date >= desc.data.at(-1).date)
})

test('الفترة: من/إلى شاملتان', async () => {
  const t = data(900)
  const res = await loadPeriodEntries(fakeClient(t), { projectId: P, from: '2026-02-01', to: '2026-03-28', columns: cols, dateAscending: true })
  assert.equal(res.data.length, t.ledger_entries.filter(r => r.project_id === P && r.status !== 'cancelled' && r.date >= '2026-02-01' && r.date <= '2026-03-28').length)
})

test('روابط المستندات: للقيد بلا ملف برقم قيده، على دفعات (≤100)، والأحدث رفعًا عند التعدد؛ وملف القيد نفسه لا يُستبدل', async () => {
  const t = data(2600), log = []
  const res = await loadPeriodEntries(fakeClient(t, { log }), { projectId: P, columns: cols, dateAscending: true })
  const linked = new Set(t.documents.map(d => d.journal_number))
  for (const r of res.data) {
    const orig = t.ledger_entries.find(x => x.id === r.id)
    if (orig.file_url) assert.equal(r.file_url, orig.file_url)
    else if (linked.has(r.journal_number)) { assert.equal(r.file_url, `doc-${r.journal_number}`); assert.equal(r._doc_name, 'مستند') }
    else assert.equal(r.file_url, '')
  }
  assert.ok(log.filter(l => l.table === 'documents').every(l => l.inSize <= 100))
  assert.ok(log.filter(l => l.table === 'documents').length > 10)
  assert.equal(t.ledger_entries.find(r => r.id === 'e00001').file_url, '', 'لا يغيّر البيانات المصدر')
})

test('عدد المرفقات كاملًا على دفعات', async () => {
  const t = data(2600), log = []
  const jn = t.ledger_entries.filter(r => r.project_id === P).map(r => r.journal_number)
  const res = await loadAttachmentCounts(fakeClient(t, { log }), { projectId: P, journalNumbers: jn })
  const want = {}; t.attachments.forEach(a => { want[a.journal_number] = (want[a.journal_number] || 0) + 1 })
  assert.deepEqual(res.data, want)
  assert.ok(log.every(l => l.inSize <= 100))
  assert.deepEqual((await loadAttachmentCounts(fakeClient(t), { projectId: P, journalNumbers: [null, ''] })).data, {})
})

test('أي فشل يُعاد خطأً باسم ما تعذّر، لا بيانات ناقصة', async () => {
  const t = data(2600), opts = { projectId: P, columns: cols, dateAscending: true }
  const page2 = await loadPeriodEntries(fakeClient(t, { fail: (tb, s) => tb === 'ledger_entries' && s.from === 1000 }), opts)
  assert.equal(page2.data, null); assert.equal(page2.part, 'القيود')
  const docs = await loadPeriodEntries(fakeClient(t, { fail: (tb, s) => tb === 'documents' && s.inList?.includes('QD-1501') }), opts)
  assert.equal(docs.data, null); assert.equal(docs.part, 'روابط المستندات')
  const att = await loadAttachmentCounts(fakeClient(t, { fail: tb => tb === 'attachments' }), { projectId: P, journalNumbers: ['QD-1'] })
  assert.equal(att.data, null); assert.equal(att.part, 'عدد المرفقات')
})
