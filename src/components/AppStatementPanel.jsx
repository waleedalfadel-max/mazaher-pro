// كشف حساب تطبيقات التوصيل في «التقارير»: الرصيد الدفتري من القيود، ورصيد كشف التطبيق الخارجي كما يُدخله المحاسب، والفرق بينهما.
// لا يُنشئ قيدًا ولا رصيدًا افتتاحيًا؛ سجل «رصيد كشف التطبيق» للمقارنة وحدها (20261023120000).
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button, DateInput, EmptyState, Field, Input, Money, Note, Panel, Select, Textarea } from '../ui/components.jsx'
import { formatDate } from '../ui/format.js'
import { APPS, balanceNote, comparisonText, parseStatementBalance, preSystemNote } from '../lib/appStatement.js'

const ERR = { forbidden: 'تسجيل رصيد كشف التطبيق للمحاسب وإدارة تحسيب.', no_session: 'انتهت الجلسة؛ ادخل من جديد.', invalid: 'راجع التاريخ والرصيد (منزلتان عشريتان) والمصدر.',
  reason_required: 'اكتب سبب الإلغاء.', not_found: 'السجل غير موجود. حدّث الصفحة.', already_voided: 'أُلغي هذا السجل من قبل.' }
const amount = v => (v === null || v === undefined ? '—' : <Money value={v} />)

export default function AppStatementPanel({ app, onApp, apps, statement, comparison, checkpoints, unassigned, branchFiltered, canRecord, onChanged, loading, error, onRetry, to }) {
  // النموذج مربوط بالتطبيق الذي فُتح له (form.app)، لا بالتطبيق المعروض: تغيير التطبيق أثناء التحرير لا ينقل البيانات إليه
  const [form, setForm] = useState(null), [busy, setBusy] = useState(false), [formError, setFormError] = useState(''), [voiding, setVoiding] = useState(null), [saved, setSaved] = useState('')
  const labelOf = k => APPS.find(a => a.key === k)?.label || k
  const label = labelOf(app)
  const formBalance = form ? parseStatementBalance(form.balance) : null
  const formMismatch = !!form && form.app !== app
  const appOptions = APPS.map(a => ({ value: a.key, label: a.label + (apps.includes(a.key) ? '' : ' (بلا حركة)') }))
  async function call(fn, args) {
    setBusy(true); setFormError('')
    try {
      const { data, error: e } = await supabase.rpc(fn, args)
      if (e || !data?.ok) { setFormError(ERR[data?.code] || 'تعذّر الحفظ. حدّث الصفحة للتحقق قبل إعادة المحاولة.'); return false }
      await onChanged(); return true
    } catch { setFormError('تعذّر الاتصال. حدّث الصفحة للتحقق قبل إعادة المحاولة.'); return false } finally { setBusy(false) }
  }
  const mine = (checkpoints || []).filter(c => c.app === app)
  const ready = !loading && !error && statement
  return (
    <div className="rpt-section" data-k="app-statement">
      <Panel title="كشف حساب التطبيق — المنشأة كاملة" subtitle="تحصيل التطبيقات يُسجَّل على مستوى المنشأة، فالكشف للمنشأة كلها ولا يُعرض كشفًا لفرع. عمود الفرع للبيان فقط.">
        <div className="ts-panel-body">
          {branchFiltered && <div data-k="app-branch-note"><Note tone="info">اختيار الفرع في أعلى الصفحة لا يُطبَّق على هذا الكشف: مبيعات فرع وحده لا تُقابَل بتحصيلات المنشأة كلها. توزيع التحصيلات على الفروع غير متاح بعد.</Note></div>}
          <Field label="التطبيق" hint={busy ? 'جارٍ الحفظ؛ يُتاح تغيير التطبيق بعد انتهائه.' : undefined}>
            <Select data-k="app-select" value={app} options={appOptions} disabled={busy} onChange={e => { setSaved(''); onApp(e.target.value) }} /></Field>
          {error && <Note tone="error" action={<Button size="sm" onClick={onRetry}>إعادة المحاولة</Button>}>{error}</Note>}
          {loading && <p className="ts-muted">جارٍ تحميل الكشف…</p>}
          {ready && <>
            <div className="ts-form-grid" data-k="app-summary">
              <div><span className="ts-muted">رصيد بداية الفترة (من قيود تحسيب السابقة)</span><div data-k="app-opening"><Money value={statement.opening} /></div></div>
              <div><span className="ts-muted">مبيعات الفترة</span><div data-k="app-sales"><Money value={statement.totals.sales} /></div></div>
              <div><span className="ts-muted">تحصيلات الفترة</span><div data-k="app-collections"><Money value={statement.totals.collections} /></div></div>
              <div><span className="ts-muted">تسويات الفترة (عمولات وتصحيحات)</span><div data-k="app-settlements"><Money value={statement.totals.settlements} /></div></div>
              <div><strong>الرصيد الدفتري في {formatDate(to, { year: true })}</strong><div data-k="app-book-balance" style={{ color: statement.closing < 0 ? '#b91c1c' : undefined }}><Money value={statement.closing} /></div></div>
            </div>
            <div data-k="app-balance-note"><Note tone={statement.closing < 0 ? 'warning' : 'info'}>{balanceNote(statement.closing)}</Note></div>
            <p className="ts-muted" data-k="app-presystem">{preSystemNote(statement.firstRecorded)}</p>
          </>}
        </div>
      </Panel>

      {ready && (
        <Panel title="المقارنة مع كشف التطبيق الخارجي" subtitle="رصيد كشف التطبيق كما يظهر في كشف التطبيق نفسه، مقابل الرصيد الدفتري حتى التاريخ نفسه. الإدخال للمقارنة فقط ولا يغيّر القيود أو الذمم.">
          <div className="ts-panel-body" data-k="app-comparison">
            {comparison ? <>
              <div className="ts-form-grid">
                <div><span className="ts-muted">رصيد كشف التطبيق في {formatDate(comparison.date, { year: true })}</span><div data-k="cmp-statement"><Money value={comparison.statementBalance} /></div></div>
                <div><span className="ts-muted">الرصيد الدفتري حتى {formatDate(comparison.date, { year: true })}</span><div data-k="cmp-book"><Money value={comparison.bookBalance} /></div></div>
                <div><strong>الفرق (كشف التطبيق − الدفتري)</strong><div data-k="cmp-diff" style={{ color: comparison.noDifference ? '#047857' : '#b91c1c' }}><Money value={comparison.difference} /></div></div>
              </div>
              <p data-k="cmp-text">{comparisonText(comparison)}</p>
            </> : <p data-k="cmp-none">لم يُدخل رصيد من كشف {label} حتى {formatDate(to, { year: true })}؛ الرصيد المعروض دفتري فقط ولم يُقارن بكشف التطبيق.</p>}
            {saved && <p data-k="cmp-saved" role="status">{saved}</p>}
            {canRecord && !form && <Button size="sm" data-k="cmp-add" onClick={() => { setForm({ app, date: to, balance: '', reference: '', note: '' }); setFormError(''); setSaved('') }}>إدخال رصيد من كشف {label}</Button>}
            {form && <fieldset disabled={busy} style={{ border: 0, padding: 0 }} data-k="cmp-form" data-app={form.app}>
              <h3 data-k="cmp-form-title">رصيد من كشف {labelOf(form.app)}</h3>
              {formMismatch && <div data-k="cmp-form-mismatch"><Note tone="warning" action={<Button size="sm" onClick={() => onApp(form.app)}>العودة إلى {labelOf(form.app)}</Button>}>
                هذا النموذج لرصيد كشف {labelOf(form.app)}، والكشف المعروض الآن لـ{label}. لا يُحفظ لتطبيق غير الذي فُتح له؛ ارجع إلى {labelOf(form.app)} لحفظه، أو ألغِ النموذج.</Note></div>}
              <div className="ts-form-grid">
                <Field label="تاريخ الرصيد في كشف التطبيق"><DateInput value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} /></Field>
                <Field label="الرصيد المستحق للمنشأة حسب الكشف" error={form.balance.trim() !== '' && formBalance === null ? 'اكتب رقمًا بمنزلتين عشريتين كحد أقصى (الصفر والسالب مقبولان).' : undefined}>
                  <Input data-k="cmp-balance" numeric dir="ltr" value={form.balance} onChange={e => setForm(f => ({ ...f, balance: e.target.value }))} /></Field>
                <Field label="مصدر الرصيد (رقم كشف التطبيق أو فترته)"><Input data-k="cmp-reference" value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} /></Field>
                <Field label="ملاحظة" span><Textarea rows={2} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></Field>
              </div>
              <Button size="sm" variant="primary" data-k="cmp-save" disabled={busy || formMismatch || !form.date || formBalance === null || !form.reference.trim()}
                onClick={async () => {
                  // القيم كما فُتح النموذج وكُتبت وقت الضغط؛ لا تتغير بتغيير التطبيق أثناء انتظار الرد
                  const target = form.app, values = { p_app: target, p_date: form.date, p_balance: formBalance, p_reference: form.reference.trim(), p_note: form.note.trim() || null }
                  if (target !== app || values.p_balance === null) return
                  if (await call('app_statement_checkpoint_save', values)) { setForm(null); setSaved(`حُفظ رصيد كشف ${labelOf(target)}.`) }
                }}>حفظ رصيد {labelOf(form.app)}</Button>
              <Button size="sm" variant="quiet" data-k="cmp-cancel" onClick={() => setForm(null)}>إلغاء</Button>
            </fieldset>}
            {formError && <p className="ts-field-error" role="alert">{formError}</p>}
            {mine.length > 0 && <table className="rpt-table" data-k="cmp-history">
              <thead><tr><th>تاريخ الرصيد</th><th>رصيد الكشف</th><th>المصدر</th><th>أدخله</th><th>الحالة</th>{canRecord && <th />}</tr></thead>
              <tbody>{mine.map(c => <tr key={c.id} style={c.voided_at ? { opacity: 0.55 } : undefined}>
                <td>{formatDate(c.statement_date, { year: true })}</td><td><Money value={Number(c.statement_balance)} /></td><td>{c.reference}{c.note ? ` — ${c.note}` : ''}</td>
                <td>{c.created_by_name}</td><td>{c.voided_at ? `ملغى: ${c.void_reason}` : 'ساري'}</td>
                {canRecord && <td>{!c.voided_at && (voiding?.id === c.id
                  ? <><Input value={voiding.reason} placeholder="سبب الإلغاء" onChange={e => setVoiding({ id: c.id, reason: e.target.value })} />
                      <Button size="sm" disabled={busy || !voiding.reason.trim()} onClick={async () => { if (await call('app_statement_checkpoint_void', { p_id: c.id, p_reason: voiding.reason })) setVoiding(null) }}>تأكيد الإلغاء</Button></>
                  : <Button size="sm" variant="quiet" onClick={() => setVoiding({ id: c.id, reason: '' })}>إلغاء</Button>)}</td>}
              </tr>)}</tbody>
            </table>}
          </div>
        </Panel>
      )}

      {ready && (
        <Panel title={`حركات ${label} في الفترة`} subtitle="كل حركة في عمودها برصيد التطبيق بعدها. المبيعات تزيد الرصيد، والتحصيل والتسويات تخفضه.">
          {statement.rows.length === 0 ? <EmptyState>لا حركات لهذا التطبيق في الفترة.</EmptyState> :
          <div className="rpt-table-wrap"><table className="rpt-table" data-k="app-movements">
            <thead><tr><th>التاريخ</th><th>القيد</th><th>الحركة</th><th>البيان</th><th>الفرع</th><th>مبيعات</th><th>تحصيل</th><th>تسوية</th><th>الرصيد بعد الحركة</th></tr></thead>
            <tbody>
              <tr data-k="mv-opening"><td colSpan={8}><strong>رصيد بداية الفترة</strong></td><td><Money value={statement.opening} /></td></tr>
              {statement.rows.map(r => <tr key={r.id} data-k="mv-row">
                <td>{formatDate(r.date, { year: true })}</td><td dir="ltr">{r.journal}</td><td>{r.kindLabel}</td><td>{r.description || r.type}</td><td>{r.branch || 'المنشأة'}</td>
                <td>{amount(r.sale)}</td><td>{amount(r.collection)}</td><td>{amount(r.settlement)}</td>
                <td style={{ color: r.balance < 0 ? '#b91c1c' : undefined }}><Money value={r.balance} /></td>
              </tr>)}
            </tbody>
          </table></div>}
        </Panel>
      )}

      {ready && unassigned?.length > 0 && (
        <Panel title="قيود ذمم تحتاج مراجعة" subtitle="لم يمكن تحديد تطبيقها بثقة من نوعها أو وصفها، فلا تدخل كشف أي تطبيق ولا تُوزَّع بالتخمين. صحّح نوعها أو وصفها من الدفتر.">
          <div className="rpt-table-wrap"><table className="rpt-table" data-k="app-unassigned">
            <thead><tr><th>التاريخ</th><th>القيد</th><th>النوع</th><th>البيان</th><th>السبب</th><th>الأثر على الذمم</th></tr></thead>
            <tbody>{unassigned.map(u => <tr key={u.id}>
              <td>{formatDate(u.date, { year: true })}</td><td dir="ltr">{u.journal}</td><td>{u.type}</td><td>{u.description}</td><td>{u.reason}</td><td><Money value={u.amount} /></td>
            </tr>)}</tbody>
          </table></div>
        </Panel>
      )}
    </div>
  )
}
