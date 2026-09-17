import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { DOC_KINDS, newId } from '../lib/ledger.js'
import { putFile } from '../lib/files.js'
import { Button, Card, Notice, PageTitle, NAVY, TEAL } from '../components/ui.jsx'

const OPTIONS = [
  { kind: 'sale',     icon: '🧾', hint: 'فاتورة آجلة لنقطة بيع — تثبت كاملة على العميل' },
  { kind: 'payment',  icon: '💸', hint: 'إيصال تحويل أو سند قبض من نقطة بيع' },
  { kind: 'purchase', icon: '🛒', hint: 'مواد أو مصروف مدفوع مباشرة' },
]
const MAX_BYTES = 15 * 1024 * 1024

export default function Upload() {
  const { dispatch } = useStore()
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [kind, setKind] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const draftId = useRef(newId('doc'))

  useEffect(() => {
    if (!file) return setPreview(null)
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function pick(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const ok = f.type.startsWith('image/') || f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
    if (!ok) return setError('اختر صورة أو ملف PDF')
    if (f.size > MAX_BYTES) return setError('الملف أكبر من 15 ميجابايت')
    setError('')
    setFile(f)
  }

  async function save() {
    if (!kind) return setError('اختر نوع المستند')
    if (!file) return setError('اختر الملف')
    const fileId = `file-${draftId.current}`
    await putFile(fileId, file)
    const r = dispatch({
      type: 'DOC_ADD', id: draftId.current, kind,
      file: { id: fileId, name: file.name, type: file.type || 'application/pdf', size: file.size },
    })
    if (r.error) return setError(r.error)
    navigate(`/documents/${draftId.current}`)
  }

  const isPdf = file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))

  return (
    <div>
      <PageTitle title="رفع مستند" subtitle="اختر النوع ثم الصورة أو ملف PDF" />

      <div className="grid sm:grid-cols-3 gap-2 mb-4">
        {OPTIONS.map(o => (
          <button key={o.kind} onClick={() => { setKind(o.kind); setError('') }}
            className="text-right p-4 rounded-2xl border-2 bg-white transition-all"
            style={{ borderColor: kind === o.kind ? TEAL : '#D4E8E6', background: kind === o.kind ? '#E8F5F4' : '#fff' }}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{o.icon}</span>
              <div>
                <div className="font-extrabold" style={{ color: NAVY }}>{DOC_KINDS[o.kind]}</div>
                <div className="text-xs mt-0.5" style={{ color: '#5A7A8A' }}>{o.hint}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      <Card className="p-4">
        <input ref={inputRef} type="file" accept="image/*,application/pdf,.pdf" className="hidden" onChange={pick} />
        {!file ? (
          <button onClick={() => inputRef.current?.click()} className="w-full py-10 rounded-2xl border-2 border-dashed text-center"
            style={{ borderColor: '#D4E8E6', color: '#5A7A8A' }}>
            <div className="text-3xl mb-2">📎</div>
            <div className="font-bold" style={{ color: NAVY }}>اختر صورة أو PDF</div>
            <div className="text-xs mt-1">من الكاميرا أو الملفات</div>
          </button>
        ) : (
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-sm font-bold truncate">{isPdf ? '📄' : '🖼️'} {file.name}</span>
              <Button variant="secondary" className="!py-1.5 !text-xs" onClick={() => inputRef.current?.click()}>تغيير الملف</Button>
            </div>
            {preview && (isPdf
              ? <object data={preview} type="application/pdf" className="w-full h-72 rounded-xl border border-border bg-white">
                  <div className="p-4 text-sm text-center">لا يمكن معاينة PDF هنا — <a href={preview} target="_blank" rel="noopener" className="underline">افتح الملف</a></div>
                </object>
              : <img src={preview} alt="معاينة" className="w-full max-h-80 object-contain rounded-xl border border-border bg-white" />)}
          </div>
        )}

        <Notice tone="info" className="mt-3">
          في هذا النموذج لا يُرسل الملف لأي خادم ولا يقرؤه الذكاء الاصطناعي. ستظهر بيانات تجريبية ثابتة تعدّلها بنفسك، ويبقى المستند بانتظار المراجعة.
        </Notice>
        {error && <Notice tone="error" className="mt-3">{error}</Notice>}

        <Button className="w-full mt-3 !py-3" onClick={save} disabled={!kind || !file}>حفظ ومتابعة للمراجعة</Button>
      </Card>
    </div>
  )
}
