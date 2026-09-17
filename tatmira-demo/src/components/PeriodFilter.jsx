import React from 'react'
import { todayISO } from '../lib/ledger.js'
import { inputClass } from './ui.jsx'

export function monthRange(offset = 0, today = new Date()) {
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1)
  const last = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0)
  return { from: todayISO(first), to: todayISO(last) }
}

export const ALL_TIME = { from: '', to: '' }

export default function PeriodFilter({ value, onChange }) {
  const presets = [
    { label: 'هذا الشهر', range: monthRange(0) },
    { label: 'الشهر السابق', range: monthRange(-1) },
    { label: 'كل الفترات', range: ALL_TIME },
  ]
  const same = r => r.from === value.from && r.to === value.to
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {presets.map(p => (
          <button key={p.label} onClick={() => onChange(p.range)}
            className="px-3 py-1.5 rounded-full text-xs font-bold border"
            style={same(p.range)
              ? { background: '#1B3A5C', color: '#fff', borderColor: '#1B3A5C' }
              : { background: '#fff', color: '#1B3A5C', borderColor: '#D4E8E6' }}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-bold" style={{ color: '#5A7A8A' }}>
          من
          <input type="date" value={value.from} max={value.to || undefined}
            onChange={e => onChange({ ...value, from: e.target.value })} className={`${inputClass} mt-1`} />
        </label>
        <label className="text-xs font-bold" style={{ color: '#5A7A8A' }}>
          إلى
          <input type="date" value={value.to} min={value.from || undefined}
            onChange={e => onChange({ ...value, to: e.target.value })} className={`${inputClass} mt-1`} />
        </label>
      </div>
    </div>
  )
}
