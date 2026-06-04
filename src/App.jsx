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

function ProtectedRoute({ children, allowedRoles }) {
  const { role } = useAuth()
  if (!role) return <Navigate to="/login" replace />
  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to={role === 'purchasing' ? '/invoice' : '/'} replace />
  }
  return <Layout>{children}</Layout>
}

function AppRoutes() {
  const { role } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={role ? <Navigate to="/" replace /> : <Login />} />

      <Route path="/" element={
        <ProtectedRoute allowedRoles={['owner', 'accountant']}>
          <Dashboard />
        </ProtectedRoute>
      } />

      <Route path="/ledger" element={
        <ProtectedRoute allowedRoles={['owner', 'accountant']}>
          <Ledger />
        </ProtectedRoute>
      } />

      <Route path="/sales" element={
        <ProtectedRoute allowedRoles={['owner', 'accountant']}>
          <Sales />
        </ProtectedRoute>
      } />

      <Route path="/journals" element={
        <ProtectedRoute allowedRoles={['owner', 'accountant']}>
          <Journals />
        </ProtectedRoute>
      } />

      <Route path="/reports" element={
        <ProtectedRoute allowedRoles={['owner', 'accountant']}>
          <Reports />
        </ProtectedRoute>
      } />

      <Route path="/loans" element={
        <ProtectedRoute allowedRoles={['owner', 'accountant']}>
          <Loans />
        </ProtectedRoute>
      } />

      <Route path="/invoice" element={
        <ProtectedRoute allowedRoles={['purchasing', 'accountant']}>
          <InvoiceUpload />
        </ProtectedRoute>
      } />

      <Route path="*" element={
        <Navigate to={!role ? '/login' : role === 'purchasing' ? '/invoice' : '/'} replace />
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
