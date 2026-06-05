import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function defaultPath(role) {
  if (role === 'purchasing') return '/invoice'
  if (role === 'cashier')    return '/cashier'
  return '/'
}

export default function Login() {
  const [pin, setPin]     = useState('')
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)
  const { login, role }   = useAuth()
  const navigate          = useNavigate()

  function handleDigit(d) {
    if (pin.length >= 5) return
    const next = pin + d
    setPin(next)
    setError('')
    if (next.length === 5) setTimeout(() => attempt(next), 150)
  }

  function attempt(p) {
    const r = login(p)
    if (r) {
      navigate(defaultPath(r))
    } else {
      setShake(true)
      setError('PIN غير صحيح')
      setPin('')
      setTimeout(() => setShake(false), 500)
    }
  }

  function handleBackspace() {
    setPin(p => p.slice(0, -1))
    setError('')
  }

  const DIGITS = ['1','2','3','4','5','6','7','8','9','','0','⌫']

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-500 rounded-2xl flex items-center justify-center text-white text-3xl font-bold mx-auto mb-4 shadow-lg">م</div>
          <h1 className="text-2xl font-bold text-white">مزاهر برو</h1>
          <p className="text-slate-400 mt-1 text-sm">نظام المحاسبة المتكامل</p>
        </div>

        {/* Card */}
        <div className="bg-slate-800 rounded-2xl p-6 shadow-2xl">
          <p className="text-center text-slate-300 mb-5 font-medium">أدخل رمز الدخول</p>

          {/* PIN dots */}
          <div className={`flex justify-center gap-4 mb-6 ${shake ? 'animate-bounce' : ''}`}>
            {[0,1,2,3,4].map(i => (
              <div key={i}
                className={`w-4 h-4 rounded-full transition-all duration-200 ${
                  i < pin.length ? 'bg-blue-500 scale-110' : 'bg-slate-600'
                }`}
              />
            ))}
          </div>

          {error && (
            <p className="text-center text-red-400 text-sm mb-4 font-medium">{error}</p>
          )}

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-3">
            {DIGITS.map((d, i) => (
              <button
                key={i}
                onClick={() => d === '⌫' ? handleBackspace() : d !== '' ? handleDigit(d) : null}
                disabled={d === ''}
                className={`h-14 rounded-xl text-xl font-semibold transition-all duration-150 active:scale-95
                  ${d === '' ? 'invisible' : ''}
                  ${d === '⌫'
                    ? 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    : 'bg-slate-700 text-white hover:bg-blue-600'
                  }
                `}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* Hint */}
        <div className="mt-6 bg-slate-800/50 rounded-xl p-4 text-xs text-slate-500 text-center space-y-1">
          <p>المالك: <span className="text-slate-400 font-mono">11111</span></p>
          <p>المحاسب: <span className="text-slate-400 font-mono">22222</span></p>
          <p>مسؤول المشتريات: <span className="text-slate-400 font-mono">33333</span></p>
          <p>الكاشير: <span className="text-slate-400 font-mono">44444</span></p>
        </div>
      </div>
    </div>
  )
}
