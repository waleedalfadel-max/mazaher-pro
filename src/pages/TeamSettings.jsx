// إعدادات المالك — قسم «الموظفون»: تعطيل الموظف وإعادة تفعيله، وسجلهما.
// كل تغيير عبر دوال الخادم (supabase/migrations/20260930000000_employee_deactivation.sql): المالك الفعلي النشط وحده، في
// منشأته، مع الحمايات والسجل هناك. المنع نفسه في الخادم عند كل طلب، فالتعطيل يسري على الجلسة المفتوحة أيضًا.
import React, { useCallback, useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, History, Power, PowerOff, TriangleAlert, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Button, Check, Dialog, EmptyState, Field, Input, Note, Panel, Status } from '../ui/components.jsx'
import { formatAgo } from '../ui/format.js'
import { isLastActiveAccountant, memberAction, roleLabel, teamActionLabel, teamMessage } from '../lib/teamSettings'

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

async function call(fn, args) {
  try {
    const { data, error } = await supabase.rpc(fn, args)
    if (error || !data) return { ok: false, code: 'network' }
    return data
  } catch { return { ok: false, code: 'network' } }
}

export default function TeamSettings() {
  const [state, setState] = useState(null)          // ناتج team_members
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)        // { tone, text }
  const [dialog, setDialog] = useState(null)        // { kind: 'deactivate'|'reactivate', m }

  const load = useCallback(async () => {
    const data = await call('team_members')
    if (!data.ok) { setLoadError(teamMessage(data)); return null }
    setLoadError(''); setState(data); return data
  }, [])
  useEffect(() => { load() }, [load])

  async function setActive(m, active, extra = {}) {
    if (busy) return { ok: false, code: 'busy' }
    setBusy(true); setNotice(null)
    const res = await call('team_set_active', { p_user_id: m.id, p_active: active, p_reason: extra.reason || null, p_acknowledge: extra.ack ? 'last_accountant' : null })
    if (res.ok) {
      await load()
      setNotice({ tone: 'success', text: active
        ? `أُعيد تفعيل «${m.name}». يدخل برمزه نفسه وبدوره نفسه.`
        : `عُطّل «${m.name}». توقف وصوله، ولا يدخل حتى تعيد تفعيله، وسجلاته باقية.` })
    }
    setBusy(false)
    return res
  }

  if (loadError && !state) return <Note tone="error" icon={CircleAlert} title="تعذّر فتح قائمة الموظفين">{loadError}</Note>
  if (!state) return <p className="ts-muted">جارٍ التحميل…</p>

  const members = state.members || []
  const inactive = members.filter(m => m.is_active === false).length
  return (
    <>
      <Panel title="الموظفون" icon={Users}
        subtitle={`${members.length - inactive} نشط${inactive ? ` · ${inactive} معطّل` : ''}. التعطيل يوقف وصول الموظف عند طلبه التالي، حتى لو كان داخل التطبيق الآن، ويبقي سجلاته كما هي.`}>
        {notice && <div className="ts-panel-body"><Note tone={notice.tone === 'success' ? 'success' : 'error'} icon={notice.tone === 'success' ? CircleCheck : CircleAlert}>{notice.text}</Note></div>}
        {members.length === 0
          ? <EmptyState icon={Users}>لا موظفين بعد.</EmptyState>
          : (
            <ul className="cs-tree tm-list">
              {members.map(m => {
                const act = memberAction(m)
                const off = m.is_active === false
                return (
                  <li key={m.id} className={`cs-main${off ? ' is-off' : ''}`} data-id={m.id}>
                    <div className="cs-row">
                      <div className="cs-row-main">
                        <strong className="cs-name">{m.name}{m.is_self && <span className="tm-self"> (أنت)</span>}</strong>
                        <div className="cs-meta">
                          <span className="cs-class tm-role">{roleLabel(m.role)}</span>
                          {off ? <Status tone="neutral">معطّل</Status> : <Status>نشط</Status>}
                          {m.branch && <small>{m.branch}</small>}
                          {off && m.deactivated_at && <small>عُطّل {formatAgo(m.deactivated_at, todayIso())}{m.deactivated_by ? ` · بواسطة ${m.deactivated_by}` : ''}</small>}
                        </div>
                      </div>
                      <div className="cs-actions">
                        {act.kind === 'none'
                          ? <small className="ts-field-hint">{act.hint}</small>
                          : <Button size="sm" variant={off ? 'secondary' : 'quiet'} icon={off ? Power : PowerOff} disabled={busy}
                              aria-label={`${act.label} «${m.name}»`} onClick={() => setDialog({ kind: act.kind, m })}>{act.label}</Button>}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
      </Panel>

      {state.changes?.length > 0 && (
        <Panel title="سجل التعطيل" icon={History} subtitle="كل تعطيل وإعادة تفعيل يُسجَّل بمنفّذه ووقته.">
          <ul className="rp-rows rp-rows--tight cs-log">
            {state.changes.slice(0, 10).map((c, i) => (
              <li key={i}>
                <div className="rp-row-main">
                  <strong>«{c.user}» {teamActionLabel(c.action)}</strong>
                  <small>{c.by || '—'} · {formatAgo(c.at, todayIso())}{c.reason ? ` · ${c.reason}` : ''}</small>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {dialog?.kind === 'deactivate' && (
        <DeactivateDialog m={dialog.m} lastAccountant={isLastActiveAccountant(members, dialog.m)} busy={busy}
          onClose={() => setDialog(null)} onConfirm={extra => setActive(dialog.m, false, extra)} />
      )}
      {dialog?.kind === 'reactivate' && (
        <ReactivateDialog m={dialog.m} busy={busy} onClose={() => setDialog(null)} onConfirm={() => setActive(dialog.m, true)} />
      )}
    </>
  )
}

function DeactivateDialog({ m, lastAccountant, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [ack, setAck] = useState(false)
  const [needAck, setNeedAck] = useState(lastAccountant)
  const [error, setError] = useState('')
  async function confirm() {
    setError('')
    const res = await onConfirm({ reason: reason.trim(), ack })
    if (res?.ok) return onClose()
    if (res?.code === 'last_accountant') setNeedAck(true)
    if (res && res.code !== 'busy') setError(teamMessage(res))
  }
  return (
    <Dialog open title={`تعطيل «${m.name}»؟`} description={roleLabel(m.role)} onClose={() => !busy && onClose()}
      footer={<>
        <Button variant="quiet" disabled={busy} onClick={onClose}>إلغاء</Button>
        <Button variant="primary" icon={PowerOff} disabled={busy || (needAck && !ack)} onClick={confirm}>{busy ? 'جارٍ الحفظ…' : 'تعطيل'}</Button>
      </>}>
      <ul className="cs-effects">
        <li>يتوقف وصوله عند طلبه التالي، ولو كان داخل التطبيق الآن. تُغلق جلسته على شاشته خلال نحو 20 ثانية ما دامت الصفحة مفتوحة، أو عند عودته إليها.</li>
        <li>لا يدخل برمزه حتى تعيد تفعيله.</li>
        <li>لا يقرأ ولا يرفع ولا يعتمد ولا يعدّل شيئًا في منشأتك.</li>
        <li>ما سجّله سابقًا (القيود والمستندات والمبيعات) يبقى باسمه، والأرقام لا تتغير.</li>
        <li>رابط صورة فتحه قبل التعطيل ينتهي خلال 5 دقائق على الأكثر، والتعطيل لا يسترجع صورة سبق تنزيلها.</li>
        <li>يمكنك إعادة تفعيله في أي وقت، بدوره ورمزه نفسيهما.</li>
      </ul>
      {needAck && (
        <Note tone="warning" icon={TriangleAlert} title="هو المحاسب النشط الوحيد">
          اعتماد المستندات وإدارة المستخدمين يتوقفان حتى تعيد تفعيله أو يُضاف محاسب.
          <Check label="أفهم ذلك، عطّله" checked={ack} onChange={setAck} disabled={busy} />
        </Note>
      )}
      <Field label="السبب (اختياري)" hint="يظهر في سجل التعطيل.">
        <Input value={reason} maxLength={200} onChange={e => setReason(e.target.value)} aria-label="سبب التعطيل" />
      </Field>
      {error && <Note tone="error" icon={CircleAlert}>{error}</Note>}
    </Dialog>
  )
}

function ReactivateDialog({ m, busy, onClose, onConfirm }) {
  const [error, setError] = useState('')
  return (
    <Dialog open title={`إعادة تفعيل «${m.name}»؟`} description={roleLabel(m.role)} onClose={() => !busy && onClose()}
      footer={<>
        <Button variant="quiet" disabled={busy} onClick={onClose}>إلغاء</Button>
        <Button variant="primary" icon={Power} disabled={busy} onClick={async () => {
          const res = await onConfirm()
          if (res?.ok) onClose(); else if (res && res.code !== 'busy') setError(teamMessage(res))
        }}>{busy ? 'جارٍ الحفظ…' : 'إعادة تفعيل'}</Button>
      </>}>
      <ul className="cs-effects">
        <li>يدخل برمزه نفسه، وبدوره نفسه ({roleLabel(m.role)}).</li>
        <li>يرى ويعمل كما كان قبل التعطيل.</li>
      </ul>
      {error && <Note tone="error" icon={CircleAlert}>{error}</Note>}
    </Dialog>
  )
}
