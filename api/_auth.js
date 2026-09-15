/**
 * التحقق من هوية مستدعي نقاط Claude على الخادم.
 *
 * الهوية تُشتقّ من JWT جلسة Supabase الحقيقية (Authorization: Bearer)، والعضوية
 * من صف app_users المربوط بها عبر auth_id — نفس الربط الذي يكتبه pin-session.js
 * ويقرؤه AuthContext. لا يُقبل role ولا project_id من المتصفح، ولا يُعدّ Origin
 * دليل هوية.
 *
 * أي تعذّر بالتحقق يُرفض (fail closed): خطأ شبكة، غياب مفتاح الخادم، أو فشل
 * قراءة العضوية — لا يتحول أيٌّ منها إلى سماح.
 */

// استيراد كسول: يُبقي هذا الملف قابلاً للاختبار بعميل وهمي بلا تحميل supabase-js
async function defaultGetAdmin() {
  const { getSupabaseAdmin } = await import('./_supabaseAdmin.js')
  return getSupabaseAdmin()
}

export function extractBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  const match = /^Bearer\s+(\S+)$/i.exec(String(header).trim())
  return match ? match[1] : null
}

const deny = (status, code) => ({ ok: false, status, code })

export async function authenticateRequest(req, { getAdmin = defaultGetAdmin } = {}) {
  const token = extractBearerToken(req)
  if (!token) return deny(401, 'AUTH_REQUIRED')

  try {
    const admin = await getAdmin()

    const { data, error } = await admin.auth.getUser(token)
    const authUser = data?.user
    if (error || !authUser?.id) return deny(401, 'INVALID_SESSION')

    const { data: member, error: memberError } = await admin
      .from('app_users')
      .select('id, project_id, role')
      .eq('auth_id', authUser.id)
      .maybeSingle()

    if (memberError) return deny(500, 'AUTH_UNAVAILABLE')
    if (!member) return deny(403, 'NOT_A_MEMBER')

    return {
      ok: true,
      user: {
        authId:    authUser.id,
        appUserId: member.id,
        projectId: member.project_id,
        role:      member.role,
      },
    }
  } catch {
    return deny(500, 'AUTH_UNAVAILABLE')
  }
}
