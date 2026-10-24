import test from 'node:test'
import assert from 'node:assert/strict'
import { receiptImageSize } from '../src/lib/receiptImageSize.js'

test('portrait and landscape receipts preserve identical detail without cropping or enlargement',()=>{
 for(const [w,h] of [[800,3200],[1600,4800],[6000,24000],[100,100]]){
  const a=receiptImageSize(w,h),b=receiptImageSize(h,w)
  assert.deepEqual(a,{width:b.height,height:b.width})
  assert(a.width<=w && a.height<=h)
  assert(Math.abs(a.width/a.height-w/h)<0.002)
 }
 assert.deepEqual(receiptImageSize(800,3200),{width:800,height:3200})
 assert.deepEqual(receiptImageSize(1600,4800),{width:1400,height:4200})
 assert.deepEqual(receiptImageSize(6000,24000),{width:1400,height:5600})
})
test('unusable dimensions fail explicitly',()=>{
 for(const [w,h] of [[0,1],[2,0],[NaN,8],[8,Infinity],[-2,5]])assert.throws(()=>receiptImageSize(w,h))
})
