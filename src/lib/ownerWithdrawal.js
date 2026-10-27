import { isWithdrawal } from './financeRules.js'
import { toLatinNumber } from './amountInput.js'
export const WITHDRAWAL_OPTION = { value: 'owner_withdrawal', label: 'مسحوبات مالك' }
export const withdrawalTypes = types => (types || []).filter(isWithdrawal)
export const isOwnerWithdrawal = inv => inv?.type === 'transfer' && (inv.transferPurpose === WITHDRAWAL_OPTION.value || isWithdrawal(inv.transType))
export const withdrawalAmount = inv => inv?.totalAmount ?? inv?.amount ?? ''
export function toOwnerWithdrawal(inv) {
 return {_id:inv?._id,type:'transfer',transferPurpose:WITHDRAWAL_OPTION.value,date:inv?.date||'',description:inv?.description||'',invoiceNumber:inv?.invoiceNumber||'',
 transType:isOwnerWithdrawal(inv)?inv.transType||'':'',amount:withdrawalAmount(inv),totalAmount:withdrawalAmount(inv),vatAmount:inv?.vatAmount??0,
 paySource:['bank','cash'].includes(inv?.paySource)?inv.paySource:'',bankAccountId:inv?.bankAccountId||'',items:[]}
}
export function fromOwnerWithdrawal(inv,type){
 const n={...inv,type,transType:'',items:type==='expense'?[{description:inv.description||'',amount:withdrawalAmount(inv),category_main:'',category_sub:''}]:[]}
 delete n.transferPurpose;return n
}
export function withdrawalBlockReason(inv,types){
 if(!isOwnerWithdrawal(inv))return null
 if(!withdrawalTypes(types).includes(inv.transType))return 'اختر اسم المسحوبات من الأنواع المسجلة للمنشأة.'
 if(!['cash','bank'].includes(inv.paySource))return 'اختر البنك أو الصندوق الذي خرج منه مبلغ المسحوبات.'
 const amount=toLatinNumber(withdrawalAmount(inv)),vat=toLatinNumber(inv.vatAmount??0)
 if(!/^\d+(?:\.\d{1,2})?$/.test(amount)||!Number.isFinite(Number(amount))||Number(amount)<=0)return 'راجع مبلغ المسحوبات؛ يجب أن يكون موجبًا وبمنزلتين عشريتين كحد أقصى.'
 if(vat!==''&&(!/^\d+(?:\.\d{1,2})?$/.test(vat)||Number(vat)!==0))return 'مسحوبات المالك بلا ضريبة؛ راجع الضريبة المقروءة وصححها قبل الاعتماد.'
 return null
}
