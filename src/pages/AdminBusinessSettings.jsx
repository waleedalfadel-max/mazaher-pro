import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { operatesBusiness } from '../lib/adminAccess'
import { Button, Dialog, Field, Input, Note, Panel, Select, Tabs, Textarea } from '../ui/components.jsx'
import { clearProjectCache } from '../lib/projectSettings'

import BankWorkflowSettings from '../components/BankWorkflowSettings.jsx'

const CHANNELS = { cash:'كاش', network:'شبكة', transfer:'تحويل', hunger:'هنقرستيشن', jahez:'جاهز', keeta:'كيتا', mrsool:'مرسول' }
const SECTIONS = [{value:'supplier',label:'الموردون'},{value:'bank',label:'الحسابات البنكية'},{value:'branch',label:'الفروع والقنوات'},{value:'item',label:'القاموس'},{value:'category',label:'إزالة التصنيفات'}]
const ERRORS = { forbidden:'هذه الإدارة لمدير منصة تحسيب فقط.',no_session:'انتهت الجلسة. ادخل من جديد.',not_found:'السجل غير موجود في هذه المنشأة. حدّث القائمة.',
  invalid:'تحقق من الحقول المدخلة.',invalid_name:'اكتب اسمًا من 1 إلى 200 حرف.',duplicate:'الاسم موجود بالفعل.',invalid_branch:'اختر فرعًا من فروع المنشأة.',
  branch_in_use:'الفرع مربوط بموظفين نشطين أو حسابات بنكية. عدّل ربطهم أولًا، ثم أزل الفرع.',linked_records:'السجل مرتبط بحركات قائمة. عالج الحركات من صفحاتها أولًا.',
  invalid_channels:'اختر قنوات مبيعات صحيحة.',category_invalid:'اختر تصنيفًا رئيسيًا نشطًا.',subcategory_invalid:'الفرعي لا يتبع الرئيسي المختار.',
  reason_required:'اكتب سبب تعديل الرصيد الافتتاحي.',amount_invalid:'اكتب مبلغًا صحيحًا بمنزلتين عشريتين على الأكثر.',network:'تعذّر تأكيد الحفظ. حدّث القائمة قبل إعادة الإضافة.' }
export async function adminBusinessCall(name,args={}) {
  try { const {data,error}=await supabase.rpc(name,args);return error||!data?{ok:false,code:'network'}:data } catch {return {ok:false,code:'network'}}
}
const errorText = r => ERRORS[r?.code] || 'تعذّر إكمال الإجراء. حدّث الصفحة وأعد المحاولة.'
const initialSection=search=>{const s=new URLSearchParams(search).get('section');return SECTIONS.some(x=>x.value===s)?s:'supplier'}

export default function AdminBusinessSettings(){
 const {role,projectId,viewState}=useAuth()
 const {search}=useLocation()
 if(!operatesBusiness(role,projectId,viewState))return <Note tone="error">اختر منشأة من لوحة مدير المنصة أولًا.</Note>
 const section=initialSection(search)
 return <BusinessControls key={projectId+':'+section} projectId={projectId} initialSection={section}/>
}

function BusinessControls({projectId,initialSection}){
 const [state,setState]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[section,setSection]=useState(initialSection)
 const [dialog,setDialog]=useState(null),[busy,setBusy]=useState(false),[scope,setScope]=useState('branch')
 const sequence=useRef(0),saving=useRef(false)
 const load=useCallback(async()=>{
   const seq=++sequence.current;setError('')
   const r=await adminBusinessCall('admin_business_settings')
   if(seq!==sequence.current)return false
   if(!r.ok||r.project_id!==projectId){setState(null);setError(errorText(r));return false}
   setState(r);setScope(r.settings?.expenses_scope==='project'?'project':'branch');return true
 },[projectId])
 useEffect(()=>{load();return()=>{++sequence.current}},[load])
 const run=async(entity,action,id,data)=>{
   if(saving.current)return
   saving.current=true;setBusy(true);setError('');setNotice('')
   const res=await adminBusinessCall('admin_business_write',{p_entity:entity,p_action:action,p_id:id||null,p_data:data})
   if(res.ok){clearProjectCache(projectId);setDialog(null);const loaded=await load();if(loaded)setNotice(res.result==='archived'?'أُزيل من الاستخدام الجديد، وبقي تاريخه وحركاته محفوظة.':res.result==='deleted'?'حُذف السجل وسُجّل الإجراء باسم إدارة تحسيب.':'حُفظ التعديل وسُجّل باسم إدارة تحسيب.')}
   else setError(errorText(res))
   saving.current=false;setBusy(false)
 }
 const edit=(entity,row)=>{
   setError('');setDialog({entity,id:row?.id||null,data:entity==='branch'?{name:row?.name||'',old_name:row?.name||null,channels:state.settings?.branch_channels?.[row?.name]||Object.keys(CHANNELS)}:
     entity==='bank'?{name:'',bank:'',branches:[],is_active:true,...row}:entity==='item'?{name:row?.description||'',status:'review',category_id:'',subcategory_id:'',note:'',...row}:
       {name:'',phone:'',opening_balance:'0',notes:'',is_active:true,...row,reason:''}})
 }
 const remove=(entity,row)=>{
   if(!window.confirm(`إزالة «${row.name||row.description}»؟\nإن كان مرتبطًا بتاريخ مالي فسيبقى محفوظًا ويُوقف استخدامه الجديد. الإجراء مسجّل باسم إدارة تحسيب.`))return
   run(entity,'remove',row.id,entity==='branch'?{old_name:row.name}:{})
 }
 if(!state)return <Panel title="إدارة المنشأة">{error?<Note tone="error" action={<Button onClick={load}>إعادة المحاولة</Button>}>{error}</Note>:<p>جارٍ تحميل إعدادات المنشأة…</p>}</Panel>
 const branches=Array.isArray(state.settings?.branches)?state.settings.branches:[]
 const rows=section==='supplier'?state.suppliers:section==='bank'?state.banks:section==='branch'?branches.map(name=>({name})):section==='item'?state.rules:state.categories
 const set=(key,value)=>setDialog(d=>({...d,data:{...d.data,[key]:value}}))
 const checkboxList=(values,selected,onChange)=>Object.entries(values).map(([value,label])=><label key={value} className="flex gap-2 items-center"><input type="checkbox" checked={selected.includes(value)} disabled={busy} onChange={e=>onChange(e.target.checked?[...selected,value]:selected.filter(x=>x!==value))}/>{label}</label>)
 return <div data-admin-business-controls>
  <Panel title={`إدارة ${state.project?.name||'المنشأة'}`} subtitle="التغييرات تُحفظ في المنشأة المفتوحة، ويُسجّل منفذها باسم إدارة تحسيب.">
   <div className="ts-panel-body">
    {error&&<Note tone="error">{error}</Note>}{notice&&<Note tone="success">{notice}</Note>}
    <Field label="تسجيل المصروفات"><Select value={scope} disabled={busy} onChange={e=>setScope(e.target.value)} options={[{value:'project',label:'موحّدة على مستوى المنشأة'},{value:'branch',label:'بحسب الفرع'}]}/></Field>
    <Button disabled={busy||scope===(state.settings?.expenses_scope==='project'?'project':'branch')} onClick={()=>run('expenses_scope','save',null,{value:scope})}>حفظ طريقة المصروفات</Button>
    <p className="ts-field-hint">يسري على الاعتمادات القادمة. القيود السابقة لا تتغير.</p>
   </div>
  </Panel>
  <Tabs label="إدارة بيانات المنشأة" tabs={SECTIONS} value={section} onChange={s=>{setSection(s);setError('');setNotice('')}}/>
  <Panel title={SECTIONS.find(x=>x.value===section)?.label} action={section!=='category'&&<Button disabled={busy} onClick={()=>edit(section,null)}>إضافة</Button>}>
   <div className="ts-panel-body">
    {section==='category'&&<p>الإضافة والتعديل من تبويب «التصنيفات». هنا يمكنك حذف غير المستخدم وإيقاف المستخدم مع إبقاء أثره المالي.</p>}
    {!rows?.length&&<p>لا توجد سجلات.</p>}
    {rows?.map((r,index)=><div key={r.id||r.name||index} data-config-row={r.id||r.name} className="flex gap-3 items-center flex-wrap py-3 border-b">
      <div className="flex-1"><strong>{r.name||r.description}</strong>{(r.is_active===false||r.status==='review')&&<small className="mr-2">{r.status==='review'?'للمراجعة':'موقوف'}</small>}
       {section==='bank'&&<p className="ts-field-hint">{r.bank} — {r.branches?.length?r.branches.join('، '):'كل الفروع'}</p>}
       {section==='supplier'&&<p className="ts-field-hint">الرصيد الافتتاحي: {Number(r.opening_balance||0).toFixed(2)} — {r.phone||'بلا رقم هاتف'}</p>}
       {section==='branch'&&<p className="ts-field-hint">{(state.settings?.branch_channels?.[r.name]||Object.keys(CHANNELS)).map(c=>CHANNELS[c]).join('، ')||'لا قنوات مفعّلة'}</p>}
      </div>
      {section!=='category'&&<Button disabled={busy} size="sm" onClick={()=>edit(section,r)}>تعديل</Button>}
      <Button disabled={busy} size="sm" onClick={()=>remove(section,r)}>إزالة</Button>
    </div>)}
    {section==='supplier'&&state.payables?.length>0&&<><h3 className="mt-4 font-bold">موردو الآجل باسم المورد</h3>{state.payables.map(r=><div className="flex gap-3 items-center py-2" key={r.id}><span className="flex-1">{r.name}</span><Button disabled={busy} onClick={()=>edit('payable',r)}>تعديل</Button><Button disabled={busy} onClick={()=>remove('payable',r)}>إزالة</Button></div>)}</>}
   </div>
  </Panel>
  {section==='bank'&&<BankWorkflowSettings key={JSON.stringify(state.settings?.bank_workflow||{})} projectId={projectId} settings={state.settings||{}} banks={state.banks||[]} onSaved={async()=>{await load();setNotice('حُفظت مهام الحسابات وسُجّل التعديل باسم إدارة تحسيب.')}}/>}
  <Dialog open={!!dialog} title={dialog?.id||dialog?.data.old_name?'تعديل البيانات':'إضافة سجل'} onClose={()=>!busy&&setDialog(null)} footer={<><Button disabled={busy||!dialog?.data.name?.trim()} onClick={()=>run(dialog.entity,'save',dialog.id,dialog.data)}>{busy?'جارٍ الحفظ…':'حفظ'}</Button><Button disabled={busy} onClick={()=>setDialog(null)}>إلغاء</Button></>}>
   {dialog&&<div className="ts-form-grid">
    {error&&<Note tone="error">{error}</Note>}
    <Field label={dialog.entity==='item'?'وصف الصنف':'الاسم'}><Input value={dialog.data.name} maxLength={200} disabled={busy} onChange={e=>set('name',e.target.value)}/></Field>
    {dialog.entity==='supplier'&&<>
     <Field label="رقم الهاتف"><Input value={dialog.data.phone||''} disabled={busy} onChange={e=>set('phone',e.target.value)}/></Field>
     <Field label="الرصيد الافتتاحي" hint="تعديله يغيّر المستحق للمورد؛ لا ينشئ مصروفًا جديدًا."><Input numeric value={dialog.data.opening_balance} disabled={busy} onChange={e=>set('opening_balance',e.target.value)}/></Field>
     {dialog.id&&<Field label="سبب تعديل الرصيد"><Input value={dialog.data.reason||''} disabled={busy} onChange={e=>set('reason',e.target.value)}/></Field>}
     <Field label="ملاحظات"><Textarea value={dialog.data.notes||''} disabled={busy} onChange={e=>set('notes',e.target.value)}/></Field>
    </>}
    {dialog.entity==='bank'&&<>
     <Field label="اسم البنك"><Input value={dialog.data.bank||''} disabled={busy} onChange={e=>set('bank',e.target.value)}/></Field>
     <fieldset><legend>الفروع المرتبطة — تركها كلها فارغة يعني كل الفروع</legend>{checkboxList(Object.fromEntries(branches.map(b=>[b,b])),dialog.data.branches||[],b=>set('branches',b))}</fieldset>
    </>}
    {['supplier','bank'].includes(dialog.entity)&&<label className="flex gap-2"><input type="checkbox" checked={dialog.data.is_active!==false} disabled={busy} onChange={e=>set('is_active',e.target.checked)}/>نشط للاستخدام الجديد</label>}
    {dialog.entity==='branch'&&<fieldset><legend>قنوات المبيعات المفعّلة</legend>{checkboxList(CHANNELS,dialog.data.channels,c=>set('channels',c))}</fieldset>}
    {dialog.entity==='item'&&<>
     <Field label="الحالة"><Select value={dialog.data.status} disabled={busy} options={[{value:'review',label:'للمراجعة'},{value:'active',label:'معتمد'}]} onChange={e=>set('status',e.target.value)}/></Field>
     <Field label="التصنيف الرئيسي"><Select value={dialog.data.category_id||''} disabled={busy||dialog.data.status==='review'} placeholder="اختر التصنيف" options={state.categories.filter(c=>!c.parent_id&&c.is_active).map(c=>({value:c.id,label:c.name}))} onChange={e=>setDialog(d=>({...d,data:{...d.data,category_id:e.target.value,subcategory_id:''}}))}/></Field>
     <Field label="التصنيف الفرعي"><Select value={dialog.data.subcategory_id||''} disabled={busy||dialog.data.status==='review'} placeholder="بلا فرعي" options={state.categories.filter(c=>c.parent_id===dialog.data.category_id&&c.is_active).map(c=>({value:c.id,label:c.name}))} onChange={e=>set('subcategory_id',e.target.value)}/></Field>
     <Field label="ملاحظة"><Input value={dialog.data.note||''} disabled={busy} onChange={e=>set('note',e.target.value)}/></Field>
    </>}
   </div>}
  </Dialog>
 </div>
}

const ENTITIES={projects:'المنشآت',project_settings:'الإعدادات',app_users:'المستخدمون',user_status_changes:'إدارة المستخدمين',documents:'المستندات',document_items:'بنود المستند',ledger_entries:'الدفتر',sales:'المبيعات',attachments:'المرفقات',suppliers:'الموردون',supplier_transactions:'حركات المورد',payable_suppliers:'موردو الآجل',loans:'القروض',branches:'الفروع',bank_accounts:'الحسابات البنكية',categories:'التصنيفات',item_category_rules:'القاموس',analysis_targets:'أهداف التحليل'}
const LABELS={name:'الاسم',phone:'الهاتف',notes:'ملاحظات',note:'ملاحظة',is_active:'نشط',active:'نشط',status:'الحالة',branch:'الفرع',branches:'الفروع',bank:'البنك',opening_balance:'الرصيد الافتتاحي',description:'الوصف',type:'النوع',date:'التاريخ',amount:'المبلغ',total_amount:'الإجمالي',cash_in:'داخل الصندوق',cash_out:'خارج الصندوق',bank_in:'داخل البنك',bank_out:'خارج البنك',payable_in:'زيادة المستحق',payable_out:'سداد المستحق',settings:'الإعدادات',role:'الدور',user_name:'المستخدم',user_role:'دوره',reason:'السبب',action:'الإجراء'}
Object.assign(LABELS,{custody_in:'داخل العهدة',custody_out:'خارج العهدة',receivable_in:'زيادة الذمم',receivable_out:'تحصيل الذمم',vat_amount:'الضريبة',discount_amount:'الخصم',cash_sales:'المبيعات النقدية',network_sales:'مبيعات الشبكة',total_sales:'إجمالي المبيعات',hunger_sales:'هنقرستيشن',jahez_sales:'جاهز',keeta_sales:'كيتا',ratio:'النسبة المستهدفة',effective_from:'تاريخ بدء الهدف',item_label:'بند التحليل',category_main:'التصنيف الرئيسي',category_sub:'التصنيف الفرعي'})
const show=v=>v==null?'—':typeof v==='boolean'?(v?'نعم':'لا'):typeof v==='object'?JSON.stringify(v):String(v)
export function AdminActionHistory(){
 const {role,projectId,viewState}=useAuth()
 if(!operatesBusiness(role,projectId,viewState))return <Note tone="error">اختر منشأة من لوحة مدير المنصة أولًا.</Note>
 return <History key={projectId} projectId={projectId}/>
}
function History({projectId}){
 const [events,setEvents]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[more,setMore]=useState(false)
 const lock=useRef(false),alive=useRef(true)
 const load=useCallback(async(before=null)=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('')
  const r=await adminBusinessCall('admin_action_history',{p_before:before})
  if(alive.current){if(r.ok&&r.project_id===projectId){setEvents(e=>before?[...e,...r.events]:r.events);setMore(r.events.length===50)}else setError(errorText(r));setBusy(false)}lock.current=false
 },[projectId])
 useEffect(()=>{alive.current=true;load();return()=>{alive.current=false}},[load])
 return <Panel title="سجل إجراءات إدارة تحسيب" subtitle="يبدأ من تفعيل هذا التحديث. يعرض المنفذ والوقت والتغيير في المنشأة المفتوحة فقط." action={<Button disabled={busy} onClick={()=>load()}>تحديث</Button>}>
  <div className="ts-panel-body">{error&&<Note tone="error">{error}</Note>}{!busy&&!events.length&&!error&&<p>لا إجراءات مسجلة بعد.</p>}
   {events.map(e=><details key={e.id} className="py-3 border-b"><summary>{e.actor_name} — {({INSERT:'إضافة',UPDATE:'تعديل',DELETE:'حذف'})[e.action]||e.action} — {ENTITIES[e.entity]||'إجراء'} — {new Date(e.happened_at).toLocaleString('ar-SA')}</summary>
    {e.reason&&<p>السبب: {e.reason}</p>}
    <ul>{Object.keys(LABELS).filter(k=>JSON.stringify(e.before_value?.[k])!==JSON.stringify(e.after_value?.[k])).map(k=><li key={k}>{LABELS[k]}: {show(e.before_value?.[k])} ← {show(e.after_value?.[k])}</li>)}</ul>
    {e.changed_fields?.includes('analysis_result')&&<p>تغيّرت قراءة المستند. راجع تفاصيله في صفحة المستندات.</p>}
    {e.changed_fields?.some(k=>['file_url','file_data'].includes(k))&&<p>تغيّر الملف المرفق.</p>}
   </details>)}
   {more&&<Button disabled={busy} onClick={()=>load(events.at(-1)?.id)}>عرض الأقدم</Button>}{busy&&<p>جارٍ التحميل…</p>}
  </div>
 </Panel>
}
