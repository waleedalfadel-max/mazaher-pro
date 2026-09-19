import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import { Shell } from '../../tatmira-demo/src/App.jsx'
import { Button, Card, Field, Notice, TextInput, NAVY, TEAL } from '../../tatmira-demo/src/components/ui.jsx'
import RemoteStore from './RemoteStore.jsx'
import RemoteEmployees, { pinDigits } from './RemoteEmployees.jsx'
import { isAccountSuccess, isFinanceSuccess, resultOrError } from './api-result.js'
import logo from '../../public/شعار تحسيب الجديد.png'
import '../../src/index.css'
import '../../tatmira-demo/src/demo.css'
import './integrated.css'

const url = import.meta.env.TATMIRA_PUBLIC_SUPABASE_URL
const key = import.meta.env.TATMIRA_PUBLIC_SUPABASE_KEY
const tenant = import.meta.env.TATMIRA_PUBLIC_TENANT || 'tatmira'
const auth = url && key ? createClient(url, key, {
  auth: { storageKey: 'tatmira-owner-auth', detectSessionInUrl: true },
}) : null
const TOKEN_KEY = `tatmira-employee:${tenant}`
const recoveryAtBoot = /(?:^|[&#])type=(?:recovery|invite)(?:&|$)/.test(location.hash)

const ERRORS = {
  AUTH_REQUIRED: 'سجّل الدخول أولاً',
  INVALID_SESSION: 'انتهت الجلسة أو تغيرت صلاحياتك. سجّل الدخول مجددًا',
  INVALID_LOGIN: 'رمز الدخول غير صحيح أو تم تغييره. اطلب من المالك إعادة تعيينه',
  OWNER_ONLY: 'هذا الإجراء للمالك فقط',
  PIN_FORMAT: 'اكتب رمزًا من 6 أرقام',
  PIN_IN_USE: 'الرمز مستخدم لموظف آخر؛ اختر رمزًا مختلفًا',
  RATE_LIMITED: 'محاولات دخول كثيرة؛ حاول لاحقًا',
  AUTH_UNAVAILABLE: 'تعذر الاتصال بخدمة الدخول. حاول مرة أخرى',
  FINANCE_UNAVAILABLE: 'تعذر الاتصال بالخادم. أعد المحاولة؛ لن تتكرر العملية المحفوظة',
  TENANT_UNAVAILABLE: 'المنشأة غير مفعّلة بعد',
  ORIGIN_DENIED: 'رابط المعاينة غير مفعّل على الخادم',
  INVALID_REQUEST: 'راجع الحقول المطلوبة',
  EMPLOYEE_NOT_FOUND: 'حساب الموظف غير موجود',
  FORBIDDEN: 'لا تملك صلاحية هذا الإجراء',
  CONFLICT: 'تغيّرت البيانات بواسطة مستخدم آخر. تم تحديث العرض؛ أعد تنفيذ التعديل',
  FILE_REQUIRED: 'اختر ملفًا لا يتجاوز حجمه 5 ميجابايت',
  FILE_TYPE: 'اختر ملف PDF أو JPG أو PNG',
  FILE_UNAVAILABLE: 'تعذر الوصول إلى الملف. حاول مرة أخرى',
  REQUEST_TOO_LARGE: 'حجم الطلب أكبر من الحد المسموح',
  REQUEST_ID_REUSED: 'تغير محتوى طلب محفوظ. حدّث الصفحة قبل المتابعة',
  NOT_FOUND: 'المستند غير متاح لك',
}

function employeeToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) } catch { return null }
}

async function ownerToken() {
  if (!auth) return null
  return (await auth.auth.getSession()).data.session?.access_token || null
}

async function requestToken() {
  return employeeToken() || await ownerToken()
}

async function accountApi(action, payload = {}, tokenOverride) {
  if (!url || !key) throw Object.assign(new Error('لم تكتمل إعدادات الاتصال'), { code: 'AUTH_UNAVAILABLE' })
  const token = tokenOverride === undefined ? await requestToken() : tokenOverride
  let response
  try {
    response = await fetch(`${url}/functions/v1/tatmira-accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action, tenant, ...payload }),
    })
  } catch {
    throw Object.assign(new Error(ERRORS.AUTH_UNAVAILABLE), { code: 'AUTH_UNAVAILABLE' })
  }
  return resultOrError(response, {
    unavailableCode: 'AUTH_UNAVAILABLE',
    messages: ERRORS,
    validate: result => isAccountSuccess(action, result),
  })
}

async function financeApi(operation, payload = {}, file = null) {
  if (!url || !key) throw Object.assign(new Error('لم تكتمل إعدادات الاتصال'), { code: 'FINANCE_UNAVAILABLE' })
  const token = await requestToken()
  const request = { operation, tenant, ...payload }
  const headers = { apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  let body
  if (file) {
    body = new FormData()
    body.set('request', JSON.stringify(request))
    body.set('file', file)
  } else {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(request)
  }
  let response
  try { response = await fetch(`${url}/functions/v1/tatmira-finance`, { method: 'POST', headers, body }) }
  catch { throw Object.assign(new Error(ERRORS.FINANCE_UNAVAILABLE), { code: 'FINANCE_UNAVAILABLE' }) }
  return resultOrError(response, {
    file: operation === 'file',
    unavailableCode: 'FINANCE_UNAVAILABLE',
    messages: ERRORS,
    validate: result => isFinanceSuccess(operation, payload, result),
  })
}

function Login({ onLogin, recovery, finishRecovery }) {
  const [mode, setMode] = useState('employee')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function requestRecovery() {
    const ownerEmail = email.trim()
    setError('')
    setNotice('')
    if (!ownerEmail) {
      setError('اكتب بريد المالك أولًا')
      return
    }
    setBusy(true)
    try {
      const { error: recoveryError } = await auth.auth.resetPasswordForEmail(ownerEmail, {
        redirectTo: `${location.origin}${location.pathname}`,
      })
      if (recoveryError) throw recoveryError
      setNotice('أرسلنا رابط إعداد كلمة مرور جديدة إلى البريد إن كان الحساب مسجلًا')
    } catch {
      setError('تعذر إرسال رابط الاستعادة الآن. حاول لاحقًا')
    } finally {
      setBusy(false)
    }
  }

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (recovery) {
        const { error: updateError } = await auth.auth.updateUser({ password })
        if (updateError) throw updateError
        sessionStorage.removeItem(TOKEN_KEY)
        finishRecovery()
      } else if (mode === 'owner') {
        const { error: loginError } = await auth.auth.signInWithPassword({ email, password })
        if (loginError) throw new Error('البريد أو كلمة المرور غير صحيحة')
        sessionStorage.removeItem(TOKEN_KEY)
      } else {
        await auth.auth.signOut({ scope: 'local' })
        sessionStorage.removeItem(TOKEN_KEY)
        const result = await accountApi('pin_login', { pin: pinDigits(pin) }, null)
        sessionStorage.setItem(TOKEN_KEY, result.token)
        setPin('')
      }
      await onLogin()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return <div className="auth-screen min-h-[100dvh] flex items-center justify-center p-4" dir="rtl">
    <Card className="auth-card w-full max-w-md p-5 sm:p-7">
      <div className="text-center mb-5">
        <img src={logo} alt="تحسيب" className="h-11 mx-auto object-contain mb-3" />
        <div className="text-xs font-extrabold tracking-wide" style={{ color: TEAL }}>معمل تتميرا</div>
        <h1 className="text-2xl font-extrabold mt-1" style={{ color: NAVY }}>{recovery ? 'إعداد كلمة المرور' : 'أهلًا بك'}</h1>
        <p className="text-sm mt-1" style={{ color: '#5A7A8A' }}>{recovery ? 'اختر كلمة مرور جديدة لحساب المالك' : 'ادخل إلى مساحة العمل المشتركة'}</p>
      </div>

      {!recovery && <div className="grid grid-cols-2 gap-1 p-1 rounded-xl mb-4" style={{ background: '#EEF4F3' }}>
        {[['employee', 'دخول الموظف'], ['owner', 'دخول المالك']].map(([id, label]) => <button key={id} type="button" onClick={() => { setMode(id); setError(''); setNotice('') }}
          className="py-2.5 rounded-lg text-sm font-bold" style={mode === id ? { background: '#fff', color: NAVY, boxShadow: '0 1px 3px rgba(0,0,0,.08)' } : { color: '#5A7A8A' }}>{label}</button>)}
      </div>}

      <form onSubmit={submit} className="space-y-3">
        {mode === 'owner' && !recovery && <Field label="البريد الإلكتروني"><TextInput type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} dir="ltr" className="text-left" /></Field>}
        {mode === 'owner' || recovery
          ? <Field label="كلمة المرور" hint={recovery ? '12 حرفًا على الأقل' : ''}><TextInput type="password" autoComplete={recovery ? 'new-password' : 'current-password'} required minLength={recovery ? 12 : undefined} value={password} onChange={e => setPassword(e.target.value)} dir="ltr" className="text-left" /></Field>
          : <Field label="رمز الدخول — 6 أرقام"><TextInput type="password" inputMode="numeric" autoComplete="off" required value={pin} onChange={e => setPin(pinDigits(e.target.value))} maxLength={6} dir="ltr" className="text-center tracking-[.35em] text-xl" /></Field>}
        {mode === 'owner' && !recovery && <button type="button" disabled={busy} onClick={requestRecovery} className="text-sm font-bold disabled:opacity-50" style={{ color: TEAL }}>نسيت كلمة المرور؟</button>}
        {notice && <Notice tone="success">{notice}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        <Button className="w-full !py-3" disabled={busy || (!recovery && mode === 'employee' && pin.length !== 6)}>{busy ? 'جارٍ التحقق…' : recovery ? 'حفظ كلمة المرور' : 'دخول'}</Button>
      </form>
    </Card>
  </div>
}

function App() {
  const [identity, setIdentity] = useState(null)
  const [loading, setLoading] = useState(true)
  const [recovery, setRecovery] = useState(recoveryAtBoot)
  const [error, setError] = useState('')
  const generation = useRef(0)

  const loadIdentity = useCallback(async () => {
    const current = ++generation.current
    let result
    try {
      result = await accountApi('me')
    } catch (e) {
      // A stale employee token must not shadow a still-valid owner session.
      if (!employeeToken() || e.code !== 'INVALID_SESSION') throw e
      sessionStorage.removeItem(TOKEN_KEY)
      result = await accountApi('me')
    }
    if (current === generation.current) { setIdentity(result); setError('') }
    return result
  }, [])

  const expired = useCallback((e) => {
    generation.current++
    sessionStorage.removeItem(TOKEN_KEY)
    setIdentity(null)
    setError(e?.message || ERRORS.INVALID_SESSION)
  }, [])

  const logout = useCallback(async () => {
    generation.current++
    const employee = !!employeeToken()
    try {
      if (employee) await accountApi('logout')
      else if (auth) await auth.auth.signOut({ scope: 'local' })
    } catch { setError('أُغلق الدخول على هذا الجهاز، وتعذر تأكيد الخروج على الخادم') }
    finally { sessionStorage.removeItem(TOKEN_KEY); setIdentity(null) }
  }, [])

  const finishRecovery = useCallback(() => {
    setRecovery(false)
    history.replaceState(null, '', `${location.pathname}${location.search}#/`)
  }, [])

  useEffect(() => {
    if (!auth) { setLoading(false); return }
    const { data } = auth.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
    })
    loadIdentity()
      .catch(e => { if (!['AUTH_REQUIRED', 'INVALID_SESSION', 'OWNER_ONLY'].includes(e.code)) setError(e.message) })
      .finally(() => setLoading(false))
    return () => data.subscription.unsubscribe()
  }, [loadIdentity])

  if (!auth) return <div className="auth-screen min-h-screen flex items-center justify-center p-4" dir="rtl"><Card className="p-6 max-w-md"><h1 className="font-extrabold text-xl mb-2">تجهيز الدخول</h1><p>يلزم إكمال إعدادات الاتصال العامة قبل تشغيل تتميرا.</p></Card></div>
  if (loading) return <div className="auth-screen min-h-screen flex items-center justify-center" dir="rtl"><Card className="p-6">جارٍ التحقق من الجلسة…</Card></div>
  if (!identity || recovery) return <><Login onLogin={loadIdentity} recovery={recovery} finishRecovery={finishRecovery} />{error && !recovery && <div className="fixed top-3 inset-x-3 z-50 max-w-md mx-auto"><Notice tone="error">{error}</Notice></div>}</>

  return <HashRouter>
    <RemoteStore actor={identity.actor} financeApi={financeApi} accountApi={accountApi} onExpired={expired}>
      <Shell onLogout={logout} EmployeesPage={RemoteEmployees} />
    </RemoteStore>
  </HashRouter>
}

createRoot(document.getElementById('root')).render(<App />)
