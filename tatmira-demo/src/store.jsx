import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createInitialState, migrate, reduce, todayISO } from './lib/ledger.js'
import { clearFiles, getFile } from './lib/files.js'

const STORAGE_KEY = 'tatmira-demo:v1'
const StoreContext = createContext(null)

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

  // يُطبَّق الإجراء على أحدث حالة فوراً (ref) — الضغطة الثانية ترى نتيجة الأولى
  const dispatch = useCallback(action => {
    const result = reduce(ref.current, { today: todayISO(), ...action })
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
    await clearFiles()
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      setStorageOk(true)
    } catch {
      setStorageOk(false)
    }
  }, [state])

  return (
    <StoreContext.Provider value={{ state, dispatch, reset, storageOk }}>
      {children}
    </StoreContext.Provider>
  )
}

export function useStore() {
  return useContext(StoreContext)
}

/** رابط محلي مؤقت (blob:) لملف محفوظ على الجهاز */
export function useFileUrl(fileId) {
  const [info, setInfo] = useState({ url: null, blob: null, missing: false })
  useEffect(() => {
    let url = null
    let cancelled = false
    setInfo({ url: null, blob: null, missing: false })
    if (!fileId) return
    getFile(fileId).then(blob => {
      if (cancelled) return
      if (!blob) return setInfo({ url: null, blob: null, missing: true })
      url = URL.createObjectURL(blob)
      setInfo({ url, blob, missing: false })
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [fileId])
  return info
}
