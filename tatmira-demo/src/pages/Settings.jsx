import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { newId } from '../lib/ledger.js'
import { displayWhatsapp } from '../lib/whatsapp.js'
import { Badge, Button, Card, Field, Notice, PageTitle, Select, TextInput, NAVY } from '../components/ui.jsx'
import CustomerForm from '../components/CustomerForm.jsx'

function Section({ title, subtitle, children, action }) {
  return (
    <Card className="p-4 mb-3">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h2 className="font-extrabold" style={{ color: NAVY }}>{title}</h2>
          {subtitle && <p className="text-xs mt-0.5" style={{ color: '#8FAAAA' }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  )
}

function LabInfo() {
  const { state, dispatch } = useStore()
  const [lab, setLab] = useState(state.lab)
  const [saved, setSaved] = useState(false)
  useEffect(() => setLab(state.lab), [state.lab])
  const set = (k, v) => { setLab(l => ({ ...l, [k]: v })); setSaved(false) }
  function save() {
    if (!lab.name.trim()) return
    dispatch({ type: 'LAB_UPDATE', patch: { ...lab, name: lab.name.trim() } })
    setSaved(true)
  }
  return (
    <Section title="بيانات المعمل">
      <div className="grid sm:grid-cols-2 gap-2">
        <Field label="اسم المعمل" error={!lab.name.trim() ? 'الاسم مطلوب' : ''}><TextInput value={lab.name} onChange={e => set('name', e.target.value)} /></Field>
        <Field label="المدينة"><TextInput value={lab.city} onChange={e => set('city', e.target.value)} /></Field>
        <Field label="هاتف المعمل"><TextInput value={lab.phone} onChange={e => set('phone', e.target.value)} dir="ltr" className="text-left" inputMode="tel" /></Field>
        <Field label="الرقم الضريبي (للعرض فقط)"><TextInput value={lab.vatNumber} onChange={e => set('vatNumber', e.target.value)} dir="ltr" className="text-left" inputMode="numeric" /></Field>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <Button onClick={save} disabled={!lab.name.trim()}>حفظ</Button>
        {saved && <span className="text-sm text-emerald-700 font-bold">حُفظ</span>}
      </div>
    </Section>
  )
}

function CustomersSection() {
  const { state } = useStore()
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const active = state.customers.filter(c => !c.archived)
  return (
    <Section title="العملاء وأرقام واتساب" subtitle={`${active.length} عميل نشط`}
      action={<Button className="!py-1.5 !text-xs" onClick={() => setAdding(true)}>+ عميل</Button>}>
      <div className="divide-y divide-border">
        {active.map(c => (
          <div key={c.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <Link to={`/customers/${c.id}`} className="font-bold text-sm hover:underline">{c.name}</Link>
              <div className="text-xs" style={{ color: '#8FAAAA' }}>{c.whatsapp ? <span className="num">{displayWhatsapp(c.whatsapp)}</span> : 'بلا رقم'}</div>
            </div>
            <Button variant="secondary" className="!py-1 !px-2.5 !text-xs" onClick={() => setEditing(c)}>تعديل</Button>
          </div>
        ))}
      </div>
      <CustomerForm open={!!editing} customer={editing} onClose={() => setEditing(null)} />
      <CustomerForm open={adding} onClose={() => setAdding(false)} />
    </Section>
  )
}

/** قائمة عناصر بنوعين قابلة للإضافة والتعديل والأرشفة */
function EditableList({ title, subtitle, items, kinds, saveType, archiveType, idPrefix }) {
  const { dispatch } = useStore()
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  function save() {
    const r = dispatch({ type: saveType, ...draft })
    if (r.error) return setError(r.error)
    setDraft(null)
    setError('')
  }
  const visible = items.filter(i => showArchived || !i.archived)

  return (
    <Section title={title} subtitle={subtitle}
      action={<Button className="!py-1.5 !text-xs" onClick={() => { setDraft({ id: newId(idPrefix), name: '', kind: kinds[0][0], isNew: true }); setError('') }}>+ إضافة</Button>}>
      {draft && (
        <div className="rounded-xl border border-border p-3 mb-3 bg-surface space-y-2">
          <div className="grid grid-cols-5 gap-2">
            <TextInput className="col-span-3" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="الاسم" autoFocus />
            <Select className="col-span-2" value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value })}>
              {kinds.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </Select>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex gap-2">
            <Button onClick={save} className="!py-1.5">حفظ</Button>
            <Button variant="secondary" onClick={() => setDraft(null)} className="!py-1.5">إلغاء</Button>
          </div>
        </div>
      )}
      {kinds.map(([kind, label]) => (
        <div key={kind} className="mb-2">
          <div className="text-xs font-bold mb-1" style={{ color: '#5A7A8A' }}>{label}</div>
          <div className="divide-y divide-border">
            {visible.filter(i => i.kind === kind).map(i => (
              <div key={i.id} className="flex items-center justify-between gap-2 py-2">
                <span className={`text-sm ${i.archived ? 'line-through text-slate-400' : ''}`}>{i.name} {i.archived && <Badge>مؤرشف</Badge>}</span>
                <div className="flex gap-1.5">
                  {!i.archived && <Button variant="secondary" className="!py-1 !px-2.5 !text-xs" onClick={() => { setDraft({ id: i.id, name: i.name, kind: i.kind }); setError('') }}>تعديل</Button>}
                  <Button variant="secondary" className="!py-1 !px-2.5 !text-xs" onClick={() => dispatch({ type: archiveType, id: i.id, archived: !i.archived })}>
                    {i.archived ? 'استرجاع' : 'أرشفة'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {items.some(i => i.archived) && (
        <button onClick={() => setShowArchived(v => !v)} className="text-xs font-bold underline" style={{ color: '#4A9E97' }}>
          {showArchived ? 'إخفاء المؤرشف' : 'عرض المؤرشف'}
        </button>
      )}
    </Section>
  )
}

export default function Settings() {
  const { state, reset } = useStore()
  const [resetDone, setResetDone] = useState(false)

  async function doReset() {
    if (!confirm('مسح كل بيانات النموذج على هذا الجهاز والبدء من جديد؟')) return
    await reset()
    setResetDone(true)
  }

  return (
    <div>
      <PageTitle title="الإعدادات" subtitle="كل التعديلات من هنا دون الحاجة لمبرمج" />
      <LabInfo />
      <CustomersSection />
      <EditableList title="حسابات الاستلام والدفع" subtitle="تستقبل السداد وتُدفع منها المشتريات"
        items={state.accounts} kinds={[['cash', 'نقد'], ['bank', 'بنك']]} saveType="ACCOUNT_SAVE" archiveType="ACCOUNT_ARCHIVE" idPrefix="acc" />
      <EditableList title="تصنيفات المشتريات والمصروفات" subtitle="المواد المباشرة منفصلة عن المصروفات التشغيلية في لوحة المالك"
        items={state.categories} kinds={[['direct', 'مواد مباشرة'], ['operating', 'تشغيلية']]} saveType="CATEGORY_SAVE" archiveType="CATEGORY_ARCHIVE" idPrefix="cat" />

      <Section title="بيانات النموذج" subtitle="البيانات محفوظة في متصفح هذا الجهاز فقط">
        <Button variant="danger" onClick={doReset}>إعادة ضبط النموذج</Button>
        {resetDone && <Notice tone="success" className="mt-2">أُعيد النموذج لبياناته التجريبية الأولى</Notice>}
      </Section>
    </div>
  )
}
