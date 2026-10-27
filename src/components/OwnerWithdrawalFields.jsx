import React from 'react'
import {Field,Input,Note,Select} from '../ui/components.jsx'
import {acceptAmount} from '../lib/amountInput.js'
import {withdrawalTypes,withdrawalAmount} from '../lib/ownerWithdrawal.js'
export default function OwnerWithdrawalFields({invoice,transTypes,onPatch,readOnly}){
 const types=withdrawalTypes(transTypes)
 return <div data-k="owner-withdrawal"><Note>مسحوبات شخصية للمالك: تنقص الحساب المختار، وتظهر ضمن المسحوبات دون أن تدخل في المصروفات أو تخفض الربح.</Note>
 {!types.length&&<Note tone="warning">لا يوجد نوع مسحوبات مسجل لهذه المنشأة.</Note>}
 <div className="ts-form-grid"><Field label="اسم المسحوبات"><Select data-k="withdrawal-type" value={invoice.transType||''} disabled={readOnly} placeholder="— اختر —" options={types.map(t=>({value:t,label:t}))} onChange={e=>onPatch({transType:e.target.value})}/></Field>
 <Field label="مبلغ المسحوبات"><Input data-k="withdrawal-amount" numeric dir="ltr" value={withdrawalAmount(invoice)} disabled={readOnly} onChange={e=>{const v=acceptAmount(e.target.value);if(v!==null)onPatch({amount:v,totalAmount:v})}}/></Field>
 <Field label="الضريبة المقروءة" hint="المسحوبات الشخصية لا تحمل ضريبة."><Input data-k="withdrawal-vat" numeric dir="ltr" value={invoice.vatAmount??0} disabled={readOnly} onChange={e=>{const v=acceptAmount(e.target.value);if(v!==null)onPatch({vatAmount:v})}}/></Field></div></div>
}
