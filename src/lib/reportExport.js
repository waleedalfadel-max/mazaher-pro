import { operatingBankRows, OPERATING_BALANCE_NOTE } from './paymentWorkflow.js'
// تصدير صفحة التقارير — وحدة خالصة (تُختبر في Node).
// reportModel يبني وصف القسم المختار (المؤشرات والجداول وصفوف الحساب والملاحظات) من أرقام الشاشة نفسها
// (salesFigures وexpenseFigures في reportFigures.js، وvatFigures في vatTreatment.js، والأرصدة)، فيُبنى منه ملف PDF (reportPdf.js)
// وملف Excel (modelToXlsx هنا) دون أي حساب آخر. قالب PDF القديم (صافي الربح والاسم القديم) لا يُستعمل.
import { uncountedText } from './financeRules.js'
import { bankAccountRows } from './branchSetup.js'
import { formatDate, formatNumber, plural } from '../ui/format.js'

export const TITLES = { sales: 'تقرير المبيعات', purchases: 'تقرير المصروفات', vat: 'تقرير ضريبة القيمة المضافة', balance: 'تقرير الأرصدة', apps: 'كشف حساب التطبيقات' }

// وصف الأرقام لكل قسم — يُعرض في الشاشة («ما الذي تشمله هذه الأرقام؟») وفي الملفين بالنص نفسه
export const SCOPE = {
  sales: [
    ['المبيعات', 'قيود المبيعات في الفترة (كاش وشبكة وتطبيقات التوصيل)، مقسومة على 1.15 لاستبعاد ضريبة المخرجات. التحويلات الداخلية وتحصيل الذمم لا تدخل.'],
    ['المتوسط اليومي', 'مبيعات الفترة مقسومة على عدد أيامها كلها، لا على أيام التشغيل وحدها.'],
    ['النمو', 'من أول الفترة حتى آخر يوم فيه مبيعات، مقابل الأيام نفسها من الشهر السابق.'],
    ['التطبيقات', 'هنقر وجاهز وكيتا ومرسول ونينجا، والنسبة من مبيعات الفرع نفسه.'],
  ],
  purchases: [
    ['المبالغ', 'بعد طرح ضريبة المدخلات المسجلة على كل قيد، وموزعة على تصنيفات بنود المستند.'],
    ['لا تدخل', 'المبيعات والتحويلات الداخلية وصرف العهدة وتحصيل الذمم والقيود الضريبية (كما في لوحة التحكم). المسحوبات والأقساط تظهر منفصلة.'],
    ['تكلفة البضاعة', 'حسب المعالجة المحفوظة مع القيد عند اعتماده، فلا يغيّرها تعديل التصنيف لاحقًا.'],
    ['النسبة', 'من المبيعات قبل الضريبة للفترة والفرع نفسيهما.'],
  ],
  vat: [
    ['ضريبة المخرجات', 'المبيعات شاملة الضريبة ناقص المبيعات قبل الضريبة (على أساس 15% لكل المبيعات).'],
    ['ضريبة المدخلات', 'الضريبة المسجلة على فواتير المشتريات والمصروفات في الفترة. لا تشمل سداد الضريبة للهيئة.'],
    ['مدفوعات الضريبة', 'قيود بنوع «ضريبة القيمة المضافة» خرجت من الصندوق أو البنك أو العهدة بلا ضريبة مسجلة عليها. تظهر في الأرصدة، ولا تدخل المصروفات.'],
    ['تحتاج تأكيدًا', 'قيود بنوع ضريبي لا يثبت من بياناتها أنها سداد (عليها ضريبة مسجلة، أو بنود فاتورة، أو نوع ضريبي آخر). لم تُحسب في أي رقم أعلاه.'],
    [null, 'للمتابعة الداخلية وليس إقرارًا ضريبيًا؛ لا يُحسب «متبقٍ للسداد» لأن الدفعات قد تخص فترات سابقة.'],
  ],
  balance: [
    ['الأرصدة', 'تراكمية من أول قيد حتى نهاية الفترة، وتشمل التحويلات الداخلية.'],
    ['ملخص الفترة', 'الداخل والخارج من الصندوق والبنك والعهدة خلال الفترة وحدها.'],
  ],
  apps: [
    ['الرصيد الدفتري', 'من قيود تحسيب وحدها: مبيعات التطبيق (مدين) ناقص تحصيلاته وتسوياته (دائن)، تراكميًا حتى نهاية الفترة. لا رصيد افتتاحي تقديري.'],
    ['الرصيد الافتتاحي', 'مجموع قيود التطبيق المسجلة قبل بداية الفترة، لا غير.'],
    ['التسويات', 'قيود تخفض ذمة التطبيق غير التحصيل، مثل العمولات المسجلة من «مطابقة التطبيقات» والتصحيحات.'],
    ['ما قبل بدء التسجيل', 'رصيد التطبيق قبل أول قيد مسجل له في تحسيب غير معروف من الدفتر ولا يُفترض صفرًا.'],
    ['رصيد كشف التطبيق', 'كما يظهر في كشف التطبيق نفسه ويُدخله المحاسب للمقارنة بمصدره؛ لا يُنشئ قيدًا ولا يغيّر الذمم. الفرق = رصيد الكشف − الرصيد الدفتري حتى التاريخ نفسه.'],
    ['قيود للمراجعة', 'قيود ذمم لا يُحدَّد تطبيقها بثقة من نوعها أو وصفها: تظهر منفصلة ولا تُوزَّع.'],
    ['الفروع', 'الكشف للمنشأة كاملة: تحصيل التطبيقات يُسجَّل على مستوى المنشأة.'],
  ],
}

const INTRO = {
  sales: 'المبالغ بالريال السعودي وقبل ضريبة القيمة المضافة.',
  purchases: 'المبالغ بالريال السعودي وقبل ضريبة القيمة المضافة؛ النسبة من المبيعات قبل الضريبة.',
  vat: 'المبالغ بالريال السعودي. حساب للمتابعة الداخلية يراجعه المحاسب قبل الإقرار والسداد.',
  balance: 'المبالغ بالريال السعودي. الأرصدة تراكمية حتى نهاية الفترة.',
  apps: 'المبالغ بالريال السعودي. الرصيد بعد كل حركة تراكمي من أول قيد للتطبيق. الكشف للمنشأة كاملة.',
}

export const VAT_NOTICE = (net) => `حساب للمتابعة الداخلية، يراجعه المحاسب قبل الإقرار والسداد. صافي ضريبة الفترة قبل السداد ${formatNumber(Math.abs(net), 2)} ${net >= 0 ? '(مستحق عن الفترة)' : '(فائض لصالح المنشأة)'}. مدفوعات الضريبة المسجلة خلال الفترة لا تُطرح منه، لأن السداد قد يخص فترة سابقة ولا يحدد القيد الفترة التي يخصها.`

export const cleanLabel = s => String(s || '').replace(/^[^\p{L}\p{N}]+/u, '').trim() || String(s || '')
const pctNum = p => (p === '—' || p == null || p === '' ? null : Number(p))
const outOf = e => (Number(e.cash_out) || 0) + (Number(e.bank_out) || 0) + (Number(e.custody_out) || 0)
const nz = v => (v > 0 ? v : null)

/** نص الفترة كما في عنوان الصفحة. */
export function rangeText(from, to) {
  return from === to ? formatDate(from, { year: true }) : `${formatDate(from, { year: from.slice(0, 4) !== to.slice(0, 4) })} – ${formatDate(to, { year: true })}`
}

/**
 * وصف القسم المختار. ctx: { tab, org, from, to, branch, branches, generatedAt (Date), engineSummary, prevEntriesCount,
 *   s (salesFigures), x (expenseFigures), data (بما فيها vat), balances }
 */
export function reportModel(ctx) {
  const { tab, org, from, to, branch = 'all', branches = [], generatedAt = new Date() } = ctx
  const branchText = branch === 'all' ? (branches.length > 1 ? 'كل الفروع' : 'المنشأة كاملة') : branch
  const blocks = []
  const T = (id, title, columns, rows, extra = {}) => blocks.push({ kind: 'table', id, title, columns, rows, ...extra })
  if (tab === 'apps') {
    const { label, statement: st, comparison: cmp, note, preSystem, comparisonText, unassigned = [] } = ctx.a
    blocks.push({ kind: 'calc', id: 'apps.summary', title: `ملخص ${label} — المنشأة كاملة`, rows: [
      { label: 'رصيد بداية الفترة (من قيود تحسيب السابقة)', value: st.opening },
      { label: 'مبيعات الفترة', value: st.totals.sales },
      { label: 'تحصيلات الفترة', value: st.totals.collections },
      { label: 'تسويات الفترة (عمولات وتصحيحات)', value: st.totals.settlements },
      { label: 'الرصيد الدفتري في نهاية الفترة', value: st.closing, strong: true },
    ] }, { kind: 'note', id: 'apps.note', text: note }, { kind: 'note', id: 'apps.presystem', text: preSystem })
    if (cmp) blocks.push({ kind: 'calc', id: 'apps.match', title: 'المقارنة مع كشف التطبيق الخارجي', rows: [
      { label: `رصيد كشف التطبيق في ${formatDate(cmp.date, { year: true })}`, value: cmp.statementBalance },
      { label: `الرصيد الدفتري حتى ${formatDate(cmp.date, { year: true })}`, value: cmp.bookBalance },
      { label: 'الفرق (كشف التطبيق − الدفتري)', value: cmp.difference, strong: true },
    ] }, { kind: 'note', id: 'apps.matchText', text: comparisonText })
    else blocks.push({ kind: 'note', id: 'apps.match', text: 'لم يُدخل رصيد من كشف التطبيق حتى نهاية الفترة؛ الرصيد المعروض دفتري فقط ولم يُقارن بكشف التطبيق.' })
    T('apps.movements', `حركات ${label}`, [{ label: 'التاريخ', type: 'date' }, { label: 'القيد' }, { label: 'الحركة' }, { label: 'البيان' }, { label: 'الفرع' },
      { label: 'مبيعات', type: 'money' }, { label: 'تحصيل', type: 'money' }, { label: 'تسوية', type: 'money' }, { label: 'الرصيد بعد الحركة', type: 'money' }],
      [['رصيد بداية الفترة', null, null, null, null, null, null, null, st.opening], ...st.rows.map(r => [r.date, r.journal, r.kindLabel, r.description || r.type, r.branch || 'المنشأة', r.sale, r.collection, r.settlement, r.balance])],
      { foot: [['الرصيد الدفتري', null, null, null, null, st.totals.sales || null, st.totals.collections || null, st.totals.settlements || null, st.closing]] })
    if (unassigned.length) T('apps.unassigned', 'قيود ذمم تحتاج مراجعة (لم تُنسب لتطبيق)', [{ label: 'التاريخ', type: 'date' }, { label: 'القيد' }, { label: 'النوع' }, { label: 'البيان' }, { label: 'السبب' }, { label: 'الأثر على الذمم', type: 'money' }],
      unassigned.map(u => [u.date, u.journal, u.type, u.description, u.reason, u.amount]))
  }

  if (tab === 'sales') {
    const s = ctx.s
    const growthText = s.growth === null ? null : `${s.growth >= 0 ? '↑' : '↓'} ${Math.abs(s.growth).toFixed(1)}%`
    if (ctx.engineSummary) {
      blocks.push({ kind: 'metrics', id: 'sales.cards', items: [
        { key: 'sales.total', label: 'المبيعات (قبل الضريبة)', type: 'money', value: s.curSales, foot: growthText ? `${growthText} عن الفترة نفسها من الشهر السابق` : 'بلا مقارنة بالشهر السابق' },
        { key: 'sales.avgDaily', label: 'متوسط يومي', type: 'money', value: s.dailyAvg, foot: `لكل يوم خلال ${s.periodDays} يوم` },
        { key: 'sales.bestDayTotal', label: 'أعلى يوم', type: 'money', value: s.bestDayEntry ? s.bestDayEntry.total : null, foot: s.bestDayEntry ? formatDate(s.bestDayEntry.date, { day: true, year: true }) : 'لا مبيعات' },
        { key: 'sales.activeDays', label: 'أيام التشغيل', type: 'count', value: s.activeDays, foot: `من أصل ${s.periodDays} يوم` },
      ] })
    }
    if (ctx.prevEntriesCount > 0) {
      T('sales.growth', 'نمو المبيعات', [{ label: 'البيان' }, { label: 'من', type: 'date' }, { label: 'إلى', type: 'date' }, { label: 'المبيعات', type: 'money' }, { label: 'النمو', type: 'pct' }], [
        ['الفترة الحالية', from, s.actualLastDate, s.curSales, null],
        ['الفترة السابقة', s.actualPrevFromD, s.actualPrevToD, s.prevSales, null],
      ], { foot: [['النمو', null, null, null, s.growth === null ? null : Number(s.growth.toFixed(1))]] })
    }
    if (branches.length > 1 && s.branchRows.length > 0) {
      T('sales.branches', 'أداء الفروع', [{ label: 'الفرع' }, { label: 'المبيعات', type: 'money' }, { label: 'النسبة', type: 'pct' }, { label: 'متوسط يومي', type: 'money' }, { label: 'أعلى يوم', type: 'date' }, { label: 'مبيعات أعلى يوم', type: 'money' }],
        s.branchRows.map(r => [r.branch, r.sales, Number(r.share), r.daily, r.topDate, r.topDate ? r.topAmt : null]),
        { foot: [['الإجمالي', s.totalSalesAll, 100, s.totalSalesAll / s.periodDays, null, null]] })
    }
    if (s.hasAppSales) {
      const withBranch = branches.length > 1
      const list = s.appBranches.length > 0 ? s.appBranches : Object.keys(s.appMap)
      T('sales.apps', `مبيعات التطبيقات${withBranch ? ' لكل فرع' : ''}`, [
        ...(withBranch ? [{ label: 'الفرع' }] : []), { label: 'هنقر', type: 'money' }, { label: 'جاهز', type: 'money' }, { label: 'كيتا', type: 'money' },
        { label: 'مرسول', type: 'money' }, { label: 'نينجا', type: 'money' }, { label: 'إجمالي التطبيقات', type: 'money' }, { label: '% من المبيعات', type: 'pct' }],
      list.map(b => {
        const v = s.appMap[b] || { hunger: 0, jahez: 0, keeta: 0, mrsool: 0, ninja: 0 }
        const appTotal = v.hunger + v.jahez + v.keeta + v.mrsool + v.ninja
        const brTotal = s.branchSalesMap[b]?.sales || 0
        return [...(withBranch ? [b] : []), nz(v.hunger), nz(v.jahez), nz(v.keeta), nz(v.mrsool), nz(v.ninja), appTotal, brTotal > 0 ? Number((appTotal / brTotal * 100).toFixed(1)) : null]
      }))
    }
    if (s.dailyRows.length > 0) {
      T('sales.daily', 'المبيعات اليومية', [{ label: 'التاريخ', type: 'date' }, { label: 'كاش', type: 'money' }, { label: 'شبكة', type: 'money' }, { label: 'تطبيقات', type: 'money' }, { label: 'الإجمالي', type: 'money' }],
        s.dailyRows.map(r => [r.date, nz(r.cash), nz(r.bank), nz(r.apps), r.cash + r.bank + r.apps]),
        { marks: s.dailyRows.map(r => { const t = r.cash + r.bank + r.apps; return t === s.maxDaySales && t > 0 ? 'الأعلى' : null }),
          foot: [[`الإجمالي (${s.dailyRows.length} يوم)`, ...['cash', 'bank', 'apps'].map(k => s.dailyRows.reduce((t, r) => t + r[k], 0)), s.dailyRows.reduce((t, r) => t + r.cash + r.bank + r.apps, 0)]] })
    }
    if (!ctx.engineSummary) blocks.push({ kind: 'note', id: 'sales.empty', text: 'لا توجد بيانات في هذه الفترة.' })
    else if (s.dailyRows.length === 0) blocks.push({ kind: 'note', id: 'sales.empty', text: 'لا مبيعات معتمدة في هذه الفترة.' })
  }

  if (tab === 'purchases') {
    const x = ctx.x
    const pctOf = v => (x._sales > 0 ? Number(((v / x._sales) * 100).toFixed(1)) : null)
    const cols = [{ label: 'البند' }, { label: 'التصنيف الرئيسي' }, { label: 'المبلغ', type: 'money' }, { label: 'النسبة من المبيعات', type: 'pct' }]
    if (x.cogsRows.length > 0) {
      const rows = [], levels = []
      for (const sub of x.cogsBySubRows) {
        rows.push([sub.isUncat ? 'غير مصنف' : cleanLabel(sub.label), sub.mainLabel || null, sub.total, x._sales > 0 ? Number((sub.total / x._sales * 100).toFixed(1)) : null]); levels.push(1)
        for (const r of sub.rows) { rows.push([r.label || '—', null, r.amount, null]); levels.push(2) }
      }
      T('purchases.cogs', 'تكلفة البضاعة المباعة', cols, rows, { levels, foot: [['إجمالي تكلفة البضاعة المباعة', null, x.cogsTotal, x._sales > 0 ? Number(x.cogsPct) : null]] })
    }
    if (x.opexRows.length > 0) {
      const rows = [], levels = []
      for (const m of x.opexRows) {
        rows.push([cleanLabel(m.label), null, m.total, x._sales > 0 ? pctOf(m.total) : 0]); levels.push(0)
        for (const sub of m.subs) {
          rows.push([sub.isUncat ? 'غير مصنف' : cleanLabel(sub.label), cleanLabel(m.label), sub.total, pctOf(sub.total)]); levels.push(1)
          for (const r of sub.rows) { rows.push([r.label || '—', null, r.amount, null]); levels.push(2) }
        }
      }
      T('purchases.opex', 'المصروفات حسب التصنيف', cols, rows, { levels })
    }
    if (x.hasObligations) {
      const rows = [], levels = []
      for (const g of [{ t: 'المسحوبات', total: x.totalW, list: x.wGroups }, { t: 'الأقساط والقروض', total: x.totalD, list: x.dGroups }].filter(g => g.list.length)) {
        rows.push([g.t, g.total]); levels.push(0)
        for (const it of g.list) { rows.push([cleanLabel(it.type), it.total]); levels.push(2) }
      }
      T('purchases.obligations', 'المسحوبات والالتزامات — لا تدخل في الربح', [{ label: 'البند' }, { label: 'المبلغ', type: 'money' }], rows,
        { levels, foot: (x.totalW + x.totalD) > 0 ? [['إجمالي المسحوبات والالتزامات', x.totalW + x.totalD]] : [] })
    }
    if (x.taxEntries.length > 0) {
      const amt = x.taxEntries.reduce((t, e) => t + outOf(e), 0)
      blocks.push({ kind: 'note', id: 'purchases.taxNote', text: `${x.taxEntries.length} من القيود الضريبية بمبلغ ${formatNumber(amt, 2)} لا تدخل المصروفات (كما في لوحة التحكم): سداد الضريبة للهيئة وما يحتاج تأكيد المحاسب. تفاصيلها في تقرير الضريبة.` })
    }
    if (x.mainRows.length === 0 && !x.hasObligations) blocks.push({ kind: 'note', id: 'purchases.empty', text: 'لا توجد فواتير مشتريات مصنّفة في هذه الفترة.' })
  }

  if (tab === 'vat') {
    const d = ctx.data, v = d.vat, due = v.netBeforePayment >= 0
    blocks.push({ kind: 'metrics', id: 'vat.cards', items: [
      { key: 'vat.output', label: 'ضريبة المخرجات', type: 'money', value: v.outputVat, foot: 'المبيعات ÷ 1.15 × 15%' },
      { key: 'vat.input', label: 'ضريبة المدخلات', type: 'money', value: v.inputVat, foot: 'المسجلة على فواتير المشتريات' },
      { key: 'vat.net', label: 'صافي ضريبة الفترة قبل السداد', type: 'money', value: Math.abs(v.netBeforePayment), foot: due ? 'المخرجات أكبر: مستحق للهيئة عن الفترة' : 'المدخلات أكبر: فائض لصالح المنشأة' },
      { key: 'vat.payments', label: 'مدفوعات الضريبة خلال الفترة', type: 'money', value: v.paymentsTotal, foot: v.payments.length ? `${plural(v.payments.length, 'دفعة واحدة', 'دفعتان', 'دفعات', 'دفعة')}؛ لا تُطرح من صافي الفترة${v.refunds.length ? `، ومستردات ${formatNumber(v.refundsTotal, 2)}` : ''}` : 'لا سداد مسجّل في الفترة' },
    ] })
    blocks.push({ kind: 'calc', id: 'vat.calc', title: 'تفاصيل حساب الضريبة', rows: [
      { label: 'إجمالي المبيعات (شامل الضريبة)', value: d.totalSales },
      { label: 'المبيعات الصافية (÷ 1.15)', value: d.netSales },
      { label: 'ضريبة المخرجات (15%)', value: v.outputVat, strong: true },
      { label: 'ضريبة المدخلات (من الفواتير)', value: -v.inputVat, strong: true },
      { label: 'صافي ضريبة الفترة قبل السداد', value: v.netBeforePayment, strong: true },
    ] })
    blocks.push({ kind: 'note', id: 'vat.notice', text: VAT_NOTICE(v.netBeforePayment) })
    const moves = [...v.payments, ...v.refunds].sort((p, q) => String(p.date).localeCompare(String(q.date)))
    if (moves.length) {
      T('vat.payments', 'مدفوعات ومستردات الضريبة خلال الفترة', [{ label: 'التاريخ', type: 'date' }, { label: 'الوصف' }, { label: 'الحركة' }, { label: 'من / إلى' }, { label: 'المبلغ', type: 'money' }],
        moves.map(r => [r.date, r.description || '—', r.kind === 'payment' ? 'سداد' : 'استرداد', r.source, r.amount]),
        { foot: [['إجمالي المدفوعات', null, null, null, v.paymentsTotal], ...(v.refunds.length ? [['إجمالي المستردات', null, null, null, v.refundsTotal]] : [])] })
    }
    if (v.review.length) {
      T('vat.review', `قيود ضريبية تحتاج تأكيد المحاسب (${v.review.length})`, [{ label: 'التاريخ', type: 'date' }, { label: 'النوع' }, { label: 'الوصف' }, { label: 'خارج', type: 'money' }, { label: 'داخل', type: 'money' }, { label: 'ضريبة مسجلة', type: 'money' }, { label: 'ما يحتاج تأكيدًا', wide: true }],
        v.review.map(r => [r.date, cleanLabel(r.type), r.description || '—', nz(r.out), nz(r.in), nz(r.vat), r.reasonText]),
        { subtitle: 'لم تُحسب في المصروفات ولا في ضريبة المدخلات ولا في المدفوعات، ولم يُعدَّل أي قيد' })
    }
    if (v.inputVatEntries.length) {
      T('vat.entries', `فواتير المشتريات — ضريبة المدخلات (${v.inputVatEntries.length})`, [{ label: 'التاريخ', type: 'date' }, { label: 'البند' }, { label: 'الوصف' }, { label: 'المبلغ الإجمالي', type: 'money' }, { label: 'الضريبة', type: 'money' }],
        v.inputVatEntries.map(e => [e.date, cleanLabel(e.type) || '—', e.description || '—', e.signedGross, e.signedVat]),
        { foot: [['إجمالي ضريبة المدخلات', null, null, v.inputVatEntries.reduce((t, e) => t + e.signedGross, 0), v.inputVat]] })
    } else blocks.push({ kind: 'note', id: 'vat.empty', text: 'لا توجد فواتير مشتريات تحتوي ضريبة في هذه الفترة.' })
  }

  if (tab === 'balance') {
    const b = ctx.balances, d = ctx.data
    const toText = formatDate(to, { year: true })
    blocks.push({ kind: 'metrics', id: 'balance.cards', items: [
      { key: 'balance.cash', label: 'رصيد الصندوق', type: 'money', value: b.cash, foot: b.cash < 0 ? 'رصيد سالب' : `حتى ${toText}` },
      { key: 'balance.bank', label: 'رصيد البنك', type: 'money', value: b.bank, foot: b.bank < 0 ? 'رصيد سالب' : `حتى ${toText}` },
      { key: 'balance.custody', label: 'رصيد العهدة', type: 'money', value: b.custody, foot: b.custody < 0 ? 'رصيد سالب' : `حتى ${toText}` },
    ] })
    // رصيد كل حساب بنكي (منشأة بحسابات فقط) بالصفوف نفسها التي تعرضها الشاشة (bankAccountRows)
    const byAccount = bankAccountRows(ctx.bankAccounts, b.bankByAccount, b.bank)
    if (byAccount.length) blocks.push({ kind: 'calc', id: 'balance.byAccount', title: 'رصيد البنك حسب الحساب', rows: byAccount.map(({ label, value, strong }) => ({ label, value, strong })) })
    const operating = operatingBankRows(ctx.bankAccounts, b.bankByAccount, ctx.projectSettings)
    if (operating.length) blocks.push({ kind: 'calc', id: 'balance.operating', title: 'الأرصدة البنكية المتاحة للتشغيل', rows: operating }, { kind: 'note', id: 'balance.operatingNote', text: OPERATING_BALANCE_NOTE })
    blocks.push({ kind: 'calc', id: 'balance.calc', title: 'ملخص الفترة', rows: [
      { label: 'إجمالي المدين (الدخل)', value: d.totalIn, strong: true },
      { label: 'إجمالي الدائن (الخروج)', value: d.totalOut, strong: true },
      { label: 'صافي الفترة', value: d.totalIn - d.totalOut, strong: true },
      { label: 'إجمالي الأرصدة النقدية', value: b.cash + b.bank + b.custody, strong: true },
    ] })
  }

  // القيود غير المحتسبة (معلق/مرفوض/بلا حالة) — القاعدة نفسها في الشاشة والتحليل (financeRules)
  const unc = tab !== 'balance' ? uncountedText(ctx.engineSummary?.uncounted) : null
  if (unc) blocks.push({ kind: 'note', id: 'uncounted', text: unc })

  const pad = n => String(n).padStart(2, '0')
  const g = generatedAt
  return {
    tab, title: TITLES[tab], org: org || '', from, to, branch, branchText, rangeText: rangeText(from, to),
    generatedAt: g.toISOString(),
    generatedText: `${formatDate(`${g.getFullYear()}-${pad(g.getMonth() + 1)}-${pad(g.getDate())}`, { year: true })}، ${pad(g.getHours())}:${pad(g.getMinutes())}`,
    intro: INTRO[tab], blocks, scope: SCOPE[tab],
  }
}

/** اسم الملف: نوع التقرير والفترة والفرع. */
export function exportFileName(model, ext) {
  const slug = s => String(s).replace(/[\\/:*?"<>|]+/g, '').trim().replace(/\s+/g, '-')
  return `${slug(model.title)}-${model.from}-${model.to}${model.branch !== 'all' ? '-' + slug(model.branch) : ''}.${ext}`
}

/** عرض قيمة خلية كما في الشاشة (للـPDF). */
export function displayValue(v, type) {
  const t = cellType(v, type)   // تسمية مثل «الإجمالي» في عمود تاريخ أو مبلغ تُعرض نصًا
  if (!t) return '—'
  if (t === 'money') return formatNumber(v, 2)
  if (t === 'pct') return `${Number(v).toFixed(1)}%`
  if (t === 'count') return String(v)
  if (t === 'date') return formatDate(v, { year: true })
  return String(v)
}

// ── Excel (xlsx) بلا مكتبة: أوراق XML في ملف zip مخزَّن ─────────────────────

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100
const serial = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000) }
const colName = i => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26) } return s }
// الأنماط: 0 عادي، 1 عريض، 2 عنوان، 3 مبلغ، 4 مبلغ عريض، 5 نسبة، 6 تاريخ، 7 رأس جدول، 8 عدد، 9 نص ملتف، 10 إزاحة 1، 11 إزاحة 2، 12 نسبة عريضة
const S = { text: 0, bold: 1, title: 2, money: 3, moneyBold: 4, pct: 5, date: 6, head: 7, count: 8, wrap: 9, indent1: 10, indent2: 11, pctBold: 12 }

/** النوع الفعلي للخلية: تسمية نصية في عمود تاريخ أو رقم (مثل «الإجمالي») تُكتب نصًا. */
export function cellType(value, type) {
  if (value === null || value === undefined || value === '') return null
  if (type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? 'date' : 'text'
  if (type === 'money' || type === 'pct' || type === 'count') return Number.isFinite(Number(value)) && typeof value !== 'boolean' && String(value).trim() !== '' ? type : 'text'
  return 'text'
}

const textStyle = st => (st === S.moneyBold || st === S.pctBold ? S.bold : st === undefined || st === S.money || st === S.pct || st === S.date || st === S.count ? S.text : st)

function cellXml(ref, value, givenType, style) {
  const type = cellType(value, givenType)
  if (!type) return style ? `<c r="${ref}" s="${style}"/>` : ''
  if (type === 'money') return `<c r="${ref}" s="${style ?? S.money}"><v>${round2(value)}</v></c>`
  if (type === 'pct') return `<c r="${ref}" s="${style ?? S.pct}"><v>${round2(Number(value) * 10) / 1000}</v></c>`
  if (type === 'count') return `<c r="${ref}" s="${style ?? S.count}"><v>${Number(value)}</v></c>`
  if (type === 'date') return `<c r="${ref}" s="${style ?? S.date}"><v>${serial(value)}</v></c>`
  return `<c r="${ref}" t="inlineStr" s="${textStyle(style)}"><is><t xml:space="preserve">${esc(value)}</t></is></c>`
}

/** صفوف ورقة Excel من وصف القسم: [{ cells: [{ v, type, style }] }]. تُستعمل في الملف وفي اختبار المطابقة. */
export function sheetRows(model) {
  const rows = []
  const add = cells => rows.push({ cells })
  const blank = () => rows.push({ cells: [] })
  add([{ v: `${model.title} — ${model.org}`, style: S.title }])
  add([{ v: 'الفترة', style: S.bold }, { v: model.rangeText }, { v: model.from, type: 'date' }, { v: model.to, type: 'date' }])
  add([{ v: 'الفرع', style: S.bold }, { v: model.branchText }])
  add([{ v: 'تاريخ الاستخراج', style: S.bold }, { v: model.generatedText }])
  add([{ v: model.intro, style: S.wrap }])
  blank()
  for (const b of model.blocks) {
    if (b.kind === 'metrics') {
      add([{ v: 'المؤشرات', style: S.title }])
      add([{ v: 'المؤشر', style: S.head }, { v: 'القيمة', style: S.head }, { v: 'ملاحظة', style: S.head }])
      for (const it of b.items) add([{ v: it.label }, { v: it.value, type: it.type }, { v: it.foot }])
    } else if (b.kind === 'calc') {
      add([{ v: b.title, style: S.title }])
      for (const r of b.rows) add([{ v: r.label, style: r.strong ? S.bold : S.text }, { v: r.value, type: 'money', style: r.strong ? S.moneyBold : S.money }])
    } else if (b.kind === 'note') {
      add([{ v: b.text, style: S.wrap }])
    } else if (b.kind === 'table') {
      add([{ v: b.title, style: S.title }])
      if (b.subtitle) add([{ v: b.subtitle, style: S.wrap }])
      add([...b.columns.map(c => ({ v: c.label, style: S.head })), ...(b.marks ? [{ v: 'ملاحظة', style: S.head }] : [])])
      b.rows.forEach((r, i) => {
        const lvl = b.levels?.[i] || 0
        add([...r.map((v, j) => ({ v, type: b.columns[j].type, style: j === 0 && !b.columns[0].type ? (lvl === 1 ? S.indent1 : lvl === 2 ? S.indent2 : lvl === 0 && b.levels ? S.bold : undefined) : undefined })),
          ...(b.marks ? [{ v: b.marks[i] }] : [])])
      })
      for (const f of b.foot || []) add(f.map((v, j) => ({ v, type: b.columns[j].type, style: b.columns[j].type === 'money' ? S.moneyBold : b.columns[j].type === 'pct' ? S.pctBold : S.bold })))
    }
    blank()
  }
  add([{ v: 'وصف الأرقام', style: S.title }])
  for (const [t, x] of model.scope) add([{ v: t || 'ملاحظة', style: S.bold }, { v: x, style: S.wrap }])
  return rows
}

function sheetXml(model) {
  const rows = sheetRows(model)
  const body = rows.map((r, i) => `<row r="${i + 1}">${r.cells.map((c, j) => cellXml(`${colName(j)}${i + 1}`, c.v, c.type, c.style)).join('')}</row>`).join('')
  const widths = [38, 22, 16, 16, 16, 16, 16, 44]
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>`
    + `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${body}</sheetData><pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait"/></worksheet>`
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><b/><sz val="13"/><color rgb="FF142D3A"/><name val="Arial"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F1EF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment indent="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment indent="2"/></xf>
<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function workbookFiles(model) {
  const sheetName = esc(model.title.replace(/^تقرير\s*/, '').slice(0, 31))
  return {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(model.title)}</dc:title><dc:creator>تحسيب المطاعم</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${model.generatedAt.slice(0, 19)}Z</dcterms:created></cp:coreProperties>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': sheetXml(model),
  }
}

// zip مخزَّن (بلا ضغط) مع CRC-32
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = bytes => { let c = 0xFFFFFFFF; for (const b of bytes) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }
export function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameB = enc.encode(name), data = typeof content === 'string' ? enc.encode(content) : content, crc = crc32(data)
    const h = new DataView(new ArrayBuffer(30))
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true)
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nameB.length, true)
    parts.push(new Uint8Array(h.buffer), nameB, data)
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true)
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nameB.length, true); c.setUint32(42, offset, true)
    central.push(new Uint8Array(c.buffer), nameB)
    offset += 30 + nameB.length + data.length
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0)
  const e = new DataView(new ArrayBuffer(22))
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, Object.keys(files).length, true); e.setUint16(10, Object.keys(files).length, true)
  e.setUint32(12, cdSize, true); e.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(e.buffer)]
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0)); let o = 0
  for (const p of all) { out.set(p, o); o += p.length }
  return out
}

/** ملف Excel للقسم المختار. */
export function modelToXlsx(model) {
  return zipStore(workbookFiles(model))
}
