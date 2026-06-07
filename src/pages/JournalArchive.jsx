import React, { useEffect, useState, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'

const NAVY = '#0f2444'
const GOLD = '#c9a227'

// حساب مصدر المبلغ
function getAccount(r) {
  if ((r.cash_in    || 0) > 0) return 'صندوق'
  if ((r.bank_in    || 0) > 0) return 'بنك'
  if ((r.custody_in || 0) > 0) return 'عهدة'
  if ((r.cash_out    || 0) > 0) return 'صندوق'
  if ((r.bank_out    || 0) > 0) return 'بنك'
  if ((r.custody_out || 0) > 0) return 'عهدة'
  return '—'
}

// ── توليد PDF لقيد يومي ──────────────────────────────────────────
async function exportGroupPdf(group, fmt) {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'), import('html2canvas'),
  ])

  const { rows, date, journalNumber } = group
  const totalDebit  = rows.reduce((s,r) => s+(r.cash_in||0)+(r.bank_in||0)+(r.custody_in||0), 0)
  const totalCredit = rows.reduce((s,r) => s+(r.cash_out||0)+(r.bank_out||0)+(r.custody_out||0), 0)
  const balance     = totalDebit - totalCredit

  const el = document.createElement('div')
  el.style.cssText = `
    position:fixed; left:-9999px; top:0;
    width:794px; padding:36px; background:#fff;
    font-family:Cairo,Arial,sans-serif; direction:rtl; color:#1e293b;
  `

  el.innerHTML = `
    <div style="border-bottom:4px solid ${GOLD};padding-bottom:14px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-end">
      <div>
        <div style="font-size:22px;font-weight:bold;color:${NAVY}">تحسيب برو</div>
        <div style="font-size:13px;color:#6b7280;margin-top:2px">قيد يومي محاسبي</div>
      </div>
      <div style="text-align:left">
        <div style="font-size:14px;font-weight:bold;color:${GOLD}">${journalNumber || date}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:2px">التاريخ: ${date}</div>
        <div style="font-size:11px;color:#9ca3af">طُبع: ${new Date().toLocaleDateString('ar-SA')}</div>
      </div>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:16px">
      <thead>
        <tr style="background:${NAVY}">
          <th style="padding:8px 10px;text-align:right;color:#fff;font-weight:bold;width:30px">#</th>
          <th style="padding:8px 10px;text-align:right;color:#fff;font-weight:bold">النوع / البيان</th>
          <th style="padding:8px 10px;text-align:right;color:#fff;font-weight:bold">الحساب</th>
          <th style="padding:8px 10px;text-align:right;color:#86efac;font-weight:bold">مدين</th>
          <th style="padding:8px 10px;text-align:right;color:#fca5a5;font-weight:bold">دائن</th>
          <th style="padding:8px 10px;text-align:center;color:${GOLD};font-weight:bold">مستند</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => {
          const d = (r.cash_in||0)+(r.bank_in||0)+(r.custody_in||0)
          const c = (r.cash_out||0)+(r.bank_out||0)+(r.custody_out||0)
          const acc = getAccount(r)
          const bg = i % 2 === 0 ? '#fff' : '#fafaf8'
          return `
            <tr style="border-bottom:1px solid #f1f5f9;background:${bg}">
              <td style="padding:7px 10px;color:#9ca3af;font-size:10px">${i+1}</td>
              <td style="padding:7px 10px">
                <div style="font-weight:600;color:${NAVY}">${r.type || '—'}</div>
                ${r.description ? `<div style="font-size:10px;color:#6b7280;margin-top:2px">${r.description}</div>` : ''}
              </td>
              <td style="padding:7px 10px;font-size:10px">
                <span style="background:${acc==='صندوق'?'#f0fdf4':acc==='بنك'?'#eff6ff':'#fffbeb'};color:${acc==='صندوق'?'#16a34a':acc==='بنك'?'#1d4ed8':'#b45309'};padding:2px 8px;border-radius:12px;font-weight:600">
                  ${acc}
                </span>
              </td>
              <td style="padding:7px 10px;text-align:right;font-weight:${d>0?'bold':'normal'};color:${d>0?'#16a34a':'#d1d5db'};font-family:monospace">
                ${d > 0 ? fmt(d) : '—'}
              </td>
              <td style="padding:7px 10px;text-align:right;font-weight:${c>0?'bold':'normal'};color:${c>0?'#dc2626':'#d1d5db'};font-family:monospace">
                ${c > 0 ? fmt(c) : '—'}
              </td>
              <td style="padding:7px 10px;text-align:center">
                ${r.file_url ? `<a href="${r.file_url}" style="color:#1d4ed8;font-size:10px;text-decoration:underline">📎 مستند</a>` : '<span style="color:#d1d5db">—</span>'}
              </td>
            </tr>`
        }).join('')}
      </tbody>
      <tfoot>
        <tr style="background:${NAVY}">
          <td colspan="3" style="padding:9px 10px;font-weight:bold;color:#fff;font-size:11px">الإجمالي (${rows.length} حركة)</td>
          <td style="padding:9px 10px;text-align:right;font-weight:bold;color:#86efac;font-family:monospace">${totalDebit > 0 ? fmt(totalDebit) : '—'}</td>
          <td style="padding:9px 10px;text-align:right;font-weight:bold;color:#fca5a5;font-family:monospace">${totalCredit > 0 ? fmt(totalCredit) : '—'}</td>
          <td/>
        </tr>
      </tfoot>
    </table>

    <div style="display:flex;gap:10px;margin-bottom:20px">
      <div style="flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:10px;color:#6b7280;margin-bottom:4px">إجمالي المدين</div>
        <div style="font-size:16px;font-weight:bold;color:#16a34a;font-family:monospace">${fmt(totalDebit)} ر.س</div>
      </div>
      <div style="flex:1;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:10px;color:#6b7280;margin-bottom:4px">إجمالي الدائن</div>
        <div style="font-size:16px;font-weight:bold;color:#dc2626;font-family:monospace">${fmt(totalCredit)} ر.س</div>
      </div>
      <div style="flex:1;background:${balance>=0?'#eff6ff':'#fef2f2'};border:1px solid ${balance>=0?'#bfdbfe':'#fecaca'};border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:10px;color:#6b7280;margin-bottom:4px">الميزان</div>
        <div style="font-size:16px;font-weight:bold;color:${balance>=0?'#1d4ed8':'#dc2626'};font-family:monospace">${fmt(Math.abs(balance))} ر.س ${balance>=0?'(مدين)':balance<0?'(دائن)':''}</div>
      </div>
    </div>

    <div style="border-top:2px solid ${GOLD};padding-top:10px;text-align:center;color:#9ca3af;font-size:10px">
      تحسيب برو — ${new Date().toLocaleString('ar-SA')}
    </div>
  `

  document.body.appendChild(el)
  await new Promise(r => setTimeout(r, 100))

  const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' })
  document.body.removeChild(el)

  const pdf   = new jsPDF('p', 'mm', 'a4')
  const pageW = pdf.internal.pageSize.getWidth()
  const imgH  = (canvas.height * pageW) / canvas.width
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageW, imgH)
  pdf.save(`قيد-${journalNumber || date}.pdf`)
}

// ── الصفحة الرئيسية ──────────────────────────────────────────────
export default function JournalArchive() {
  const [entries,    setEntries]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [openDates,  setOpenDates]  = useState({})
  const [search,     setSearch]     = useState('')
  const [exporting,  setExporting]  = useState({})   // date → bool

  useEffect(() => { init() }, [])

  async function init() {
    const { data: proj } = await supabase
      .from('projects').select('id').eq('name', 'تحسيب-برو').single()
    if (!proj) { setLoading(false); return }

    const { data } = await supabase
      .from('ledger_entries')
      .select('id,date,type,description,cash_in,bank_in,custody_in,cash_out,bank_out,custody_out,total_amount,status,journal_number,file_url,created_at')
      .eq('project_id', proj.id)
      .not('status', 'eq', 'cancelled')
      .order('date', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(2000)

    const all = data || []

    const missing = all.filter(r => !r.file_url && r.journal_number).map(r => r.journal_number)
    if (missing.length) {
      const { data: docs } = await supabase
        .from('documents').select('journal_number,file_url,file_name')
        .in('journal_number', [...new Set(missing)]).not('file_url', 'is', null)
      if (docs) {
        const docMap = {}
        docs.forEach(d => { if (d.file_url) docMap[d.journal_number] = d })
        all.forEach(r => {
          if (!r.file_url && docMap[r.journal_number]) {
            r.file_url  = docMap[r.journal_number].file_url
            r._doc_name = docMap[r.journal_number].file_name
          }
        })
      }
    }

    setEntries(all)
    setLoading(false)
  }

  const groups = useMemo(() => {
    const map = {}
    entries.forEach(r => {
      const key = r.date || 'غير محدد'
      if (!map[key]) map[key] = { date: key, rows: [], journalNumber: null }
      if (!map[key].journalNumber && r.journal_number) map[key].journalNumber = r.journal_number
      map[key].rows.push(r)
    })
    return Object.values(map).sort((a, b) => b.date.localeCompare(a.date))
  }, [entries])

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups
    const s = search.trim().toLowerCase()
    return groups.filter(g =>
      g.date.includes(s) ||
      (g.journalNumber || '').toLowerCase().includes(s) ||
      g.rows.some(r =>
        (r.description || '').toLowerCase().includes(s) ||
        (r.type        || '').toLowerCase().includes(s)
      )
    )
  }, [groups, search])

  function toggleDate(date) {
    setOpenDates(prev => ({ ...prev, [date]: !prev[date] }))
  }

  const fmt = v => v ? Number(v).toLocaleString('ar-SA', { minimumFractionDigits: 2 }) : '—'

  function dayTotals(rows) {
    const debit  = rows.reduce((s,r) => s+(r.cash_in||0)+(r.bank_in||0)+(r.custody_in||0), 0)
    const credit = rows.reduce((s,r) => s+(r.cash_out||0)+(r.bank_out||0)+(r.custody_out||0), 0)
    return { debit, credit, balance: debit - credit }
  }

  async function handleExport(e, group) {
    e.stopPropagation()
    setExporting(p => ({ ...p, [group.date]: true }))
    try { await exportGroupPdf(group, fmt) } catch(err) { console.error(err) }
    setExporting(p => ({ ...p, [group.date]: false }))
  }

  if (loading) return (
    <div className="flex justify-center h-64 items-center">
      <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: GOLD, borderTopColor: 'transparent' }}/>
    </div>
  )

  return (
    <div className="space-y-4">

      {/* رأس */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: NAVY }}>أرشيف القيود اليومية</h1>
          <p className="text-sm text-slate-500 mt-0.5">{filteredGroups.length} يوم — {entries.length} حركة</p>
        </div>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="بحث بالتاريخ أو رقم القيد أو البيان..."
          className="border rounded-xl px-3 py-2 text-sm w-72 focus:outline-none"
          style={{ borderColor: '#d1c9b8' }}/>
      </div>

      {filteredGroups.length === 0 && (
        <div className="bg-white rounded-2xl shadow-sm flex flex-col items-center py-16 text-slate-400"
          style={{ border: '1px solid #e8e5dc' }}>
          <span className="text-4xl mb-3">📂</span>
          <p className="font-medium">{search ? 'لا توجد نتائج' : 'لا توجد قيود'}</p>
        </div>
      )}

      <div className="space-y-2">
        {filteredGroups.map(g => {
          const { debit, credit, balance } = dayTotals(g.rows)
          const isOpen  = !!openDates[g.date]
          const label   = g.journalNumber || g.date
          const isPdfing = !!exporting[g.date]

          return (
            <div key={g.date} className="bg-white rounded-2xl shadow-sm overflow-hidden"
              style={{ border: '1px solid #e8e5dc' }}>

              {/* رأس القيد */}
              <div className="flex items-center gap-2 px-4 py-3"
                style={{ borderBottom: isOpen ? `1px solid #e8e5dc` : 'none' }}>

                {/* زر الفتح */}
                <button onClick={() => toggleDate(g.date)}
                  className="flex-1 flex items-center gap-3 text-right min-w-0"
                  onMouseEnter={e => e.currentTarget.parentElement.style.background = '#fafaf8'}
                  onMouseLeave={e => e.currentTarget.parentElement.style.background = ''}>
                  <span className="text-xl shrink-0">{isOpen ? '📂' : '📁'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm" style={{ color: NAVY }}>{label}</span>
                      <span className="text-xs text-slate-400 font-mono">{g.date}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: '#f5f4f0', color: '#8a7a5a' }}>{g.rows.length} حركة</span>
                    </div>
                  </div>
                  <div className="flex gap-3 items-center shrink-0 text-xs">
                    {debit  > 0 && <span className="font-semibold tabular-nums text-green-600">↑ {fmt(debit)}</span>}
                    {credit > 0 && <span className="font-semibold tabular-nums text-red-500">↓ {fmt(credit)}</span>}
                    <span className="text-base" style={{ color: GOLD }}>{isOpen ? '▲' : '▼'}</span>
                  </div>
                </button>

                {/* زر تحميل PDF */}
                <button onClick={e => handleExport(e, g)} disabled={isPdfing}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 disabled:opacity-50"
                  style={{ background: NAVY, color: '#fff' }}>
                  {isPdfing
                    ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"/>جارٍ...</>
                    : <>⬇️ PDF</>
                  }
                </button>
              </div>

              {/* محتوى القيد — التنسيق المحاسبي */}
              {isOpen && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: '#f5f4f0', borderBottom: `2px solid ${GOLD}` }}>
                        <th className="px-3 py-2.5 text-right text-xs font-bold w-7 text-slate-400">#</th>
                        <th className="px-3 py-2.5 text-right text-xs font-bold" style={{ color: NAVY }}>النوع / البيان</th>
                        <th className="px-3 py-2.5 text-right text-xs font-bold" style={{ color: NAVY }}>الحساب</th>
                        <th className="px-3 py-2.5 text-right text-xs font-bold text-green-700">مدين</th>
                        <th className="px-3 py-2.5 text-right text-xs font-bold text-red-600">دائن</th>
                        <th className="px-3 py-2.5 text-center text-xs font-bold" style={{ color: NAVY }}>مستند</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ borderColor: '#f5f4f0' }}>
                      {g.rows.map((r, i) => {
                        const d   = (r.cash_in||0)+(r.bank_in||0)+(r.custody_in||0)
                        const c   = (r.cash_out||0)+(r.bank_out||0)+(r.custody_out||0)
                        const acc = getAccount(r)
                        const accStyle = acc === 'صندوق'
                          ? { background: '#f0fdf4', color: '#16a34a' }
                          : acc === 'بنك'
                          ? { background: '#eff6ff', color: '#1d4ed8' }
                          : { background: '#fffbeb', color: '#b45309' }

                        return (
                          <tr key={r.id} className="transition-colors hover:bg-amber-50/30">
                            <td className="px-3 py-2.5 text-xs text-slate-300 text-center">{i+1}</td>
                            <td className="px-3 py-2.5 max-w-56">
                              <div className="text-xs font-semibold" style={{ color: NAVY }}>{r.type || '—'}</div>
                              {r.description && <div className="text-xs text-slate-400 truncate mt-0.5">{r.description}</div>}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={accStyle}>{acc}</span>
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                              {d > 0
                                ? <span className="text-green-700 font-bold">{fmt(d)}</span>
                                : <span className="text-slate-200">—</span>
                              }
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                              {c > 0
                                ? <span className="text-red-600 font-bold">{fmt(c)}</span>
                                : <span className="text-slate-200">—</span>
                              }
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {r.file_url
                                ? <a href={r.file_url} target="_blank" rel="noreferrer"
                                    title={r._doc_name || 'فتح المستند'}
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-sm transition-colors"
                                    style={{ background: '#fef9ec', color: GOLD }}
                                    onMouseEnter={e => e.currentTarget.style.background = '#fef3c7'}
                                    onMouseLeave={e => e.currentTarget.style.background = '#fef9ec'}>
                                    📎
                                  </a>
                                : <span className="text-slate-200 text-xs">—</span>
                              }
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>

                    {/* مجاميع القيد */}
                    <tfoot>
                      <tr style={{ background: '#f5f4f0', borderTop: `1px solid #e8e5dc` }}>
                        <td colSpan={3} className="px-3 py-2 text-xs font-bold" style={{ color: NAVY }}>
                          الإجمالي ({g.rows.length} حركة)
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-green-700">
                          {debit > 0 ? fmt(debit) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-red-600">
                          {credit > 0 ? fmt(credit) : '—'}
                        </td>
                        <td/>
                      </tr>
                      <tr style={{ background: NAVY }}>
                        <td colSpan={3} className="px-3 py-2 text-xs font-bold text-white">الميزان</td>
                        <td colSpan={2} className="px-3 py-2 text-right text-xs font-bold tabular-nums"
                          style={{ color: balance === 0 ? '#fde68a' : balance > 0 ? '#86efac' : '#fca5a5' }}>
                          {fmt(Math.abs(balance))} ر.س
                          <span className="mr-1 font-normal opacity-75">
                            {balance > 0 ? '(مدين)' : balance < 0 ? '(دائن)' : '(متوازن)'}
                          </span>
                        </td>
                        <td/>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
