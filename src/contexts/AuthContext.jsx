import React, { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getProjectModules } from '../lib/projectSettings'

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
        if (!u || cancelled) return
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

  // ── جلسة Supabase حقيقية خلف PIN — إضافية وغير حاجبة (المرحلة 2-أ) ──
  // تُستدعى بلا await من login() أدناه: فشلها لا يمنع الدخول أبداً، فقط
  // تبقى الجلسة بلا auth.uid() (كحالها اليوم بالضبط) حتى ينجح استدعاء لاحق.
  async function mintPinSession(userId, pin) {
    try {
      const res = await fetch('/api/pin-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, pin }),
      })
      if (!res.ok) return
      const { tokenHash } = await res.json()
      if (!tokenHash) return
      await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
    } catch { /* أفضل جهد — لا يمنع الدخول بأي حال */ }
  }

  async function login(pin) {
    const subdomain = getSubdomain()
    const isDev     = subdomain === '__dev__'

    // ── 1. هل هذا الـ PIN لـ superadmin؟ (بحث بدون فلتر مشروع) ────────────
    const { data: superAdmin } = await supabase
      .from('app_users')
      .select('id, name, role, project_id, branch')
      .eq('pin', pin)
      .eq('role', 'superadmin')
      .maybeSingle()

    let user = null

    if (superAdmin) {
      // superadmin يدخل من أي رابط
      user = superAdmin
    } else if (isDev) {
      // ── 2. بيئة التطوير: بدون قيود ────────────────────────────────────────
      const { data } = await supabase
        .from('app_users')
        .select('id, name, role, project_id, branch')
        .eq('pin', pin)
        .maybeSingle()
      user = data
    } else {
      // ── 3. إنتاج: فلتر حسب الـ subdomain ──────────────────────────────────
      if (!subdomain) {
        throw new Error('يرجى الدخول من رابط مشروعك الخاص')
      }
      const { data: proj } = await supabase
        .from('projects')
        .select('id')
        .eq('subdomain', subdomain)
        .maybeSingle()
      if (!proj?.id) {
        throw new Error('يرجى الدخول من رابط مشروعك الخاص')
      }
      const { data } = await supabase
        .from('app_users')
        .select('id, name, role, project_id, branch')
        .eq('pin', pin)
        .eq('project_id', proj.id)
        .maybeSingle()
      user = data
    }

    if (!user) return null

    let pName = null
    if (user.project_id) {
      const { data: proj } = await supabase
        .from('projects')
        .select('name')
        .eq('id', user.project_id)
        .maybeSingle()
      pName = proj?.name || null
    }

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

    // ننتظر منح الجلسة الحقيقية بمهلة 3 ثوانٍ قبل إعادة النتيجة — بمجرد تفعيل
    // RLS على جداول تُستعلَم فور الدخول (الدفعة 3)، أول صفحة قد تصل بجلسة
    // anon القديمة (لا auth.uid()) لو انتقلنا قبل اكتمال المنح، فتظهر فارغة
    // لثوانٍ. mintPinSession نفسها لا ترمي أبداً (try/catch داخلي) — المهلة
    // هنا فقط سقف أعلى يمنع التجمّد لو تعطّل الخادم؛ لا تُلغي خاصية
    // "الفشل لا يمنع الدخول أبداً".
    await Promise.race([
      mintPinSession(user.id, pin),
      new Promise(resolve => setTimeout(resolve, 3000)),
    ])

    return user.role
  }

  function switchProject(id, name) {
    setProjectId(id)
    setProjectName(name)
    sessionStorage.setItem('mz_pid',   id   || '')
    sessionStorage.setItem('mz_pname', name || '')
  }

  function logout() {
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

  return (
    <AuthContext.Provider value={{
      role, userName, projectId, projectName, branch, modules, authMethod,
      roleLabel:    ROLE_LABELS[role] || role,
      login, loginWithEmail, logout, switchProject,
      canEdit:      role === 'accountant' || role === 'superadmin',
      isOwner:      role === 'owner'      || role === 'superadmin',
      isPurchasing: role === 'purchasing',
      isCashier:    role === 'cashier',
      isSuperAdmin: role === 'superadmin',
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
