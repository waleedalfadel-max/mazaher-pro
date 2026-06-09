import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import staticLogo from '../assets/logo.png'
import { fetchLogoUrl } from '../lib/appLogo'

function defaultPath(role) {
  if (role === 'superadmin') return '/admin'
  if (role === 'purchasing') return '/invoice'
  if (role === 'cashier')    return '/cashier'
  return '/'
}

export default function Login() {
  const [pin, setPin]       = useState('')
  const [error, setError]   = useState('')
  const [shake, setShake]   = useState(false)
  const [loading, setLoading] = useState(false)
  const [logo, setLogo]     = useState(staticLogo)
  const { login }           = useAuth()

  useEffect(() => { fetchLogoUrl().then(url => { if (url) setLogo(url) }) }, [])
  const navigate            = useNavigate()

  async function handleDigit(d) {
    if (pin.length >= 5 || loading) return
    const next = pin + d
    setPin(next)
    setError('')
    if (next.length === 5) {
      setTimeout(() => attempt(next), 150)
    }
  }

  async function attempt(p) {
    setLoading(true)
    const r = await login(p)
    setLoading(false)
    if (r) {
      navigate(defaultPath(r))
    } else {
      setShake(true)
      setError('رمز الدخول غير صحيح')
      setPin('')
      setTimeout(() => setShake(false), 500)
    }
  }

  function handleBackspace() {
    if (loading) return
    setPin(p => p.slice(0, -1))
    setError('')
  }

  const DIGITS = ['1','2','3','4','5','6','7','8','9','','0','⌫']

  const NAVY = '#0f2444'
  const GOLD = '#c9a227'

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#f0ede6' }} dir="rtl">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src={logo} alt="تحسيب برو" className="h-28 w-auto mx-auto mb-4 drop-shadow-lg" />
          <p className="text-sm font-semibold" style={{ color: '#8a7a5a' }}>نظام المحاسبة المتكامل</p>
        </div>

        <div className="rounded-2xl p-6 shadow-xl" style={{ background: NAVY }}>
          <p className="text-center text-sm font-semibold mb-5" style={{ color: 'rgba(255,255,255,0.7)' }}>
            أدخل رمز الدخول
          </p>

          <div className={`flex justify-center gap-3 mb-6 ${shake ? 'animate-bounce' : ''}`}>
            {[0,1,2,3,4].map(i => (
              <div key={i} className="w-3.5 h-3.5 rounded-full transition-all duration-200"
                style={{ background: i < pin.length ? GOLD : 'rgba(255,255,255,0.15)', transform: i < pin.length ? 'scale(1.15)' : 'scale(1)' }}
              />
            ))}
          </div>

          {error && <p className="text-center text-red-400 text-sm mb-4 font-medium">{error}</p>}

          {loading && (
            <div className="flex justify-center mb-4">
              <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: GOLD, borderTopColor: 'transparent' }}/>
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
                onMouseEnter={e => { if (d && !loading) e.currentTarget.style.background = GOLD; e.currentTarget.style.color = NAVY }}
                onMouseLeave={e => { e.currentTarget.style.background = d === '⌫' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = d === '⌫' ? 'rgba(255,255,255,0.5)' : '#fff' }}
              >
                {d}
              </button>
            ))}
          </div>

          {pin.length >= 4 && pin.length < 5 && !loading && (
            <button
              onClick={() => attempt(pin)}
              className="mt-4 w-full h-12 rounded-xl text-base font-bold transition-all duration-150 active:scale-95"
              style={{ background: GOLD, color: NAVY }}
            >
              دخول ✓
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
