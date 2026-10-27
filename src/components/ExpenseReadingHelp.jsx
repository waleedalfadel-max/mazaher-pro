import { useState } from 'react'
import { Button, Field, Input, Note, Select } from '../ui/components.jsx'
import { basisConfirmed, confirmExpenseBasis, confirmExpenseRounding } from '../lib/expenseReading.js'

const BASIS_TEXT = { inclusive: 'شاملة الضريبة', exclusive: 'قبل الضريبة' }

export default function ExpenseReadingHelp({ invoice, exact, onReplace, readOnly }) {
  const [line,setLine]=useState(''),[reason,setReason]=useState('')
  if (!invoice) return null
  const small = invoice.items?.length>0 && exact?.status==='mismatch' && Math.abs(exact.diff)<=2
  const confirmed = basisConfirmed(invoice)
  return <>
    {Array.isArray(invoice.readingWarnings) && invoice.readingWarnings.length>0 && <Note tone="warning">{invoice.readingWarnings.join("؛ ")}</Note>}
    {invoice.lineBasisReading && <p className="ts-field-hint">
      {invoice.lineBasisReading==='inclusive' ? 'استُخدم إجمالي كل صنف الشامل للضريبة كما طُبع' : 'استُخدم صافي كل صنف قبل الضريبة كما طُبع'}، لأن مجموعه يطابق إجمالي الفاتورة بالهللة. القراءة الأولى محفوظة في دليل القراءة.
    </p>}
    {invoice.items?.some(it=>it.quantity!=null||it.unitPrice!=null||it.printedLineTotal!=null||it.lineNet!=null)&&<details><summary>دليل قراءة الكمية وسعر الوحدة وإجمالي الصنف</summary><ul>{invoice.items.map((it,i)=><li key={i}>{it.description}: الكمية {it.quantity??'غير مقروءة'} · سعر الوحدة {it.unitPrice??'غير مقروء'}{it.lineNet!=null?` · الصافي قبل الضريبة ${it.lineNet}`:''}{it.lineVat!=null?` · ضريبة الصنف ${it.lineVat}`:''} · إجمالي الصنف المطبوع {it.printedLineTotal??'غير مقروء'} · المبلغ الحالي {it.amount??'غير مقروء'}{it.readingAmount!=null?` · القراءة الأولى ${it.readingAmount}`:''}</li>)}</ul>{invoice.readingBasis&&<p className="ts-field-hint">أساس القراءة الأولى: {BASIS_TEXT[invoice.readingBasis]||invoice.readingBasis}</p>}</details>}
    {small && <Note tone="warning" title="فرق صغير غير مفسّر؛ لا يُعدّ تقريبًا قبل التحقق">
      {!confirmed ? <>
        طابق أولًا أساس المبالغ وإجمالي كل صنف مع الصورة. إذا كانت الفاتورة تطبع لكل صنف إجماليًا شاملًا للضريبة فأدخله بدل المبلغ قبل الضريبة واختر «البنود شاملة الضريبة»؛ قد يختفي الفرق بذلك.
        <div><Button size="sm" disabled={readOnly||!onReplace} onClick={()=>{const next=confirmExpenseBasis(invoice,exact.basis);if(next)onReplace(next)}}>
          {`راجعت الصورة: البنود ${BASIS_TEXT[exact.basis]}`}
        </Button></div>
      </> : <>
        أكدتَ أن البنود {BASIS_TEXT[exact.basis]}. إن بقي الفرق بعد مطابقة كل صنف، اختر البند الذي تُسند إليه الهللات واكتب السبب؛ يُحفظ المبلغ الأصلي مع التعديل ولا يُنشأ صنف وهمي.
        <Field label="البند الذي راجعته"><Select value={line} placeholder="اختر البند" options={invoice.items.map((it,i)=>({value:String(i),label:`${i+1}. ${it.description}`}))} onChange={e=>setLine(e.target.value)}/></Field>
        <Field label="سبب تسوية الفرق"><Input value={reason} onChange={e=>setReason(e.target.value)}/></Field>
        <Button disabled={readOnly||line===''||!reason.trim()||!onReplace} onClick={()=>{const next=confirmExpenseRounding(invoice,Number(line),reason);if(next){onReplace(next);setLine('');setReason('')}}}>تأكيد تسوية الفرق على البند المحدد</Button>
      </>}
    </Note>}
    {invoice.roundingReview && <p className="ts-field-hint">تسوية فرق مسجّلة على البند {invoice.roundingReview.line+1}: {invoice.roundingReview.from} ← {invoice.roundingReview.to} ({invoice.roundingReview.difference} ر.س)؛ {invoice.roundingReview.reason}.</p>}
  </>
}
