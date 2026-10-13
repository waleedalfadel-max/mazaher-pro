import React, { useEffect, useRef, useState } from 'react'
import { Info, Landmark, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { fetchEveryRow } from '../lib/fetchAll.js'
import { Button, Panel } from '../ui/components.jsx'
import { formatNumber } from '../ui/format.js'

// القروض والأقساط بالهوية الجديدة. الحساب كما كان حرفيًا: لكل نوع قسط، مجموع خرج الصندوق والبنك والعهدة لقيوده غير الملغاة بالنوع
// نفسه تمامًا، والإجمالي مجموعها. التغيير: تُجلب قيود هذه الأنواع الأربعة وحدها كاملة بترتيب ثابت (كانت تُجلب كل قيود المنشأة بالجلب
// السابق بلا ترتيب ثابت ولا فحص خطأ، فيظهر صفر عند الفشل)، وفشل أي دفعة رسالة بإعادة محاولة بلا أرقام.

const LOAN_TYPES = [
  { key:'car',   label:'💳 قسط سيارة',       type:'💳 قسط سيارة' },
  { key:'land',  label:'💳 قسط شراء أرض',    type:'💳 قسط شراء أرض' },
  { key:'loan1', label:'💳 قرض ١',            type:'💳 قرض ١' },
  { key:'loan2', label:'💳 قرض ٢',            type:'💳 قرض ٢' },
]
const cleanLabel = s => String(s || '').replace(/^[^\p{L}\p{N}]+/u, '').trim() || String(s || '')
const fmt = v => formatNumber(v || 0, 2)
const reason = error => (/failed to fetch|network|load failed/i.test(error?.message || '') ? 'تعذّر الاتصال بالخادم؛ تحقق من الاتصال ثم أعد المحاولة.' : (error?.message || 'خطأ غير معروف'))

export default function Loans() {
  const { projectId } = useAuth()
  const [data, setData]       = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const loadSeq = useRef(0)

  useEffect(() => { if (projectId) load(projectId) }, [projectId])

  async function load(pid) {
    const seq = ++loadSeq.current
    setLoading(true); setLoadError('')
    const res = await fetchEveryRow(() => supabase.from('ledger_entries')
      .select('type,cash_out,bank_out,custody_out').eq('project_id', pid)
      .neq('status', 'cancelled')
      .in('type', LOAN_TYPES.map(lt => lt.type))
      .order('id'))
    if (seq !== loadSeq.current) return
    if (res.error) { setData({}); setLoadError(reason(res.error)); setLoading(false); return }
    const result = {}
    LOAN_TYPES.forEach(lt => {
      const paid = res.data.filter(r => r.type === lt.type)
        .reduce((s,r) => s+(r.cash_out||0)+(r.bank_out||0)+(r.custody_out||0), 0)
      result[lt.key] = { paid }
    })
    setData(result)
    setLoading(false)
  }

  const totalPaid = LOAN_TYPES.reduce((s,lt) => s+(data[lt.key]?.paid||0), 0)

  return (
    <div className="ldg-page lns-page">
      <div className="ts-heading">
        <div>
          <h1>القروض والأقساط</h1>
          <p className="ldg-showing"><Landmark className="ts-icon--sm" aria-hidden="true" /><span>المسدد من الدفتر لكل نوع قسط، منذ بداية السجل</span></p>
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
            {LOAN_TYPES.map(lt => (
              <div key={lt.key} className="lns-card" data-loan={lt.key}>
                <span className="lns-title">{cleanLabel(lt.label)}</span>
                <div className="lns-row"><span>إجمالي المسدد</span><strong className="ts-num" data-k="paid">{fmt(data[lt.key]?.paid || 0)}</strong></div>
              </div>
            ))}
          </div>
          <div className="lns-total" data-k="loans.total">
            <span>إجمالي الأقساط المسددة</span>
            <strong className="ts-num">{fmt(totalPaid)}</strong>
          </div>
        </>
      )}
    </div>
  )
}
