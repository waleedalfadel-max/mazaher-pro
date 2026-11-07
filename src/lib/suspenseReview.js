import { fetchEveryRow } from './fetchAll.js'
export const SUSPENSE_TYPE = 'فروقات قيد المراجعة'
export const SUSPENSE_SOURCES = ['تسوية مطابقة بنكية', 'فرق صندوق', 'فرق عهدة']
export const SUSPENSE_STATUS = { open: 'قيد المراجعة', proposed: 'بانتظار المالك', resolved: 'تمت المعالجة' }
export const RESOLUTIONS = { expense: 'مصروف أو مشتريات', sales: 'مبيعات غير مسجلة', supplier: 'سداد مورد', transfer: 'تحويل بين الحسابات', withdrawal: 'مسحوبات المالك', liability: 'مبلغ واجب الرد أو استرداده', shortage: 'عجز معتمد' }
export function suspenseTotals(cases) {
  const pending = cases.filter(c => c.status !== 'resolved')
  return { count: pending.length, incoming: pending.filter(c => c.direction === 'in').reduce((s,c) => s + Math.round(Number(c.amount)*100),0)/100,
    outgoing: pending.filter(c => c.direction === 'out').reduce((s,c) => s + Math.round(Number(c.amount)*100),0)/100 }
}
export async function loadSuspense(client, projectId) {
  const list = (table, columns, extra = q => q) => fetchEveryRow(() => extra(client.from(table).select(columns).eq('project_id',projectId)).order('id'))
  const results = await Promise.all([
    list('suspense_cases','id,entry_id,source_date,source_account,amount,direction,reason,reference,status,version,proposal,opened_by,proposed_by,approved_by,closed_at'),
    list('bank_accounts','id,name,bank,is_active,sort_order'),
    client.from('project_settings').select('settings').eq('project_id',projectId).single(),
    list('categories','id,name,financial_class,ledger_type', q=>q.eq('is_active',true).is('parent_id',null).in('financial_class',['cogs','opex','fixed'])),
    list('suppliers','id,name'), list('payable_suppliers','id,name'),
    list('ledger_entries','id,date,type,description,journal_number,total_amount',q=>q.in('type',SUSPENSE_SOURCES).in('status',['approved','auto'])),
  ])
  if(results.some(r=>r.error)) throw new Error('تعذّر تحميل الفروقات كاملة؛ أعد المحاولة.')
  return { projectId, cases:results[0].data.sort((a,b)=>b.source_date.localeCompare(a.source_date)), banks:results[1].data, settings:results[2].data.settings||{}, categories:results[3].data,
    suppliers:[...results[4].data.map(s=>({...s,kind:'list'})),...results[5].data.map(s=>({...s,kind:'payable'}))], sources:results[6].data }
}
const errors = {
  owner_required:'اعتماد المعالجة متاح للمالك فقط.', forbidden:'ليست لديك صلاحية لهذا الإجراء.', no_session:'انتهت الجلسة؛ سجّل الدخول مجددًا.',
  stale:'تغيرت بيانات الفرق. حدّث الصفحة ثم راجع المعالجة.', not_found:'الفرق غير موجود في هذه المنشأة.', source_not_eligible:'هذه الحركة تحتاج مراجعة مباشرة قبل ربطها بفرق.',
  reason_required:'اكتب سببًا واضحًا من 10 أحرف على الأقل.', confirmation_required:'أكد مراجعة العملية أولًا.', request_conflict:'سبق حفظ طلب مختلف بهذا الرقم؛ حدّث الصفحة.',
  category_required:'اختر تصنيفًا نشطًا للمصروف.', account_required:'اختر حسابًا صحيحًا من هذه المنشأة.', branch_required:'اختر فرع المبيعات.',
  vat_invalid:'تحقق من الضريبة؛ لا تتجاوز المبلغ.', tax_status_required:'راجع حالة التسجيل الضريبي للمنشأة.', sales_invalid:'راجع حساب المبيعات وضريبتها.',
  direction_invalid:'المعالجة لا تناسب اتجاه الفرق.', supplier_required:'اختر المورد الصحيح.', exceeds_balance:'المبلغ يتجاوز رصيد المورد المستحق.',
  supplier_invoices_required:'يجب تسجيل فواتير المورد في الدفتر قبل معالجة السداد.', proposal_invalid:'راجع المبلغ والتاريخ وبيانات المعالجة.', project_inactive:'المنشأة موقوفة.',
}
export async function writeSuspense(client, action, item, payload, requestId) {
  const {data,error}=await client.rpc('suspense_write',{p_action:action,p_case:item?.id||null,p_expected:item?.version||null,p_payload:payload,p_request:requestId||null})
  if(error) throw new Error('تعذّر الحفظ؛ أعد المحاولة. إذا انقطع الاتصال، حدّث الصفحة للتحقق من النتيجة.')
  if(!data?.ok) { const err=new Error(errors[data?.code] || 'تعذّر إتمام المعالجة؛ راجع البيانات ثم أعد المحاولة.'); err.definitive=true; throw err }
  return data
}
