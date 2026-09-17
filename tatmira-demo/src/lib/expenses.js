/**
 * مجموعات وتصنيفات المصروفات، وتقرير المصروفات.
 *
 * - كل تصنيف ينتمي لمجموعة، والمجموعة تحدد النوع: مواد مباشرة أو مصروفات تشغيلية.
 * - بند المصروف المعتمد يحمل لقطة ثابتة: التصنيف والمجموعة والنوع كما كانت وقت الاعتماد.
 *   التقرير يجمّع على اللقطة، فنقل تصنيف لمجموعة أخرى أو تغيير نوع مجموعة لا يعيد تصنيف الماضي.
 *   الأسماء المعروضة هي الحالية إن وُجدت (إعادة التسمية لا تغيّر الانتماء).
 * - المصدر الوحيد للأرقام: المستندات المعتمدة. لوحة المالك تقرأ إجماليات هذا التقرير نفسه.
 */

export const EXPENSE_KIND = { direct: 'مواد مباشرة', operating: 'مصروفات تشغيلية' }

export const DEFAULT_GROUPS = [
  { id: 'grp-direct',      name: 'المواد المباشرة',   kind: 'direct' },
  { id: 'grp-rent',        name: 'الإيجارات',         kind: 'operating' },
  { id: 'grp-salary',      name: 'الرواتب والأجور',   kind: 'operating' },
  { id: 'grp-utilities',   name: 'الكهرباء والمياه',  kind: 'operating' },
  { id: 'grp-maintenance', name: 'الصيانة',           kind: 'operating' },
  { id: 'grp-transport',   name: 'النقل والتوصيل',    kind: 'operating' },
  { id: 'grp-other',       name: 'مصروفات أخرى',      kind: 'operating' },
]

export const DEFAULT_CATEGORIES = [
  { id: 'cat-dates',        name: 'تمور',              groupId: 'grp-direct' },
  { id: 'cat-flour',        name: 'دقيق وسميد',        groupId: 'grp-direct' },
  { id: 'cat-butter',       name: 'سمن وزبدة',         groupId: 'grp-direct' },
  { id: 'cat-pack',         name: 'مواد تغليف',        groupId: 'grp-direct' },
  { id: 'cat-rent',         name: 'إيجار المعمل',      groupId: 'grp-rent' },
  { id: 'cat-rent-housing', name: 'إيجار سكن العمال',  groupId: 'grp-rent' },
  { id: 'cat-salary',       name: 'رواتب',             groupId: 'grp-salary' },
  { id: 'cat-wages',        name: 'أجور يومية',        groupId: 'grp-salary' },
  { id: 'cat-power',        name: 'كهرباء وماء',       groupId: 'grp-utilities' },
  { id: 'cat-maint',        name: 'صيانة المعدات',     groupId: 'grp-maintenance' },
  { id: 'cat-deliver',      name: 'نقل وتوصيل',        groupId: 'grp-transport' },
  { id: 'cat-misc',         name: 'مصروفات متنوعة',    groupId: 'grp-other' },
]

// تصنيفات الإصدار السابق ومجموعاتها عند الترقية
export const LEGACY_CATEGORY_GROUP = {
  'cat-dates': 'grp-direct', 'cat-flour': 'grp-direct', 'cat-butter': 'grp-direct', 'cat-pack': 'grp-direct',
  'cat-rent': 'grp-rent', 'cat-salary': 'grp-salary', 'cat-power': 'grp-utilities', 'cat-deliver': 'grp-transport',
}

export function defaultGroups() {
  return DEFAULT_GROUPS.map(g => ({ ...g, archived: false }))
}

export function defaultCategories() {
  return DEFAULT_CATEGORIES.map(c => ({ ...c, archived: false }))
}

export function findGroup(state, id) {
  return (state.expenseGroups || []).find(g => g.id === id)
}

/** مجموعة التصنيف ونوعه حسب الإعدادات الحالية (للإدخال فقط — التقارير تقرأ اللقطة) */
export function categoryInfo(state, categoryId) {
  const category = state.categories.find(c => c.id === categoryId)
  const group = category ? findGroup(state, category.groupId) : null
  return { category, group, kind: group?.kind }
}

/** التصنيفات القابلة للاختيار مجمّعة حسب المجموعة (المؤرشف مستبعد إلا المختار حالياً) */
export function selectableCategories(state, currentId) {
  return (state.expenseGroups || [])
    .map(group => ({
      group,
      categories: state.categories.filter(c => c.groupId === group.id && ((!c.archived && !group.archived) || c.id === currentId)),
    }))
    .filter(x => x.categories.length)
}

/**
 * تقرير المصروفات لفترة. يعيد أقساماً (مباشرة ثم تشغيلية) ← مجموعات ← تصنيفات ← حركات.
 * المنشأة التي لا تفصل الضريبة ترى إجمالي فاتورة المورد ضمن التكلفة، والمنشأة المفعّل عندها
 * إعداد الضريبة ترى الصافي تكلفةً والضريبة منفصلة. القرار محفوظ داخل البند وقت الاعتماد.
 */
export function expenseReport(state, { from = '', to = '' } = {}) {
  const inRange = d => (!from || d >= from) && (!to || d <= to)
  const groupOrder = new Map((state.expenseGroups || []).map((g, i) => [g.id, i]))
  const groups = new Map()

  for (const p of state.purchases.filter(p => inRange(p.date))) {
    p.lines.forEach((line, lineIndex) => {
      const amount = line.expenseAmount ?? line.net
      const separatedVat = line.separatedVat ?? line.vat
      const kind = line.categoryKind
      const gKey = `${kind}|${line.groupId}`
      if (!groups.has(gKey)) {
        groups.set(gKey, {
          key: gKey, groupId: line.groupId, kind,
          name: findGroup(state, line.groupId)?.name || line.groupName || 'بدون مجموعة',
          total: 0, vat: 0, categories: new Map(),
        })
      }
      const g = groups.get(gKey)
      if (!g.categories.has(line.categoryId)) {
        g.categories.set(line.categoryId, {
          key: `${gKey}|${line.categoryId}`, categoryId: line.categoryId,
          name: state.categories.find(c => c.id === line.categoryId)?.name || line.categoryName,
          total: 0, vat: 0, movements: [],
        })
      }
      const c = g.categories.get(line.categoryId)
      c.movements.push({
        key: `${p.id}|${lineIndex}`, date: p.date, docId: p.docId, purchaseId: p.id,
        payee: p.payee || '', number: p.number || '', desc: line.desc,
        amount, net: line.net, documentVat: line.vat, separatedVat,
        categoryName: line.categoryName, groupName: line.groupName,
      })
      c.total += amount; c.vat += separatedVat
      g.total += amount; g.vat += separatedVat
    })
  }

  const finalize = kind => [...groups.values()]
    .filter(g => g.kind === kind)
    .map(g => ({
      ...g,
      categories: [...g.categories.values()]
        .map(c => ({ ...c, movements: c.movements.sort((a, b) => b.date.localeCompare(a.date)) }))
        .sort((a, b) => b.total - a.total),
    }))
    .sort((a, b) => (groupOrder.get(a.groupId) ?? 999) - (groupOrder.get(b.groupId) ?? 999))

  const direct = finalize('direct')
  const operating = finalize('operating')
  const sum = list => list.reduce((s, g) => s + g.total, 0)
  const vatSum = list => list.reduce((s, g) => s + g.vat, 0)
  return {
    direct: { groups: direct, total: sum(direct), vat: vatSum(direct) },
    operating: { groups: operating, total: sum(operating), vat: vatSum(operating) },
    total: sum(direct) + sum(operating),
    vat: vatSum(direct) + vatSum(operating),
  }
}
