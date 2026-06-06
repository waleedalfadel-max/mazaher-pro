import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const ROLE_LABELS = { owner: 'المالك', accountant: 'المحاسب', purchasing: 'مسؤول المشتريات', cashier: 'الكاشير' }
const ROLE_ICONS  = { owner: '👑', accountant: '📊', purchasing: '🛒', cashier: '💰' }
const ROLE_COLORS = {
  owner:      'bg-amber-100 text-amber-700',
  accountant: 'bg-purple-100 text-purple-700',
  purchasing: 'bg-blue-100 text-blue-700',
  cashier:    'bg-green-100 text-green-700',
}

const EMPTY_FORM = { name: '', role: 'cashier', pin: '', pinConfirm: '' }

export default function UsersManagement() {
  const { projectId, userName } = useAuth()
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [form,    setForm]    = useState(EMPTY_FORM)
  const [editing, setEditing] = useState(null) // user id being edited
  const [editPin, setEditPin] = useState({ pin: '', pinConfirm: '' })
  const [err,     setErr]     = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => { if (projectId) load() }, [projectId])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('app_users')
      .select('id,name,role,created_at')
      .eq('project_id', projectId)
      .order('created_at')
    setUsers(data || [])
    setLoading(false)
  }

  function flash(msg) { setSuccess(msg); setTimeout(() => setSuccess(''), 3000) }
  function clearErr()  { setErr('') }

  async function addUser() {
    setErr('')
    if (!form.name.trim())          return setErr('أدخل اسم المستخدم')
    if (!/^\d{4,8}$/.test(form.pin)) return setErr('رمز الدخول يجب أن يكون 4-8 أرقام')
    if (form.pin !== form.pinConfirm) return setErr('رمزا الدخول غير متطابقين')

    // check pin uniqueness
    const { data: dup } = await supabase
      .from('app_users').select('id').eq('project_id', projectId).eq('pin', form.pin).maybeSingle()
    if (dup) return setErr('هذا الرمز مستخدم بالفعل')

    const { error } = await supabase.from('app_users').insert({
      project_id: projectId,
      name: form.name.trim(),
      role: form.role,
      pin:  form.pin,
    })
    if (error) return setErr(error.message)
    setForm(EMPTY_FORM)
    flash(`تم إضافة ${form.name.trim()} بنجاح`)
    load()
  }

  async function savePin(user) {
    setErr('')
    if (!/^\d{4,8}$/.test(editPin.pin))       return setErr('رمز الدخول يجب أن يكون 4-8 أرقام')
    if (editPin.pin !== editPin.pinConfirm)    return setErr('رمزا الدخول غير متطابقين')

    const { data: dup } = await supabase
      .from('app_users').select('id').eq('project_id', projectId).eq('pin', editPin.pin).neq('id', user.id).maybeSingle()
    if (dup) return setErr('هذا الرمز مستخدم بالفعل')

    const { error } = await supabase.from('app_users').update({ pin: editPin.pin }).eq('id', user.id)
    if (error) return setErr(error.message)
    setEditing(null)
    setEditPin({ pin: '', pinConfirm: '' })
    flash(`تم تحديث رمز ${user.name}`)
  }

  async function deleteUser(user) {
    if (user.name === userName) return setErr('لا يمكنك حذف حسابك الحالي')
    if (!confirm(`حذف المستخدم "${user.name}"؟`)) return
    const { error } = await supabase.from('app_users').delete().eq('id', user.id)
    if (error) return setErr(error.message)
    flash(`تم حذف ${user.name}`)
    load()
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">إدارة المستخدمين</h1>
        <p className="text-slate-500 text-sm mt-1">إضافة وتعديل وحذف مستخدمي النظام</p>
      </div>

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-green-700 text-sm font-medium text-center">
          ✅ {success}
        </div>
      )}
      {err && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm font-medium text-center">
          ❌ {err}
        </div>
      )}

      {/* Add user form */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-4">
        <h2 className="font-bold text-slate-800">➕ إضافة مستخدم جديد</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">الاسم</label>
            <input
              value={form.name}
              onChange={e => { setForm(f => ({ ...f, name: e.target.value })); clearErr() }}
              placeholder="اسم الموظف"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">الصلاحية</label>
            <select
              value={form.role}
              onChange={e => { setForm(f => ({ ...f, role: e.target.value })); clearErr() }}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {Object.entries(ROLE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{ROLE_ICONS[k]} {v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">رمز الدخول (4-8 أرقام)</label>
            <input
              type="password" inputMode="numeric" maxLength={8}
              value={form.pin}
              onChange={e => { setForm(f => ({ ...f, pin: e.target.value.replace(/\D/g,'').slice(0,8) })); clearErr() }}
              placeholder="••••"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">تأكيد رمز الدخول</label>
            <input
              type="password" inputMode="numeric" maxLength={8}
              value={form.pinConfirm}
              onChange={e => { setForm(f => ({ ...f, pinConfirm: e.target.value.replace(/\D/g,'').slice(0,8) })); clearErr() }}
              placeholder="••••"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>
        <button onClick={addUser}
          className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">
          إضافة المستخدم
        </button>
      </div>

      {/* Users list */}
      <div className="space-y-3">
        <h2 className="font-bold text-slate-700">المستخدمون ({users.length})</h2>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-7 h-7 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/>
          </div>
        ) : users.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 py-12 text-center text-slate-400">
            <p className="text-3xl mb-2">👥</p>
            <p>لا يوجد مستخدمون</p>
          </div>
        ) : users.map(user => (
          <div key={user.id} className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{ROLE_ICONS[user.role]}</span>
                <div>
                  <div className="font-semibold text-slate-800 flex items-center gap-2">
                    {user.name}
                    {user.name === userName && (
                      <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">أنت</span>
                    )}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[user.role]}`}>
                    {ROLE_LABELS[user.role]}
                  </span>
                </div>
              </div>
              {editing !== user.id && (
                <div className="flex gap-2">
                  <button onClick={() => { setEditing(user.id); setEditPin({ pin:'', pinConfirm:'' }); clearErr() }}
                    className="text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-200 transition-colors font-medium">
                    تغيير الرمز
                  </button>
                  {user.name !== userName && (
                    <button onClick={() => deleteUser(user)}
                      className="text-xs bg-red-50 text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-600 hover:text-white transition-colors font-medium">
                      حذف
                    </button>
                  )}
                </div>
              )}
            </div>

            {editing === user.id && (
              <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">الرمز الجديد</label>
                    <input
                      type="password" inputMode="numeric" maxLength={8}
                      value={editPin.pin}
                      onChange={e => { setEditPin(p => ({ ...p, pin: e.target.value.replace(/\D/g,'').slice(0,8) })); clearErr() }}
                      placeholder="••••"
                      autoFocus
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">تأكيد الرمز</label>
                    <input
                      type="password" inputMode="numeric" maxLength={8}
                      value={editPin.pinConfirm}
                      onChange={e => { setEditPin(p => ({ ...p, pinConfirm: e.target.value.replace(/\D/g,'').slice(0,8) })); clearErr() }}
                      placeholder="••••"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => savePin(user)}
                    className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
                    حفظ
                  </button>
                  <button onClick={() => { setEditing(null); clearErr() }}
                    className="flex-1 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors">
                    إلغاء
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-700">
        ⚠️ احتفظ برموز الدخول في مكان آمن. لا يمكن استرجاع الرمز المنسي إلا من هنا.
      </div>
    </div>
  )
}
