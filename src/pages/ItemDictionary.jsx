// إعدادات المالك — قسم «قاموس الأصناف» (20261014140000): ربط وصف البند بالتصنيف ليُقترح تلقائيًا عند مراجعة المستندات.
// الأصناف «للمراجعة» منفصلة ولا تُصنَّف تلقائيًا أبدًا؛ المالك يختار تصنيفها هنا (أو يعيد صنفًا معتمدًا إلى المراجعة).
// الكتابة بدالة الخادم item_rule_set وحدها (المالك الفعلي في منشأته)؛ الشاشة تعيد القراءة بعد كل حفظ.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleAlert, CircleCheck, ListChecks, Pencil, Undo2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Button, Dialog, EmptyState, Field, Note, Panel, SearchBox, Select, Status } from '../ui/components.jsx'
import { normItem } from '../lib/itemRules'

const MESSAGES = {
  no_session: 'انتهت الجلسة. سجّل الدخول من جديد.', forbidden: 'تعديل القاموس للمالك فقط.', not_found: 'الصنف غير موجود في منشأتك. حدّث الصفحة.',
  category_invalid: 'التصنيف الرئيسي غير موجود أو معطّل.', subcategory_invalid: 'التصنيف الفرعي لا يتبع الرئيسي المختار أو معطّل.',
  invalid: 'طلب غير صالح.', network: 'تعذّر الاتصال بالخادم؛ أعد المحاولة.',
}
const message = r => MESSAGES[r?.code] || `تعذّر الحفظ (${r?.code || 'غير معروف'}).`

export default function ItemDictionary() {
  const { projectId, role } = useAuth()
  const [rules, setRules] = useState(null)
  const [cats, setCats] = useState([])
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState(null)        // { rule, main, sub }
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    if (!projectId) return
    const [r, c] = await Promise.all([
      supabase.from('item_category_rules').select('id,description,status,category_id,subcategory_id,suggested_category_id,suggested_subcategory_id,note')
        .eq('project_id', projectId).order('description').order('id'),
      supabase.from('categories').select('id,name,parent_id,is_active,sort_order').eq('project_id', projectId).order('sort_order'),
    ])
    if (r.error || c.error) { setLoadError('تعذّر تحميل القاموس. أعد المحاولة.'); return }
    setLoadError(''); setRules(r.data || []); setCats(c.data || [])
  }, [projectId])
  useEffect(() => { load() }, [load])

  const byId = useMemo(() => Object.fromEntries(cats.map(c => [c.id, c])), [cats])
  const mains = cats.filter(c => !c.parent_id && c.is_active !== false)
  const subsOf = id => cats.filter(c => c.parent_id === id && c.is_active !== false)
  const path = (m, s) => [byId[m]?.name, byId[s]?.name].filter(Boolean).join(' / ')
  const q = normItem(query) || ''
  const match = r => !q || (normItem(r.description) || '').includes(q) || path(r.category_id, r.subcategory_id).includes(query.trim())
  const review = (rules || []).filter(r => r.status === 'review' && match(r))
  const active = (rules || []).filter(r => r.status === 'active' && match(r))

  async function save(rule, status, main, sub) {
    if (busy) return
    setBusy(true); setNotice(null)
    let res
    try {
      const { data, error } = await supabase.rpc('item_rule_set', { p_rule_id: rule.id, p_category_id: main || null, p_subcategory_id: sub || null, p_status: status })
      res = error || !data ? { ok: false, code: 'network' } : data
    } catch { res = { ok: false, code: 'network' } }
    if (res.ok) {
      await load(); setDialog(null)
      setNotice({ tone: 'success', text: status === 'active' ? `صُنّف «${rule.description}»: ${path(main, sub)}.` : `أُعيد «${rule.description}» إلى المراجعة؛ لن يُصنَّف تلقائيًا.` })
    } else setNotice({ tone: 'error', text: message(res) })
    setBusy(false)
  }

  if (loadError && !rules) return <Panel><div className="ts-panel-body"><Note tone="error" icon={CircleAlert} action={<Button size="sm" onClick={load}>إعادة المحاولة</Button>}>{loadError}</Note></div></Panel>
  if (!rules) return <Panel><div className="ts-panel-body"><small className="ts-field-hint">جارٍ التحميل…</small></div></Panel>
  if (rules.length === 0) return <Panel title="قاموس الأصناف" icon={ListChecks}><EmptyState icon={ListChecks}>لا قاموس أصناف لهذه المنشأة.</EmptyState>{role==='superadmin'&&<Link className="ts-btn" to="/settings?tab=manage&section=item">إضافة أصناف للقاموس</Link>}</Panel>

  const total = { review: rules.filter(r => r.status === 'review').length, active: rules.filter(r => r.status === 'active').length }
  const row = (r, isReview) => (
    <li key={r.id} className="cs-main" data-id={r.id} data-status={r.status}>
      <div className="cs-row">
        <div className="cs-row-main">
          <strong className="cs-name">{r.description}</strong>
          <div className="cs-meta">
            {isReview
              ? <>{r.suggested_category_id ? <small>مقترح للمراجعة: {path(r.suggested_category_id, r.suggested_subcategory_id)}</small> : <small>بلا اقتراح</small>}
                  {r.note ? <small>{r.note}</small> : null}</>
              : <span className="cs-class">{path(r.category_id, r.subcategory_id) || '—'}</span>}
          </div>
        </div>
        <div className="cs-actions">
          <Button size="sm" variant={isReview ? 'secondary' : 'quiet'} icon={Pencil} disabled={busy} data-k={isReview ? 'dict.assign' : 'dict.edit'}
            aria-label={`${isReview ? 'تصنيف' : 'تعديل'} «${r.description}»`}
            onClick={() => {
              const m = isReview ? r.suggested_category_id : r.category_id
              const main = byId[m]?.is_active !== false && byId[m] && !byId[m].parent_id ? m : ''
              const s = isReview ? r.suggested_subcategory_id : r.subcategory_id
              setDialog({ rule: r, main, sub: main && byId[s]?.parent_id === main && byId[s]?.is_active !== false ? s : '' })
            }}>{isReview ? 'تصنيف' : 'تعديل'}</Button>
          {!isReview && <Button size="sm" variant="quiet" icon={Undo2} disabled={busy} data-k="dict.toReview" aria-label={`إرجاع «${r.description}» للمراجعة`}
            onClick={() => save(r, 'review')}>للمراجعة</Button>}
        </div>
      </div>
    </li>
  )

  return (
    <>
      {role==='superadmin'&&<Link className="ts-btn" to="/settings?tab=manage&section=item">إضافة وتعديل وحذف الأصناف</Link>}
      <Panel title="قاموس الأصناف" icon={ListChecks}
        subtitle={`${total.active} صنف معتمد يُقترح تصنيفه تلقائيًا عند مراجعة المستندات، و${total.review} صنف للمراجعة لا يُصنَّف تلقائيًا حتى تختار تصنيفه.`}>
        <div className="ts-panel-body">
          <SearchBox label="بحث في الأصناف" value={query} onChange={setQuery} placeholder="اسم الصنف أو التصنيف" />
          {notice && <Note tone={notice.tone === 'success' ? 'success' : 'error'} icon={notice.tone === 'success' ? CircleCheck : CircleAlert}>{notice.text}</Note>}
        </div>
      </Panel>

      <Panel title={<>للمراجعة <Status tone="warning">{review.length}</Status></>} icon={CircleAlert}
        subtitle="أصناف لم يُعتمد تصنيفها: تظهر في المستند بلا تصنيف ويختاره المحاسب. صنّفها هنا ليُقترح تلقائيًا بعد ذلك.">
        {review.length === 0 ? <EmptyState icon={CircleCheck}>{q ? 'لا نتائج.' : 'لا أصناف للمراجعة.'}</EmptyState>
          : <ul className="cs-tree" data-k="dict.review">{review.map(r => row(r, true))}</ul>}
      </Panel>

      <Panel title={<>المعتمدة <Status>{active.length}</Status></>} icon={ListChecks} subtitle="تُقترح للبند الذي بلا تصنيف فقط؛ المحاسب يغيّرها في المستند إن لزم.">
        {active.length === 0 ? <EmptyState icon={ListChecks}>{q ? 'لا نتائج.' : 'لا أصناف معتمدة.'}</EmptyState>
          : <ul className="cs-tree" data-k="dict.active">{active.map(r => row(r, false))}</ul>}
      </Panel>

      <Dialog open={!!dialog} onClose={() => !busy && setDialog(null)} title={dialog ? `تصنيف «${dialog.rule.description}»` : ''}
        description="يُقترح هذا التصنيف للصنف في المستندات القادمة. لا يغيّر القيود المعتمدة سابقًا."
        footer={<><Button variant="primary" disabled={busy || !dialog?.main} data-k="dict.save" onClick={() => save(dialog.rule, 'active', dialog.main, dialog.sub)}>{busy ? 'جارٍ الحفظ…' : 'حفظ التصنيف'}</Button>
          <Button disabled={busy} onClick={() => setDialog(null)}>إلغاء</Button></>}>
        {dialog && <div className="ts-form-grid">
          <Field label="التصنيف الرئيسي">
            <Select value={dialog.main} placeholder="— اختر —" data-k="dict.main" options={mains.map(c => ({ value: c.id, label: c.name }))}
              onChange={e => setDialog(d => ({ ...d, main: e.target.value, sub: '' }))} />
          </Field>
          <Field label="التصنيف الفرعي" hint={dialog.main && !subsOf(dialog.main).length ? 'لا فرعيات لهذا التصنيف.' : undefined}>
            <Select value={dialog.sub} placeholder="— بلا فرعي —" data-k="dict.sub" disabled={!dialog.main || !subsOf(dialog.main).length}
              options={subsOf(dialog.main).map(c => ({ value: c.id, label: c.name }))} onChange={e => setDialog(d => ({ ...d, sub: e.target.value }))} />
          </Field>
        </div>}
      </Dialog>
    </>
  )
}
