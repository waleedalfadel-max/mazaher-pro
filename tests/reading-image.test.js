// تجهيز صورة المستند للقراءة (src/lib/readingImage.js): الحسابات الخالصة. الرسم بـ canvas مختبر في المتصفح (local-test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normRotation, rotatedSize } from '../src/lib/readingImage.js'

test('التدوير المقبول 0/90/180/270 فقط؛ غيره صفر (لا تدوير)', () => {
  for (const v of [0, 90, 180, 270, '270']) assert.equal(normRotation(v), Number(v))
  for (const v of [45, -90, 360, null, undefined, 'x']) assert.equal(normRotation(v), 0)
})

test('الأبعاد بعد التدوير: ربع الدورة يبدّل العرض والارتفاع', () => {
  assert.deepEqual(rotatedSize(1400, 788, 270), { w: 788, h: 1400 })
  assert.deepEqual(rotatedSize(1400, 788, 90), { w: 788, h: 1400 })
  assert.deepEqual(rotatedSize(1400, 788, 180), { w: 1400, h: 788 })
})

test('detail windows overlap and cover all four corners without replacing the original',async()=>{
 const {detailWindows,readingDetailImages}=await import('../src/lib/readingImage.js')
 assert.deepEqual(detailWindows(600,800),[])
 const boxes=detailWindows(1400,2000)
 assert.equal(boxes.length,4)
 for(const [x,y] of [[0,0],[1399,0],[0,1999],[1399,1999],[700,1000]])assert.ok(boxes.some(b=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h))
 const pdf={type:'document',source:{data:'abc'}}
 assert.deepEqual(await readingDetailImages(pdf),[pdf])
})
