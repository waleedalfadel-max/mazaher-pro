import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSafeBody } from '../api/_guard.js'
import { detailWindows } from '../src/lib/readingImage.js'
import { prepareReadingRequest, READING_REQUEST_LIMIT } from '../src/lib/readingRequest.js'

test('full receipt plus overlapping details reaches the production proxy within its guarded boundary',async()=>{
 const image={type:'image',source:{type:'base64',media_type:'image/jpeg',data:'YWJj'}}
 const body={messages:[{role:'user',content:[image,...detailWindows(1400,1925).map(()=>structuredClone(image)),{type:'text',text:'Independent printed-number transcription'}]}]}
 const prepared=await prepareReadingRequest(body)
 assert.ok(Buffer.byteLength(prepared)<READING_REQUEST_LIMIT)
 const safe=buildSafeBody(JSON.parse(prepared))
 assert.equal(safe.messages[0].content.length,6)
 assert.throws(()=>buildSafeBody({...body,messages:[{role:'user',content:[...body.messages[0].content,image]}]}))
 const bad=structuredClone(body);bad.messages[0].content[1].source={type:'url',url:'https://example.com/private'}
 assert.throws(()=>buildSafeBody(bad))
})
