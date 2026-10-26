// إعداد المنشأة حسب الفرع وقاموس الأصناف (20261014140000): قواعد العرض والاختيار المسبق. الخادم هو الحكم
// (local-test/branch-banks-items.test.sql)؛ هنا ما تعرضه الشاشة وما ترسله.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appsForProject, bankAccountLabel, channelEnabled, chosenBankAccount, documentExpensesAtProjectLevel, eligibleBankAccounts, needsBankAccount, visibleSalesChannels } from '../src/lib/branchSetup.js'
import { applyItemRules, applyRulesToDocument, indexRules, normItem } from '../src/lib/itemRules.js'

const settings = { branch_channels: { 'فرع الشمال': ['cash', 'network', 'transfer', 'hunger', 'jahez', 'mrsool'], 'فرع الجنوب': ['cash', 'network', 'transfer'] } }
const CH = [{ key: 'cashSales' }, { key: 'networkSales' }, { key: 'jahez' }, { key: 'keeta' }, { key: 'mrsool' }]

test('إخفاء الفرع للمصروفات فقط؛ التحويل والمبيعات والمستند المختلط تحتفظ باختيار الفرع', () => {
  const wide = { expenses_scope: 'project' }
  const expense = { type: 'expense' }, transfer = { type: 'transfer' }, sales = { type: 'sales' }
  for (const result of [expense, { invoices: [expense] }, { invoices: [expense, expense] }]) {
    assert.equal(documentExpensesAtProjectLevel(wide, result), true)
    for (const unchanged of [undefined, {}, { expenses_scope: 'branch' }]) {
      assert.equal(documentExpensesAtProjectLevel(unchanged, result), false)
    }
  }
  for (const result of [transfer, sales, { invoices: [transfer] }, { invoices: [transfer, transfer] },
    { invoices: [expense, transfer] }, { invoices: [expense, sales] },
    null, {}, { invoices: [] }, { invoices: [expense, {}] }, { invoices: [expense, null] }]) {
    assert.equal(documentExpensesAtProjectLevel(wide, result), false, JSON.stringify(result))
  }
})

test('القنوات: منشأة بلا إعداد أو فرع غير مذكور أو بلا فرع ⇒ كل القنوات', () => {
  assert.equal(channelEnabled(null, 'فرع الجنوب', 'jahez'), true)
  assert.equal(channelEnabled(settings, 'فرع آخر', 'jahez'), true)
  assert.equal(channelEnabled(settings, '', 'jahez'), true)
  assert.equal(channelEnabled(settings, 'فرع الجنوب', 'jahez'), false)
  assert.equal(channelEnabled(settings, 'فرع الشمال', 'jahez'), true)
})

test('القنوات المعروضة: المفعلة للفرع، وغير المفعلة تظهر فقط إن كان فيها مبلغ (لا يُخفى رقم مقروء)', () => {
  assert.deepEqual(visibleSalesChannels(CH, settings, 'فرع الجنوب', {}).map(c => c.key), ['cashSales', 'networkSales'])
  const withJahez = visibleSalesChannels(CH, settings, 'فرع الجنوب', { jahez: '120.50' })
  assert.deepEqual(withJahez.map(c => [c.key, c.enabled]), [['cashSales', true], ['networkSales', true], ['jahez', false]])
  assert.deepEqual(visibleSalesChannels(CH, settings, 'فرع الشمال', {}).map(c => c.key), ['cashSales', 'networkSales', 'jahez', 'mrsool'])
  assert.equal(visibleSalesChannels(CH, null, 'فرع الجنوب', {}).length, CH.length)   // العملاء الحاليون: كما كانت
})

test('مطابقة التطبيقات: المفعّل في فرع واحد على الأقل؛ بلا إعداد الكل', () => {
  const APPS = [{ key: 'hunger' }, { key: 'jahez' }, { key: 'keeta' }, { key: 'ninja' }, { key: 'mrsool' }]
  assert.deepEqual(appsForProject(APPS, settings).map(a => a.key), ['hunger', 'jahez', 'mrsool'])
  assert.equal(appsForProject(APPS, {}).length, APPS.length)
  assert.equal(appsForProject(APPS, null).length, APPS.length)
})

const bankA = { id: 'r', name: 'بنك الأفق (مؤقت)', bank: 'بنك الأفق', branches: ['فرع الشمال', 'فرع الجنوب', 'فرع الشرق'], is_active: true }
const bankB = { id: 'i', name: 'بنك الواحة (مؤقت)', bank: 'بنك الواحة', branches: ['فرع الشمال', 'فرع الشرق'], is_active: true }
const old = { id: 'o', name: 'قديم', branches: [], is_active: false }

test('الحسابات المتاحة للفرع: النشطة المربوطة به؛ بلا فرع كل النشطة', () => {
  assert.deepEqual(eligibleBankAccounts([bankA, bankB, old], 'فرع الجنوب').map(a => a.id), ['r'])
  assert.deepEqual(eligibleBankAccounts([bankA, bankB, old], 'فرع الشمال').map(a => a.id), ['r', 'i'])
  assert.deepEqual(eligibleBankAccounts([bankA, bankB, old], null).map(a => a.id), ['r', 'i'])
  assert.deepEqual(eligibleBankAccounts([{ id: 'x', branches: [], is_active: true }], 'أي فرع').map(a => a.id), ['x'])   // بلا فروع = كل الفروع
})

test('الحساب المعروض: المختار إن كان متاحًا، وإلا الوحيد، وإلا فارغ (يجب الاختيار)', () => {
  assert.equal(chosenBankAccount([bankA, bankB], 'فرع الجنوب', ''), 'r')
  assert.equal(chosenBankAccount([bankA, bankB], 'فرع الجنوب', 'i'), 'r')   // الواحة غير مربوط بالجنوب
  assert.equal(chosenBankAccount([bankA, bankB], 'فرع الشمال', ''), '')
  assert.equal(chosenBankAccount([bankA, bankB], 'فرع الشمال', 'i'), 'i')
  assert.equal(chosenBankAccount([], 'فرع الشمال', ''), '')
})

test('حاجة الفاتورة لحساب: نفس قاعدة plan_invoice في الخادم', () => {
  assert.equal(needsBankAccount({ type: 'sales', networkSales: 10 }), true)
  assert.equal(needsBankAccount({ type: 'sales', transferSales: '5' }), true)
  assert.equal(needsBankAccount({ type: 'sales', cashSales: 10, jahez: 5 }), false)
  assert.equal(needsBankAccount({ type: 'expense', paySource: 'bank' }), true)
  assert.equal(needsBankAccount({ type: 'expense', paySource: 'cash' }), false)
  assert.equal(needsBankAccount({ type: 'transfer', paySource: 'cash', transType: '🏧 تحويل داخلي — إيداع نقدي' }), true)
  assert.equal(needsBankAccount({ type: 'transfer', paySource: 'cash', transType: 'أخرى' }), false)
})

test('اسم الحساب: لا يكرر اسم البنك إن كان ضمن الاسم', () => {
  assert.equal(bankAccountLabel(bankA), 'بنك الأفق (مؤقت)')
  assert.equal(bankAccountLabel({ name: 'الحساب الرئيسي', bank: 'بنك الأفق' }), 'الحساب الرئيسي — بنك الأفق')
})

test('توحيد الوصف مطابق للخادم: الهمزات، التطويل، المسافات (ومنها في الطرفين)', () => {
  assert.equal(normItem('  أرز   بسمتي '), 'ارز بسمتي')
  assert.equal(normItem('إنـــاء آلي ٱ'), 'اناء الي ا')
  assert.equal(normItem('\tدجاج\n'), 'دجاج')
  assert.equal(normItem('   '), null)
  assert.equal(normItem(null), null)
})

const cats = [
  { id: 'M1', name: 'تكلفة البضاعة', parent_id: null, is_active: true },
  { id: 'S1', name: 'لحوم', parent_id: 'M1', is_active: true },
  { id: 'M2', name: 'معطّل', parent_id: null, is_active: false },
]
const rules = indexRules([
  { description_norm: 'لحم غنم', status: 'active', category_id: 'M1', subcategory_id: 'S1' },
  { description_norm: 'كيس', status: 'review', category_id: null, note: 'تغليف أم تشغيل؟' },
  { description_norm: 'قديم', status: 'active', category_id: 'M2', subcategory_id: null },
])

test('القاموس: المعتمد يُقترح للبند بلا تصنيف فقط؛ «للمراجعة» لا يُصنَّف؛ التصنيف المعطّل لا يُستعمل', () => {
  const items = [
    { description: 'لحم  غنم', amount: 10 },
    { description: 'لحم غنم', amount: 5, category_main: 'مصروفات', category_sub: 'أخرى' },   // له تصنيف: لا يُمس
    { description: 'كيس', amount: 1 },
    { description: 'قديم', amount: 2 },
    { description: 'غير موجود', amount: 3 },
  ]
  const r = applyItemRules(items, rules, cats)
  assert.equal(r.applied, 1); assert.equal(r.review, 1)
  assert.deepEqual([r.items[0].category_main, r.items[0].category_sub, r.items[0]._dictionary], ['تكلفة البضاعة', 'لحوم', 'active'])
  assert.equal(r.items[1].category_main, 'مصروفات')
  assert.equal(r.items[2].category_main, undefined); assert.equal(r.items[2]._dictionary, 'review'); assert.equal(r.items[2]._dictionaryNote, 'تغليف أم تشغيل؟')
  assert.equal(r.items[3].category_main, undefined); assert.equal(r.items[3]._dictionary, undefined)
  assert.equal(items[0].category_main, undefined)   // الأصل لا يتغير
})

test('القاموس على المستند: فاتورة واحدة أو عدة؛ تقارير المبيعات لا تُمس؛ بلا تطابق يعيد المستند نفسه', () => {
  const single = { type: 'expense', items: [{ description: 'لحم غنم' }] }
  const a = applyRulesToDocument(single, rules, cats)
  assert.equal(a.applied, 1); assert.equal(a.edit.items[0].category_sub, 'لحوم')
  const multi = { invoices: [{ type: 'sales', items: [{ description: 'لحم غنم' }] }, { type: 'expense', items: [{ description: 'كيس' }] }] }
  const b = applyRulesToDocument(multi, rules, cats)
  assert.equal(b.applied, 0); assert.equal(b.review, 1)
  assert.equal(b.edit.invoices[0].items[0].category_main, undefined)
  const none = { type: 'expense', items: [{ description: 'شيء' }] }
  assert.equal(applyRulesToDocument(none, rules, cats).edit, none)
})

// ── ملاحظات المراجعة R1 ──
import { bankAccountRows } from '../src/lib/branchSetup.js'
import { reportModel, modelToXlsx } from '../src/lib/reportExport.js'
import { findLegacyDuplicate } from '../src/lib/bankReconciliation.js'
import { inflateRawSync } from 'node:zlib'

const accs = [{ id: 'a', name: 'الحساب الأول', bank: 'بنك أ', is_active: true }, { id: 'b', name: 'الحساب الثاني', bank: 'بنك ب', is_active: true },
  { id: 'c', name: 'حساب معطّل فارغ', is_active: false }]
const byAcc = { a: 125050, b: -30025, '': 5000 }   // بالهللة: 1250.50، −300.25، وحركات بلا حساب 50
const balCtx = { tab: 'balance', org: 'مطعم تجريبي', from: '2026-10-01', to: '2026-10-15', branch: 'all', branches: [], generatedAt: new Date(2026, 9, 15, 12),
  data: { totalIn: 1000, totalOut: 400 }, balances: { cash: 10, bank: 1000.25, custody: 0, bankByAccount: byAcc }, bankAccounts: accs }

test('R1-05 صفوف رصيد البنك حسب الحساب: النشطة ومن له رصيد، وسطر بلا حساب، والإجمالي؛ والمجموع = رصيد البنك', () => {
  const rows = bankAccountRows(accs, byAcc, 1000.25)
  assert.deepEqual(rows.map(r => [r.label, r.value]), [['الحساب الأول — بنك أ', 1250.5], ['الحساب الثاني — بنك ب', -300.25], ['حركات بنك بلا حساب محدد', 50], ['رصيد البنك', 1000.25]])
  assert.equal(Math.round(rows.slice(0, -1).reduce((t, r) => t + r.value, 0) * 100), Math.round(rows.at(-1).value * 100))
  assert.deepEqual(bankAccountRows([], byAcc, 5), [])   // منشأة بلا حسابات: لا صفوف (كما كانت)
})

test('R1-05 نموذج التصدير يحتفظ بالأرصدة الموقعة ويميز الحركات غير المسماة', () => {
  const blk = reportModel(balCtx).blocks.find(b => b.id === 'balance.byAccount')
  assert.deepEqual(blk.rows.map(r => r.value), [1250.5,-300.25,50,1000.25])
  assert.equal(reportModel({ ...balCtx, bankAccounts: [] }).blocks.find(b => b.id === 'balance.byAccount').rows.at(-1).value,1000.25)
})

test('R1-05 ملف Excel فيه أسماء الحسابين وقيمهما بالإشارة (رقم سالب للحساب الثاني) وسطر بلا حساب', () => {
  const buf = Buffer.from(modelToXlsx(reportModel(balCtx)))
  const files = {}; let o = 0
  while (buf.readUInt32LE(o) === 0x04034b50) {
    const m = buf.readUInt16LE(o + 8), size = buf.readUInt32LE(o + 18), n = buf.readUInt16LE(o + 26), ex = buf.readUInt16LE(o + 28)
    const name = buf.slice(o + 30, o + 30 + n).toString('utf8'), st = o + 30 + n + ex, d = buf.slice(st, st + size)
    files[name] = (m === 0 ? d : inflateRawSync(d)).toString('utf8'); o = st + size
  }
  const sheet = Object.entries(files).find(([k]) => /worksheets\/sheet1\.xml$/.test(k))[1]
  for (const t of ['البنوك المتاحة حسب الحساب', 'الحساب الأول — بنك أ', 'الحساب الثاني — بنك ب', 'حركات بنكية سابقة بلا حساب محدد']) assert.ok(sheet.includes(t), t)
  assert.ok(/<v>1250\.5<\/v>/.test(sheet) && /<v>-300\.25<\/v>/.test(sheet) && /<v>50<\/v>/.test(sheet), 'القيم أرقام بإشارتها')
})

test('R1-02 استعلام التكرار: بالحساب في منشأة بحسابات (أو بلا حساب)، وكما كان في منشأة بلا حسابات', async () => {
  const calls = []
  const q = { calls, select() { return this }, eq(k, v) { calls.push(['eq', k, v]); return this }, neq(k, v) { calls.push(['neq', k, v]); return this },
    is(k, v) { calls.push(['is', k, v]); return this }, maybeSingle() { return Promise.resolve({ data: null, error: null }) } }
  const client = { from: () => (calls.length = 0, q) }
  const base = { projectId: 'p', date: '2026-10-01', type: 'ت', description: 'عمولة', amount: 10 }
  await findLegacyDuplicate(client, { ...base, hasAccounts: true, accountId: 'b' })
  assert.deepEqual(calls.filter(c => c[1] === 'bank_account_id'), [['eq', 'bank_account_id', 'b']])
  await findLegacyDuplicate(client, { ...base, hasAccounts: true, accountId: null })
  assert.deepEqual(calls.filter(c => c[1] === 'bank_account_id'), [['is', 'bank_account_id', null]])
  await findLegacyDuplicate(client, { ...base, hasAccounts: false, accountId: 'b' })
  assert.deepEqual(calls.filter(c => c[1] === 'bank_account_id'), [])
  assert.deepEqual(calls.map(c => c[1]), ['project_id', 'date', 'type', 'description', 'total_amount', 'status'])
})

// ── R3-01: الحساب الظاهر = المرسل بعد تصفير قناة أو إعادتها ──
import { salesChannelAccount, withSalesChannelAccount } from '../src/lib/branchSetup.js'
import { buildInvoicePayload } from '../src/lib/approvalV2.js'
// أولوية الخادم نفسها (plan_invoice وwrite_invoice في 20261016120000): اختيار القناة ثم العام
const serverAccount = (payload, k) => payload.bankAccounts?.[k] || payload.bankAccountId || null
const send = inv => buildInvoicePayload(inv, { original: inv, categories: [], transTypes: [] })

test('R3-01 قناتان ← تصفير التحويل ← اختيار «أ» في الحقل الواحد الظاهر: الشبكة تُرسل وتُسجَّل على «أ» (لا يتغلب اختيار «ب» القديم)', () => {
  let inv = { type: 'sales', cashSales: 10, networkSales: 100, transferSales: 40 }
  inv = { ...inv, bankAccounts: withSalesChannelAccount(inv, ['network'], 'B') }        // حقل الشبكة (حقلان)
  inv = { ...inv, cashSales: 50, transferSales: 0 }                                      // تصفير التحويل: يبقى حقل واحد للشبكة
  assert.equal(salesChannelAccount(inv, 'network'), 'B')                                  // الظاهر قبل الاختيار = المرسل
  inv = { ...inv, bankAccounts: withSalesChannelAccount(inv, ['network'], 'A') }        // الاختيار في الحقل الواحد
  assert.equal(salesChannelAccount(inv, 'network'), 'A')
  assert.equal(serverAccount(send(inv), 'network'), 'A')
})

test('R3-01 الحالة المعاكسة: تصفير الشبكة وإبقاء التحويل ← اختيار «أ»: التحويل على «أ»', () => {
  let inv = { type: 'sales', cashSales: 10, networkSales: 100, transferSales: 40 }
  inv = { ...inv, bankAccounts: withSalesChannelAccount(inv, ['transfer'], 'B') }
  inv = { ...inv, cashSales: 110, networkSales: 0 }
  inv = { ...inv, bankAccounts: withSalesChannelAccount(inv, ['transfer'], 'A') }
  assert.equal(salesChannelAccount(inv, 'transfer'), 'A')
  assert.equal(serverAccount(send(inv), 'transfer'), 'A')
})

test('R3-01 إعادة القناة المصفّرة: كل حساب معروض = ما يُرسل، بلا اختيار مخفي يتغلب', () => {
  let inv = { type: 'sales', cashSales: 10, networkSales: 100, transferSales: 40, bankAccountId: 'X' }   // اختيار عام قديم
  inv = { ...inv, bankAccounts: withSalesChannelAccount(inv, ['network'], 'B') }
  inv = { ...inv, transferSales: 0, cashSales: 50 }
  inv = { ...inv, bankAccounts: withSalesChannelAccount(inv, ['network'], 'A') }
  inv = { ...inv, transferSales: 40, cashSales: 10 }                                       // إعادة التحويل: حقلان من جديد
  const p = send(inv)
  for (const k of ['network', 'transfer']) assert.equal(serverAccount(p, k), salesChannelAccount(inv, k), k)
  assert.equal(salesChannelAccount(inv, 'network'), 'A')
  assert.equal(salesChannelAccount(inv, 'transfer'), 'X')                                  // بلا اختيار للتحويل: العام الظاهر هو المرسل
})

test('R3-01 مستند قديم بالاختيار العام وحده: الظاهر لكل قناة = المرسل', () => {
  const inv = { type: 'sales', networkSales: 100, transferSales: 40, bankAccountId: 'X' }
  const p = send(inv)
  for (const k of ['network', 'transfer']) assert.equal(serverAccount(p, k), 'X')
  assert.equal(salesChannelAccount(inv, 'network'), 'X')
})

test('مصروفات على مستوى المنشأة: الإعداد expenses_scope = project وحده يفعّلها، وبلا فرع تظهر حسابات المنشأة كلها', async () => {
  const { expensesAtProjectLevel, eligibleBankAccounts, chosenBankAccount } = await import('../src/lib/branchSetup.js')
  assert.equal(expensesAtProjectLevel({ expenses_scope: 'project' }), true)
  for (const s of [null, undefined, {}, { expenses_scope: 'branch' }, { branches: ['أ'] }]) assert.equal(expensesAtProjectLevel(s), false)
  const accs = [{ id: 'a', branches: ['فرع أ'] }, { id: 'b', branches: ['فرع ب'] }, { id: 'c', branches: [], is_active: false }]
  assert.deepEqual(eligibleBankAccounts(accs, null).map(a => a.id), ['a', 'b'])     // بلا فرع: النشطة كلها
  assert.deepEqual(eligibleBankAccounts(accs, 'فرع أ').map(a => a.id), ['a'])       // بفرع: كما كان
  assert.equal(chosenBankAccount(accs, null, 'b'), 'b')                               // حساب فرع آخر مقبول للمصروف على مستوى المنشأة
})
