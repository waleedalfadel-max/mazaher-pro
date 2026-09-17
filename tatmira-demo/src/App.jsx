import React, { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { StoreProvider, useStore } from './store.jsx'
import { Card, NAVY, TEAL } from './components/ui.jsx'
import { OWNER_ID, ROLES, documentsFor, isOwner } from './lib/permissions.js'
import logo from '../../public/شعار تحسيب الجديد.png'
import Dashboard from './pages/Dashboard.jsx'
import Customers from './pages/Customers.jsx'
import CustomerDetail from './pages/CustomerDetail.jsx'
import Upload from './pages/Upload.jsx'
import Documents from './pages/Documents.jsx'
import ReviewDocument from './pages/ReviewDocument.jsx'
import Reports from './pages/Reports.jsx'
import Settings from './pages/Settings.jsx'
import Employees from './pages/Employees.jsx'

const OWNER_NAV = [
  { to: '/',          label: 'لوحة المالك', short: 'الرئيسية', icon: '📊', end: true },
  { to: '/customers', label: 'العملاء',     short: 'العملاء',  icon: '🏪' },
  { to: '/upload',    label: 'رفع مستند',   short: 'رفع',      icon: '📤', primary: true },
  { to: '/documents', label: 'المستندات والمراجعة', short: 'المراجعة', icon: '🔔', badge: true },
  { to: '/reports',   label: 'التقارير',    short: 'التقارير', icon: '📈' },
  { to: '/settings',  label: 'الإعدادات',   short: 'الإعدادات', icon: '⚙️' },
]

// الموظف المحدود: رفع المستندات المسموحة ومتابعة مستنداته فقط
const LIMITED_NAV = [
  { to: '/upload',    label: 'رفع مستند',   short: 'رفع',      icon: '📤', primary: true },
  { to: '/documents', label: 'مستنداتي',    short: 'مستنداتي', icon: '📂' },
]

function OwnerRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/customers" element={<Customers />} />
      <Route path="/customers/:id" element={<CustomerDetail />} />
      <Route path="/upload" element={<Upload />} />
      <Route path="/documents" element={<Documents />} />
      <Route path="/documents/:id" element={<ReviewDocument />} />
      <Route path="/reports" element={<Reports />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/settings/employees" element={<Employees />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function LimitedRoutes() {
  return (
    <Routes>
      <Route path="/upload" element={<Upload />} />
      <Route path="/documents" element={<Documents />} />
      <Route path="/documents/:id" element={<ReviewDocument />} />
      <Route path="*" element={<Navigate to="/upload" replace />} />
    </Routes>
  )
}

function DisabledEmployee({ actor }) {
  return (
    <Card className="p-6 text-center">
      <div className="text-3xl mb-2">⛔</div>
      <div className="font-extrabold" style={{ color: NAVY }}>{actor.name} معطّل</div>
      <p className="text-sm mt-1" style={{ color: '#5A7A8A' }}>لا يستطيع رفع مستندات أو متابعتها حتى يعيد المالك تفعيله.</p>
    </Card>
  )
}

function Shell() {
  const { state, storageOk, actor, setActing } = useStore()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const owner = isOwner(actor)
  const nav = !actor.active ? [] : owner ? OWNER_NAV : LIMITED_NAV
  const pending = owner ? state.documents.filter(d => d.status === 'pending').length : 0
  const myCount = !owner ? documentsFor(state, actor).length : 0

  useEffect(() => { document.querySelector('main')?.scrollTo(0, 0) }, [location.pathname])

  return (
    <div className="flex h-[100dvh] overflow-hidden print-root" style={{ background: '#F4F8F7' }} dir="rtl">
      {/* ديسكتوب: قائمة جانبية بنمط تحسيب */}
      <aside className={`hidden md:flex flex-col shrink-0 no-print transition-all ${collapsed ? 'w-16' : 'w-64'}`} style={{ background: NAVY }}>
        <div className="px-4 pt-5 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <img src={logo} alt="تحسيب" style={{ height: collapsed ? 28 : 36, objectFit: 'contain' }} />
        </div>
        {!collapsed && (
          <div className="mx-3 mt-4 mb-1 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(110,183,176,0.15)', border: '1px solid rgba(110,183,176,0.3)' }}>
            <div className="text-xs mb-1 font-bold" style={{ color: TEAL }}>{state.lab.name}</div>
            <div className="text-white font-semibold text-sm">{actor.name}</div>
            <div className="text-xs mt-0.5" style={{ color: 'rgba(110,183,176,0.8)' }}>{ROLES[actor.role]?.label} — نموذج تجريبي</div>
          </div>
        )}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto scrollbar-thin">
          {nav.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium"
              style={({ isActive }) => isActive ? { background: TEAL, color: '#fff' } : { color: 'rgba(255,255,255,0.65)' }}>
              <span className="text-base">{item.icon}</span>
              {!collapsed && <span className="flex-1">{item.label}</span>}
              {item.badge && pending > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">{pending}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <button onClick={() => setCollapsed(v => !v)} className="mx-2 mb-4 px-3 py-2.5 rounded-xl text-sm text-right" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {collapsed ? '▶' : '◀ طي القائمة'}
        </button>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* جوال: شريط علوي */}
        <header className="md:hidden flex items-center justify-between px-4 py-2.5 shrink-0 shadow-sm no-print"
          style={{ background: '#fff', borderBottom: `3px solid ${TEAL}` }}>
          <img src={logo} alt="تحسيب" style={{ height: 28, objectFit: 'contain' }} />
          <span className="text-sm font-extrabold truncate" style={{ color: NAVY }}>{state.lab.name}</span>
        </header>

        {/* شريط دائم: نموذج تجريبي */}
        <div className="px-4 py-1.5 text-xs font-bold text-center shrink-0 no-print" style={{ background: '#FEF3C7', color: '#92400E', borderBottom: '1px solid #FCD34D' }}>
          نموذج تجريبي — بيانات وهمية محفوظة على هذا الجهاز فقط، ولا ترتبط بأي حساب أو نظام فعلي
          {!storageOk && <span className="block text-red-700">تعذّر الحفظ على الجهاز — ستضيع التعديلات عند إغلاق الصفحة</span>}
        </div>

        {/* معاينة دور موظف — محاكاة */}
        {!owner && (
          <div className="flex items-center justify-between gap-2 px-4 py-2 text-xs font-bold shrink-0 no-print"
            style={{ background: '#EDE9FE', color: '#5B21B6', borderBottom: '1px solid #C4B5FD' }}>
            <span>👁️ معاينة بدور «{actor.name}» ({ROLES[actor.role]?.label}) — محاكاة، ليست حساباً محمياً</span>
            <button onClick={() => setActing(OWNER_ID)} className="px-2.5 py-1 rounded-lg shrink-0" style={{ background: '#5B21B6', color: '#fff' }}>
              ارجع للمالك
            </button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto">
          <div className="p-3 sm:p-6 max-w-5xl mx-auto pb-28 md:pb-8">
            {!actor.active ? <DisabledEmployee actor={actor} /> : owner ? <OwnerRoutes /> : <LimitedRoutes />}
          </div>
        </main>

        {/* جوال: شريط تنقل سفلي */}
        {nav.length > 0 && (
          <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-border grid no-print"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)', gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
            {nav.map(item => (
              <NavLink key={item.to} to={item.to} end={item.end}
                className="relative flex flex-col items-center justify-center py-2 text-[11px] font-bold"
                style={({ isActive }) => ({ color: isActive ? TEAL : '#5A7A8A' })}>
                {item.primary
                  ? <span className="w-10 h-10 -mt-5 rounded-full flex items-center justify-center text-lg shadow-md" style={{ background: TEAL }}>{item.icon}</span>
                  : <span className="text-lg leading-none">{item.icon}</span>}
                <span className="mt-0.5 whitespace-nowrap">{item.short}</span>
                {item.badge && pending > 0 && (
                  <span className="absolute top-1 left-1/2 ml-2 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">{pending}</span>
                )}
                {item.to === '/documents' && !owner && myCount > 0 && (
                  <span className="absolute top-1 left-1/2 ml-2 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center" style={{ background: NAVY }}>{myCount}</span>
                )}
              </NavLink>
            ))}
          </nav>
        )}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}
