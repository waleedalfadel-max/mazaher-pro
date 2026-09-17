import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { DOC_KINDS, newId } from '../lib/ledger.js'
import { DOC_KIND_IDS, ROLES, isOwner } from '../lib/permissions.js'
import { Badge, Button, Card, Field, Modal, Notice, PageTitle, Select, TextInput, NAVY } from '../components/ui.jsx'

const ROLE_SUMMARY = {
  owner: 'كل التقارير والأرصدة والعملاء والإعدادات، والرفع والمراجعة والاعتماد.',
  purchasing: 'رفع مستند مصروفات ومتابعة حالة مستنداته فقط.',
  sales: 'رفع فاتورة بيع أو إثبات سداد مع اختيار العميل، ومتابعة حالة مستنداته فقط.',
}

function EmployeeForm({ open, employee, onClose }) {
  const { dispatch } = useStore()
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setDraft(employee
      ? { id: employee.id, name: employee.name, role: employee.role, docKinds: [...employee.docKinds] }
      : { id: newId('emp'), name: '', role: 'sales', docKinds: [...ROLES.sales.docKinds] })
    setError('')
  }, [open, employee])

  if (!draft) return null
  const owner = draft.role === 'owner'
  const toggleKind = k => setDraft(d => ({ ...d, docKinds: d.docKinds.includes(k) ? d.docKinds.filter(x => x !== k) : [...d.docKinds, k] }))

  function save() {
    const r = dispatch({ type: 'EMPLOYEE_SAVE', ...draft })
    if (r.error) return setError(r.error)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={employee ? 'تعديل موظف' : 'إضافة موظف'}
      footer={<>
        <Button variant="secondary" onClick={onClose}>إلغاء</Button>
        <Button onClick={save}>حفظ</Button>
      </>}>
      <div className="space-y-3">
        <Field label="الاسم">
          <TextInput value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="اسم الموظف" autoFocus />
        </Field>
        {owner ? (
          <Notice tone="info">المالك له كل الصلاحيات دائماً، ولا يمكن تعطيله أو تقييده.</Notice>
        ) : (
          <>
            <Field label="الدور" hint={ROLE_SUMMARY[draft.role]}>
              <Select value={draft.role} aria-label="الدور"
                onChange={e => setDraft({ ...draft, role: e.target.value, docKinds: [...ROLES[e.target.value].docKinds] })}>
                <option value="purchasing">{ROLES.purchasing.label}</option>
                <option value="sales">{ROLES.sales.label}</option>
              </Select>
            </Field>
            <div>
              <div className="text-xs font-bold mb-1" style={{ color: '#5A7A8A' }}>أنواع المستندات المسموح برفعها</div>
              <div className="space-y-1.5">
                {DOC_KIND_IDS.map(k => (
                  <label key={k} className="flex items-center gap-2 text-sm rounded-xl border border-border px-3 py-2">
                    <input type="checkbox" className="w-4 h-4" checked={draft.docKinds.includes(k)} onChange={() => toggleKind(k)} />
                    {DOC_KINDS[k]}
                  </label>
                ))}
              </div>
            </div>
            <Notice tone="warning">
              الموظف المحدود لا يرى الأرباح أو الأرصدة أو التقارير أو مستندات غيره، ولا يعتمد مستندات.
            </Notice>
          </>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  )
}

export default function Employees() {
  const { state, dispatch, actor, setActing } = useStore()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState(null)

  function toggleActive(emp) {
    const r = dispatch({ type: 'EMPLOYEE_SET_ACTIVE', id: emp.id, active: !emp.active })
    setMessage(r.error ? { tone: 'error', text: r.error } : { tone: 'success', text: emp.active ? `عُطّل ${emp.name}` : `فُعّل ${emp.name}` })
  }

  function preview(emp) {
    setActing(emp.id)
    navigate('/')
  }

  return (
    <div>
      <Link to="/settings" className="text-sm font-bold" style={{ color: '#4A9E97' }}>→ الإعدادات</Link>
      <div className="mt-2">
        <PageTitle title="الموظفون والصلاحيات" subtitle="إضافة موظف وتحديد ما يرفعه، وتعطيله"
          action={<Button onClick={() => setAdding(true)}>+ موظف</Button>} />
      </div>

      <Notice tone="warning" className="mb-3">
        <b>محاكاة تجريبية:</b> لا يوجد تسجيل دخول ولا كلمات مرور، والموظفون هنا ليسوا حسابات حقيقية محمية.
        «معاينة بدوره» تعرض الواجهة كما يراها الموظف فقط، وأي شخص يملك هذا الجهاز يستطيع تغييرها.
      </Notice>

      {message && <Notice tone={message.tone} className="mb-3">{message.text}</Notice>}

      <Card className="divide-y divide-border overflow-hidden mb-4">
        {state.employees.map(emp => (
          <div key={emp.id} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold flex flex-wrap items-center gap-1.5" style={{ color: NAVY }}>
                  {emp.name}
                  <Badge tone={isOwner(emp) ? 'approved' : 'neutral'}>{ROLES[emp.role]?.label}</Badge>
                  {!emp.active && <Badge tone="rejected">معطّل</Badge>}
                  {emp.id === actor.id && <Badge tone="sample">المعروض الآن</Badge>}
                </div>
                <div className="text-xs mt-1" style={{ color: '#5A7A8A' }}>{ROLE_SUMMARY[emp.role]}</div>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {emp.docKinds.map(k => <Badge key={k}>{DOC_KINDS[k]}</Badge>)}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <Button variant="secondary" className="!py-1 !px-2.5 !text-xs" onClick={() => setEditing(emp)}>تعديل الصلاحيات</Button>
              {!isOwner(emp) && (
                <Button variant={emp.active ? 'danger' : 'secondary'} className="!py-1 !px-2.5 !text-xs" onClick={() => toggleActive(emp)}>
                  {emp.active ? 'تعطيل' : 'تفعيل'}
                </Button>
              )}
              {!isOwner(emp) && (
                <Button variant="navy" className="!py-1 !px-2.5 !text-xs" onClick={() => preview(emp)}>👁️ معاينة بدوره</Button>
              )}
            </div>
          </div>
        ))}
      </Card>

      <Card className="p-4">
        <h2 className="font-extrabold mb-2" style={{ color: NAVY }}>لتحويلها لاحقاً إلى حسابات فعلية</h2>
        <ul className="text-xs space-y-1.5 list-disc pr-4" style={{ color: '#5A7A8A' }}>
          <li>حساب دخول لكل موظف (بريد أو جوال مع رمز تحقق) بدل الاختيار من هذه القائمة.</li>
          <li>نقل البيانات من متصفح الجهاز إلى قاعدة بيانات مشتركة، وربط كل مستند بمن رفعه على الخادم.</li>
          <li>فرض الصلاحيات من الخادم (سياسات على مستوى الصفوف ودوال تتحقق من الدور) لا من الواجهة.</li>
          <li>رفع الملفات إلى تخزين خاص بروابط موقّعة، واعتماد المستند عبر دالة خادمية لا يستدعيها إلا المالك.</li>
          <li>سجل تدقيق لمن أضاف أو عدّل أو اعتمد، وتعطيل الموظف يُبطل جلساته فوراً.</li>
        </ul>
      </Card>

      <EmployeeForm open={!!editing} employee={editing} onClose={() => setEditing(null)} />
      <EmployeeForm open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}
