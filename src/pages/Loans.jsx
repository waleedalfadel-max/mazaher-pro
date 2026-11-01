import React, { useEffect, useRef, useState } from 'react'
import { Info, Landmark, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { fetchEveryRow } from '../lib/fetchAll.js'
import { Button, Panel } from '../ui/components.jsx'
import { formatNumber } from '../ui/format.js'

import { getProjectSettings } from '../lib/projectSettings.js'
import { LOAN_TYPES, LOAN_ENTRY_TYPES, cleanLoanLabel, loanFigures } from '../lib/loanBalances.js'
import { todayIn } from '../lib/analysisPeriods.js'

const fmt = v => formatNumber(v || 0, 2)
const reason = error => (/failed to fetch|network|load failed/i.test(error?.message || '') ? 'تعذّر الاتصال بالخادم؛ تحقق من الاتصال ثم أعد المحاولة.' : (error?.message || 'خطأ غير معروف'))

export default function Loans() {
  const { projectId } = useAuth()
  const [data, setData]       = useState({})
  const [figures, setFigures] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const loadSeq = useRef(0)

  useEffect(() => { if (projectId) load(projectId) }, [projectId])

  async function load(pid) {
    const seq = ++loadSeq.current
    setLoading(true); setLoadError('')
    try {
      const to = todayIn()
      const [res, setup] = await Promise.all([
        fetchEveryRow(() => supabase.from('ledger_entries')
          .select('type,date,status,cash_out,bank_out,custody_out').eq('project_id', pid)
          .neq('status', 'cancelled').in('type', LOAN_ENTRY_TYPES).order('id')),
        getProjectSettings(pid),
      ])
      if (seq !== loadSeq.current) return
      if (res.error || !setup?.settings) throw res.error || new Error('تعذّر تحميل أرصدة القروض.')
      const result = {}
      LOAN_TYPES.forEach(lt => {
        // Preserve the legacy paid-only view for projects without documented balances.
        result[lt.key] = { paid: res.data.filter(r => r.type === lt.type)
          .reduce((sum, r) => sum + Number(r.cash_out || 0) + Number(r.bank_out || 0) + Number(r.custody_out || 0), 0) }
      })
      setData(result)
      setFigures(loanFigures(res.data, setup.settings, to))
    } catch (error) {
      if (seq !== loadSeq.current) return
      setData({}); setFigures(null); setLoadError(reason(error))
    }
    setLoading(false)
  }

  const totalPaid = LOAN_TYPES.reduce((s,lt) => s+(data[lt.key]?.paid||0), 0)

  return (
    <div className="ldg-page lns-page">
      <div className="ts-heading">
        <div>
          <h1>القروض والأقساط</h1>
          <p className="ldg-showing"><Landmark className="ts-icon--sm" aria-hidden="true" /><span>{figures?.tracked ? <>الأرصدة المتبقية والمسدد المعتمد حتى <bdi style={{whiteSpace:'nowrap'}}>{todayIn()}</bdi></> : 'المسدد من الدفتر لكل نوع قسط، منذ بداية السجل'}</span></p>
        </div>
      </div>

      {loading ? (
        <Panel><div className="ldg-loading" aria-busy="true">جارٍ تحميل الأقساط…</div></Panel>
      ) : loadError ? (
        <div className="ts-note ts-note--error ldg-load-error" data-k="loans.loadError" role="alert">
          <Info className="ts-icon" aria-hidden="true" />
          <div className="ts-note-body">
            <strong>تعذّر تحميل قيود الأقساط كاملة، فلم تُعرض المبالغ.</strong>
            مبلغ من قيود ناقصة يكون أقل من الحقيقي. {loadError}
            <div className="ts-note-action"><Button size="sm" variant="primary" icon={RefreshCw} onClick={() => load(projectId)}>إعادة المحاولة</Button></div>
          </div>
        </div>
      ) : (
        <>
          <div className="lns-grid" data-k="loans.cards">
            {(figures?.loans || LOAN_TYPES).map(lt => (
              <div key={lt.key} className="lns-card" data-loan={lt.key}>
                <span className="lns-title">{cleanLoanLabel(lt.label)}</span>
                {figures?.tracked && <>
                  <div className="lns-row"><span>المتبقي المستحق</span><strong className="ts-num" data-k="remaining">{lt.remaining == null ? (lt.tracked ? 'غير محدد' : 'غير مسجل') : fmt(lt.remaining)}</strong></div>
                  {lt.baseline && <p className="ts-field-hint">الرصيد المثبت: {fmt(lt.baseline.balance)} · بتاريخ <bdi style={{whiteSpace:'nowrap'}}>{lt.baseline.date}</bdi></p>}
                  {lt.change != null && <p className="ts-field-hint">صافي السداد بعد تثبيت الرصيد: {fmt(lt.change)}</p>}
                  {lt.excess > 0 && <p className="ts-note ts-note--warning">السداد يتجاوز الرصيد بـ {fmt(lt.excess)}؛ راجع القرض.</p>}
                </>}
                <div className="lns-row"><span>{figures?.tracked ? 'المسدد المعتمد منذ بداية السجل' : 'إجمالي المسدد'}</span><strong className="ts-num" data-k="paid">{fmt(figures?.tracked ? lt.paid : data[lt.key]?.paid || 0)}</strong></div>
              </div>
            ))}
          </div>
          {figures?.tracked && <>
            <div className="lns-total" data-k="loans.remaining"><span>إجمالي المتبقي من القروض المسجلة</span><strong className="ts-num">{figures.total == null ? 'غير محدد' : fmt(figures.total)}</strong></div>
            <p className="ts-field-hint">الأقساط السابقة داخلة في الرصيد المثبت، ولا تُخصم مرة ثانية. القرض الذي لم يُسجّل رصيده لا يدخل الإجمالي.</p>
          </>}
          <div className="lns-total" data-k="loans.total">
            <span>إجمالي الأقساط المسددة</span>
            <strong className="ts-num">{fmt(figures?.tracked ? figures.loans.reduce((sum, l) => sum + l.paid, 0) : totalPaid)}</strong>
          </div>
        </>
      )}
    </div>
  )
}
