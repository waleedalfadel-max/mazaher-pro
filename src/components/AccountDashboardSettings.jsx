import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Field, Input, Note, Panel, Select } from '../ui/components.jsx'
import { bankAccountLabel } from '../lib/branchSetup.js'
import { parseStatementBalance } from '../lib/appStatement.js'

export default function AccountDashboardSettings({ settings, banks, onSaved }) {
  const previous = settings.account_dashboard || null
  const [value,setValue] = useState(() => structuredClone(previous || { enabled:false, custody_account_id:settings.bank_workflow?.uploaders?.purchasing?.account_id || '', liability_account_id:settings.bank_workflow?.apps_collection_account || '', liabilities:null }))
  const [balance,setBalance] = useState(previous?.liabilities?.balance == null ? '' : String(previous.liabilities.balance))
  const [date,setDate] = useState(previous?.liabilities?.date || ''), [reference,setReference] = useState(previous?.liabilities?.reference || ''), [sweep,setSweep] = useState(previous?.liabilities?.automatic_sweep === true)
  const [reason,setReason] = useState(''), [error,setError] = useState(''), [busy,setBusy] = useState(false)
  const saving = useRef(false)
  const options = banks.filter(b=>b.is_active !== false).map(b=>({value:b.id,label:bankAccountLabel(b)}))
  const set = (k,v) => setValue(s=>({...s,[k]:v}))
  async function save() {
    if (saving.current) return
    setError('')
    const n = balance.trim() ? parseStatementBalance(balance) : null
    if (!reason.trim() || (value.enabled && (!value.custody_account_id || !value.liability_account_id || value.custody_account_id===value.liability_account_id)) || (balance.trim() && (n === null || n < 0 || !date || !reference.trim()))) {
      setError('اختر الحسابين المختلفين واكتب سبب التعديل. عند إدخال الالتزام، يلزم مبلغ صحيح وتاريخ ومصدر.');return
    }
    saving.current=true;setBusy(true)
    try {
      const config={...value,liabilities:n==null?null:{balance:n,date,reference:reference.trim(),automatic_sweep:sweep}}
      const {data,error:e}=await supabase.rpc('admin_account_dashboard_save',{p_config:config,p_expected:previous,p_reason:reason.trim()})
      if(e||!data?.ok){setError(data?.code==='stale'?'تغيّر الإعداد؛ أعد تحميل الصفحة قبل الحفظ.':data?.code==='name_exists'?'يوجد حساب آخر باسم حساب العهدة. راجع الحساب المختار قبل الحفظ.':'تعذّر الحفظ. تحقق من الحسابات والتاريخ وصلاحيتك.');return}
      await onSaved()
    } catch {setError('تعذّر تأكيد الحفظ؛ حدّث الصفحة للتحقق.')} finally {saving.current=false;setBusy(false)}
  }
  return <Panel title="لوحة الحسابات وحساب العهدة" subtitle="إعداد خاص بهذه المنشأة. يُحفظ السبب والاسم والتغييرات في سجل الإدارة."><div className="ts-panel-body"><fieldset disabled={busy} style={{border:0,padding:0}}>
    <label><input type="checkbox" checked={value.enabled} onChange={e=>set('enabled',e.target.checked)}/> تفعيل اللوحة المختصرة وحساب العهدة البنكي</label>
    <div className="ts-form-grid">
      <Field label="حساب المشتريات الحالي" hint="يُعاد تسميته حساب العهدة، ويُقترح للمشتريات بنفس المعرّف والحركات؛ لا يُنشأ حساب جديد."><Select value={value.custody_account_id||''} placeholder="اختر الحساب" options={options} onChange={e=>set('custody_account_id',e.target.value)}/></Field>
      <Field label="حساب سداد الالتزامات"><Select value={value.liability_account_id||''} placeholder="اختر الحساب" options={options} onChange={e=>set('liability_account_id',e.target.value)}/></Field>
      <Field label="الالتزام المتبقي (اختياري)" hint="أدخل مقدار الالتزام موجبًا؛ يظهر سالبًا في اللوحة المختصرة. اتركه فارغًا لعرض غير محدد."><Input numeric value={balance} onChange={e=>setBalance(e.target.value)}/></Field>
      <Field label="آخر يوم يشمله الرصيد المرجعي"><Input type="date" value={date} onChange={e=>setDate(e.target.value)}/></Field>
      <Field label="مصدر المبلغ وتفصيل الالتزامات"><Input value={reference} maxLength={500} onChange={e=>setReference(e.target.value)}/></Field>
      <Field label="سبب التعديل"><Input value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></Field>
    </div>
    <label><input type="checkbox" checked={sweep} onChange={e=>setSweep(e.target.checked)}/> أؤكد أن كل إيداع في حساب السداد يُخصم آليًا من الالتزام، بلا رسوم أو استثناءات غير مسجلة</label>
    <Note>بلا هذا التأكيد تُعرض الإيداعات كمبالغ موجّهة للسداد فقط. مع التأكيد يُحسب المتبقي بعد نقطة البداية؛ لا تُسجّل مصروفات أو قيود سداد جديدة، ولا يتغير إجمالي المبيعات. يلزم تحديث الرصيد المرجعي عند إضافة التزامات أو رسوم جديدة.</Note>
    {error&&<Note tone="error">{error}</Note>}
    <Button disabled={busy||!reason.trim()} onClick={save}>حفظ إعداد اللوحة والحساب</Button>
  </fieldset></div></Panel>
}
