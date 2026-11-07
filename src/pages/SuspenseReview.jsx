import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { fetchEveryRow } from '../lib/fetchAll.js'
import { statementAccountOptions } from '../lib/accountStatement.js'
import { loadSuspense, writeSuspense, suspenseTotals, SUSPENSE_STATUS, RESOLUTIONS } from '../lib/suspenseReview.js'
import { Button, Check, Dialog, Field, Input, Money, Note, Panel, Select, Textarea } from '../ui/components.jsx'
import { formatDate } from '../ui/format.js'
import './SuspenseReview.css'
const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
export default function SuspenseReview({embedded=false}) {
  const {projectId,sessionEpoch}=useAuth()
  return <Review key={`${projectId}:${sessionEpoch}`} projectId={projectId} embedded={embedded}/>
}
function Review({projectId,embedded}) {
  const {role}=useAuth(), [params,setParams]=useSearchParams()
  const [data,setData]=useState(null), [error,setError]=useState(''), [attempt,setAttempt]=useState(0)
  const [status,setStatus]=useState('pending'), [month,setMonth]=useState(''), [creating,setCreating]=useState(false)
  useEffect(()=>{let alive=true;setError('');loadSuspense(supabase,projectId).then(d=>{if(alive)setData(d)}).catch(e=>{if(alive)setError(e.message)});return()=>{alive=false}},[projectId,attempt])
  useEffect(()=>{if(data&&params.get('entry')&&!data.cases.some(c=>c.entry_id===params.get('entry'))&&data.sources.some(s=>s.id===params.get('entry')))setCreating(true)},[data,params])
  const selected=data?.cases.find(c=>c.id===params.get('case') || c.entry_id===params.get('entry'))
  const accounts=data ? statementAccountOptions(data.banks,data.settings).filter(a=>a.value==='cash'||a.value==='custody'||a.value.startsWith('bank:')):[]
  // Real bank names also resolve historical/inactive source accounts without offering them for new movements.
  const accountName=key=>accounts.find(a=>a.value===key)?.label || (key==='custody'?'العهدة':data?.banks.find(b=>'bank:'+b.id===key)?.name) || 'حساب غير متاح'
  const activeAccounts=accounts.filter(a=>!a.value.startsWith('bank:')||data.banks.find(b=>'bank:'+b.id===a.value)?.is_active!==false)
  function refresh(id){setAttempt(n=>n+1);if(id)setParams({case:id});setCreating(false)}
  const totals=suspenseTotals(data?.cases||[])
  const visible=data?.cases.filter(c=>(status==='all'||status==='pending'&&c.status!=='resolved'||c.status===status)&&(!month||c.source_date.startsWith(month)))||[]
  return <div className="suspense-review" data-k="suspense-review">
    {!embedded&&<div className="ts-heading"><h1>الفروقات</h1><Link className="ts-btn" to="/operations">السجل المالي</Link></div>}
    {error&&<Note tone="error" action={<Button onClick={()=>setAttempt(n=>n+1)}>إعادة المحاولة</Button>}>{error}</Note>}
    {!data&&!error&&<p role="status">جارٍ التحميل…</p>}
    {data&&<>
      <div className="suspense-totals"><Panel title="زيادات معلقة"><Money value={totals.incoming}/></Panel><Panel title="نواقص معلقة"><Money value={totals.outgoing}/></Panel><Panel title="فروقات مفتوحة"><b>{totals.count}</b></Panel></div>
      <Panel title="فروقات قيد المراجعة" action={<Button variant="primary" onClick={()=>setCreating(true)}>تسجيل فرق</Button>}>
        <div className="suspense-filters"><Field label="الحالة"><Select value={status} onChange={e=>setStatus(e.target.value)} options={[{value:'pending',label:'المفتوحة'},{value:'proposed',label:'بانتظار المالك'},{value:'resolved',label:'تمت المعالجة'},{value:'all',label:'الكل'}]}/></Field><Field label="الشهر (اختياري)"><Input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></Field>{month&&<Button onClick={()=>setMonth('')}>كل الأشهر</Button>}<Button onClick={()=>setAttempt(n=>n+1)}>تحديث</Button></div>
        <div className="suspense-list">{visible.map(c=><button className="suspense-row" key={c.id} onClick={()=>setParams({case:c.id})}><span><strong>{c.reason}</strong><small>{formatDate(c.source_date,{year:true})} · {accountName(c.source_account)}</small></span><span>{c.direction==='in'?'زيادة':'نقص'} <Money value={c.amount}/><small>{SUSPENSE_STATUS[c.status]}</small></span></button>)}{!visible.length&&<p className="suspense-empty">لا توجد فروقات في هذا العرض.</p>}</div>
      </Panel>
      <Dialog open={creating} title="تسجيل فرق" onClose={()=>{setCreating(false);setParams({})}}><CreateDifference initialEntry={params.get('entry')||''} data={data} accounts={activeAccounts} onSaved={refresh}/></Dialog>
      <Dialog open={!!selected} title="مراجعة الفرق" onClose={()=>setParams({})}>{selected&&<CaseDetail key={`${selected.id}:${selected.version}`} item={selected} data={data} accounts={activeAccounts} accountName={accountName} owner={role==='owner'} onSaved={refresh}/>}</Dialog>
    </>}
  </div>
}
function CreateDifference({data,accounts,onSaved,initialEntry}) {
  const [mode,setMode]=useState('existing'),[source,setSource]=useState(initialEntry),[reason,setReason]=useState(''),[reference,setReference]=useState(''),[amount,setAmount]=useState(''),[date,setDate]=useState(today()),[account,setAccount]=useState(''),[direction,setDirection]=useState('out'),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const request=useRef(crypto.randomUUID()), submitted=useRef(null)
  async function save(e){e.preventDefault();if(busy)return;setBusy(true);setError('');const payload=mode==='existing'?{entry_id:source,reason,reference}:{amount:Number(amount),date,account,direction,reason,reference,confirmed};
    // Keep the request identity after a lost response; changed data gets a fresh request only after the previous outcome is known.
    if(submitted.current&&JSON.stringify(payload)!==submitted.current){setError('حدّث الصفحة للتحقق من المحاولة السابقة قبل تغيير البيانات.');setBusy(false);return}
    submitted.current=JSON.stringify(payload)
    try{const r=await writeSuspense(supabase,mode==='existing'?'open':'new',null,payload,request.current);onSaved(r.id)}catch(err){if(err.definitive)submitted.current=null;setError(err.message)}finally{setBusy(false)}}
  return <form className="suspense-form" onSubmit={save}>
    <Field label="هل الفرق مسجل في السجل؟"><Select value={mode} disabled={busy||!!submitted.current} onChange={e=>{setMode(e.target.value);request.current=crypto.randomUUID()}} options={[{value:'existing',label:'نعم، ربط حركة موجودة'},{value:'new',label:'لا، تسجيل فرق جديد'}]}/></Field>
    {mode==='existing'?<Field label="الحركة"><Select required placeholder="اختر الحركة" value={source} onChange={e=>setSource(e.target.value)} options={data.sources.filter(s=>!data.cases.some(c=>c.entry_id===s.id)).map(s=>({value:s.id,label:`${s.date} · ${s.total_amount} ر.س · ${s.description||s.journal_number}`}))}/></Field>:<><Note>يسجل هذا الإجراء زيادة أو نقصًا على رصيد الحساب المحدد.</Note><div className="suspense-grid"><Field label="الحساب"><Select required placeholder="اختر الحساب" value={account} onChange={e=>setAccount(e.target.value)} options={accounts}/></Field><Field label="نوع الفرق"><Select value={direction} onChange={e=>setDirection(e.target.value)} options={[{value:'out',label:'نقص في الرصيد'},{value:'in',label:'زيادة في الرصيد'}]}/></Field><Field label="المبلغ"><Input required type="number" min="0.01" max="999999999.99" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></Field><Field label="التاريخ"><Input required type="date" max={today()} value={date} onChange={e=>setDate(e.target.value)}/></Field></div></>}
    <Field label="سبب الفرق"><Textarea required minLength={10} maxLength={1000} rows={2} placeholder="مثال: نقص بالصندوق بعد مطابقة إغلاق يوم الخميس" value={reason} onChange={e=>setReason(e.target.value)}/></Field>
    <Field label="مرجع أو مستند مؤيد (اختياري)"><Input maxLength={500} value={reference} onChange={e=>setReference(e.target.value)}/></Field>
    {mode==='new'&&<Check checked={confirmed} onChange={setConfirmed} label="راجعت السجل وتأكدت أن هذا الفرق لم يسجل من قبل"/>}
    {error&&<Note tone="error">{error}</Note>}<Button type="submit" variant="primary" disabled={busy||mode==='new'&&!confirmed}>{busy?'جارٍ الحفظ…':'حفظ الفرق'}</Button>
  </form>
}
function CaseDetail({item,data,accounts,accountName,owner,onSaved}) {
  const [proposal,setProposal]=useState(item.proposal||{kind:'expense',reason:'',vat:0,branch:data.settings.branches?.length===1?data.settings.branches[0]:''})
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false),[returning,setReturning]=useState(false),[returnReason,setReturnReason]=useState(''),[events,setEvents]=useState(null),[historyError,setHistoryError]=useState('')
  const set=(k,v)=>setProposal(p=>({...p,[k]:v}))
  useEffect(()=>{let alive=true;fetchEveryRow(()=>supabase.from('suspense_events').select('id,action,actor,detail,created_at').eq('project_id',data.projectId).eq('case_id',item.id).order('created_at').order('id')).then(r=>{if(alive){if(r.error)setHistoryError('تعذّر تحميل سجل المعالجة.');else setEvents(r.data)}});return()=>{alive=false}},[item.id])
  async function act(action,payload){if(busy)return;setBusy(true);setError('');try{await writeSuspense(supabase,action,item,payload);onSaved(item.id)}catch(e){setError(e.message)}finally{setBusy(false)}}
  function propose(e){e.preventDefault();const p={kind:proposal.kind,reason:proposal.reason};if(['expense','sales'].includes(p.kind))p.vat=Number(proposal.vat);if(p.kind==='expense')p.category_id=proposal.category_id;if(p.kind==='sales')p.branch=proposal.branch;if(p.kind==='transfer')p.target=proposal.target;if(p.kind==='supplier'){p.supplier_id=proposal.supplier_id;p.supplier_kind=proposal.supplier_kind}act('propose',p)}
  const pending=item.status==='proposed',resolved=item.status==='resolved'
  const kinds=Object.entries(RESOLUTIONS).filter(([k])=>!(item.direction==='in'&&['supplier','withdrawal','shortage'].includes(k))&&!(k==='sales'&&(item.direction!=='in'||item.source_account==='custody')))
  const summary=item.proposal&&[RESOLUTIONS[item.proposal.kind],data.categories.find(c=>c.id===item.proposal.category_id)?.name,item.proposal.target&&accountName(item.proposal.target),data.suppliers.find(s=>s.id===item.proposal.supplier_id)?.name,item.proposal.branch].filter(Boolean).join(' · ')
  return <div className="suspense-form">
    <div className="suspense-case-head"><strong>{item.direction==='in'?'زيادة':'نقص'} <Money value={item.amount}/></strong><span>{SUSPENSE_STATUS[item.status]}</span></div><p>{accountName(item.source_account)} · {formatDate(item.source_date,{year:true})}</p><p>{item.reason}</p>{item.reference&&<p>{item.reference}</p>}
    <Link className="ts-btn" to={`/journal-entry/${item.entry_id}`} state={{returnTo:`/suspense?case=${item.id}`}}>عرض القيد</Link>
    {(pending||resolved)&&<Panel title={resolved?'المعالجة المعتمدة':'المعالجة المقترحة'}><strong>{summary}</strong><p>{item.proposal.reason}</p>{['sales','expense'].includes(item.proposal.kind)&&<p>الضريبة: <Money value={item.proposal.vat}/></p>}<small>{resolved?`اعتمدها: ${item.approved_by?.name||'المالك'}`:`اقترحها: ${item.proposed_by?.name||'—'}`}</small></Panel>}
    {!pending&&!resolved&&<form className="suspense-form" onSubmit={propose}>
      <Field label="المعالجة"><Select value={proposal.kind} onChange={e=>setProposal({kind:e.target.value,reason:proposal.reason,vat:0,branch:data.settings.branches?.length===1?data.settings.branches[0]:''})} options={kinds.map(([value,label])=>({value,label}))}/></Field>
      {proposal.kind==='expense'&&<Field label="التصنيف"><Select required placeholder="اختر التصنيف" value={proposal.category_id||''} onChange={e=>set('category_id',e.target.value)} options={data.categories.map(c=>({value:c.id,label:c.name}))}/></Field>}
      {proposal.kind==='sales'&&<Field label="الفرع"><Select required placeholder="اختر الفرع" value={proposal.branch||''} onChange={e=>set('branch',e.target.value)} options={(data.settings.branches||[]).map(b=>({value:b,label:b}))}/></Field>}
      {['sales','expense'].includes(proposal.kind)&&<Field label="الضريبة ضمن المبلغ"><Input required type="number" min="0" max={item.amount} step="0.01" value={proposal.vat??''} onChange={e=>set('vat',e.target.value)}/></Field>}
      {proposal.kind==='transfer'&&<><Field label={item.direction==='in'?'الحساب الذي خرج منه المبلغ':'الحساب الذي استلم المبلغ'}><Select required placeholder="اختر الحساب" value={proposal.target||''} onChange={e=>set('target',e.target.value)} options={accounts.filter(a=>a.value!==item.source_account)}/></Field><Note>تضاف الحركة المقابلة في الحساب المختار. تأكد أنها غير مسجلة مسبقًا.</Note></>}
      {proposal.kind==='supplier'&&<Field label="المورد"><Select required placeholder="اختر المورد" value={proposal.supplier_id?`${proposal.supplier_kind}:${proposal.supplier_id}`:''} onChange={e=>{const[k,id]=e.target.value.split(':');setProposal(p=>({...p,supplier_id:id,supplier_kind:k}))}} options={data.suppliers.map(s=>({value:`${s.kind}:${s.id}`,label:s.name}))}/></Field>}
      <Field label="سبب المعالجة"><Textarea required minLength={10} maxLength={1000} rows={2} value={proposal.reason} onChange={e=>set('reason',e.target.value)} placeholder="وضح ما الذي تبين بعد المراجعة"/></Field>
      <Button type="submit" variant="primary" disabled={busy}>إرسال لاعتماد المالك</Button>
    </form>}
    {pending&&item.proposal.kind==='transfer'&&<Note>الاعتماد يضيف الحركة المقابلة في الحساب المختار. تأكد أنها غير مسجلة مسبقًا.</Note>}
    {pending&&owner&&<><Check checked={confirmed} onChange={setConfirmed} label="راجعت السبب والمستندات وأعتمد هذه المعالجة"/><div className="suspense-actions"><Button variant="primary" disabled={busy||!confirmed} onClick={()=>act('approve',{confirmed:true})}>اعتماد المعالجة</Button><Button disabled={busy} onClick={()=>setReturning(!returning)}>إرجاع للمراجعة</Button></div>{returning&&<><Field label="سبب الإرجاع"><Textarea minLength={10} maxLength={1000} value={returnReason} onChange={e=>setReturnReason(e.target.value)}/></Field><Button disabled={busy||returnReason.trim().length<10} onClick={()=>act('return',{reason:returnReason})}>تأكيد الإرجاع</Button></>}</>}
    {error&&<Note tone="error">{error}</Note>}
    <details><summary>سجل المعالجة</summary>{historyError&&<Note tone="error">{historyError}</Note>}{events?.map(e=><p key={e.id}><strong>{{opened:'تسجيل الفرق',proposed:'اقتراح معالجة',returned:'إرجاع للمراجعة',resolved:'اعتماد المعالجة'}[e.action]||e.action}</strong> · {e.actor.name} · {new Date(e.created_at).toLocaleString('ar-SA',{calendar:'gregory'})}<br/>{e.detail.reason}</p>)}</details>
  </div>
}
