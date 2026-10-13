import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowRight, Ban, Check, CircleAlert, FileSearch, History, Info, ListChecks, LoaderCircle, Lock, Maximize2, Plus, RotateCcw, Save,
  Trash2, TriangleAlert, ZoomIn, ZoomOut,
} from 'lucide-react'
import {
  Button, ChoiceList, DateInput, Dialog, EmptyState, Field, GrowInput, IconButton, Input, Money, Note, Panel, Segment, Select, Textarea, useToast,
} from '../../ui/components.jsx'
import { formatAgo, formatDate, formatNumber, formatTime, parseDecimal } from '../../ui/format.js'
import { useStore } from '../store.jsx'
import { useUnsavedGuard } from '../useUnsavedGuard.jsx'
import { DocStatus } from './Documents.jsx'
import {
  CATEGORIES, KINDS, PAYMENTS, REJECT_REASONS, TODAY, approvalState, docTotals, invalidNumbers, lineAmount, reviewAlerts,
} from '../model.js'

const TEXT_FIELDS = ['kind', 'party', 'invoiceNo', 'invoiceDate', 'category', 'payment']
const ALERT_ICON = { error: CircleAlert, warning: TriangleAlert, info: Info }
const isPhone = () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 650px)').matches

/** المسودة تحفظ ما كتبه المستخدم نصًا كما هو؛ التحويل إلى أرقام صريح ولا يُسقط شيئًا. */
const draftOf = doc => ({
  ...Object.fromEntries(TEXT_FIELDS.map(k => [k, doc[k] ?? ''])),
  lines: doc.lines.map(l => ({ name: l.name, qty: String(l.qty), price: String(l.price) })),
  printedTotal: doc.printedTotal == null ? '' : String(doc.printedTotal),
})
const parseDraft = draft => ({
  ...Object.fromEntries(TEXT_FIELDS.map(k => [k, draft[k]])),
  lines: draft.lines.map(l => ({ name: l.name, qty: parseDecimal(l.qty), price: parseDecimal(l.price) })),
  printedTotal: String(draft.printedTotal).trim() === '' ? null : parseDecimal(draft.printedTotal),
})

// ── صورة المستند (ورقة مصطنعة تُرسم من لقطة وقت الرفع) ──────────────────────
function QR({ seed }) {
  const cells = []
  let x = seed * 9301 + 49297
  for (let i = 0; i < 81; i++) {
    x = (x * 9301 + 49297) % 233280
    const r = Math.floor(i / 9), c = i % 9
    const finder = (r < 3 && c < 3) || (r < 3 && c > 5) || (r > 5 && c < 3)
    cells.push(<i key={i} className={finder || x / 233280 > 0.55 ? 'on' : ''} />)
  }
  return <div className="rp-qr" aria-hidden="true">{cells}</div>
}

function Paper({ doc }) {
  const p = doc.image
  const t = docTotals({ lines: p.lines, vatRate: p.vatRate, printedTotal: p.printedTotal })
  const printed = p.printedTotal ?? t.total
  const isSales = p.kind === 'sales'
  return (
    <div className={`rp-paper${p.blur ? ' rp-paper--blur' : ''}`} role="img" aria-label={`صورة المستند ${doc.seq} (مصطنعة)`}>
      <span className="rp-paper-stamp">صورة مصطنعة</span>
      <h4>{p.party}</h4>
      <div className="rp-paper-sub">{isSales ? 'تقرير إغلاق يومي — نقاط البيع' : 'فاتورة ضريبية مبسطة'}</div>
      <div className="rp-paper-meta">
        <span>رقم: <span className={`ts-num${p.smudge ? ' rp-smudge' : ''}`}>{p.invoiceNo || '—'}</span></span>
        <span>التاريخ: <span className="ts-num">{p.invoiceDate ? p.invoiceDate.split('-').reverse().join('/') : '—'}</span></span>
      </div>
      <table>
        <thead><tr><th>{isSales ? 'طريقة الدفع' : 'الصنف'}</th>{!isSales && <th className="rp-paper-n">الكمية</th>}{!isSales && <th className="rp-paper-n">السعر</th>}<th className="rp-paper-n">المبلغ</th></tr></thead>
        <tbody>
          {p.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.name}</td>
              {!isSales && <td className="rp-paper-n">{l.qty}</td>}
              {!isSales && <td className="rp-paper-n">{formatNumber(l.price)}</td>}
              <td className="rp-paper-n">{formatNumber(lineAmount(l))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rp-paper-sum">
        <div><span>المجموع قبل الضريبة</span><span className="rp-paper-n">{formatNumber(t.subtotal)}</span></div>
        <div><span>ضريبة القيمة المضافة {Math.round((p.vatRate ?? 0.15) * 100)}%</span><span className="rp-paper-n">{formatNumber(t.vat)}</span></div>
        <div className="rp-paper-total"><span>الإجمالي</span><span className="rp-paper-n">{formatNumber(printed)}</span></div>
      </div>
      <div className="rp-paper-foot">
        <span>الرقم الضريبي <span className="ts-num">300000000000003</span><br />شكرًا لتعاملكم</span>
        <QR seed={doc.seq} />
      </div>
    </div>
  )
}

function ImagePanel({ doc }) {
  const [zoom, setZoom] = useState(1)
  return (
    <Panel className="rp-image-panel" title="صورة المستند" icon={FileSearch}
      action={
        <div className="rp-image-tools">
          <IconButton label="تصغير" icon={ZoomOut} disabled={zoom <= 0.7} onClick={() => setZoom(z => Math.max(0.7, +(z - 0.15).toFixed(2)))} />
          <span className="rp-zoom ts-num" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <IconButton label="تكبير" icon={ZoomIn} disabled={zoom >= 2.2} onClick={() => setZoom(z => Math.min(2.2, +(z + 0.15).toFixed(2)))} />
          <IconButton label="الحجم الأصلي" icon={Maximize2} onClick={() => setZoom(1)} />
        </div>
      }>
      <div className="rp-image-stage">
        <div className="rp-image-scale" style={{ transform: `scale(${zoom})` }}>
          <div style={{ position: 'relative' }}>
            <Paper doc={doc} />
            {doc.status === 'reading' && <div className="rp-reading-scan" aria-hidden="true" />}
          </div>
        </div>
      </div>
    </Panel>
  )
}

// ── البنود ──────────────────────────────────────────────────────────────────
function Lines({ lines, onChange, locked, machine, isSales }) {
  const [removed, setRemoved] = useState(null)
  const update = (i, key, value) => onChange(lines.map((l, j) => (j === i ? { ...l, [key]: value } : l)))
  const remove = i => { setRemoved({ line: lines[i], index: i }); onChange(lines.filter((_, j) => j !== i)) }
  const undo = () => { const next = [...lines]; next.splice(removed.index, 0, removed.line); onChange(next); setRemoved(null) }
  const L = isSales ? { name: 'القناة', qty: '', price: 'المبلغ', total: 'الإجمالي' } : { name: 'اسم البند', qty: 'الكمية', price: 'سعر الوحدة', total: 'الإجمالي' }
  return (
    <div className={`rp-lines${machine ? ' rp-lines--machine' : ''}${isSales ? ' rp-lines--sales' : ''}`}>
      <div className="rp-line rp-line-head" aria-hidden="true">
        <span>{L.name}</span>{!isSales && <span>{L.qty}</span>}<span>{L.price}</span><span className="rp-line-total">{L.total}</span><span />
      </div>
      {lines.map((l, i) => {
        const qtyBad = !isSales && Number.isNaN(parseDecimal(l.qty))
        const priceBad = Number.isNaN(parseDecimal(l.price))
        const amount = qtyBad || priceBad ? null : lineAmount({ qty: isSales ? 1 : parseDecimal(l.qty), price: parseDecimal(l.price) })
        return (
          <div className="rp-line" key={i}>
            <label className="rp-cell rp-cell--name"><span className="rp-cell-label">{L.name}</span>
              <Input value={l.name} disabled={locked} onChange={e => update(i, 'name', e.target.value)} /></label>
            {!isSales && (
              <label className="rp-cell"><span className="rp-cell-label">{L.qty}</span>
                <Input numeric value={l.qty} disabled={locked} aria-invalid={qtyBad || undefined} onChange={e => update(i, 'qty', e.target.value)} /></label>
            )}
            <label className="rp-cell"><span className="rp-cell-label">{L.price}</span>
              <Input numeric value={l.price} disabled={locked} aria-invalid={priceBad || undefined} onChange={e => update(i, 'price', e.target.value)} /></label>
            <div className="rp-cell rp-cell--total"><span className="rp-cell-label">{L.total}</span>
              <span className="rp-line-amount">{amount == null ? '—' : formatNumber(amount)}</span></div>
            {locked ? <span /> : (
              <button type="button" className="rp-line-remove" onClick={() => remove(i)} aria-label={`حذف البند ${l.name || i + 1}`}>
                <Trash2 className="ts-icon--sm" aria-hidden="true" /><span>حذف</span>
              </button>
            )}
            {(qtyBad || priceBad) && <span className="ts-field-error rp-line-error">أدخل رقمًا صالحًا؛ لن يُحسب صفرًا.</span>}
          </div>
        )
      })}
      {removed && !locked && (
        <div className="rp-undo" role="status">
          <span>حُذف «{removed.line.name || 'بند بلا اسم'}».</span>
          <Button size="sm" variant="quiet" icon={RotateCcw} onClick={undo}>تراجع</Button>
        </div>
      )}
      {!locked && <div><Button size="sm" icon={Plus} onClick={() => { setRemoved(null); onChange([...lines, { name: '', qty: isSales ? '1' : '', price: '' }]) }}>إضافة بند</Button></div>}
    </div>
  )
}

function Totals({ parsed, raw, locked, machine, onPrinted, vatRate }) {
  const bad = invalidNumbers(parsed).some(x => x.line != null)
  const t = docTotals({ lines: parsed.lines, printedTotal: Number.isNaN(parsed.printedTotal) ? null : parsed.printedTotal, vatRate })
  const printedBad = Number.isNaN(parsed.printedTotal)
  const differs = !bad && t.printed != null && Math.abs(t.difference) >= 0.01
  const show = v => (bad ? <span className="ts-muted">—</span> : <Money value={v} />)
  return (
    <div className="rp-totals">
      <div className="rp-total-row"><span>المجموع قبل الضريبة</span>{show(t.subtotal)}</div>
      <div className="rp-total-row"><span>ضريبة القيمة المضافة {Math.round(vatRate * 100)}%</span>{show(t.vat)}</div>
      <div className="rp-total-row rp-total-row--strong"><span>الإجمالي المحسوب</span>{show(t.total)}</div>
      <div className={`rp-total-row${machine ? ' ts-field--machine' : ''}`}>
        <label htmlFor="printed-total">الإجمالي المطبوع على المستند</label>
        <Input id="printed-total" numeric value={raw} disabled={locked} aria-invalid={printedBad || undefined} onChange={e => onPrinted(e.target.value)} />
      </div>
      {printedBad && <div className="rp-total-row rp-total-row--diff"><span>الإجمالي المطبوع ليس رقمًا صالحًا</span></div>}
      {bad && <div className="rp-total-row rp-total-row--diff"><span>صحّح القيم غير الصالحة ليُحسب الإجمالي</span></div>}
      {!bad && t.printed != null && !printedBad && (differs
        ? <div className="rp-total-row rp-total-row--diff"><span>الفرق</span><Money value={Math.abs(t.difference)} /></div>
        : <div className="rp-total-row rp-total-row--ok"><span>المطبوع يطابق البنود</span><Check className="ts-icon--sm" aria-hidden="true" /></div>)}
    </div>
  )
}

function RejectDialog({ open, onClose, onReject, doc }) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  useEffect(() => { if (open) { setReason(''); setNote('') } }, [open])
  const needsNote = reason === 'other'
  const ready = reason && (!needsNote || note.trim())
  return (
    <Dialog open={open} onClose={onClose} title="رفض المستند" description={`يعود إلى ${doc.uploadedBy.split(' (')[0]} مع السبب ليعيد رفعه أو يصححه.`}
      footer={<>
        <Button variant="danger-solid" icon={Ban} disabled={!ready} onClick={() => onReject(reason, note)}>رفض المستند</Button>
        <Button onClick={onClose}>إلغاء</Button>
      </>}>
      <ChoiceList label="سبب الرفض" options={REJECT_REASONS} value={reason} onChange={setReason} />
      <Field label={needsNote ? 'اكتب السبب' : 'ملاحظة للرافع (اختيارية)'} hint={needsNote && !note.trim() ? 'مطلوب عند اختيار «سبب آخر»: يصل إلى الرافع كما تكتبه.' : undefined}>
        <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="مثال: الصفحة الثانية من الفاتورة غير موجودة" />
      </Field>
    </Dialog>
  )
}

// ── الشاشة ──────────────────────────────────────────────────────────────────
export default function DocumentReview() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const store = useStore()
  const doc = store.state.documents.find(d => d.id === id)
  const [draft, setDraft] = useState(() => (doc ? draftOf(doc) : null))
  const [view, setView] = useState('fields')
  const [dupConfirmed, setDupConfirmed] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [touched, setTouched] = useState([])
  const [typing, setTyping] = useState(false)

  // يتبع المستند حين تكتمل قراءته أو يتغير بإجراء
  useEffect(() => { if (doc) { setDraft(draftOf(doc)); setTouched([]) } }, [doc?.id, doc?.status, doc?.history.length])

  const parsed = useMemo(() => (draft ? parseDraft(draft) : null), [draft])
  const current = useMemo(() => (doc && parsed ? { ...doc, ...parsed } : doc), [doc, parsed])
  const alerts = useMemo(() => (current ? reviewAlerts(current, store.state) : []), [current, store.state])
  const locked = !doc || doc.status !== 'pending'
  const dirty = !locked && JSON.stringify(draft) !== JSON.stringify(draftOf(doc))

  const saveDraft = () => {
    if (invalidNumbers(parsed).length) return 'بعض الكميات أو الأسعار أو الإجمالي ليست أرقامًا صالحة. صحّحها ثم احفظ.'
    const r = store.save(doc.id, parsed)
    return r.error ? 'تعذّر الحفظ.' : ''
  }
  const guard = useUnsavedGuard(dirty, saveDraft)
  if (!doc) return <EmptyState icon={FileSearch} action={<Link className="ts-btn" to="/documents">كل المستندات</Link>}>المستند غير موجود.</EmptyState>

  const verdict = approvalState(current, alerts, { duplicateConfirmed: dupConfirmed })
  const machineFields = locked ? [] : doc.machineFields.filter(k => !touched.includes(k))
  const machine = key => machineFields.includes(key)
  const edit = (key, value) => {
    setDraft(d => ({ ...d, [key]: value, ...(key === 'kind' ? { category: '' } : {}) }))
    setTouched(t => (t.includes(key) ? t : [...t, key]))
  }
  const save = () => {
    const failed = saveDraft()
    toast(failed || (alerts.some(a => a.blocking) ? 'حُفظت المسودة. الاعتماد ينتظر معالجة التنبيهات.' : 'حُفظت التعديلات (محاكاة محلية)'))
  }
  const approve = () => {
    if (dirty) { const failed = saveDraft(); if (failed) { toast(failed); return } }
    const r = store.approve(doc.id, { duplicateConfirmed: dupConfirmed })
    toast(r.error ? r.reason || 'تعذّر الاعتماد' : 'اعتُمد المستند (محاكاة محلية)')
  }
  const reject = (reason, note) => {
    const r = store.reject(doc.id, { reason, note })
    if (!r.error) { setRejecting(false); toast('رُفض المستند وأُعيد إلى الرافع (محاكاة محلية)') }
  }
  // على الجوال: الحقل الذي فيه المؤشر يُمرَّر إلى الوسط فلا تحجبه لوحة المفاتيح
  const keepInView = e => {
    if (!e.target.matches('input, select, textarea')) return
    setTyping(true)
    if (isPhone()) setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 280)
  }
  const leaveField = e => { if (!e.currentTarget.contains(e.relatedTarget)) setTyping(false) }

  const kindLabel = doc.status === 'reading' ? 'تُقرأ بياناته الآن' : KINDS[draft.kind]?.label
  const isSales = draft.kind === 'sales'
  const last = doc.history[doc.history.length - 1]

  return (
    <div className={`rp-review-page${typing ? ' is-typing' : ''}`}>
      <button type="button" className="ts-back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/documents'))}>
        <ArrowRight className="ts-icon--sm" aria-hidden="true" />المستندات
      </button>
      <div className="rp-review-head">
        <div>
          <h1>{doc.status === 'reading' ? 'مستند جديد' : doc.party || 'جهة غير مقروءة'} <DocStatus status={doc.status} /></h1>
          <p>مستند <span className="ts-num">{doc.seq}</span> · {kindLabel} · رفعه {doc.uploadedBy.split(' (')[0]} {formatAgo(doc.uploadedAt, TODAY)}</p>
        </div>
      </div>

      <div className="rp-view-switch">
        <Segment full label="عرض" value={view} onChange={setView} options={[{ value: 'fields', label: 'البيانات' }, { value: 'image', label: 'صورة المستند' }]} />
      </div>

      <div className="rp-review-grid" data-view={view}>
        <div className="rp-review-fields" onFocus={keepInView} onBlur={leaveField}>
          {doc.status === 'approved' && (
            <Note tone="success" icon={Lock} title={`اعتمده ${doc.approvedBy} · ${formatDate(doc.approvedAt.slice(0, 10))} ${formatTime(doc.approvedAt)}`}>
              مقفل بعد الاعتماد. التصحيح بقيد عكسي بسبب مكتوب (مرحلة لاحقة).
            </Note>
          )}
          {doc.status === 'rejected' && (
            <Note tone="error" icon={Ban} title={`رفضه ${doc.rejection.by}: ${doc.rejection.reason}`}>
              {doc.rejection.note && <>{doc.rejection.note}. </>}أُعيد إلى {doc.uploadedBy.split(' (')[0]}. لا يدخل الإجماليات المعتمدة.
            </Note>
          )}
          {doc.status === 'reading' && (
            <Note tone="info" icon={LoaderCircle} title="تجري القراءة الآلية">تظهر الحقول بعد اكتمال القراءة. (محاكاة بلا إرسال إلى أي مزوّد.)</Note>
          )}
          {!locked && alerts.length > 0 && (
            <div className="rp-alerts" aria-label="تنبيهات المراجعة">
              {alerts.map(a => {
                const Icon = ALERT_ICON[a.tone]
                return (
                  <Note key={a.type} tone={a.tone} icon={Icon} title={a.title}
                    facts={a.facts?.map(f => ({ label: f.label, value: <Money value={f.value} /> }))}
                    details={a.facts ? a.text : undefined}
                    action={a.type === 'duplicate' && (
                      <label className="ts-check">
                        <input type="checkbox" checked={dupConfirmed} onChange={e => setDupConfirmed(e.target.checked)} />
                        <span>راجعتُ المستند الآخر، وهذا مستند مختلف. <Link to={`/documents/${a.otherId}`}>افتح الآخر</Link></span>
                      </label>
                    )}>
                    {!a.facts && a.text}
                  </Note>
                )
              })}
            </div>
          )}

          {doc.status === 'reading' ? (
            <Panel title="بيانات المستند" icon={ListChecks}><div className="ts-panel-body rp-skeleton">{[0, 1, 2, 3, 4].map(i => <i key={i} />)}</div></Panel>
          ) : (
            <Panel title="بيانات المستند" icon={ListChecks}
              subtitle={locked ? 'للاطلاع فقط' : machineFields.length ? <span className="rp-legend"><i aria-hidden="true" />المظلل قرأه النظام آليًا — طابقه مع الصورة</span> : 'طابق الحقول مع الصورة'}>
              <div className="rp-section">
                <Segment full label="نوع المستند" value={draft.kind} onChange={v => !locked && edit('kind', v)}
                  options={Object.entries(KINDS).map(([value, k]) => ({ value, label: k.label }))} />
                <p className="rp-kind-hint">{KINDS[draft.kind]?.hint}</p>
                <div className="ts-form-grid">
                  <Field label={isSales ? 'المصدر' : 'المورد أو الجهة'} span machine={machine('party')}>
                    <GrowInput value={draft.party} disabled={locked} onChange={e => edit('party', e.target.value)} />
                  </Field>
                  <Field label="التصنيف" machine={machine('category')}>
                    <Select value={draft.category} disabled={locked} placeholder="اختر التصنيف" onChange={e => edit('category', e.target.value)}
                      options={(CATEGORIES[draft.kind] || []).map(c => ({ value: c, label: c }))} />
                  </Field>
                  <Field label={isSales ? 'رقم التقرير' : 'رقم الفاتورة'} machine={machine('invoiceNo')}
                    hint={!isSales && !draft.invoiceNo && !locked ? 'لم تقرأه القراءة الآلية. اكتبه من الصورة.' : undefined}>
                    <Input numeric value={draft.invoiceNo} disabled={locked} onChange={e => edit('invoiceNo', e.target.value)} />
                  </Field>
                  <Field label={isSales ? 'يوم المبيعات' : 'تاريخ الفاتورة'} machine={machine('invoiceDate')}>
                    <DateInput value={draft.invoiceDate} max={TODAY} disabled={locked} onChange={v => edit('invoiceDate', v)} />
                  </Field>
                  {!isSales && (
                    <Field label="طريقة الدفع" span hint="تحدد الرصيد الذي ينقص، أو دينًا على المورد.">
                      <Select value={draft.payment} disabled={locked} placeholder="اختر طريقة الدفع" onChange={e => edit('payment', e.target.value)} options={PAYMENTS} />
                    </Field>
                  )}
                </div>
              </div>
              <div className="rp-section">
                <h3>{isSales ? 'المبيعات حسب طريقة الدفع' : 'البنود'} <span className="ts-field-hint">قبل الضريبة</span></h3>
                <Lines lines={draft.lines} locked={locked} machine={machine('lines')} isSales={isSales} onChange={v => edit('lines', v)} />
                <Totals parsed={parsed} raw={draft.printedTotal} locked={locked} machine={machine('printedTotal')} vatRate={doc.vatRate ?? 0.15} onPrinted={v => edit('printedTotal', v)} />
              </div>
              {!locked && (
                <div className="rp-action-bar">
                  {!verdict.can && <div className="rp-action-why"><Info className="ts-icon--sm" aria-hidden="true" />{verdict.reason}</div>}
                  <div className="rp-action-buttons">
                    <Button variant="primary" icon={Check} className="rp-approve" disabled={!verdict.can} onClick={approve}>
                      {dirty ? 'حفظ واعتماد' : 'اعتماد'}
                    </Button>
                    <Button icon={Save} className="rp-save" disabled={!dirty} onClick={save}>{alerts.some(a => a.blocking) ? 'حفظ المسودة' : 'حفظ'}</Button>
                    <Button variant="quiet" icon={Ban} className="rp-reject" onClick={() => setRejecting(true)}>رفض</Button>
                  </div>
                </div>
              )}
            </Panel>
          )}

          <Panel title="سجل المستند" icon={History} subtitle={last ? `آخر إجراء ${formatAgo(last.at, TODAY)}` : undefined}>
            <ol className="rp-timeline">
              {[...doc.history].reverse().map((h, i) => (
                <li key={i}><div>{h.text}<small>{h.by} · {formatDate(h.at.slice(0, 10))} {formatTime(h.at)}</small></div></li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="rp-image-col"><ImagePanel doc={doc} /></div>
      </div>

      <RejectDialog open={rejecting} doc={doc} onClose={() => setRejecting(false)} onReject={reject} />
      {guard}
    </div>
  )
}
