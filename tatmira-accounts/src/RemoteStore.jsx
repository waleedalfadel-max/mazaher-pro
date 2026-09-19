import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StoreContext } from '../../tatmira-demo/src/store.jsx'
import { Card } from '../../tatmira-demo/src/components/ui.jsx'
import { createMutationCoordinator } from './mutation-coordinator.js'

const EMPTY_ARRAYS = ['documents', 'customers', 'accounts', 'categories', 'expenseGroups', 'taxSettings', 'invoices', 'payments', 'purchases', 'creditApplications']
const SESSION_ERRORS = new Set(['INVALID_SESSION', 'AUTH_REQUIRED', 'OWNER_ONLY', 'TENANT_UNAVAILABLE'])

function normalizedState(data, actor, employees) {
  const next = { version: 4, ...(data || {}) }
  for (const key of EMPTY_ARRAYS) if (!Array.isArray(next[key])) next[key] = []
  next.counters ||= {}
  next.lab ||= { name: 'تتميرا', customerLabel: 'عميل' }
  next.employees = actor.role === 'owner'
    ? [{ ...actor, docKinds: ['sale', 'payment', 'purchase'] }, ...employees.map(e => ({ ...e, docKinds: [] }))]
    : [{ ...actor, docKinds: [] }]
  return next
}

/**
 * Bridges the authenticated Finance gateway to the existing Tatmira screens.
 * The server remains authoritative: every successful mutation is followed by
 * a fresh projection, and a conflict always discards the stale client view.
 */
export default function RemoteStore({ actor, financeApi, accountApi, onExpired, children }) {
  const [snapshot, setSnapshot] = useState(null)
  const [employees, setEmployees] = useState([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busyCount, setBusyCount] = useState(0)
  const revisionRef = useRef(0)
  const aliveRef = useRef(true)

  const expire = useCallback((e) => {
    if (!SESSION_ERRORS.has(e?.code)) return false
    onExpired(e)
    return true
  }, [onExpired])

  const loadEmployees = useCallback(async () => {
    if (actor.role !== 'owner') return []
    const result = await accountApi('employees')
    if (aliveRef.current) setEmployees(result.employees || [])
    return result.employees || []
  }, [accountApi, actor.role])

  const load = useCallback(async ({ quiet = false } = {}) => {
    try {
      const result = await financeApi('read')
      if (!aliveRef.current) return result
      revisionRef.current = result.revision
      setSnapshot(result)
      if (!quiet) setError('')
      return result
    } catch (e) {
      if (!expire(e) && aliveRef.current && !quiet) setError(e.message)
      throw e
    }
  }, [expire, financeApi])

  useEffect(() => {
    aliveRef.current = true
    setBusyCount(c => c + 1)
    Promise.all([load(), loadEmployees()])
      .catch(e => { if (!expire(e) && aliveRef.current) setError(e.message) })
      .finally(() => { if (aliveRef.current) setBusyCount(c => Math.max(0, c - 1)) })
    return () => { aliveRef.current = false }
  }, [load, loadEmployees, expire])

  const coordinator = useMemo(() => createMutationCoordinator({
    getRevision: () => revisionRef.current,
    setRevision: revision => { revisionRef.current = revision },
    send: descriptor => financeApi('mutate', {
      command: descriptor.command,
      requestId: descriptor.requestId,
      revision: descriptor.revision,
    }, descriptor.file),
    refresh: () => load(),
    onStart: () => {
      if (!aliveRef.current) return
      setBusyCount(c => c + 1)
      setError('')
      setMessage('')
    },
    onFinish: () => { if (aliveRef.current) setBusyCount(c => Math.max(0, c - 1)) },
    onSuccess: command => { if (aliveRef.current) setMessage(command.type === 'DOC_ADD' ? 'تم رفع المستند للمراجعة' : 'تم الحفظ') },
    onError: e => { expire(e); if (aliveRef.current) setError(e.message) },
  }), [expire, financeApi, load])
  const dispatch = coordinator.dispatch

  useEffect(() => {
    const refresh = () => {
      if (!coordinator.pendingCount()) load({ quiet: true }).catch(() => {})
    }
    const timer = setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [coordinator, load])

  const uploadDocument = useCallback((kind, customerId, file) => dispatch({ type: 'DOC_ADD', kind, customerId }, file), [dispatch])
  const fetchFile = useCallback(async documentId => financeApi('file', { documentId }), [financeApi])
  const refreshEmployees = useCallback(async () => {
    try { await loadEmployees(); setError('') } catch (e) { expire(e); setError(e.message) }
  }, [expire, loadEmployees])

  const state = useMemo(() => normalizedState(snapshot?.data, actor, employees), [snapshot, actor, employees])
  const value = useMemo(() => ({
    state,
    actor,
    dispatch,
    uploadDocument,
    fetchFile,
    remote: true,
    storageOk: true,
    busy: busyCount > 0,
    error,
    message,
    employees,
    refreshEmployees,
    accountApi,
    reset: async () => {},
    setActing: () => {},
  }), [state, actor, dispatch, uploadDocument, fetchFile, busyCount, error, message, employees, refreshEmployees, accountApi])

  if (!snapshot) {
    return <div dir="rtl" className="min-h-screen flex items-center justify-center p-4" style={{ background: '#F4F8F7' }}>
      <Card className="p-6 w-full max-w-md text-center">
        <div className="font-extrabold mb-2">{error || 'جارٍ تحميل مساحة العمل…'}</div>
        {error && <button className="px-4 py-2 rounded-xl font-bold" style={{ background: '#6EB7B0', color: '#fff' }} onClick={() => load().catch(() => {})}>إعادة المحاولة</button>}
      </Card>
    </div>
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
