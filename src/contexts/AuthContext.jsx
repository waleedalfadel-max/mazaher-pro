import React, { createContext, useContext, useState } from 'react'

const PINS = {
  [import.meta.env.VITE_PIN_OWNER]:      'owner',
  [import.meta.env.VITE_PIN_ACCOUNTANT]: 'accountant',
  [import.meta.env.VITE_PIN_PURCHASING]: 'purchasing',
}

const ROLE_LABELS = {
  owner:      'المالك',
  accountant: 'المحاسب',
  purchasing: 'مسؤول المشتريات',
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [role, setRole] = useState(() => sessionStorage.getItem('mz_role') || null)

  function login(pin) {
    const r = PINS[pin]
    if (!r) return false
    setRole(r)
    sessionStorage.setItem('mz_role', r)
    return true
  }

  function logout() {
    setRole(null)
    sessionStorage.removeItem('mz_role')
  }

  const canEdit  = role === 'accountant'
  const isOwner  = role === 'owner'
  const isPurchasing = role === 'purchasing'

  return (
    <AuthContext.Provider value={{ role, roleLabel: ROLE_LABELS[role], login, logout, canEdit, isOwner, isPurchasing }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
