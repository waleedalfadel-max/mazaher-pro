// التحليل المالي — حسابات خالصة وبناء الملاحظات (بلا اتصال؛ تُختبر في Node). القراءة في src/lib/analysisData.js والعرض في
// src/pages/FinancialAnalysis.jsx.
//
// الأساس واحد مع لوحة التحكم والتقارير: المبيعات والتكاليف والنتيجة بقواعد المحرك (src/lib/financeSummary.js و financeRules.js)،
// وتوزيع القيد على بنود مستنده بالدالة نفسها التي يستعملها تقرير المصروفات (allocateEntry). الفرق المقصود الوحيد عن التقارير الحالية:
// المحتسب «المعتمد» و«التلقائي» فقط؛ «المعلقة» و«المرفوضة» وبلا حالة تُعرض منفصلة بعددها ومبلغها ولا تدخل الأرقام
// (القاعدة المركزية isCounted في financeRules، كالمحرك والتقارير). كل المبالغ تُقارن بالهللات (أعداد صحيحة)، فلا تولّد كسور الحساب ملاحظة.
import { allocateEntry } from './expenseBreakdown.js'
import { normCat } from './approvalV2.js'
import { formatDate } from '../ui/format.js'
import { summarizeEntries } from './financeSummary.js'
import { VAT_RATE, isSales, isExcluded, isWithdrawal, isDebt, isTaxType, isCOGSEntry, isRealExpense, expenseAmountNet,
  salesAmountGross } from './financeRules.js'

// القاعدة المركزية للحالات المحتسبة في financeRules (مصدر واحد للمحرك والتقارير والتحليل)
export { COUNTED_STATUSES } from './financeRules.js'
import { COUNTED_STATUSES } from './financeRules.js'
export const STATUS_LABEL = { approved: 'معتمد', auto: 'تلقائي', pending: 'معلّق', rejected: 'مرفوض' }
export const UNCAT_MAIN = '— غير محدد'
const SETTLEMENT = 'سداد مورد'

export const toH = v => Math.round((Number(v) || 0) * 100)
const strip = s => String(s || '').replace(/^[^؀-ۿA-Za-z0-9]+/, '').trim()
const outsOf = e => (Number(e.cash_out) || 0) + (Number(e.bank_out) || 0) + (Number(e.custody_out) || 0) + (Number(e.receivable_out) || 0)
export const inWindow = (e, w) => e.date >= w.from && e.date <= w.to

/** نسبة من صافي المبيعات؛ null حين لا يصلح المقام (صفر أو سالب) — لا 0% ولا Infinity. */
export const ratioOf = (aH, salesH) => (salesH > 0 ? aH / salesH : null)

// ── أرقام نافذة واحدة ─────────────────────────────────────────────────────────

/**
 * @param rows قيود الفترة المجلوبة (كل الحالات عدا «ملغى» القديمة)، بالفرع المختار.
 * @returns أرقام النافذة بالهللات، والبنود (رئيسي ← فرعي) بمصادرها.
 */
export function windowFigures(rows, w, { docItems = [], categoriesById = {} } = {}) {
  const inside = (rows || []).filter(e => inWindow(e, w))
  const counted = inside.filter(e => COUNTED_STATUSES.includes(e.status))
  const uncounted = inside.filter(e => !COUNTED_STATUSES.includes(e.status))
  const active = counted.filter(e => !isExcluded(e.type))

  let salesGrossH = 0, costsH = 0, cogsH = 0, withdrawalsH = 0, debtsH = 0, taxOutH = 0, salesOutflows = 0
  for (const e of active) {
    if (isSales(e.type)) {
      salesGrossH += toH(salesAmountGross(e))
      if (outsOf(e) > 0) salesOutflows++
      continue
    }
    if (isWithdrawal(e.type)) { withdrawalsH += toH(outsOf(e)); continue }
    if (isDebt(e.type)) { debtsH += toH(outsOf(e)); continue }
    if (isTaxType(e.type)) { taxOutH += toH(outsOf(e)); continue }
    if (!isRealExpense(e)) continue
    const net = toH(expenseAmountNet(e))
    costsH += net
    if (isCOGSEntry(e)) cogsH += net
  }
  const salesNetH = Math.round(salesGrossH / (1 + VAT_RATE))

  // البنود: توزيع صافي كل قيد مصروف على بنود مستنده (كما في تقرير المصروفات)، ثم الرئيسي بمعرّفه الثابت والفرعي تحته
  // فرعي محفوظ بالاسم وحده (قيود سابقة) تحت رئيسي معروف: يُربط بمعرّف الفرعي الوحيد بالاسم نفسه تحته، فلا يظهر البند صفين.
  // اسم ملتبس (أكثر من فرعي) أو غير موجود يبقى بالاسم كما هو.
  const subIndex = new Map()
  for (const c of Object.values(categoriesById)) if (c.parent_id) {
    const k = c.parent_id + '|' + normCat(c.name)
    subIndex.set(k, [...(subIndex.get(k) || []), c])
  }
  const subOf = r => {
    if (r.subKey || !r.sub || !r.key) return null
    const hit = subIndex.get(r.key.slice(3) + '|' + normCat(r.sub))
    return hit?.length === 1 ? hit[0] : null
  }
  const mains = new Map()
  for (const e of active) {
    if (isSales(e.type) || isWithdrawal(e.type) || isDebt(e.type) || isTaxType(e.type)) continue
    const net = expenseAmountNet(e)
    if (!net) continue
    for (const r of allocateEntry(e, net, docItems, categoriesById)) {
      const uncategorized = !r.key && (r.main === UNCAT_MAIN || !strip(r.main))
      const mainId = r.key || ('name:' + (strip(r.main) || r.main))
      const mKey = mainId + '|' + r.cls
      if (!mains.has(mKey)) mains.set(mKey, { key: mKey, targetKey: mainId, label: strip(r.main) || r.main, cls: r.cls, f: 0, subs: new Map(),
        uncategorized, settlement: !r.key && strip(r.main).includes(SETTLEMENT),
        // بلا معرّف تصنيف ثابت: مجمّع بالاسم المحفوظ (بيانات سابقة لم يثبت ربطها) — يظهر كما هو ولا يُدمج بالتخمين
        unlinked: !r.key && !uncategorized && !strip(r.main).includes(SETTLEMENT) })
      const m = mains.get(mKey)
      m.f += r.amount
      const linked = subOf(r)
      const subId = r.subKey || (linked ? 'id:' + linked.id : r.sub ? 'name:' + (strip(r.sub) || r.sub) : '')
      const subLabel = linked ? strip(linked.name) || linked.name : r.subKey ? strip(r.sub) || r.sub : r.sub ? (strip(r.sub) || r.sub) : ''
      if (!m.subs.has(subId)) m.subs.set(subId, { key: mKey + '>' + subId, targetKey: mainId + '>' + subId, label: subLabel, f: 0, contribs: [] })
      const sub = m.subs.get(subId)
      sub.f += r.amount
      sub.contribs.push({ id: e.id, date: e.date, jn: e.journal_number || null, description: e.description || '', item: r.item?.description || null,
        type: e.type, status: e.status, amount: r.amount })
    }
  }
  const mainList = [...mains.values()].map(m => ({ ...m, h: Math.round(m.f * 100), subs: [...m.subs.values()].map(s => ({ ...s, h: Math.round(s.f * 100) })) }))

  const byStatus = {}
  for (const e of uncounted) {
    const k = e.status || 'null'
    byStatus[k] = byStatus[k] || { n: 0, h: 0 }
    byStatus[k].n++; byStatus[k].h += toH(e.total_amount)
  }

  return {
    window: w, n: counted.length, firstDate: inside.reduce((m, e) => (!m || e.date < m ? e.date : m), null),
    salesGrossH, salesNetH, costsH, cogsH, resultH: salesNetH - costsH, withdrawalsH, debtsH, taxOutH, salesOutflows,
    mains: mainList, uncounted: byStatus,
    uncategorizedH: mainList.filter(m => m.uncategorized).reduce((s, m) => s + m.h, 0),
    settlementH: mainList.filter(m => m.settlement).reduce((s, m) => s + m.h, 0),
    // للمطابقة مع المحرك نفسه (الاختبارات): الملخص من القيود المحتسبة
    engine: summarizeEntries(counted),
  }
}

/** البنود المسطحة: كل فرعي، والرئيسي الذي لا فرعي له ورقةً بنفسه. الأب لا يُعد بندًا مستقلًا عن أبنائه. */
export function leavesOf(fig) {
  const out = []
  for (const m of fig.mains) {
    const named = m.subs.filter(s => s.label)
    if (!named.length) { out.push({ key: m.key + '>', targetKey: m.targetKey, label: m.label, main: m, h: m.h, contribs: m.subs.flatMap(s => s.contribs), leafOfMain: true }); continue }
    for (const s of m.subs) out.push({ key: s.key, targetKey: s.targetKey, label: s.label || 'بلا تصنيف فرعي', main: m, h: s.h, contribs: s.contribs, noSub: !s.label })
  }
  return out
}

// ── المرجع: الفترة السابقة أو خط الأساس ───────────────────────────────────────

const REF_REASONS = {
  before_data: 'قبل بداية السجل',
  partial_data: 'يبدأ السجل داخلها',
  no_sales: 'لا مبيعات مسجلة',
  no_data: 'لا قيود',
}

/**
 * يجمع فترات المرجع. الفترة الصالحة: بعد بداية السجل بالكامل وفيها مبيعات. الفترة غير الصالحة تُذكر بسببها ولا تُحسب صفرًا.
 * النسبة المرجعية = مجموع البند ÷ مجموع المبيعات في الفترات الصالحة (لا متوسط نسب). المبلغ المرجعي = متوسط المبلغ للفترة الواحدة.
 */
export function referenceOf(kind, figs, dataStart) {
  const windows = figs.map(f => {
    const w = f.window
    let reason = null
    if (!dataStart) reason = 'no_data'
    else if (w.to < dataStart) reason = 'before_data'
    else if (w.from < dataStart) reason = 'partial_data'
    else if (f.salesNetH <= 0) reason = 'no_sales'
    return { window: w, fig: f, valid: !reason, reason, reasonText: reason ? REF_REASONS[reason] : null }
  })
  const valid = windows.filter(x => x.valid)
  const n = valid.length
  const sum = k => valid.reduce((s, x) => s + x.fig[k], 0)
  const leaves = new Map(), mains = new Map(), labels = new Map()
  for (const x of valid) {
    for (const m of x.fig.mains) { mains.set(m.key, (mains.get(m.key) || 0) + m.h); labels.set(m.key, m) }
    for (const l of leavesOf(x.fig)) { leaves.set(l.key, (leaves.get(l.key) || 0) + l.h); labels.set(l.key, l) }
  }
  return {
    kind, windows, n, days: valid.reduce((s, x) => s + x.window.days, 0),
    salesH: sum('salesNetH'), costsH: sum('costsH'), cogsH: sum('cogsH'), resultH: sum('resultH'),
    leaves, mains, labels,
    avg: h => (n ? h / n : null),
  }
}

// ── الأهداف ──────────────────────────────────────────────────────────────────

/**
 * الهدف الساري على فترة: أحدث صف (بتاريخ السريان ثم الإنشاء) سريانه في بداية الفترة أو قبلها، لنطاق الفرع نفسه.
 * صف معطَّل = لا هدف من تاريخه. هدف يبدأ داخل الفترة لا يُطبَّق عليها (ويُذكر).
 */
export function targetFor(targets, itemKey, branch, w) {
  const scope = branch && branch !== 'all' ? branch : null
  const rows = (targets || []).filter(t => t.item_key === itemKey && (t.branch || null) === scope)
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : a.effective_from > b.effective_from ? -1 : String(b.created_at).localeCompare(String(a.created_at))))
  const eff = rows.find(t => t.effective_from <= w.from)
  const startsInside = rows.find(t => t.effective_from > w.from && t.effective_from <= w.to)
  return { target: eff && eff.active ? { ratio: Number(eff.ratio), effective_from: eff.effective_from, id: eff.id } : null, startsInside: startsInside || null }
}

// ── البناء ───────────────────────────────────────────────────────────────────

const pct = (x, d = 1) => (x == null ? null : Math.round(x * 100 * 10 ** d) / 10 ** d)   // نسبة إلى نسبة مئوية مقربة
const round1 = x => Math.round(x * 10) / 10

/** صف مقارنة لبند أو مؤشر. */
function compareRow(curH, refSumH, ref, curSalesH) {
  const refAmt = ref.n ? refSumH / ref.n : null
  const refAmtH = refAmt == null ? null : Math.round(refAmt)
  const curR = ratioOf(curH, curSalesH)
  const refR = ref.n ? ratioOf(refSumH, ref.salesH) : null
  const ppRaw = curR != null && refR != null ? (curR - refR) * 100 : null
  // اتجاه النسبة بلا تقريب: cur/curSales مقابل refSum/refSales بضرب تبادلي لأعداد صحيحة
  const cmp = curR != null && refR != null
    ? Math.sign(Number(BigInt(Math.round(curH)) * BigInt(Math.round(ref.salesH)) - BigInt(Math.round(refSumH)) * BigInt(Math.round(curSalesH)))) : null
  return {
    curH, refH: refAmtH, refSumH, diffH: refAmtH == null ? null : curH - refAmtH,
    rel: refAmtH > 0 ? (curH - refAmtH) / refAmtH : null,
    curPct: pct(curR, 2), refPct: pct(refR, 2), pp: ppRaw == null ? null : (Math.abs(ppRaw) < 0.1 ? Math.round(ppRaw * 100) / 100 : round1(ppRaw)), ppRaw, cmp,
    gapH: refR != null && curSalesH > 0 ? Math.round(curH - refR * curSalesH) : null,
  }
}

/**
 * @param cur   windowFigures للفترة الحالية
 * @param ref   referenceOf للمقارنة المختارة
 * @param opts  { targets, branch, today, noBranch: {n,h}|null, pendingDocs: number|null }
 */
export function buildAnalysis(cur, ref, opts = {}) {
  const { targets = [], branch = 'all' } = opts
  const S = cur.salesNetH
  const salesRow = compareRow(S, ref.salesH, ref, S)
  const daily = { curH: Math.round(S / cur.window.days), refH: ref.days ? Math.round(ref.salesH / ref.days) : null }
  const costsRow = compareRow(cur.costsH, ref.costsH, ref, S)
  const cogsRow = compareRow(cur.cogsH, ref.cogsH, ref, S)
  // النتيجة: لا نسبة تغيّر إلا والفترتان ربح؛ الانتقال بين الخسارة والربح يوصف بالقيم
  const resultRow = compareRow(cur.resultH, ref.resultH, ref, S)
  if (!(resultRow.curH > 0 && resultRow.refH > 0)) resultRow.rel = null
  const marginRef = ref.n && ref.salesH > 0 ? ref.resultH / ref.salesH : null
  const marginCur = ratioOf(cur.resultH, S)

  // جدول البنود: الرئيسي ومجموعه، وتحته الفرعي. اتحاد بنود الفترتين حتى يظهر ما اختفى.
  const curLeaves = new Map(leavesOf(cur).map(l => [l.key, l]))
  const mainKeys = new Map()
  for (const m of cur.mains) mainKeys.set(m.key, m)
  for (const [k, m] of ref.labels) if (!k.includes('>') && !mainKeys.has(k)) mainKeys.set(k, { ...m, h: 0, subs: [] })
  const lines = []
  for (const [mk, m] of mainKeys) {
    const row = { key: mk, targetKey: m.targetKey, label: m.label, cls: m.cls, uncategorized: m.uncategorized, settlement: m.settlement, unlinked: m.unlinked,
      ...compareRow(m.h || 0, ref.mains.get(mk) || 0, ref, S), children: [] }
    const leafKeys = new Set([...curLeaves.keys()].filter(k => k.startsWith(mk + '>')))
    for (const k of ref.leaves.keys()) if (k.startsWith(mk + '>')) leafKeys.add(k)
    for (const lk of leafKeys) {
      const l = curLeaves.get(lk) || ref.labels.get(lk)
      const c = compareRow(curLeaves.get(lk)?.h || 0, ref.leaves.get(lk) || 0, ref, S)
      row.children.push({ key: lk, targetKey: l.targetKey, label: l.label, leafOfMain: !!l.leafOfMain, noSub: !!l.noSub, ...c,
        contribs: curLeaves.get(lk)?.contribs || [] })
    }
    row.children.sort((a, b) => (a.noSub ? 1 : b.noSub ? -1 : b.curH - a.curH))
    lines.push(row)
  }
  lines.sort((a, b) => (a.uncategorized ? 1 : b.uncategorized ? -1 : b.curH - a.curH))

  const refValid = ref.n > 0
  const notes = []
  const refText = ref.kind === 'baseline' ? `متوسط ${ref.n === 1 ? 'فترة واحدة صالحة' : ref.n === 2 ? 'فترتين صالحتين' : ref.n + ' فترات صالحة'}` : 'الفترة السابقة'
  const salesDiffH = salesRow.diffH

  // ملاحظات البنود (الأوراق فقط: الأب لا يُحسب أثره فوق أبنائه)
  for (const line of lines) {
    for (const leaf of line.children) {
      const fullLabel = leaf.leafOfMain ? line.label : `${leaf.label} (${line.label})`
      const flags = lineFlags(line, leaf)
      const base = { lineKey: leaf.key, detailKeys: [leaf.key], mainKey: line.key, label: fullLabel, row: leaf, flags }
      if (!refValid) continue
      const { curH, refSumH, refH, diffH, cmp } = leaf
      if (refSumH === 0 && curH > 0) {
        notes.push({ ...base, kind: 'new', adverse: true, impactH: leaf.gapH ?? curH,
          title: `بند جديد في هذه الفترة: ${fullLabel}`,
          explain: `لا مبلغ لهذا البند في ${refText}؛ لا أساس نسبة للمقارنة.`,
          action: 'راجع قيوده وتأكد من تصنيفها وتاريخها.' })
      } else if (refSumH > 0 && curH === 0) {
        notes.push({ ...base, kind: 'gone', adverse: false, impactH: -refH,
          title: `لم يُسجَّل شيء هذه الفترة: ${fullLabel}`,
          explain: `كان المبلغ في ${refText} ${money(refH)} ولا قيد له الآن. الغياب وحده لا يثبت وفرًا؛ قد يعني أن القيد لم يُسجَّل بعد.`,
          action: 'تحقق من اكتمال تسجيل الفترة.' })
      } else if (cmp === 1) {
        notes.push({ ...base, kind: 'ratio_up', adverse: true, impactH: leaf.gapH ?? diffH,
          title: `ارتفعت نسبة ${fullLabel} إلى المبيعات`,
          explain: ratioUpExplain(diffH, salesDiffH, leaf, salesRow),
          action: diffH > 0 ? 'راجع تفاصيل البند: دفعة غير معتادة، أو تسجيل مكرر، أو تاريخ في غير فترته.' : 'راجع اكتمال المبيعات المسجلة قبل الحكم على البند.' })
      } else if (cmp === -1) {
        notes.push({ ...base, kind: 'ratio_down', adverse: false, impactH: diffH,
          title: `انخفضت نسبة ${fullLabel} إلى المبيعات`,
          explain: `${diffH < 0 ? `انخفض المبلغ ${money(-diffH)}` : diffH > 0 ? `زاد المبلغ ${money(diffH)} أبطأ من المبيعات` : 'المبلغ لم يتغير والمبيعات زادت'}. الانخفاض وحده لا يثبت تحسنًا؛ قد يعني نقص تسجيل.`,
          action: 'تأكد من تسجيل كل قيود البند قبل اعتباره تحسنًا.' })
      } else if (cmp === 0 && diffH) {
        notes.push({ ...base, kind: 'amount_change', adverse: false, impactH: diffH,
          title: `${diffH > 0 ? 'زاد' : 'انخفض'} مبلغ ${fullLabel} بنسبة ثابتة من المبيعات`,
          explain: `تغيّر المبلغ ${money(diffH)} بالقدر نفسه الذي تغيّرت به المبيعات؛ النسبة ${fmtPct(leaf.curPct, 2)} كما في ${refText}.`,
          action: 'لا تغيّر في النسبة؛ راجع البند إن لم يكن التغير متوقعًا مع حجم العمل.' })
      } else if (cmp == null && diffH) {
        notes.push({ ...base, kind: diffH > 0 ? 'amount_up' : 'amount_down', adverse: diffH > 0, impactH: diffH,
          title: `${diffH > 0 ? 'ارتفع' : 'انخفض'} مبلغ ${fullLabel}`,
          explain: `لا يمكن احتساب نسبة مناسبة إلى المبيعات في إحدى الفترتين؛ المقارنة بالمبلغ وحده.`,
          action: 'راجع تفاصيل البند.' })
      }
    }
  }

  // تراجع المبيعات (الإجمالي، أو المتوسط اليومي حين يختلف عدد الأيام)
  if (refValid) {
    const daysDiffer = ref.n && ref.days / ref.n !== cur.window.days
    const down = daysDiffer ? daily.refH != null && daily.curH < daily.refH : salesDiffH < 0
    if (down) notes.push({ kind: 'sales_down', adverse: true, impactH: -(daysDiffer ? (daily.curH - daily.refH) * cur.window.days : salesDiffH), lineKey: 'sales',
      label: 'صافي المبيعات', row: salesRow, daily, flags: [],
      title: daysDiffer ? 'تراجع متوسط المبيعات اليومي' : 'تراجع صافي المبيعات',
      explain: `${money(S)} في ${cur.window.days} يومًا مقابل ${money(salesRow.refH)} ${ref.kind === 'baseline' ? 'متوسطًا للفترة' : ''} في ${Math.round(ref.days / ref.n)} يومًا${daysDiffer ? `؛ المتوسط اليومي ${money(daily.curH)} مقابل ${money(daily.refH)}` : ''}. تغيّر المواسم أو أيام العمل يؤثر في المقارنة.`,
      action: 'راجع اكتمال تقارير المبيعات للفترة قبل أي استنتاج.' })
    if (marginCur != null && marginRef != null && round1((marginCur - marginRef) * 100) < 0) {
      const flip = Math.sign(cur.resultH) !== Math.sign(ref.resultH)
      notes.push({ kind: 'margin_down', adverse: true, impactH: Math.round(marginRef * S - cur.resultH), lineKey: 'result', label: 'هامش النتيجة المسجلة',
        row: resultRow, flags: [],
        title: 'انخفض هامش النتيجة المسجلة',
        explain: flip
          ? `النتيجة المسجلة ${money(cur.resultH)} مقابل ${money(resultRow.refH)} في ${refText}؛ لا تُحسب نسبة تغيّر عند انتقال النتيجة بين الربح والخسارة.`
          : `الهامش ${fmtPct(marginCur * 100)} مقابل ${fmtPct(marginRef * 100)} في ${refText}. بالهامش المرجعي على مبيعات الفترة تكون النتيجة ${money(Math.round(marginRef * S))}؛ الفرق ${money(Math.round(marginRef * S - cur.resultH))} حصيلة تغيّر البنود في هذه القائمة، فلا يُجمع مع فروقها.`,
        action: 'راجع ملاحظات البنود في هذه القائمة لمعرفة ما ارتفعت نسبته.' })
    }
  }

  // الأهداف التي حددها المالك (لا معايير جاهزة)
  const targetRows = []
  const evalTarget = (itemKey, label, curH, detailKeys) => {
    const { target, startsInside } = targetFor(targets, itemKey, branch, cur.window)
    if (!target && !startsInside) return null
    const r = { itemKey, label, target, startsInside, curPct: pct(ratioOf(curH, S), 2) }
    if (target && S > 0) {
      r.gapH = Math.round(curH - target.ratio / 100 * S)
      r.exceeded = curH / S * 100 > target.ratio
      if (r.exceeded) notes.push({ kind: 'target_exceeded', adverse: true, impactH: r.gapH, lineKey: itemKey, detailKeys, label, row: null, target, flags: [],
        title: `تجاوز الهدف المحدد للمنشأة: ${label}`,
        explain: `النسبة ${fmtPct(r.curPct)} والهدف ${fmtPct(target.ratio)} (ساري من ${formatDate(target.effective_from, { year: true })}). الفرق عن الهدف ${money(r.gapH)}.`,
        action: 'راجع تفاصيل البند.' })
    }
    targetRows.push(r)
    return r
  }
  evalTarget('costs_total', 'التكاليف المسجلة', cur.costsH, null)   // التفاصيل للتكاليف كلها والمواد: التقارير
  evalTarget('cogs_total', 'مشتريات المواد', cur.cogsH, null)
  // الهدف للبند (معرّفه الثابت، رئيسيًا أو فرعيًا) لا لمعالجته المالية: قد يُحفظ البند نفسه بمعالجتين (تغيّر تصنيفه مع بقاء قيوده التاريخية)،
  // فيُجمع مبلغه من كل صفوفه قبل التقييم مرة واحدة، وتفاصيله أوراق تلك الصفوف نفسها — المبلغ المقيَّم = مجموع التفاصيل.
  const byTarget = new Map()
  const add = (key, label, curH, leafKeys, holder) => {
    if (!byTarget.has(key)) byTarget.set(key, { label, curH: 0, leafKeys: [], holders: [] })
    const t = byTarget.get(key); t.curH += curH; t.leafKeys.push(...leafKeys); t.holders.push(holder)
  }
  for (const line of lines) {
    add(line.targetKey, line.label, line.curH, line.children.map(c => c.key), line)
    for (const c of line.children) if (!c.leafOfMain) add(c.targetKey, `${c.label} (${line.label})`, c.curH, [c.key], c)
  }
  for (const [key, t] of byTarget) {
    const ev = evalTarget(key, t.label, t.curH, t.leafKeys)
    for (const h of t.holders) h.targetEval = ev
  }

  // الترتيب: الأثر السلبي أولًا بالفرق بالريال، ثم بقية التغيرات بحجم الفرق
  const adverse = notes.filter(n => n.adverse).sort((a, b) => (b.impactH ?? 0) - (a.impactH ?? 0))
  const others = notes.filter(n => !n.adverse).sort((a, b) => Math.abs(b.impactH ?? 0) - Math.abs(a.impactH ?? 0))

  return {
    sales: { ...salesRow, daily, grossH: cur.salesGrossH }, costs: costsRow, cogs: cogsRow, result: resultRow,
    margin: { cur: marginCur == null ? null : round1(marginCur * 100), ref: marginRef == null ? null : round1(marginRef * 100) },
    lines, notes: [...adverse, ...others], adverseCount: adverse.length, targetRows, refValid, refText,
    // كل المبالغ (البنود والمبيعات) كما في المرجع بالهللة: وحدها تسمح بعبارة «لا تغيّر»
    allSame: refValid && salesRow.diffH === 0 && lines.every(l => l.diffH === 0 && l.children.every(c => c.diffH === 0)),
    limits: limitsOf(cur, ref, opts),
  }
}

function lineFlags(line, leaf) {
  const f = []
  if (line.uncategorized) f.push('غير مصنف: لا يُوزَّع على بند بالتخمين.')
  if (leaf.noSub) f.push('جزء من البند بلا تصنيف فرعي.')
  if (line.unlinked) f.push('غير مربوط بتصنيف ثابت: مجمّع بالاسم المحفوظ في قيود سابقة، وقد يكون جزءًا من تصنيف آخر بالاسم نفسه (مراجعة مجموعات التصنيف مفتوحة).')
  if (line.settlement) f.push('سداد أرصدة موردين لم تدخل فواتيرها الدفتر قط (رصيد افتتاحي أو فواتير قبل تسجيل الآجل في الدفتر): يُحتسب عند السداد بإجماليه وبلا تصنيف. سداد الفواتير المسجلة يخفض الالتزام ولا يظهر هنا.')
  if (line.cls === 'fixed' || /ثابت/.test(line.label)) f.push('تكلفة دورية: المسجَّل هو الدفعات بتواريخها، ولا توزيع على الأشهر؛ دفعة واحدة كبيرة قد تشوّه المقارنة الشهرية.')
  if (line.cls === 'cogs') f.push('مشتريات مواد، لا تكلفة استهلاك: لا بيانات مخزون أول وآخر الفترة.')
  return f
}

function ratioUpExplain(diffH, salesDiffH, leaf, salesRow) {
  const share = `النسبة ${fmtPct(leaf.curPct)} مقابل ${fmtPct(leaf.refPct)} (${leaf.pp > 0 ? '+' : ''}${leaf.pp} نقطة مئوية).`
  if (diffH === 0) return `${share} المبلغ لم يتغيّر (${money(leaf.curH)})؛ ارتفعت النسبة لأن صافي المبيعات انخفض من ${money(salesRow.refH)} إلى ${money(salesRow.curH)}.`
  if (diffH > 0 && salesDiffH < 0) return `${share} زاد المبلغ ${money(diffH)} وانخفضت المبيعات ${money(-salesDiffH)}.`
  if (diffH > 0) return `${share} زاد المبلغ ${money(diffH)}${leaf.rel != null ? ` (${fmtPct(leaf.rel * 100)})` : ''} أسرع من المبيعات.`
  return `${share} انخفض المبلغ ${money(-diffH)} لكن المبيعات انخفضت بنسبة أكبر.`
}

function limitsOf(cur, ref, { noBranchRows, pendingDocs, branch } = {}) {
  const nbIn = (noBranchRows || []).filter(e => inWindow(e, cur.window))
  const noBranch = { n: nbIn.length, h: nbIn.reduce((s, e) => s + toH(e.total_amount), 0) }
  const L = []
  L.push({ key: 'recorded', text: 'الأرقام حسب البيانات المسجلة حتى آخر تحديث؛ لا يوجد إقفال شهري يؤكد اكتمال تسجيل الفترة.' })
  if (cur.salesNetH <= 0 && cur.n > 0) L.push({ key: 'nosales', tone: 'warning', text: `صافي المبيعات المسجل ${money(cur.salesNetH)}: لا يمكن احتساب نسبة مناسبة إلى المبيعات؛ تُعرض المبالغ وحدها.` })
  if (cur.window.partial) L.push({ key: 'partial', text: 'الفترة الحالية لم تنته بعد، وقد لا تكون قيود اليوم مسجلة.' })
  const unc = Object.entries(cur.uncounted)
  if (unc.length) L.push({ key: 'status', tone: 'warning', text: `قيود غير محتسبة لأنها غير معتمدة: ${unc.map(([k, v]) => `${v.n} ${STATUS_LABEL[k] || 'بلا حالة'} بمبلغ ${money(v.h)}`).join('، ')}. القاعدة نفسها في لوحة التحكم والتقارير والتصدير.` })
  if (pendingDocs) L.push({ key: 'docs', tone: 'warning', text: `${pendingDocs} مستند بانتظار المراجعة والاعتماد لا يدخل الأرقام حتى يُعتمد.` })
  if (cur.uncategorizedH) L.push({ key: 'uncat', tone: 'warning', text: `مبالغ غير مصنفة في الفترة: ${money(cur.uncategorizedH)}. تظهر بندًا مستقلًا ولا توزَّع على بنود أخرى.` })
  if (branch && branch !== 'all' && noBranch?.n) L.push({ key: 'nobranch', tone: 'warning', text: `${noBranch.n} قيد بلا فرع بمبلغ ${money(noBranch.h)} في الفترة (${cur.window.from} – ${cur.window.to}) لا يظهر عند اختيار فرع (مثل الإيجار والرواتب إن سُجّلت بلا فرع). نسب الفرع لا تشمله.` })
  if (cur.settlementH) L.push({ key: 'settle', text: `سداد أرصدة موردين لم تدخل فواتيرها الدفتر ${money(cur.settlementH)}: يُحتسب تكلفةً عند السداد بإجماليه وبلا تصنيف. سداد الفواتير المسجلة في الدفتر يخفض الالتزام ولا يُحتسب تكلفة ثانية.` })
  if (cur.salesOutflows) L.push({ key: 'returns', tone: 'warning', text: `${cur.salesOutflows} قيد مبيعات فيه مبلغ خارج (مرتجع؟). المحرك لا يطرح الخارج من المبيعات؛ راجعه.` })
  if (cur.debtsH || cur.withdrawalsH) L.push({ key: 'finance', text: `خارج التكاليف: أقساط وقروض ${money(cur.debtsH)} ومسحوبات ${money(cur.withdrawalsH)}. البيانات لا تفصل رسوم التمويل عن أصل القرض.` })
  L.push({ key: 'vat', text: 'صافي المبيعات = المقبوض ÷ 1.15 لكل قيود المبيعات (افتراض المحرك الحالي أن كل المبيعات خاضعة 15%). ضريبة المدخلات المسجلة على الفواتير تُطرح من التكاليف على أنها قابلة للاسترداد.' })
  L.push({ key: 'inventory', text: '«مشتريات المواد» هي مشتريات الفترة لا تكلفة الاستهلاك الفعلي؛ لا بيانات مخزون. لا تُستنتج منها هدر أو فقد.' })
  if (cur.firstDate == null && ref.n === 0) L.push({ key: 'empty', tone: 'warning', text: 'لا قيود محتسبة في الفترة ولا في المقارنة.' })
  const bad = ref.windows.filter(x => !x.valid)
  if (bad.length) L.push({ key: 'ref', tone: ref.n ? undefined : 'warning', text: `${ref.kind === 'baseline' ? 'خط الأساس' : 'فترة المقارنة'}: ${ref.n ? `استُعملت ${ref.n} من ${ref.windows.length}` : 'لا فترة صالحة'}؛ ${bad.map(x => `${x.window.label || x.window.from + ' – ' + x.window.to} مستبعدة (${x.reasonText})`).join('، ')}.` })
  const clipped = ref.windows.filter(x => x.window.clipped > 0)
  if (clipped.length) L.push({ key: 'clip', text: `${clipped.map(x => x.window.label).join('، ')}: أقصر من أيام الفترة الحالية بـ ${clipped.map(x => x.window.clipped).join('، ')} يوم؛ لم تُمدَّد المقارنة إلى شهر آخر.` })
  return L
}

// ── نصوص ─────────────────────────────────────────────────────────────────────
export function money(h) {
  if (h == null) return '—'
  const v = h / 100
  return `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`
}
export function fmtPct(p, d = 1) {
  if (p == null || !Number.isFinite(p)) return 'غير متاح'
  return `${p < 0 ? '−' : ''}${Math.abs(p).toFixed(d)}%`
}

/** قيود بند (ورقة) في نافذة: لعرض «التفاصيل» من الصفوف نفسها التي بُني منها الرقم. */
export function contribsFor(fig, leafKey) {
  return leavesOf(fig).find(l => l.key === leafKey)?.contribs || []
}
