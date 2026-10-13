// تنبيه المغادرة مع تعديلات غير محفوظة: حفظ ومغادرة، أو تجاهل التعديلات، أو البقاء.
import React, { useEffect, useState } from 'react'
import { useBlocker } from 'react-router-dom'
import { Save } from 'lucide-react'
import { Button, Dialog, Note } from '../ui/components.jsx'

/** `onSave` يعيد نصًا بسبب الفشل، أو لا شيء عند النجاح. */
export function useUnsavedGuard(dirty, onSave) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)
  const [error, setError] = useState('')
  useEffect(() => { if (blocker.state !== 'blocked') setError('') }, [blocker.state])
  // إعادة التحميل أو إغلاق النافذة: تنبيه المتصفح نفسه
  useEffect(() => {
    if (!dirty) return
    const warn = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  return (
    <Dialog open={blocker.state === 'blocked'} onClose={() => blocker.reset?.()} title="تعديلات لم تُحفظ"
      description="غيّرت بيانات في هذه الصفحة ولم تحفظها بعد."
      footer={<>
        <Button variant="primary" icon={Save} onClick={() => { const failed = onSave(); if (failed) setError(failed); else blocker.proceed?.() }}>حفظ ومغادرة</Button>
        <Button onClick={() => blocker.proceed?.()}>تجاهل التعديلات</Button>
        <Button variant="quiet" onClick={() => blocker.reset?.()}>البقاء</Button>
      </>}>
      {error ? <Note tone="error" title="تعذّر الحفظ">{error}</Note> : <p className="ts-field-hint" style={{ fontSize: 13 }}>الحفظ هنا محاكاة داخل هذا المتصفح.</p>}
    </Dialog>
  )
}
