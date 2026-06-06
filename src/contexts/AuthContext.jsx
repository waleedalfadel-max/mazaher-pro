import React, { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export const ROLE_LABELS = {
  owner:      'المالك',
  accountant: 'المحاسب',
  purchasing: 'مسؤول المشتريات',
  cashier:    'الكاشير',
}

export const ROLE_ICONS = {
  owner:      '👑',
  accountant: '📊',
  purchasing: '🛒',
  cashier:    '💰',
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [role,     setRole]     = useState(() => sessionStorage.getItem('mz_role') || null)
  const [userName, setUserName] = useState(() => sessionStorage.getItem('mz_user') || null)
  const [projectId, setProjectId] = useState(null)

  useEffect(() => {
    supabase.from('projects').select('id').eq('name', 'تحسيب-برو').maybeSingle()
      .then(({ data }) => { if (data) setProjectId(data.id) })
  }, [])

  async function login(pin) {
    const { data: proj } = await supabase
      .from('projects').select('id').eq('name', 'تحسيب-برو').maybeSingle()
    if (!proj) return null

    const { data: user } = await supabase
      .from('app_users')
      .select('name, role')
      .eq('project_id', proj.id)
      .eq('pin', pin)
      .maybeSingle()

    if (!user) return null
    setRole(user.role)
    setUserName(user.name)
    sessionStorage.setItem('mz_role', user.role)
    sessionStorage.setItem('mz_user', user.name)
    return user.role
  }

  function logout() {
    setRole(null)
    setUserName(null)
    sessionStorage.removeItem('mz_role')
    sessionStorage.removeItem('mz_user')
  }

  return (
    <AuthContext.Provider value={{
      role, userName, projectId,
      roleLabel:    ROLE_LABELS[role],
      login, logout,
      canEdit:      role === 'accountant',
      isOwner:      role === 'owner',
      isPurchasing: role === 'purchasing',
      isCashier:    role === 'cashier',
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
