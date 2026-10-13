import React, { createContext, useContext, useState, useEffect } from 'react'
import { supabase, setViewProject } from '../lib/supabase'
import { getProjectModules } from '../lib/projectSettings'
import { pinLogin, throttleMessage } from '../lib/pinLogin'

export const ROLE_LABELS = {
  owner:      'المالك',
  accountant: 'المحاسب',
  purchasing: 'مسؤول المشتريات',
  cashier:    'الكاشير',
  superadmin: 'مزود الخدمة',
}

export const ROLE_ICONS = {
  owner:      '👑',
  accountant: '📊',
  purchasing: '🛒',
  cashier:    '💰',
  superadmin: '⚙️',
}

const AuthContext = createContext(null)

// يستخرج اسم الـ subdomain من الرابط الحالي
// localhost / 127.0.0.1   → '__dev__'  (بيئة تطوير — بدون قيود)
// tahseeb.app / vercel.app → null      (نطاق رئيسي — super admin فقط)
// tashormik.tahseeb.app   → 'tashormik'
function getSubdomain() {
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1') return '__dev__'
  if (
    host.includes('vercel.app') ||
    host === 'tahseeb.app' ||
    host === 'www.tahseeb.app' ||
    !host.includes('.')
  ) return null
  const parts = host.split('.')
  if (parts.length < 3 || parts[0] === 'www') return null
  return parts[0]
}

export function AuthProvider({ children }) {
  const [role,        setRole]        = useState(() => sessionStorage.getItem('mz_role')   || null)
  const [userName,    setUserName]    = useState(() => sessionStorage.getItem('mz_user')   || null)
  const [projectId,   setProjectId]   = useState(() => sessionStorage.getItem('mz_pid')    || null)
  const [projectName, setProjectName] = useState(() => sessionStorage.getItem('mz_pname')  || null)
  const [branch,      setBranch]      = useState(() => sessionStorage.getItem('mz_branch') || null)
  const [modules,     setModules]     = useState(() => { try { return JSON.parse(sessionStorage.getItem('mz_modules') || '[]') } catch { return [] } })
  const [authMethod,  setAuthMethod]  = useState(() => sessionStorage.getItem('mz_auth_method') || null)
  // يتزايد كلما وصلت جلسة Supabase حقيقية. login() ينتظر منح الجلسة بمهلة 3 ثوانٍ
  // فقط، فلو تأخّر المنح تنتقل الصفحة والعميل لا يزال anon — وRLS يُرجع صفر صفوف،
  // فتظهر الأرقام أصفاراً. الصفحات تُدرج هذا العدّاد ضمن تبعياتها لتعيد الجلب
  // تلقائياً بمجرد وصول الجلسة، بدل بقاء شاشة فارغة حتى يُحدّث المستخدم يدوياً.
  const [sessionEpoch, setSessionEpoch] = useState(0)
  // ── التلبّس بالأدوار (المالك فقط) ──
  // مفتاح منفصل عن mz_role عمداً: mz_role يُقرأ بحارس استعادة جلسة المالك أدناه
  // وبفحص u.role !== 'owner'. الكتابة فوقه تكسر الاستعادة وتُبقي المالك متلبّساً
  // بعد إعادة التحميل. الحالة بالجلسة فقط ⇒ إغلاق التبويب يُنهي التلبّس.
  //
  // ⚠️ حدّ التصميم: هذا التبديل بصري بحت، يُصدَّق من الواجهة وحدها. أمانه مصدره
  // أن RLS خلفه لا تعترف به إطلاقاً — auth_role() تقرأ الدور الحقيقي من القاعدة،
  // فأي محاولة كتابة أثناء التلبّس تُرفض خادمياً حتى لو زُوِّر المفتاح يدوياً.
  const [actingRole, setActingRole] = useState(() => sessionStorage.getItem('mz_acting_role') || null)

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        setSessionEpoch(n => n + 1)
      }
    })
    return () => sub?.subscription?.unsubscribe?.()
  }, [])

  // ── مساعد يخصّ مسار البريد فقط: يضبط نفس حالة الجلسة التي يضبطها PIN ──
  // (مسار PIN في login() أدناه لم يُمسّ — هذا المساعد لا يُستدعى منه)
  function applyIdentity(user, pName, mods, method) {
    setRole(user.role)
    setUserName(user.name)
    setProjectId(user.project_id || null)
    setProjectName(pName)
    setBranch(user.branch || null)
    setModules(mods)
    setAuthMethod(method)
    sessionStorage.setItem('mz_role',        user.role)
    sessionStorage.setItem('mz_user',        user.name)
    sessionStorage.setItem('mz_pid',         user.project_id || '')
    sessionStorage.setItem('mz_pname',       pName || '')
    sessionStorage.setItem('mz_branch',      user.branch || '')
    sessionStorage.setItem('mz_modules',     JSON.stringify(mods))
    sessionStorage.setItem('mz_auth_method', method)
    // دخول جديد يبدأ دائماً بالدور الحقيقي — لا يرث تلبّساً عالقاً
    setActingRole(null)
    sessionStorage.removeItem('mz_acting_role')
  }

  // ── استعادة جلسة المالك (Supabase Auth) عند التحميل — إضافي، دفاعي ──
  // لا يعمل إلا إذا: لا هوية في sessionStorage + توجد جلسة Supabase + الصف مربوط بـauth_id.
  // مغلّف بـtry/catch حتى لو لم يوجد عمود auth_id بعد (قبل تشغيل الـSQL اليدوي).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (sessionStorage.getItem('mz_role')) return   // هوية محمّلة أصلاً (PIN أو بريد سابق)
        const { data: sess } = await supabase.auth.getSession()
        const uid = sess?.session?.user?.id
        if (!uid || cancelled) return
        const { data: u } = await supabase
          .from('app_users')
          .select('name, role, project_id, branch')
          .eq('auth_id', uid)
          .maybeSingle()
        if (!u || u.role !== 'owner' || cancelled) return
        let pName = null
        if (u.project_id) {
          const { data: proj } = await supabase.from('projects').select('name').eq('id', u.project_id).maybeSingle()
          pName = proj?.name || null
        }
        const mods = u.project_id ? await getProjectModules(u.project_id) : []
        if (cancelled) return
        applyIdentity(u, pName, mods, 'email')
      } catch { /* عمود auth_id غير موجود بعد أو خطأ شبكي — نتجاهل ونبقى على PIN */ }
    })()
    return () => { cancelled = true }
  }, [])

  // ── دخول المالك بالبريد + كلمة المرور (بجانب PIN، لا يمسّه) ──
  async function loginWithEmail(email, password) {
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email: (email || '').trim(),
      password: password || '',
    })
    if (authErr || !authData?.user) {
      throw new Error('البريد الإلكتروني أو كلمة المرور غير صحيحة')
    }
    const uid = authData.user.id
    const { data: u, error } = await supabase
      .from('app_users')
      .select('name, role, project_id, branch')
      .eq('auth_id', uid)
      .maybeSingle()
    if (error || !u) {
      await supabase.auth.signOut()
      throw new Error('هذا الحساب غير مربوط بمستخدم — تواصل مع مزوّد الخدمة')
    }
    let pName = null
    if (u.project_id) {
      const { data: proj } = await supabase.from('projects').select('name').eq('id', u.project_id).maybeSingle()
      pName = proj?.name || null
    }
    const mods = u.project_id ? await getProjectModules(u.project_id) : []
    applyIdentity(u, pName, mods, 'email')
    return u.role
  }

  // ── دخول الرمز — عبر /api/pin-login: الخادم يتحقق بحد محاولات مشترك في القاعدة (يُحتسب قبل فحص الرمز)، ويعيد
  // المستخدم وجلسة Supabase حقيقية معًا. login_with_pin لم تعد متاحة للمتصفح. بلا جلسة لا دخول (لا هوية بلا auth.uid()).
  async function login(pin) {
    const subdomain = getSubdomain()
    const isDev     = subdomain === '__dev__'

    const r = await pinLogin(fetch, { subdomain, pin })
    if (r.kind === 'throttled') throw new Error(throttleMessage(r.retryAfter))
    if (r.kind === 'error') throw new Error('تعذّر الاتصال بالخادم. حاول مرة أخرى.')
    if (r.kind === 'invalid') {
      if (!isDev && r.tenantResolved === false) throw new Error('يرجى الدخول من رابط مشروعك الخاص')
      return null
    }
    const { error: otpError } = await supabase.auth.verifyOtp({ token_hash: r.tokenHash, type: 'magiclink' })
    if (otpError) throw new Error('تعذّر فتح الجلسة. حاول مرة أخرى.')

    const row = r.user
    const user = { id: row.id, role: row.role, name: row.name, project_id: row.project_id, branch: row.branch }
    const pName = row.project_name

    const mods = user.project_id ? await getProjectModules(user.project_id) : []

    setRole(user.role)
    setUserName(user.name)
    setProjectId(user.project_id || null)
    setProjectName(pName)
    setBranch(user.branch || null)
    setModules(mods)

    sessionStorage.setItem('mz_role',    user.role)
    sessionStorage.setItem('mz_user',    user.name)
    sessionStorage.setItem('mz_pid',     user.project_id || '')
    sessionStorage.setItem('mz_pname',   pName || '')
    sessionStorage.setItem('mz_branch',  user.branch || '')
    sessionStorage.setItem('mz_modules', JSON.stringify(mods))
    // دخول جديد يبدأ دائماً بالدور الحقيقي — لا يرث تلبّساً عالقاً
    setActingRole(null)
    sessionStorage.removeItem('mz_acting_role')

    return user.role
  }

  function switchProject(id, name) {
    setProjectId(id)
    setProjectName(name)
    sessionStorage.setItem('mz_pid',   id   || '')
    sessionStorage.setItem('mz_pname', name || '')
  }

  // ── عرض منشأة لمدير المنصة (قراءة فقط، 20261009150000) ──
  // المنشأة تصل إلى الخادم مع كل طلب (setViewProject)، والخادم يتحقق أن صاحب الجلسة مدير منصة نشط ويُثبت وصولها إلى سياسات القراءة
  // (admin_view_project). قبل نجاح ذلك لا تُعرض صفحات المنشأة، فلا يظهر رفض الصلاحية أو تعذّر التحميل أصفارًا.
  //   none: لا منشأة | checking: يتحقق | ok: يُعرض | error: تعذّر (viewError: رمز الخادم أو network)
  const [viewState, setViewState] = useState(() => (sessionStorage.getItem('mz_role') === 'superadmin' && sessionStorage.getItem('mz_pid') ? 'checking' : 'none'))
  const [viewError, setViewError] = useState('')
  const viewRequest = React.useRef(0)
  async function verifyView(id) {
    const request = ++viewRequest.current
    setViewProject(id); setViewState('checking'); setViewError('')
    let res
    try { const { data, error } = await supabase.rpc('admin_view_project', { p_project_id: id }); res = error ? { ok: false, code: 'network' } : (data || { ok: false, code: 'network' }) }
    catch { res = { ok: false, code: 'network' } }
    if (request !== viewRequest.current) return { ok: false, code: 'superseded' }   // اختيار أحدث سبقه: تُتجاهل نتيجته
    if (res.ok) setViewState('ok')
    else { setViewState('error'); setViewError(res.code || 'network') }
    return res
  }
  async function enterProjectView(id, name) {
    switchProject(id, name)   // الصفحات لا تُعرض قبل ok (Layout)، فتظهر حالة التحقق ثم البيانات أو رسالة الرفض
    const res = await verifyView(id)
    if (res.ok && res.name) setProjectName(res.name)
    return res
  }
  function leaveProjectView() {
    viewRequest.current++
    setViewProject(null); setViewState('none'); setViewError('')
    switchProject(null, null)
  }
  // بعد إعادة التحميل أو وصول الجلسة: مدير المنصة الذي كان يعرض منشأة يُتحقق له من جديد قبل العرض
  useEffect(() => {
    if (role === 'superadmin' && projectId && viewState !== 'ok') verifyView(projectId)
    if (role !== 'superadmin') setViewProject(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, sessionEpoch])

  // الدور الفعّال الذي يراه التطبيق كله. التلبّس مسموح للمالك وحده، ويُتحقَّق
  // من ذلك هنا عند كل قراءة — لا عند البدء فقط — حتى لا يكفي تزوير المفتاح
  // بأدوات المطوّر لحساب غير مالك.
  const canImpersonate  = role === 'owner'
  const effectiveRole   = (canImpersonate && actingRole) ? actingRole : role
  const isImpersonating = canImpersonate && !!actingRole

  function startImpersonation(target) {
    if (role !== 'owner') return
    if (!['accountant', 'cashier', 'purchasing'].includes(target)) return
    setActingRole(target)
    sessionStorage.setItem('mz_acting_role', target)
  }

  function stopImpersonation() {
    setActingRole(null)
    sessionStorage.removeItem('mz_acting_role')
  }

  function logout() {
    stopImpersonation()
    viewRequest.current++; setViewProject(null); setViewState('none'); setViewError('')
    setRole(null)
    setUserName(null)
    setProjectId(null)
    setProjectName(null)
    setBranch(null)
    setModules([])
    setAuthMethod(null)
    sessionStorage.removeItem('mz_role')
    sessionStorage.removeItem('mz_user')
    sessionStorage.removeItem('mz_pid')
    sessionStorage.removeItem('mz_pname')
    sessionStorage.removeItem('mz_branch')
    sessionStorage.removeItem('mz_modules')
    sessionStorage.removeItem('mz_auth_method')
    // ينهي جلسة Supabase إن وُجدت — عملية بلا أثر لمستخدم PIN (لا جلسة لديه)
    supabase.auth.signOut().catch(() => {})
  }

  // ── حساب عطّله مالك المنشأة: الخادم يرفض كل طلباته أصلًا (الهوية لا تعيد منشأة)؛ هنا نُخرجه من الواجهة برسالة
  // واضحة بدل صفحات فارغة. صفه نفسه تسمح به RLS حتى وهو معطّل. يُفحص عند البدء، وكل 20 ثانية، وعند العودة للنافذة.
  // قبل هجرة 20260930000000 لا عمود للحالة: يفشل الاستعلام بصمت ولا يحدث شيء.
  useEffect(() => {
    if (!role) return
    let stopped = false
    async function check() {
      try {
        const { data: sess } = await supabase.auth.getSession()
        const uid = sess?.session?.user?.id
        if (!uid || stopped) return
        const { data } = await supabase.from('app_users').select('is_active').eq('auth_id', uid).maybeSingle()
        if (!stopped && data && data.is_active === false) {
          sessionStorage.setItem('mz_logout_reason', 'inactive')
          logout()
        }
      } catch { /* شبكة: الدورة التالية */ }
    }
    check()
    const timer = setInterval(check, 20000)
    const onFocus = () => { if (document.visibilityState !== 'hidden') check() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      stopped = true
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [role])

  return (
    <AuthContext.Provider value={{
      // role = الدور الفعّال (المتلبَّس إن وُجد). كل التطبيق يشتقّ سلوكه منه،
      // فلا تحتاج أي صفحة تعديلاً. realRole = الحقيقي، للبوابات والتحذير.
      role: effectiveRole, realRole: role,
      userName, projectId, projectName, branch, modules, authMethod, sessionEpoch,
      roleLabel:    ROLE_LABELS[effectiveRole] || effectiveRole,
      login, loginWithEmail, logout, switchProject,
      enterProjectView, leaveProjectView, retryProjectView: () => projectId && verifyView(projectId), viewState, viewError,
      isImpersonating, canImpersonate, startImpersonation, stopImpersonation,
      // مدير المنصة يعرض المنشآت للقراءة فقط: لا أزرار تعديل (صلاحيات الكتابة في الخادم كما هي)
      canEdit:      effectiveRole === 'accountant',
      isOwner:      effectiveRole === 'owner'      || effectiveRole === 'superadmin',
      isPurchasing: effectiveRole === 'purchasing',
      isCashier:    effectiveRole === 'cashier',
      isSuperAdmin: effectiveRole === 'superadmin',
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
