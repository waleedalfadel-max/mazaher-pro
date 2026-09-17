import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { newId } from '../lib/ledger.js'
import { displayWhatsapp } from '../lib/whatsapp.js'
import { Badge, Button, Card, Field, Modal, Notice, PageTitle, Select, TextInput, NAVY } from '../components/ui.jsx'
import CustomerForm from '../components/CustomerForm.jsx'
import { EXPENSE_KIND } from '../lib/expenses.js'
import { ROLES } from '../lib/permissions.js'

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

/** مجموعات المصروفات وتصنيفاتها الفرعية — تُستخدم في مستند المصروفات والتقارير */
function ExpenseGroupsSection() {
  const { state, dispatch } = useStore()
  const [groupDraft, setGroupDraft] = useState(null)
  const [catDraft, setCatDraft] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(() => new Set())
  const [showArchived, setShowArchived] = useState(false)

  const toggle = id => setOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const groups = state.expenseGroups.filter(g => showArchived || !g.archived)
  const activeGroups = state.expenseGroups.filter(g => !g.archived)

  function saveGroup() {
    const r = dispatch({ type: 'GROUP_SAVE', ...groupDraft })
    if (r.error) return setError(r.error)
    setGroupDraft(null)
  }
  function saveCategory() {
    const r = dispatch({ type: 'CATEGORY_SAVE', ...catDraft })
    if (r.error) return setError(r.error)
    setOpen(prev => new Set(prev).add(catDraft.groupId))
    setCatDraft(null)
  }
  const original = groupDraft && state.expenseGroups.find(g => g.id === groupDraft.id)
  const originalCat = catDraft && state.categories.find(c => c.id === catDraft.id)

  return (
    <Section title="مجموعات وتصنيفات المصروفات" subtitle="تظهر في مستند المصروفات وتقرير المصروفات. تعديلها لا يغيّر تصنيف المستندات المعتمدة سابقاً."
      action={<Button className="!py-1.5 !text-xs" onClick={() => { setGroupDraft({ id: newId('grp'), name: '', kind: 'operating' }); setError('') }}>+ مجموعة</Button>}>
      <div className="space-y-2">
        {groups.map(g => {
          const cats = state.categories.filter(c => c.groupId === g.id && (showArchived || !c.archived))
          const isOpen = open.has(g.id)
          return (
            <div key={g.id} className="rounded-xl border border-border overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2" style={{ background: g.kind === 'direct' ? '#eff6ff' : '#F4F8F7' }}>
                <button onClick={() => toggle(g.id)} aria-expanded={isOpen} className="flex-1 flex items-center gap-2 text-right min-w-0">
                  <span className="text-xs transition-transform" style={{ transform: isOpen ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>▶</span>
                  <span className={`font-bold text-sm truncate ${g.archived ? 'line-through text-slate-400' : ''}`} style={{ color: NAVY }}>{g.name}</span>
                  <Badge tone={g.kind === 'direct' ? 'approved' : 'neutral'}>{EXPENSE_KIND[g.kind]}</Badge>
                  <span className="text-[11px] shrink-0" style={{ color: '#8FAAAA' }}>{cats.length}</span>
                </button>
                {!g.archived && <Button variant="secondary" className="!py-1 !px-2 !text-xs" onClick={() => { setGroupDraft({ id: g.id, name: g.name, kind: g.kind }); setError('') }}>تعديل</Button>}
                <Button variant="secondary" className="!py-1 !px-2 !text-xs" onClick={() => dispatch({ type: 'GROUP_ARCHIVE', id: g.id, archived: !g.archived })}>{g.archived ? 'استرجاع' : 'أرشفة'}</Button>
              </div>
              {isOpen && (
                <div className="divide-y divide-border">
                  {cats.map(c => (
                    <div key={c.id} className="flex items-center justify-between gap-2 px-4 py-2 bg-white">
                      <span className={`text-sm ${c.archived ? 'line-through text-slate-400' : ''}`}>📌 {c.name}</span>
                      <div className="flex gap-1.5">
                        {!c.archived && <Button variant="secondary" className="!py-1 !px-2 !text-xs" onClick={() => { setCatDraft({ id: c.id, name: c.name, groupId: c.groupId }); setError('') }}>تعديل</Button>}
                        <Button variant="secondary" className="!py-1 !px-2 !text-xs" onClick={() => dispatch({ type: 'CATEGORY_ARCHIVE', id: c.id, archived: !c.archived })}>{c.archived ? 'استرجاع' : 'أرشفة'}</Button>
                      </div>
                    </div>
                  ))}
                  {!g.archived && (
                    <div className="px-4 py-2 bg-white">
                      <Button variant="secondary" className="!py-1 !px-2.5 !text-xs" onClick={() => { setCatDraft({ id: newId('cat'), name: '', groupId: g.id }); setError('') }}>+ تصنيف في {g.name}</Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {(state.expenseGroups.some(g => g.archived) || state.categories.some(c => c.archived)) && (
        <button onClick={() => setShowArchived(v => !v)} className="text-xs font-bold underline mt-2" style={{ color: '#4A9E97' }}>
          {showArchived ? 'إخفاء المؤرشف' : 'عرض المؤرشف'}
        </button>
      )}

      <Modal open={!!groupDraft} onClose={() => setGroupDraft(null)} title={original ? 'تعديل مجموعة' : 'إضافة مجموعة'}
        footer={<><Button variant="secondary" onClick={() => setGroupDraft(null)}>إلغاء</Button><Button onClick={saveGroup}>حفظ</Button></>}>
        {groupDraft && (
          <div className="space-y-3">
            <Field label="اسم المجموعة"><TextInput value={groupDraft.name} onChange={e => setGroupDraft({ ...groupDraft, name: e.target.value })} placeholder="مثال: التسويق" autoFocus /></Field>
            <Field label="النوع">
              <Select value={groupDraft.kind} onChange={e => setGroupDraft({ ...groupDraft, kind: e.target.value })} aria-label="نوع المجموعة">
                <option value="direct">{EXPENSE_KIND.direct}</option>
                <option value="operating">{EXPENSE_KIND.operating}</option>
              </Select>
            </Field>
            {original && original.kind !== groupDraft.kind && <Notice tone="warning">تغيير النوع يطبَّق على المستندات الجديدة فقط؛ المعتمد سابقاً يبقى كما هو.</Notice>}
            {error && <Notice tone="error">{error}</Notice>}
          </div>
        )}
      </Modal>

      <Modal open={!!catDraft} onClose={() => setCatDraft(null)} title={originalCat ? 'تعديل تصنيف' : 'إضافة تصنيف'}
        footer={<><Button variant="secondary" onClick={() => setCatDraft(null)}>إلغاء</Button><Button onClick={saveCategory}>حفظ</Button></>}>
        {catDraft && (
          <div className="space-y-3">
            <Field label="اسم التصنيف"><TextInput value={catDraft.name} onChange={e => setCatDraft({ ...catDraft, name: e.target.value })} placeholder="مثال: إعلانات" autoFocus /></Field>
            <Field label="المجموعة">
              <Select value={catDraft.groupId} onChange={e => setCatDraft({ ...catDraft, groupId: e.target.value })} aria-label="مجموعة التصنيف">
                {activeGroups.map(g => <option key={g.id} value={g.id}>{g.name} — {EXPENSE_KIND[g.kind]}</option>)}
              </Select>
            </Field>
            {originalCat && originalCat.groupId !== catDraft.groupId && <Notice tone="warning">النقل يطبَّق على المستندات الجديدة فقط؛ المعتمد سابقاً يبقى في مجموعته.</Notice>}
            {error && <Notice tone="error">{error}</Notice>}
          </div>
        )}
      </Modal>
    </Section>
  )
}

function EmployeesCard() {
  const { state } = useStore()
  const active = state.employees.filter(e => e.active)
  return (
    <Section title="الموظفون والصلاحيات" subtitle="إضافة موظف وتحديد ما يرفعه وتعطيله — محاكاة بلا تسجيل دخول"
      action={<Link to="/settings/employees"><Button className="!py-1.5 !text-xs">إدارة</Button></Link>}>
      <div className="flex flex-wrap gap-1.5">
        {state.employees.map(e => (
          <Badge key={e.id} tone={e.active ? 'neutral' : 'rejected'}>{e.name} — {ROLES[e.role]?.label}{e.active ? '' : ' (معطّل)'}</Badge>
        ))}
      </div>
      <div className="text-[11px] mt-2" style={{ color: '#8FAAAA' }}>{active.length} موظف نشط</div>
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
      <EmployeesCard />
      <EditableList title="حسابات الاستلام والدفع" subtitle="تستقبل السداد وتُدفع منها المصروفات"
        items={state.accounts} kinds={[['cash', 'نقد'], ['bank', 'بنك']]} saveType="ACCOUNT_SAVE" archiveType="ACCOUNT_ARCHIVE" idPrefix="acc" />
      <ExpenseGroupsSection />

      <Section title="بيانات النموذج" subtitle="البيانات محفوظة في متصفح هذا الجهاز فقط">
        <Button variant="danger" onClick={doReset}>إعادة ضبط النموذج</Button>
        {resetDone && <Notice tone="success" className="mt-2">أُعيد النموذج لبياناته التجريبية الأولى</Notice>}
      </Section>
    </div>
  )
}
