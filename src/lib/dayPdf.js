// ملف PDF ليوم من «أرشيف الحركات»، مقسّمًا إلى صفحات A4. كان التصدير يرسم اليوم صورة واحدة في صفحة واحدة، فيوم بحركات كثيرة
// يُقص (نحو 13 حركة في الصفحة) وتضيع بقية الحركات والإجمالي. هنا: صفحات بحجم A4 تُبنى في المتصفح، كل حركة (صفّاها: «من ح/» و«إلى ح/»)
// تُوضع كاملة في صفحة واحدة ولا تُقسم ولا تتكرر، ورأس الجدول يتكرر في كل صفحة، والإجمالي والملخص في آخر صفحة يتسعان لهما (أو
// صفحة جديدة)، ورقم الصفحة «صفحة X من N». الحسابات كما كانت حرفيًا (المدين والدائن يشملان الذمم، والميزان، ومبلغ كل حركة وطرفاها من
// getEntryAccounts في الصفحة). التصوير صفحة صفحة بالدالة نفسها المستعملة في تقارير PDF (capturePage: تتحقق من حبر الترويسة).
import { capturePage, downloadBlob } from './reportPdf.js'

const PAGE_W = 794, PAGE_H = 1123   // A4 بدقة 96 نقطة في البوصة
const NAVY = '#1B3A5C'
const GOLD = '#6EB7B0'
const CSS = `
.dpdf-root { position: fixed; left: -12000px; top: 0; z-index: -1; }
.dpdf-page { width: ${PAGE_W}px; height: ${PAGE_H}px; box-sizing: border-box; padding: 38px 36px 26px; background: #fff; color: #1e293b; direction: rtl;
  font-family: 'IBM Plex Sans Arabic', Cairo, Arial, sans-serif; display: flex; flex-direction: column; margin-bottom: 16px; letter-spacing: 0; }
.dpdf-head { border-bottom: 4px solid ${GOLD}; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-end; }
.dpdf-brand { font-size: 22px; font-weight: 700; color: ${NAVY}; line-height: 1.3; }
.dpdf-kind { font-size: 13px; color: #6b7280; margin-top: 2px; }
.dpdf-ref { text-align: left; }
.dpdf-jn { font-size: 14px; font-weight: 700; color: ${GOLD}; }
.dpdf-meta { font-size: 12px; color: #6b7280; margin-top: 2px; }
.dpdf-printed { font-size: 11px; color: #9ca3af; }
.dpdf-body { flex: 1; overflow: hidden; }
.dpdf-cont { font-size: 11px; color: #6b7280; margin: -6px 0 8px; }
.dpdf-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 16px; }
.dpdf-table thead tr { background: ${NAVY}; }
.dpdf-table th { padding: 2px 10px 14px; text-align: right; color: #fff; font-weight: 700; line-height: 1.5; vertical-align: top; }   /* النص في الصورة ينزل عن موضعه في المتصفح؛ التعويض بالمسافات */
.dpdf-table th.d { color: #86efac; } .dpdf-table th.c { color: #fca5a5; } .dpdf-table th.f { color: ${GOLD}; text-align: center; }
.dpdf-table th.n { width: 26px; }
.dpdf-table td { padding: 2px 10px; vertical-align: top; }
.dpdf-table tbody tr.dr td { padding-top: 6px; }
.dpdf-table tbody tr.cr td { padding-bottom: 8px; border-bottom: 3px solid #f5f4f0; }
.dpdf-table td.n { color: #9ca3af; font-size: 10px; vertical-align: middle; text-align: center; }
.dpdf-from { font-weight: 700; color: ${NAVY}; }
.dpdf-to { padding-right: 18px; color: #6b7280; font-style: italic; }
.dpdf-desc { display: block; font-size: 10px; color: #9ca3af; margin-top: 2px; font-style: normal; overflow-wrap: anywhere; }
.dpdf-amt { text-align: right; font-weight: 700; font-family: monospace; white-space: nowrap; }
.dpdf-amt.d { color: #16a34a; } .dpdf-amt.c { color: #dc2626; }
.dpdf-nil { text-align: right; color: #d1d5db; }
.dpdf-file { text-align: center; vertical-align: middle; color: #6b7280; font-size: 10px; }
.dpdf-table tfoot tr { background: ${NAVY}; }
.dpdf-table tfoot td { padding: 3px 10px 15px; font-weight: 700; color: #fff; font-size: 11px; line-height: 1.5; vertical-align: top; }
.dpdf-table tfoot td.d { color: #86efac; font-family: monospace; text-align: right; } .dpdf-table tfoot td.c { color: #fca5a5; font-family: monospace; text-align: right; }
.dpdf-sum { display: flex; gap: 10px; margin-bottom: 8px; }
.dpdf-sum > div { flex: 1; border-radius: 10px; padding: 12px; text-align: center; }
.dpdf-sum span { display: block; font-size: 10px; color: #6b7280; margin-bottom: 4px; }
.dpdf-sum strong { display: block; font-size: 16px; font-weight: 700; font-family: monospace; }
.dpdf-sum strong small { font-family: 'IBM Plex Sans Arabic', sans-serif; font-size: 12px; font-weight: 600; margin-right: 4px; }
.dpdf-foot { display: flex; justify-content: space-between; border-top: 2px solid ${GOLD}; padding-top: 6px; color: #6b7280; font-size: 10px; }
.dpdf-n { direction: ltr; unicode-bidi: isolate; }
`

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e }
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n = s => `<span class="dpdf-n">${esc(s)}</span>`

/**
 * يبني صفحات اليوم في عنصر مخفي ويعيده (للرسم وللاختبار).
 * group: { date, journalNumber, rows }؛ fmt: تنسيق المبالغ كما في الصفحة؛ accountsOf: getEntryAccounts.
 */
export function buildDayPages(group, fmt, accountsOf, { printedDate, printedAt } = {}) {
  if (!document.getElementById('dpdf-css')) { const st = el('style'); st.id = 'dpdf-css'; st.textContent = CSS; document.head.appendChild(st) }
  const { rows, date, journalNumber, cashSummary = false } = group
  // الحسابات كما كانت في exportGroupPdf
  const totalDebit  = rows.reduce((s,r) => s+(r.cash_in||0)+(r.bank_in||0)+(r.custody_in||0)+(cashSummary ? 0 : (r.receivable_in||0)), 0)
  const totalCredit = rows.reduce((s,r) => s+(r.cash_out||0)+(r.bank_out||0)+(r.custody_out||0)+(cashSummary ? 0 : (r.receivable_out||0)), 0)
  const balance     = totalDebit - totalCredit
  const printed = printedDate || new Date().toLocaleDateString('en-GB')
  const stamp = printedAt || new Date().toLocaleString('en-US')

  const root = el('div', 'dpdf-root'); root.setAttribute('data-dpdf', date); document.body.appendChild(root)
  let body, table, tbodyHost
  const head = `<tr><th class="n">#</th><th>البيان</th><th class="d">مدين</th><th class="c">دائن</th><th class="f">مستند</th></tr>`
  const newPage = () => {
    const page = el('div', 'dpdf-page')
    page.appendChild(el('div', 'dpdf-head', `<div><div class="dpdf-brand">تحسيب</div><div class="dpdf-kind">حركة مالية يومية</div></div>`
      + `<div class="dpdf-ref"><div class="dpdf-jn">${n(journalNumber || date)}</div><div class="dpdf-meta">التاريخ: ${n(date)}</div><div class="dpdf-printed">طُبع: ${n(printed)}</div></div>`))
    body = el('div', 'dpdf-body'); page.appendChild(body)
    page.appendChild(el('div', 'dpdf-foot', `<span>تحسيب — ${n(stamp)}</span><span class="dpdf-pn"></span>`))
    root.appendChild(page)
  }
  const fits = () => body.scrollHeight <= body.clientHeight
  // جدول جديد في الصفحة الحالية برأسه (وعبارة «تابع» إن لم تكن الصفحة الأولى)
  const startTable = cont => {
    if (cont) body.appendChild(el('div', 'dpdf-cont', `تابع حركات يوم ${n(date)}`))
    table = el('table', 'dpdf-table', `<thead>${head}</thead>`); body.appendChild(table); tbodyHost = table
  }
  // يضيف عنصرًا إلى الجدول؛ إن لم يتسع ينقله كاملًا إلى صفحة جديدة بجدول جديد برأسه
  const placeInTable = node => {
    tbodyHost.appendChild(node)
    if (!fits() && tbodyHost.querySelectorAll('tbody, tfoot').length > 1) { node.remove(); newPage(); startTable(true); tbodyHost.appendChild(node) }
  }

  newPage()
  const creditPurchases = rows.filter(r => r._creditRows).reduce((n,r) => n + Math.round(r.payable_in * 100), 0) / 100
  if (creditPurchases > 0) body.appendChild(el('div', 'dpdf-cont', `مشتريات آجلة: ${n(fmt(creditPurchases))} — على الموردين، دون خروج نقدي. الشراء الآجل لا يدخل في إجماليات حركة النقد أدناه.`))
  startTable(false)
  rows.forEach((r, i) => {
    const { amount, debitAccount, creditAccount } = accountsOf(r)
    const desc = r.description && r.description !== r.type ? r.description : ''
    const tb = el('tbody', '', `<tr class="dr"><td class="n" rowspan="2">${i + 1}</td><td class="dpdf-from">من ح/ ${esc(debitAccount)}</td>`
      + `<td class="dpdf-amt d">${n(fmt(amount))}</td><td class="dpdf-nil">—</td>`
      + `<td class="dpdf-file" rowspan="2">${r.file_url ? '📎 مستند (اُنظر التطبيق)' : '—'}</td></tr>`
      + `<tr class="cr"><td class="dpdf-to">إلى ح/ ${esc(creditAccount)}${desc ? `<span class="dpdf-desc">${esc(desc)}</span>` : ''}</td>`
      + `<td class="dpdf-nil">—</td><td class="dpdf-amt c">${n(fmt(amount))}</td></tr>`)
    tb.setAttribute('data-i', String(i + 1)); tb.setAttribute('data-id', r.id || '')
    placeInTable(tb)
  })
  const tf = el('tfoot', '', `<tr><td colspan="2">${cashSummary ? 'حركة النقد فقط' : 'الإجمالي'} (${rows.length} حركة)</td><td class="d">${n(fmt(totalDebit))}</td><td class="c">${n(fmt(totalCredit))}</td><td></td></tr>`)
  tf.setAttribute('data-total', '1'); placeInTable(tf)

  const sum = el('div', 'dpdf-sum',
    `<div style="background:#f0fdf4;border:1px solid #bbf7d0"><span>${cashSummary ? 'الوارد النقدي' : 'إجمالي المدين'}</span><strong style="color:#16a34a">${n(fmt(totalDebit))}</strong></div>`
    + `<div style="background:#fef2f2;border:1px solid #fecaca"><span>${cashSummary ? 'الصادر النقدي' : 'إجمالي الدائن'}</span><strong style="color:#dc2626">${n(fmt(totalCredit))}</strong></div>`
    + `<div style="background:${balance>=0?'#eff6ff':'#fef2f2'};border:1px solid ${balance>=0?'#bfdbfe':'#fecaca'}"><span>${cashSummary ? 'صافي الحركة النقدية' : 'الميزان'}</span><strong style="color:${balance>=0?'#1d4ed8':'#dc2626'}">${n(fmt(Math.abs(balance)))} <small>${balance>=0?'(مدين)':balance<0?'(دائن)':''}</small></strong></div>`)
  sum.setAttribute('data-summary', '1')
  body.appendChild(sum)
  if (!fits()) { sum.remove(); newPage(); body.appendChild(sum) }

  const pages = [...root.querySelectorAll('.dpdf-page')]
  pages.forEach((p, i) => { p.querySelector('.dpdf-pn').textContent = `صفحة ${i + 1} من ${pages.length}` })
  return root
}

/** ملف PDF (Blob) لليوم. keep: يُبقي الصفحات في المستند بعد الرسم (للاختبار). */
export async function dayToPdf(group, fmt, accountsOf, { keep = false } = {}) {
  const [jspdf, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')])
  const jsPDF = jspdf.jsPDF || jspdf.default
  await document.fonts?.ready
  const root = buildDayPages(group, fmt, accountsOf)
  try {
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true })
    pdf.setProperties({ title: `قيد ${group.journalNumber || group.date}`, creator: 'تحسيب المطاعم' })
    const pages = [...root.querySelectorAll('.dpdf-page')]
    for (let i = 0; i < pages.length; i++) {
      const canvas = await capturePage(html2canvas, pages, i)
      if (i > 0) pdf.addPage()
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, 210, 297, undefined, 'FAST')
    }
    pages.forEach(p => { p.style.display = '' })
    return pdf.output('blob')
  } finally {
    if (!keep) root.remove()
  }
}

/** يصدّر اليوم ويحفظه باسم الملف السابق نفسه. */
export async function exportDayPdf(group, fmt, accountsOf) {
  const blob = await dayToPdf(group, fmt, accountsOf)
  downloadBlob(blob, `قيد-${group.journalNumber || group.date}.pdf`)
}
