import { useState } from 'react'
import { Button, Field, Input, Note, Select } from '../ui/components.jsx'
import { confirmExpenseRounding } from '../lib/expenseReading.js'

export default function ExpenseReadingHelp({ invoice, exact, onReplace, readOnly }) {
  const [line,setLine]=useState(''),[reason,setReason]=useState('')
  if (!invoice) return null
  return <>
    {Array.isArray(invoice.readingWarnings) && invoice.readingWarnings.length>0 && <Note tone="warning">{invoice.readingWarnings.join("؛ ")}</Note>}
    {invoice.items?.some(it=>it.quantity!=null||it.unitPrice!=null||it.printedLineTotal!=null)&&<details><summary>دليل قراءة الكمية وسعر الوحدة وإجمالي الصنف</summary><ul>{invoice.items.map((it,i)=><li key={i}>{it.description}: الكمية {it.quantity??'غير مقروءة'} · سعر الوحدة {it.unitPrice??'غير مقروء'} · إجمالي الصنف المطبوع {it.printedLineTotal??'غير مقروء'} · المبلغ الحالي {it.amount??'غير مقروء'}</li>)}</ul></details>}
    {invoice.items?.length>0 && exact?.status==='mismatch' && Math.abs(exact.diff)<=2 && <Note tone="warning" title="فرق صغير يحتاج مراجعتك، وقد يكون تقريبًا">
      راجع الأرقام في الصورة أولًا. إذا ثبت أنه تقريب، اختر البند الذي تُسند إليه الهللات واكتب السبب؛ يُحفظ التعديل ولا يُنشأ صنف وهمي.
      <Field label="البند الذي راجعته"><Select value={line} placeholder="اختر البند" options={invoice.items.map((it,i)=>({value:String(i),label:`${i+1}. ${it.description}`}))} onChange={e=>setLine(e.target.value)}/></Field>
      <Field label="سبب تسوية التقريب"><Input value={reason} onChange={e=>setReason(e.target.value)}/></Field>
      <Button disabled={readOnly||line===''||!reason.trim()||!onReplace} onClick={()=>{const next=confirmExpenseRounding(invoice,Number(line),reason);if(next){onReplace(next);setLine('');setReason('')}}}>تأكيد فرق التقريب على البند المحدد</Button>
    </Note>}
    {invoice.roundingReview && <p className="ts-field-hint">تعديل تقريب مسجّل: {invoice.roundingReview.reason} ({invoice.roundingReview.difference} ر.س).</p>}
  </>
}
