import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { uploadAppLogo, fetchLogoUrl } from '../lib/appLogo'
import { clearProjectCache } from '../lib/projectSettings'
import staticLogo from '../assets/logo.png'

const NAVY = '#0f2444'
const GOLD = '#c9a227'

const ROLES = [
  { value: 'owner',      label: 'المالك' },
  { value: 'accountant', label: 'المحاسب' },
  { value: 'purchasing', label: 'مسؤول المشتريات' },
  { value: 'cashier',    label: 'الكاشير' },
]

const ROLE_COLORS = {
  owner:      { bg: '#eff6ff', color: '#1d4ed8' },
  accountant: { bg: '#f0fdf4', color: '#15803d' },
  purchasing: { bg: '#fff7ed', color: '#c2410c' },
  cashier:    { bg: '#fdf4ff', color: '#7e22ce' },
}

function UserRow({ user, onSave, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: user.name, role: user.role, pin: user.pin, branch: user.branch || '' })
  const [showPin, setShowPin] = useState(false)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!form.name.trim() || !form.pin.trim()) return
    setSaving(true)
    await onSave(user.id, form)
    setSaving(false)
    setEditing(false)
  }

  const roleStyle = ROLE_COLORS[user.role] || { bg: '#f1f5f9', color: '#475569' }
  const roleLabel = ROLES.find(r => r.value === user.role)?.label || user.role

  if (editing) return (
    <div className="flex items-center gap-2 py-2 flex-wrap">
      <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        placeholder="الاسم" dir="rtl"
        className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none w-32"
        style={{ borderColor: GOLD }} />
      <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
        className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none"
        style={{ borderColor: '#d1c9b8' }}>
        {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
      <input value={form.branch} onChange={e => setForm(f => ({ ...f, branch: e.target.value }))}
        placeholder="الفرع (اختياري)" dir="rtl"
        className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none w-32"
        style={{ borderColor: '#d1c9b8' }} />
      <div className="flex items-center gap-1">
        <input value={form.pin} onChange={e => setForm(f => ({ ...f, pin: e.target.value }))}
          type={showPin ? 'text' : 'password'}
          placeholder="الرمز" dir="ltr"
          className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none w-20"
          style={{ borderColor: '#d1c9b8' }} />
        <button onClick={() => setShowPin(v => !v)} className="text-slate-400 hover:text-slate-600 text-xs px-1">
          {showPin ? '🙈' : '👁'}
        </button>
      </div>
      <button onClick={save} disabled={saving}
        className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50"
        style={{ background: GOLD, color: NAVY }}>
        {saving ? '...' : 'حفظ'}
      </button>
      <button onClick={() => setEditing(false)} className="text-xs text-slate-400 hover:text-red-500 px-1">✕</button>
    </div>
  )

  return (
    <div className="flex items-center gap-3 py-2 border-b last:border-0" style={{ borderColor: '#f0ede6' }}>
      <div className="flex-1 min-w-0">
        <span className="font-medium text-sm" style={{ color: NAVY }}>{user.name}</span>
        {user.branch && (
          <span className="text-xs text-slate-400 mr-2">🏢 {user.branch}</span>
        )}
      </div>
      <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
        style={{ background: roleStyle.bg, color: roleStyle.color }}>
        {roleLabel}
      </span>
      <span className="text-xs font-mono text-slate-400 w-14 text-center">
        {showPin ? user.pin : '••••'}
      </span>
      <button onClick={() => setShowPin(v => !v)} className="text-slate-300 hover:text-slate-500 text-xs">
        {showPin ? '🙈' : '👁'}
      </button>
      <button onClick={() => setEditing(true)} className="text-slate-300 hover:text-slate-600 text-xs">✏️</button>
      <button onClick={() => onDelete(user.id)}
        className="text-slate-300 hover:text-red-500 text-xs transition-colors">🗑</button>
    </div>
  )
}

function AddUserRow({ projectId, onAdded }) {
  const [form, setForm] = useState({ name: '', role: 'accountant', pin: '', branch: '' })
  const [showPin, setShowPin] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function add() {
    if (!form.name.trim() || !form.pin.trim()) { setErr('الاسم والرمز مطلوبان'); return }
    setSaving(true); setErr('')
    const { error } = await supabase.from('app_users')
      .insert({ project_id: projectId, name: form.name.trim(), role: form.role, pin: form.pin.trim(), branch: form.branch.trim() || null })
    if (error) { setErr(error.message); setSaving(false); return }
    setForm({ name: '', role: 'accountant', pin: '', branch: '' })
    setSaving(false)
    onAdded()
  }

  return (
    <div className="pt-3 mt-1" style={{ borderTop: '1px dashed #e2ddd4' }}>
      <div className="text-xs font-bold mb-2" style={{ color: NAVY }}>إضافة مستخدم</div>
      <div className="flex items-center gap-2 flex-wrap">
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="الاسم" dir="rtl"
          className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none w-32"
          style={{ borderColor: '#d1c9b8' }} />
        <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
          className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none"
          style={{ borderColor: '#d1c9b8' }}>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <input value={form.branch} onChange={e => setForm(f => ({ ...f, branch: e.target.value }))}
          placeholder="الفرع (للكاشير)" dir="rtl"
          className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none w-32"
          style={{ borderColor: '#d1c9b8' }} />
        <div className="flex items-center gap-1">
          <input value={form.pin} onChange={e => setForm(f => ({ ...f, pin: e.target.value }))}
            type={showPin ? 'text' : 'password'}
            placeholder="الرمز" dir="ltr"
            className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none w-20"
            style={{ borderColor: '#d1c9b8' }} />
          <button onClick={() => setShowPin(v => !v)} className="text-slate-400 hover:text-slate-600 text-xs px-1">
            {showPin ? '🙈' : '👁'}
          </button>
        </div>
        <button onClick={add} disabled={saving || !form.name.trim() || !form.pin.trim()}
          className="px-4 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40 transition-all"
          style={{ background: NAVY, color: '#fff' }}>
          {saving ? '...' : '+ إضافة'}
        </button>
      </div>
      {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
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

function ProjectCard({ p, onRename, onToggleActive, onEnter }) {
  const [editingName, setEditingName] = useState(false)
  const [editName, setEditName]       = useState('')
  const [activeTab, setActiveTab]     = useState(null) // null | 'users' | 'settings'
  const [users, setUsers]             = useState([])
  const [loadingUsers, setLoadingUsers] = useState(false)

  async function loadUsers() {
    setLoadingUsers(true)
    const { data } = await supabase.from('app_users')
      .select('id, name, role, pin, branch')
      .eq('project_id', p.id)
      .order('role')
    setUsers(data || [])
    setLoadingUsers(false)
  }

  function openTab(tab) {
    if (activeTab === tab) { setActiveTab(null); return }
    if (tab === 'users' && activeTab !== 'users') loadUsers()
    setActiveTab(tab)
  }

  async function saveUser(id, form) {
    await supabase.from('app_users')
      .update({ name: form.name.trim(), role: form.role, pin: form.pin.trim(), branch: form.branch?.trim() || null })
      .eq('id', id)
    setUsers(us => us.map(u => u.id === id ? { ...u, ...form } : u))
  }

  async function deleteUser(id) {
    if (!confirm('حذف هذا المستخدم؟')) return
    await supabase.from('app_users').delete().eq('id', id)
    setUsers(us => us.filter(u => u.id !== id))
  }

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
            <span>👥 {p.userCount} مستخدم</span>
            <span>📋 {p.entryCount} قيد</span>
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
              ? { background: 'rgba(201,162,39,0.15)', color: GOLD }
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
        <div className="px-5 pb-5" style={{ borderTop: '1px solid #f0ede6' }}>
          <div className="pt-4">
            {loadingUsers ? (
              <div className="flex justify-center py-4">
                <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: GOLD, borderTopColor: 'transparent' }} />
              </div>
            ) : users.length === 0 ? (
              <p className="text-xs text-slate-400 py-2">لا يوجد مستخدمون</p>
            ) : (
              <div>
                <div className="flex items-center gap-3 pb-1 text-xs font-bold text-slate-400">
                  <span className="flex-1">الاسم</span>
                  <span className="w-24">الدور</span>
                  <span className="w-14 text-center">الرمز</span>
                  <span className="w-16"></span>
                </div>
                {users.map(u => (
                  <UserRow key={u.id} user={u} onSave={saveUser} onDelete={deleteUser} />
                ))}
              </div>
            )}
            <AddUserRow projectId={p.id} onAdded={loadUsers} />
          </div>
        </div>
      )}

      {/* قسم الإعدادات */}
      {activeTab === 'settings' && (
        <div className="px-5 pb-5" style={{ borderTop: '1px solid #f0ede6' }}>
          <div className="pt-4">
            <SettingsSection projectId={p.id} />
          </div>
        </div>
      )}
    </div>
  )
}

export default function SuperAdmin() {
  const { switchProject } = useAuth()
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

  async function loadProjects() {
    setLoading(true)
    const { data: projs } = await supabase
      .from('projects').select('id, name, created_at').order('created_at')
    if (!projs) { setLoading(false); return }

    const [{ data: settings }, { data: users }, { data: entries }] = await Promise.all([
      supabase.from('project_settings').select('project_id, active'),
      supabase.from('app_users').select('project_id').not('project_id', 'is', null),
      supabase.from('ledger_entries').select('project_id'),
    ])

    const settingsMap = {}
    ;(settings || []).forEach(s => { settingsMap[s.project_id] = s.active })
    const userCount = {}
    ;(users || []).forEach(u => { userCount[u.project_id] = (userCount[u.project_id] || 0) + 1 })
    const entryCount = {}
    ;(entries || []).forEach(e => { entryCount[e.project_id] = (entryCount[e.project_id] || 0) + 1 })

    setProjects(projs.map(p => ({
      ...p,
      active:     settingsMap[p.id] !== false,
      userCount:  userCount[p.id]  || 0,
      entryCount: entryCount[p.id] || 0,
    })))
    setLoading(false)
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

      {/* قائمة العملاء */}
      <div className="space-y-3">
        {projects.map(p => (
          <ProjectCard
            key={p.id}
            p={p}
            onRename={renameProject}
            onToggleActive={toggleActive}
            onEnter={(id, name) => { switchProject(id, name); navigate('/') }}
          />
        ))}
      </div>

    </div>
  )
}
