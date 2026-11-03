import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import {
  canViewAllUploads, uploaderOptions, uploadDateBounds, uploadHistoryQuery,
  loadUploaderOptions, canDeleteOwnUpload, uploadTimeSaudi,
} from '../src/lib/uploadHistory.js'

// Exercise the installed Supabase query builder, with a synthetic HTTP transport.
function transport(respond = () => ({ rows: [], total: 0 })) {
  const calls = []
  const client = createClient('https://fixture.invalid', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, init) => {
      const params = new URL(url).searchParams
      calls.push({ params, headers: new Headers(init.headers), method: init.method })
      const { rows, total, failure } = respond(params, calls.length)
      return new Response(JSON.stringify(failure ? { message: 'Synthetic failure' } : rows), {
        status: failure ? 500 : 200, headers: { 'Content-Type': 'application/json', 'Content-Range': `0-${Math.max(0, rows.length - 1)}/${total}` },
      })
    } },
  })
  return { client, calls }
}
const base = { projectId: 'tenant-a', role: 'owner' }

test('all three management roles see all states and a tenant-scoped, ordered page', async () => {
  for (const role of ['owner', 'accountant', 'superadmin']) {
    const { client, calls } = transport(() => ({ rows: [{ status: 'approved' }], total: 1250 }))
    const result = await uploadHistoryQuery(client, { ...base, role, page: 42 })
    assert.equal(result.count, 1250)
    assert.equal(result.data[0].status, 'approved')
    const { params, headers } = calls[0]
    assert.equal(params.get('project_id'), 'eq.tenant-a')
    assert.equal(params.get('offset'), '1050')
    assert.equal(params.get('limit'), '25')
    assert.equal(params.get('order'), 'uploaded_at.desc,id.desc')
    assert.equal(params.has('status'), false)
    assert.equal(params.has('uploaded_by_name'), false)
    assert.match(headers.get('prefer'), /count=exact/)
    assert.doesNotMatch(params.get('select'), /analysis_result|file_data/)
  }
})

test('staff or missing tenant cannot invoke the management history loader', async () => {
  const { client, calls } = transport()
  for (const role of ['purchasing', 'cashier', null, 'unknown']) {
    assert.equal(canViewAllUploads(role), false)
    assert.throws(() => uploadHistoryQuery(client, { ...base, role }))
    await assert.rejects(loadUploaderOptions(client, { ...base, role }))
  }
  assert.throws(() => uploadHistoryQuery(client, { ...base, projectId: null }))
  assert.equal(calls.length, 0)
})

test('both date endpoints include the Saudi day and reject reversed/invalid intervals', async () => {
  assert.deepEqual(uploadDateBounds('2026-11-02', '2026-11-02'), {
    from: '2026-11-01T21:00:00.000Z', until: '2026-11-02T21:00:00.000Z',
  })
  assert.deepEqual(uploadDateBounds(), { from: null, until: null })
  for (const dates of [['2026-02-30', ''], ['bad', ''], ['2026-11-03', '2026-11-02']]) assert.throws(() => uploadDateBounds(...dates))
  const { client, calls } = transport()
  await uploadHistoryQuery(client, { ...base, from: '2026-11-02', to: '2026-11-02' })
  assert.deepEqual(calls[0].params.getAll('uploaded_at'), ['gte.2026-11-01T21:00:00.000Z', 'lt.2026-11-02T21:00:00.000Z'])
  assert.match(uploadTimeSaudi('2026-11-01T21:05:00Z'), /02.*11.*2026/)
})

test('employee ID, role and approved-state filters combine without filtering just one role name', async () => {
  const { client, calls } = transport()
  await uploadHistoryQuery(client, { ...base, uploader: { id: 'employee-2' }, uploaderRole: 'purchasing', status: 'approved' })
  const { params } = calls[0]
  assert.equal(params.get('created_by_user_id'), 'eq.employee-2')
  assert.equal(params.get('status'), 'eq.approved')
  assert.equal(params.get('or'), '(created_by_role.eq.purchasing,and(created_by_role.is.null,uploaded_by.eq.purchasing))')
})

test('same names remain distinct; latest stamped name wins; legacy remains attributable', () => {
  const rows = [
    { created_by_user_id: 'one', created_by_name: 'اسم محدث', created_by_role: 'purchasing' },
    { created_by_user_id: 'two', created_by_name: 'اسم محدث', created_by_role: 'purchasing' },
    { created_by_user_id: 'one', created_by_name: 'اسم سابق', created_by_role: 'cashier' },
    { uploaded_by_name: 'رافع قديم', uploaded_by: 'owner' },
  ]
  const options = uploaderOptions(rows)
  assert.equal(options.length, 3)
  assert.equal(options.filter(o => o.name === 'اسم محدث').length, 2)
  assert.equal(options.find(o => o.id === 'one').role, 'purchasing')
  assert.equal(options.find(o => o.name === 'رافع قديم').legacy, true)
})

test('old names are safely quoted and their filters preserve the selected role', async () => {
  const { client, calls } = transport()
  await uploadHistoryQuery(client, { ...base, uploaderRole: 'owner', uploader: { name: 'اسم,"اختبار\\قديم', role: 'owner' } })
  const { params } = calls[0]
  assert.equal(params.get('created_by_user_id'), 'is.null')
  assert.equal(params.getAll('or').length, 3)
  assert.match(params.getAll('or')[1], /created_by_name\.eq\."اسم,\\"اختبار\\\\قديم"/)
})

test('uploader discovery crosses 1000 rows and retains the uploader found only on the last page', async () => {
  const many = Array.from({ length: 1001 }, (_, n) => ({ created_by_user_id: n === 1000 ? 'old-staff' : 'current-staff', created_by_name: n === 1000 ? 'رافع سابق' : 'رافع حالي' }))
  const { client, calls } = transport(params => {
    const start = Number(params.get('offset'))
    return { rows: many.slice(start, start + Number(params.get('limit'))), total: many.length }
  })
  const options = await loadUploaderOptions(client, base)
  assert.equal(options.length, 2)
  assert.ok(options.some(o => o.id === 'old-staff'))
  assert.equal(calls.length, 3)
  assert.ok(calls.every(c => c.params.get('project_id') === 'eq.tenant-a'))
})

test('loading errors are not represented as a successful empty uploader list', async () => {
  const { client } = transport(() => ({ rows: [], total: 0, failure: true }))
  await assert.rejects(loadUploaderOptions(client, base))
})

test('viewing another uploader never enables deleting their records or an approved record', () => {
  assert.equal(canDeleteOwnUpload({ status: 'analyzed', created_by_user_id: 'other', uploaded_by_name: 'same-name' }, 'self', 'same-name'), false)
  assert.equal(canDeleteOwnUpload({ status: 'approved', created_by_user_id: 'self' }, 'self', 'name'), false)
  assert.equal(canDeleteOwnUpload({ status: 'analyzed', created_by_user_id: 'self' }, 'self', 'name'), true)
  assert.equal(canDeleteOwnUpload({ status: 'analyzed', uploaded_by_name: 'name' }, 'self', 'name'), true)
  assert.equal(canDeleteOwnUpload({ status: 'analyzed', created_by_user_id: 'self' }, null, 'name'), false)
})
