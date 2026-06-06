import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

const ROLE_AR = { owner: 'المالك', accountant: 'المحاسب', purchasing: 'مسؤول المشتريات', cashier: 'الكاشير' }

function cleanFileName(name) {
  return (name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function Row({ label, value, bold, indent, color }) {
  return (
    <div className={`flex justify-between items-center py-2 border-b border-slate-50 ${bold ? 'font-bold' : ''} ${indent ? 'pr-6' : ''}`}>
      <span className={`text-sm ${color || 'text-slate-700'}`}>{label}</span>
      <span className={`text-sm tabular-nums ${bold ? 'text-slate-900' : 'text-slate-600'} ${color || ''}`}>{value} ر.س</span>
    </div>
  )
}

export default function Reports() {
  const now = new Date()
  const [from, setFrom] = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`)
  const [to,   setTo]   = useState(now.toISOString().split('T')[0])
  const [data,     setData]     = useState(null)
  const [entries,  setEntries]  = useState([])
  const [docs,     setDocs]     = useState([])
  const [loading,   setLoading]  = useState(false)
  const [exporting, setExporting] = useState(false)
  const pdfRef      = useRef()
  const docsRowRefs = useRef([])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data: proj } = await supabase.from('projects').select('id').eq('name','تحسيب-برو').single()
    if (!proj) { setLoading(false); return }

    const [{ data: sales }, { data: ledger }, { data: ledgerFull }, { data: documents }] = await Promise.all([
      supabase.from('sales').select('cash_sales,network_sales')
        .eq('project_id', proj.id).gte('date', from).lte('date', to),
      supabase.from('ledger_entries').select('type,cash_out,bank_out,custody_out,cash_in,bank_in,custody_in')
        .eq('project_id', proj.id).gte('date', from).lte('date', to),
      supabase.from('ledger_entries').select('id,date,type,description,cash_in,bank_in,custody_in,cash_out,bank_out,custody_out,total_amount,journal_number')
        .eq('project_id', proj.id).gte('date', from).lte('date', to).order('date'),
      supabase.from('documents').select('file_name,uploaded_by,uploaded_at,analysis_result,journal_number,file_url')
        .eq('project_id', proj.id).eq('status','approved')
        .gte('uploaded_at', from).lte('uploaded_at', to + 'T23:59:59')
        .order('uploaded_at'),
    ])

    const sum    = (list, field) => (list||[]).reduce((s,r) => s+(Number(r[field])||0), 0)
    const sumOut = (list, types) => (list||[]).filter(r=>types.includes(r.type))
      .reduce((s,r) => s+(r.cash_out||0)+(r.bank_out||0)+(r.custody_out||0), 0)

    const cashSales    = sum(sales,'cash_sales')
    const networkSales = sum(sales,'network_sales')
    const totalSales   = cashSales + networkSales
    const opEx         = sumOut(ledger, ['🛒 مصروفات تشغيلية'])
    const fixEx        = sumOut(ledger, ['💰 مصروفات ثابتة'])
    const loans        = sumOut(ledger, ['💳 قسط سيارة','💳 قسط شراء أرض','💳 قرض ١','💳 قرض ٢'])
    const draws        = sumOut(ledger, ['💼 مسحوبات سليمان','💼 مسحوبات أم طوبى'])
    const grossProfit  = totalSales - opEx - fixEx
    const netProfit    = grossProfit - loans
    const netFlow      = netProfit - draws
    const margin       = totalSales > 0 ? (netProfit / totalSales * 100).toFixed(1) : 0

    const totalIn  = (ledgerFull||[]).reduce((s,r) => s+(r.cash_in||0)+(r.bank_in||0)+(r.custody_in||0), 0)
    const totalOut = (ledgerFull||[]).reduce((s,r) => s+(r.cash_out||0)+(r.bank_out||0)+(r.custody_out||0), 0)

    setData({ cashSales, networkSales, totalSales, opEx, fixEx, loans, draws, grossProfit, netProfit, netFlow, margin, totalIn, totalOut })
    setEntries(ledgerFull || [])
    setDocs(documents || [])
    setLoading(false)
  }

  async function exportPdf() {
    if (!data || !pdfRef.current) return
    setExporting(true)
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
      ])

      const el = pdfRef.current
      el.style.display = 'block'

      // Wait for browser layout
      await new Promise(r => setTimeout(r, 150))

      // Record positions of document rows that have file_url
      const containerRect = el.getBoundingClientRect()
      const containerH    = el.offsetHeight || containerRect.height
      const linkData = docsRowRefs.current
        .map((rowEl, i) => {
          if (!rowEl || !docs[i]?.file_url) return null
          const rowRect = rowEl.getBoundingClientRect()
          return {
            url:         docs[i].file_url,
            topRatio:    (rowRect.top  - containerRect.top)  / containerH,
            heightRatio: rowRect.height / containerH,
          }
        })
        .filter(Boolean)

      const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' })
      el.style.display = 'none'

      const imgData = canvas.toDataURL('image/png')
      const pdf     = new jsPDF('p', 'mm', 'a4')
      const pageW   = pdf.internal.pageSize.getWidth()
      const pageH   = pdf.internal.pageSize.getHeight()
      const imgH    = (canvas.height * pageW) / canvas.width

      let yOffset   = 0
      let remaining = imgH

      while (remaining > 0) {
        pdf.addImage(imgData, 'PNG', 0, -yOffset, pageW, imgH)
        remaining -= pageH
        yOffset   += pageH
        if (remaining > 0) pdf.addPage()
      }

      // Add clickable link annotations over each document row
      const totalPages = Math.ceil(imgH / pageH)
      linkData.forEach(({ url, topRatio, heightRatio }) => {
        const pdfYTotal = topRatio    * imgH
        const pdfRowH   = Math.max(heightRatio * imgH, 5)
        const pageNum   = Math.floor(pdfYTotal / pageH)
        const pdfY      = pdfYTotal - pageNum * pageH

        if (pageNum < totalPages) {
          pdf.setPage(pageNum + 1)
          pdf.link(0, pdfY, pageW, pdfRowH, { url })
        }
      })

      pdf.save(`تقرير-${from}-${to}.pdf`)
    } catch(e) { console.error(e) }
    setExporting(false)
  }

  const fmt  = v => (v||0).toLocaleString('ar-SA', { minimumFractionDigits: 2 })
  const fmtD = d => d ? new Date(d).toLocaleDateString('ar-SA') : ''

  // Assign temp display numbers to entries without journal_number
  let legacySeq = 0
  const entriesDisplay = entries.map(e => ({
    ...e,
    _displayNum: e.journal_number || `OLD-${String(++legacySeq).padStart(3,'0')}`,
  }))

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-800">التقارير المالية</h1>

      {/* Controls */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-slate-500 block mb-1">من تاريخ</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">إلى تاريخ</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
        </div>
        <button onClick={load} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          تحديث
        </button>
        {data && (
          <button onClick={exportPdf} disabled={exporting}
            className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-2 mr-auto">
            {exporting
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>جارٍ التصدير...</>
              : '📄 تصدير PDF'
            }
          </button>
        )}
      </div>

      {loading && <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/></div>}

      {data && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <h2 className="font-bold text-slate-800 mb-4 pb-2 border-b border-slate-100">💰 قائمة الدخل</h2>
            <Row label="💵 مبيعات كاش"       value={fmt(data.cashSales)}    indent />
            <Row label="🏦 مبيعات شبكة"      value={fmt(data.networkSales)} indent />
            <Row label="إجمالي المبيعات"      value={fmt(data.totalSales)}   bold />
            <div className="pt-2 mt-2 border-t border-slate-100">
              <Row label="🛒 مصروفات تشغيلية" value={`(${fmt(data.opEx)})`}  indent color="text-red-600" />
              <Row label="💰 مصروفات ثابتة"   value={`(${fmt(data.fixEx)})`} indent color="text-red-600" />
            </div>
            <Row label="مجمل الربح"   value={fmt(data.grossProfit)} bold color={data.grossProfit>=0?'text-green-700':'text-red-700'} />
            <Row label="(-) الأقساط"  value={`(${fmt(data.loans)})`} indent color="text-red-600" />
            <Row label="صافي الربح"   value={fmt(data.netProfit)}   bold color={data.netProfit>=0?'text-green-700':'text-red-700'} />
            <Row label="(-) المسحوبات" value={`(${fmt(data.draws)})`} indent color="text-red-600" />
            <Row label="صافي التدفق النقدي" value={fmt(data.netFlow)} bold color={data.netFlow>=0?'text-blue-700':'text-red-700'} />
            <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between">
              <span className="text-sm text-slate-500">هامش الربح</span>
              <span className="text-sm font-bold text-blue-600">{data.margin}%</span>
            </div>
          </div>

          <div className="space-y-3">
            {[
              { label:'إجمالي المبيعات',   value:data.totalSales,       icon:'💵', bg:'bg-green-50',  border:'border-green-100',  text:'text-green-700'  },
              { label:'إجمالي المصروفات',  value:data.opEx+data.fixEx,  icon:'📤', bg:'bg-red-50',    border:'border-red-100',    text:'text-red-700'    },
              { label:'صافي الربح',        value:data.netProfit,         icon:'📈', bg:'bg-blue-50',   border:'border-blue-100',   text:'text-blue-700'   },
              { label:'إجمالي الأقساط',    value:data.loans,             icon:'💳', bg:'bg-orange-50', border:'border-orange-100', text:'text-orange-700' },
              { label:'المسحوبات',          value:data.draws,             icon:'💼', bg:'bg-purple-50', border:'border-purple-100', text:'text-purple-700' },
            ].map(c => (
              <div key={c.label} className={`${c.bg} border ${c.border} rounded-xl p-4 flex items-center justify-between`}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{c.icon}</span>
                  <span className="text-sm font-medium text-slate-700">{c.label}</span>
                </div>
                <span className={`font-bold tabular-nums ${c.text}`}>{fmt(c.value)} ر.س</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== PDF Template (hidden) ===== */}
      <div ref={pdfRef} style={{ display: 'none', width: '794px', fontFamily: 'Arial, sans-serif', direction: 'rtl', background: '#fff', padding: '32px', color: '#1e293b' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', borderBottom: '3px solid #2563eb', paddingBottom: '16px', marginBottom: '24px' }}>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#2563eb' }}>تحسيب برو</div>
          <div style={{ fontSize: '18px', fontWeight: 'bold', marginTop: '4px' }}>التقرير المالي</div>
          <div style={{ fontSize: '14px', color: '#64748b', marginTop: '8px' }}>
            الفترة من {from} إلى {to}
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
            تاريخ الطباعة: {new Date().toLocaleDateString('ar-SA')}
          </div>
        </div>

        {data && <>
          {/* Financial Summary */}
          <div style={{ marginBottom: '28px' }}>
            <div style={{ fontSize: '16px', fontWeight: 'bold', background: '#f1f5f9', padding: '8px 12px', borderRadius: '6px', marginBottom: '12px' }}>
              ملخص قائمة الدخل
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <tbody>
                {[
                  ['مبيعات كاش',          fmt(data.cashSales),    false, true,  '#1e293b'],
                  ['مبيعات شبكة',         fmt(data.networkSales), false, true,  '#1e293b'],
                  ['إجمالي المبيعات',      fmt(data.totalSales),   true,  false, '#1e293b'],
                  ['مصروفات تشغيلية',      `(${fmt(data.opEx)})`,  false, true,  '#dc2626'],
                  ['مصروفات ثابتة',        `(${fmt(data.fixEx)})`, false, true,  '#dc2626'],
                  ['مجمل الربح',           fmt(data.grossProfit),  true,  false, data.grossProfit>=0?'#16a34a':'#dc2626'],
                  ['الأقساط',              `(${fmt(data.loans)})`, false, true,  '#dc2626'],
                  ['صافي الربح',           fmt(data.netProfit),    true,  false, data.netProfit>=0?'#16a34a':'#dc2626'],
                  ['المسحوبات',            `(${fmt(data.draws)})`, false, true,  '#dc2626'],
                  ['صافي التدفق النقدي',   fmt(data.netFlow),      true,  false, data.netFlow>=0?'#2563eb':'#dc2626'],
                  ['هامش الربح',           `${data.margin}%`,      true,  false, '#2563eb'],
                ].map(([label, value, bold, indent, color], i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '7px 8px', paddingRight: indent ? '24px' : '8px', fontWeight: bold ? 'bold' : 'normal' }}>{label}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'left', fontWeight: bold ? 'bold' : 'normal', color }}>{value} ر.س</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary boxes */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '28px', flexWrap: 'wrap' }}>
            {[
              { label: 'إجمالي المدين', value: fmt(data.totalIn),  color: '#16a34a', bg: '#f0fdf4' },
              { label: 'إجمالي الدائن', value: fmt(data.totalOut), color: '#dc2626', bg: '#fef2f2' },
              { label: 'الرصيد',         value: fmt(data.totalIn - data.totalOut), color: '#2563eb', bg: '#eff6ff' },
            ].map(b => (
              <div key={b.label} style={{ flex: 1, minWidth: '160px', background: b.bg, border: `1px solid ${b.color}30`, borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>{b.label}</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', color: b.color }}>{b.value} ر.س</div>
              </div>
            ))}
          </div>

          {/* Entries Table */}
          {entriesDisplay.length > 0 && (
            <div style={{ marginBottom: '28px' }}>
              <div style={{ fontSize: '16px', fontWeight: 'bold', background: '#f1f5f9', padding: '8px 12px', borderRadius: '6px', marginBottom: '12px' }}>
                تفاصيل القيود ({entriesDisplay.length} قيد)
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                <thead>
                  <tr style={{ background: '#1e293b', color: '#fff' }}>
                    {['رقم القيد', 'التاريخ', 'النوع', 'الوصف', 'مدين', 'دائن'].map(h => (
                      <th key={h} style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 'bold' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entriesDisplay.map((e, i) => {
                    const debit  = (e.cash_in||0)  + (e.bank_in||0)  + (e.custody_in||0)
                    const credit = (e.cash_out||0) + (e.bank_out||0) + (e.custody_out||0)
                    return (
                      <tr key={e.id} style={{ borderBottom: '1px solid #f1f5f9', background: i%2===0 ? '#fff' : '#f8fafc' }}>
                        <td style={{ padding: '6px', color: e.journal_number ? '#2563eb' : '#94a3b8', fontWeight: 'bold', fontFamily: 'monospace', fontSize: '10px' }}>{e._displayNum}</td>
                        <td style={{ padding: '6px' }}>{e.date}</td>
                        <td style={{ padding: '6px' }}>{e.type}</td>
                        <td style={{ padding: '6px', maxWidth: '180px' }}>{e.description}</td>
                        <td style={{ padding: '6px', color: '#16a34a', fontWeight: debit > 0 ? 'bold' : 'normal' }}>{debit > 0 ? fmt(debit) : '—'}</td>
                        <td style={{ padding: '6px', color: '#dc2626', fontWeight: credit > 0 ? 'bold' : 'normal' }}>{credit > 0 ? fmt(credit) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#1e293b', color: '#fff', fontWeight: 'bold' }}>
                    <td colSpan={4} style={{ padding: '8px 6px' }}>الإجمالي</td>
                    <td style={{ padding: '8px 6px', color: '#86efac' }}>{fmt(data.totalIn)}</td>
                    <td style={{ padding: '8px 6px', color: '#fca5a5' }}>{fmt(data.totalOut)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Documents Table */}
          {docs.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '16px', fontWeight: 'bold', background: '#f1f5f9', padding: '8px 12px', borderRadius: '6px', marginBottom: '12px' }}>
                المستندات المعتمدة ({docs.length} مستند)
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                <thead>
                  <tr style={{ background: '#1e293b', color: '#fff' }}>
                    {['رقم القيد', 'اسم المستند', 'رُفع بواسطة', 'تاريخ الرفع', 'المبلغ'].map(h => (
                      <th key={h} style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 'bold' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d, i) => {
                    const res    = d.analysis_result
                    const amount = res?.type === 'sales'
                      ? ((res.cashSales||0) + (res.networkSales||0))
                      : (res?.amount || 0)
                    return (
                      <tr key={i} ref={el => docsRowRefs.current[i] = el}
                        style={{ borderBottom: '1px solid #f1f5f9', background: i%2===0 ? '#fff' : '#f8fafc' }}>
                        <td style={{ padding: '6px', color: '#2563eb', fontWeight: 'bold', fontFamily: 'monospace', fontSize: '10px' }}>{d.journal_number || '—'}</td>
                        <td style={{ padding: '6px', color: d.file_url ? '#2563eb' : '#1e293b', textDecoration: d.file_url ? 'underline' : 'none', cursor: d.file_url ? 'pointer' : 'default' }}>
                          {cleanFileName(d.file_name)}
                        </td>
                        <td style={{ padding: '6px' }}>{ROLE_AR[d.uploaded_by] || d.uploaded_by}</td>
                        <td style={{ padding: '6px' }}>{fmtD(d.uploaded_at)}</td>
                        <td style={{ padding: '6px', fontWeight: 'bold' }}>{amount > 0 ? fmt(amount) + ' ر.س' : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer */}
          <div style={{ borderTop: '2px solid #e2e8f0', paddingTop: '12px', textAlign: 'center', color: '#94a3b8', fontSize: '11px', marginTop: '16px' }}>
            تم إنشاء هذا التقرير بواسطة تحسيب برو — {new Date().toLocaleString('ar-SA')}
          </div>
        </>}
      </div>
    </div>
  )
}
