import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import {
  Building2, Camera, ChartColumn, ChevronDown, FilePlus2, FileText, FlaskConical, House, Menu, RotateCcw, Settings, ShieldAlert,
  ShieldCheck, Store, Upload, Wallet,
} from 'lucide-react'
import { Brand, Button, Dialog, Switch, useToast } from '../ui/components.jsx'
import { blockedCount, onBlocked } from './networkGuard.js'
import { useStore } from './store.jsx'
import { CURRENT_USER } from './model.js'

const LATER = [
  { key: 'sales', label: 'المبيعات', icon: Wallet },
  { key: 'suppliers', label: 'الموردون', icon: Store },
  { key: 'reports', label: 'التقارير', icon: ChartColumn },
]
export const LATER_LABELS = Object.fromEntries(LATER.map(l => [l.key, l.label]))

const SheetContext = createContext({ openUpload: () => {}, openSales: () => {} })
export const useSheets = () => useContext(SheetContext)

/** شريط النسخة التجريبية: سطر واحد، والتفاصيل في قائمة صغيرة. */
function PrototypeBar() {
  const { state, reset } = useStore()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [blocked, setBlocked] = useState(blockedCount())
  useEffect(() => onBlocked(setBlocked), [])
  return (
    <>
      <div className="rp-banner" role="note">
        <FlaskConical className="ts-icon--sm" aria-hidden="true" />
        <strong>نسخة تجريبية — بيانات وهمية</strong>
        {blocked > 0 && <span className="rp-shield rp-shield--bad"><ShieldAlert className="ts-icon--sm" aria-hidden="true" />مُنع {blocked} طلب</span>}
        <button type="button" className="rp-banner-more" onClick={() => setOpen(true)} aria-haspopup="dialog">خيارات<ChevronDown className="ts-icon--sm" aria-hidden="true" /></button>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="عن هذه النسخة" description="نموذج تصميم محلي للمراجعة البصرية.">
        <ul className="rp-about">
          <li>البيانات مصطنعة بالكامل، ولا تخص أي منشأة حقيقية.</li>
          <li>الحفظ والاعتماد والرفض والرفع محاكاة داخل هذا المتصفح، وتعود البيانات مع إعادة التحميل.</li>
          <li className={blocked ? 'is-bad' : 'is-ok'}>
            {blocked ? <ShieldAlert className="ts-icon--sm" aria-hidden="true" /> : <ShieldCheck className="ts-icon--sm" aria-hidden="true" />}
            {blocked ? `مُنع ${blocked} طلب إلى خادم خارجي.` : 'لا اتصال بأي خادم: المتصفح يمنع أي طلب خارج هذه النسخة المحلية.'}
          </li>
        </ul>
        <Switch label="بيانات قاسية للاختبار" hint="أسماء طويلة ومبالغ كبيرة لاختبار العرض" checked={state.stress}
          onChange={v => { reset(v); toast(v ? 'بيانات قاسية: أسماء طويلة ومبالغ كبيرة' : 'عادت البيانات العادية') }} />
        <Button icon={RotateCcw} onClick={() => { reset(); setOpen(false); toast('أُعيدت بيانات النسخة إلى بدايتها') }}>إعادة البيانات</Button>
      </Dialog>
    </>
  )
}

function UploadSheet({ open, onClose }) {
  const { upload } = useStore()
  const toast = useToast()
  const navigate = useNavigate()
  const add = () => {
    const id = upload()
    onClose()
    toast('أُضيف مستند تجريبي وتجري قراءته (محاكاة)')
    navigate(`/documents/${id}`)
  }
  return (
    <Dialog open={open} onClose={onClose} title="رفع مستند" description="صوّر الفاتورة أو اختر ملفًا، ويقرأ النظام بياناتها لتراجعها قبل الاعتماد.">
      <button type="button" className="rp-shortcut rp-shortcut--primary" onClick={add}>
        <span className="rp-shortcut-icon"><Camera className="ts-icon" aria-hidden="true" /></span>
        <span><strong>تصوير المستند</strong><small>بكاميرا الجوال</small></span>
      </button>
      <button type="button" className="rp-shortcut" onClick={add}>
        <span className="rp-shortcut-icon"><FilePlus2 className="ts-icon" aria-hidden="true" /></span>
        <span><strong>اختيار ملف أو صورة</strong><small>PDF أو صورة من الجهاز</small></span>
      </button>
      <p className="ts-field-hint">في هذه النسخة يُضاف مستند تجريبي جاهز. لا يُرفع أي ملف ولا يُرسل إلى أي خادم.</p>
    </Dialog>
  )
}

function SalesSheet({ open, onClose, onUpload }) {
  return (
    <Dialog open={open} onClose={onClose} title="إدخال المبيعات" description="هذه الشاشة ليست ضمن هذا النموذج بعد."
      footer={<><Button variant="primary" icon={Upload} onClick={() => { onClose(); onUpload() }}>رفع تقرير إغلاق بدلًا منها</Button><Button onClick={onClose}>حسنًا</Button></>}>
      <p style={{ fontSize: 13.5, lineHeight: 1.8 }}>تُصمَّم لاحقًا: مبيعات اليوم حسب القناة، أو رفع تقرير إغلاق نقاط البيع ليُراجع ويُعتمد.</p>
    </Dialog>
  )
}

function MoreSheet({ open, onClose }) {
  const navigate = useNavigate()
  const go = to => { onClose(); navigate(to) }
  return (
    <Dialog open={open} onClose={onClose} title="المزيد" description={`${CURRENT_USER.name} · ${CURRENT_USER.role}`}>
      <div className="ts-choice-list">
        <button type="button" className="ts-choice" onClick={() => go('/settings')}>
          <Settings className="ts-icon" aria-hidden="true" style={{ color: 'var(--ts-petrol)' }} />الإعدادات
        </button>
        {LATER.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" className="ts-choice" onClick={() => go(`/soon/${key}`)}>
            <Icon className="ts-icon" aria-hidden="true" style={{ color: 'var(--ts-petrol)' }} />
            {label}
            <span className="ts-field-hint" style={{ marginInlineStart: 'auto' }}>لاحقًا</span>
          </button>
        ))}
      </div>
    </Dialog>
  )
}

/** يحفظ موضع التمرير لكل صفحة، ويعيده عند الرجوع. */
function useScrollMemory(scrollRef) {
  const location = useLocation()
  const navType = useNavigationType()
  const positions = useRef(new Map())
  const key = useRef(location.key)
  useEffect(() => {
    const el = scrollRef.current
    const remember = () => positions.current.set(key.current, el.scrollTop)
    // يُحفظ الموضع مع التمرير، ولحظة النقر أو اللمس قبل الانتقال (أحداث التمرير قد تتأخر)
    const events = ['scroll', 'pointerdown', 'click', 'keydown']
    events.forEach(type => el.addEventListener(type, remember, { passive: true, capture: type !== 'scroll' }))
    return () => events.forEach(type => el.removeEventListener(type, remember, { capture: type !== 'scroll' }))
  }, [scrollRef])
  useLayoutEffect(() => {
    key.current = location.key
    const el = scrollRef.current
    const saved = positions.current.get(location.key)
    if (navType === 'POP' && saved != null) {
      el.scrollTo(0, saved)
      requestAnimationFrame(() => el.scrollTo(0, saved)) // بعد اكتمال رسم القائمة
    } else if (navType !== 'REPLACE') {
      el.scrollTo(0, 0)
    }
  }, [location.key])
}

export function Shell() {
  const { state } = useStore()
  const location = useLocation()
  const scrollRef = useRef(null)
  const [sheet, setSheet] = useState(null)
  useScrollMemory(scrollRef)
  const pending = state.documents.filter(d => d.status === 'pending').length
  const path = location.pathname
  const onReview = /^\/documents\/[^/]+/.test(path)
  const crumb = path.startsWith('/documents') ? (onReview ? 'مراجعة مستند' : 'المستندات')
    : path.startsWith('/settings') ? 'الإعدادات'
      : path.startsWith('/soon') ? (LATER_LABELS[path.split('/')[2]] || '') : 'الرئيسية'
  const link = ({ isActive }) => `ts-nav-link${isActive ? ' is-active' : ''}`

  const sheets = { openUpload: () => setSheet('upload'), openSales: () => setSheet('sales') }
  return (
    <SheetContext.Provider value={sheets}>
      <div className="ts-app">
        <aside className="ts-sidebar" aria-label="القائمة الرئيسية">
          <Brand product="المطاعم" dark />
          <div className="ts-business">
            <span className="ts-business-icon"><Building2 className="ts-icon" aria-hidden="true" /></span>
            <div><strong>{state.business.name}</strong><small>{state.business.branch}</small></div>
          </div>
          <Button variant="primary" icon={Upload} full onClick={sheets.openUpload}>رفع مستند</Button>
          <nav className="ts-nav">
            <NavLink to="/" end className={link}><House className="ts-icon" aria-hidden="true" />الرئيسية</NavLink>
            <NavLink to="/documents" className={link}>
              <FileText className="ts-icon" aria-hidden="true" />المستندات
              {pending > 0 && <span className="ts-nav-count" aria-label={`${pending} بانتظار المراجعة`}>{pending}</span>}
            </NavLink>
            <NavLink to="/settings" className={link}><Settings className="ts-icon" aria-hidden="true" />الإعدادات</NavLink>
            <div className="ts-nav-label">لاحقًا</div>
            {LATER.map(({ key, label, icon: Icon }) => (
              <NavLink key={key} to={`/soon/${key}`} className={({ isActive }) => `ts-nav-link is-later${isActive ? ' is-active' : ''}`}>
                <Icon className="ts-icon" aria-hidden="true" />{label}
              </NavLink>
            ))}
          </nav>
          <div className="ts-profile">
            <span className="ts-avatar">{CURRENT_USER.name[0]}</span>
            <div><strong>{CURRENT_USER.name}</strong><small>{CURRENT_USER.role}</small></div>
          </div>
        </aside>

        <div className="ts-main">
          <header className="ts-topbar">
            <div className="ts-breadcrumb"><span>تحسيب المطاعم</span><span aria-hidden="true">/</span><strong>{crumb}</strong></div>
            <Link to="/" className="ts-mobile-brand" style={{ textDecoration: 'none' }}>
              <Brand product="المطاعم" small />
              <span className="ts-business-name">{state.business.name}</span>
            </Link>
          </header>
          <div className="ts-scroll" ref={scrollRef}>
            <PrototypeBar />
            <main className="ts-content"><Outlet /></main>
          </div>
          {!onReview && (
            <nav className="ts-bottomnav" aria-label="التنقل">
              <NavLink to="/" end className={({ isActive }) => (isActive ? 'is-active' : '')}><House className="ts-icon" aria-hidden="true" />الرئيسية</NavLink>
              <NavLink to="/documents" className={({ isActive }) => (isActive ? 'is-active' : '')}>
                <FileText className="ts-icon" aria-hidden="true" />المستندات
                {pending > 0 && <span className="ts-nav-count">{pending}</span>}
              </NavLink>
              <button type="button" className="ts-upload-tab" onClick={sheets.openUpload}><Upload className="ts-icon" aria-hidden="true" />رفع مستند</button>
              <button type="button" className={path.startsWith('/settings') || path.startsWith('/soon') ? 'is-active' : ''} onClick={() => setSheet('more')}>
                <Menu className="ts-icon" aria-hidden="true" />المزيد
              </button>
            </nav>
          )}
        </div>
      </div>
      <UploadSheet open={sheet === 'upload'} onClose={() => setSheet(null)} />
      <SalesSheet open={sheet === 'sales'} onClose={() => setSheet(null)} onUpload={sheets.openUpload} />
      <MoreSheet open={sheet === 'more'} onClose={() => setSheet(null)} />
    </SheetContext.Provider>
  )
}
