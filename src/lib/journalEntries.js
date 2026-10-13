// تحميل «سجل الحركات» و«أرشيف الحركات» كاملًا — وحدة بلا واجهة (تُختبر في Node بعميل مصطنع).
// كانت الصفحتان تطلبان القيود بحد (500 من الأقدم، و2000 من الأحدث والخادم يعيد 1000)، وتتجاهلان الخطأ، وتطلبان روابط المستندات
// وعدد المرفقات بطلب واحد غير مفحوص. هنا: القيود كلها بترتيب ثابت (التاريخ، ثم وقت الإنشاء، ثم المعرّف)، ثم المستندات والمرفقات
// على دفعات كاملة؛ وأي فشل يُعاد خطأً باسم ما تعذّر، لا بيانات ناقصة.
import { fetchByChunks, fetchEveryRow } from './fetchAll.js'

const CHUNK = 100   // أرقام قيود لكل طلب، كي لا يطول عنوان الطلب

/**
 * قيود الفترة غير الملغاة، مع إكمال رابط المستند للقيد الذي بلا ملف من جدول documents برقم القيد (كما كانت الصفحتان تفعلان؛
 * عند أكثر من مستند للرقم نفسه يُعتمد الأحدث رفعًا).
 * @returns {{ data: object[]|null, error: object|null, part?: string }}
 */
export async function loadPeriodEntries(client, { projectId, from, to, columns, dateAscending }) {
  const entries = await fetchEveryRow(() => {
    let q = client.from('ledger_entries').select(columns)
      .eq('project_id', projectId)
      .not('status', 'eq', 'cancelled')
    if (from) q = q.gte('date', from)
    if (to)   q = q.lte('date', to)
    return q.order('date', { ascending: dateAscending }).order('created_at', { ascending: true }).order('id', { ascending: true })
  })
  if (entries.error) return { data: null, error: entries.error, part: 'القيود' }
  const all = entries.data.map(r => ({ ...r }))

  const missing = [...new Set(all.filter(r => !r.file_url && r.journal_number).map(r => r.journal_number))]
  if (missing.length) {
    const docs = await fetchByChunks(missing, CHUNK, chunk => fetchEveryRow(() => client.from('documents')
      .select('journal_number,file_url,file_name')
      .in('journal_number', chunk)
      .not('file_url', 'is', null)
      .order('uploaded_at', { ascending: true })
      .order('id', { ascending: true })))
    if (docs.error) return { data: null, error: docs.error, part: 'روابط المستندات' }
    const docMap = {}
    docs.data.forEach(d => { if (d.file_url) docMap[d.journal_number] = d })
    all.forEach(r => {
      if (!r.file_url && docMap[r.journal_number]) { r.file_url = docMap[r.journal_number].file_url; r._doc_name = docMap[r.journal_number].file_name }
    })
  }
  return { data: all, error: null }
}

/** عدد المرفقات الإضافية لكل رقم قيد (journal_number → عدد)، كاملًا على دفعات. */
export async function loadAttachmentCounts(client, { projectId, journalNumbers }) {
  const jnums = [...new Set(journalNumbers.filter(Boolean))]
  if (!jnums.length) return { data: {}, error: null }
  const res = await fetchByChunks(jnums, CHUNK, chunk => fetchEveryRow(() => client.from('attachments')
    .select('journal_number')
    .eq('project_id', projectId)
    .in('journal_number', chunk)
    .order('id', { ascending: true })))
  if (res.error) return { data: null, error: res.error, part: 'عدد المرفقات' }
  const counts = {}
  res.data.forEach(a => { counts[a.journal_number] = (counts[a.journal_number] || 0) + 1 })
  return { data: counts, error: null }
}
