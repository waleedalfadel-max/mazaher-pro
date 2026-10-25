import test from 'node:test'
import assert from 'node:assert/strict'
import { categoryChoice, readingCategoryLinks } from '../src/lib/categoryLinks.js'
import { buildInvoicePayload } from '../src/lib/approvalV2.js'
const categories = [
  {id:'a', name:'تشغيل', ledger_type:'مصروفات', financial_class:'opex'},
  {id:'b', name:'رسوم', ledger_type:'مصروفات', financial_class:'opex'},
  {id:'a1', parent_id:'a', name:'اتصالات'},
  {id:'b1', parent_id:'b', name:'رخص'},
  {id:'old', parent_id:'a', name:'قديم', is_active:false},
]
test('visible parent and child replace stale identifiers', () => {
  const x=categoryChoice(categories,{category_main:'رسوم',category_sub:'رخص',category_id:'a',subcategory_id:'a1'})
  assert.equal(x.category_id,'b');assert.equal(x.subcategory_id,'b1')
})
test('unknown, inactive or mismatched child never keeps a hidden identifier', () => {
  for (const sub of ['اتصالات','قديم','مجهول','']) {
    const x=categoryChoice(categories,{category_main:'رسوم',category_sub:sub,category_id:'a',subcategory_id:'a1'})
    assert.equal(x.subcategory_id,null)
  }
  assert.equal(categoryChoice(categories,{category_main:'مجهول',category_id:'a'}).category_id,null)
})
test('ambiguous names cannot silently choose the first record', () => {
  assert.equal(categoryChoice([...categories,{id:'dup',name:'رسوم'}],{category_main:'رسوم'}).category_id,null)
})
test('no-line invoice uses the selected name when two parents share one ledger type', () => {
  const x=buildInvoicePayload({type:'expense',category_main:'رسوم',category_sub:'رخص',transType:'مصروفات',category_id:'a',items:[]},
    {categories,transTypes:['مصروفات']})
  assert.equal(x.category_id,'b');assert.equal(x.subcategory_id,'b1');assert.equal(x.category_main,'رسوم')
})
test('reading normalizes expenses only and preserves amounts and original object', () => {
  const original={invoices:[{type:'expense',items:[{description:'x',amount:71.25,category_main:'رسوم',category_sub:'رخص',category_id:'a'}]},
    {type:'transfer',amount:12,category_main:'تحويل'}]}
  const x=readingCategoryLinks(original,categories)
  assert.equal(x.invoices[0].items[0].category_id,'b');assert.equal(x.invoices[0].items[0].amount,71.25)
  assert.equal(original.invoices[0].items[0].category_id,'a');assert.equal(x.invoices[1],original.invoices[1])
})
