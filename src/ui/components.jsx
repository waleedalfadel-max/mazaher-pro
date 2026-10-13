// مكوّنات تحسيب المشتركة: عرض فقط، بلا بيانات وبلا اتصال. الأنماط في theme.css.
import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, CircleCheck, Search, X } from 'lucide-react'
import { dayTextToIso, formatNumber, isoToDayText } from './format.js'

const cx = (...parts) => parts.filter(Boolean).join(' ')

/** علامة تحسيب (عائلة التجزئة) مع اسم المنتج. مؤقتة إلى أن يُعتمد الشعار. */
export function Brand({ product, dark = false, small = false }) {
  return (
    <div role="img" aria-label={product ? `تحسيب ${product}` : 'تحسيب'} className={cx('ts-brand', dark && 'ts-brand--dark', small && 'ts-brand--small')}>
      <div className="ts-mark" aria-hidden="true"><span /><span /><span /></div>
      <div aria-hidden="true">
        <div className="ts-wordmark">تحسيب</div>
        {product && <span className="ts-product">{product}</span>}
      </div>
    </div>
  )
}

export function Button({ variant = 'secondary', size, icon: Icon, full, className, children, type = 'button', ...props }) {
  return (
    <button type={type} className={cx('ts-btn', variant !== 'secondary' && `ts-btn--${variant}`, size && `ts-btn--${size}`, full && 'ts-btn--full', className)} {...props}>
      {Icon && <Icon className="ts-icon" aria-hidden="true" />}
      {children}
    </button>
  )
}

export function IconButton({ label, icon: Icon, bare, className, ...props }) {
  return (
    <button type="button" aria-label={label} title={label} className={cx('ts-icon-btn', bare && 'ts-icon-btn--bare', className)} {...props}>
      <Icon className="ts-icon" aria-hidden="true" />
    </button>
  )
}

/** حقل بعنوان وتلميح وخطأ. `machine` يعلّم الحقل الذي عبّأته القراءة الآلية ولم يُؤكَّد. */
export function Field({ label, hint, error, machine, span, children, id: givenId }) {
  const autoId = useId()
  const id = givenId || autoId
  const child = React.isValidElement(children)
    ? React.cloneElement(children, { id, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': hint || error ? `${id}-hint` : undefined })
    : children
  return (
    <div className={cx('ts-field', machine && 'ts-field--machine', span && 'ts-span')}>
      <label htmlFor={id} className="ts-field-label">
        {label}
        {machine && <span className="ts-sr">(قرأه النظام آليًا)</span>}
      </label>
      {child}
      {(error || hint) && <span id={`${id}-hint`} className={error ? 'ts-field-error' : 'ts-field-hint'}>{error || hint}</span>}
    </div>
  )
}

export const Input = React.forwardRef(function Input({ numeric, className, ...props }, ref) {
  return <input ref={ref} className={cx('ts-input', numeric && 'ts-input--num', className)} inputMode={numeric ? 'decimal' : undefined} {...props} />
})

/**
 * تاريخ يُكتب ويُعرض بأرقام لاتينية (يوم/شهر/سنة) مهما كانت لغة المتصفح، مع زر لتقويم المتصفح.
 * القيمة الداخلية ISO ‏(2026-09-25).
 */
// onValidityChange (اختياري): يُبلَّغ مع كل كتابة هل النص المكتوب تاريخ صحيح، لأن onChange لا يُستدعى للنص الفارغ أو غير الصحيح
// فتبقى القيمة السابقة مخفية؛ من يحفظ بها يحتاج أن يعرف أن ما على الشاشة ليس تاريخًا.
export function DateInput({ value, onChange, onValidityChange, max, disabled, className, ...props }) {
  const [text, setText] = useState(isoToDayText(value))
  const picker = useRef(null)
  useEffect(() => { setText(isoToDayText(value)) }, [value])
  const invalid = text && !dayTextToIso(text)
  return (
    <div className={cx('ts-date', className)}>
      <input className="ts-input ts-input--num" value={text} placeholder="يوم/شهر/سنة" inputMode="numeric" disabled={disabled}
        {...props} aria-invalid={invalid ? 'true' : props['aria-invalid']}
        onChange={e => { setText(e.target.value); const iso = dayTextToIso(e.target.value); const ok = !!iso && (!max || iso <= max); onValidityChange?.(ok); if (ok) onChange(iso) }} />
      <button type="button" className="ts-date-btn" aria-label="اختيار من التقويم" disabled={disabled}
        onClick={() => { try { picker.current?.showPicker() } catch { picker.current?.focus() } }}>
        <CalendarDays className="ts-icon--sm" aria-hidden="true" />
      </button>
      <input ref={picker} type="date" className="ts-date-native" tabIndex={-1} aria-hidden="true" value={value || ''} max={max} onChange={e => { if (e.target.value) { onValidityChange?.(true); onChange(e.target.value) } }} />
    </div>
  )
}

export function Select({ options, className, placeholder, ...props }) {
  return (
    <select className={cx('ts-input', className)} {...props}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function Textarea(props) {
  return <textarea className="ts-input" {...props} />
}

/** نص من سطر واحد يلتف ويطول مع المحتوى، فلا يُقص الاسم الطويل. Enter لا يضيف سطرًا. */
export function GrowInput({ value, onChange, className, ...props }) {
  const ref = useRef(null)
  useEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px' } }, [value])
  return (
    <textarea ref={ref} rows={1} className={cx('ts-input ts-input--grow', className)} value={value}
      onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }}
      onChange={e => onChange({ target: { value: e.target.value.replace(/[\r\n]+/g, ' ') } })} {...props} />
  )
}

/** مبلغ بأرقام واضحة وعملة صغيرة. */
export function Money({ value, decimals = 2, currency = 'ر.س', className }) {
  return (
    <span className={cx('ts-money', className)}>
      <span className="ts-num">{formatNumber(value, decimals)}</span>
      {currency && <small>{currency}</small>}
    </span>
  )
}

export function Status({ tone = 'success', busy, children }) {
  return <span className={cx('ts-status', tone !== 'success' && `ts-status--${tone}`, busy && 'ts-status--busy')}>{children}</span>
}

export function Chip({ icon: Icon, children }) {
  return <span className="ts-chip">{Icon && <Icon className="ts-icon--sm" aria-hidden="true" />}{children}</span>
}

export function Note({ tone = 'info', icon: Icon, title, children, action, facts, details }) {
  return (
    <div className={cx('ts-note', `ts-note--${tone}`)} role={tone === 'error' ? 'alert' : undefined}>
      {Icon && <Icon className="ts-icon" aria-hidden="true" />}
      <div className="ts-note-body">
        {title && <strong>{title}</strong>}
        {facts && (
          <dl className="ts-facts">
            {facts.map(f => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
          </dl>
        )}
        {children}
        {details && <details className="ts-note-details"><summary>التفاصيل</summary>{details}</details>}
        {action && <div className="ts-note-action">{action}</div>}
      </div>
    </div>
  )
}

/** مفتاح تشغيل وإيقاف بتسمية ظاهرة. */
export function Switch({ label, hint, checked, onChange, disabled }) {
  const id = useId()
  return (
    <div className={cx('ts-switch-row', disabled && 'is-disabled')}>
      <div>
        <label htmlFor={id} className="ts-switch-label">{label}</label>
        {hint && <div className="ts-field-hint">{hint}</div>}
      </div>
      <button id={id} type="button" role="switch" aria-checked={!!checked} disabled={disabled} className="ts-switch" onClick={() => onChange(!checked)}>
        <span aria-hidden="true" />
      </button>
    </div>
  )
}

/** مربع اختيار بنص كامل قابل للنقر. */
export function Check({ label, hint, checked, onChange, disabled }) {
  return (
    <label className={cx('ts-check', disabled && 'is-disabled')}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span>{label}{hint && <span className="ts-field-hint" style={{ display: 'block' }}>{hint}</span>}</span>
    </label>
  )
}

export function Panel({ title, icon: Icon, subtitle, action, children, clip, className }) {
  return (
    <section className={cx('ts-panel', clip && 'ts-panel--clip', className)}>
      {(title || action) && (
        <div className="ts-panel-head">
          <div>
            {title && <h2>{Icon && <Icon className="ts-icon" aria-hidden="true" />}{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** بطاقة رقم رئيسي. `as` يسمح بجعلها رابطًا. */
export function Metric({ label, icon: Icon, tag, children, foot, tone, as: As = 'div', ...props }) {
  return (
    <As className={cx('ts-metric', tone && `ts-metric--${tone}`)} {...props}>
      <div className="ts-metric-top">
        {Icon && <span className="ts-metric-icon"><Icon className="ts-icon" aria-hidden="true" /></span>}
        <span className="ts-metric-label">{label}</span>
        {tag && <span className="ts-metric-tag">{tag}</span>}
      </div>
      <div className="ts-metric-value">{children}</div>
      {foot && <div className="ts-metric-foot">{foot}</div>}
    </As>
  )
}

export function Segment({ label, options, value, onChange, full }) {
  return (
    <div className={cx('ts-segment', full && 'ts-segment--full')} role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function Tabs({ label, tabs, value, onChange }) {
  return (
    <div className="ts-tabs" role="tablist" aria-label={label}>
      {tabs.map(t => (
        <button key={t.value} type="button" role="tab" className="ts-tab" aria-selected={t.value === value} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count != null && <span className="ts-num">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function SearchBox({ label, value, onChange, placeholder }) {
  return (
    <label className="ts-search">
      <Search className="ts-icon" aria-hidden="true" />
      <span className="ts-sr">{label}</span>
      <input type="search" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
      {value && <button type="button" className="ts-icon-btn ts-icon-btn--bare" style={{ width: 28, height: 28, minHeight: 0 }} aria-label="مسح البحث" onClick={() => onChange('')}><X className="ts-icon--sm" /></button>}
    </label>
  )
}

/** اختيار واحد من قائمة، بعناصر كبيرة تصلح للمس. */
export function ChoiceList({ label, options, value, onChange }) {
  return (
    <div className="ts-choice-list" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className="ts-choice" onClick={() => onChange(o.value)}>
          <span className="ts-choice-dot" aria-hidden="true" />
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** حوار في الوسط على الكمبيوتر، وورقة سفلية على الجوال. Esc يغلقه. */
export function Dialog({ open, title, description, onClose, children, footer }) {
  const ref = useRef(null)
  const titleId = useId()
  const close = useRef(onClose)
  close.current = onClose
  // يُركَّز أول عنصر عند الفتح فقط، لا مع كل إعادة رسم
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    // أول حقل إن وُجد، وإلا الحوار نفسه (لا زر الإغلاق)
    const field = ref.current?.querySelector('input:not([type="checkbox"]):not([disabled]), select, textarea')
    ;(field || ref.current)?.focus({ preventScroll: true })
    const onKey = e => { if (e.key === 'Escape') close.current() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.() }
  }, [open])
  if (!open) return null
  return createPortal(
    <div className="ts-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} className="ts-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="ts-dialog-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <IconButton label="إغلاق" icon={X} bare onClick={onClose} />
        </div>
        <div className="ts-dialog-body">{children}</div>
        {footer && <div className="ts-dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function EmptyState({ icon: Icon, children, action }) {
  return (
    <div className="ts-empty">
      {Icon && <Icon aria-hidden="true" />}
      <div>{children}</div>
      {action}
    </div>
  )
}

const ToastContext = createContext(() => {})
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const show = useCallback(text => {
    const id = Math.random().toString(36).slice(2)
    setToasts(list => [...list, { id, text }])
    setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), 3200)
  }, [])
  return (
    <ToastContext.Provider value={show}>
      {children}
      {createPortal(
        <div className="ts-toasts" role="status" aria-live="polite">
          {toasts.map(t => <div key={t.id} className="ts-toast"><CircleCheck className="ts-icon" aria-hidden="true" />{t.text}</div>)}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}
export const useToast = () => useContext(ToastContext)
