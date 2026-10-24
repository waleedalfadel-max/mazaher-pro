import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Ledger from './pages/Ledger'
import Accounts from './pages/Accounts.jsx'
import Sales from './pages/Sales'
import Journals from './pages/Journals'
import Reports from './pages/Reports'
import FinancialAnalysis from './pages/FinancialAnalysis'
import Loans from './pages/Loans'
import InvoiceUpload from './pages/InvoiceUpload'
import PendingDocuments from './pages/PendingDocuments'
import UsersManagement from './pages/UsersManagement'
import AdminBusinessUsers from './pages/AdminBusinessUsers'
import JournalLedger from './pages/JournalLedger'
import JournalArchive from './pages/JournalArchive'
import SuperAdmin from './pages/SuperAdmin'
import Suppliers from './pages/Suppliers'
import BankReconciliation from './pages/BankReconciliation'
import AppReconciliation from './pages/AppReconciliation'
import Settings from './pages/Settings'

function TrialFormRedirect() {
  window.location.replace('/trial-form.html' + window.location.search)
  return null
}

function defaultPath(role) {
  if (role === 'purchasing') return '/invoice'
  if (role === 'cashier')    return '/invoice'   // صفحة الكاشير أُلغيت: الكاشير يرفع من صفحة الرفع العامة
  if (role === 'superadmin') return '/admin'
  return '/'
}

function RetiredRoute() {
  const { role } = useAuth()
  if (!role) return <Navigate to={{ pathname: '/login', search: window.location.search }} replace />
  return <Navigate to={defaultPath(role)} replace />
}

function ProtectedRoute({ children, allowedRoles }) {
  const { role } = useAuth()
  if (!role) return <Navigate to={{ pathname: '/login', search: window.location.search }} replace />
  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to={defaultPath(role)} replace />
  }
  return <Layout>{children}</Layout>
}

// التحليل المالي يُبنى من جديد عند تبديل المنشأة: لا تبقى حالة أو رد متأخر من منشأة سابقة
function AnalysisPage() {
  const { projectId } = useAuth()
  return <FinancialAnalysis key={projectId || 'none'} />
}

function AppRoutes() {
  const { role } = useAuth()

  return (
    <Routes>
      <Route path="/form" element={<TrialFormRedirect />} />
      <Route path="/trial-form" element={<TrialFormRedirect />} />

      <Route path="/login" element={role ? <Navigate to={defaultPath(role)} replace /> : <Login />} />

      <Route path="/" element={
        <ProtectedRoute allowedRoles={['owner', 'accountant', 'superadmin']}>
          <Dashboard />
        </ProtectedRoute>
      } />

      <Route path="/accounts" element={<ProtectedRoute allowedRoles={['owner', 'accountant', 'superadmin']}><Accounts /></ProtectedRoute>} />

      <Route path="/ledger" element={
        <ProtectedRoute allowedRoles={['accountant', 'superadmin']}>
          <Ledger />
        </ProtectedRoute>
      } />

      <Route path="/sales" element={
        <ProtectedRoute allowedRoles={['accountant', 'superadmin']}>
          <Sales />
        </ProtectedRoute>
      } />

      <Route path="/journals" element={
        <ProtectedRoute allowedRoles={['accountant', 'superadmin']}>
          <Journals />
        </ProtectedRoute>
      } />

      <Route path="/reports" element={
        <ProtectedRoute allowedRoles={['owner', 'accountant', 'superadmin']}>
          <Reports />
        </ProtectedRoute>
      } />

      {/* التحليل المالي: الخادم يتحقق من الصلاحية بنفسه (analysis_access)، وإخفاء التبويب ليس الحماية */}
      <Route path="/analysis" element={
        <ProtectedRoute allowedRoles={['owner', 'accountant', 'superadmin']}>
          <AnalysisPage />
        </ProtectedRoute>
      } />

      <Route path="/loans" element={
        <ProtectedRoute allowedRoles={['accountant', 'superadmin']}>
          <Loans />
        </ProtectedRoute>
      } />

      <Route path="/bank-reconciliation" element={
        <ProtectedRoute allowedRoles={['accountant', 'superadmin']}>
          <BankReconciliation />
        </ProtectedRoute>
      } />

      <Route path="/app-reconciliation" element={
        <ProtectedRoute allowedRoles={['accountant', 'superadmin']}>
          <AppReconciliation />
        </ProtectedRoute>
      } />

      <Route path="/invoice" element={
        <ProtectedRoute allowedRoles={['purchasing', 'accountant', 'cashier', 'owner', 'superadmin']}>
          <InvoiceUpload />
        </ProtectedRoute>
      } />

      <Route path="/pending" element={
        <ProtectedRoute allowedRoles={['accountant', 'superadmin']}>
          <PendingDocuments />
        </ProtectedRoute>
      } />

      {/* صفحتا الكاشير والإدخال السريع للمبيعات أُلغيتا بقرار المالك: الروابط القديمة والمحفوظة تُحوَّل إلى الصفحة الافتراضية للدور */}
      <Route path="/cashier" element={<RetiredRoute />} />
      <Route path="/quick-sale" element={<RetiredRoute />} />

      {/* إعدادات المالك: التصنيفات (والخادم يتحقق من المالك بنفسه) */}
      <Route path="/settings" element={
        <ProtectedRoute allowedRoles={['owner', 'superadmin']}>
          <Settings />
        </ProtectedRoute>
      } />

      <Route path="/users" element={
        <ProtectedRoute allowedRoles={['accountant', 'superadmin']}>
          {role === 'superadmin' ? <AdminBusinessUsers /> : <UsersManagement />}
        </ProtectedRoute>
      } />

      <Route path="/journal" element={
        <ProtectedRoute allowedRoles={['accountant', 'superadmin']}>
          <JournalLedger />
        </ProtectedRoute>
      } />

      <Route path="/archive" element={
        <ProtectedRoute allowedRoles={['owner', 'accountant', 'superadmin']}>
          <JournalArchive />
        </ProtectedRoute>
      } />

      <Route path="/suppliers" element={
        <ProtectedRoute allowedRoles={['accountant', 'owner', 'superadmin']}>
          <Suppliers />
        </ProtectedRoute>
      } />

      <Route path="/admin" element={
        <ProtectedRoute allowedRoles={['superadmin']}>
          <SuperAdmin />
        </ProtectedRoute>
      } />

      <Route path="*" element={
        <Navigate to={!role ? '/login' : defaultPath(role)} replace />
      } />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
