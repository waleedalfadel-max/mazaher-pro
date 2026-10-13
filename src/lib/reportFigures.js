// أرقام صفحة التقارير لكل تبويب — وحدة خالصة يستعملها العرض والتصدير معًا (تُختبر في Node).
// salesFigures وexpenseFigures منقولتان كما هما من src/pages/Reports.jsx (إعادة التصميم ca1092c)، والتغيير الوحيد: تفصيل المصروفات
// يستبعد القيود الضريبية بالشرط نفسه الذي يستبعدها به المحرك من المصروفات (isTaxType)، فتطابق لوحة التحكم؛ وتُعاد في taxEntries.
import { allocateEntry } from './expenseBreakdown.js'
import { isSales, isExcluded, isCOGS, isWithdrawal, isDebt, isTaxType, salesAmountNet, expenseAmountNet, VAT_RATE, isCounted } from './financeRules.js'

export function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

export function salesFigures({ engineSummary, selectedBranch, branches, from, to, prevEntries }) {
  const salesEntries = (engineSummary?.entries || [])
    .filter(e => isSales(e.type))
    .filter(e => selectedBranch === 'all' || !selectedBranch || e.branch === selectedBranch)
  const periodDays   = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1)

  // القسم 1: أداء الفروع
  const branchSalesMap = {}
  salesEntries.forEach(e => {
    const b = e.branch || '— غير محدد'
    if (!branchSalesMap[b]) branchSalesMap[b] = { sales: 0, byDate: {} }
    const amt = salesAmountNet(e)
    branchSalesMap[b].sales += amt
    if (e.date) branchSalesMap[b].byDate[e.date] = (branchSalesMap[b].byDate[e.date] || 0) + amt
  })
  const totalSalesAll = Object.values(branchSalesMap).reduce((s, v) => s + v.sales, 0)
  const branchRows = (branches.length > 1 ? branches : Object.keys(branchSalesMap))
    .filter(b => branchSalesMap[b])
    .map(b => {
      const entries2  = branchSalesMap[b].byDate
      const topDay    = Object.entries(entries2).sort(([,a],[,bb]) => bb - a)[0]
      return { branch: b, sales: branchSalesMap[b].sales, share: totalSalesAll > 0 ? (branchSalesMap[b].sales / totalSalesAll * 100).toFixed(1) : '0.0', daily: branchSalesMap[b].sales / periodDays, topDate: topDay?.[0] || null, topAmt: topDay?.[1] || 0 }
    })

  // القسم 2: التطبيقات لكل فرع
  const appMap = {}
  salesEntries.forEach(e => {
    const b = e.branch || '— غير محدد'
    const t = e.type || ''
    const amt = salesAmountNet(e)
    if (!t.includes('هنقر') && !t.includes('جاهز') && !t.includes('كيتا') && !t.includes('مرسول') && !t.includes('نينجا')) return
    if (!appMap[b]) appMap[b] = { hunger: 0, jahez: 0, keeta: 0, mrsool: 0, ninja: 0 }
    if (t.includes('هنقر')) appMap[b].hunger += amt
    if (t.includes('جاهز')) appMap[b].jahez  += amt
    if (t.includes('كيتا')) appMap[b].keeta  += amt
    if (t.includes('مرسول')) appMap[b].mrsool += amt
    if (t.includes('نينجا')) appMap[b].ninja += amt
  })
  const hasAppSales = Object.values(appMap).some(v => v.hunger + v.jahez + v.keeta + v.mrsool + v.ninja > 0)
  const appBranches = branches.length > 0 ? branches.filter(b => appMap[b]) : Object.keys(appMap)

  // القسم 3: النمو — بناءً على آخر تاريخ فيه مبيعات فعلية
  const actualLastDate  = salesEntries.length > 0
    ? salesEntries.reduce((max, e) => e.date > max ? e.date : max, salesEntries[0].date)
    : to
  const [fy2, fm2, fd2] = from.split('-').map(Number)
  const [ty2, tm2, td2] = actualLastDate.split('-').map(Number)
  const actualPrevFromD = fmtDate(new Date(fy2, fm2 - 2, fd2))
  const actualPrevToD   = fmtDate(new Date(ty2, tm2 - 2, td2))
  const curSales  = salesEntries.reduce((s, e) => s + salesAmountNet(e), 0)
  const prevSales = prevEntries.filter(isCounted)   // القاعدة المركزية للحالات المحتسبة (financeRules)
    .filter(e => isSales(e.type) && e.date >= actualPrevFromD && e.date <= actualPrevToD)
    .reduce((s, e) => s + salesAmountNet(e), 0)
  const growth    = prevSales > 0 ? ((curSales - prevSales) / prevSales * 100) : null

  // القسم 4: المبيعات اليومية
  const dailyMap = {}
  salesEntries.forEach(e => {
    const d = e.date; if (!d) return
    if (!dailyMap[d]) dailyMap[d] = { date: d, cash: 0, bank: 0, apps: 0 }
    // صافية بنفس معالجة بقية الشاشات — وإلا خالف مجموع الجدول بطاقة المبيعات
    dailyMap[d].cash += (Number(e.cash_in)       || 0) / (1 + VAT_RATE)
    dailyMap[d].bank += (Number(e.bank_in)       || 0) / (1 + VAT_RATE)
    dailyMap[d].apps += (Number(e.receivable_in) || 0) / (1 + VAT_RATE)
  })
  const dailyRows    = Object.values(dailyMap).sort((a, b) => b.date.localeCompare(a.date))
  const maxDaySales  = Math.max(...dailyRows.map(r => r.cash + r.bank + r.apps), 1)

  // بطاقات الملخص
  const dailyAvg     = curSales / periodDays
  const bestDayEntry = dailyRows.reduce((best, r) => {
    const t = r.cash + r.bank + r.apps
    return t > (best?.total || 0) ? { date: r.date, total: t } : best
  }, null)
  const activeDays = dailyRows.length

  return { periodDays, branchSalesMap, totalSalesAll, branchRows, appMap, hasAppSales, appBranches, actualLastDate, actualPrevFromD,
    actualPrevToD, curSales, prevSales, growth, dailyRows, maxDaySales, dailyAvg, bestDayEntry, activeDays }
}

export function expenseFigures({ entries: allEntries, docItems, categoriesById, engineSummary, data }) {
  // القيود المحتسبة وحدها (المعتمد والتلقائي)، كالمحرك والتحليل؛ غيرها تعرضه الصفحة منفصلًا
  const entries = (allEntries || []).filter(isCounted)
  const strip = s => (s || '').replace(/^[^؀-ۿ]+/, '').trim()
  // بناء هيكل هرمي: category_main → { total, subs, rows }
  const mainMap = {}

  // التجميع بالاسم بعد تجريد الإيموجي: قيد له بنود يأخذ category_main النظيف، وقيد بلا بنود يأخذ e.type الحامل للإيموجي؛
  // بلا تجريد يصيران مفتاحين مختلفين. نحتفظ بأغنى تسمية (التي تحمل الإيموجي) كما كانت.
  const hasEmoji = s => /[^؀-ۿ\s]/.test(s || '')
  const addItem = (rawMain, rawSub, amount, label, key, cls) => {
    // المرتجع (مبلغ سالب) ينقص تصنيفه؛ الصفر وحده لا يُعرض
    if (!rawMain || rawMain.includes('مبيعات') || !amount) return
    // المعالجة جزء من المفتاح: إن تغيّر رمز التصنيف لاحقًا بقي كل مبلغ في قسمه (مشتريات أو مصروفات) كما اعتُمد
    const rowCls = cls || (isCOGS(rawMain) ? 'cogs' : 'opex')
    const mainKey = (key || strip(rawMain) || rawMain) + '|' + rowCls
    if (!mainMap[mainKey]) mainMap[mainKey] = { total: 0, subs: {}, rows: [], label: rawMain, cls: rowCls }
    if (hasEmoji(rawMain) && !hasEmoji(mainMap[mainKey].label)) mainMap[mainKey].label = rawMain
    mainMap[mainKey].total += amount
    mainMap[mainKey].rows.push({ label: label || rawSub || rawMain, amount })

    const subKey = rawSub ? (strip(rawSub) || rawSub) : '__uncat__'
    if (!mainMap[mainKey].subs[subKey]) mainMap[mainKey].subs[subKey] = { total: 0, rows: [], label: rawSub || '' }
    if (rawSub && hasEmoji(rawSub) && !hasEmoji(mainMap[mainKey].subs[subKey].label)) {
      mainMap[mainKey].subs[subKey].label = rawSub
    }
    mainMap[mainKey].subs[subKey].total += amount
    mainMap[mainKey].subs[subKey].rows.push({ label: label || rawMain, amount })
  }

  // المصروفات الحقيقية فقط (بدون مسحوبات / أقساط / قروض، ولا القيود الضريبية — كما في المحرك)
  const taxEntries = []
  const taxOut = e => (Number(e.cash_out) || 0) + (Number(e.bank_out) || 0) + (Number(e.custody_out) || 0) + (Number(e.receivable_out) || 0) - (Number(e.vat_amount) || 0)
  ;(entries || []).forEach(e => {
    // صافي بعد طرح ضريبة المدخلات — ليتطابق التفصيل مع بطاقة المصروفات
    const out = expenseAmountNet(e)
    if (isExcluded(e.type) || isSales(e.type)) return
    if (isWithdrawal(e.type) || isDebt(e.type)) return
    // القيود الضريبية كما كانت: تُعدّ في الملاحظة متى كان خروجها بعد ضريبتها موجبًا
    if (isTaxType(e.type)) { if (taxOut(e) > 0) taxEntries.push(e); return }
    // الشراء الآجل يدخل بصافيه والمرتجع ينقص (expenseAmountNet)؛ كانا يُسقطان هنا لأن مبلغهما كان سالب الضريبة
    if (!out) return
    // توزيع out على بنود القيد نفسه (src/lib/expenseBreakdown.js): قيد لكل تصنيف في الاعتماد الجديد
    allocateEntry(e, out, docItems, categoriesById).forEach(r => addItem(r.main, r.sub, r.amount, r.label, r.key, r.cls))
  })

  // المسحوبات والالتزامات — للعرض المنفصل
  const sumOut = arr => arr.reduce((s,e)=>s+(e.cash_out||0)+(e.bank_out||0)+(e.custody_out||0),0)
  const withdrawalEntries = (entries||[]).filter(e=>!isExcluded(e.type)&&isWithdrawal(e.type))
  const debtEntries       = (entries||[]).filter(e=>!isExcluded(e.type)&&isDebt(e.type))
  const totalW = sumOut(withdrawalEntries)
  const totalD = sumOut(debtEntries)
  const hasObligations = totalW > 0 || totalD > 0

  const mainRows = Object.entries(mainMap)
    .map(([cat, v]) => ({
      cat, cls: v.cls, label: v.label || cat, total: v.total, rows: v.rows,
      subs: Object.entries(v.subs)
        .map(([s, sv]) => ({
          cat:     s === '__uncat__' ? 'غير مصنف' : s,
          label:   s === '__uncat__' ? 'غير مصنف' : (sv.label || s),
          total:   sv.total,
          rows:    sv.rows,
          isUncat: s === '__uncat__',
        }))
        .sort((a, b) => a.isUncat ? 1 : b.isUncat ? -1 : b.total - a.total),
    }))
    .sort((a, b) => b.total - a.total)

  // تقسيم: تكلفة البضاعة المباعة / المصروفات التشغيلية
  const cogsRows  = mainRows.filter(r => r.cls === 'cogs')
  const opexRows  = mainRows.filter(r => r.cls !== 'cogs')
  const cogsTotal = cogsRows.reduce((s, r) => s + r.total, 0)
  const _sales    = engineSummary?.totalSales || data?.totalSales || 0

  // تكلفة البضاعة حسب الفرعي داخل رئيسيه: فرعيان بالاسم نفسه تحت رئيسيين (مثل «أخرى») صفّان،
  // واسم الرئيسي يظهر تحت الفرعي حين يوجد أكثر من رئيسي في هذا القسم
  const cogsBySubMap = {}
  const multiCogsMains = cogsRows.length > 1
  cogsRows.forEach(mainCat => {
    mainCat.subs.forEach(sub => {
      const key = `${mainCat.cat}|${sub.isUncat ? '__uncat__' : sub.cat}`
      if (!cogsBySubMap[key]) cogsBySubMap[key] = { cat: key, label: sub.label, total: 0, rows: [], isUncat: sub.isUncat,
        mainLabel: multiCogsMains ? String(mainCat.label || '').replace(/^[^؀-ۿA-Za-z]+/, '') : '' }
      cogsBySubMap[key].total += sub.total
      cogsBySubMap[key].rows.push(...sub.rows)
    })
  })
  const cogsBySubRows = Object.values(cogsBySubMap)
    .sort((a, b) => a.isUncat ? 1 : b.isUncat ? -1 : b.total - a.total)
  const cogsPct = _sales > 0 ? (cogsTotal / _sales * 100).toFixed(1) : 0

  const groupByType = arr => {
    const map = {}
    arr.forEach(e => {
      const key = e.type || '— غير محدد'
      const out = (e.cash_out||0)+(e.bank_out||0)+(e.custody_out||0)
      if (!out) return
      map[key] = (map[key]||0) + out
    })
    return Object.entries(map).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).map(([type,total])=>({type,total}))
  }

  return { mainRows, cogsRows, opexRows, cogsTotal, cogsPct, cogsBySubRows, _sales, totalW, totalD, hasObligations, taxEntries,
    wGroups: groupByType(withdrawalEntries), dGroups: groupByType(debtEntries) }
}

