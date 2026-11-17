// تجهيز صورة المستند للقراءة الآلية (2026-10-19، من القراءة الفعلية لتقرير مبيعات مدوّر 90°):
//   • لا ضغط ثانٍ: الصورة المخزّنة ضُغطت عند الرفع؛ تُرسل كما هي ما دامت ضمن الحدود (src/lib/imageCompress.js).
//   • التدوير: القراءة الأولى تعيد rotation (0/90/180/270 باتجاه عقارب الساعة)؛ غير الصفر ⇒ تُدار الصورة مستقيمة كاملة
//     وتُجهّز PNG بلا فقد، ثم قراءة ثانية واحدة. readingRequest يضبط حجم نسخة الإرسال عند تجاوز حد الطلب فقط.
//   • بلا قصّ آلي: كشف حافة الورق لم يجد حدًا واضحًا في الصورة الفعلية (إضاءة وظلال على سطح معدني)، والقصّ الخاطئ قد يقطع التقرير؛
//     فتُرسل الصورة كاملة بعد التدوير.
// الحسابات الخالصة (normRotation، rotatedSize) مختبرة في Node؛ الرسم بـ canvas في المتصفح (local-test/reading-rotation-ui.mjs).

export const ROTATIONS = [0, 90, 180, 270]
export const normRotation = v => { const n = Number(v); return ROTATIONS.includes(n) ? n : 0 }

/** أبعاد الصورة بعد تدويرها باتجاه عقارب الساعة. */
export const rotatedSize = (w, h, deg) => (deg === 90 || deg === 270 ? { w: h, h: w } : { w, h })

const loadBitmap = async (base64, mime) => {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  return createImageBitmap(new Blob([bytes], { type: mime }))
}
const canvasToBase64 = (canvas, type) => new Promise(resolve => canvas.toBlob(b => {
  const r = new FileReader(); r.onload = e => resolve(e.target.result.split(',')[1]); r.readAsDataURL(b)
}, type))

/**
 * يدير الصورة كاملة باتجاه عقارب الساعة deg درجة ويعيدها PNG بلا فقد.
 * @returns {Promise<{ base64: string, mime: 'image/png', rotated: number, width: number, height: number }>}
 */
export async function uprightImage(base64, mime, deg) {
  const bmp = await loadBitmap(base64, mime)
  const { w, h } = rotatedSize(bmp.width, bmp.height, deg)
  const out = document.createElement('canvas'); out.width = w; out.height = h
  const g = out.getContext('2d')
  g.translate(w / 2, h / 2); g.rotate(deg * Math.PI / 180); g.drawImage(bmp, -bmp.width / 2, -bmp.height / 2)
  return { base64: await canvasToBase64(out, 'image/png'), mime: 'image/png', rotated: deg, width: w, height: h }
}

// Supplemental overlapping views preserve the whole source as the FIRST image.
// No paper-edge detection, missing strip or replacement of the stored original.
export function detailWindows(width, height) {
  if (width < 900 && height < 1200) return []
  const w = Math.ceil(width * .7), h = Math.ceil(height * .6)
  return [{x:0,y:0,w,h},{x:width-w,y:0,w,h},{x:0,y:height-h,w,h},{x:width-w,y:height-h,w,h}]
}
export async function readingDetailImages(block) {
  if (block?.type !== 'image' || typeof createImageBitmap !== 'function') return [block]
  const bmp = await loadBitmap(block.source.data, block.source.media_type)
  try {
    const details = []
    for (const box of detailWindows(bmp.width, bmp.height)) {
      const out = document.createElement('canvas'); out.width = box.w; out.height = box.h
      const g = out.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0,0,box.w,box.h)
      g.drawImage(bmp,box.x,box.y,box.w,box.h,0,0,box.w,box.h)
      const raw = await canvasToBase64(out,'image/jpeg')
      const { fitImageBase64 } = await import('./imageCompress.js')
      const image = await fitImageBase64(raw,'image/jpeg',.35,Infinity)
      details.push({type:'image',source:{type:'base64',media_type:image.mime,data:image.base64}})
    }
    return [block, ...details]
  } finally { bmp.close() }
}
