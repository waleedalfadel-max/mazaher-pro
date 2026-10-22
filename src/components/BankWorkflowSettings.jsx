import { useState } from 'react'
import { Button, Field, Input, Note, Panel, Select } from '../ui/components.jsx'
import { bankAccountLabel, eligibleBankAccounts } from '../lib/branchSetup.js'
import { paymentWorkflow, UPLOADER_ROLES } from '../lib/paymentWorkflow.js'
import { supabase } from '../lib/supabase'
import { clearProjectCache } from '../lib/projectSettings.js'

const empty = () => ({ version: 1, uploaders: {}, network_by_branch: {}, transfer_by_branch: {}, apps_collection_account: null, accounts: {} })
const errors = { forbidden: 'إعداد مهام الحسابات لإدارة تحسيب فقط.', no_session: 'انتهت الجلسة؛ ادخل من جديد.',
  stale: 'تغيّرت الإعدادات في نافذة أخرى. حدّث القائمة قبل التعديل.', invalid: 'راجع الحسابات والفروع المختارة؛ يجب أن تكون نشطة ومن المنشأة نفسها.',
  not_found: 'إعداد المنشأة غير موجود.', network: 'تعذّر تأكيد الحفظ. حدّث القائمة للتحقق قبل إعادة المحاولة.' }

export default function BankWorkflowSettings({ projectId, settings, banks, onSaved }) {
  const existing = paymentWorkflow(settings)
  const [value, setValue] = useState(() => structuredClone(existing || empty()))
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const active = eligibleBankAccounts(banks, null)
  const options = active.map(a => ({ value: a.id, label: bankAccountLabel(a) }))
  const setRule = (id, patch) => setValue(v => ({ ...v, accounts: { ...v.accounts, [id]: { ...v.accounts[id], ...patch } } }))
  async function save() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const r = await supabase.rpc('admin_bank_workflow_save', { p_workflow: value, p_expected: existing })
      if (r.error || !r.data?.ok) { setError(errors[r.data?.code] || errors.network); return }
      clearProjectCache(projectId); await onSaved()
    } catch { setError(errors.network) } finally { setBusy(false) }
  }
  return <Panel title="مهام الحسابات واقتراح مصدر الدفع" subtitle="اقتراحات للمستندات القادمة؛ المحاسب وإدارة تحسيب يؤكدانها أو يغيّرانها قبل الاعتماد.">
    <div className="ts-panel-body"><fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
      <div className="ts-form-grid">
        {Object.entries(UPLOADER_ROLES).map(([role, label]) => <Field key={role} label={`المصدر المقترح عند رفع ${label}`}>
          <Select value={value.uploaders?.[role]?.source === 'cash' ? 'cash' : value.uploaders?.[role]?.account_id || ''} placeholder="بلا اقتراح مخصص"
            options={[{ value: 'cash', label: 'الصندوق' }, ...options]}
            onChange={e => { const id = e.target.value; setValue(v => { const uploaders = { ...v.uploaders }; if (!id) delete uploaders[role]; else uploaders[role] = id === 'cash' ? { source: 'cash' } : { source: 'bank', account_id: id }; return { ...v, uploaders } }) }} />
        </Field>)}
        {(settings.branches || []).map(branch => <Field key={branch} label={`حساب مبيعات الشبكة — ${branch}`}>
          <Select value={value.network_by_branch?.[branch] || ''} placeholder="بلا اقتراح مخصص"
            options={eligibleBankAccounts(active, branch).map(a => ({ value: a.id, label: bankAccountLabel(a) }))}
            onChange={e => { const id = e.target.value; setValue(v => { const network_by_branch = { ...v.network_by_branch }; if (id) network_by_branch[branch] = id; else delete network_by_branch[branch]; return { ...v, network_by_branch } }) }} />
        </Field>)}
        {(settings.branches || []).map(branch => <Field key={`transfer-${branch}`} label={`حساب حوالات المبيعات — ${branch}`}>
          <Select value={value.transfer_by_branch?.[branch] || ''} placeholder="بلا اقتراح مخصص"
            options={eligibleBankAccounts(active, branch).map(a => ({ value: a.id, label: bankAccountLabel(a) }))}
            onChange={e => { const id = e.target.value; setValue(v => { const transfer_by_branch = { ...v.transfer_by_branch }; if (id) transfer_by_branch[branch] = id; else delete transfer_by_branch[branch]; return { ...v, transfer_by_branch } }) }} />
        </Field>)}
        <Field label="حساب استقبال حوالات التطبيقات"><Select value={value.apps_collection_account || ''} placeholder="بلا اقتراح مخصص" options={options}
          onChange={e => setValue(v => ({ ...v, apps_collection_account: e.target.value || null }))} /></Field>
      </div>
      {banks.map(a => <div key={a.id} className="py-3 border-b">
        <strong>{bankAccountLabel(a)}</strong>
        <Field label={`مهمة ${a.name}`}><Input maxLength={500} value={value.accounts?.[a.id]?.purpose || ''} onChange={e => setRule(a.id, { purpose: e.target.value })} /></Field>
        <label className="flex gap-2"><input type="checkbox" checked={value.accounts?.[a.id]?.operating_available !== false} onChange={e => setRule(a.id, { operating_available: e.target.checked })} />أرصدة هذا الحساب الموجبة ضمن المتاح للتشغيل</label>
        <Field label={`وجهة التحويل المعتادة من ${a.name}`} hint="اقتراح عند تسجيل تحويل حقيقي؛ لا ينشئ تحويلات تلقائية."><Select value={value.accounts?.[a.id]?.transfer_to || ''} placeholder="بلا وجهة مقترحة" options={options.filter(o => o.value !== a.id)} onChange={e => setRule(a.id, { transfer_to: e.target.value || null })} /></Field>
      </div>)}
      <Note>استبعاد حساب من المتاح للتشغيل لا يغيّر رصيده ولا يمنع إدارة تحسيب من اختياره. الرصيد السالب يُثبت من كشف البنك، والتحصيل أو سداد الالتزامات يُسجّل بمستنده الفعلي.</Note>
      {error && <Note tone="error">{error}</Note>}
      <Button onClick={save} disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ مهام الحسابات'}</Button>
    </fieldset></div>
  </Panel>
}
