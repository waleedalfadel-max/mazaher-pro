import React, { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { StoreProvider, useStore } from './store.jsx'
import { Card, NAVY, TEAL } from './components/ui.jsx'
import { OWNER_ID, ROLES, actorRoleLabel, can, documentsFor, isOwner } from './lib/permissions.js'
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

const ALL_NAV = [
  { to: '/',          label: 'لوحة المالك', short: 'الرئيسية', icon: '📊', end: true },
  { to: '/customers', label: 'العملاء',     short: 'العملاء',  icon: '🏪' },
  { to: '/upload',    label: 'رفع مستند',   short: 'رفع',      icon: '📤', primary: true },
  { to: '/documents', label: 'المستندات والمراجعة', short: 'المراجعة', icon: '🔔', badge: true },
  { to: '/reports',   label: 'التقارير',    short: 'التقارير', icon: '📈' },
  { to: '/settings',  label: 'الإعدادات',   short: 'الإعدادات', icon: '⚙️' },
]

function AppRoutes({ EmployeesPage = Employees }) {
  const { actor } = useStore()
  const financials = can(actor, 'viewFinancials')
  const customers = can(actor, 'manageCustomers') || financials
  const upload = ['sale', 'payment', 'purchase'].some(kind => can(actor, 'upload', kind))
  const documents = can(actor, 'ownDocuments') || upload || can(actor, 'review') || financials
  const owner = isOwner(actor)
  const fallback = financials ? '/' : upload ? '/upload' : documents ? '/documents' : customers ? '/customers' : '/no-access'
  return (
    <Routes>
      <Route path="/" element={financials ? <Dashboard /> : <Navigate to={fallback} replace />} />
      <Route path="/customers" element={customers ? <Customers /> : <Navigate to={fallback} replace />} />
      <Route path="/customers/:id" element={customers ? <CustomerDetail /> : <Navigate to={fallback} replace />} />
      <Route path="/upload" element={upload ? <Upload /> : <Navigate to={fallback} replace />} />
      <Route path="/documents" element={documents ? <Documents /> : <Navigate to={fallback} replace />} />
      <Route path="/documents/:id" element={documents ? <ReviewDocument /> : <Navigate to={fallback} replace />} />
      <Route path="/reports" element={financials ? <Reports /> : <Navigate to={fallback} replace />} />
      <Route path="/settings" element={owner ? <Settings /> : <Navigate to={fallback} replace />} />
      <Route path="/settings/employees" element={owner ? <EmployeesPage /> : <Navigate to={fallback} replace />} />
      <Route path="/no-access" element={<Card className="p-6 text-center">لا توجد صلاحيات تشغيل مفعّلة لهذا الحساب. راجع المالك.</Card>} />
      <Route path="*" element={<Navigate to={fallback} replace />} />
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

export function Shell({ onLogout, EmployeesPage = Employees }) {
  const { state, storageOk, actor, setActing, remote = false, error: storeError, message: storeMessage, busy = false } = useStore()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const owner = isOwner(actor)
  const nav = !actor.active ? [] : ALL_NAV.filter(item => {
    if (item.to === '/') return can(actor, 'viewFinancials')
    if (item.to === '/customers') return can(actor, 'manageCustomers') || can(actor, 'viewFinancials')
    if (item.to === '/upload') return ['sale', 'payment', 'purchase'].some(kind => can(actor, 'upload', kind))
    if (item.to === '/documents') return can(actor, 'ownDocuments') || ['sale', 'payment', 'purchase'].some(kind => can(actor, 'upload', kind)) || can(actor, 'review') || can(actor, 'viewFinancials')
    if (item.to === '/reports') return can(actor, 'viewFinancials')
    if (item.to === '/settings') return owner
    return false
  }).map(item => item.to === '/documents' && !can(actor, 'review')
    ? { ...item, label: 'مستنداتي', short: 'مستنداتي', icon: '📂', badge: false }
    : item)
  const pending = can(actor, 'review') ? state.documents.filter(d => d.status === 'pending').length : 0
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
            <div className="text-xs mt-0.5" style={{ color: 'rgba(110,183,176,0.8)' }}>{remote ? actorRoleLabel(actor) : `${ROLES[actor.role]?.label} — نموذج تجريبي`}</div>
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
        {remote && onLogout && (
          <button disabled={busy} onClick={onLogout} className="mx-2 mb-2 px-3 py-2.5 rounded-xl text-sm text-right" style={{ color: 'rgba(255,255,255,0.7)' }}>
            ↩ تسجيل الخروج
          </button>
        )}
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
          {remote && onLogout && <button disabled={busy} onClick={onLogout} className="text-xs font-bold px-2 py-1 rounded-lg" style={{ color: NAVY, background: '#EEF4F3' }}>خروج</button>}
        </header>

        {!remote && <div className="px-4 py-1.5 text-xs font-bold text-center shrink-0 no-print" style={{ background: '#FEF3C7', color: '#92400E', borderBottom: '1px solid #FCD34D' }}>
          نموذج تجريبي — بيانات وهمية محفوظة على هذا الجهاز فقط، ولا ترتبط بأي حساب أو نظام فعلي
          {!storageOk && <span className="block text-red-700">تعذّر الحفظ على الجهاز — ستضيع التعديلات عند إغلاق الصفحة</span>}
        </div>}

        {remote && (storeError || storeMessage) && (
          <div role={storeError ? 'alert' : 'status'} className="px-4 py-2 text-xs font-bold text-center shrink-0 no-print"
            style={{ background: storeError ? '#FDECEC' : '#E8F5F4', color: storeError ? '#991B1B' : '#166534', borderBottom: '1px solid #D4E8E6' }}>
            {storeError || storeMessage}
          </div>
        )}

        {/* معاينة دور موظف — محاكاة */}
        {!remote && !owner && (
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
            {!actor.active ? <DisabledEmployee actor={actor} /> : <AppRoutes EmployeesPage={EmployeesPage} />}
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
                {item.to === '/documents' && !can(actor, 'review') && !can(actor, 'viewFinancials') && myCount > 0 && (
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
