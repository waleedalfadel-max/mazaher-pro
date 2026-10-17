// إعدادات المالك — «التصنيفات» و«الموظفون» (TeamSettings.jsx) و«قاموس الأصناف» (ItemDictionary.jsx). لا تُعرض أقسام غير جاهزة.
// كل تغيير يمر بدوال الخادم (supabase/migrations/20260928000800_category_settings.sql): المالك الفعلي وحده، في منشأته،
// مع التحقق والسجل هناك. الشاشة تعيد القراءة من الخادم بعد كل حفظ، فما يظهر هو المحفوظ.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, History, Lock, Pencil, Plus, Power, PowerOff, Tags, TriangleAlert } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Button, ChoiceList, Dialog, EmptyState, Field, IconButton, Input, Note, Panel, Status, Switch, Tabs } from '../ui/components.jsx'
import { formatAgo, plural } from '../ui/format.js'
import { CLASSES, actionLabel, categoryMessage, categoryTree, classOf, cleanName, nameError } from '../lib/categorySettings'
import TeamSettings from './TeamSettings.jsx'
import ItemDictionary from './ItemDictionary.jsx'

const entriesText = n => plural(n, 'قيد واحد', 'قيدان', 'قيود', 'قيدًا')
const itemsText = n => plural(n, 'بند واحد', 'بندان', 'بنود', 'بندًا')
const usageText = u => {
  const n = Number(u?.entries || 0), m = Number(u?.items || 0)
  if (!n && !m) return 'غير مستخدم بعد'
  return [n && entriesText(n), m && itemsText(m)].filter(Boolean).join('، ')
}
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const isUsed = u => Number(u?.entries || 0) + Number(u?.items || 0) > 0
const REVIEW_STATUS = { ambiguous_main: 'يطابق أكثر من تصنيف رئيسي', unmatched_main: 'لا يطابق أي تصنيف', ambiguous_sub: 'يطابق أكثر من فرعي', unmatched_sub: 'فرعي لا يطابق' }

async function call(fn, args) {
  try {
    const { data, error } = await supabase.rpc(fn, args)
    if (error || !data) return { ok: false, code: 'network' }
    return data
  } catch { return { ok: false, code: 'network' } }
}

const TABS = [{ value: 'categories', label: 'التصنيفات' }, { value: 'team', label: 'الموظفون' }, { value: 'items', label: 'قاموس الأصناف' }]
const initialTab = () => { try { const t = new URLSearchParams(window.location.search).get('tab'); return TABS.some(x => x.value === t) ? t : 'categories' } catch { return 'categories' } }

export default function Settings() {
  const [tab, setTab] = useState(initialTab)
  // «قاموس الأصناف» يظهر للمنشأة التي لها قاموس فقط (20261014140000)؛ غيرها يرى القسمين كما كانا
  const [hasDictionary, setHasDictionary] = useState(false)
  useEffect(() => {
    supabase.from('item_category_rules').select('id', { count: 'exact', head: true })
      .then(({ count, error }) => setHasDictionary(!error && count > 0))
  }, [])
  const [state, setState] = useState(null)          // ناتج category_settings
  const [loadError, setLoadError] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [busy, setBusy] = useState('')                // مفتاح العملية الجارية: كل الأزرار معطّلة حتى تنتهي
  const [notice, setNotice] = useState(null)          // { tone, text }
  const [dialog, setDialog] = useState(null)          // { kind: 'main'|'sub'|'edit'|'disable', ... }

  const load = useCallback(async () => {
    const data = await call('category_settings')
    if (!data.ok) { setLoadError(categoryMessage(data)); return null }
    setLoadError(''); setState(data); return data
  }, [])
  useEffect(() => { load() }, [load])

  const cats = state?.categories || []
  const byId = useMemo(() => Object.fromEntries(cats.map(c => [c.id, c])), [cats])
  const tree = useMemo(() => categoryTree(cats, { showInactive }), [cats, showInactive])
  const inactiveCount = cats.filter(c => c.is_active === false).length
  const canEdit = !!state?.can_edit

  // عملية واحدة في كل مرة؛ النتيجة من الخادم ثم إعادة القراءة
  async function run(key, fn, args, success) {
    if (busy) return { ok: false, code: 'busy' }
    setBusy(key); setNotice(null)
    const res = await call(fn, args)
    if (res.ok) { await load(); setNotice({ tone: 'success', text: typeof success === 'function' ? success(res) : success }) }
    setBusy('')
    return res
  }
  const rowAction = async (key, fn, args, success) => {
    const res = await run(key, fn, args, success)
    if (!res.ok && res.code !== 'busy') setNotice({ tone: 'error', text: categoryMessage(res) })
  }

  const move = (c, dir) => rowAction(`move:${c.id}`, 'category_move', { p_id: c.id, p_direction: dir, p_skip_inactive: !showInactive },
    `تغيّر ترتيب «${c.name}».`)
  const enable = c => rowAction(`active:${c.id}`, 'category_set_active', { p_id: c.id, p_active: true }, res => {
    const extra = []
    if (res.subs_inactive > 0) extra.push(`${res.subs_inactive} فرعي عُطّل بنفسه يبقى معطّلًا`)
    if (res.parent_inactive) extra.push('لن يظهر للاختيار حتى يُفعَّل رئيسيه')
    return `أُعيد تفعيل «${c.name}».${extra.length ? ` ${extra.join('، ')}.` : ''}`
  })

  const tabs = <Tabs label="أقسام الإعدادات" tabs={TABS.filter(t => t.value !== 'items' || hasDictionary || tab === 'items')} value={tab} onChange={setTab} />
  if (tab === 'team') return <div className="cs-page"><Heading />{tabs}<TeamSettings /></div>
  if (tab === 'items') return <div className="cs-page"><Heading />{tabs}<ItemDictionary /></div>
  if (loadError && !state) {
    return (
      <div className="cs-page">
        <Heading />
        {tabs}
        <Note tone="error" icon={CircleAlert} title="تعذّر فتح الإعدادات">{loadError}</Note>
      </div>
    )
  }
  if (!state) return <div className="cs-page"><Heading />{tabs}<p className="ts-muted">جارٍ التحميل…</p></div>

  const disabledAll = !canEdit || !!busy
  return (
    <div className="cs-page">
      <Heading />
      {tabs}
      <Panel title="التصنيفات" icon={Tags}
        subtitle="تصنيفات المشتريات والمصروفات التي يختار منها المحاسب عند مراجعة المستندات، وتُجمع بها التقارير."
        action={<Button variant="primary" icon={Plus} disabled={disabledAll} onClick={() => setDialog({ kind: 'main' })}>تصنيف رئيسي</Button>}>
        <div className="ts-panel-body cs-intro">
          {!canEdit && (
            <Note tone="warning" icon={Lock} title="للعرض فقط الآن">{categoryMessage({ code: state.blocked })}</Note>
          )}
          {notice && <Note tone={notice.tone === 'success' ? 'success' : 'error'} icon={notice.tone === 'success' ? CircleCheck : CircleAlert}>{notice.text}</Note>}
          <div className="cs-toolbar">
            <p className="ts-field-hint">الاسم للعرض، وتغييره لا يغيّر الأرقام. التعطيل يخفي التصنيف من العمليات الجديدة، والقيود السابقة تبقى محسوبة.</p>
            <Switch label={`إظهار المعطّلة${inactiveCount ? ` (${inactiveCount})` : ''}`} checked={showInactive} onChange={setShowInactive} />
          </div>
        </div>
        {tree.length === 0
          ? <EmptyState icon={Tags}>لا تصنيفات بعد.</EmptyState>
          : (
            <ul className="cs-tree">
              {tree.map((m, mi) => {
                const cls = classOf(m.financial_class)
                return (
                  <li key={m.id} className={`cs-main${m.is_active === false ? ' is-off' : ''}`} data-id={m.id}>
                    <CatRow c={m} main cls={cls} first={mi === 0} last={mi === tree.length - 1} disabled={disabledAll} busy={busy}
                      onUp={() => move(m, -1)} onDown={() => move(m, 1)} onEdit={() => setDialog({ kind: 'edit', c: m })}
                      onToggle={() => (m.is_active === false ? enable(m) : setDialog({ kind: 'disable', c: m }))}
                      onAddSub={() => setDialog({ kind: 'sub', parent: m })} />
                    {m.is_active === false && m.subs.length > 0 && (
                      <p className="cs-off-note">الرئيسي معطّل، ففروعه لا تظهر للاختيار. تبقى حالة كل فرعي كما هي عند إعادة التفعيل.</p>
                    )}
                    {m.subs.length > 0 && (
                      <ul className="cs-subs">
                        {m.subs.map((s, si) => (
                          <li key={s.id} className={s.is_active === false ? 'is-off' : ''} data-id={s.id}>
                            <CatRow c={s} first={si === 0} last={si === m.subs.length - 1} disabled={disabledAll} busy={busy}
                              onUp={() => move(s, -1)} onDown={() => move(s, 1)} onEdit={() => setDialog({ kind: 'edit', c: s, parent: m })}
                              onToggle={() => (s.is_active === false ? enable(s) : setDialog({ kind: 'disable', c: s, parent: m }))} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
      </Panel>

      {state.review?.length > 0 && <ReviewPanel rows={state.review} />}
      {state.changes?.length > 0 && <ChangesPanel changes={state.changes} byId={byId} />}

      {dialog?.kind === 'main' && (
        <CategoryDialog title="تصنيف رئيسي جديد" siblings={cats.filter(c => !c.parent_id)} withClass busy={busy}
          onClose={() => setDialog(null)}
          onSave={({ name, cls }) => run('create', 'category_create', { p_name: name, p_parent_id: null, p_financial_class: cls },
            res => `أُضيف «${res.category.name}» (${classOf(res.category.financial_class)?.short}). يظهر الآن في مراجعة المستندات.`)} />
      )}
      {dialog?.kind === 'sub' && (
        <CategoryDialog title={`فرعي جديد تحت «${dialog.parent.name}»`} siblings={cats.filter(c => c.parent_id === dialog.parent.id)} parent={dialog.parent}
          busy={busy} onClose={() => setDialog(null)}
          onSave={({ name }) => run('create', 'category_create', { p_name: name, p_parent_id: dialog.parent.id, p_financial_class: null },
            res => `أُضيف «${res.category.name}» تحت «${dialog.parent.name}».`)} />
      )}
      {dialog?.kind === 'edit' && (
        <CategoryDialog title={`تعديل «${dialog.c.name}»`} edit={dialog.c} parent={dialog.parent} busy={busy}
          siblings={cats.filter(c => (c.parent_id || null) === (dialog.c.parent_id || null))} withClass={!dialog.c.parent_id}
          onClose={() => setDialog(null)}
          onSave={async ({ name, cls }) => {
            const c = dialog.c
            if (cleanName(name) !== c.name) {
              const r = await run('rename', 'category_rename', { p_id: c.id, p_name: name }, res => `صار الاسم «${res.category.name}». القيود السابقة تظهر به، وأرقامها كما هي.`)
              if (!r.ok) return r
            }
            if (!c.parent_id && cls && cls !== c.financial_class) {
              return run('class', 'category_set_class', { p_id: c.id, p_financial_class: cls }, `تغيّرت معالجة «${cleanName(name)}» إلى «${classOf(cls)?.short}».`)
            }
            return { ok: true }
          }} />
      )}
      {dialog?.kind === 'disable' && (
        <DisableDialog c={dialog.c} parent={dialog.parent} busy={busy} activeSubs={cats.filter(s => s.parent_id === dialog.c.id && s.is_active !== false).length}
          onClose={() => setDialog(null)}
          onConfirm={() => run(`active:${dialog.c.id}`, 'category_set_active', { p_id: dialog.c.id, p_active: false },
            `عُطّل «${dialog.c.name}». لن يظهر في العمليات الجديدة، والقيود السابقة باقية ومحسوبة.`)} />
      )}
    </div>
  )
}

function Heading() {
  return (
    <div className="ts-heading">
      <div>
        <h1>الإعدادات</h1>
        <p>يديرها مالك المنشأة. تُحفظ مباشرة في منشأتك.</p>
      </div>
    </div>
  )
}

function CatRow({ c, main, cls, first, last, disabled, busy, onUp, onDown, onEdit, onToggle, onAddSub }) {
  const off = c.is_active === false
  const pending = busy && (busy === `move:${c.id}` || busy === `active:${c.id}`)
  return (
    <div className={`cs-row${main ? ' cs-row--main' : ''}`}>
      <div className="cs-row-main">
        <strong className="cs-name">{c.name}</strong>
        <div className="cs-meta">
          {main && cls && <span className={`cs-class cs-class--${cls.value}`}>{cls.short}</span>}
          {off && <Status tone="neutral">معطّل</Status>}
          <small>{usageText(c.usage)}</small>
        </div>
      </div>
      <div className="cs-actions">
        <IconButton label={`نقل «${c.name}» لأعلى`} icon={ArrowUp} disabled={disabled || first} onClick={onUp} />
        <IconButton label={`نقل «${c.name}» لأسفل`} icon={ArrowDown} disabled={disabled || last} onClick={onDown} />
        <Button size="sm" icon={Pencil} disabled={disabled} onClick={onEdit} aria-label={`تعديل «${c.name}»`}>تعديل</Button>
        <Button size="sm" variant={off ? 'secondary' : 'quiet'} icon={off ? Power : PowerOff} disabled={disabled} onClick={onToggle}
          aria-label={`${off ? 'تفعيل' : 'تعطيل'} «${c.name}»`}>{pending ? '…' : off ? 'تفعيل' : 'تعطيل'}</Button>
        {main && <Button size="sm" icon={Plus} disabled={disabled || off} onClick={onAddSub} aria-label={`إضافة فرعي تحت «${c.name}»`}>فرعي</Button>}
      </div>
    </div>
  )
}

/** إضافة أو تعديل: الاسم، والمعالجة للرئيسي (تُختار عند الإنشاء، وتتغير فقط إن لم يُستعمل). */
function CategoryDialog({ title, siblings, parent, edit, withClass, busy, onClose, onSave }) {
  const [name, setName] = useState(edit?.name || '')
  const [cls, setCls] = useState(edit?.financial_class || '')
  const [error, setError] = useState('')
  const [touched, setTouched] = useState(false)
  const used = edit && isUsed(edit.usage)
  const localError = nameError(name, siblings, edit?.id)
  const classLocked = !!edit && used
  const parentCls = parent ? classOf(parent.financial_class) : null
  const unchanged = edit && cleanName(name) === edit.name && (!withClass || cls === edit.financial_class)
  const missingClass = withClass && !edit && !cls

  async function submit(e) {
    e?.preventDefault()
    setTouched(true)
    if (busy || localError || missingClass || unchanged) return
    setError('')
    const res = await onSave({ name: cleanName(name), cls: withClass ? cls : null })
    if (res?.ok) onClose()
    else if (res && res.code !== 'busy') setError(categoryMessage(res))
  }
  return (
    <Dialog open title={title} onClose={() => !busy && onClose()}
      footer={<>
        <Button variant="quiet" disabled={!!busy} onClick={onClose}>إلغاء</Button>
        <Button variant="primary" disabled={!!busy || !!localError || missingClass || unchanged} onClick={submit}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</Button>
      </>}>
      <form className="cs-form" onSubmit={submit}>
        <Field label="الاسم" error={(touched || name) && localError ? localError : error || undefined}
          hint={edit ? 'إعادة التسمية لا تغيّر المعالجة ولا الأرقام؛ القيود السابقة تظهر بالاسم الجديد.' : 'يظهر في مراجعة المستندات والتقارير.'}>
          <Input value={name} maxLength={80} onChange={e => { setName(e.target.value); setError('') }} aria-label="اسم التصنيف" />
        </Field>
        {withClass && !classLocked && (
          <div className="cs-class-choice">
            <div className="ts-field-label">المعالجة في الحسابات</div>
            <ChoiceList label="المعالجة في الحسابات" value={cls} onChange={v => { setCls(v); setError('') }}
              options={CLASSES.map(c => ({ value: c.value, label: <span className="cs-choice"><strong>{c.label}</strong><small>{c.effect}</small></span> }))} />
            <p className="ts-field-hint">تُحدَّد الآن، ولا تتغير بعد استعمال التصنيف في قيد، حتى لا تنتقل أرقام سابقة بين المشتريات والمصروفات.</p>
            {touched && missingClass && <span className="ts-field-error">اختر المعالجة.</span>}
          </div>
        )}
        {withClass && classLocked && (
          <Note tone="info" icon={Lock} title={`المعالجة: ${classOf(edit.financial_class)?.label || '—'}`}>
            ثابتة لأن التصنيف مستخدم ({usageText(edit.usage)}). لمعالجة أخرى أنشئ تصنيفًا جديدًا.
          </Note>
        )}
        {parentCls && !withClass && (
          <Note tone="info" icon={Tags} title={`يتبع معالجة «${parent.name}»: ${parentCls.label}`}>{parentCls.effect}</Note>
        )}
      </form>
    </Dialog>
  )
}

function DisableDialog({ c, parent, activeSubs, busy, onClose, onConfirm }) {
  const [error, setError] = useState('')
  const main = !c.parent_id
  return (
    <Dialog open title={`تعطيل «${c.name}»؟`} onClose={() => !busy && onClose()}
      footer={<>
        <Button variant="quiet" disabled={!!busy} onClick={onClose}>إلغاء</Button>
        <Button variant="primary" icon={PowerOff} disabled={!!busy} onClick={async () => {
          const res = await onConfirm()
          if (res?.ok) onClose(); else if (res && res.code !== 'busy') setError(categoryMessage(res))
        }}>{busy ? 'جارٍ الحفظ…' : 'تعطيل'}</Button>
      </>}>
      <ul className="cs-effects">
        <li>لن يظهر{main && activeSubs ? ` هو وفروعه (${activeSubs})` : ''} في مراجعة المستندات والقراءة الآلية، ويرفضه الخادم في أي اعتماد جديد.</li>
        <li>القيود السابقة ({usageText(c.usage)}) تبقى كما هي، وتظهر في التقارير وتُحسب.</li>
        <li>يمكن إعادة تفعيله في أي وقت.{main ? ' الفروع التي تعطّلها بنفسها تبقى معطّلة عند إعادة تفعيله.' : ''}</li>
        {!main && parent && <li>الرئيسي «{parent.name}» يبقى كما هو.</li>}
      </ul>
      {error && <Note tone="error" icon={CircleAlert}>{error}</Note>}
    </Dialog>
  )
}

function ReviewPanel({ rows }) {
  // صف لكل اسم محفوظ، بأعداد القيود والبنود
  const groups = Object.values(rows.reduce((m, r) => {
    const key = `${r.main}|${r.sub}|${r.status}`
    m[key] = m[key] || { main: r.main, sub: r.sub, status: r.status, ledger: 0, item: 0 }
    m[key][r.source] += Number(r.rows || 0)
    return m
  }, {}))
  return (
    <Panel title="أسماء سابقة لم تُربط" icon={TriangleAlert}
      subtitle="قيود وبنود قديمة بأسماء لم تُربط بتصنيف، لأن الاسم يطابق أكثر من تصنيف أو لا يطابق أيًّا منها. تبقى محسوبة في التقارير باسمها المحفوظ، ولا تُربط بالتخمين.">
      <ul className="rp-rows cs-review">
        {groups.map(g => (
          <li key={`${g.main}|${g.sub}|${g.status}`}>
            <div className="rp-row-main">
              <strong>{g.main || '—'}{g.sub ? ` / ${g.sub}` : ''}</strong>
              <small>{REVIEW_STATUS[g.status] || g.status} · {[g.ledger && entriesText(g.ledger), g.item && itemsText(g.item)].filter(Boolean).join('، ')}</small>
            </div>
            <Status tone="warning">للمراجعة</Status>
          </li>
        ))}
      </ul>
      <p className="ts-panel-body ts-field-hint">ربطها بتصنيف محدد قرار يتخذه المالك؛ لم يُنفَّذ في هذه النسخة.</p>
    </Panel>
  )
}

function ChangesPanel({ changes, byId }) {
  return (
    <Panel title="آخر التغييرات" icon={History} subtitle="كل تغيير يُسجَّل بمنفّذه ووقته.">
      <ul className="rp-rows rp-rows--tight cs-log">
        {changes.slice(0, 10).map((l, i) => {
          const name = l.after?.name || l.before?.name || byId[l.category_id]?.name || 'تصنيف'
          const detail = l.action === 'rename' ? `من «${l.before?.name}» إلى «${l.after?.name}»`
            : l.action === 'set_class' ? `إلى «${classOf(l.after?.financial_class)?.short || ''}»` : ''
          return (
            <li key={i}>
              <div className="rp-row-main">
                <strong>«{name}» {actionLabel(l.action)} {detail}</strong>
                <small>{l.by || '—'} · {formatAgo(l.at, todayIso())}</small>
              </div>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
