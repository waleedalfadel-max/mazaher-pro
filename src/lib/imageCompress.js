import { receiptImageSize } from './receiptImageSize.js'
const base64Of = file => new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(file)})
const blobOf = (canvas,quality) => new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('تعذّر تجهيز الصورة')),'image/jpeg',quality))
async function load(file) {
  const url=URL.createObjectURL(file)
  try {return await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('تعذّر فتح الصورة؛ أرسل PNG أو JPEG'));img.src=url})}
  finally {URL.revokeObjectURL(url)}
}
// Store an original within limits byte-for-byte. A receipt's short edge governs resolution,
// regardless of orientation; a landscape receipt is not shrunk more than an upright one.
export async function compressImage(file,maxSizeMB=3,maxWidth=1400) {
  const img=await load(file), size=receiptImageSize(img.width,img.height,maxWidth)
  const limit=maxSizeMB*1024*1024
  if(size.width===img.width&&size.height===img.height&&file.size<=limit&&['image/jpeg','image/png','image/webp'].includes(file.type))return file
  const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height
  for(let step=0;step<10;step++) {
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height)
    for(const q of [0.93,0.85,0.75]) {const blob=await blobOf(canvas,q);if(blob.size<=limit)return new File([blob],file.name,{type:'image/jpeg'})}
    canvas.width=Math.max(1,Math.round(canvas.width*0.85));canvas.height=Math.max(1,Math.round(canvas.height*0.85))
  }
  throw new Error('حجم الصورة كبير؛ أعد رفع صورة أوضح للمستند وحده')
}
export async function fitImageBase64(base64,mime,maxSizeMB=3,maxWidth=1400) {
  if(!mime?.startsWith('image/'))return {base64,mime,recompressed:false}
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),file=new File([bytes],'image',{type:mime})
  const out=await compressImage(file,maxSizeMB,maxWidth)
  return out===file?{base64,mime,recompressed:false}:{base64:await base64Of(out),mime:out.type,recompressed:true}
}
export async function compressImageBase64(base64,mime,maxSizeMB=3,maxWidth=1400) {
  return (await fitImageBase64(base64,mime,maxSizeMB,maxWidth)).base64
}
