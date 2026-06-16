import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Ledger from './pages/Ledger'
import Sales from './pages/Sales'
import Journals from './pages/Journals'
import Reports from './pages/Reports'
import Loans from './pages/Loans'
import InvoiceUpload from './pages/InvoiceUpload'
import PendingDocuments from './pages/PendingDocuments'
import CashierDashboard from './pages/CashierDashboard'
import UsersManagement from './pages/UsersManagement'
import JournalLedger from './pages/JournalLedger'
import JournalArchive from './pages/JournalArchive'
import SuperAdmin from './pages/SuperAdmin'
import Suppliers from './pages/Suppliers'
import RoasterySales from './pages/RoasterySales'

function defaultPath(role) {
  if (role === 'purchasing') return '/invoice'
  if (role === 'cashier')    return '/cashier'
  if (role === 'superadmin') return '/admin'
  return '/'
}

function ProtectedRoute({ children, allowedRoles }) {
  const { role } = useAuth()
  if (!role) return <Navigate to="/login" replace />
  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to={defaultPath(role)} replace />
  }
  return <Layout>{children}</Layout>
}

function AppRoutes() {
  const { role } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={role ? <Navigate to={defaultPath(role)} replace /> : <Login />} />

      <Route path="/" element={
        <ProtectedRoute allowedRoles={['owner', 'accountant', 'superadmin']}>
          <Dashboard />
        </ProtectedRoute>
      } />

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

      <Route path="/loans" element={
        <ProtectedRoute allowedRoles={['accountant', 'superadmin']}>
          <Loans />
        </ProtectedRoute>
      } />

      <Route path="/invoice" element={
        <ProtectedRoute allowedRoles={['purchasing', 'accountant', 'cashier']}>
          <InvoiceUpload />
        </ProtectedRoute>
      } />

      <Route path="/pending" element={
        <ProtectedRoute allowedRoles={['accountant', 'superadmin']}>
          <PendingDocuments />
        </ProtectedRoute>
      } />

      <Route path="/cashier" element={
        <ProtectedRoute allowedRoles={['cashier', 'accountant']}>
          <CashierDashboard />
        </ProtectedRoute>
      } />

      <Route path="/users" element={
        <ProtectedRoute allowedRoles={['owner']}>
          <UsersManagement />
        </ProtectedRoute>
      } />

      <Route path="/journal" element={
        <ProtectedRoute allowedRoles={['accountant', 'superadmin']}>
          <JournalLedger />
        </ProtectedRoute>
      } />

      <Route path="/archive" element={
        <ProtectedRoute allowedRoles={['accountant', 'superadmin']}>
          <JournalArchive />
        </ProtectedRoute>
      } />

      <Route path="/suppliers" element={
        <ProtectedRoute allowedRoles={['accountant']}>
          <Suppliers />
        </ProtectedRoute>
      } />

      <Route path="/roastery-sales" element={
        <ProtectedRoute allowedRoles={['accountant']}>
          <RoasterySales />
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
