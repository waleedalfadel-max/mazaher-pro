// دوال خالصة لمنطق المطابقة البنكية — بدون أي تبعية على React أو Supabase مباشرة

export const normCat = s => (s || '').replace(/[^؀-ۿ\s]/g, '').replace(/\s+/g, ' ').trim()

function daysBetween(d1, d2) {
  const t1 = new Date(d1 + 'T00:00:00').getTime()
  const t2 = new Date(d2 + 'T00:00:00').getTime()
  return Math.abs(t1 - t2) / 86400000
}

// كل تركيبات بحجم size من مصفوفة arr (بدون تكرار عناصر، ترتيب غير مهم)
function combinationsOfSize(arr, size) {
  const results = []
  function helper(start, combo) {
    if (combo.length === size) { results.push(combo.slice()); return }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i])
      helper(i + 1, combo)
      combo.pop()
    }
  }
  helper(0, [])
  return results
}

// يبحث عن أفضل تركيبة من candidates (حجم من 2 إلى maxParts) يقترب مجموعها من targetAmt
// بفارق ≤ tolerance — يُفضَّل الفارق الأصغر، وعند التعادل يُفضَّل التركيبة الأقل عناصر
function findBestCombination(candidates, targetAmt, maxParts, tolerance) {
  let best = null
  let bestDiff = Infinity
  for (let size = 2; size <= Math.min(maxParts, candidates.length); size++) {
    for (const combo of combinationsOfSize(candidates, size)) {
      const sum  = combo.reduce((s, l) => s + (Number(l.amount) || 0), 0)
      const diff = Math.abs(sum - targetAmt)
      if (diff <= tolerance && diff < bestDiff) {
        best = combo
        bestDiff = diff
        if (diff === 0) return best
      }
    }
  }
  return best
}

// مطابقة مثلى (وليست جشعة بترتيب المسح): تبني كل الأزواج المرشّحة (سطر كشف × قيد دفتر)
// اللي تحقق شرط التاريخ±dayWindow والمبلغ±tolerance، ترتّبها حسب دقة التطابق تصاعدياً،
// ثم تستهلكها بالترتيب — يمنع تطابق حركة غلط لو فيه حركتين متقاربتين بنفس الفترة.
//
// مرحلة ثانية (aggregate): لبعض القيود المسجَّلة بتحسيب كمبلغ صافٍ واحد (مثل راتب)
// بينما البنك يسجّلها كحركتين أو ثلاث منفصلة بنفس الفترة (مثل تحويل + رسومه) —
// تُجرَّب فقط على القيود المتبقية بعد المطابقة الفردية، وضمن نافذة ±aggregateDayWindow
// من تاريخ كل قيد على حدة (وليس على مستوى الكشف كامل) لتفادي أي بطء.
export function matchLinesToLedger(bankLines, ledgerEntries, {
  tolerance = 1, dayWindow = 1, aggregateDayWindow = 2, aggregateMaxParts = 3,
} = {}) {
  // مبيعات الشبكة تُطابق على مستوى الفترة كاملة في computeNetworkAggregate — تُستبعد هنا
  const candidateLines = bankLines
    .map((line, i) => ({ ...line, _idx: i }))
    .filter(l => l.bank_category !== 'pos_credit')

  const candidateEntries = ledgerEntries
    .map((e, i) => ({ ...e, _idx: i }))
    .filter(e => !(e.type || '').includes('مبيعات شبكة') && ((Number(e.bank_in) || 0) > 0 || (Number(e.bank_out) || 0) > 0))

  const pairs = []
  for (const line of candidateLines) {
    const lineAmt = Number(line.amount) || 0
    for (const entry of candidateEntries) {
      const entryAmt = line.direction === 'in' ? (Number(entry.bank_in) || 0) : (Number(entry.bank_out) || 0)
      if (entryAmt === 0) continue
      const dDiff = daysBetween(line.date, entry.date)
      const aDiff = Math.abs(lineAmt - entryAmt)
      if (dDiff <= dayWindow && aDiff < tolerance) {
        pairs.push({ line, entry, score: dDiff + aDiff })
      }
    }
  }

  pairs.sort((a, b) => a.score - b.score)

  const usedLines   = new Set()
  const usedEntries = new Set()
  let matchedCount   = 0

  for (const pair of pairs) {
    if (usedLines.has(pair.line._idx) || usedEntries.has(pair.entry._idx)) continue
    usedLines.add(pair.line._idx)
    usedEntries.add(pair.entry._idx)
    matchedCount++
  }

  // ── مرحلة المطابقة المركّبة — فقط على ما تبقّى بدون تطابق ──
  const matchedEntries = []
  const stillUnmatchedEntries = candidateEntries.filter(e => !usedEntries.has(e._idx))

  for (const entry of stillUnmatchedEntries) {
    const bankInAmt  = Number(entry.bank_in)  || 0
    const bankOutAmt = Number(entry.bank_out) || 0
    const entryAmt = bankInAmt > 0 ? bankInAmt : bankOutAmt
    const entryDir = bankInAmt > 0 ? 'in' : 'out'
    if (entryAmt <= 0) continue

    const localCandidates = candidateLines.filter(l =>
      !usedLines.has(l._idx) &&
      l.direction === entryDir &&
      daysBetween(l.date, entry.date) <= aggregateDayWindow
    )
    if (localCandidates.length < 2) continue

    const combo = findBestCombination(localCandidates, entryAmt, aggregateMaxParts, tolerance)
    if (!combo) continue

    combo.forEach(l => usedLines.add(l._idx))
    usedEntries.add(entry._idx)
    matchedCount++
    matchedEntries.push({ ...entry, matchType: 'aggregate', matchedLines: combo })
  }

  return {
    matchedCount,
    matchedEntries,                                                          // قيود طابقت بشكل مركّب (لعرض لاحق عند الحاجة)
    unmatchedLines:   candidateLines.filter(l => !usedLines.has(l._idx)),     // غير مسجل بتحسيب
    unmatchedEntries: candidateEntries.filter(e => !usedEntries.has(e._idx)), // موجود بتحسيب لكن غير موجود بالبنك
  }
}

// فرق مبيعات الشبكة على مستوى الفترة كاملة — النسبة% تُحسب من إجمالي النظام (تحسيب)
export function computeNetworkAggregate(bankLines, ledgerEntries, { marginPct = 0.03 } = {}) {
  const bankTotal = bankLines
    .filter(l => l.bank_category === 'pos_credit')
    .reduce((s, l) => s + (Number(l.amount) || 0), 0)

  const systemTotal = ledgerEntries
    .filter(e => (e.type || '').includes('مبيعات شبكة'))
    .reduce((s, e) => s + (Number(e.bank_in) || 0), 0)

  const diff = bankTotal - systemTotal
  const hasIssue = systemTotal === 0 ? bankTotal !== 0 : (Math.abs(diff) / systemTotal >= marginPct)

  return { bankTotal, systemTotal, diff, hasIssue }
}

// يبني صف ledger_entries جاهز للإدراج من حركة كشف بنك مُعتمدة من المحاسب
export function buildLedgerInsertRow(line, { transType, categorySub, projectId, journalNumber, fileUrl, branch = null }) {
  const amount = Number(line.amount) || 0
  const isIn   = line.direction === 'in'
  return {
    project_id: projectId,
    date: line.date,
    type: transType,
    description: line.description || '',
    cash_in: 0, cash_out: 0,
    bank_in:  isIn ? amount : 0,
    bank_out: !isIn ? amount : 0,
    custody_in: 0, custody_out: 0,
    receivable_in: 0, receivable_out: 0,
    vat_amount: 0,
    total_amount: amount,
    status: 'approved',
    journal_number: journalNumber,
    file_url: fileUrl || '',
    branch,
    category_main: normCat(transType) || null,
    category_sub: categorySub || null,
  }
}
