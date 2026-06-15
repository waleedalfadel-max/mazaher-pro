import React, { createContext, useContext, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getProjectModules } from '../lib/projectSettings'

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
  const [role,        setRole]        = useState(() => sessionStorage.getItem('mz_role')   || null)
  const [userName,    setUserName]    = useState(() => sessionStorage.getItem('mz_user')   || null)
  const [projectId,   setProjectId]   = useState(() => sessionStorage.getItem('mz_pid')    || null)
  const [projectName, setProjectName] = useState(() => sessionStorage.getItem('mz_pname')  || null)
  const [branch,      setBranch]      = useState(() => sessionStorage.getItem('mz_branch') || null)
  const [modules,     setModules]     = useState(() => { try { return JSON.parse(sessionStorage.getItem('mz_modules') || '[]') } catch { return [] } })

  async function login(pin) {
    const { data: user } = await supabase
      .from('app_users')
      .select('name, role, project_id, branch')
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

    const mods = user.project_id ? await getProjectModules(user.project_id) : []

    setRole(user.role)
    setUserName(user.name)
    setProjectId(user.project_id || null)
    setProjectName(pName)
    setBranch(user.branch || null)
    setModules(mods)

    sessionStorage.setItem('mz_role',    user.role)
    sessionStorage.setItem('mz_user',    user.name)
    sessionStorage.setItem('mz_pid',     user.project_id || '')
    sessionStorage.setItem('mz_pname',   pName || '')
    sessionStorage.setItem('mz_branch',  user.branch || '')
    sessionStorage.setItem('mz_modules', JSON.stringify(mods))

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
    setBranch(null)
    setModules([])
    sessionStorage.removeItem('mz_role')
    sessionStorage.removeItem('mz_user')
    sessionStorage.removeItem('mz_pid')
    sessionStorage.removeItem('mz_pname')
    sessionStorage.removeItem('mz_branch')
    sessionStorage.removeItem('mz_modules')
  }

  return (
    <AuthContext.Provider value={{
      role, userName, projectId, projectName, branch, modules,
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
