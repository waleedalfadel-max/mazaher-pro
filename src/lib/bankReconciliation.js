// دوال خالصة لمنطق المطابقة البنكية — بدون أي تبعية على React أو Supabase مباشرة

export const normCat = s => (s || '').replace(/[^؀-ۿ\s]/g, '').replace(/\s+/g, ' ').trim()

function daysBetween(d1, d2) {
  const t1 = new Date(d1 + 'T00:00:00').getTime()
  const t2 = new Date(d2 + 'T00:00:00').getTime()
  return Math.abs(t1 - t2) / 86400000
}

// مطابقة مثلى (وليست جشعة بترتيب المسح): تبني كل الأزواج المرشّحة (سطر كشف × قيد دفتر)
// اللي تحقق شرط التاريخ±dayWindow والمبلغ±tolerance، ترتّبها حسب دقة التطابق تصاعدياً،
// ثم تستهلكها بالترتيب — يمنع تطابق حركة غلط لو فيه حركتين متقاربتين بنفس الفترة.
export function matchLinesToLedger(bankLines, ledgerEntries, { tolerance = 1, dayWindow = 1 } = {}) {
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

  return {
    matchedCount,
    unmatchedLines:   candidateLines.filter(l => !usedLines.has(l._idx)),   // غير مسجل بتحسيب
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
