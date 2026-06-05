import React, { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const NAV_ITEMS = [
  { to: '/',        label: 'لوحة التحكم',     icon: '📊', roles: ['owner', 'accountant'] },
  { to: '/cashier', label: 'لوحة الكاشير',    icon: '💰', roles: ['cashier'] },
  { to: '/pending', label: 'مستندات جديدة',   icon: '🔔', roles: ['accountant'] },
  { to: '/ledger',  label: 'الدفتر',           icon: '📒', roles: ['owner', 'accountant'] },
  { to: '/sales',   label: 'المبيعات',         icon: '💵', roles: ['owner', 'accountant'] },
  { to: '/journal',  label: 'سجل القيود',      icon: '📓', roles: ['owner', 'accountant'] },
  { to: '/journals', label: 'القيود المعلقة', icon: '📋', roles: ['owner', 'accountant'] },
  { to: '/reports', label: 'التقارير',         icon: '📈', roles: ['owner', 'accountant'] },
  { to: '/loans',   label: 'القروض',           icon: '🏦', roles: ['owner', 'accountant'] },
  { to: '/invoice', label: 'رفع مستند',        icon: '📤', roles: ['purchasing', 'accountant', 'owner', 'cashier'] },
  { to: '/users',   label: 'المستخدمون',       icon: '👥', roles: ['owner'] },
]

export default function Layout({ children }) {
  const { role, roleLabel, logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const visibleItems = NAV_ITEMS.filter(item => item.roles.includes(role))

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100" dir="rtl">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-16'} transition-all duration-300 bg-slate-900 flex flex-col shrink-0`}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-slate-700">
          <div className="w-9 h-9 bg-blue-500 rounded-lg flex items-center justify-center text-white font-bold text-lg shrink-0">ت</div>
          {sidebarOpen && (
            <div>
              <div className="text-white font-bold text-sm leading-tight">تحسيب برو</div>
              <div className="text-slate-400 text-xs">نظام المحاسبة</div>
            </div>
          )}
        </div>

        {/* Role Badge */}
        {sidebarOpen && (
          <div className="mx-3 mt-4 mb-2 px-3 py-2 bg-slate-800 rounded-lg">
            <div className="text-slate-400 text-xs mb-1">الدور الحالي</div>
            <div className="text-blue-400 font-medium text-sm">{roleLabel}</div>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto scrollbar-thin">
          {visibleItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/' || item.to === '/cashier'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm font-medium
                ${isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <span className="text-base shrink-0">{item.icon}</span>
              {sidebarOpen && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Bottom */}
        <div className="px-2 pb-4 border-t border-slate-700 pt-3 space-y-1">
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors text-sm"
          >
            <span className="text-base shrink-0">{sidebarOpen ? '◀' : '▶'}</span>
            {sidebarOpen && <span>طي القائمة</span>}
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-400 hover:bg-red-900 hover:text-red-300 transition-colors text-sm"
          >
            <span className="text-base shrink-0">🚪</span>
            {sidebarOpen && <span>خروج</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
