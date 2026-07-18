import React, { useState, useEffect } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

const NAVY  = '#1B3A5C'
const TEAL  = '#6EB7B0'

export default function Layout({ children }) {
  const { role, roleLabel, userName, projectId, projectName, isSuperAdmin, modules, logout } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()
  const [desktopOpen, setDesktopOpen] = useState(true)
  const [mobileOpen, setMobileOpen]   = useState(false)
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  useEffect(() => {
    if (role !== 'accountant' && !isSuperAdmin) return
    if (!isSuperAdmin && !projectId) return
    fetchPendingCount()
    const timer = setInterval(fetchPendingCount, 30000)
    return () => clearInterval(timer)
  }, [role, projectId, isSuperAdmin])

  async function fetchPendingCount() {
    let q = supabase.from('documents')
      .select('id', { count: 'exact', head: true })
      .in('status', ['uploaded', 'analyzed'])
    if (!isSuperAdmin && projectId) q = q.eq('project_id', projectId)
    const { count } = await q
    setPendingCount(count || 0)
  }

  const NAV_ITEMS = [
    { to: '/',                label: 'لوحة التحكم',      icon: '📊', roles: ['owner', 'accountant'] },
    { to: '/cashier',         label: 'لوحة الكاشير',     icon: '💰', roles: ['cashier'] },
    { to: '/reports',         label: 'التقارير',          icon: '📈', roles: ['owner', 'accountant', 'superadmin'] },
{ to: '/roastery-sales',  label: 'مبيعات المحمصة 🏭', icon: '🏭', roles: ['accountant'], cond: n => n === 'محمصة كون' },
    { to: '/suppliers',       label: 'الموردين',          icon: '🏪', roles: ['accountant'], module: 'suppliers' },
    { to: '/ledger',          label: 'سجل الدفتر',       icon: '📒', roles: ['accountant', 'superadmin'] },
    { to: '/journal',         label: 'سجل الحركات',      icon: '📓', roles: ['accountant', 'superadmin'] },
    { to: '/archive',         label: 'أرشيف الحركات',    icon: '🗂️', roles: ['owner', 'accountant', 'superadmin'] },
    { to: '/loans',           label: 'القروض',           icon: '🏦', roles: ['accountant', 'superadmin'] },
    { to: '/bank-reconciliation', label: 'المطابقة البنكية', icon: '🧮', roles: ['accountant', 'superadmin'], cond: n => n === 'ديوانية مزاهر' },
    { to: '/pending',         label: 'مستندات جديدة',    icon: '🔔', roles: ['accountant', 'superadmin'], badge: pendingCount },
    { to: '/users',           label: 'المستخدمون',       icon: '👥', roles: ['accountant'] },
    { to: '/admin',           label: 'إدارة العملاء',    icon: '⚙️', roles: ['superadmin'] },
  ]

  const UPLOAD_ROLES = ['purchasing', 'accountant', 'cashier', 'owner']
  const visibleItems = NAV_ITEMS.filter(item =>
    item.roles.includes(role) &&
    (!item.module || modules.includes(item.module)) &&
    (!item.cond || item.cond(projectName))
  )

  function handleLogout() { logout(); navigate('/login') }

  const SidebarContent = ({ collapsed }) => (
    <>
      {/* Logo */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', padding: collapsed ? '16px 10px' : '0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: collapsed ? '4px 2px' : '20px 16px 16px' }}>
          <img
            src="/شعار تحسيب الجديد.png"
            alt="تحسيب"
            style={{ height: collapsed ? '32px' : '38px', objectFit: 'contain' }}
            onError={e => { e.target.style.display = 'none' }}
          />
        </div>
      </div>

      {/* Role Badge */}
      {!collapsed && (
        <div className="mx-3 mt-4 mb-1 px-3 py-2.5 rounded-xl"
          style={{ background: 'rgba(110,183,176,0.15)', border: '1px solid rgba(110,183,176,0.3)' }}>
          {projectName && (
            <div className="text-xs mb-1 font-bold" style={{ color: TEAL }}>{projectName}</div>
          )}
          <div className="text-white font-semibold text-sm">{userName}</div>
          <div className="text-xs mt-0.5" style={{ color: 'rgba(110,183,176,0.8)' }}>{roleLabel}</div>
        </div>
      )}

      {/* زر رجوع للإدارة — يظهر للـ superadmin فقط عندما يكون داخل مشروع */}
      {isSuperAdmin && projectId && !collapsed && (
        <div className="px-2 pb-2">
          <button onClick={() => navigate('/admin')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all"
            style={{ background: 'rgba(110,183,176,0.15)', color: TEAL, border: '1px solid rgba(110,183,176,0.3)' }}>
            ← رجوع لإدارة العملاء
          </button>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto scrollbar-thin">
        {visibleItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/' || item.to === '/cashier'}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 text-sm font-medium group relative"
            style={({ isActive }) => isActive
              ? { background: TEAL, color: '#ffffff' }
              : { color: 'rgba(255,255,255,0.6)' }
            }
            onMouseEnter={e => { if (!e.currentTarget.style.background.includes(TEAL.slice(1))) e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
            onMouseLeave={e => { if (!e.currentTarget.style.background.includes(TEAL.slice(1))) e.currentTarget.style.background = '' }}
          >
            <span className="text-base shrink-0">{item.icon}</span>
            {!collapsed && <span className="flex-1">{item.label}</span>}
            {item.badge > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {item.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Bottom */}
      <div className="px-2 pb-4 pt-3 space-y-1 shrink-0"
        style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        {UPLOAD_ROLES.includes(role) && (
          <NavLink to="/invoice"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm font-bold w-full"
            style={({ isActive }) => ({
              background: isActive ? '#4A9E97' : TEAL,
              color: '#ffffff',
            })}
          >
            <span className="text-base shrink-0">📤</span>
            {!collapsed && <span className="flex-1">رفع مستند</span>}
          </NavLink>
        )}
        <button
          onClick={() => setDesktopOpen(v => !v)}
          className="hidden md:flex w-full items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm"
          style={{ color: 'rgba(255,255,255,0.45)' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
          onMouseLeave={e => e.currentTarget.style.background = ''}
        >
          <span className="text-base shrink-0">{collapsed ? '▶' : '◀'}</span>
          {!collapsed && <span>طي القائمة</span>}
        </button>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm"
          style={{ color: 'rgba(255,255,255,0.45)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(220,38,38,0.2)'; e.currentTarget.style.color = '#fca5a5' }}
          onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'rgba(255,255,255,0.45)' }}
        >
          <span className="text-base shrink-0">🚪</span>
          {!collapsed && <span>خروج</span>}
        </button>
      </div>
    </>
  )

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#F4F8F7' }} dir="rtl">

      {/* ── ديسكتوب ── */}
      <aside className={`hidden md:flex flex-col shrink-0 transition-all duration-300 ${desktopOpen ? 'w-64' : 'w-16'}`}
        style={{ background: NAVY }}>
        <SidebarContent collapsed={!desktopOpen} />
      </aside>

      {/* ── جوال: خلفية ── */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setMobileOpen(false)} />
      )}

      {/* ── جوال: درج ── */}
      <aside className={`fixed inset-y-0 right-0 z-50 w-72 flex flex-col transition-transform duration-300 md:hidden ${mobileOpen ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ background: NAVY }}>
        <SidebarContent collapsed={false} />
      </aside>

      {/* ── المحتوى ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* شريط علوي — جوال فقط */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 shrink-0 shadow-sm"
          style={{ background: '#fff', borderBottom: `3px solid ${TEAL}` }}>
          <img
            src="/شعار تحسيب الجديد.png"
            alt="تحسيب"
            style={{ height: '32px', objectFit: 'contain' }}
            onError={e => { e.target.style.display = 'none' }}
          />
          <div className="flex items-center gap-3">
            {pendingCount > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {pendingCount}
              </span>
            )}
            <button onClick={() => setMobileOpen(v => !v)}
              className="w-10 h-10 flex flex-col items-center justify-center gap-1.5 rounded-xl transition-colors"
              style={{ background: '#EEF4F3' }}>
              <span className="block w-5 h-0.5 rounded" style={{ background: NAVY }}/>
              <span className="block w-5 h-0.5 rounded" style={{ background: NAVY }}/>
              <span className="block w-5 h-0.5 rounded" style={{ background: NAVY }}/>
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
