import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../tatmira-demo/src/store.jsx'
import { Badge, Button, Card, Field, Modal, Notice, PageTitle, TextInput, NAVY } from '../../tatmira-demo/src/components/ui.jsx'
import { createAmbiguousRequestCache } from './request-id-cache.js'

export const GRANT_LABELS = {
  upload_sale: 'رفع فواتير البيع',
  upload_payment: 'رفع إثبات السداد',
  upload_expense: 'رفع مستندات المصروفات',
  review: 'المراجعة والاعتماد',
  view_reports: 'مشاهدة التقارير',
  manage_customers: 'إدارة العملاء',
}
export function pinDigits(value) {
  return String(value || '')
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776))
    .replace(/\D/g, '')
    .slice(0, 6)
}

function EmployeeDialog({ employee, mode = 'edit', open, onClose }) {
  const { accountApi, refreshEmployees } = useStore()
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef('')

  useEffect(() => {
    if (!open) return
    requestId.current = crypto.randomUUID()
    setDraft(mode === 'pin'
      ? { id: employee.id, version: employee.version, pin: '' }
      : employee
        ? { id: employee.id, version: employee.version, name: employee.name, grants: [...employee.grants], pin: '' }
        : { name: '', grants: ['upload_expense'], pin: '' })
    setError('')
  }, [open, employee?.id, mode])

  if (!draft) return null
  const toggle = grant => setDraft(d => ({ ...d, grants: d.grants.includes(grant) ? d.grants.filter(g => g !== grant) : [...d.grants, grant] }))

  async function save() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (mode === 'pin') await accountApi('set_pin', { id: draft.id, expectedVersion: draft.version, pin: pinDigits(draft.pin), requestId: requestId.current })
      else await accountApi('save_employee', {
        ...(draft.id ? { id: draft.id } : {}),
        ...(draft.id ? { expectedVersion: draft.version } : {}),
        name: draft.name,
        grants: draft.grants,
        ...(!draft.id ? { pin: pinDigits(draft.pin) } : {}),
        requestId: requestId.current,
      })
      await refreshEmployees()
      onClose('تم الحفظ')
    } catch (e) {
      if (e.code === 'CONFLICT') await refreshEmployees().catch(() => {})
      setError(e.message)
    } finally { setBusy(false) }
  }

  const valid = mode === 'pin'
    ? pinDigits(draft.pin).length === 6
    : draft.name.trim() && (draft.id || pinDigits(draft.pin).length === 6)

  return <Modal open={open} onClose={() => !busy && onClose()} title={mode === 'pin' ? 'تغيير رمز الدخول' : draft.id ? 'تعديل الموظف' : 'إضافة موظف'}
    footer={<><Button variant="secondary" disabled={busy} onClick={() => onClose()}>إلغاء</Button><Button disabled={busy || !valid} onClick={save}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</Button></>}>
    <div className="space-y-3">
      {mode !== 'pin' && <>
        <Field label="اسم الموظف"><TextInput autoFocus value={draft.name} maxLength={100} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
        <div>
          <div className="text-xs font-bold mb-1" style={{ color: '#5A7A8A' }}>الصلاحيات</div>
          <div className="space-y-1.5">
            {Object.entries(GRANT_LABELS).map(([id, label]) => <label key={id} className="flex items-center gap-2 text-sm rounded-xl border border-border px-3 py-2">
              <input type="checkbox" className="w-4 h-4" checked={draft.grants.includes(id)} onChange={() => toggle(id)} />
              {label}
            </label>)}
          </div>
        </div>
      </>}
      {(!draft.id || mode === 'pin') && <Field label="رمز دخول من 6 أرقام" hint="أعطه للموظف مباشرة ولا ترسله في مجموعة عامة">
        <TextInput type="password" inputMode="numeric" autoComplete="new-password" value={draft.pin} onChange={e => setDraft({ ...draft, pin: pinDigits(e.target.value) })} maxLength={6} dir="ltr" className="text-center tracking-[.35em]" />
      </Field>}
      {draft.id && <Notice tone="warning">تغيير الرمز أو الصلاحيات ينهي جلسات الموظف الحالية فورًا.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>
}

export default function RemoteEmployees() {
  const { employees, accountApi, refreshEmployees, busy: storeBusy } = useStore()
  const [dialog, setDialog] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [notice, setNotice] = useState(null)
  const activeRequests = useRef(null)
  if (!activeRequests.current) activeRequests.current = createAmbiguousRequestCache()

  async function toggleActive(employee) {
    if (busyId) return
    const target = !employee.active
    const requestKey = `${employee.id}|${employee.version}|${target}`
    const requestId = activeRequests.current.requestId(requestKey)
    setBusyId(employee.id)
    setNotice(null)
    try {
      await accountApi('set_active', { id: employee.id, expectedVersion: employee.version, active: target, requestId })
      activeRequests.current.settle(requestKey)
      await refreshEmployees()
      setNotice({ tone: 'success', text: employee.active ? 'تم تعطيل الموظف وإنهاء جلساته' : 'تم تفعيل الموظف' })
    } catch (e) {
      activeRequests.current.settle(requestKey, e.code)
      if (e.code === 'CONFLICT') await refreshEmployees().catch(() => {})
      setNotice({ tone: 'error', text: e.message })
    } finally { setBusyId(null) }
  }

  return <div>
    <Link to="/settings" className="text-sm font-bold" style={{ color: '#4A9E97' }}>→ الإعدادات</Link>
    <div className="mt-2"><PageTitle title="الموظفون والصلاحيات" subtitle="المالك وحده ينشئ الموظفين ويحدد ما يستطيع كل موظف عمله"
      action={<Button disabled={storeBusy} onClick={() => setDialog({ mode: 'edit' })}>+ موظف</Button>} /></div>
    {notice && <Notice tone={notice.tone} className="mb-3">{notice.text}</Notice>}
    <Notice tone="info" className="mb-3">يدخل الموظف برمز من 6 أرقام. لا تعرض الواجهة أي قسم أو إجراء خارج الصلاحيات المحددة هنا.</Notice>
    <Card className="divide-y divide-border overflow-hidden">
      {!employees.length && <div className="p-6 text-center text-sm" style={{ color: '#8FAAAA' }}>لا يوجد موظفون بعد</div>}
      {employees.map(emp => <div key={emp.id} className="p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-bold flex items-center gap-1.5" style={{ color: NAVY }}>{emp.name}<Badge tone={emp.active ? 'approved' : 'rejected'}>{emp.active ? 'نشط' : 'معطّل'}</Badge></div>
            <div className="flex flex-wrap gap-1 mt-2">{emp.grants.length ? emp.grants.map(g => <Badge key={g}>{GRANT_LABELS[g]}</Badge>) : <Badge>بلا صلاحيات تشغيل</Badge>}</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="secondary" className="!py-1 !px-2.5 !text-xs" disabled={!!busyId} onClick={() => setDialog({ employee: emp, mode: 'edit' })}>الصلاحيات</Button>
            <Button variant="secondary" className="!py-1 !px-2.5 !text-xs" disabled={!!busyId} onClick={() => setDialog({ employee: emp, mode: 'pin' })}>تغيير الرمز</Button>
            <Button variant={emp.active ? 'danger' : 'secondary'} className="!py-1 !px-2.5 !text-xs" disabled={!!busyId} onClick={() => toggleActive(emp)}>{busyId === emp.id ? 'جارٍ التنفيذ…' : emp.active ? 'تعطيل' : 'تفعيل'}</Button>
          </div>
        </div>
      </div>)}
    </Card>
    <EmployeeDialog open={!!dialog} employee={dialog?.employee} mode={dialog?.mode} onClose={message => { setDialog(null); if (message) setNotice({ tone: 'success', text: message }) }} />
  </div>
}
