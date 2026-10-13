// طبقة القراءة للتحليل المالي: طلبات القاعدة وحدها، بلا حساب. العميل يُمرَّر (supabase في التطبيق، وعميل مصطنع في الاختبارات).
// • الصلاحية أولًا من الخادم (analysis_access)؛ القراءة بعدها على سياسات الجداول القائمة نفسها، فلا يكفي معرّف منشأة من المتصفح.
// • كل جدول تُبنى عليه الأرقام يُجلب كاملًا بترتيب ثابت (src/lib/fetchAll.js)؛ وأي فشل في أي جزء خطأ باسمه، لا أصفار ولا بيانات ناقصة.
import { fetchEveryRow, fetchByChunks } from './fetchAll.js'
import { COUNTED_STATUSES } from './financialAnalysis.js'

const ENTRY_COLS = 'id,date,type,description,status,branch,journal_number,category_id,category_main,category_sub,financial_class,'
  + 'cash_in,bank_in,custody_in,receivable_in,cash_out,bank_out,custody_out,receivable_out,payable_in,payable_out,vat_amount,total_amount'

export class AnalysisLoadError extends Error {
  constructor(part, cause) { super(part); this.part = part; this.cause = cause }
}

export const ACCESS_MESSAGES = {
  no_session: 'انتهت الجلسة أو أُوقف الحساب. سجّل الدخول من جديد.',
  forbidden: 'التحليل المالي للمالك والمحاسب في المنشأة فقط.',
  project_inactive: 'المنشأة موقوفة؛ التحليل غير متاح.',
  view_not_applied: 'تعذّر تفعيل عرض المنشأة في الخادم.',
  not_found: 'المنشأة غير موجودة.',
  bad_request: 'طلب غير صالح. حدّث الصفحة.',
}

/** تحقق الخادم من الصلاحية. يعيد { ok, role, can_set_targets, read_only } أو { ok:false, code }؛ ويرمي عند فشل الاتصال. */
export async function checkAccess(client, projectId) {
  const { data, error } = await client.rpc('analysis_access', { p_project_id: projectId })
  if (error) throw new AnalysisLoadError('الصلاحية', error)
  return data && typeof data === 'object' ? data : { ok: false, code: 'bad_request' }
}

/**
 * يجلب كل ما يحتاجه التحليل لمدى واحد يغطي الفترة والمقارنة وخط الأساس والاتجاه.
 * @returns {{ rows, docItems, categoriesById, targets, dataStart, noBranch, pendingDocs, branches }}
 */
export async function loadAnalysisRows(client, { projectId, branch = 'all', from, to }) {
  const one = branch && branch !== 'all'
  const applyBranch = q => (one ? q.eq('branch', branch) : q)
  const [entries, first, noBranch, docs, cats, targets, settings] = await Promise.all([
    // كل الحالات عدا «ملغى» القديمة، ومنها بلا حالة: غير المعتمد يُعرض منفصلًا ولا يُحتسب
    fetchEveryRow(() => applyBranch(client.from('ledger_entries').select(ENTRY_COLS)
      .eq('project_id', projectId).gte('date', from).lte('date', to).or('status.is.null,status.neq.cancelled'))
      .order('date').order('id')),
    applyBranch(client.from('ledger_entries').select('date').eq('project_id', projectId).in('status', COUNTED_STATUSES))
      .order('date').limit(1),
    one ? fetchEveryRow(() => client.from('ledger_entries').select('id,date,total_amount').eq('project_id', projectId)
      .gte('date', from).lte('date', to).in('status', COUNTED_STATUSES).or('branch.is.null,branch.eq.').order('id'))
      : Promise.resolve({ data: [], error: null }),
    client.from('documents').select('id', { count: 'exact', head: true }).eq('project_id', projectId).in('status', ['uploaded', 'analyzed']),
    // التصنيفات كاملة بترتيب ثابت ولو تجاوزت حد الخادم (كالقيود والبنود)
    fetchEveryRow(() => client.from('categories').select('id,name,parent_id,financial_class').eq('project_id', projectId).order('id')),
    fetchEveryRow(() => client.from('analysis_targets').select('id,item_key,item_label,branch,ratio,active,effective_from,created_at')
      .eq('project_id', projectId).order('effective_from').order('created_at').order('id')),
    client.from('project_settings').select('settings').eq('project_id', projectId).maybeSingle(),
  ])
  if (entries.error || !entries.data) throw new AnalysisLoadError('القيود', entries.error)
  if (first.error) throw new AnalysisLoadError('بداية السجل', first.error)
  if (noBranch.error) throw new AnalysisLoadError('القيود بلا فرع', noBranch.error)
  if (cats.error || !cats.data) throw new AnalysisLoadError('التصنيفات', cats.error)
  if (targets.error) throw new AnalysisLoadError('الأهداف', targets.error)

  // بنود المستندات لكل رقم قيد، كاملة ولو تجاوزت الحد (كما في التقارير)
  const jns = [...new Set(entries.data.filter(e => e.journal_number).map(e => e.journal_number))]
  const items = await fetchByChunks(jns, 100, chunk => fetchEveryRow(() => client.from('document_items')
    .select('id,journal_number,ledger_entry_id,category_id,subcategory_id,description,amount,category_main,category_sub')
    .eq('project_id', projectId).in('journal_number', chunk).order('id')))
  if (items.error) throw new AnalysisLoadError('بنود المستندات', items.error)

  const listed = settings.data?.settings?.branches
  const branches = Array.isArray(listed) && listed.length && listed.every(b => typeof b === 'string' && b && !b.includes('?'))
    ? listed : [...new Set(entries.data.map(e => e.branch).filter(Boolean))].sort()
  return {
    rows: entries.data,
    docItems: items.data,
    categoriesById: Object.fromEntries((cats.data || []).map(c => [c.id, c])),
    targets: targets.data,
    dataStart: first.data?.[0]?.date || null,
    // القيود بلا فرع بتواريخها؛ تُعدّ داخل نافذة الفترة الحالية وحدها في الحساب (financialAnalysis.limitsOf)
    noBranchRows: one ? noBranch.data : null,
    // عدّ المستندات المعلقة معلومة مساعدة: فشله لا يوقف التحليل، ويظهر «غير متاح»
    pendingDocs: docs.error ? null : docs.count ?? null,
    branches,
  }
}

export async function setTarget(client, { itemKey, itemLabel, branch, ratio, effectiveFrom, active }) {
  const { data, error } = await client.rpc('analysis_target_set', {
    p_item_key: itemKey, p_item_label: itemLabel, p_branch: branch && branch !== 'all' ? branch : null,
    p_ratio: active ? ratio : null, p_effective_from: effectiveFrom, p_active: active,
  })
  if (error) return { ok: false, code: /failed to fetch|network|load failed/i.test(error.message || '') ? 'network' : 'error', message: error.message }
  return data || { ok: false, code: 'error' }
}

export const TARGET_MESSAGES = {
  no_session: 'انتهت الجلسة. سجّل الدخول من جديد.',
  forbidden: 'تحديد الأهداف لمالك المنشأة فقط.',
  project_inactive: 'المنشأة موقوفة.',
  bad_request: 'بيانات الهدف غير صالحة.',
  date_required: 'اختر تاريخ بداية سريان الهدف.',
  ratio_invalid: 'اكتب نسبة بين 0 و1000.',
  network: 'انقطع الاتصال قبل وصول الرد. حدّث الصفحة وتحقق قبل إعادة المحاولة.',
}
