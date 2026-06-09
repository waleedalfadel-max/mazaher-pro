import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { uploadAppLogo, fetchLogoUrl } from '../lib/appLogo'
import staticLogo from '../assets/logo.png'

const NAVY = '#0f2444'
const GOLD = '#c9a227'

export default function SuperAdmin() {
  const { switchProject } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [adding,    setAdding]   = useState(false)
  const [newName,   setNewName]  = useState('')
  const [saving,    setSaving]   = useState(false)
  const [msg,       setMsg]      = useState('')
  const [editingId,    setEditingId]    = useState(null)
  const [editName,     setEditName]     = useState('')
  const [logoUrl,      setLogoUrl]      = useState(staticLogo)
  const [logoUploading, setLogoUploading] = useState(false)
  const logoInputRef = useRef()

  useEffect(() => {
    loadProjects()
    fetchLogoUrl().then(url => { if (url) setLogoUrl(url) })
  }, [])

  async function loadProjects() {
    setLoading(true)
    const { data: projs } = await supabase
      .from('projects')
      .select('id, name, created_at')
      .order('created_at')

    if (!projs) { setLoading(false); return }

    // جلب إعدادات (active) وعدد المستخدمين وعدد القيود لكل مشروع
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

  async function renameProject(id) {
    if (!editName.trim()) return
    const { error } = await supabase.from('projects').update({ name: editName.trim() }).eq('id', id)
    if (error) { alert('خطأ: ' + error.message); return }
    setProjects(ps => ps.map(p => p.id === id ? { ...p, name: editName.trim() } : p))
    setEditingId(null); setEditName('')
  }

  async function toggleActive(proj) {
    const newActive = !proj.active
    const { error } = await supabase
      .from('project_settings')
      .upsert({ project_id: proj.id, active: newActive, settings: {} }, { onConflict: 'project_id' })
    if (error) { alert('خطأ: ' + error.message); return }
    setProjects(ps => ps.map(p => p.id === proj.id ? { ...p, active: newActive } : p))
  }

  async function addProject() {
    if (!newName.trim()) return
    setSaving(true); setMsg('')
    const { data, error } = await supabase
      .from('projects')
      .insert({ name: newName.trim() })
      .select('id, name, created_at')
      .single()
    if (error) { setMsg('خطأ: ' + error.message); setSaving(false); return }
    await supabase.from('project_settings').insert({
      project_id: data.id, settings: '{}', active: true,
    })
    setMsg('✅ تم إضافة المشروع')
    setNewName(''); setAdding(false); setSaving(false)
    loadProjects()
  }

  const fmt = d => d ? new Date(d).toLocaleDateString('ar-SA') : '—'

  if (loading) return (
    <div className="flex justify-center h-64 items-center">
      <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: GOLD, borderTopColor: 'transparent' }}/>
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
      <div className="bg-white rounded-2xl p-5 shadow-sm flex items-center gap-5 flex-wrap" style={{ border: '1px solid #e8e5dc' }}>
        <img src={logoUrl} onError={e => { e.target.src = staticLogo }}
          alt="لوقو التطبيق" className="h-16 w-auto object-contain rounded-xl" style={{ background: '#f5f4f0', padding: '8px' }} />
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
            <input
              type="text" value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addProject()}
              placeholder="اسم المشروع (مثال: المحمصة)"
              className="flex-1 border rounded-xl px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#d1c9b8' }}/>
            <button onClick={addProject} disabled={saving || !newName.trim()}
              className="px-5 py-2 rounded-xl text-sm font-bold disabled:opacity-50"
              style={{ background: NAVY, color: '#fff' }}>
              {saving ? 'جارٍ...' : 'حفظ'}
            </button>
          </div>
          {msg && <p className="text-sm mt-2 text-green-600">{msg}</p>}
          <p className="text-xs text-slate-400 mt-2">
            * بعد الإنشاء أضف المستخدمين والإعدادات من Supabase
          </p>
        </div>
      )}

      {/* قائمة العملاء */}
      <div className="space-y-3">
        {projects.map(p => (
          <div key={p.id} className="bg-white rounded-2xl p-5 shadow-sm flex items-center gap-4 flex-wrap"
            style={{ border: '1px solid #e8e5dc' }}>

            <div className="flex-1 min-w-0">
              {editingId === p.id ? (
                <div className="flex gap-2 items-center">
                  <input
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') renameProject(p.id); if (e.key === 'Escape') setEditingId(null) }}
                    className="border rounded-lg px-3 py-1.5 text-sm font-bold focus:outline-none"
                    style={{ borderColor: GOLD, color: NAVY, minWidth: 0, flex: 1 }}
                    dir="rtl"
                  />
                  <button onClick={() => renameProject(p.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={{ background: GOLD, color: NAVY }}>حفظ</button>
                  <button onClick={() => setEditingId(null)}
                    className="px-2 py-1.5 rounded-lg text-xs text-slate-400 hover:text-red-500">✕</button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold" style={{ color: NAVY }}>{p.name}</span>
                  <button onClick={() => { setEditingId(p.id); setEditName(p.name) }}
                    className="text-xs text-slate-400 hover:text-slate-600">✏️</button>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    p.active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                  }`}>
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

            <div className="flex gap-2 shrink-0">
              <button onClick={() => { switchProject(p.id, p.name); navigate('/') }}
                className="px-4 py-1.5 rounded-xl text-xs font-bold transition-all"
                style={{ background: NAVY, color: '#fff' }}>
                دخول ←
              </button>
              <button onClick={() => toggleActive(p)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                style={p.active
                  ? { background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }
                  : { background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }
                }>
                {p.active ? 'تعطيل' : 'تفعيل'}
              </button>
            </div>
          </div>
        ))}
      </div>

    </div>
  )
}
