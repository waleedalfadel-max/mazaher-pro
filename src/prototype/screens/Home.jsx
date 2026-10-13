import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Banknote, CalendarDays, ChevronDown, ChevronLeft, CircleCheck, ClipboardList, FileText, History, Hourglass, Info,
  PieChart, Receipt, ShoppingBasket, TriangleAlert, Upload, Wallet,
} from 'lucide-react'
import { DateInput, EmptyState, Metric, Money, Panel, Segment } from '../../ui/components.jsx'
import { formatDate, formatRange, plural } from '../../ui/format.js'
import { useStore } from '../store.jsx'
import { useSheets } from '../Shell.jsx'
import {
  CURRENT_USER, KINDS, PERIODS, SCOPES, TODAY, expenseBreakdown, needsAction, periodRange, recentActivity, summarize,
} from '../model.js'

function PeriodPicker({ period, setPeriod, custom, setCustom, range }) {
  return (
    <div className="rp-period">
      <Segment label="الفترة" options={PERIODS} value={period} onChange={setPeriod} />
      {period === 'custom' ? (
        <div className="rp-period-custom">
          <span>من</span><DateInput aria-label="من تاريخ" value={custom.from} max={TODAY} onChange={v => setCustom(c => ({ ...c, from: v }))} />
          <span>إلى</span><DateInput aria-label="إلى تاريخ" value={custom.to} max={TODAY} onChange={v => setCustom(c => ({ ...c, to: v }))} />
        </div>
      ) : (
        <span className="rp-period-range"><CalendarDays className="ts-icon--sm" aria-hidden="true" />{formatRange(range.from, range.to)} {range.from.slice(0, 4)}</span>
      )}
    </div>
  )
}

function ScopeNote() {
  return (
    <details className="rp-scope">
      <summary><Info className="ts-icon--sm" aria-hidden="true" />ما الذي يشمله كل رقم؟<ChevronDown className="ts-icon--sm" aria-hidden="true" /></summary>
      <div className="rp-scope-list">
        {SCOPES.map(s => <div key={s.key}><strong>{s.title}: </strong>{s.text}</div>)}
        <div className="rp-scope-wide">
          لا تعرض الرئيسية «صافي الربح»: الربح يحتاج مخزون أول المدة وآخرها وتوزيع التكاليف، ولا يكفي طرح المشتريات والمصروفات من المبيعات.
          كل مستند معتمد يدخل رقمًا واحدًا فقط، فلا تتكرر المشتريات داخل المصروفات.
        </div>
      </div>
    </details>
  )
}

const KIND_ICON = { purchase: ShoppingBasket, expense: Receipt, sales: Banknote }

export default function Home() {
  const { state } = useStore()
  const { openUpload, openSales } = useSheets()
  const [period, setPeriod] = useState('month')
  const [custom, setCustom] = useState({ from: '2026-09-01', to: TODAY })
  const range = periodRange(period, TODAY, custom)
  const s = useMemo(() => summarize(state, range), [state, range.from, range.to])
  const breakdown = useMemo(() => expenseBreakdown(state, range), [state, range.from, range.to])
  const todo = useMemo(() => needsAction(state), [state])
  const feed = useMemo(() => recentActivity(state, 6), [state])
  const top = breakdown.rows.slice(0, 6)

  return (
    <div className="rp-home">
      <div className="ts-heading">
        <div>
          <h1>أهلًا {CURRENT_USER.name}</h1>
          <p>{state.business.name} · {state.business.branch} · {formatDate(TODAY, { day: true, year: true })}</p>
        </div>
        <PeriodPicker period={period} setPeriod={setPeriod} custom={custom} setCustom={setCustom} range={range} />
      </div>

      <div className="ts-metrics">
        <Metric label="المبيعات" icon={Wallet} tag="قبل الضريبة"
          foot={s.sales.days ? plural(s.sales.days, 'يوم واحد مسجّل', 'يومان مسجّلان', 'أيام مسجّلة', 'يومًا مسجّلًا') : 'لا مبيعات مسجّلة بعد'}>
          <Money value={s.sales.amount} />
        </Metric>
        <Metric label="المشتريات" icon={ShoppingBasket} tag="قبل الضريبة"
          foot={plural(s.purchases.count, 'فاتورة معتمدة واحدة', 'فاتورتان معتمدتان', 'فواتير معتمدة', 'فاتورة معتمدة')}>
          <Money value={s.purchases.amount} />
        </Metric>
        <Metric label="المصروفات التشغيلية" icon={Receipt} tag="قبل الضريبة"
          foot={plural(s.expenses.count, 'مستند معتمد واحد', 'مستندان معتمدان', 'مستندات معتمدة', 'مستندًا معتمدًا')}>
          <Money value={s.expenses.amount} />
        </Metric>
        <Metric as={Link} to="/documents?status=pending" label="بانتظار المراجعة" icon={Hourglass} tag="كل الفترات" tone={s.waiting.count ? 'attention' : undefined}
          foot={s.waiting.count ? `أقدمها منذ ${s.waiting.oldestDays === 0 ? 'اليوم' : plural(s.waiting.oldestDays, 'يوم', 'يومين', 'أيام', 'يومًا')}` : 'لا شيء ينتظرك'}>
          <span className="ts-num">{s.waiting.count}</span>
        </Metric>
      </div>
      <ScopeNote />

      <div className="rp-home-mid">
        <div className="rp-shortcuts">
          {/* على الجوال يكفي زر الرفع الثابت في الشريط السفلي */}
          <button type="button" className="rp-shortcut rp-shortcut--primary rp-desktop-only" onClick={openUpload}>
            <span className="rp-shortcut-icon"><Upload className="ts-icon" aria-hidden="true" /></span>
            <span><strong>رفع مستند</strong><small>فاتورة مورد أو مصروف أو تقرير إغلاق</small></span>
            <ChevronLeft className="ts-icon rp-arrow" aria-hidden="true" />
          </button>
          <button type="button" className="rp-shortcut rp-shortcut--compact" onClick={openSales}>
            <span className="rp-shortcut-icon"><Banknote className="ts-icon" aria-hidden="true" /></span>
            <span><strong>إدخال المبيعات</strong><small>مبيعات اليوم حسب القناة</small></span>
            <ChevronLeft className="ts-icon rp-arrow" aria-hidden="true" />
          </button>
        </div>

        <Panel className="rp-actions-panel" clip title="يحتاج إجراء" icon={ClipboardList}>
          {todo.length ? (
            <ul className="rp-todo">
              {todo.slice(0, 5).map(item => (
                <li key={item.key}>
                  <Link to={item.to}>
                    <span className={`rp-todo-mark${item.tone === 'info' ? ' rp-todo-mark--info' : ''}`}>
                      {item.key === 'pending' ? <Hourglass className="ts-icon" aria-hidden="true" /> : <TriangleAlert className="ts-icon" aria-hidden="true" />}
                    </span>
                    <span><strong>{item.title}</strong><small>{item.text}</small></span>
                    <span className="rp-todo-go">{item.action}<ChevronLeft className="ts-icon--sm" aria-hidden="true" /></span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rp-todo-clear"><CircleCheck className="ts-icon" aria-hidden="true" />لا شيء يحتاج إجراء الآن.</div>
          )}
        </Panel>
      </div>

      <div className="rp-home-bottom">
        <Panel clip title="المصروفات التشغيلية حسب البند" icon={PieChart} subtitle={`${formatRange(range.from, range.to)} · معتمدة · قبل الضريبة`}>
          {top.length ? (
            <div className="rp-bars">
              {top.map(row => (
                <div key={row.category}>
                  <div className="rp-bar-line">
                    <span>{row.category}</span>
                    <span><Money value={row.amount} decimals={0} /> <span className="ts-muted ts-num">{Math.round(row.share * 100)}%</span></span>
                  </div>
                  <div className="rp-track" aria-hidden="true"><span style={{ width: `${Math.max(2, row.share * 100)}%` }} /></div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Receipt}>لا مصروفات تشغيلية معتمدة في هذه الفترة.</EmptyState>
          )}
          <div className="rp-panel-foot">
            <Info className="ts-icon--sm" aria-hidden="true" />
            <span>المشتريات <Money value={s.purchases.amount} decimals={0} /> لها بطاقتها أعلاه، ولا تُضاف هنا.</span>
          </div>
        </Panel>

        <Panel clip title="آخر الحركات المعتمدة" icon={History} action={<Link to="/documents?status=approved" className="ts-btn ts-btn--quiet ts-btn--sm">كل المعتمد</Link>}>
          <ul className="rp-feed">
            {feed.map(e => {
              const Icon = KIND_ICON[e.kind] || FileText
              const body = (
                <>
                  <span className={`rp-feed-icon${e.kind === 'expense' ? ' rp-feed-icon--expense' : e.kind === 'sales' ? ' rp-feed-icon--sales' : ''}`}><Icon className="ts-icon" aria-hidden="true" /></span>
                  <span className="rp-feed-text"><strong>{e.title}</strong><small>{KINDS[e.kind].label} · {e.kind === 'sales' ? e.sub : `${e.sub} · ${formatDate(e.date)}`}</small></span>
                  <Money value={e.amount} />
                </>
              )
              return <li key={e.id}>{e.docId ? <Link to={`/documents/${e.docId}`}>{body}</Link> : <div>{body}</div>}</li>
            })}
          </ul>
        </Panel>
      </div>
    </div>
  )
}
