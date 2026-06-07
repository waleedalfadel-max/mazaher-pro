import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'

export default function JournalArchive() {
  const [entries, setEntries]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [openDates, setOpenDates] = useState({})
  const [search, setSearch]     = useState('')

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

    // للإدخالات بدون file_url نجلب من documents
    const missing = all.filter(r => !r.file_url && r.journal_number).map(r => r.journal_number)
    if (missing.length) {
      const { data: docs } = await supabase
        .from('documents')
        .select('journal_number,file_url,file_name')
        .in('journal_number', [...new Set(missing)])
        .not('file_url', 'is', null)
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

  // تجميع حسب التاريخ
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
        (r.type || '').toLowerCase().includes(s)
      )
    )
  }, [groups, search])

  function toggleDate(date) {
    setOpenDates(prev => ({ ...prev, [date]: !prev[date] }))
  }

  const fmt = v => v ? Number(v).toLocaleString('ar-SA', { minimumFractionDigits: 2 }) : '—'

  function dayTotal(rows) {
    const debit  = rows.reduce((s, r) => s + (r.cash_in || 0) + (r.bank_in || 0) + (r.custody_in || 0), 0)
    const credit = rows.reduce((s, r) => s + (r.cash_out || 0) + (r.bank_out || 0) + (r.custody_out || 0), 0)
    return { debit, credit }
  }

  const NAVY = '#0f2444'
  const GOLD = '#c9a227'

  if (loading) return (
    <div className="flex justify-center h-64 items-center">
      <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: GOLD, borderTopColor: 'transparent' }}/>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: NAVY }}>أرشيف القيود اليومية</h1>
          <p className="text-sm text-slate-500 mt-0.5">{filteredGroups.length} يوم — {entries.length} حركة</p>
        </div>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="بحث بالتاريخ أو رقم القيد أو البيان..."
          className="border rounded-xl px-3 py-2 text-sm w-72 focus:outline-none focus:ring-2"
          style={{ borderColor: '#d1c9b8' }}
        />
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
          const { debit, credit } = dayTotal(g.rows)
          const isOpen = !!openDates[g.date]
          const label  = g.journalNumber || g.date

          return (
            <div key={g.date} className="bg-white rounded-2xl shadow-sm overflow-hidden"
              style={{ border: '1px solid #e8e5dc' }}>
              <button
                onClick={() => toggleDate(g.date)}
                className="w-full flex items-center gap-3 px-5 py-4 transition-colors text-right"
                style={{ ':hover': { background: '#fafaf8' } }}
                onMouseEnter={e => e.currentTarget.style.background = '#fafaf8'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
              >
                <span className="text-xl">{isOpen ? '📂' : '📁'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-bold text-sm" style={{ color: NAVY }}>{label}</span>
                    <span className="text-xs text-slate-400 font-mono">{g.date}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#f5f4f0', color: '#8a7a5a' }}>{g.rows.length} حركة</span>
                  </div>
                </div>
                <div className="flex gap-4 items-center shrink-0 text-xs">
                  {debit  > 0 && <span className="font-semibold tabular-nums text-green-600">↑ {fmt(debit)}</span>}
                  {credit > 0 && <span className="font-semibold tabular-nums text-red-500">↓ {fmt(credit)}</span>}
                  <span className="text-base" style={{ color: GOLD }}>{isOpen ? '▲' : '▼'}</span>
                </div>
              </button>

              {isOpen && (
                <div className="overflow-x-auto" style={{ borderTop: `1px solid #e8e5dc` }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: '#f5f4f0', borderBottom: `2px solid ${GOLD}` }}>
                        <th className="px-4 py-2 text-right text-xs font-bold" style={{ color: NAVY }}>النوع</th>
                        <th className="px-4 py-2 text-right text-xs font-bold" style={{ color: NAVY }}>البيان</th>
                        <th className="px-4 py-2 text-right text-xs font-bold text-green-700">دخل</th>
                        <th className="px-4 py-2 text-right text-xs font-bold text-red-600">خرج</th>
                        <th className="px-4 py-2 text-center text-xs font-bold" style={{ color: NAVY }}>مستند</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ borderColor: '#f5f4f0' }}>
                      {g.rows.map(r => {
                        const d = (r.cash_in || 0) + (r.bank_in || 0) + (r.custody_in || 0)
                        const c = (r.cash_out || 0) + (r.bank_out || 0) + (r.custody_out || 0)
                        return (
                          <tr key={r.id} className="transition-colors hover:bg-amber-50/30">
                            <td className="px-4 py-2.5 text-xs text-slate-600 whitespace-nowrap">{r.type || '—'}</td>
                            <td className="px-4 py-2.5 text-xs text-slate-500 max-w-52 truncate">{r.description || '—'}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                              {d > 0 ? <span className="text-green-700 font-semibold">{fmt(d)}</span> : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                              {c > 0 ? <span className="text-red-600 font-semibold">{fmt(c)}</span> : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              {r.file_url
                                ? <a href={r.file_url} target="_blank" rel="noreferrer"
                                    title={r._doc_name || 'فتح المستند'}
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors text-sm"
                                    style={{ background: '#fef9ec', color: GOLD }}
                                    onMouseEnter={e => e.currentTarget.style.background = '#fef3c7'}
                                    onMouseLeave={e => e.currentTarget.style.background = '#fef9ec'}>
                                    📎
                                  </a>
                                : <span className="text-slate-300 text-xs">—</span>
                              }
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot style={{ background: NAVY }}>
                      <tr>
                        <td colSpan={2} className="px-4 py-2 text-xs font-bold text-white">الإجمالي</td>
                        <td className="px-4 py-2 text-right text-xs font-bold tabular-nums" style={{ color: '#86efac' }}>{debit > 0 ? fmt(debit) : '—'}</td>
                        <td className="px-4 py-2 text-right text-xs font-bold tabular-nums" style={{ color: '#fca5a5' }}>{credit > 0 ? fmt(credit) : '—'}</td>
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
