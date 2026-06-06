import React, { useState } from 'react'
import { useAuth, ROLE_LABELS, ROLE_ICONS } from '../contexts/AuthContext'

const ROLES = ['owner', 'accountant', 'purchasing', 'cashier']

export default function UsersManagement() {
  const { pins, updatePin } = useAuth()
  const [editing, setEditing] = useState(null) // { role, value }
  const [saved, setSaved]     = useState('')
  const [err, setErr]         = useState('')

  function startEdit(role) {
    setEditing({ role, value: '' })
    setErr(''); setSaved('')
  }

  function confirmSave() {
    if (!editing) return
    const { role, value } = editing
    if (!/^\d{4}$/.test(value)) { setErr('PIN يجب أن يكون 4 أرقام'); return }
    // Make sure PIN isn't already used by another role
    const conflict = ROLES.find(r => r !== role && pins[r] === value)
    if (conflict) { setErr(`هذا الـ PIN مستخدم بالفعل لـ ${ROLE_LABELS[conflict]}`); return }
    updatePin(role, value)
    setSaved(ROLE_LABELS[role])
    setEditing(null); setErr('')
    setTimeout(() => setSaved(''), 2500)
  }

  return (
    <div className="space-y-5 max-w-xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">إدارة المستخدمين</h1>
        <p className="text-slate-500 text-sm mt-1">تعديل رموز الدخول لكل دور</p>
      </div>

      {saved && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-green-700 text-sm text-center font-medium">
          ✅ تم تحديث PIN {saved}
        </div>
      )}

      <div className="space-y-3">
        {ROLES.map(role => (
          <div key={role} className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{ROLE_ICONS[role]}</span>
                <div>
                  <div className="font-semibold text-slate-800">{ROLE_LABELS[role]}</div>
                  <div className="text-xs text-slate-400 font-mono mt-0.5">
                    PIN الحالي: <span className="text-slate-600">•••••</span>
                  </div>
                </div>
              </div>
              {editing?.role !== role && (
                <button onClick={() => startEdit(role)}
                  className="text-xs bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg font-medium hover:bg-blue-100 transition-colors">
                  تعديل PIN
                </button>
              )}
            </div>

            {editing?.role === role && (
              <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">PIN الجديد (5 أرقام)</label>
                  <input
                    type="password" inputMode="numeric" maxLength={4}
                    placeholder="••••"
                    value={editing.value}
                    onChange={e => {
                      setErr('')
                      setEditing(ed => ({ ...ed, value: e.target.value.replace(/\D/g, '').slice(0, 5) }))
                    }}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 tracking-widest"
                    autoFocus
                  />
                </div>
                {err && <p className="text-red-600 text-xs">❌ {err}</p>}
                <div className="flex gap-2">
                  <button onClick={confirmSave}
                    className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
                    حفظ
                  </button>
                  <button onClick={() => { setEditing(null); setErr('') }}
                    className="flex-1 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors">
                    إلغاء
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700 leading-relaxed">
        ⚠️ رموز الدخول تُحفظ على هذا الجهاز. عند تغيير PIN، أبلغ الموظف المعني بالرمز الجديد.
      </div>
    </div>
  )
}
