import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createInitialState, migrate, reduce, todayISO } from './lib/ledger.js'
import { clearFiles, getFile } from './lib/files.js'
import { OWNER_ID } from './lib/permissions.js'

const STORAGE_KEY = 'tatmira-demo:v1'
// الموظف المعروض حالياً في «معاينة الأدوار» — محاكاة، ليست جلسة دخول
const ACTING_KEY = 'tatmira-demo:acting'
export const StoreContext = createContext(null)

function load() {
  const today = todayISO()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return migrate(raw ? JSON.parse(raw) : null, today)
  } catch {
    return createInitialState({ today })
  }
}

export function StoreProvider({ children }) {
  const ref = useRef(null)
  if (ref.current === null) ref.current = load()
  const [state, setState] = useState(ref.current)
  const [storageOk, setStorageOk] = useState(true)
  const actingRef = useRef(null)
  if (actingRef.current === null) {
    try { actingRef.current = localStorage.getItem(ACTING_KEY) || OWNER_ID } catch { actingRef.current = OWNER_ID }
  }
  const [actingId, setActingId] = useState(actingRef.current)

  const setActing = useCallback(id => {
    actingRef.current = id
    setActingId(id)
    try { localStorage.setItem(ACTING_KEY, id) } catch {}
  }, [])

  // يُطبَّق الإجراء على أحدث حالة فوراً (ref) — الضغطة الثانية ترى نتيجة الأولى
  const dispatch = useCallback(action => {
    const result = reduce(ref.current, { today: todayISO(), actorId: actingRef.current, ...action })
    if (result.state !== ref.current) {
      ref.current = result.state
      setState(result.state)
    }
    return result
  }, [])

  const reset = useCallback(async () => {
    const fresh = createInitialState({ today: todayISO() })
    ref.current = fresh
    setState(fresh)
    setActing(OWNER_ID)
    await clearFiles()
  }, [setActing])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      setStorageOk(true)
    } catch {
      setStorageOk(false)
    }
  }, [state])

  // موظف محذوف أو غير معروف ← المالك
  const actor = state.employees.find(e => e.id === actingId) || state.employees.find(e => e.id === OWNER_ID)

  return (
    <StoreContext.Provider value={{ state, dispatch, reset, storageOk, actor, setActing, remote: false }}>
      {children}
    </StoreContext.Provider>
  )
}

export function useStore() {
  return useContext(StoreContext)
}

/** رابط محلي مؤقت (blob:) لملف محفوظ على الجهاز */
export function useFileUrl(fileId) {
  const store = useStore()
  const [info, setInfo] = useState({ url: null, blob: null, missing: false })
  useEffect(() => {
    let url = null
    let cancelled = false
    setInfo({ url: null, blob: null, missing: false })
    if (!fileId) return
    const loader = store?.fetchFile ? store.fetchFile : getFile
    loader(fileId).then(blob => {
      if (cancelled) return
      if (!blob) return setInfo({ url: null, blob: null, missing: true })
      url = URL.createObjectURL(blob)
      setInfo({ url, blob, missing: false })
    }).catch(() => { if (!cancelled) setInfo({ url: null, blob: null, missing: true }) })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [fileId, store?.fetchFile])
  return info
}
