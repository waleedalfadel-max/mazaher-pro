import React from 'react'
import { Link, RouterProvider, createHashRouter, useParams } from 'react-router-dom'
import { Construction } from 'lucide-react'
import { EmptyState, ToastProvider } from '../ui/components.jsx'
import { StoreProvider } from './store.jsx'
import { LATER_LABELS, Shell } from './Shell.jsx'
import Home from './screens/Home.jsx'
import Documents from './screens/Documents.jsx'
import DocumentReview from './screens/DocumentReview.jsx'
import Settings from './screens/Settings.jsx'

function Later() {
  const { section } = useParams()
  return (
    <EmptyState icon={Construction} action={<Link className="ts-btn" to="/">العودة إلى الرئيسية</Link>}>
      «{LATER_LABELS[section] || 'هذه الشاشة'}» ليست ضمن هذا النموذج بعد.
    </EmptyState>
  )
}

// مفتاح بالمعرّف: كل مستند يبدأ بمسودته الخاصة
function ReviewRoute() {
  const { id } = useParams()
  return <DocumentReview key={id} />
}
function SettingsRoute() {
  const { section } = useParams()
  return <Settings key={section || 'index'} />
}

// موجّه بيانات (لا HashRouter العادي) ليعمل تنبيه المغادرة مع التعديلات غير المحفوظة
const router = createHashRouter([{
  element: <Shell />,
  children: [
    { index: true, element: <Home /> },
    { path: 'documents', element: <Documents /> },
    { path: 'documents/:id', element: <ReviewRoute /> },
    { path: 'settings', element: <SettingsRoute /> },
    { path: 'settings/:section', element: <SettingsRoute /> },
    { path: 'soon/:section', element: <Later /> },
    { path: '*', element: <Later /> },
  ],
}])

export default function App() {
  return (
    <ToastProvider>
      <StoreProvider>
        <RouterProvider router={router} />
      </StoreProvider>
    </ToastProvider>
  )
}
