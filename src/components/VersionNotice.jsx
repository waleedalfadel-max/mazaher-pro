import React, { useEffect, useRef, useState } from 'react'
import { RefreshCw, Save } from 'lucide-react'
import { Button, Dialog } from '../ui/components.jsx'
import { checkVersion, currentVersion, isStale, markStale, onStale } from '../lib/appVersion'
import { getUnsaved, onUnsaved } from '../lib/unsavedChanges'

// رسالة «صدر تحديث» للصفحة المفتوحة: تفحص الإصدار المنشور عند العودة إلى التبويب وعند عودة الاتصال وكل دقيقتين.
// لا تعيد التحميل من تلقاء نفسها؛ زر «تحديث الصفحة»، ومع تعديلات غير محفوظة يُعرض الحفظ أولًا.
const POLL_MS = Number(import.meta.env.VITE_VERSION_POLL_MS) || 120000

export default function VersionNotice() {
  const [stale, setStale] = useState(isStale())
  const [unsaved, setUnsavedState] = useState(getUnsaved())
  const [asking, setAsking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const busy = useRef(false)

  useEffect(() => onStale(() => setStale(true)), [])
  useEffect(() => onUnsaved(setUnsavedState), [])

  useEffect(() => {
    const current = currentVersion()
    if (!current) return undefined   // نسخة بلا رقم (لا تحدث في البناء): لا فحص
    const check = async () => {
      if (busy.current || isStale()) return
      busy.current = true
      try {
        const r = await checkVersion((...a) => fetch(...a), current)
        if (r.status === 'changed') markStale(r.remote)
      } finally { busy.current = false }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    const timer = setInterval(check, POLL_MS)
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', check); window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!stale) return null
  // إعادة التحميل بعد أن تُسجِّل الصفحة زوال التعديلات غير المحفوظة (لا يُعتمد على تنبيه المغادرة في المتصفح)
  const whenNothingUnsaved = async (ms = 2000) => { for (let t = 0; t < ms; t += 100) { if (!getUnsaved()) return true; await new Promise(r => setTimeout(r, 100)) } return !getUnsaved() }
  const reloadSoon = () => setTimeout(() => window.location.reload(), 300)
  const refresh = () => { if (unsaved) { setSaveFailed(false); setAsking(true) } else window.location.reload() }
  // «حفظ مسودة ثم تحديث»: لا تحديث إلا بعد نجاح حفظ مسودات كل المستندات المعدّلة؛ عند الفشل تبقى الصفحة والتعديلات ويُعرض «إعادة المحاولة»
  const saveThenRefresh = async () => {
    if (saving) return
    const entry = getUnsaved()
    if (!entry) { window.location.reload(); return }
    setSaving(true); setSaveFailed(false)
    let ok = false
    try { ok = (await entry.save?.()) === true } catch { ok = false }
    if (ok) ok = await whenNothingUnsaved()
    setSaving(false)
    if (ok) { setAsking(false); window.location.reload() } else setSaveFailed(true)
  }

  return (
    <>
      <div className="ts-version-notice" role="alert">
        <RefreshCw className="ts-icon" aria-hidden="true" />
        <div className="ts-version-notice__body">
          <strong>صدر تحديث للتطبيق</strong>
          <span>هذه الصفحة من إصدار أقدم. حدّث الصفحة لمتابعة العمل؛ لن يُحفظ أي تغيير جديد من هذه الصفحة قبل التحديث.</span>
          {unsaved && (
            <span className="ts-version-notice__unsaved">
              في المستند المفتوح تعديلات لم تُحفظ. اختر «حفظ مسودة ثم تحديث» لتبقى بعد التحديث.
            </span>
          )}
        </div>
        <Button variant="primary" icon={RefreshCw} onClick={refresh}>تحديث الصفحة</Button>
      </div>
      <Dialog open={asking} onClose={() => setAsking(false)} title="تعديلات لم تُحفظ"
        description="المسودة تُحفظ في هذه النافذة فقط وتعود بعد التحديث. التحديث دون حفظ يفقد التعديلات."
        footer={<>
          <Button variant="primary" icon={Save} disabled={saving} onClick={saveThenRefresh}>
            {saving ? 'جارٍ حفظ المسودة…' : saveFailed ? 'إعادة المحاولة: حفظ مسودة ثم تحديث' : 'حفظ مسودة ثم تحديث'}
          </Button>
          <Button onClick={() => { getUnsaved()?.discard?.(); setAsking(false); reloadSoon() }}>تحديث وتجاهل التعديلات</Button>
          <Button variant="quiet" onClick={() => setAsking(false)}>إلغاء</Button>
        </>}>
        {saveFailed && (
          <p className="ts-version-notice__error" role="alert">
            تعذّر حفظ المسودة في هذا المتصفح (مساحة التخزين ممتلئة أو غير متاحة)، فلم تُحدَّث الصفحة وتعديلاتك باقية فيها.
            أعد المحاولة؛ وإن استمر الفشل فلا تحدّث الصفحة قبل تدوين تعديلاتك.
          </p>
        )}
      </Dialog>
    </>
  )
}
