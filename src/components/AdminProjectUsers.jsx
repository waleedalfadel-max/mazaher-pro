import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { adminCreateStaff, adminUpdateStaff, adminSetStaffPin, adminSetStaffActive, adminRemoveStaff } from '../lib/staffCredentials'
import { normalizePin } from '../lib/pinInput'

const NAVY = '#1B3A5C'
const GOLD = '#6EB7B0'

const ROLES = [
  { value: 'owner',      label: 'المالك' },
  { value: 'accountant', label: 'المحاسب' },
  { value: 'purchasing', label: 'مسؤول المشتريات' },
  { value: 'cashier',    label: 'الكاشير' },
]

const ADMIN_USERS_ERRORS = {
  no_session: 'انتهت الجلسة أو أُوقف الحساب. سجّل الدخول من جديد.',
  forbidden: 'هذه الشاشة لمدير المنصة فقط.',
  not_found: 'المنشأة غير موجودة. حدّث الصفحة.',
  invalid: 'طلب غير صالح. حدّث الصفحة.',
  network: 'انقطع الاتصال أو لم يصل الرد.',
}

const ROLE_COLORS = {
  owner:      { bg: '#eff6ff', color: '#1d4ed8' },
  accountant: { bg: '#f0fdf4', color: '#15803d' },
  purchasing: { bg: '#fff7ed', color: '#c2410c' },
  cashier:    { bg: '#fdf4ff', color: '#7e22ce' },
}

// الفرع حسب الدور: المالك لكل الفروع؛ الكاشير لفرع محدد (إن كانت للمنشأة فروع)؛ والمحاسب والمشتريات أيهما. الخادم يفرض القاعدة نفسها.
const branchRule = role => role === 'owner' ? 'all' : role === 'cashier' ? 'one' : 'any'
const fmtDateTime = d => d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const fieldCls = 'border rounded-lg px-2 py-1.5 text-sm focus:outline-none'

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-bold text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function BranchSelect({ role, value, branches, onChange }) {
  const rule = branchRule(role)
  const list = rule === 'all' ? [] : branches
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={`${fieldCls} w-36`} style={{ borderColor: '#d1c9b8' }} data-k="branch">
      {rule === 'one' && branches.length > 0 ? <option value="" disabled>اختر الفرع</option> : <option value="">كل الفروع</option>}
      {list.map(b => <option key={b} value={b}>{b}</option>)}
      {value && !branches.includes(value) && <option value={value}>{value} (ليس من فروع المنشأة)</option>}
    </select>
  )
}

function RoleSelect({ value, onChange }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={fieldCls} style={{ borderColor: '#d1c9b8' }} data-k="role">
      {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
    </select>
  )
}

function PinInput({ value, onChange, show, onToggle, label = 'رمز الدخول (5 أرقام)' }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-1">
        <input value={value} onChange={e => onChange(normalizePin(e.target.value).slice(0, 5))} inputMode="numeric" autoComplete="new-password"
          type={show ? 'text' : 'password'} placeholder="•••••" dir="ltr" data-k="pin"
          className={`${fieldCls} w-24`} style={{ borderColor: '#d1c9b8' }} />
        <button type="button" onClick={onToggle} className="text-slate-400 hover:text-slate-600 text-xs px-1" aria-label={show ? 'إخفاء الرمز' : 'إظهار الرمز'}>
          {show ? '🙈' : '👁'}
        </button>
      </div>
    </Field>
  )
}

// صف موظف في شاشة مدير المنصة: الاسم والدور والفرع والحالة وتاريخ الإنشاء. رمز الدخول لا يصل إلى الشاشة أصلًا (admin_project_users).
// الإجراءات كلها عبر الخادم: حفظ، ورمز جديد (يلغي الجلسات)، وتعطيل/إعادة تفعيل، وحذف (أو أرشفة إن كانت له عمليات).
function UserRow({ user, branches, onSave, onPin, onActive, onRemove }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: user.name, role: user.role, branch: user.branch || '' })
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  function open() { setForm({ name: user.name, role: user.role, branch: user.branch || '' }); setPin(''); setErr(''); setEditing(true) }
  async function run(kind, fn) {
    setBusy(kind); setErr('')
    const res = await fn()
    setBusy('')
    if (res?.error) { setErr(res.error); return false }
    return true
  }
  const save = () => form.name.trim() && run('save', () => onSave(user.id, form)).then(ok => ok && setEditing(false))
  const savePin = () => {
    if (!/^\d{5}$/.test(pin)) { setErr('رمز الدخول 5 أرقام بالضبط.'); return }
    run('pin', () => onPin(user.id, pin)).then(ok => { if (ok) { setPin(''); setEditing(false) } })
  }
  const toggleActive = () => {
    const msg = user.is_active ? `تعطيل «${user.name}»؟ لن يستطيع الدخول، وتُلغى جلساته الحالية.` : `إعادة تفعيل «${user.name}»؟`
    if (!window.confirm(msg)) return
    run('active', () => onActive(user.id, !user.is_active)).then(ok => ok && setEditing(false))
  }
  const remove = () => {
    if (!window.confirm(`حذف حساب «${user.name}» (أُنشئ ${fmtDateTime(user.created_at)})؟\nإن كانت له عمليات أو ارتباطات فلن يُحذف: يُؤرشف ويُمنع دخوله ويبقى اسمه في السجلات.`)) return
    run('remove', () => onRemove(user.id)).then(ok => ok && setEditing(false))
  }

  const roleStyle = ROLE_COLORS[user.role] || { bg: '#f1f5f9', color: '#475569' }
  const roleLabel = ROLES.find(r => r.value === user.role)?.label || user.role

  if (editing) return (
    <div className="py-3 border-b last:border-0" style={{ borderColor: '#D4E8E6' }} data-user-edit={user.id}>
      <div className="flex items-end gap-2 flex-wrap">
        <Field label="الاسم">
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="الاسم" dir="rtl"
            className={`${fieldCls} w-36`} style={{ borderColor: GOLD }} data-k="name" />
        </Field>
        <Field label="الدور">
          <RoleSelect value={form.role} onChange={role => setForm(f => ({ ...f, role, branch: branchRule(role) === 'all' ? '' : f.branch }))} />
        </Field>
        <Field label="الفرع">
          <BranchSelect role={form.role} value={form.branch} branches={branches} onChange={branch => setForm(f => ({ ...f, branch }))} />
        </Field>
        <button onClick={save} disabled={!!busy} className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50" style={{ background: GOLD, color: NAVY }}>
          {busy === 'save' ? '...' : 'حفظ'}
        </button>
        <button onClick={() => { setEditing(false); setErr('') }} className="text-xs text-slate-400 hover:text-red-500 px-1" aria-label="إغلاق">✕</button>
      </div>
      <div className="flex items-end gap-2 flex-wrap mt-3 pt-3" style={{ borderTop: '1px dashed #e2ddd4' }}>
        <PinInput value={pin} onChange={setPin} show={showPin} onToggle={() => setShowPin(v => !v)} label="رمز جديد (5 أرقام)" />
        <button onClick={savePin} disabled={!!busy || pin.length !== 5} className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40" style={{ background: NAVY, color: '#fff' }}>
          {busy === 'pin' ? '...' : 'تعيين الرمز'}
        </button>
        <span className="flex-1" />
        <button onClick={toggleActive} disabled={!!busy} className="px-3 py-1.5 rounded-lg text-xs font-bold border disabled:opacity-40"
          style={{ borderColor: '#d1c9b8', color: user.is_active ? '#b45309' : '#15803d' }}>
          {busy === 'active' ? '...' : user.is_active ? 'تعطيل' : 'إعادة التفعيل'}
        </button>
        <button onClick={remove} disabled={!!busy} className="px-3 py-1.5 rounded-lg text-xs font-bold border disabled:opacity-40" style={{ borderColor: '#fecaca', color: '#dc2626' }}>
          {busy === 'remove' ? '...' : 'حذف'}
        </button>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">الرمز الجديد يلغي جلسات الحساب الحالية، والرمز القديم يُرفض. لا يُعرض أي رمز مخزّن.</p>
      {err && <p className="text-xs text-red-500 mt-1" role="alert">{err}</p>}
    </div>
  )

  return (
    <div className="flex items-center gap-3 py-2 border-b last:border-0" style={{ borderColor: '#D4E8E6' }} data-user-row data-user-id={user.id}>
      <div className="flex-1 min-w-0">
        <span className="font-medium text-sm" style={{ color: NAVY }}>{user.name}</span>
        {user.is_active === false && (
          <span className="text-xs text-slate-500 bg-slate-100 rounded-full px-2 py-0.5 mr-2">معطّل</span>
        )}
        <span className="text-xs text-slate-400 mr-2">🏢 {user.branch || 'كل الفروع'}</span>
        <span className="block text-[11px] text-slate-400" dir="rtl">أُنشئ {fmtDateTime(user.created_at)}</span>
      </div>
      <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: roleStyle.bg, color: roleStyle.color }}>
        {roleLabel}
      </span>
      <button onClick={open} className="text-slate-300 hover:text-slate-600 text-xs" aria-label={`إدارة حساب ${user.name}`}>✏️</button>
    </div>
  )
}

function AddUserRow({ projectId, branches, onAdded }) {
  const empty = { name: '', role: 'accountant', pin: '', branch: '' }
  const [form, setForm] = useState(empty)
  const [showPin, setShowPin] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function add() {
    if (!form.name.trim() || !form.pin.trim()) { setErr('الاسم والرمز مطلوبان'); return }
    if (!/^\d{5}$/.test(form.pin.trim())) { setErr('رمز الدخول 5 أرقام بالضبط'); return }
    setSaving(true); setErr('')
    // عبر الخادم: يتحقق من مدير المنصة والفرع والدور ومن عدم تكرار الرمز في المنشأة، ويخزنه للتحقق فقط
    const r = await adminCreateStaff(supabase, { projectId, name: form.name, role: form.role, branch: form.branch, pin: form.pin.trim() })
    if (!r.ok) { setErr(r.message); setSaving(false); return }
    setForm(empty)
    setSaving(false)
    onAdded()
  }

  return (
    <div className="pt-3 mt-1" style={{ borderTop: '1px dashed #e2ddd4' }} data-add-user>
      <div className="text-xs font-bold mb-2" style={{ color: NAVY }}>إضافة مستخدم</div>
      <div className="flex items-end gap-2 flex-wrap">
        <Field label="الاسم">
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="الاسم" dir="rtl"
            className={`${fieldCls} w-36`} style={{ borderColor: '#d1c9b8' }} data-k="name" />
        </Field>
        <Field label="الدور">
          <RoleSelect value={form.role} onChange={role => setForm(f => ({ ...f, role, branch: branchRule(role) === 'all' ? '' : f.branch }))} />
        </Field>
        <Field label="الفرع">
          <BranchSelect role={form.role} value={form.branch} branches={branches} onChange={branch => setForm(f => ({ ...f, branch }))} />
        </Field>
        <PinInput value={form.pin} onChange={pin => setForm(f => ({ ...f, pin }))} show={showPin} onToggle={() => setShowPin(v => !v)} />
        <button onClick={add} disabled={saving || !form.name.trim() || !form.pin.trim()}
          className="px-4 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40 transition-all"
          style={{ background: NAVY, color: '#fff' }}>
          {saving ? '...' : '+ إضافة'}
        </button>
      </div>
      {err && <p className="text-xs text-red-500 mt-1" role="alert">{err}</p>}
    </div>
  )
}


export default function AdminProjectUsers({ projectId }) {
  const [users, setUsers]             = useState([])
  const [usersState, setUsersState]   = useState('idle') // idle | loading | ready | error
  const [usersError, setUsersError]   = useState('')
  const [usersNotice, setUsersNotice] = useState('')   // نتيجة تعديل فشل، تبقى بعد إعادة التحميل
  const [usersInfo, setUsersInfo]     = useState('')   // نتيجة إجراء نجح (حذف، أرشفة، رمز جديد…)
  const [branches, setBranches]       = useState([])   // فروع المنشأة من الخادم (قائمة الفرع)
  const usersReq = useRef(0)
  useEffect(() => { loadUsers(); return () => { usersReq.current++ } }, [projectId])

  // موظفو هذه المنشأة من الخادم (مدير منصة نشط وحده؛ بلا رموز). الفشل حالة مستقلة، لا قائمة فارغة.
  async function loadUsers() {
    const req = ++usersReq.current
    setUsersState('loading'); setUsersError(''); setUsers([])
    let res
    try {
      const { data, error } = await supabase.rpc('admin_project_users', { p_project_id: projectId })
      res = error ? { ok: false, code: 'network' } : data
    } catch { res = { ok: false, code: 'network' } }
    if (req !== usersReq.current) return   // رد متأخر لطلب أقدم
    if (res?.ok && res.project_id === projectId && Array.isArray(res.members)) {
      setUsers(res.members); setBranches(Array.isArray(res.branches) ? res.branches : []); setUsersState('ready')
    } else {
      setUsersError(ADMIN_USERS_ERRORS[res?.code] || ADMIN_USERS_ERRORS.network); setUsersState('error')
    }
  }

  // كل إجراءات المستخدمين عبر الخادم (admin_write_user)؛ النتيجة تُقرأ من الخادم بعدها، فلا يُعرض حفظٌ لم يحدث
  async function act(fn, done) {
    setUsersNotice(''); setUsersInfo('')
    const r = await fn()
    await loadUsers()
    if (!r.ok) { setUsersNotice(`لم يُحفظ: ${r.message}`); return { error: r.message } }
    if (done) setUsersInfo(done(r))
    return {}
  }
  const saveUser = (id, form) => act(() => adminUpdateStaff(supabase, { userId: id, name: form.name, role: form.role, branch: form.branch }))
  const setPin = (id, pin) => act(() => adminSetStaffPin(supabase, id, pin), () => 'عُيّن الرمز الجديد: الرمز القديم يُرفض، وجلسات الحساب السابقة أُلغيت فورًا (يلزمه دخول جديد).')
  const setActive = (id, active) => act(() => adminSetStaffActive(supabase, id, active), () => active ? 'أُعيد تفعيل الحساب، ويلزمه دخول جديد.' : 'عُطّل الحساب: لا يستطيع الدخول، وجلساته الحالية أُلغيت فورًا.')
  const removeUser = id => act(() => adminRemoveStaff(supabase, id), d => d?.result === 'deleted'
    ? 'حُذف الحساب (لم تكن له عمليات).' : 'لم يُحذف لأن له عمليات أو ارتباطات مسجلة: أُرشف ومُنع دخوله، ويبقى اسمه وتاريخه في السجلات.')

  return (
          <div className="pt-4" data-admin-project-users={projectId}>
            {usersNotice && <p role="alert" className="text-xs text-red-600 pb-2" data-users-notice>{usersNotice}</p>}
            {usersInfo && <p role="status" className="text-xs text-emerald-700 pb-2" data-users-info>{usersInfo}</p>}
            {usersState === 'loading' || usersState === 'idle' ? (
              <div className="flex justify-center py-4" data-users-state="loading">
                <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: GOLD, borderTopColor: 'transparent' }} />
              </div>
            ) : usersState === 'error' ? (
              <div className="flex items-center gap-3 py-2 flex-wrap" role="alert" data-users-state="error">
                <p className="text-xs text-red-600">تعذّر تحميل الموظفين. {usersError}</p>
                <button onClick={loadUsers} className="px-3 py-1 rounded-lg text-xs font-bold"
                  style={{ background: NAVY, color: '#fff' }}>إعادة المحاولة</button>
              </div>
            ) : users.length === 0 ? (
              <p className="text-xs text-slate-400 py-2" data-users-state="empty">لا يوجد موظفون في هذه المنشأة.</p>
            ) : (
              <div data-users-state="ready">
                <div className="flex items-center gap-3 pb-1 text-xs font-bold text-slate-400">
                  <span className="flex-1">الاسم</span>
                  <span className="w-24">الدور</span>
                  <span className="w-16"></span>
                </div>
                {users.map(u => (
                  <UserRow key={u.id} user={u} branches={branches} onSave={saveUser} onPin={setPin} onActive={setActive} onRemove={removeUser} />
                ))}
              </div>
            )}
            {usersState === 'ready' && <AddUserRow projectId={projectId} branches={branches} onAdded={loadUsers} />}
          </div>
  )
}
