import React, { useEffect, useState, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { uploadToStorage } from '../lib/storage'

const NAVY = '#0f2444'
const GOLD = '#c9a227'

const now = new Date()
const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
const today = now.toISOString().split('T')[0]

const STATUS_BADGE = {
  approved:  { bg: '#f0fdf4', color: '#16a34a' },
  auto:      { bg: '#eff6ff', color: '#1d4ed8' },
  pending:   { bg: '#fffbeb', color: '#b45309' },
  cancelled: { bg: '#fef2f2', color: '#dc2626' },
  modified:  { bg: '#f5f3ff', color: '#7c3aed' },
}
const STATUS_LABEL = {
  approved: 'معتمد', auto: 'تلقائي', pending: 'معلق', cancelled: 'ملغي', modified: 'معدَّل',
}

// ── مودال المرفقات ──────────────────────────────────────────────
function AttachModal({ entry, projectId, role, onClose, onAdded }) {
  const [attachments, setAttachments] = useState([])
  const [uploading, setUploading]     = useState(false)
  const [error, setError]             = useState('')
  const fileRef = useRef()

  useEffect(() => { loadAttachments() }, [])

  async function loadAttachments() {
    if (!entry.journal_number) return
    const { data } = await supabase
      .from('attachments')
      .select('id,file_name,file_url,uploaded_by,uploaded_at')
      .eq('journal_number', entry.journal_number)
      .eq('project_id', projectId)
      .order('uploaded_at')
    setAttachments(data || [])
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError('')
    try {
      const fileUrl = await uploadToStorage(file, projectId)
      await supabase.from('attachments').insert({
        project_id:     projectId,
        journal_number: entry.journal_number,
        file_url:       fileUrl,
        file_name:      file.name,
        uploaded_by:    role,
      })
      await loadAttachments()
      onAdded(entry.journal_number)
    } catch(e) { setError(e.message) }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleDelete(id) {
    await supabase.from('attachments').delete().eq('id', id)
    await loadAttachments()
    onAdded(entry.journal_number)
  }

  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB') : ''
  const ROLE_AR = { owner: 'المالك', accountant: 'المحاسب', purchasing: 'مسؤول المشتريات', cashier: 'الكاشير' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" style={{ border: `2px solid ${GOLD}` }}>

        {/* رأس المودال */}
        <div className="px-5 py-4 flex items-center justify-between" style={{ background: NAVY }}>
          <div>
            <h2 className="font-bold text-white text-sm">📎 مرفقات القيد</h2>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {entry.journal_number} — {entry.date}
            </p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-xl leading-none">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* زر رفع مرفق جديد */}
          <label className="flex items-center gap-2 px-4 py-3 rounded-xl cursor-pointer font-bold text-sm transition-all"
            style={{ background: GOLD, color: NAVY }}>
            {uploading
              ? <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"/>جارٍ الرفع...</>
              : <>📎 إضافة مرفق جديد</>
            }
            <input ref={fileRef} type="file" className="hidden" accept="image/*,.pdf"
              onChange={handleUpload} disabled={uploading}/>
          </label>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">❌ {error}</div>
          )}

          {/* قائمة المرفقات الحالية */}
          {attachments.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <span className="text-3xl block mb-2">📂</span>
              <p className="text-sm">لا توجد مرفقات بعد</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-500 mb-2">{attachments.length} مرفق</div>
              {attachments.map(a => (
                <div key={a.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                  style={{ background: '#f5f4f0', border: '1px solid #e8e5dc' }}>
                  <span className="text-lg shrink-0">{a.file_name?.endsWith('.pdf') ? '📄' : '🖼️'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: NAVY }}>{a.file_name}</div>
                    <div className="text-xs text-slate-400">{ROLE_AR[a.uploaded_by] || a.uploaded_by} — {fmtDate(a.uploaded_at)}</div>
                  </div>
                  <a href={a.file_url} target="_blank" rel="noreferrer"
                    className="text-xs font-semibold px-2 py-1 rounded-lg transition-all"
                    style={{ background: '#eff6ff', color: '#1d4ed8' }}>
                    فتح
                  </a>
                  {(role === 'owner' || role === 'accountant') && (
                    <button onClick={() => handleDelete(a.id)}
                      className="text-xs px-2 py-1 rounded-lg transition-all"
                      style={{ background: '#fef2f2', color: '#dc2626' }}>
                      حذف
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── الصفحة الرئيسية ──────────────────────────────────────────────
export default function JournalLedger() {
  const { role, projectId } = useAuth()
  const [rows, setRows]             = useState([])
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState({ from: thisMonthStart, to: today })
  const [activePeriod, setActivePeriod] = useState('month')
  const [search, setSearch]         = useState('')
  const [attachCounts, setAttachCounts] = useState({})   // journal_number → count
  const [modalEntry,  setModalEntry]  = useState(null)
  const [cancellingId, setCancellingId] = useState(null)

  useEffect(() => { if (projectId) load(projectId, filter) }, [projectId])

  async function load(pid, f) {
    setLoading(true)
    let q = supabase.from('ledger_entries')
      .select('id,date,type,description,cash_in,bank_in,custody_in,cash_out,bank_out,custody_out,total_amount,status,journal_number,created_at,file_url')
      .eq('project_id', pid || projectId)
      .not('status', 'eq', 'cancelled')
      .order('date', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(500)
    if (f.from) q = q.gte('date', f.from)
    if (f.to)   q = q.lte('date', f.to)
    const { data } = await q
    const entries = data || []

    // جلب file_url من documents للقيود القديمة
    const missing = entries.filter(r => !r.file_url && r.journal_number).map(r => r.journal_number)
    let docMap = {}
    if (missing.length) {
      const { data: docs } = await supabase
        .from('documents')
        .select('journal_number,file_url,file_name')
        .in('journal_number', missing)
        .not('file_url', 'is', null)
      if (docs) docs.forEach(d => { if (d.file_url) docMap[d.journal_number] = d })
    }

    const mapped = entries.map(r =>
      (!r.file_url && docMap[r.journal_number])
        ? { ...r, file_url: docMap[r.journal_number].file_url, _doc_name: docMap[r.journal_number].file_name }
        : r
    )
    setRows(mapped)

    // جلب عدد المرفقات لكل قيد
    const jnums = [...new Set(mapped.map(r => r.journal_number).filter(Boolean))]
    if (jnums.length) {
      const { data: atts } = await supabase
        .from('attachments')
        .select('journal_number')
        .eq('project_id', pid || projectId)
        .in('journal_number', jnums)
      const counts = {}
      ;(atts || []).forEach(a => { counts[a.journal_number] = (counts[a.journal_number] || 0) + 1 })
      setAttachCounts(counts)
    }

    setLoading(false)
  }

  function refreshAttachCount(journalNumber) {
    load(projectId, filter)
  }

  async function handleCancel(entry) {
    if (!window.confirm(`حذف الحركة ${entry.journal_number || ''}؟\n"${entry.type}" — ${entry.date}\n\nلا يمكن التراجع عن هذا الإجراء.`)) return
    setCancellingId(entry.id)
    const { error } = await supabase
      .from('ledger_entries')
      .delete()
      .eq('id', entry.id)
    setCancellingId(null)
    if (error) { alert('فشل الحذف: ' + error.message); return }
    load(projectId, filter)
  }

  function setQuick(type) {
    setActivePeriod(type)
    const n = new Date()
    let from, to = n.toISOString().split('T')[0]
    if (type === 'month')     from = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`
    else if (type === 'lastMonth') {
      const lm = new Date(n.getFullYear(), n.getMonth() - 1, 1)
      const lme = new Date(n.getFullYear(), n.getMonth(), 0)
      from = lm.toISOString().split('T')[0]; to = lme.toISOString().split('T')[0]
    } else { from = `${n.getFullYear()}-01-01` }
    const f = { from, to }; setFilter(f)
    if (projectId) load(projectId, f)
  }

  const totals = useMemo(() => {
    const debit   = rows.reduce((s, r) => s + (r.cash_in  || 0) + (r.bank_in  || 0) + (r.custody_in  || 0), 0)
    const credit  = rows.reduce((s, r) => s + (r.cash_out || 0) + (r.bank_out || 0) + (r.custody_out || 0), 0)
    const cashIn  = rows.reduce((s, r) => s + (r.cash_in  || 0), 0)
    const cashOut = rows.reduce((s, r) => s + (r.cash_out || 0), 0)
    const bankIn  = rows.reduce((s, r) => s + (r.bank_in  || 0), 0)
    const bankOut = rows.reduce((s, r) => s + (r.bank_out || 0), 0)
    const custIn  = rows.reduce((s, r) => s + (r.custody_in  || 0), 0)
    const custOut = rows.reduce((s, r) => s + (r.custody_out || 0), 0)
    return { debit, credit, cashIn, cashOut, bankIn, bankOut, custIn, custOut }
  }, [rows])

  const fmt = v => v ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'

  const visibleRows = useMemo(() => {
    if (!search.trim()) return rows
    const s = search.trim().toLowerCase()
    return rows.filter(r =>
      (r.description    || '').toLowerCase().includes(s) ||
      (r.type           || '').toLowerCase().includes(s) ||
      (r.journal_number || '').toString().includes(s)
    )
  }, [rows, search])

  const cardBorder = { border: '1px solid #e8e5dc' }

  return (
    <div className="space-y-4">

      {/* رأس الصفحة */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: NAVY }}>سجل الحركات اليومية</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {visibleRows.length} حركة {search && rows.length !== visibleRows.length ? `(من ${rows.length})` : ''}
        </p>
      </div>

      {/* فلاتر */}
      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3" style={cardBorder}>
        <div className="text-sm font-bold uppercase tracking-wider text-center" style={{ color: '#8a7a5a' }}>الفترة الزمنية</div>
        <div className="flex flex-wrap gap-2 justify-center">
          {[
            { key: 'month',     label: 'الشهر الحالي' },
            { key: 'lastMonth', label: 'الشهر الماضي' },
            { key: 'year',      label: 'السنة الحالية' },
          ].map(q => (
            <button key={q.key} onClick={() => setQuick(q.key)}
              className="px-3 py-1.5 text-xs rounded-xl font-semibold transition-all"
              style={activePeriod === q.key
                ? { background: GOLD, color: NAVY }
                : { background: '#f5f4f0', color: '#4b5563' }}>
              {q.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 items-end justify-center">
          <div className="flex-1 min-w-[8rem]">
            <label className="text-xs text-slate-500 block mb-1 text-center">من</label>
            <input type="date" value={filter.from}
              onChange={e => { setActivePeriod('custom'); const f = { ...filter, from: e.target.value }; setFilter(f); load(projectId, f) }}
              className="w-full border rounded-xl px-3 py-1.5 text-sm focus:outline-none"
              style={{ borderColor: '#d1c9b8' }}/>
          </div>
          <div className="flex-1 min-w-[8rem]">
            <label className="text-xs text-slate-500 block mb-1 text-center">إلى</label>
            <input type="date" value={filter.to}
              onChange={e => { setActivePeriod('custom'); const f = { ...filter, to: e.target.value }; setFilter(f); load(projectId, f) }}
              className="w-full border rounded-xl px-3 py-1.5 text-sm focus:outline-none"
              style={{ borderColor: '#d1c9b8' }}/>
          </div>
          <div className="flex-1 min-w-[10rem]">
            <label className="text-xs text-slate-500 block mb-1">بحث بالبيان أو رقم القيد</label>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="فاتورة كهرباء أو QD-..."
              className="w-full border rounded-xl px-3 py-1.5 text-sm focus:outline-none"
              style={{ borderColor: '#d1c9b8' }}/>
          </div>
          <div className="flex-1 min-w-[8rem]">
            <div className="mb-1 h-4" />
            <button onClick={() => load(projectId, filter)}
              className="w-full px-4 py-1.5 rounded-xl text-sm font-bold transition-all text-center"
              style={{ background: NAVY, color: '#fff' }}>
              بحث
            </button>
          </div>
        </div>
      </div>

      {/* الجدول */}
      <div className="bg-white rounded-2xl shadow-sm overflow-x-auto" style={cardBorder}>
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: GOLD, borderTopColor: 'transparent' }}/>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: NAVY }}>
                <th className="px-4 py-3 text-right text-xs font-bold text-white">رقم القيد</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-white">التاريخ</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-white">نوع الحركة</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-white">البيان</th>
                <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: '#86efac' }}>مدين</th>
                <th className="px-4 py-3 text-right text-xs font-bold" style={{ color: '#fca5a5' }}>دائن</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-white">الحالة</th>
                <th className="px-4 py-3 text-center text-xs font-bold" style={{ color: GOLD }}>مستند</th>
                <th className="px-4 py-3 text-center text-xs font-bold" style={{ color: GOLD }}>مرفقات</th>
                {(role === 'accountant' || role === 'owner') && (
                  <th className="px-4 py-3 text-center text-xs font-bold text-white w-16">إلغاء</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: '#f5f4f0' }}>
              {visibleRows.length === 0 && (
                <tr><td colSpan={(role === 'accountant' || role === 'owner') ? 10 : 9}
                  className="text-center py-12 text-slate-400">
                  {search ? 'لا توجد نتائج للبحث' : 'لا توجد قيود في هذه الفترة'}
                </td></tr>
              )}
              {visibleRows.map((r, idx) => {
                const debit   = (r.cash_in  || 0) + (r.bank_in  || 0) + (r.custody_in  || 0)
                const credit  = (r.cash_out || 0) + (r.bank_out || 0) + (r.custody_out || 0)
                const badge   = STATUS_BADGE[r.status] || { bg: '#f5f4f0', color: '#6b7280' }
                const attCount = r.journal_number ? (attachCounts[r.journal_number] || 0) : 0
                const canAttach = ['approved','auto'].includes(r.status) && r.journal_number

                return (
                  <tr key={r.id} className="transition-colors hover:bg-amber-50/30">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-xs font-bold font-mono" style={{ color: GOLD }}>
                        {r.journal_number || `#${idx + 1}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap font-mono text-xs">{r.date}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs font-medium" style={{ color: NAVY }}>{r.type || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 max-w-48 truncate text-xs">{r.description || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {debit > 0 ? <span className="text-green-700 font-semibold text-xs">{fmt(debit)}</span> : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {credit > 0 ? <span className="text-red-600 font-semibold text-xs">{fmt(credit)}</span> : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={badge}>
                        {STATUS_LABEL[r.status] || r.status}
                      </span>
                    </td>
                    {/* عمود المستند الأصلي */}
                    <td className="px-4 py-3 text-center">
                      {r.file_url
                        ? <a href={r.file_url} target="_blank" rel="noreferrer"
                            title={r._doc_name || 'فتح المستند'}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors text-base"
                            style={{ background: '#fef9ec', color: GOLD }}
                            onMouseEnter={e => e.currentTarget.style.background = '#fef3c7'}
                            onMouseLeave={e => e.currentTarget.style.background = '#fef9ec'}>
                            📎
                          </a>
                        : <span className="text-slate-300 text-xs">—</span>
                      }
                    </td>
                    {/* عمود المرفقات الإضافية */}
                    <td className="px-4 py-3 text-center">
                      {canAttach ? (
                        <button onClick={() => setModalEntry(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all"
                          style={{ background: attCount > 0 ? NAVY : '#f5f4f0', color: attCount > 0 ? '#fff' : '#6b7280' }}
                          onMouseEnter={e => { e.currentTarget.style.background = NAVY; e.currentTarget.style.color = '#fff' }}
                          onMouseLeave={e => { e.currentTarget.style.background = attCount > 0 ? NAVY : '#f5f4f0'; e.currentTarget.style.color = attCount > 0 ? '#fff' : '#6b7280' }}>
                          📎 {attCount > 0 ? attCount : '+'}
                        </button>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>

                    {/* زر الإلغاء */}
                    {(role === 'accountant' || role === 'owner') && (
                      <td className="px-4 py-3 text-center">
                        {r.status !== 'cancelled' ? (
                          <button
                            onClick={() => handleCancel(r)}
                            disabled={cancellingId === r.id}
                            className="inline-flex items-center justify-center px-2.5 py-1 rounded-lg text-xs font-bold transition-all disabled:opacity-40"
                            style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#dc2626'; e.currentTarget.style.color = '#fff' }}
                            onMouseLeave={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = '#dc2626' }}>
                            {cancellingId === r.id
                              ? <div className="w-3 h-3 border-2 border-red-600 border-t-transparent rounded-full animate-spin"/>
                              : '✕ إلغاء'
                            }
                          </button>
                        ) : (
                          <span className="text-xs text-slate-300">ملغي</span>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
            {visibleRows.length > 0 && (
              <tfoot style={{ background: NAVY }}>
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-xs font-bold text-white">الإجمالي ({visibleRows.length} قيد)</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-xs" style={{ color: '#86efac' }}>{fmt(totals.debit)}</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-xs" style={{ color: '#fca5a5' }}>{fmt(totals.credit)}</td>
                  <td/><td/><td/>
                  {(role === 'accountant' || role === 'owner') && <td/>}
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>

      {/* مودال المرفقات */}
      {modalEntry && (
        <AttachModal
          entry={modalEntry}
          projectId={projectId}
          role={role}
          onClose={() => setModalEntry(null)}
          onAdded={refreshAttachCount}
        />
      )}
    </div>
  )
}
