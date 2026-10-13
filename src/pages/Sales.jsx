import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Info, ReceiptText, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { fetchEveryRow } from '../lib/fetchAll.js'
import { DateInput, EmptyState, Field, Panel, Segment, Button } from '../ui/components.jsx'
import { formatDate, formatNumber } from '../ui/format.js'

// المبيعات بالهوية الجديدة. الحسابات كما كانت حرفيًا: سجلات جدول sales في الفترة، ومجموع كل قناة على سجلات الفترة، والإجمالي =
// مجموع القنوات، وإجمالي الصف = مجموع قنواته؛ وبطاقات القنوات التي فيها مبيعات (أو أول قناتين إن لم توجد)، والفترة كما كانت.
// التغيير: التحميل كامل بترتيب ثابت (التاريخ الأحدث أولًا، ثم وقت الإنشاء، ثم المعرّف) بدل آخر 200 سجل، وفشل أي دفعة رسالة بإعادة
// محاولة بلا صفوف ولا مجاميع؛ وجدول على الكمبيوتر وبطاقات على الجوال. المقارنة قبل وبعد: local-test/sales-figures.mjs.

const QUICK_PERIODS = [
  { value: 'month',     label: 'الشهر الحالي' },
  { value: 'lastMonth', label: 'الشهر الماضي' },
  { value: 'year',      label: 'السنة الحالية' },
  { value: 'custom',    label: 'فترة أخرى' },
]

// قنوات المشاريع العادية (كما كانت؛ «نينجا» لا عمود لها في جدول المبيعات — مسجّلة في المتبقي)
const CHANNELS = [
  { key: 'cash_sales',    label: 'مبيعات كاش',       tone: 'cash' },
  { key: 'network_sales', label: 'مبيعات شبكة / مدى', tone: 'network' },
  { key: 'hunger_sales',  label: 'هنقر ستيشن',         tone: 'hunger' },
  { key: 'jahez_sales',   label: 'جاهز',               tone: 'jahez' },
  { key: 'keeta_sales',   label: 'كيتا',               tone: 'keeta' },
  { key: 'ninja_sales',   label: 'نينجا',              tone: 'ninja' },
]

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getRange(type) {
  const n  = new Date()
  const to = fmtDate(n)
  if (type === 'lastMonth') {
    const lm  = new Date(n.getFullYear(), n.getMonth() - 1, 1)
    const lme = new Date(n.getFullYear(), n.getMonth(), 0)
    return { from: fmtDate(lm), to: fmtDate(lme) }
  }
  const from = type === 'year'
    ? `${n.getFullYear()}-01-01`
    : `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`
  return { from, to }
}

const reason = error => (/failed to fetch|network|load failed/i.test(error?.message || '') ? 'تعذّر الاتصال بالخادم؛ تحقق من الاتصال ثم أعد المحاولة.' : (error?.message || 'خطأ غير معروف'))
const fmt = v => formatNumber(v || 0, 2)
const rowTotalOf = r => CHANNELS.reduce((s, c) => s + (r[c.key] || 0), 0)

export default function Sales() {
  const { projectId } = useAuth()
  const [rows,         setRows]         = useState([])
  const [loading,      setLoading]      = useState(true)
  const [loadError,    setLoadError]    = useState('')
  const [filter,       setFilter]       = useState(getRange('month'))
  const [activePeriod, setActivePeriod] = useState('month')
  const loadSeq = useRef(0)

  useEffect(() => { if (projectId) load(projectId, filter) }, [projectId])

  // كل سجلات الفترة بلا حد للعدد؛ أي فشل ← رسالة بلا صفوف ولا مجاميع. نتيجة أقدم من آخر طلب تُهمل.
  async function load(pid, f) {
    const seq = ++loadSeq.current
    setLoading(true); setLoadError('')
    const res = await fetchEveryRow(() => {
      let q = supabase.from('sales').select('*').eq('project_id', pid)
      if (f.from) q = q.gte('date', f.from)
      if (f.to)   q = q.lte('date', f.to)
      return q.order('date', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false })
    })
    if (seq !== loadSeq.current) return
    if (res.error) { setRows([]); setLoadError(reason(res.error)) } else setRows(res.data)
    setLoading(false)
  }

  // المجاميع كما كانت: لكل قناة على سجلات الفترة، والإجمالي = مجموع القنوات
  const totals = useMemo(() => {
    const t = {}
    CHANNELS.forEach(c => { t[c.key] = rows.reduce((s, r) => s + (r[c.key] || 0), 0) })
    t.total = CHANNELS.reduce((s, c) => s + (t[c.key] || 0), 0)
    return t
  }, [rows])

  function choosePeriod(key) {
    setActivePeriod(key)
    if (key === 'custom') return
    const r = getRange(key)
    setFilter(r)
    if (projectId) load(projectId, r)
  }
  function setDate(field, val) {
    setActivePeriod('custom')
    const f = { ...filter, [field]: val }
    setFilter(f)
    if (projectId) load(projectId, f)
  }

  // عرض فقط القنوات التي فيها مبيعات (وإلا أول قناتين) كما كان
  const activeChannels = CHANNELS.filter(c => totals[c.key] > 0)
  const cardChannels = activeChannels.length > 0 ? activeChannels : CHANNELS.slice(0, 2)

  const refYear = Number((filter.to || fmtDate(new Date())).slice(0, 4))
  const day = iso => (iso ? formatDate(iso, { refYear, day: true }) : '—')
  const rangeText = filter.from && filter.to
    ? (filter.from === filter.to ? formatDate(filter.from, { year: true }) : `${formatDate(filter.from, { year: filter.from.slice(0, 4) !== filter.to.slice(0, 4) })} – ${formatDate(filter.to, { year: true })}`)
    : 'كل التواريخ'

  return (
    <div className="ldg-page sls-page">
      <div className="ts-heading">
        <div>
          <h1>المبيعات</h1>
          <p className="ldg-showing">
            <CalendarDays className="ts-icon--sm" aria-hidden="true" />
            <span>{rangeText}</span>
            <span aria-hidden="true">·</span>
            <span data-k="sales.count">{loading || loadError ? '—' : `${rows.length} سجل`}</span>
          </p>
        </div>
      </div>

      <Panel className="ldg-filters jx-filters" title="الفترة" icon={CalendarDays}>
        <div className="ts-panel-body ldg-filter-body">
          <Segment label="الفترة" value={activePeriod} onChange={choosePeriod} options={QUICK_PERIODS} />
          <div className="ldg-filter-row jx-filter-row">
            <Field label="من"><DateInput value={filter.from} onChange={iso => setDate('from', iso)} /></Field>
            <Field label="إلى"><DateInput value={filter.to} onChange={iso => setDate('to', iso)} /></Field>
            <Button icon={RefreshCw} onClick={() => load(projectId, filter)} disabled={loading}>تحديث</Button>
          </div>
        </div>
      </Panel>

      {loading ? (
        <Panel><div className="ldg-loading" aria-busy="true">جارٍ تحميل المبيعات…</div></Panel>
      ) : loadError ? (
        <div className="ts-note ts-note--error ldg-load-error" data-k="sales.loadError" role="alert">
          <Info className="ts-icon" aria-hidden="true" />
          <div className="ts-note-body">
            <strong>تعذّر تحميل مبيعات هذه الفترة كاملة، فلم تُعرض السجلات ولا المجاميع.</strong>
            عرض جزء منها كأنه كامل يعطي مجاميع خاطئة. {loadError}
            <div className="ts-note-action"><Button size="sm" variant="primary" icon={RefreshCw} onClick={() => load(projectId, filter)}>إعادة المحاولة</Button></div>
          </div>
        </div>
      ) : (
        <>
          {/* بطاقات القنوات والإجمالي */}
          <div className="sls-cards" data-k="sales.cards">
            {cardChannels.map(c => (
              <div key={c.key} className={`sls-card is-${c.tone}`} data-channel={c.key}>
                <span>{c.label}</span>
                <strong className="ts-num" data-k="value">{fmt(totals[c.key])}</strong>
              </div>
            ))}
            <div className="sls-card is-total" data-channel="total">
              <span>الإجمالي</span>
              <strong className="ts-num" data-k="value">{fmt(totals.total)}</strong>
            </div>
          </div>

          {/* الكمبيوتر */}
          <Panel className="ldg-table-panel" clip>
            <div className="ldg-scroll">
              <table className="ts-table ldg-table sls-table" data-table="sales.rows">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    {CHANNELS.map(c => <th key={c.key} className="ts-end">{c.label}</th>)}
                    <th className="ts-end">الإجمالي</th>
                    <th>ملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={CHANNELS.length + 3}><EmptyState icon={ReceiptText}>لا توجد مبيعات في هذه الفترة.</EmptyState></td></tr>
                  )}
                  {rows.map(r => (
                    <tr key={r.id} data-id={r.id}>
                      <td data-k="date" data-iso={r.date || ''} className="ldg-date">{day(r.date)}</td>
                      {CHANNELS.map(c => (
                        <td key={c.key} data-k={c.key} className={`ts-end ts-num${r[c.key] > 0 ? ` sls-v is-${c.tone}` : ' ldg-nil'}`}>{r[c.key] > 0 ? fmt(r[c.key]) : '—'}</td>
                      ))}
                      <td data-k="total" className="ts-end ts-num sls-total">{fmt(rowTotalOf(r))}</td>
                      <td data-k="desc" className="ldg-desc" title={r.description || ''}>{r.description || '—'}</td>
                    </tr>
                  ))}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="sls-foot" data-k="sales.foot">
                      <td>الإجمالي</td>
                      {CHANNELS.map(c => (
                        <td key={c.key} data-k={c.key} className="ts-end ts-num">{totals[c.key] > 0 ? fmt(totals[c.key]) : '—'}</td>
                      ))}
                      <td data-k="total" className="ts-end ts-num">{fmt(totals.total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Panel>

          {/* الجوال: بطاقة لكل سجل بالقنوات التي فيها مبيعات */}
          <div className="ldg-cards" data-cards="sales.rows">
            {rows.length === 0 && <Panel><EmptyState icon={ReceiptText}>لا توجد مبيعات في هذه الفترة.</EmptyState></Panel>}
            {rows.map(r => {
              const moves = CHANNELS.filter(c => r[c.key] > 0)
              return (
                <article key={r.id} className="ldg-card sls-row-card" data-id={r.id}>
                  <div className="ldg-card-head">
                    <span className="ldg-card-date">{day(r.date)}</span>
                    <strong className="ts-num">{fmt(rowTotalOf(r))}</strong>
                  </div>
                  <dl className="ldg-card-moves">
                    {moves.length === 0 && <div><dt>القنوات</dt><dd>—</dd></div>}
                    {moves.map(c => <div key={c.key} className="is-in"><dt>{c.label}</dt><dd className="ts-num">{fmt(r[c.key])}</dd></div>)}
                  </dl>
                  {r.description && <div className="ldg-card-desc">{r.description}</div>}
                </article>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
