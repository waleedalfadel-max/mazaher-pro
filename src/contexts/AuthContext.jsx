import React, { createContext, useContext, useState } from 'react'

// fallback hardcoded so the app works even if env vars aren't set at build time
const PIN_OWNER      = import.meta.env.VITE_PIN_OWNER      || '1111'
const PIN_ACCOUNTANT = import.meta.env.VITE_PIN_ACCOUNTANT || '2222'
const PIN_PURCHASING = import.meta.env.VITE_PIN_PURCHASING || '3333'

const PINS = {
  [PIN_OWNER]:      'owner',
  [PIN_ACCOUNTANT]: 'accountant',
  [PIN_PURCHASING]: 'purchasing',
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
