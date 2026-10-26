// إعداد المنشأة حسب الفرع (20261014140000): قنوات المبيعات (تطبيقات التوصيل) والحسابات البنكية. وحدة خالصة تُختبر بلا متصفح.
// الخادم هو الحكم (حارسا الدفتر وخطة الاعتماد)؛ هنا العرض والاختيار المسبق فقط. منشأة بلا إعداد: كل القنوات، وبلا حسابات (بنك واحد كما كان).

// مفتاح القناة في قراءة تقرير المبيعات ← رمزها في الخادم
export const SALES_KEY_CHANNEL = {
  cashSales: 'cash', networkSales: 'network', transferSales: 'transfer',
  hungerSales: 'hunger', jahez: 'jahez', keeta: 'keeta', mrsool: 'mrsool',
}

/** هل القناة مفعلة للفرع؟ فرع غير مذكور أو منشأة بلا إعداد أو مستند بلا فرع ⇒ مفعلة. */
export function channelEnabled(settings, branch, channel) {
  const list = settings?.branch_channels?.[branch]
  if (!branch || !channel || !Array.isArray(list)) return true
  return list.includes(channel)
}

/** قنوات تقرير المبيعات المعروضة: المفعلة للفرع، ومعها أي قناة غير مفعلة فيها مبلغ مقروء (لا يُخفى رقم موجود؛ الخادم يرفضه). */
export function visibleSalesChannels(channels, settings, branch, values = {}) {
  return channels.map(c => ({ ...c, enabled: channelEnabled(settings, branch, SALES_KEY_CHANNEL[c.key]) }))
    .filter(c => c.enabled || Number(values?.[c.key] || 0) !== 0)
}

/** مصروفات المنشأة على مستواها لا الفروع (إعداد المنشأة expenses_scope = 'project'، 20261019120000): فاتورة المصروف بلا فرع،
 *  وحسابها البنكي من حسابات المنشأة كلها. الخادم يطبّق الشيء نفسه (approval_private.plan_invoice). بلا الإعداد: كما كان. */
export const expensesAtProjectLevel = settings => settings?.expenses_scope === 'project'

/** لا نخفي فرع مستند مختلط أو غير مصنّف؛ الاستثناء للمصروفات فقط. */
export function documentExpensesAtProjectLevel(settings, result) {
  if (!expensesAtProjectLevel(settings)) return false
  const invoices = Array.isArray(result?.invoices) ? result.invoices : [result]
  return invoices.length > 0 && invoices.every(invoice => invoice?.type === 'expense')
}

/** الحسابات المتاحة لفرع: النشطة، المربوطة بالفرع أو بكل الفروع؛ بلا فرع ⇒ كل النشطة. */
export function eligibleBankAccounts(accounts, branch) {
  return (accounts || []).filter(a => a.is_active !== false
    && (!branch || !Array.isArray(a.branches) || a.branches.length === 0 || a.branches.includes(branch)))
}

/** هل في الفاتورة حركة بنك تحتاج حسابًا؟ (القاعدة نفسها في plan_invoice على الخادم) */
export function needsBankAccount(inv) {
  if (!inv) return false
  if (inv.type === 'sales') return Number(inv.networkSales || 0) > 0 || Number(inv.transferSales || 0) > 0
  if (inv.type === 'transfer') return inv.paySource === 'bank' || !inv.transType || /إيداع نقدي|تحصيل ذمم|صرف عهدة/.test(inv.transType)
  return inv.paySource === 'bank'
}

/** الحساب المعروض: المختار إن كان متاحًا للفرع، وإلا الوحيد المتاح، وإلا لا شيء (يجب الاختيار). */
export function chosenBankAccount(accounts, branch, selectedId) {
  const list = eligibleBankAccounts(accounts, branch)
  if (selectedId && list.some(a => a.id === selectedId)) return selectedId
  return list.length === 1 ? list[0].id : ''
}

export const bankAccountLabel = a => (a ? [a.name, a.bank && !String(a.name || '').includes(a.bank) ? a.bank : null].filter(Boolean).join(' — ') : '')

/** صفوف الحركات البنكية الدفترية القديمة (R1-05). الأرصدة المتاحة للشاشة والتصدير تستخدم balanceOverview في accountStatement.
 *  byAccount بالهللة: { معرّف الحساب: صافٍ، '': صافي حركات البنك بلا حساب }. منشأة بلا حسابات ⇒ لا صفوف. */
export function bankAccountRows(accounts, byAccount, bankTotal) {
  if (!accounts?.length) return []
  const rows = accounts.filter(a => a.is_active !== false || byAccount?.[a.id])
    .map(a => ({ key: a.id, label: bankAccountLabel(a), value: (byAccount?.[a.id] || 0) / 100 }))
  if (byAccount?.['']) rows.push({ key: 'none', label: 'حركات بنك بلا حساب محدد', value: byAccount[''] / 100 })
  rows.push({ key: 'total', label: 'رصيد البنك', value: bankTotal, strong: true, line: true })
  return rows
}

/** حساب قناة مبيعات بنكية (network | transfer) كما يرسله الطلب ويقرؤه الخادم: اختيار القناة (bankAccounts.<القناة>) أولًا، ثم الاختيار العام
 *  (bankAccountId، احتياطي للمستندات القديمة). الشاشة تعرض هذا نفسه، فلا يتغلب اختيار مخفي على الظاهر (R3-01). */
export const salesChannelAccount = (inv, channel) => inv?.bankAccounts?.[channel] || inv?.bankAccountId || ''

/** اختيار حساب في حقل يمثل قناة أو أكثر: يُكتب في كل قناة ظاهرة في الحقل، فلا يبقى لها اختيار قديم مخالف. */
export const withSalesChannelAccount = (inv, channels, id) => ({ ...(inv?.bankAccounts || {}), ...Object.fromEntries(channels.map(k => [k, id])) })

/** تطبيقات مطابقة التطبيقات: منشأة بإعداد فروع تعرض التطبيق المفعّل في فرع واحد على الأقل؛ بلا إعداد: الكل كما كان. */
export function appsForProject(apps, settings) {
  const map = settings?.branch_channels
  if (!map || typeof map !== 'object') return apps
  const on = new Set(Object.values(map).flat())
  return apps.filter(a => on.has(a.key))
}
