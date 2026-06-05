import React, { createContext, useContext, useState } from 'react'

const DEFAULT_PINS = {
  owner:      import.meta.env.VITE_PIN_OWNER      || '11111',
  accountant: import.meta.env.VITE_PIN_ACCOUNTANT || '22222',
  purchasing: import.meta.env.VITE_PIN_PURCHASING || '33333',
  cashier:    import.meta.env.VITE_PIN_CASHIER    || '44444',
}

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

function loadPins() {
  try {
    const stored = localStorage.getItem('mz_custom_pins')
    if (stored) return { ...DEFAULT_PINS, ...JSON.parse(stored) }
  } catch {}
  return { ...DEFAULT_PINS }
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [role, setRole]   = useState(() => sessionStorage.getItem('mz_role') || null)
  const [pins, setPins]   = useState(loadPins)

  function login(pin) {
    const map = {}
    Object.entries(pins).forEach(([r, p]) => { map[p] = r })
    const r = map[pin]
    if (!r) return null
    setRole(r)
    sessionStorage.setItem('mz_role', r)
    return r
  }

  function logout() {
    setRole(null)
    sessionStorage.removeItem('mz_role')
  }

  function updatePin(roleName, newPin) {
    const updated = { ...pins, [roleName]: newPin }
    setPins(updated)
    localStorage.setItem('mz_custom_pins', JSON.stringify(updated))
  }

  const canEdit      = role === 'accountant'
  const isOwner      = role === 'owner'
  const isPurchasing = role === 'purchasing'
  const isCashier    = role === 'cashier'

  return (
    <AuthContext.Provider value={{
      role,
      roleLabel: ROLE_LABELS[role],
      login, logout,
      canEdit, isOwner, isPurchasing, isCashier,
      pins, updatePin,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
