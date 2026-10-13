// ملف PDF للقسم المختار من وصفه (reportExport.reportModel): صفحات A4 عربية تُرسم في المتصفح نفسه (فتتشكّل الحروف كما في الشاشة)
// ثم تُحوَّل إلى صور عالية الدقة في ملف PDF. الترقيم بالصفوف: الجدول الطويل يُكمَل في الصفحة التالية برأسه.
import { displayValue, cellType } from './reportExport.js'

const PAGE_W = 794, PAGE_H = 1123   // A4 بدقة 96 نقطة في البوصة
const CSS = `
.rpdf-root { position: fixed; left: -12000px; top: 0; z-index: -1; }
.rpdf-page { width: ${PAGE_W}px; height: ${PAGE_H}px; box-sizing: border-box; padding: 38px 44px 30px; background: #fff; color: #142D3A; direction: rtl;
  font-family: 'IBM Plex Sans Arabic', system-ui, sans-serif; font-size: 12.5px; line-height: 1.55; display: flex; flex-direction: column; margin-bottom: 16px; letter-spacing: 0; }
.rpdf-head { border-bottom: 2px solid #087F8C; padding-bottom: 10px; margin-bottom: 14px; }
.rpdf-brand { display: flex; justify-content: space-between; font-size: 11.5px; color: #4C6168; }
.rpdf-brand b { color: #087F8C; font-weight: 700; }
.rpdf-head h1 { font-size: 20px; font-weight: 700; margin: 4px 0 2px; }
.rpdf-meta { font-size: 12px; color: #3D5560; }
.rpdf-body { flex: 1; overflow: hidden; }
.rpdf-foot { display: flex; justify-content: space-between; border-top: 1px solid #E2E8E7; padding-top: 6px; font-size: 10.5px; color: #4C6168; }
.rpdf-intro { font-size: 11.5px; color: #3D5560; margin: 0 0 12px; }
.rpdf-n { direction: ltr; unicode-bidi: isolate; font-family: 'Manrope Variable', 'IBM Plex Sans Arabic', sans-serif; font-variant-numeric: tabular-nums; white-space: nowrap; }
.rpdf-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
.rpdf-metric { border: 1px solid #E2E8E7; border-radius: 8px; padding: 8px 10px; }
.rpdf-metric span { display: block; font-size: 11px; color: #4C6168; }
.rpdf-metric strong { display: block; font-size: 16px; font-weight: 700; margin: 2px 0; }
.rpdf-metric small { display: block; font-size: 10px; color: #4C6168; line-height: 1.4; }
.rpdf-h2 { font-size: 13.5px; font-weight: 700; margin: 4px 0 6px; }
.rpdf-sub { font-size: 11px; color: #4C6168; margin: -4px 0 6px; }
.rpdf-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 11.5px; }
.rpdf-table th { background: #F1F5F3; color: #3F545B; font-weight: 600; text-align: right; padding: 5px 7px; border-bottom: 1px solid #DCE4E2; }
.rpdf-table td { padding: 4px 7px; border-bottom: 1px solid #EDF1EE; vertical-align: top; }
.rpdf-table .e { text-align: left; }
.rpdf-table tr.f td { font-weight: 700; background: #F6F8F6; border-top: 1px solid #DCE4E2; }
.rpdf-table tr.l0 td:first-child { font-weight: 700; }
.rpdf-table tr.l1 td:first-child { padding-right: 18px; }
.rpdf-table tr.l2 td { color: #3D5560; font-size: 11px; }
.rpdf-table tr.l2 td:first-child { padding-right: 32px; }
.rpdf-table td.w { white-space: normal; min-width: 150px; }
.rpdf-mark { font-size: 10px; color: #1D735B; font-weight: 600; margin-right: 6px; }
.rpdf-calc { margin: 0 0 10px; }
.rpdf-calc div { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #EDF1EE; }
.rpdf-calc div.s { font-weight: 700; }
.rpdf-note { border: 1px solid #D3E7E8; background: #F1F8F8; color: #2F6469; border-radius: 6px; padding: 7px 10px; margin: 0 0 14px; font-size: 11.5px; }
.rpdf-scope div { margin-bottom: 4px; font-size: 11px; color: #3D5560; }
.rpdf-scope b { color: #142D3A; }
`

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e }
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// الأرقام والمبالغ من اليسار داخل النص العربي؛ التاريخ («9 سبتمبر 2026») والتسميات نص عربي عادي
const num = (v, type) => { const t = cellType(v, type); return !t ? '—' : t === 'date' || t === 'text' ? esc(displayValue(v, type)) : `<span class="rpdf-n">${esc(displayValue(v, type))}</span>` }
const cellHtml = (v, type) => (type ? num(v, type) : esc(v ?? '—'))

/** يبني صفحات القسم في عنصر مخفي ويعيده (يُستعمل للرسم وللاختبار). */
export function buildPages(model) {
  if (!document.getElementById('rpdf-css')) { const st = el('style'); st.id = 'rpdf-css'; st.textContent = CSS; document.head.appendChild(st) }
  const root = el('div', 'rpdf-root'); root.setAttribute('data-rpdf', model.tab); document.body.appendChild(root)
  let body
  const newPage = () => {
    const page = el('div', 'rpdf-page')
    page.appendChild(el('div', 'rpdf-head', `<div class="rpdf-brand"><b>تحسيب المطاعم</b><span>${esc(model.org)}</span></div>`
      + `<h1>${esc(model.title)}</h1><div class="rpdf-meta">الفترة: ${esc(model.rangeText)} · الفرع: ${esc(model.branchText)} · استُخرج في ${esc(model.generatedText)}</div>`))
    body = el('div', 'rpdf-body'); page.appendChild(body)
    page.appendChild(el('div', 'rpdf-foot', `<span>للمتابعة الداخلية — يراجعه المحاسب</span><span class="rpdf-pn"></span>`))
    root.appendChild(page)
  }
  const fits = () => body.scrollHeight <= body.clientHeight
  // يضيف عنصرًا كاملًا؛ إن لم يتسع ينتقل إلى صفحة جديدة
  const place = node => { body.appendChild(node); if (!fits() && body.childNodes.length > 1) { body.removeChild(node); newPage(); body.appendChild(node) } }
  newPage()
  body.appendChild(el('p', 'rpdf-intro', esc(model.intro)))

  for (const b of model.blocks) {
    if (b.kind === 'metrics') {
      const g = el('div', 'rpdf-metrics'); g.setAttribute('data-block', b.id)
      for (const it of b.items) {
        const m = el('div', 'rpdf-metric', `<span>${esc(it.label)}</span><strong>${num(it.value, it.type)}</strong><small>${esc(it.foot || '')}</small>`)
        m.setAttribute('data-key', it.key); g.appendChild(m)
      }
      place(g)
    } else if (b.kind === 'calc') {
      const w = el('div'); w.setAttribute('data-block', b.id)
      w.appendChild(el('div', 'rpdf-h2', esc(b.title)))
      const dl = el('div', 'rpdf-calc')
      for (const r of b.rows) dl.appendChild(el('div', r.strong ? 's' : '', `<span>${esc(r.label)}</span>${num(r.value, 'money')}`))
      w.appendChild(dl); place(w)
    } else if (b.kind === 'note') {
      const n = el('p', 'rpdf-note', esc(b.text)); n.setAttribute('data-block', b.id); place(n)
    } else if (b.kind === 'table') {
      const head = `<tr>${b.columns.map(c => `<th class="${c.type ? 'e' : ''}">${esc(c.label)}</th>`).join('')}</tr>`
      let table
      const startTable = cont => {
        const t = el('div'); t.setAttribute('data-block', b.id)
        t.appendChild(el('div', 'rpdf-h2', esc(b.title) + (cont ? ' (تابع)' : '')))
        if (b.subtitle && !cont) t.appendChild(el('div', 'rpdf-sub', esc(b.subtitle)))
        table = el('table', 'rpdf-table', `<thead>${head}</thead><tbody></tbody>`)
        t.appendChild(table); body.appendChild(t)
        if (!fits() && body.childNodes.length > 1) { body.removeChild(t); newPage(); body.appendChild(t) }
      }
      startTable(false)
      const rowEl = (r, cls, mark) => {
        const tr = el('tr', cls)
        tr.innerHTML = r.map((v, j) => `<td class="${b.columns[j].type ? 'e' : ''}${b.columns[j].wide ? ' w' : ''}">${cellHtml(v, b.columns[j].type)}${j === 0 && mark ? `<span class="rpdf-mark">${esc(mark)}</span>` : ''}</td>`).join('')
        return tr
      }
      const all = [...b.rows.map((r, i) => rowEl(r, `l${b.levels?.[i] ?? ''}`, b.marks?.[i])), ...(b.foot || []).map(f => rowEl(f, 'f'))]
      for (const tr of all) {
        const tbody = table.querySelector('tbody'); tbody.appendChild(tr)
        if (!fits()) { tbody.removeChild(tr); newPage(); startTable(true); table.querySelector('tbody').appendChild(tr) }
      }
    }
  }
  const sc = el('div', 'rpdf-scope', `<div class="rpdf-h2">وصف الأرقام</div>${model.scope.map(([t, x]) => `<div>${t ? `<b>${esc(t)}: </b>` : ''}${esc(x)}</div>`).join('')}`)
  sc.setAttribute('data-block', 'scope'); place(sc)

  const pages = [...root.querySelectorAll('.rpdf-page')]
  pages.forEach((p, i) => { p.querySelector('.rpdf-pn').textContent = `صفحة ${i + 1} من ${pages.length}` })
  return root
}

/** ملف PDF (Blob). keep: يُبقي الصفحات في المستند بعد الرسم (للاختبار). */
export async function modelToPdf(model, { keep = false } = {}) {
  const [jspdf, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')])
  const jsPDF = jspdf.jsPDF || jspdf.default
  await document.fonts?.ready
  const root = buildPages(model)
  try {
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true })
    pdf.setProperties({ title: `${model.title} — ${model.org}`, creator: 'تحسيب المطاعم' })
    const pages = [...root.querySelectorAll('.rpdf-page')]
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

const SCALE = 2.5
// تصوير صفحة واحدة: تُعرض وحدها في أعلى الحاوية (الصفحات الأخرى مخفية)، بنافذة تصوير بحجم الصفحة وبلا إزاحة تمرير،
// فلا يعتمد الناتج على موضع الصفحة في المستند ولا على حجم نافذة المتصفح أو تمريرها. ثم يُتحقق من الصورة نفسها:
// أبعادها أبعاد الصفحة، ومنطقة الترويسة فيها حبر فعلًا. إن لم تتحقق يُعاد التصوير مرة، وإلا يتوقف التصدير بخطأ ولا يُنتَج ملف ناقص.
export async function capturePage(html2canvas, pages, i) {
  pages.forEach((p, j) => { p.style.display = j === i ? '' : 'none' })
  const opts = { scale: SCALE, backgroundColor: '#ffffff', logging: false, useCORS: true, scrollX: 0, scrollY: 0,
    windowWidth: PAGE_W, windowHeight: PAGE_H, width: PAGE_W, height: PAGE_H }
  for (let attempt = 0; attempt < 2; attempt++) {
    const canvas = await html2canvas(pages[i], opts)
    if (pageImageOk(canvas)) return canvas
  }
  throw new Error(`pdf_page_capture_failed:${i + 1}`)
}

// الترويسة بين 38 و150 نقطة من أعلى الصفحة (العلامة واسم المنشأة والعنوان والفترة والخط تحتها): يجب أن يكون فيها حبر
export function pageImageOk(canvas) {
  if (Math.abs(canvas.width - PAGE_W * SCALE) > 3 || Math.abs(canvas.height - PAGE_H * SCALE) > 3) return false
  const ctx = canvas.getContext('2d')
  const y0 = Math.round(38 * SCALE), h = Math.round(112 * SCALE)
  const { data } = ctx.getImageData(0, y0, canvas.width, h)
  let ink = 0
  for (let k = 0; k < data.length; k += 16) if (data[k] < 160 || data[k + 1] < 160 || data[k + 2] < 160) ink++
  return ink > 400
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = fileName
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
