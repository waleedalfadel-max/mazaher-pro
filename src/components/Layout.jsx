import React, { useState, useEffect } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import logo from '../assets/logo.png'

export default function Layout({ children }) {
  const { role, roleLabel, userName, logout } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()
  const [desktopOpen, setDesktopOpen] = useState(true)
  const [mobileOpen, setMobileOpen]   = useState(false)
  const [pendingCount, setPendingCount] = useState(0)

  // إغلاق الدرج عند تغيير الصفحة على الجوال
  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  useEffect(() => {
    if (role !== 'accountant') return
    fetchPendingCount()
    const timer = setInterval(fetchPendingCount, 30000)
    return () => clearInterval(timer)
  }, [role])

  async function fetchPendingCount() {
    const { data: proj } = await supabase
      .from('projects').select('id').eq('name', 'تحسيب-برو').maybeSingle()
    if (!proj) return
    const { count } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .in('status', ['uploaded', 'analyzed'])
      .eq('project_id', proj.id)
    setPendingCount(count || 0)
  }

  const NAV_ITEMS = [
    { to: '/',        label: 'لوحة التحكم',   icon: '📊', roles: ['owner', 'accountant'] },
    { to: '/cashier', label: 'لوحة الكاشير',  icon: '💰', roles: ['cashier'] },
    { to: '/reports', label: 'التقارير',       icon: '📈', roles: ['owner', 'accountant'] },
    { to: '/sales',   label: 'المبيعات',       icon: '💵', roles: ['owner', 'accountant'] },
    { to: '/ledger',  label: 'سجل الدفتر',    icon: '📒', roles: ['owner', 'accountant'] },
    { to: '/journal', label: 'سجل القيود',    icon: '📓', roles: ['owner', 'accountant'] },
    { to: '/archive', label: 'أرشيف القيود',  icon: '🗂️', roles: ['owner', 'accountant'] },
    { to: '/loans',   label: 'القروض',        icon: '🏦', roles: ['owner', 'accountant'] },
    { to: '/pending', label: 'مستندات جديدة', icon: '🔔', roles: ['accountant'], badge: pendingCount },
    { to: '/users',   label: 'المستخدمون',    icon: '👥', roles: ['owner'] },
  ]

  const UPLOAD_ROLES = ['purchasing', 'accountant', 'owner', 'cashier']
  const visibleItems = NAV_ITEMS.filter(item => item.roles.includes(role))

  function handleLogout() { logout(); navigate('/login') }

  const navLinkClass = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-3 rounded-xl transition-colors text-sm font-medium
    ${isActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`

  const SidebarContent = ({ collapsed }) => (
    <>
      {/* Logo */}
      <div className="flex items-center justify-center px-4 py-4 border-b border-slate-700">
        {collapsed
          ? <img src={logo} alt="تحسيب برو" className="h-8 w-8 object-contain" />
          : <img src={logo} alt="تحسيب برو" className="h-14 w-auto object-contain" />
        }
      </div>

      {/* Role Badge */}
      {!collapsed && (
        <div className="mx-3 mt-4 mb-2 px-3 py-2 bg-slate-800 rounded-lg">
          <div className="text-white font-medium text-sm">{userName}</div>
          <div className="text-blue-400 text-xs mt-0.5">{roleLabel}</div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {visibleItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/' || item.to === '/cashier'}
            className={navLinkClass}
          >
            <span className="text-lg shrink-0">{item.icon}</span>
            {!collapsed && <span className="flex-1">{item.label}</span>}
            {item.badge > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
                {item.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Bottom */}
      <div className="px-2 pb-4 border-t border-slate-700 pt-3 space-y-1">
        {UPLOAD_ROLES.includes(role) && (
          <NavLink to="/invoice"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-3 rounded-xl transition-colors text-sm font-bold w-full
              ${isActive ? 'bg-emerald-700 text-white' : 'bg-emerald-500 hover:bg-emerald-400 text-white'}`
            }
          >
            <span className="text-lg shrink-0">📤</span>
            {!collapsed && <span className="flex-1">رفع مستند</span>}
          </NavLink>
        )}
        {/* طي القائمة — على الديسكتوب فقط */}
        <button
          onClick={() => setDesktopOpen(v => !v)}
          className="hidden md:flex w-full items-center gap-3 px-3 py-3 rounded-xl text-slate-400 hover:bg-slate-800 hover:text-white transition-colors text-sm"
        >
          <span className="text-lg shrink-0">{collapsed ? '▶' : '◀'}</span>
          {!collapsed && <span>طي القائمة</span>}
        </button>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-slate-400 hover:bg-red-900 hover:text-red-300 transition-colors text-sm"
        >
          <span className="text-lg shrink-0">🚪</span>
          {!collapsed && <span>خروج</span>}
        </button>
      </div>
    </>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100" dir="rtl">

      {/* ── ديسكتوب: شريط جانبي ثابت ── */}
      <aside className={`
        hidden md:flex flex-col shrink-0
        ${desktopOpen ? 'w-64' : 'w-16'}
        transition-all duration-300 bg-slate-900
      `}>
        <SidebarContent collapsed={!desktopOpen} />
      </aside>

      {/* ── جوال: طبقة خلفية عند فتح الدرج ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── جوال: درج جانبي ── */}
      <aside className={`
        fixed inset-y-0 right-0 z-50 w-72 bg-slate-900 flex flex-col
        transition-transform duration-300 md:hidden
        ${mobileOpen ? 'translate-x-0' : 'translate-x-full'}
      `}>
        <SidebarContent collapsed={false} />
      </aside>

      {/* ── المحتوى الرئيسي ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* شريط علوي للجوال */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 shrink-0">
          <img src={logo} alt="تحسيب برو" className="h-9 w-auto object-contain" />
          <div className="flex items-center gap-3">
            {pendingCount > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {pendingCount}
              </span>
            )}
            <button
              onClick={() => setMobileOpen(v => !v)}
              className="w-10 h-10 flex flex-col items-center justify-center gap-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <span className="block w-5 h-0.5 bg-slate-700 rounded"/>
              <span className="block w-5 h-0.5 bg-slate-700 rounded"/>
              <span className="block w-5 h-0.5 bg-slate-700 rounded"/>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="p-3 sm:p-6 max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
