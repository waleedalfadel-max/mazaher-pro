import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import staticLogo from '../assets/logo.png'
import { fetchLogoUrl } from '../lib/appLogo'

const NAVY = '#1B3A5C'
const GOLD = '#6EB7B0'
const MAX_ATTEMPTS  = 3
const LOCK_DURATION = 5 * 60 * 1000

const PROJECT_INFO = {
  mazaher: {
    name: 'ديوانية مزاهر',
    welcome: 'مرحباً بك في نظام المتابعة المالية',
    color: '#6EB7B0',
  },
  tashormik: {
    name: 'تشورميك',
    welcome: 'مرحباً بك في نظام المتابعة المالية',
    color: '#6EB7B0',
  },
  koon: {
    name: 'محمصة كون',
    welcome: 'مرحباً بك في نظام المتابعة المالية',
    color: '#6EB7B0',
  },
  trial: {
    name: 'مطعم الوادي 🍔',
    welcome: 'مرحباً بك في النظام التجريبي',
    color: '#6EB7B0',
  },
}

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
  if (role === 'cashier')    return '/cashier'
  return '/'
}

export default function Login() {
  // tahseeb.app (بدون subdomain) → الصفحة التسويقية الثابتة
  if (getSubdomain() === '__landing__') {
    window.location.replace('/landing.html' + window.location.search)
    return null
  }

  const [pin,         setPin]         = useState('')
  const [error,       setError]       = useState('')
  const [shake,       setShake]       = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [logo,        setLogo]        = useState(staticLogo)
  const attemptsRef   = useRef(0)
  const [lockedUntil, setLockedUntil] = useState(null)
  const [remaining,   setRemaining]   = useState(0)
  const { login } = useAuth()
  const navigate  = useNavigate()

  const subdomain = getSubdomain()
  const project   = PROJECT_INFO[subdomain] || null
  const accent    = project?.color || GOLD

  useEffect(() => { fetchLogoUrl().then(url => { if (url) setLogo(url) }) }, [])

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

  async function handleDigit(d) {
    if (locked || pin.length >= 5 || loading) return
    const next = pin + d
    setPin(next)
    setError('')
    if (next.length === 5) setTimeout(() => attempt(next), 150)
  }

  async function attempt(p) {
    setLoading(true)
    let r = null
    try {
      r = await login(p)
    } catch(e) {
      setLoading(false)
      setError(e.message || 'حدث خطأ')
      setShake(true)
      setTimeout(() => setShake(false), 500)
      setPin('')
      return
    }
    setLoading(false)
    if (r) {
      attemptsRef.current = 0
      setLockedUntil(null)
      navigate(defaultPath(r))
    } else {
      attemptsRef.current += 1
      const next = attemptsRef.current
      if (next >= MAX_ATTEMPTS) {
        attemptsRef.current = 0
        const until = Date.now() + LOCK_DURATION
        setLockedUntil(until)
        setRemaining(LOCK_DURATION)
      } else {
        setShake(true)
        setError(`رمز الدخول غير صحيح — محاولة ${next} من ${MAX_ATTEMPTS}`)
        setTimeout(() => setShake(false), 500)
      }
      setPin('')
    }
  }

  function handleBackspace() {
    if (locked || loading) return
    setPin(p => p.slice(0, -1))
    setError('')
  }

  const DIGITS = ['1','2','3','4','5','6','7','8','9','','0','⌫']

  // ── شاشة القفل ──────────────────────────────────────────────────
  if (locked) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#F4F8F7' }} dir="rtl">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <img src={logo} alt="تحسيب" className="h-24 w-auto mx-auto mb-4 drop-shadow-lg opacity-40" />
            {project && (
              <p className="text-base font-bold opacity-40" style={{ color: NAVY }}>{project.name}</p>
            )}
          </div>
          <div className="rounded-2xl p-8 shadow-xl text-center" style={{ background: '#1a0a0a', border: '2px solid #dc2626' }}>
            <div className="text-5xl mb-4">🔒</div>
            <p className="text-white font-bold text-base mb-2">تم قفل الدخول</p>
            <p className="text-red-300 text-sm mb-6">{MAX_ATTEMPTS} محاولات خاطئة متتالية</p>
            <div className="rounded-xl py-4 px-6 mb-4" style={{ background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.4)' }}>
              <div className="text-xs text-red-400 mb-1">الوقت المتبقي للفتح</div>
              <div className="text-4xl font-bold font-mono tabular-nums" style={{ color: '#f87171' }}>
                {formatTime(remaining)}
              </div>
            </div>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
              ستفتح الشاشة تلقائياً عند انتهاء المؤقت
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── شاشة الدخول العادية ─────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#F4F8F7' }} dir="rtl">
      <div className="w-full max-w-sm">

        {/* ── الهيدر ── */}
        <div className="text-center mb-7">
          <img src={logo} alt="تحسيب" className="h-24 w-auto mx-auto mb-5 drop-shadow-lg" />

          {project ? (
            <>
              <h1 className="text-2xl font-bold mb-1.5" style={{ color: NAVY }}>
                {project.name}
              </h1>
              <p className="text-sm" style={{ color: '#8a9ba8' }}>{project.welcome}</p>
            </>
          ) : (
            <p className="text-sm font-semibold" style={{ color: '#8a7a5a' }}>
              إدارة مالية احترافية
            </p>
          )}
        </div>

        {/* ── فاصل ناعم — يظهر فقط إذا كان هناك مشروع ── */}
        {project && (
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px" style={{ background: 'rgba(27,58,92,0.1)' }}/>
            <span className="text-xs font-semibold" style={{ color: '#b0bec5' }}>رمز الدخول</span>
            <div className="flex-1 h-px" style={{ background: 'rgba(27,58,92,0.1)' }}/>
          </div>
        )}

        {/* ── بطاقة PIN ── */}
        <div className="rounded-2xl p-6 shadow-xl" style={{ background: NAVY }}>
          {!project && (
            <p className="text-center text-sm font-semibold mb-5" style={{ color: 'rgba(255,255,255,0.7)' }}>
              أدخل رمز الدخول
            </p>
          )}

          <div className={`flex justify-center gap-3 mb-6 ${shake ? 'animate-bounce' : ''}`}>
            {[0,1,2,3,4].map(i => (
              <div key={i} className="w-3.5 h-3.5 rounded-full transition-all duration-200"
                style={{
                  background:  i < pin.length ? accent : 'rgba(255,255,255,0.15)',
                  transform:   i < pin.length ? 'scale(1.15)' : 'scale(1)',
                }}
              />
            ))}
          </div>

          {error && <p className="text-center text-red-400 text-sm mb-4 font-medium">{error}</p>}

          {loading && (
            <div className="flex justify-center mb-4">
              <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: accent, borderTopColor: 'transparent' }}/>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            {DIGITS.map((d, i) => (
              <button
                key={i}
                onClick={() => d === '⌫' ? handleBackspace() : d !== '' ? handleDigit(d) : null}
                disabled={d === '' || loading}
                className="h-14 rounded-xl text-xl font-semibold transition-all duration-150 active:scale-95"
                style={{
                  visibility: d === '' ? 'hidden' : 'visible',
                  background: d === '⌫' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.1)',
                  color: d === '⌫' ? 'rgba(255,255,255,0.5)' : '#fff',
                  border: '1px solid rgba(255,255,255,0.1)',
                  opacity: loading ? 0.5 : 1,
                }}
                onMouseEnter={e => { if (d && !loading) { e.currentTarget.style.background = accent; e.currentTarget.style.color = NAVY } }}
                onMouseLeave={e => { e.currentTarget.style.background = d === '⌫' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = d === '⌫' ? 'rgba(255,255,255,0.5)' : '#fff' }}
              >
                {d}
              </button>
            ))}
          </div>

        </div>

        {/* ── تذييل ── */}
        <p className="text-center text-xs mt-5" style={{ color: '#b0bec5' }}>
          تحسيب © {new Date().getFullYear()}
        </p>

      </div>
    </div>
  )
}
