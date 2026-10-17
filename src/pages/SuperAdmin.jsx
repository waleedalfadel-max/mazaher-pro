import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { adminCreateStaff, adminUpdateStaff, adminSetStaffPin, adminSetStaffActive, adminRemoveStaff } from '../lib/staffCredentials'
import { normalizePin } from '../lib/pinInput'
import { useAuth } from '../contexts/AuthContext'
import { uploadAppLogo, fetchLogoUrl } from '../lib/appLogo'
import { clearProjectCache } from '../lib/projectSettings'
import staticLogo from '../assets/logo.png'

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

function SettingsSection({ projectId }) {
  const [types, setTypes]       = useState(null)
  const [newLabel, setNewLabel] = useState('')
  const [saving, setSaving]     = useState(false)

  useEffect(() => { loadTypes() }, [projectId])

  async function loadTypes() {
    const { data } = await supabase
      .from('project_settings').select('settings').eq('project_id', projectId).maybeSingle()
    setTypes(data?.settings?.transaction_types || [])
  }

  async function saveTypes(updated) {
    setSaving(true)
    const { data: existing } = await supabase
      .from('project_settings').select('settings').eq('project_id', projectId).maybeSingle()
    const merged = { ...(existing?.settings || {}), transaction_types: updated }
    await supabase.from('project_settings')
      .upsert({ project_id: projectId, settings: merged }, { onConflict: 'project_id' })
    clearProjectCache(projectId)
    setTypes(updated)
    setSaving(false)
  }

  function addType() {
    const label = newLabel.trim()
    if (!label || !types) return
    setNewLabel('')
    saveTypes([...types, { label }])
  }

  function removeType(idx) {
    saveTypes(types.filter((_, i) => i !== idx))
  }

  if (types === null) return (
    <div className="flex justify-center py-4">
      <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: GOLD, borderTopColor: 'transparent' }} />
    </div>
  )

  return (
    <div>
      <div className="text-xs font-bold mb-3" style={{ color: NAVY }}>
        أنواع المعاملات
        <span className="font-normal text-slate-400 mr-2">({types.length} نوع)</span>
      </div>

      {types.length === 0 ? (
        <p className="text-xs text-slate-400 mb-3">لا توجد أنواع — سيُستخدم الافتراضي</p>
      ) : (
        <div className="space-y-1 mb-3 max-h-52 overflow-y-auto">
          {types.map((t, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg group"
              style={{ background: '#f8f7f3' }}>
              <span className="text-sm flex-1">{t.label}</span>
              <button onClick={() => removeType(i)}
                className="text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 text-xs">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2" style={{ borderTop: '1px dashed #e2ddd4', paddingTop: '12px' }}>
        <input
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addType()}
          placeholder="مثال: 💵 مبيعات كاش"
          dir="rtl"
          className="flex-1 border rounded-lg px-3 py-1.5 text-sm focus:outline-none"
          style={{ borderColor: '#d1c9b8' }}
        />
        <button onClick={addType} disabled={saving || !newLabel.trim()}
          className="px-4 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40 transition-all"
          style={{ background: NAVY, color: '#fff' }}>
          {saving ? '...' : '+ إضافة'}
        </button>
      </div>
    </div>
  )
}

function ProjectCard({ p, countsLoading, onRename, onToggleActive, onEnter }) {
  const [editingName, setEditingName] = useState(false)
  const [editName, setEditName]       = useState('')
  const [activeTab, setActiveTab]     = useState(null) // null | 'users' | 'settings'
  const [users, setUsers]             = useState([])
  const [usersState, setUsersState]   = useState('idle') // idle | loading | ready | error
  const [usersError, setUsersError]   = useState('')
  const [usersNotice, setUsersNotice] = useState('')   // نتيجة تعديل فشل، تبقى بعد إعادة التحميل
  const [usersInfo, setUsersInfo]     = useState('')   // نتيجة إجراء نجح (حذف، أرشفة، رمز جديد…)
  const [branches, setBranches]       = useState([])   // فروع المنشأة من الخادم (قائمة الفرع)
  const usersReq = useRef(0)

  // موظفو هذه المنشأة من الخادم (مدير منصة نشط وحده؛ بلا رموز). الفشل حالة مستقلة، لا قائمة فارغة.
  async function loadUsers() {
    const req = ++usersReq.current
    setUsersState('loading'); setUsersError(''); setUsers([])
    let res
    try {
      const { data, error } = await supabase.rpc('admin_project_users', { p_project_id: p.id })
      res = error ? { ok: false, code: 'network' } : data
    } catch { res = { ok: false, code: 'network' } }
    if (req !== usersReq.current) return   // رد متأخر لطلب أقدم
    if (res?.ok && res.project_id === p.id && Array.isArray(res.members)) {
      setUsers(res.members); setBranches(Array.isArray(res.branches) ? res.branches : []); setUsersState('ready')
    } else {
      setUsersError(ADMIN_USERS_ERRORS[res?.code] || ADMIN_USERS_ERRORS.network); setUsersState('error')
    }
  }

  function openTab(tab) {
    setUsersNotice(''); setUsersInfo('')
    if (activeTab === tab) { setActiveTab(null); return }
    if (tab === 'users' && activeTab !== 'users') loadUsers()
    setActiveTab(tab)
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
  const setPin = (id, pin) => act(() => adminSetStaffPin(supabase, id, pin), d => d?.sessions === 'sessions_deleted'
    ? 'عُيّن الرمز الجديد وحُذفت جلسات الحساب (الجلسة المفتوحة الآن تنتهي خلال ساعة على الأكثر).' : 'عُيّن الرمز الجديد، والرمز القديم يُرفض، وأُلغيت جلسات الحساب.')
  const setActive = (id, active) => act(() => adminSetStaffActive(supabase, id, active), () => active ? 'أُعيد تفعيل الحساب.' : 'عُطّل الحساب، ولا يستطيع الدخول أو مواصلة الاستخدام.')
  const removeUser = id => act(() => adminRemoveStaff(supabase, id), d => d?.result === 'deleted'
    ? 'حُذف الحساب (لم تكن له عمليات).' : 'لم يُحذف لأن له عمليات أو ارتباطات مسجلة: أُرشف ومُنع دخوله، ويبقى اسمه وتاريخه في السجلات.')

  const fmt = d => d ? new Date(d).toLocaleDateString('en-GB') : '—'

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: '1px solid #e8e5dc' }}>

      {/* رأس البطاقة */}
      <div className="p-5 flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="flex gap-2 items-center">
              <input autoFocus value={editName}
                onChange={e => setEditName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { onRename(p.id, editName); setEditingName(false) } if (e.key === 'Escape') setEditingName(false) }}
                className="border rounded-lg px-3 py-1.5 text-sm font-bold focus:outline-none flex-1"
                style={{ borderColor: GOLD, color: NAVY }} dir="rtl" />
              <button onClick={() => { onRename(p.id, editName); setEditingName(false) }}
                className="px-3 py-1.5 rounded-lg text-xs font-bold"
                style={{ background: GOLD, color: NAVY }}>حفظ</button>
              <button onClick={() => setEditingName(false)} className="text-xs text-slate-400 hover:text-red-500">✕</button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold" style={{ color: NAVY }}>{p.name}</span>
              <button onClick={() => { setEditingName(true); setEditName(p.name) }}
                className="text-xs text-slate-400 hover:text-slate-600">✏️</button>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${p.active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                {p.active ? '● نشط' : '○ معطّل'}
              </span>
            </div>
          )}
          <div className="flex gap-4 mt-1 text-xs text-slate-400 flex-wrap">
            <span data-user-count>👥 {countsLoading ? '…' : p.userCount == null ? '—' : p.userCount} مستخدم</span>
            <span data-entry-count>📋 {countsLoading ? '…' : p.entryCount == null ? '—' : p.entryCount} قيد</span>
            <span>📅 منذ {fmt(p.created_at)}</span>
          </div>
        </div>

        <div className="flex gap-2 shrink-0 flex-wrap">
          <button onClick={() => openTab('users')}
            className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
            style={activeTab === 'users'
              ? { background: 'rgba(15,36,68,0.1)', color: NAVY }
              : { background: '#f5f4f0', color: '#64748b' }}>
            {activeTab === 'users' ? '▲ إخفاء' : '👥 المستخدمون'}
          </button>
          <button onClick={() => openTab('settings')}
            className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
            style={activeTab === 'settings'
              ? { background: 'rgba(110,183,176,0.15)', color: GOLD }
              : { background: '#f5f4f0', color: '#64748b' }}>
            {activeTab === 'settings' ? '▲ إخفاء' : '⚙️ الأنواع'}
          </button>
          <button onClick={() => onEnter(p.id, p.name)}
            className="px-4 py-1.5 rounded-xl text-xs font-bold transition-all"
            style={{ background: NAVY, color: '#fff' }}>
            دخول ←
          </button>
          <button onClick={() => onToggleActive(p)}
            className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
            style={p.active
              ? { background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }
              : { background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
            {p.active ? 'تعطيل' : 'تفعيل'}
          </button>
        </div>
      </div>

      {/* قسم المستخدمين */}
      {activeTab === 'users' && (
        <div className="px-5 pb-5" style={{ borderTop: '1px solid #D4E8E6' }}>
          <div className="pt-4">
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
                {usersNotice && <p className="text-xs text-red-600 pb-2" role="alert" data-users-notice>{usersNotice}</p>}
                {usersInfo && <p className="text-xs text-emerald-700 pb-2" role="status" data-users-info>{usersInfo}</p>}
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
            <AddUserRow projectId={p.id} branches={branches} onAdded={loadUsers} />
          </div>
        </div>
      )}

      {/* قسم الإعدادات */}
      {activeTab === 'settings' && (
        <div className="px-5 pb-5" style={{ borderTop: '1px solid #D4E8E6' }}>
          <div className="pt-4">
            <SettingsSection projectId={p.id} />
          </div>
        </div>
      )}
    </div>
  )
}

export default function SuperAdmin() {
  const { enterProjectView } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects]         = useState([])
  const [loading,  setLoading]          = useState(true)
  const [adding,   setAdding]           = useState(false)
  const [newName,  setNewName]          = useState('')
  const [saving,   setSaving]           = useState(false)
  const [msg,      setMsg]              = useState('')
  const [logoUrl,  setLogoUrl]          = useState(staticLogo)
  const [logoUploading, setLogoUploading] = useState(false)
  const logoInputRef = useRef()

  useEffect(() => {
    loadProjects()
    fetchLogoUrl().then(url => { if (url) setLogoUrl(url) })
  }, [])

  // أرقام المنشآت من دالتي خادم لمدير المنصة وحده (مجاميع فقط؛ قراءة الدفاتر مباشرة محصورة في منشأة الجلسة، فكانت تعطي صفرًا).
  // إن تعذّر رقم يُعرض «—» ورسالة وإعادة محاولة، لا صفر.
  const [countsState, setCountsState] = useState('loading')   // loading | ready | error
  async function fetchCounts() {
    const call = fn => supabase.rpc(fn).then(r => (!r.error && r.data?.ok === true ? r.data.counts || {} : null), () => null)
    const [users, entries] = await Promise.all([call('admin_project_user_counts'), call('admin_project_entry_counts')])
    return {
      userCount: users ? Object.fromEntries(Object.entries(users).map(([id, c]) => [id, c.total])) : null,
      entryCount: entries,
    }
  }
  const withCounts = (list, { userCount, entryCount }) => list.map(p => ({
    ...p,
    userCount:  userCount ? (userCount[p.id] || 0) : null,
    entryCount: entryCount ? (entryCount[p.id] || 0) : null,
  }))

  async function loadProjects() {
    setLoading(true)
    const { data: projs } = await supabase
      .from('projects').select('id, name, created_at').order('created_at')
    if (!projs) { setLoading(false); return }

    const [{ data: settings }, counts] = await Promise.all([
      supabase.from('project_settings').select('project_id, active'),
      fetchCounts(),
    ])

    const settingsMap = {}
    ;(settings || []).forEach(s => { settingsMap[s.project_id] = s.active })
    setProjects(withCounts(projs.map(p => ({ ...p, active: settingsMap[p.id] !== false })), counts))
    setCountsState(counts.userCount && counts.entryCount ? 'ready' : 'error')
    setLoading(false)
  }

  async function retryCounts() {
    setCountsState('loading')
    const counts = await fetchCounts()
    setProjects(ps => withCounts(ps, counts))
    setCountsState(counts.userCount && counts.entryCount ? 'ready' : 'error')
  }

  async function handleLogoChange(e) {
    const file = e.target.files[0]
    if (!file) return
    setLogoUploading(true)
    try {
      const url = await uploadAppLogo(file)
      setLogoUrl(url)
    } catch(err) { alert('فشل الرفع: ' + err.message) }
    setLogoUploading(false)
  }

  async function renameProject(id, name) {
    if (!name.trim()) return
    const { error } = await supabase.from('projects').update({ name: name.trim() }).eq('id', id)
    if (error) { alert('خطأ: ' + error.message); return }
    setProjects(ps => ps.map(p => p.id === id ? { ...p, name: name.trim() } : p))
  }

  async function toggleActive(proj) {
    const newActive = !proj.active
    const { error } = await supabase.from('project_settings')
      .upsert({ project_id: proj.id, active: newActive, settings: {} }, { onConflict: 'project_id' })
    if (error) { alert('خطأ: ' + error.message); return }
    setProjects(ps => ps.map(p => p.id === proj.id ? { ...p, active: newActive } : p))
  }

  async function addProject() {
    if (!newName.trim()) return
    setSaving(true); setMsg('')
    const { data, error } = await supabase.from('projects')
      .insert({ name: newName.trim() }).select('id, name, created_at').single()
    if (error) { setMsg('خطأ: ' + error.message); setSaving(false); return }
    await supabase.from('project_settings').insert({ project_id: data.id, settings: '{}', active: true })
    setMsg('✅ تم إضافة المشروع')
    setNewName(''); setAdding(false); setSaving(false)
    loadProjects()
  }

  if (loading) return (
    <div className="flex justify-center h-64 items-center">
      <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: GOLD, borderTopColor: 'transparent' }} />
    </div>
  )

  return (
    <div className="space-y-6 max-w-4xl mx-auto">

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: NAVY }}>⚙️ لوحة تحكم مزود الخدمة</h1>
          <p className="text-sm text-slate-500 mt-1">{projects.length} عميل مسجل</p>
        </div>
        <button onClick={() => setAdding(a => !a)}
          className="px-4 py-2 rounded-xl text-sm font-bold transition-all"
          style={{ background: GOLD, color: NAVY }}>
          {adding ? '✕ إلغاء' : '+ إضافة عميل'}
        </button>
      </div>

      {/* لوقو التطبيق */}
      <div className="bg-white rounded-2xl p-5 shadow-sm flex items-center gap-5 flex-wrap"
        style={{ border: '1px solid #e8e5dc' }}>
        <img src={logoUrl} onError={e => { e.target.src = staticLogo }}
          alt="لوقو التطبيق" className="h-16 w-auto object-contain rounded-xl"
          style={{ background: '#f5f4f0', padding: '8px' }} />
        <div className="flex-1">
          <div className="font-bold text-sm mb-1" style={{ color: NAVY }}>لوقو التطبيق</div>
          <div className="text-xs text-slate-400 mb-3">PNG أو JPG — يُطبَّق على جميع الصفحات فور الرفع</div>
          <button onClick={() => logoInputRef.current.click()} disabled={logoUploading}
            className="px-4 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
            style={{ background: GOLD, color: NAVY }}>
            {logoUploading ? 'جارٍ الرفع...' : '📷 تغيير اللوقو'}
          </button>
          <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
        </div>
      </div>

      {/* نموذج إضافة عميل */}
      {adding && (
        <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ border: `2px solid ${GOLD}` }}>
          <h2 className="font-bold text-sm mb-3" style={{ color: NAVY }}>إضافة عميل جديد</h2>
          <div className="flex gap-3">
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addProject()}
              placeholder="اسم المشروع (مثال: المحمصة)"
              className="flex-1 border rounded-xl px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#d1c9b8' }} />
            <button onClick={addProject} disabled={saving || !newName.trim()}
              className="px-5 py-2 rounded-xl text-sm font-bold disabled:opacity-50"
              style={{ background: NAVY, color: '#fff' }}>
              {saving ? 'جارٍ...' : 'حفظ'}
            </button>
          </div>
          {msg && <p className="text-sm mt-2 text-green-600">{msg}</p>}
        </div>
      )}

      {/* أرقام المنشآت: رسالة وإعادة محاولة بدل صفر مضلل */}
      {countsState === 'error' && (
        <div className="flex items-center gap-3 rounded-xl px-4 py-3 flex-wrap" role="alert" data-counts-state="error"
          style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
          <p className="text-sm text-red-700 flex-1">تعذّر تحميل أرقام المنشآت (المستخدمون والقيود). الأرقام غير المتاحة تظهر «—».</p>
          <button onClick={retryCounts} className="px-3 py-1.5 rounded-lg text-xs font-bold"
            style={{ background: NAVY, color: '#fff' }}>إعادة المحاولة</button>
        </div>
      )}

      {/* قائمة العملاء */}
      <div className="space-y-3" data-counts-state={countsState}>
        {projects.map(p => (
          <ProjectCard
            key={p.id}
            p={p}
            countsLoading={countsState === 'loading'}
            onRename={renameProject}
            onToggleActive={toggleActive}
            onEnter={(id, name) => { enterProjectView(id, name); navigate('/') }}
          />
        ))}
      </div>

    </div>
  )
}
