import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const LOAN_TYPES = [
  { key:'car',   label:'💳 قسط سيارة',       type:'💳 قسط سيارة' },
  { key:'land',  label:'💳 قسط شراء أرض',    type:'💳 قسط شراء أرض' },
  { key:'loan1', label:'💳 قرض ١',            type:'💳 قرض ١' },
  { key:'loan2', label:'💳 قرض ٢',            type:'💳 قرض ٢' },
]

export default function Loans() {
  const { projectId } = useAuth()
  const [data, setData]   = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (projectId) load(projectId) }, [projectId])

  async function load(pid) {
    const { data: ledger } = await supabase.from('ledger_entries')
      .select('type,cash_out,bank_out,custody_out').eq('project_id', pid)

    const result = {}
    LOAN_TYPES.forEach(lt => {
      const paid = (ledger||[]).filter(r => r.type === lt.type)
        .reduce((s,r) => s+(r.cash_out||0)+(r.bank_out||0)+(r.custody_out||0), 0)
      result[lt.key] = { paid }
    })
    setData(result)
    setLoading(false)
  }

  const fmt = v => (v||0).toLocaleString('ar-SA', {minimumFractionDigits:2})

  if (loading) return <div className="flex justify-center h-64 items-center"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/></div>

  const totalPaid = LOAN_TYPES.reduce((s,lt) => s+(data[lt.key]?.paid||0), 0)

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-800">القروض والأقساط</h1>

      <div className="grid md:grid-cols-2 gap-4">
        {LOAN_TYPES.map(lt => {
          const paid = data[lt.key]?.paid || 0
          return (
            <div key={lt.key} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <div className="text-base font-semibold text-slate-800 mb-4">{lt.label}</div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">إجمالي المسدد</span>
                  <span className="font-semibold text-red-600 tabular-nums">{fmt(paid)} ر.س</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="bg-slate-800 rounded-xl p-5 text-white">
        <div className="flex justify-between items-center">
          <span className="font-medium">إجمالي الأقساط المسددة</span>
          <span className="text-xl font-bold tabular-nums">{fmt(totalPaid)} ر.س</span>
        </div>
      </div>
    </div>
  )
}
