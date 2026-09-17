import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { DOC_KINDS, newId } from '../lib/ledger.js'
import { putFile } from '../lib/files.js'
import { can, isOwner } from '../lib/permissions.js'
import { Button, Card, Field, Notice, PageTitle, Select, NAVY, TEAL } from '../components/ui.jsx'

const OPTIONS = [
  { kind: 'sale',     icon: '🧾', label: DOC_KINDS.sale,            hint: 'فاتورة آجلة لنقطة بيع — تثبت كاملة على العميل' },
  { kind: 'payment',  icon: '💸', label: DOC_KINDS.payment,         hint: 'إيصال تحويل أو سند قبض من نقطة بيع' },
  { kind: 'purchase', icon: '📑', label: 'إضافة مستند مصروفات',    hint: 'مشتريات، إيجار، رواتب، كهرباء، صيانة وغيرها' },
]
const MAX_BYTES = 15 * 1024 * 1024

export default function Upload() {
  const { state, dispatch, actor } = useStore()
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const options = OPTIONS.filter(o => can(actor, 'upload', o.kind))
  const owner = isOwner(actor)
  const [kind, setKind] = useState(options.length === 1 ? options[0].kind : '')
  const [customerId, setCustomerId] = useState('')
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

  const needsCustomer = kind === 'sale' || kind === 'payment'
  // الموظف المحدود لا يعدّل المستند بعد رفعه، فاختيار العميل إلزامي عنده
  const customerRequired = needsCustomer && !owner

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
    if (customerRequired && !customerId) return setError('اختر العميل')
    const fileId = `file-${draftId.current}`
    await putFile(fileId, file)
    const r = dispatch({
      type: 'DOC_ADD', id: draftId.current, kind,
      file: { id: fileId, name: file.name, type: file.type || 'application/pdf', size: file.size },
      fields: needsCustomer && customerId ? { customerId } : {},
    })
    if (r.error) return setError(r.error)
    navigate(`/documents/${draftId.current}`, { state: { justUploaded: true } })
  }

  const isPdf = file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))

  if (!options.length) {
    return <Card className="p-6 text-center text-sm" style={{ color: '#5A7A8A' }}>لا توجد أنواع مستندات مسموحة لك — راجع المالك</Card>
  }

  return (
    <div>
      <PageTitle title="رفع مستند" subtitle={owner ? 'اختر النوع ثم الصورة أو ملف PDF' : 'يُرسل المستند للمالك لمراجعته واعتماده'} />

      <div className={`grid gap-2 mb-4 ${options.length > 1 ? 'sm:grid-cols-3' : ''}`}>
        {options.map(o => (
          <button key={o.kind} onClick={() => { setKind(o.kind); setError('') }}
            className="text-right p-4 rounded-2xl border-2 bg-white transition-all"
            style={{ borderColor: kind === o.kind ? TEAL : '#D4E8E6', background: kind === o.kind ? '#E8F5F4' : '#fff' }}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{o.icon}</span>
              <div>
                <div className="font-extrabold" style={{ color: NAVY }}>{o.label}</div>
                <div className="text-xs mt-0.5" style={{ color: '#5A7A8A' }}>{o.hint}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      <Card className="p-4">
        {needsCustomer && (
          <Field label={customerRequired ? 'العميل' : 'العميل (يمكن اختياره عند المراجعة)'} className="mb-3">
            <Select value={customerId} onChange={e => { setCustomerId(e.target.value); setError('') }} aria-label="العميل">
              <option value="">— اختر العميل —</option>
              {state.customers.filter(c => !c.archived).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        )}

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
          في هذا النموذج لا يُرسل الملف لأي خادم ولا يقرؤه الذكاء الاصطناعي. ستظهر بيانات تجريبية ثابتة، ويبقى المستند بانتظار مراجعة المالك.
        </Notice>
        {error && <Notice tone="error" className="mt-3">{error}</Notice>}

        <Button className="w-full mt-3 !py-3" onClick={save} disabled={!kind || !file || (customerRequired && !customerId)}>
          {owner ? 'حفظ ومتابعة للمراجعة' : 'إرسال للمراجعة'}
        </Button>
      </Card>
    </div>
  )
}
