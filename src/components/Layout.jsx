import React, { useState, useEffect } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  Archive, ArrowLeft, BookOpen, ChartColumn, ChartLine, Eye, FileText, House, Landmark, LogOut, Menu, NotebookText,
  PanelRightClose, PanelRightOpen, Scale, Settings, Smartphone, Store, TriangleAlert, Upload, Users,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Brand, Button, Dialog } from '../ui/components.jsx'
import VersionNotice from './VersionNotice.jsx'
import { operatesBusiness } from '../lib/adminAccess'

// إدارة تحسيب ترى أدوات المنشأة كاملة بعد التحقق من سياقها. أدوار المنشأة ووحداتها تبقى كما كانت.
// الكاشير، مثل المشتريات، يرفع المستندات من زر الرفع وحده.
function navItems(pendingCount) {
  return [
    { to: '/',                label: 'لوحة التحكم',      icon: House,        roles: ['owner', 'accountant', 'superadmin'] },
    { to: '/accounts', label: 'كشف الحسابات', icon: Landmark, roles: ['owner', 'accountant', 'superadmin'] },
    { to: '/reports',         label: 'التقارير',          icon: ChartColumn,  roles: ['owner', 'accountant', 'superadmin'] },
    { to: '/analysis',        label: 'التحليل المالي',   icon: ChartLine,    roles: ['owner', 'accountant', 'superadmin'] },
    { to: '/suppliers',       label: 'الموردين',          icon: Store,        roles: ['accountant', 'owner', 'superadmin'], module: 'suppliers' },
    { to: '/ledger',          label: 'سجل الدفتر',       icon: BookOpen,     roles: ['accountant', 'superadmin'] },
    { to: '/journal',         label: 'سجل الحركات',      icon: NotebookText, roles: ['accountant', 'superadmin'] },
    { to: '/archive',         label: 'أرشيف الحركات',    icon: Archive,      roles: ['owner', 'accountant', 'superadmin'] },
    { to: '/loans',           label: 'القروض',           icon: Landmark,     roles: ['accountant', 'superadmin'] },
    { to: '/bank-reconciliation', label: 'المطابقة البنكية', icon: Scale,    roles: ['accountant', 'superadmin'] },
    { to: '/app-reconciliation', label: 'مطابقة التطبيقات', icon: Smartphone, roles: ['accountant', 'superadmin'], module: 'app_reconciliation' },
    { to: '/pending',         label: 'مستندات جديدة',    icon: FileText,     roles: ['accountant', 'superadmin'], badge: pendingCount },
    { to: '/users',           label: 'المستخدمون',       icon: Users,        roles: ['accountant', 'superadmin'] },
    { to: '/admin',           label: 'إدارة العملاء',    icon: Settings,     roles: ['superadmin'] },
    { to: '/settings',        label: 'الإعدادات',        icon: Settings,     roles: ['owner', 'superadmin'] },
  ]
}
const UPLOAD_ROLES = ['purchasing', 'accountant', 'cashier', 'owner', 'superadmin']
const PREVIEW_ROLES = [
  { r: 'owner', label: 'المالك' }, { r: 'accountant', label: 'المحاسب' },
  { r: 'cashier', label: 'الكاشير' }, { r: 'purchasing', label: 'المشتريات' },
]
const endMatch = to => to === '/'

// رفض عرض المنشأة لمدير المنصة (admin_view_project) — رسالة واضحة بدل أرقام صفرية
const VIEW_ERRORS = {
  forbidden: 'لا تملك صلاحية عرض بيانات المنشآت.',
  no_session: 'انتهت الجلسة أو أُوقف الحساب. سجّل الدخول من جديد.',
  not_found: 'المنشأة غير موجودة.',
  view_not_applied: 'تعذّر تفعيل عرض المنشأة في الخادم.',
  network: 'تعذّر تحميل بيانات المنشأة. تحقق من الاتصال وأعد المحاولة.',
}

export default function Layout({ children }) {
  const { role, roleLabel, userName, projectId, projectName, isSuperAdmin, modules, logout,
          canImpersonate, isImpersonating, startImpersonation, stopImpersonation,
          viewState, viewError, retryProjectView, leaveProjectView } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [moreOpen, setMoreOpen]   = useState(false)
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => { setMoreOpen(false) }, [location.pathname])

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
    if (projectId) q = q.eq('project_id', projectId)   // ومدير المنصة: عدد مستندات منشأته المختارة وحدها
    const { count } = await q
    setPendingCount(count || 0)
  }

  const adminWorking = operatesBusiness(role, projectId, viewState)
  const visibleItems = navItems(pendingCount).filter(item =>
    item.roles.includes(role) &&
    (!item.module || adminWorking || modules.includes(item.module)) &&
    (!item.cond || item.cond(projectName))
  )
  // مدير المنصة يرفع داخل منشأة اختارها وتحقق منها الخادم فقط
  const canUpload = UPLOAD_ROLES.includes(role) && (role !== 'superadmin' || (!!projectId && viewState === 'ok' && location.pathname !== '/admin'))

  function handleLogout() { logout(); navigate('/login') }
  // مدير المنصة خارج لوحة المنصة = يعمل داخل منشأة اختارها (20261018120000): كل إجراء باسمه، بقواعد المنشأة نفسها
  const adminViewing = isSuperAdmin && location.pathname !== '/admin'
  function backToAdmin() { leaveProjectView(); navigate('/admin') }

  // الشريط السفلي للجوال: الرئيسية لكل دور، ثم شاشة المستندات إن وُجدت، ثم الرفع، ثم «المزيد» لبقية العناصر
  const homeItem = visibleItems[0]
  const docsItem = visibleItems.find(i => i.to === '/pending') || visibleItems.find(i => i !== homeItem && i.to === '/reports')
  const moreItems = visibleItems.filter(i => i !== homeItem && i !== docsItem)
  const moreActive = moreItems.some(i => location.pathname.startsWith(i.to) && i.to !== '/')
  // مراجعة مستند على الجوال: شريط الإجراءات يحل محل الشريط السفلي (كما في النموذج المراجَع)
  const onReview = location.pathname === '/pending' && new URLSearchParams(location.search).has('doc')

  const link = ({ isActive }) => `ts-nav-link${isActive ? ' is-active' : ''}`
  const NavItem = ({ item }) => {
    const Icon = item.icon
    return (
      <NavLink to={item.to} end={endMatch(item.to)} className={link} title={collapsed ? item.label : undefined}>
        <Icon className="ts-icon" aria-hidden="true" />
        {!collapsed && <span className="ts-nav-text">{item.label}</span>}
        {item.badge > 0 && <span className="ts-nav-count" aria-label={`${item.badge} بانتظار المراجعة`}>{item.badge}</span>}
      </NavLink>
    )
  }

  const RolePreview = () => canImpersonate ? (
    <div className="ts-role-preview">
      <div className="ts-nav-label"><Eye className="ts-icon--sm" aria-hidden="true" /> معاينة بدور آخر</div>
      <div className="ts-segment ts-segment--full ts-segment--dark" role="group" aria-label="معاينة بدور آخر">
        {PREVIEW_ROLES.map(o => (
          <button key={o.r} type="button" aria-pressed={role === o.r}
            onClick={() => o.r === 'owner' ? stopImpersonation() : startImpersonation(o.r)}>{o.label}</button>
        ))}
      </div>
    </div>
  ) : null

  return (
    <div className="ts-app" dir="rtl">
      <VersionNotice />
      <aside className={`ts-sidebar${collapsed ? ' is-collapsed' : ''}`} aria-label="القائمة الرئيسية">
        {collapsed ? <div className="ts-mark ts-mark--dark" aria-label="تحسيب"><span /><span /><span /></div> : <Brand product="المطاعم" dark />}
        {!collapsed && (
          <div className="ts-business">
            <span className="ts-avatar">{(userName || '؟')[0]}</span>
            <div>
              {projectName && <strong>{projectName}</strong>}
              <small>{userName} · {roleLabel}</small>
            </div>
          </div>
        )}
        {!collapsed && <RolePreview />}
        {isSuperAdmin && projectId && !collapsed && (
          <Button size="sm" icon={ArrowLeft} className="ts-sidebar-back" onClick={() => navigate('/admin')}>رجوع لإدارة العملاء</Button>
        )}
        {canUpload && (
          <NavLink to="/invoice" className={({ isActive }) => `ts-btn ts-btn--primary ts-btn--full${isActive ? ' is-active' : ''}`} title={collapsed ? 'رفع مستند' : undefined}>
            <Upload className="ts-icon" aria-hidden="true" />{!collapsed && 'رفع مستند'}
          </NavLink>
        )}
        <nav className="ts-nav">
          {visibleItems.map(item => <NavItem key={item.to} item={item} />)}
        </nav>
        <div className="ts-sidebar-foot">
          <button type="button" className="ts-nav-link" onClick={() => setCollapsed(v => !v)}>
            {collapsed ? <PanelRightOpen className="ts-icon" aria-hidden="true" /> : <PanelRightClose className="ts-icon" aria-hidden="true" />}
            {!collapsed && <span className="ts-nav-text">طي القائمة</span>}
          </button>
          <button type="button" className="ts-nav-link ts-nav-link--logout" onClick={handleLogout}>
            <LogOut className="ts-icon" aria-hidden="true" />{!collapsed && <span className="ts-nav-text">خروج</span>}
          </button>
        </div>
      </aside>

      <div className="ts-main">
        <header className="ts-topbar">
          <div className="ts-breadcrumb"><span>تحسيب المطاعم</span>{projectName && <><span aria-hidden="true">/</span><strong>{projectName}</strong></>}</div>
          <div className="ts-mobile-brand">
            <Brand product="المطاعم" small />
            {projectName && <span className="ts-business-name">{projectName}</span>}
          </div>
          <div className="ts-top-meta ts-desktop-only"><span className="ts-muted">{userName} · {roleLabel}</span></div>
        </header>

        {/* تحذير دائم أثناء المعاينة بدور آخر — لا يُغلق ولا يختفي بتغيير الصفحة */}
        {isImpersonating && (
          <div className="ts-impersonation" role="status">
            <TriangleAlert className="ts-icon--sm" aria-hidden="true" />
            <span>معاينة بدور <strong>{roleLabel}</strong> — أنت المالك فعليًا، والكتابة بهذا الوضع مرفوضة خادميًا</span>
            <Button size="sm" onClick={stopImpersonation}>ارجع لدورك</Button>
          </div>
        )}

        {/* مدير المنصة يعمل داخل منشأة: تنبيه دائم بالمنشأة وبأن الإجراءات تُسجَّل باسمه */}
        {adminViewing && projectId && viewState === 'ok' && (
          <div className="ts-impersonation" role="status" data-admin-view={projectId}>
            <TriangleAlert className="ts-icon--sm" aria-hidden="true" />
            <span data-k="operate-banner">تعمل داخل: <strong>{projectName}</strong> — بصفتك إدارة تحسيب. كل إجراء يُسجَّل باسمك ({userName}) في هذه المنشأة وحدها</span>
            <Button size="sm" onClick={backToAdmin}>لوحة المنصة</Button>
          </div>
        )}

        <main className="ts-scroll">
          <div className="ts-content ts-legacy">
            {!adminViewing ? children
              : !projectId ? (
                <div className="ts-note" data-view-state="none">
                  <span>اختر منشأة من لوحة المنصة لعرض بياناتها.</span>
                  <Button size="sm" onClick={backToAdmin}>لوحة المنصة</Button>
                </div>
              ) : viewState === 'ok' ? (
                // مفتاح المنشأة: تبديلها يعيد بناء الصفحة كلها، فلا تبقى بيانات المنشأة السابقة ولا نتائج طلباتها المتأخرة
                <div key={projectId} data-view-state="ok">{children}</div>
              ) : viewState === 'error' ? (
                <div className="ts-note ts-note--error" role="alert" data-view-state="error">
                  <span>{VIEW_ERRORS[viewError] || VIEW_ERRORS.network} لم تُعرض أي أرقام.</span>
                  <Button size="sm" variant="primary" onClick={retryProjectView}>إعادة المحاولة</Button>
                  <Button size="sm" onClick={backToAdmin}>لوحة المنصة</Button>
                </div>
              ) : (
                <div className="ts-note" role="status" data-view-state="checking"><span>جارٍ فتح بيانات {projectName || 'المنشأة'}…</span></div>
              )}
          </div>
        </main>

        {!onReview && (
        <nav className="ts-bottomnav" aria-label="التنقل">
          {homeItem && (
            <NavLink to={homeItem.to} end={endMatch(homeItem.to)} className={({ isActive }) => (isActive ? 'is-active' : '')}>
              <House className="ts-icon" aria-hidden="true" />الرئيسية
            </NavLink>
          )}
          {docsItem && (
            <NavLink to={docsItem.to} className={({ isActive }) => (isActive ? 'is-active' : '')}>
              <docsItem.icon className="ts-icon" aria-hidden="true" />{docsItem.to === '/pending' ? 'المستندات' : docsItem.label}
              {docsItem.badge > 0 && <span className="ts-nav-count">{docsItem.badge}</span>}
            </NavLink>
          )}
          {canUpload && (
            <NavLink to="/invoice" className={({ isActive }) => `ts-upload-tab${isActive ? ' is-active' : ''}`}>
              <Upload className="ts-icon" aria-hidden="true" />رفع مستند
            </NavLink>
          )}
          <button type="button" className={moreActive ? 'is-active' : ''} onClick={() => setMoreOpen(true)}>
            <Menu className="ts-icon" aria-hidden="true" />المزيد
          </button>
        </nav>
        )}
      </div>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="المزيد" description={`${userName || ''} · ${roleLabel || ''}`}>
        {moreItems.length > 0 && (
          <div className="ts-choice-list">
            {moreItems.map(item => (
              <button key={item.to} type="button" className="ts-choice" onClick={() => navigate(item.to)}>
                <item.icon className="ts-icon" aria-hidden="true" style={{ color: 'var(--ts-petrol-text)' }} />
                {item.label}
                {item.badge > 0 && <span className="ts-nav-count" style={{ marginInlineStart: 'auto' }}>{item.badge}</span>}
              </button>
            ))}
          </div>
        )}
        <RolePreview />
        {isSuperAdmin && projectId && <Button icon={ArrowLeft} onClick={() => navigate('/admin')}>رجوع لإدارة العملاء</Button>}
        <Button icon={LogOut} onClick={handleLogout}>خروج</Button>
      </Dialog>
    </div>
  )
}
