import React, { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowRight, Building2, ChevronLeft, CircleCheck, CircleMinus, CircleX, Landmark, Lock, Plus, Receipt, Save, ScanText, Tags, UserPlus,
  UserRoundCheck, UserRoundX, Users,
} from 'lucide-react'
import {
  Button, Check, Chip, DateInput, Dialog, Field, Input, Note, Panel, Select, Status, Switch, useToast,
} from '../../ui/components.jsx'
import { formatAgo, formatDate } from '../../ui/format.js'
import { useStore } from '../store.jsx'
import { useUnsavedGuard } from '../useUnsavedGuard.jsx'
import { TODAY } from '../model.js'
import { OWNER_ONLY, PERMISSION_GROUPS, ROLE_TEMPLATES, normalizePerms, roleLabel, templateOf } from '../settings.js'

const SECTIONS = [
  { key: 'business', title: 'بيانات المنشأة', hint: 'الاسم والسجل والتواصل والفروع', icon: Building2 },
  { key: 'staff', title: 'الموظفون والصلاحيات', hint: 'إضافة موظف، قالب الدور، التعطيل', icon: Users },
  { key: 'accounts', title: 'الحسابات وطرق الدفع', hint: 'الصندوق والبنك والعهد', icon: Landmark },
  { key: 'catalog', title: 'التصنيفات وقنوات المبيعات', hint: 'بنود المشتريات والمصروفات، والقنوات', icon: Tags },
  { key: 'tax', title: 'الضريبة وقراءة المستندات', hint: 'التسجيل الضريبي، والقراءة الآلية', icon: Receipt },
]
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const digits = v => String(v || '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))

/** قسم قابل للتعديل: مسودة محلية، وحفظ، وتنبيه عند المغادرة دون حفظ. */
function useSection(key) {
  const { state, saveSettings } = useStore()
  const toast = useToast()
  const saved = state.settings[key]
  const [draft, setDraft] = useState(saved)
  const dirty = !same(draft, saved)
  return { draft, setDraft, dirty, saved, commit: (value = draft) => { saveSettings(key, value); toast('حُفظت الإعدادات (محاكاة محلية)') } }
}

function SaveBar({ dirty, onSave, errors = [], note }) {
  return (
    <div className="rp-save-bar">
      {errors.length > 0 && <span className="ts-field-error">{errors[0]}</span>}
      {!errors.length && note && <span className="ts-field-hint">{note}</span>}
      <Button variant="primary" icon={Save} disabled={!dirty || errors.length > 0} onClick={onSave}>حفظ التغييرات</Button>
    </div>
  )
}

// ── بيانات المنشأة ──────────────────────────────────────────────────────────
function Business() {
  const { draft, setDraft, dirty, commit } = useSection('business')
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const errors = {
    name: !draft.name.trim() && 'الاسم التجاري مطلوب.',
    cr: draft.cr && !/^\d{10}$/.test(digits(draft.cr)) && 'السجل التجاري 10 أرقام.',
    phone: draft.phone && !/^05\d{8}$/.test(digits(draft.phone)) && 'رقم جوال سعودي يبدأ بـ 05 ومن 10 أرقام.',
  }
  const list = Object.values(errors).filter(Boolean)
  const guard = useUnsavedGuard(dirty, () => (list.length ? list[0] : (commit(), '')))
  return (
    <Panel title="بيانات المنشأة" icon={Building2} subtitle="تظهر في رأس التطبيق وفي التقارير.">
      <div className="ts-panel-body ts-form-grid">
        <Field label="الاسم التجاري" error={errors.name || undefined}><Input value={draft.name} onChange={e => set('name', e.target.value)} /></Field>
        <Field label="الاسم النظامي"><Input value={draft.legalName} onChange={e => set('legalName', e.target.value)} /></Field>
        <Field label="السجل التجاري" error={errors.cr || undefined}><Input numeric value={draft.cr} onChange={e => set('cr', e.target.value)} /></Field>
        <Field label="المدينة"><Input value={draft.city} onChange={e => set('city', e.target.value)} /></Field>
        <Field label="جوال التواصل" error={errors.phone || undefined}><Input numeric value={draft.phone} onChange={e => set('phone', e.target.value)} /></Field>
        <Field label="الرقم الضريبي" hint="يُعدَّل من «الضريبة وقراءة المستندات»."><Input numeric value={draft.vat} disabled /></Field>
        <div className="ts-span">
          <div className="ts-field-label" style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>الفروع</div>
          <div className="rp-chips">{draft.branches.map(b => <Chip key={b}>{b}</Chip>)}</div>
          <p className="ts-field-hint" style={{ marginTop: 6 }}>تبقى معلومات الفروع الحالية كما هي. توسيع الفروع (تقارير لكل فرع) مؤجل حتى تتحدد الحاجة.</p>
        </div>
      </div>
      <SaveBar dirty={dirty} onSave={() => commit()} errors={list} />
      {guard}
    </Panel>
  )
}

// ── الموظفون والصلاحيات ─────────────────────────────────────────────────────
function PermissionSummary({ perms }) {
  return (
    <ul className="rp-perm-summary">
      {PERMISSION_GROUPS.map(g => {
        const n = g.items.filter(i => perms.includes(i.key)).length
        const state = n === 0 ? 'none' : n === g.items.length ? 'all' : 'some'
        const Icon = state === 'all' ? CircleCheck : state === 'some' ? CircleMinus : CircleX
        return (
          <li key={g.key} className={`is-${state}`}>
            <Icon className="ts-icon--sm" aria-hidden="true" />
            <span>{g.title}</span>
            <span className="ts-sr">{state === 'all' ? 'كاملة' : state === 'some' ? `${n} من ${g.items.length}` : 'لا'}</span>
            {state === 'some' && <span className="ts-num rp-perm-count">{n}/{g.items.length}</span>}
          </li>
        )
      })}
    </ul>
  )
}

function EmployeeDialog({ open, employee, branches, onClose }) {
  const { addEmployee, updateEmployee } = useStore()
  const toast = useToast()
  const [name, setName] = useState(employee?.name || '')
  const [branch, setBranch] = useState(employee?.branch || branches[0])
  const [base, setBase] = useState(employee?.template || 'cashier')
  const [perms, setPerms] = useState(employee?.perms || ROLE_TEMPLATES.find(t => t.key === 'cashier').perms)
  const [error, setError] = useState('')
  const matched = templateOf(perms)
  const pick = key => { setBase(key); setPerms([...ROLE_TEMPLATES.find(t => t.key === key).perms]) }
  const toggle = (key, on) => setPerms(p => normalizePerms(on ? [...p, key] : p.filter(x => x !== key)))
  const submit = () => {
    const template = matched === 'custom' ? base : matched
    const r = employee ? updateEmployee(employee.id, { perms, template, branch }) : addEmployee({ name, template, perms, branch })
    if (r.error) {
      setError({ NAME_REQUIRED: 'اكتب اسم الموظف.', NAME_TAKEN: 'يوجد موظف نشط بالاسم نفسه.', PERMS_REQUIRED: 'اختر صلاحية واحدة على الأقل.', EXPORT_NEEDS_VIEW: 'التصدير يتطلب عرض التقارير.', OWNER_ONLY: 'إدارة الموظفين للمالك وحده.' }[r.error] || 'تعذّر الحفظ.')
      return
    }
    toast(employee ? `حُدّثت صلاحيات ${employee.name} (محاكاة)` : `أُضيف ${name.trim()} (محاكاة)`)
    onClose()
  }
  return (
    <Dialog open={open} onClose={onClose} title={employee ? `صلاحيات ${employee.name}` : 'إضافة موظف'}
      description="اختر قالبًا ثم خصّص ما يلزم. الصلاحيات مجمّعة حسب المهمة."
      footer={<><Button variant="primary" icon={Save} onClick={submit}>{employee ? 'حفظ الصلاحيات' : 'إضافة الموظف'}</Button><Button onClick={onClose}>إلغاء</Button></>}>
      {!employee && (
        <Field label="اسم الموظف" error={error === 'اكتب اسم الموظف.' || error === 'يوجد موظف نشط بالاسم نفسه.' ? error : undefined}>
          <Input value={name} onChange={e => { setName(e.target.value); setError('') }} placeholder="مثال: فهد" />
        </Field>
      )}
      {branches.length > 1 && (
        <Field label="الفرع"><Select value={branch} onChange={e => setBranch(e.target.value)} options={branches.map(b => ({ value: b, label: b }))} /></Field>
      )}
      <div>
        <div className="ts-field-label" style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>قالب الدور</div>
        <div className="rp-templates" role="radiogroup" aria-label="قالب الدور">
          {ROLE_TEMPLATES.map(t => (
            <button key={t.key} type="button" role="radio" aria-checked={matched === t.key} className="rp-template" onClick={() => pick(t.key)}>
              <strong>{t.label}</strong><small>{t.hint}</small>
            </button>
          ))}
        </div>
        {matched === 'custom' && <p className="rp-custom-note">صلاحيات مخصصة، مبنية على «{ROLE_TEMPLATES.find(t => t.key === base)?.label}».</p>}
      </div>
      <div className="rp-perm-groups">
        {PERMISSION_GROUPS.map(g => (
          <fieldset key={g.key} className="rp-perm-group">
            <legend>{g.title}</legend>
            {g.items.map(i => {
              const blocked = i.requires && !perms.includes(i.requires)
              return <Check key={i.key} label={i.label} hint={blocked ? 'يتطلب «عرض الأرقام والتقارير»' : undefined} disabled={blocked}
                checked={perms.includes(i.key)} onChange={on => { toggle(i.key, on); setError('') }} />
            })}
            {g.key === 'settings' && OWNER_ONLY.map(o => <p key={o.key} className="rp-owner-only"><Lock className="ts-icon--sm" aria-hidden="true" />{o.label}: للمالك وحده، لا تُمنح لموظف.</p>)}
          </fieldset>
        ))}
      </div>
      {error && error !== 'اكتب اسم الموظف.' && error !== 'يوجد موظف نشط بالاسم نفسه.' && <p className="ts-field-error">{error}</p>}
      {!employee && <p className="ts-field-hint">رمز الدخول يُصدر للموظف عند إضافته في التطبيق الفعلي، ولا يُعرض في هذا النموذج.</p>}
    </Dialog>
  )
}

function Staff() {
  const { state, setEmployeeActive } = useStore()
  const toast = useToast()
  const { employees, business } = state.settings
  const [editing, setEditing] = useState(null) // null | 'new' | employee
  const [confirm, setConfirm] = useState(null)
  const active = employees.filter(e => e.active)
  const disabled = employees.filter(e => !e.active)
  const card = e => (
    <li key={e.id} className={`rp-member${e.active ? '' : ' is-disabled'}`}>
      <div className="rp-member-top">
        <span className="ts-avatar">{e.name[0]}</span>
        <div className="rp-member-name">
          <strong>{e.name}</strong>
          <small>{roleLabel(e)} · {e.branch}</small>
        </div>
        {e.owner ? <Status tone="info">كل الصلاحيات</Status> : e.active ? <Status>نشط</Status> : <Status tone="neutral">معطّل</Status>}
      </div>
      {!e.owner && <PermissionSummary perms={e.perms} />}
      <div className="rp-member-foot">
        <span className="ts-field-hint">
          {e.owner ? 'المالك لا يُعطَّل ولا تُقيَّد صلاحياته.' : e.active ? (e.lastSeen ? `آخر دخول ${formatAgo(e.lastSeen, TODAY)}` : 'لم يدخل بعد') : `عُطّل ${formatDate(e.disabledAt.slice(0, 10))} · تبقى عملياته السابقة باسمه`}
        </span>
        {!e.owner && (
          <div className="rp-member-actions">
            {e.active && <Button size="sm" onClick={() => setEditing(e)}>الصلاحيات</Button>}
            {e.active
              ? <Button size="sm" variant="quiet" icon={UserRoundX} onClick={() => setConfirm(e)}>تعطيل</Button>
              : <Button size="sm" variant="quiet" icon={UserRoundCheck} onClick={() => { setEmployeeActive(e.id, true); toast(`أعيد تفعيل ${e.name} (محاكاة)`) }}>إعادة التفعيل</Button>}
          </div>
        )}
      </div>
    </li>
  )
  return (
    <Panel title="الموظفون والصلاحيات" icon={Users} subtitle="المالك يضيف الموظفين ويحدد ما يفعله كل منهم."
      action={<Button variant="primary" icon={UserPlus} onClick={() => setEditing('new')}>إضافة موظف</Button>}>
      <div className="ts-panel-body">
        <ul className="rp-members">{active.map(card)}</ul>
        {disabled.length > 0 && <>
          <h3 className="rp-subhead">معطّلون</h3>
          <ul className="rp-members">{disabled.map(card)}</ul>
        </>}
      </div>
      {editing && <EmployeeDialog open employee={editing === 'new' ? null : editing} branches={business.branches} onClose={() => setEditing(null)} />}
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} title={confirm ? `تعطيل ${confirm.name}؟` : ''}
        description="لن يستطيع الدخول بعد التعطيل. لا يُحذف شيء: تبقى مستنداته وعملياته السابقة باسمه، ويمكن إعادة تفعيله."
        footer={<><Button variant="danger-solid" icon={UserRoundX} onClick={() => { setEmployeeActive(confirm.id, false); toast(`عُطّل ${confirm.name} (محاكاة)`); setConfirm(null) }}>تعطيل</Button><Button onClick={() => setConfirm(null)}>إلغاء</Button></>} />
    </Panel>
  )
}

// ── الحسابات وطرق الدفع ─────────────────────────────────────────────────────
const KIND_LABEL = { cash: 'صندوق', bank: 'بنك', custody: 'عهدة' }
function Accounts() {
  const { state, saveSettings } = useStore()
  const toast = useToast()
  const saved = { accounts: state.settings.accounts, payments: state.settings.payments }
  const [draft, setDraft] = useState(saved)
  const [adding, setAdding] = useState(null)
  const dirty = !same(draft, saved)
  const usedBy = id => draft.payments.filter(p => p.active && p.account === id)
  const errors = draft.accounts.filter(a => !a.active && usedBy(a.id).length).map(a => `«${a.name}» موقوف وتستخدمه طريقة دفع نشطة: غيّر الحساب أو أوقف الطريقة.`)
  const commit = () => { saveSettings('accounts', draft.accounts); saveSettings('payments', draft.payments); toast('حُفظت الإعدادات (محاكاة محلية)') }
  const guard = useUnsavedGuard(dirty, () => (errors.length ? errors[0] : (commit(), '')))
  const setAccount = (id, patch) => setDraft(d => ({ ...d, accounts: d.accounts.map(a => (a.id === id ? { ...a, ...patch } : a)) }))
  const setPayment = (key, patch) => setDraft(d => ({ ...d, payments: d.payments.map(p => (p.key === key ? { ...p, ...patch } : p)) }))
  const accountOptions = draft.accounts.filter(a => a.active).map(a => ({ value: a.id, label: a.name }))
  return (
    <>
      <Panel title="الحسابات" icon={Landmark} subtitle="أين يكون المال: الصندوق، والبنك، وعهد الموظفين."
        action={<Button size="sm" icon={Plus} onClick={() => setAdding({ name: '', kind: 'custody' })}>إضافة حساب</Button>}>
        <ul className="rp-rows">
          {draft.accounts.map(a => (
            <li key={a.id} className={a.active ? '' : 'is-off'}>
              <div className="rp-row-main"><strong>{a.name}</strong><small>{KIND_LABEL[a.kind]}{a.detail ? ` · ${a.detail}` : ''}</small></div>
              <Switch label={a.active ? 'نشط' : 'موقوف'} checked={a.active} onChange={v => setAccount(a.id, { active: v })} />
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="طرق الدفع للمشتريات والمصروفات" icon={Receipt} subtitle="كل طريقة تحدد الحساب الذي ينقص عند الاعتماد.">
        <ul className="rp-rows">
          {draft.payments.map(p => (
            <li key={p.key} className={p.active ? '' : 'is-off'}>
              <div className="rp-row-main"><strong>{p.label}</strong><small>{p.key === 'credit' ? 'لا ينقص حساب: يُسجَّل دينًا على المورد' : 'يُخصم من'}</small></div>
              {p.key !== 'credit' && (
                <Select aria-label={`حساب ${p.label}`} value={p.account} disabled={!p.active} onChange={e => setPayment(p.key, { account: e.target.value })}
                  options={[...accountOptions, ...(accountOptions.some(o => o.value === p.account) ? [] : [{ value: p.account, label: 'حساب موقوف' }])]} />
              )}
              <Switch label={p.active ? 'متاحة' : 'موقوفة'} checked={p.active} onChange={v => setPayment(p.key, { active: v })} />
            </li>
          ))}
        </ul>
        <SaveBar dirty={dirty} onSave={commit} errors={errors} note="الإيقاف يخفي الخيار من المستندات الجديدة، ولا يغيّر المعتمد." />
      </Panel>
      {adding && (
        <Dialog open onClose={() => setAdding(null)} title="إضافة حساب"
          footer={<><Button variant="primary" icon={Plus} disabled={!adding.name.trim()} onClick={() => { setDraft(d => ({ ...d, accounts: [...d.accounts, { id: `acc-${Date.now().toString(36)}`, name: adding.name.trim(), kind: adding.kind, active: true }] })); setAdding(null) }}>إضافة</Button><Button onClick={() => setAdding(null)}>إلغاء</Button></>}>
          <Field label="اسم الحساب"><Input value={adding.name} onChange={e => setAdding(a => ({ ...a, name: e.target.value }))} placeholder="مثال: عهدة ماجد" /></Field>
          <Field label="النوع"><Select value={adding.kind} onChange={e => setAdding(a => ({ ...a, kind: e.target.value }))} options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
          <p className="ts-field-hint">يُحفظ مع «حفظ التغييرات».</p>
        </Dialog>
      )}
      {guard}
    </>
  )
}

// ── التصنيفات وقنوات المبيعات ───────────────────────────────────────────────
const SETTLES = [{ value: 'cash', label: 'الصندوق' }, { value: 'bank', label: 'البنك' }, { value: 'app', label: 'تسوية التطبيق' }]
function AddRow({ placeholder, onAdd, existing }) {
  const [value, setValue] = useState('')
  const clean = value.trim()
  const taken = existing.includes(clean)
  return (
    <div className="rp-add-row">
      <Input value={value} placeholder={placeholder} aria-label={placeholder} aria-invalid={taken || undefined} onChange={e => setValue(e.target.value)} />
      <Button icon={Plus} disabled={!clean || taken} onClick={() => { onAdd(clean); setValue('') }}>إضافة</Button>
      {taken && <span className="ts-field-error">موجود مسبقًا.</span>}
    </div>
  )
}
function Catalog() {
  const { state, saveSettings } = useStore()
  const toast = useToast()
  const saved = { categories: state.settings.categories, channels: state.settings.channels }
  const [draft, setDraft] = useState(saved)
  const dirty = !same(draft, saved)
  const commit = () => { saveSettings('categories', draft.categories); saveSettings('channels', draft.channels); toast('حُفظت الإعدادات (محاكاة محلية)') }
  const guard = useUnsavedGuard(dirty, () => (commit(), ''))
  const setCat = (kind, name, patch) => setDraft(d => ({ ...d, categories: { ...d.categories, [kind]: d.categories[kind].map(c => (c.name === name ? { ...c, ...patch } : c)) } }))
  const addCat = (kind, name) => setDraft(d => ({ ...d, categories: { ...d.categories, [kind]: [...d.categories[kind], { name, active: true, added: true }] } }))
  const setChannel = (name, patch) => setDraft(d => ({ ...d, channels: d.channels.map(c => (c.name === name ? { ...c, ...patch } : c)) }))
  const group = (kind, title, hint) => (
    <Panel title={title} icon={Tags} subtitle={hint}>
      <ul className="rp-rows rp-rows--tight">
        {draft.categories[kind].map(c => (
          <li key={c.name} className={c.active ? '' : 'is-off'}>
            <div className="rp-row-main"><strong>{c.name}</strong>{c.added && <small>جديد — يُحفظ مع «حفظ التغييرات»</small>}</div>
            <Switch label={c.active ? 'مستخدم' : 'موقوف'} checked={c.active} onChange={v => setCat(kind, c.name, { active: v })} />
          </li>
        ))}
      </ul>
      <div className="ts-panel-body"><AddRow placeholder="تصنيف جديد" existing={draft.categories[kind].map(c => c.name)} onAdd={n => addCat(kind, n)} /></div>
    </Panel>
  )
  return (
    <>
      {group('purchase', 'تصنيفات المشتريات', 'مواد تدخل في الأطباق والمشروبات والتغليف.')}
      {group('expense', 'تصنيفات المصروفات التشغيلية', 'تكاليف التشغيل، ولا تشمل المشتريات.')}
      <Panel title="قنوات المبيعات" icon={Receipt} subtitle="من أين تأتي المبيعات، وأين تُسوّى.">
        <ul className="rp-rows">
          {draft.channels.map(c => (
            <li key={c.name} className={c.active ? '' : 'is-off'}>
              <div className="rp-row-main"><strong>{c.name}</strong><small>تُسوّى في</small></div>
              <Select aria-label={`تسوية ${c.name}`} value={c.settles} disabled={!c.active} onChange={e => setChannel(c.name, { settles: e.target.value })} options={SETTLES} />
              <Switch label={c.active ? 'نشطة' : 'موقوفة'} checked={c.active} onChange={v => setChannel(c.name, { active: v })} />
            </li>
          ))}
        </ul>
        <div className="ts-panel-body"><AddRow placeholder="قناة جديدة" existing={draft.channels.map(c => c.name)} onAdd={n => setDraft(d => ({ ...d, channels: [...d.channels, { name: n, active: true, settles: 'app' }] }))} /></div>
        <SaveBar dirty={dirty} onSave={commit} note="الإيقاف يخفي التصنيف أو القناة من الاختيار، ولا يغيّر المستندات السابقة." />
      </Panel>
      {guard}
    </>
  )
}

// ── الضريبة وقراءة المستندات ────────────────────────────────────────────────
function Tax() {
  const { state, saveSettings } = useStore()
  const toast = useToast()
  const saved = { tax: state.settings.tax, reading: state.settings.reading }
  const [draft, setDraft] = useState(saved)
  const [confirming, setConfirming] = useState(false)
  const dirty = !same(draft, saved)
  const t = draft.tax
  const setTax = patch => setDraft(d => ({ ...d, tax: { ...d.tax, ...patch } }))
  const setReading = patch => setDraft(d => ({ ...d, reading: { ...d.reading, ...patch } }))
  const vatOk = !t.registered || /^3\d{13}3$/.test(digits(t.vatNumber))
  const rateOk = Number.isFinite(Number(digits(t.rate))) && Number(digits(t.rate)) >= 0 && Number(digits(t.rate)) <= 100 && String(t.rate).trim() !== ''
  const errors = [!vatOk && 'الرقم الضريبي 15 رقمًا يبدأ وينتهي بـ 3.', !rateOk && 'النسبة رقم بين 0 و100.', !t.effectiveFrom && 'حدد تاريخ السريان.'].filter(Boolean)
  const taxChanged = !same({ r: String(t.rate), e: t.effectiveFrom, reg: t.registered, inc: t.salesIncludeVat }, { r: String(saved.tax.rate), e: saved.tax.effectiveFrom, reg: saved.tax.registered, inc: saved.tax.salesIncludeVat })
  const commit = () => { saveSettings('tax', { ...t, rate: Number(digits(t.rate)) }); saveSettings('reading', draft.reading); setConfirming(false); toast('حُفظت الإعدادات (محاكاة محلية، لم يتغير أي حساب)') }
  const guard = useUnsavedGuard(dirty, () => (errors.length ? errors[0] : taxChanged ? 'تغيير الضريبة يحتاج تأكيدًا: ابقَ واضغط «حفظ التغييرات».' : (commit(), '')))
  return (
    <>
      <Panel title="ضريبة القيمة المضافة" icon={Receipt} subtitle="تُطبَّق على المستندات الجديدة من تاريخ السريان فقط.">
        <div className="ts-panel-body rp-stack">
          <Switch label="المنشأة مسجلة في ضريبة القيمة المضافة" checked={t.registered} onChange={v => setTax({ registered: v })} />
          <div className="ts-form-grid">
            <Field label="الرقم الضريبي" error={!vatOk ? errors[0] : undefined}><Input numeric value={t.vatNumber} disabled={!t.registered} onChange={e => setTax({ vatNumber: e.target.value })} /></Field>
            <Field label="النسبة %" error={!rateOk ? 'النسبة رقم بين 0 و100.' : undefined}><Input numeric value={t.rate} disabled={!t.registered} onChange={e => setTax({ rate: e.target.value })} /></Field>
            <Field label="تاريخ السريان" hint="المستندات قبل هذا التاريخ لا تتغير."><DateInput value={t.effectiveFrom} onChange={v => setTax({ effectiveFrom: v })} /></Field>
          </div>
          <Switch label="أسعار البيع شاملة الضريبة" hint="كما تظهر في تقرير الإغلاق." checked={t.salesIncludeVat} onChange={v => setTax({ salesIncludeVat: v })} />
          <Note tone="info" icon={Lock} title="لا أثر رجعي">تغيير الضريبة هنا لا يعيد حساب أي مستند معتمد، ولا يغيّر الأرقام السابقة.</Note>
        </div>
      </Panel>
      <Panel title="قراءة المستندات" icon={ScanText} subtitle="تعبئة حقول المستند آليًا من صورته، لتراجعها قبل الاعتماد.">
        <div className="ts-panel-body rp-stack">
          <Switch label="القراءة الآلية مفعّلة" hint="كما في التطبيق الحالي." checked={draft.reading.enabled} onChange={v => setReading({ enabled: v })} />
          <fieldset className="rp-perm-group" disabled={!draft.reading.enabled}>
            <legend>تُقرأ آليًا</legend>
            <Check label="فواتير المشتريات" checked={draft.reading.kinds.purchase} disabled={!draft.reading.enabled} onChange={v => setReading({ kinds: { ...draft.reading.kinds, purchase: v } })} />
            <Check label="المصروفات" checked={draft.reading.kinds.expense} disabled={!draft.reading.enabled} onChange={v => setReading({ kinds: { ...draft.reading.kinds, expense: v } })} />
            <Check label="تقارير الإغلاق" checked={draft.reading.kinds.sales} disabled={!draft.reading.enabled} onChange={v => setReading({ kinds: { ...draft.reading.kinds, sales: v } })} />
          </fieldset>
          <p className="ts-field-hint">عند التفعيل تُرسل صورة المستند إلى مزوّد القراءة المعتمد، والنتيجة مسودة لا تُعتمد إلا بمراجعة. هذا النموذج لا يرسل شيئًا.</p>
        </div>
        <SaveBar dirty={dirty} errors={errors} onSave={() => (taxChanged ? setConfirming(true) : commit())} />
      </Panel>
      <Dialog open={confirming} onClose={() => setConfirming(false)} title="تأكيد تغيير الضريبة"
        description={`يسري على المستندات التي تاريخها من ${formatDate(t.effectiveFrom || TODAY, { year: true })} فما بعد.`}
        footer={<><Button variant="primary" icon={Save} onClick={commit}>تأكيد الحفظ</Button><Button onClick={() => setConfirming(false)}>مراجعة</Button></>}>
        <Note tone="info" icon={Lock}>المستندات المعتمدة قبل تاريخ السريان تبقى كما هي، ولا يُعاد حساب أي رقم سابق.</Note>
      </Dialog>
      {guard}
    </>
  )
}

const BODIES = { business: Business, staff: Staff, accounts: Accounts, catalog: Catalog, tax: Tax }

export default function Settings() {
  const { section } = useParams()
  const current = BODIES[section] ? section : null
  const Body = BODIES[current || 'business']
  const meta = SECTIONS.find(s => s.key === (current || 'business'))
  return (
    <div className="rp-settings" data-section={current || ''}>
      <div className="ts-heading rp-settings-heading">
        <div>
          {current && <Link to="/settings" className="ts-back rp-mobile-only"><ArrowRight className="ts-icon--sm" aria-hidden="true" />كل الإعدادات</Link>}
          <h1>{current ? <><span className="rp-desktop-only">الإعدادات</span><span className="rp-mobile-only">{meta.title}</span></> : 'الإعدادات'}</h1>
          <p>يديرها المالك. التغييرات هنا محاكاة، ولا تمس أي حساب قائم.</p>
        </div>
      </div>
      <div className="rp-settings-grid">
        <nav className="rp-settings-nav" aria-label="أقسام الإعدادات">
          {SECTIONS.map(({ key, title, hint, icon: Icon }) => (
            <Link key={key} to={`/settings/${key}`} className={`rp-settings-link${(current || 'business') === key ? ' is-active' : ''}`} aria-current={(current || 'business') === key ? 'page' : undefined}>
              <span className="rp-settings-icon"><Icon className="ts-icon" aria-hidden="true" /></span>
              <span><strong>{title}</strong><small>{hint}</small></span>
              <ChevronLeft className="ts-icon--sm rp-settings-chevron" aria-hidden="true" />
            </Link>
          ))}
        </nav>
        <div className="rp-settings-body"><Body /></div>
      </div>
    </div>
  )
}
