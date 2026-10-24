import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validRereading,readingReplaced,resetReplacedReview} from '../src/lib/documentReread.js'
test('empty OCR envelopes and metadata cannot replace a sound reading',()=>{
 for(const x of [null,{},[],{invoices:[]},{invoices:[{}]},{invoices:[{type:'expense',paySource:'cash'}]},{invoices:[{description:' \t ',items:[{}]}]},{invoices:[{items:[],amount:null}]},{invoices:[{date:'2026-10-01'},{}]}])assert.equal(validRereading(x),false,JSON.stringify(x))
})
test('partial evidence and explicit zero remain reviewable',()=>{
 for(const x of [{date:'2026-10-01'},{description:'Unclear amount'},{totalAmount:0},{items:[{description:'Unclear line'}]},{paymentLines:[{label:'Cash',amount:0}]},{reportNetTotal:0},{beneficiary:'Synthetic supplier'}])assert.equal(validRereading({invoices:[x]}),true)
})
test('reading replacement differs from ordinary prepare/partial approval',()=>{
 assert.equal(readingReplaced({invoices:[{amount:4}]},{invoices:[{_id:'a',amount:4}]}),false)
 assert.equal(readingReplaced({invoices:[{_id:'a'}]},{invoices:[{_id:'a'}]}),false)
 assert.equal(readingReplaced({invoices:[{_id:'a'}]},{invoices:[{_id:'b'}]}),true)
 assert.equal(readingReplaced({invoices:[{}]},{_readingId:'new',invoices:[{}]}),true)
})
test('replacement drops reviewer decisions and retains image access',()=>{
 const next=resetReplacedReview({id:'d',branch:'Edited',_origBranch:'North',_edit:{old:1},_req:{id:'old'},_supplierId:'old',_receiptDup:{},_dupDecisions:{},_draftSavedAt:1,_imageData:'image',_showImage:true}, {invoices:[{amount:60}]})
 assert.equal(next.branch,'North');assert.equal(next._edit,undefined);assert.equal(next._req,undefined);assert.equal(next._supplierId,undefined);assert.equal(next._receiptDup,undefined);assert.equal(next._dupDecisions,undefined);assert.equal(next._draftSavedAt,null);assert.equal(next._imageData,'image');assert.equal(next._readingReviewRequired,true)
})
