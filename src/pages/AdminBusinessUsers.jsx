import React from 'react'
import { useAuth } from '../contexts/AuthContext'
import AdminProjectUsers from '../components/AdminProjectUsers'
import { operatesBusiness } from '../lib/adminAccess'
import { Note } from '../ui/components.jsx'

export default function AdminBusinessUsers() {
  const { role, projectId, projectName, viewState } = useAuth()
  if (!operatesBusiness(role, projectId, viewState)) {
    return <Note tone="warning">اختر المنشأة من إدارة العملاء أولًا.</Note>
  }
  return <div className="cs-page">
    <div className="ts-heading"><div>
      <h1>إدارة موظفي {projectName}</h1>
      <p>إضافة وتعديل الأسماء والأدوار والفروع، وتغيير الرموز، والتعطيل والتفعيل والحذف. كل إجراء يُسجَّل باسم إدارة تحسيب.</p>
    </div></div>
    <AdminProjectUsers key={projectId} projectId={projectId} />
  </div>
}
