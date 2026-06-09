import React, { createContext, useContext, useState } from 'react'
import { supabase } from '../lib/supabase'

export const ROLE_LABELS = {
  owner:      'المالك',
  accountant: 'المحاسب',
  purchasing: 'مسؤول المشتريات',
  cashier:    'الكاشير',
  superadmin: 'مزود الخدمة',
}

export const ROLE_ICONS = {
  owner:      '👑',
  accountant: '📊',
  purchasing: '🛒',
  cashier:    '💰',
  superadmin: '⚙️',
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [role,        setRole]        = useState(() => sessionStorage.getItem('mz_role')  || null)
  const [userName,    setUserName]    = useState(() => sessionStorage.getItem('mz_user')  || null)
  const [projectId,   setProjectId]   = useState(() => sessionStorage.getItem('mz_pid')   || null)
  const [projectName, setProjectName] = useState(() => sessionStorage.getItem('mz_pname') || null)

  async function login(pin) {
    // البحث بالـ PIN فقط — يعمل مع جميع المشاريع تلقائياً
    const { data: user } = await supabase
      .from('app_users')
      .select('name, role, project_id')
      .eq('pin', pin)
      .maybeSingle()

    if (!user) return null

    let pName = null
    if (user.project_id) {
      const { data: proj } = await supabase
        .from('projects')
        .select('name')
        .eq('id', user.project_id)
        .maybeSingle()
      pName = proj?.name || null
    }

    setRole(user.role)
    setUserName(user.name)
    setProjectId(user.project_id || null)
    setProjectName(pName)

    sessionStorage.setItem('mz_role',  user.role)
    sessionStorage.setItem('mz_user',  user.name)
    sessionStorage.setItem('mz_pid',   user.project_id || '')
    sessionStorage.setItem('mz_pname', pName || '')

    return user.role
  }

  function switchProject(id, name) {
    setProjectId(id)
    setProjectName(name)
    sessionStorage.setItem('mz_pid',   id   || '')
    sessionStorage.setItem('mz_pname', name || '')
  }

  function logout() {
    setRole(null)
    setUserName(null)
    setProjectId(null)
    setProjectName(null)
    sessionStorage.removeItem('mz_role')
    sessionStorage.removeItem('mz_user')
    sessionStorage.removeItem('mz_pid')
    sessionStorage.removeItem('mz_pname')
  }

  return (
    <AuthContext.Provider value={{
      role, userName, projectId, projectName,
      roleLabel:    ROLE_LABELS[role] || role,
      login, logout, switchProject,
      canEdit:      role === 'accountant' || role === 'superadmin',
      isOwner:      role === 'owner'      || role === 'superadmin',
      isPurchasing: role === 'purchasing',
      isCashier:    role === 'cashier',
      isSuperAdmin: role === 'superadmin',
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
