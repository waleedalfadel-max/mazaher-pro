import React, { useState, useEffect, useRef, useId } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Building2, Lock, Mail } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Brand } from '../ui/components'
import { PIN_LENGTH, normalizePin, pinReady, pinTooLong } from '../lib/pinInput'
import '../ui/login.css'

// قفل الواجهة المحلي (كما كان): بعد 3 رموز خاطئة متتالية تُقفل الشاشة 5 دقائق في هذا المتصفح.
// وهو غير حظر الخادم (429 من حد المحاولات في القاعدة) الذي تظهر رسالته ومدته من الخادم نفسه.
const MAX_ATTEMPTS  = 3
const LOCK_DURATION = 5 * 60 * 1000

function getSubdomain() {
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1') return '__dev__'
  if (host.includes('vercel.app') || !host.includes('.')) return null
  if (host === 'tahseeb.app' || host === 'www.tahseeb.app') return '__landing__'
  const parts = host.split('.')
  if (parts.length < 3 || parts[0] === 'www') return null
  return parts[0]
}

function formatTime(ms) {
  const totalSec = Math.ceil(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function defaultPath(role) {
  if (role === 'superadmin') return '/admin'
  if (role === 'purchasing') return '/invoice'
  if (role === 'cashier')    return '/invoice'   // صفحة الكاشير أُلغيت: الكاشير يرفع من صفحة الرفع العامة
  return '/'
}

/** إطار الدخول بهوية تحسيب: مساحة الهوية الداكنة بجانب النموذج، وفوقه مختصرة على الجوال. */
function AuthFrame({ children }) {
  return (
    <div className="ts-login" dir="rtl">
      <section className="ts-login-visual">
        <Brand dark />
        <h2>أعمالك أوضح.<br />وقرارك أقرب.</h2>
        <p>مساحة واحدة لمتابعة مبيعاتك ومصروفاتك ومستنداتك، كل يوم.</p>
        <div className="ts-line-art" aria-hidden="true">
          {[36, 60, 48, 81, 100].map(h => <span key={h} style={{ height: `${h}%` }} />)}
        </div>
        <div className="ts-login-copy">TAHSEEB · BUSINESS, IN FOCUS</div>
      </section>
      <section className="ts-login-form">
        <div className="ts-login-inner">{children}</div>
      </section>
    </div>
  )
}

/** اسم المنشأة من آلية تحديدها الحالية (النطاق ← get_project_branding). لا اسم ثابت. */
function BusinessBadge({ subdomain, project }) {
  const name = subdomain === '__dev__' ? 'بيئة التطوير المحلية'
    : subdomain === null ? 'إدارة منصة تحسيب'
    : project?.name || ''
  if (!name) return null
  return <div className="ts-login-badge" data-business-badge><Building2 className="ts-icon" aria-hidden="true" /><span className="truncate">{name}</span></div>
}

export default function Login() {
  // tahseeb.app (بدون subdomain) → الصفحة التسويقية الثابتة
  if (getSubdomain() === '__landing__') {
    window.location.replace('/landing.html' + window.location.search)
    return null
  }

  const pinId = useId()
  const [pin,         setPin]         = useState('')
  const [error,       setError]       = useState('')
  // خروج بسبب تعطيل الحساب (AuthContext): رسالة واحدة ثم تُمسح
  const [notice] = useState(() => {
    try {
      const r = sessionStorage.getItem('mz_logout_reason')
      sessionStorage.removeItem('mz_logout_reason')
      return r === 'inactive' ? 'أوقف مالك المنشأة حسابك. تواصل معه لإعادة تفعيله.'
        : r === 'revoked' ? 'انتهت جلستك لأن رمز الدخول أو حالة الحساب تغيّرت. سجّل الدخول من جديد.' : ''
    } catch { return '' }
  })
  const [loading,     setLoading]     = useState(false)
  const inFlight      = useRef(false)   // طلب واحد في كل مرة: لا يُرسل الرمز مرتين أثناء الانتظار
  const pinRef        = useRef(null)
  const formRef       = useRef(null)
  // على الجوال: بعد ظهور لوحة المفاتيح يُمرَّر النموذج ليبقى الحقل وزر الدخول ظاهرين
  const keepFormVisible = () => setTimeout(() => formRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }), 300)
  const attemptsRef   = useRef(0)
  const [lockedUntil, setLockedUntil] = useState(null)
  const [remaining,   setRemaining]   = useState(0)
  const [mode,        setMode]        = useState('pin')  // 'pin' | 'email' — البريد للمالك، لا يمسّ PIN
  const [email,       setEmail]       = useState('')
  const [password,    setPassword]    = useState('')
  const { login, loginWithEmail } = useAuth()
  const navigate  = useNavigate()

  const subdomain = getSubdomain()
  const [project, setProject] = useState(null)

  // بيانات العلامة التجارية — من دالة RPC ضيّقة (نفس نمط login_with_pin)
  // بدل خريطة ثابتة بالكود، حتى لا يحتاج أي مشروع جديد تعديل كود لإضافته.
  // فشل الاستدعاء (شبكة، أو الدالة غير موجودة بعد) يُترَك بصمت — project
  // يبقى null فلا يظهر اسم منشأة، لا تعطيل لشاشة الدخول.
  useEffect(() => {
    if (!subdomain || subdomain === '__dev__') return
    let cancelled = false
    supabase.rpc('get_project_branding', { p_subdomain: subdomain })
      .then(({ data, error }) => {
        if (cancelled || error) return
        const row = data?.[0]
        if (row) setProject({ name: row.name, welcome: row.welcome, color: row.color })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [subdomain])

  // عداد تنازلي
  useEffect(() => {
    if (!lockedUntil) return
    const tick = () => {
      const left = lockedUntil - Date.now()
      if (left <= 0) {
        attemptsRef.current = 0
        setLockedUntil(null)
        setRemaining(0)
      } else {
        setRemaining(left)
      }
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [lockedUntil])

  const locked = lockedUntil !== null && remaining > 0
  const tooLong = pinTooLong(pin)

  async function submitPin(event) {
    event?.preventDefault?.()
    if (locked || inFlight.current || !pinReady(pin)) return
    inFlight.current = true
    setLoading(true)
    setError('')
    let r = null
    try {
      r = await login(pin)
    } catch (e) {
      // حظر الخادم (محاولات كثيرة + المدة) أو تعذّر الاتصال: الرسالة من مسار الدخول نفسه
      setError(e.message || 'حدث خطأ')
      setPin('')
      return
    } finally {
      inFlight.current = false
      setLoading(false)
    }
    if (r) {
      attemptsRef.current = 0
      setLockedUntil(null)
      navigate(defaultPath(r))
      return
    }
    attemptsRef.current += 1
    const next = attemptsRef.current
    setPin('')
    if (next >= MAX_ATTEMPTS) {
      attemptsRef.current = 0
      const until = Date.now() + LOCK_DURATION
      setLockedUntil(until)
      setRemaining(LOCK_DURATION)
    } else {
      setError(`رمز الدخول غير صحيح — محاولة ${next} من ${MAX_ATTEMPTS}`)
      pinRef.current?.focus()
    }
  }

  // ── دخول المالك بالبريد — مسار منفصل تماماً عن PIN ──
  async function attemptEmail(e) {
    e?.preventDefault?.()
    if (loading || inFlight.current || !email || !password) return
    inFlight.current = true
    setLoading(true)
    setError('')
    try {
      const r = await loginWithEmail(email, password)
      if (r) navigate(defaultPath(r))
    } catch (err) {
      setError(err.message || 'تعذّر تسجيل الدخول')
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }

  // ── قفل الواجهة المحلي ──────────────────────────────────────────
  if (locked) {
    return (
      <AuthFrame>
        <BusinessBadge subdomain={subdomain} project={project} />
        <div className="ts-login-lock" role="status" data-ui-lock>
          <Lock className="ts-icon" aria-hidden="true" />
          <h1>تم قفل الدخول مؤقتًا</h1>
          <p>{MAX_ATTEMPTS} محاولات خاطئة متتالية في هذا المتصفح.</p>
          <div className="ts-login-timer" aria-label="الوقت المتبقي للفتح"><span>الوقت المتبقي للفتح</span><b className="ts-num">{formatTime(remaining)}</b></div>
          <p className="ts-login-help">تفتح الشاشة تلقائيًا عند انتهاء المؤقت.</p>
        </div>
      </AuthFrame>
    )
  }

  // ── دخول المالك بالبريد ─────────────────────────────────────────
  if (mode === 'email') {
    return (
      <AuthFrame>
        <BusinessBadge subdomain={subdomain} project={project} />
        <h1>دخول المالك</h1>
        <p>بالبريد الإلكتروني وكلمة المرور.</p>
        <form onSubmit={attemptEmail} noValidate className="ts-login-stack">
          <label className="ts-field">
            <span>البريد الإلكتروني</span>
            <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError('') }}
              dir="ltr" autoComplete="email" className="ts-input" autoFocus />
          </label>
          <label className="ts-field">
            <span>كلمة المرور</span>
            <input type="password" value={password} onChange={e => { setPassword(e.target.value); setError('') }}
              dir="ltr" autoComplete="current-password" className="ts-input" />
          </label>
          <button type="submit" className="ts-btn ts-btn--primary ts-btn--lg ts-btn--full" disabled={loading || !email || !password} aria-busy={loading || undefined}>
            {loading ? 'جارٍ التحقق…' : <>دخول<ArrowLeft className="ts-icon" aria-hidden="true" /></>}
          </button>
          <div className="ts-login-feedback" role="alert">{error}</div>
        </form>
        <button type="button" className="ts-login-switch" onClick={() => { setMode('pin'); setError(''); setPassword('') }}>
          الرجوع إلى رمز الدخول
        </button>
      </AuthFrame>
    )
  }

  // ── رمز الدخول ──────────────────────────────────────────────────
  const feedback = error || (tooLong ? `رمز الدخول ${PIN_LENGTH} أرقام` : '')
  return (
    <AuthFrame>
      <BusinessBadge subdomain={subdomain} project={project} />
      <h1>حيّاك في تحسيب</h1>
      <p>أدخل رمزك للوصول إلى مساحة عملك.</p>
      <form ref={formRef} onSubmit={submitPin} noValidate className="ts-login-stack">
        <div className="ts-field">
          <label htmlFor={pinId}>رمز الدخول</label>
          {/* حقل مخفي المحتوى بلوحة أرقام الجوال الأصلية؛ يقبل الكتابة واللصق ولوحة الحاسب، بأرقام عربية أو لاتينية */}
          <input id={pinId} ref={pinRef} type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" autoFocus
            name="pin" maxLength={24} dir="ltr" placeholder={'•'.repeat(PIN_LENGTH)} value={pin}
            onChange={e => { setPin(normalizePin(e.target.value)); setError('') }} onFocus={keepFormVisible}
            aria-invalid={!!feedback || undefined} aria-describedby="login-feedback" disabled={loading}
            className="ts-pin" />
        </div>
        <button type="submit" className="ts-btn ts-btn--primary ts-btn--lg ts-btn--full" disabled={loading || !pinReady(pin)} aria-busy={loading || undefined}>
          {loading ? 'جارٍ التحقق…' : <>دخول<ArrowLeft className="ts-icon" aria-hidden="true" /></>}
        </button>
        <div id="login-feedback" className="ts-login-feedback" role="alert">
          {feedback || (notice ? <span className="ts-login-notice" data-logout-notice>{notice}</span> : null)}
        </div>
      </form>
      <div className="ts-login-help">لكل مستخدم رمزه وصلاحياته.</div>
      <button type="button" className="ts-login-switch" onClick={() => { setMode('email'); setError(''); setPin('') }}>
        <Mail className="ts-icon" aria-hidden="true" />دخول المالك بالبريد الإلكتروني
      </button>
    </AuthFrame>
  )
}
