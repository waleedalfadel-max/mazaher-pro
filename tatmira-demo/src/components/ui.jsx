import React, { useEffect, useRef, useState } from 'react'
import {
  fmt, inputValue, isValidMoneyField, isValidQuantityField, moneyFieldValue, quantityFieldValue, toHalalas, toQuantity,
} from '../lib/money.js'

export const NAVY = '#1B3A5C'
export const TEAL = '#6EB7B0'

export function PageTitle({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-extrabold" style={{ color: NAVY }}>{title}</h1>
        {subtitle && <p className="text-sm mt-0.5" style={{ color: '#5A7A8A' }}>{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function Card({ children, className = '', ...rest }) {
  return (
    <div className={`bg-white rounded-2xl border border-border shadow-sm ${className}`} {...rest}>
      {children}
    </div>
  )
}

const BTN = {
  primary:   { background: TEAL, color: '#fff' },
  navy:      { background: NAVY, color: '#fff' },
  secondary: { background: '#EEF4F3', color: NAVY },
  danger:    { background: '#FDECEC', color: '#B42318' },
  whatsapp:  { background: '#25D366', color: '#fff' },
}

/** زر يمنع الضغط المتكرر أثناء تنفيذ onClick غير المتزامن */
export function Button({ variant = 'primary', onClick, disabled, children, className = '', type = 'button', ...rest }) {
  const busy = useRef(false)
  const [running, setRunning] = useState(false)
  async function handle(e) {
    if (busy.current || disabled) return
    busy.current = true
    setRunning(true)
    try { await onClick?.(e) } finally { busy.current = false; setRunning(false) }
  }
  return (
    <button type={type} onClick={handle} disabled={disabled || running}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] ${className}`}
      style={BTN[variant]} {...rest}>
      {children}
    </button>
  )
}

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-bold mb-1" style={{ color: '#5A7A8A' }}>{label}</span>
      {children}
      {hint && !error && <span className="block text-xs mt-1" style={{ color: '#8FAAAA' }}>{hint}</span>}
      {error && <span className="block text-xs mt-1 font-bold text-red-600">{error}</span>}
    </label>
  )
}

export const inputClass = 'w-full px-3 py-2.5 rounded-xl border border-border bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:bg-surface disabled:text-slate-500'

export function TextInput(props) {
  return <input {...props} className={`${inputClass} ${props.className || ''}`} />
}

export function Select({ children, ...props }) {
  return <select {...props} className={`${inputClass} ${props.className || ''}`}>{children}</select>
}

/** حقل مبلغ: يعرض ريالات ويعيد هللات. يُحدَّث عند الخروج من الحقل. */
function InvalidHint({ show }) {
  if (!show) return null
  return <span role="alert" className="block text-[11px] mt-0.5 font-bold text-red-600">رقم غير صالح</span>
}

/**
 * حقل مبلغ: يعرض ريالات ويعيد هللات. النص غير الصالح يُمرَّر كما هو (نص) بدل الاحتفاظ بالقيمة
 * السابقة، فيظهر الخطأ ويُمنع الاعتماد حتى يُصحَّح.
 */
export function MoneyInput({ value, onChange, disabled, ...rest }) {
  const shown = v => (typeof v === 'string' ? v : inputValue(v))
  const [text, setText] = useState(shown(value))
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setText(shown(value)) }, [value])
  const bad = !isValidMoneyField(moneyFieldValue(text))
  return (
    <span className="block">
      <input inputMode="decimal" dir="ltr" disabled={disabled} value={text} aria-invalid={bad || undefined}
        onFocus={() => { focused.current = true }}
        onChange={e => { setText(e.target.value); onChange(moneyFieldValue(e.target.value)) }}
        onBlur={() => { focused.current = false; if (!bad) setText(inputValue(toHalalas(text))) }}
        className={`${inputClass} text-left num ${bad ? '!border-red-500 ring-2 ring-red-200' : ''}`} {...rest} />
      <InvalidHint show={bad} />
    </span>
  )
}

/** حقل كمية: يقبل ١٢ أو 12 أو ٢٫٥. النص غير الصالح يُمرَّر كما هو ويُمنع الاعتماد حتى يُصحَّح. */
export function QuantityInput({ value, onChange, disabled, ...rest }) {
  const shown = v => (v === undefined || v === null ? '' : String(v))
  const [text, setText] = useState(shown(value))
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setText(shown(value)) }, [value])
  const bad = !isValidQuantityField(quantityFieldValue(text))
  return (
    <span className="block">
      <input inputMode="decimal" dir="ltr" disabled={disabled} value={text} aria-invalid={bad || undefined}
        onFocus={() => { focused.current = true }}
        onChange={e => { setText(e.target.value); onChange(quantityFieldValue(e.target.value)) }}
        onBlur={() => { focused.current = false; if (!bad && text !== '') setText(String(toQuantity(text))) }}
        className={`${inputClass} text-left num ${bad ? '!border-red-500 ring-2 ring-red-200' : ''}`} {...rest} />
      <InvalidHint show={bad} />
    </span>
  )
}

/** رسالة موحدة قبل زر الاعتماد أو التأكيد */
export function InvalidInputsNotice({ fields }) {
  if (!fields?.length) return null
  return (
    <div role="alert" className="px-3 py-2.5 rounded-xl text-sm font-bold" style={{ background: '#FEF2F2', color: '#B42318', border: '1px solid #FECACA' }}>
      قيمة غير صالحة في: {fields.join('، ')} — صحّحها أولاً. لن يُستخدم أي رقم سابق بدلاً منها.
    </div>
  )
}

export function Money({ value, className = '', strong }) {
  return (
    <span className={`num whitespace-nowrap ${strong ? 'font-extrabold' : ''} ${className}`}>
      {fmt(value)} <span className="text-[0.75em] font-normal opacity-70">ر.س</span>
    </span>
  )
}

const BADGE = {
  pending:  { background: '#FEF3C7', color: '#92400E' },
  approved: { background: '#DCFCE7', color: '#166534' },
  rejected: { background: '#F1F5F9', color: '#475569' },
  unpaid:   { background: '#FDECEC', color: '#B42318' },
  partial:  { background: '#FEF3C7', color: '#92400E' },
  paid:     { background: '#DCFCE7', color: '#166534' },
  sample:   { background: '#EDE9FE', color: '#5B21B6' },
  neutral:  { background: '#EEF4F3', color: NAVY },
}

export function Badge({ tone = 'neutral', children }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap" style={BADGE[tone]}>
      {children}
    </span>
  )
}

export function Notice({ tone = 'info', children, className = '' }) {
  const styles = {
    info:    { background: '#E8F5F4', color: NAVY, border: '1px solid #D4E8E6' },
    warning: { background: '#FFFBEB', color: '#92400E', border: '1px solid #FCD34D' },
    error:   { background: '#FEF2F2', color: '#B42318', border: '1px solid #FECACA' },
    success: { background: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' },
  }
  return <div className={`px-3 py-2.5 rounded-xl text-sm ${className}`} style={styles[tone]}>{children}</div>
}

export function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center no-print" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="font-extrabold" style={{ color: NAVY }}>{title}</h2>
          <button onClick={onClose} className="w-9 h-9 rounded-xl text-lg" style={{ background: '#EEF4F3', color: NAVY }} aria-label="إغلاق">×</button>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-border flex flex-wrap gap-2 justify-end">{footer}</div>}
      </div>
    </div>
  )
}

export function Empty({ children }) {
  return <div className="text-center text-sm py-8" style={{ color: '#8FAAAA' }}>{children}</div>
}

export function Stat({ label, value, note, tone }) {
  const color = tone === 'good' ? '#2D9B6F' : tone === 'bad' ? '#E05C5C' : NAVY
  return (
    <Card className="p-3 sm:p-4">
      <div className="text-xs font-bold" style={{ color: '#5A7A8A' }}>{label}</div>
      <div className="text-lg sm:text-xl mt-1" style={{ color }}><Money value={value} strong /></div>
      {note && <div className="text-[11px] mt-1 leading-snug" style={{ color: '#8FAAAA' }}>{note}</div>}
    </Card>
  )
}

export const DEMO_LABEL = 'نموذج تجريبي — ليس فاتورة ضريبية'
