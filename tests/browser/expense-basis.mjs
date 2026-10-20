// Real review components and payload builder, synthetic data, all network blocked.
// Run: node tests/browser/expense-basis.mjs (Playwright required).
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
let playwright
try { playwright = require('playwright') } catch {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw new Error('Install Playwright.')
  playwright = createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, '../package.json'))('playwright')
}
const temp = await mkdtemp(path.join(tmpdir(), 'expense-basis-'))
const fixture = path.join(temp, 'fixture.js')
await build({ stdin: { contents: `
  import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
  import {DocCard} from './src/pages/PendingDocuments';
  import {buildInvoicePayload} from './src/lib/approvalV2';
  import {withManualInvoice} from './src/lib/manualReview';
  const root=createRoot(document.getElementById('root'));
  const base={type:'expense',date:'2026-01-01',paySource:'cash',transType:'Test category',description:'Test supplier',totalAmount:230,vatAmount:30,
    items:[{description:'Product A',amount:80},{description:'Product B',amount:120}]};
  const categories=[{id:'main',name:'Test expense',ledger_type:'Test expense',is_active:true}];
  function Fixture({invoices,readOnly,manual}){
    const [rows,setRows]=useState(invoices);
    window.draft=rows;
    const edit=(i,k,v)=>setRows(rows.map((r,j)=>i===j?{...r,[k]:v}:r));
    const capture=i=>window.payloads.push(buildInvoicePayload(rows[i],{original:invoices[i],categories,transTypes:[]}));
    return <DocCard doc={{status:'analyzed',file_name:'synthetic.png',analysis_result:{invoices:rows}}}
      v2={{version:1,mode:'active',invoices:rows.map(r=>({id:r._id,status:'pending'}))}} readOnly={readOnly}
      categories={categories} transTypes={['Test category']} branches={[]} suppliers={[]} payableSuppliers={[]}
      onManualApprove={manual?async(index,invoice)=>{
        const next=withManualInvoice({analysis_result:{invoices},_edit:{invoices:rows}},index,invoice);
        window.payloads.push(buildInvoicePayload(next._edit.invoices[index],{original:invoices[index],categories,transTypes:[]}));
        setRows(next._edit.invoices);
      }:null}
      setup={{settings:{},banks:[{id:'bank-a',name:'Bank A',is_active:true},{id:'bank-b',name:'Bank B',is_active:true}]}} onEdit={(k,v)=>edit(0,k,v)} onEditInvoice={edit}
      onEditItem={(i,patch)=>edit(0,'items',rows[0].items.map((it,j)=>j===i?{...it,...patch}:it))}
      onDeleteItem={i=>edit(0,'items',rows[0].items.filter((_,j)=>i!==j))}
      onApprove={()=>rows.forEach((_,i)=>capture(i))} onApproveInvoice={capture} />
  }
  window.render=(kind='single',readOnly=false,manual=false)=>{
    window.payloads=[];
    const first={...structuredClone(base),_id:'one'};
    const second={...structuredClone(base),_id:'two',amountsBasis:'exclusive',items:[{description:'C',amount:92},{description:'D',amount:138}]};
    const sales={_id:'sales',type:'sales',date:'2026-01-02',description:'Synthetic report',cashSales:10,networkSales:20,transferSales:0,totalSales:999,salesReadingVersion:2,unknownPayments:[{label:'Unreadable',amount:30}],bankAccounts:{network:'bank-a'}};
    const transfer={_id:'transfer',type:'transfer',date:'2026-01-03',description:'Synthetic transfer',amount:999,totalAmount:999,vatAmount:0,paySource:'cash',transType:'إيداع نقدي',bankAccountId:'bank-a'};
    const rows=kind==='multi'?[first,second]:[kind==='sales'?sales:kind==='transfer'?transfer:kind==='duplicate'?{...first,items:[...first.items,{description:'Unit price duplicated',amount:60}]}:first];
    root.render(<Fixture key={Math.random()} invoices={rows} readOnly={readOnly} manual={manual}/>);
  };
`, resolveDir: process.cwd(), sourcefile: 'expense-ui.jsx', loader: 'jsx' },
  bundle: true, outfile: fixture, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'isolated-review', setup(b) {
    b.onLoad({ filter: /[\\/]contexts[\\/]AuthContext\.jsx$/ }, () => ({ contents: 'export const useAuth=()=>({});', loader: 'js' }))
    b.onLoad({ filter: /[\\/]lib[\\/]supabase\.js$/ }, () => ({ contents: 'export const supabase={};', loader: 'js' }))
    b.onLoad({ filter: /[\\/]pages[\\/]PendingDocuments\.jsx$/ }, async args => ({ contents: (await readFile(args.path, 'utf8')) + '\nexport {DocCard};', loader: 'jsx' }))
  } }], logLevel: 'warning' })
const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage()
page.setDefaultTimeout(8000)
const errors=[], network=[], passed=[]
page.on('pageerror', e=>errors.push(String(e)))
await page.route('**/*', r=>{network.push(r.request().url());return r.abort()})
const check=name=>{passed.push(name);console.log('PASS '+name)}
const render=async(kind='single',readOnly=false,manual=false)=>{
  await page.evaluate(({kind,readOnly,manual})=>window.render(kind,readOnly,manual),{kind,readOnly,manual})
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  await page.locator('.rp-form').waitFor()
}
try {
  await page.setContent('<html dir="rtl"><body><div id="root"></div></body></html>')
  await page.addScriptTag({path:fixture})
  await render()
  const approve=page.getByRole('button',{name:'اعتماد',exact:true})
  assert.equal(await approve.isDisabled(),true)
  assert.equal(await page.evaluate(()=>window.draft[0].amountsBasis),undefined)
  check('old net reading stays blocked and unchanged until confirmed')
  await page.getByRole('button',{name:'تأكيد أن البنود قبل الضريبة',exact:true}).click()
  assert.equal(await approve.isEnabled(),true)
  await approve.click()
  const payload=await page.evaluate(()=>window.payloads[0])
  assert.equal(payload.amountsBasis,'exclusive')
  assert.deepEqual(payload.items.map(i=>i.amount),[80,120])
  assert.equal(payload.totalAmount,230);assert.equal(payload.vatAmount,30)
  assert.ok(payload.review_changes.some(s=>s.includes('أساس المبالغ')))
  check('confirmation changes only basis and sends it with the audit trail')
  await page.getByRole('group',{name:'أساس مبالغ البنود'}).getByRole('button',{name:'البنود شاملة الضريبة',exact:true}).click()
  assert.equal(await approve.isDisabled(),true)
  assert.equal(await page.evaluate(()=>window.draft[0].amountsBasis),'inclusive')
  check('reviewer choice is never silently overwritten')
  await render('multi')
  await page.locator('details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true))
  const panels=page.locator('.rp-subinv')
  assert.equal(await page.getByRole('group',{name:'أساس مبالغ البنود'}).count(),2)
  assert.equal(await panels.nth(0).getByRole('button',{name:'اعتماد هذه الفاتورة وحدها'}).isDisabled(),true)
  await panels.nth(0).getByRole('button',{name:'تأكيد أن البنود قبل الضريبة'}).click()
  await panels.nth(1).getByRole('button',{name:'تأكيد أن البنود شاملة الضريبة'}).click()
  for(let i=0;i<2;i++)await panels.nth(i).getByRole('button',{name:'اعتماد هذه الفاتورة وحدها'}).click()
  assert.deepEqual(await page.evaluate(()=>window.payloads.map(p=>p.amountsBasis)),['exclusive','inclusive'])
  const ids=await page.locator('.rp-totals input[id]').evaluateAll(ns=>ns.map(n=>n.id))
  assert.equal(new Set(ids).size,ids.length)
  check('multiple invoices have separate basis, VAT, total and approval payloads')
  await render('duplicate')
  await page.getByText('طابق كل صنف مرة واحدة',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'تأكيد أن البنود قبل الضريبة'}).count(),0)
  assert.equal(await approve.isDisabled(),true)
  assert.equal(await page.evaluate(()=>window.draft[0].items.length),3)
  check('duplicated amounts stay blocked without automatic deletion or balancing')
  await render('single',true)
  assert.equal(await page.getByRole('button',{name:'تأكيد أن البنود قبل الضريبة'}).isDisabled(),true)
  assert.equal(await page.getByRole('group',{name:'أساس مبالغ البنود'}).getByRole('button',{name:'البنود قبل الضريبة',exact:true}).isDisabled(),true)
  check('read-only viewer cannot apply basis changes')
  assert.equal(await page.getByRole('button',{name:'اعتماد يدوي',exact:true}).count(),0)
  await render('duplicate',false,true)
  assert.equal(await approve.isDisabled(),true)
  await page.getByRole('button',{name:'اعتماد يدوي',exact:true}).click()
  let dialog=page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.getByRole('button',{name:'رجوع دون تغيير'}).click()
  assert.equal(await page.evaluate(()=>window.payloads.length),0)
  assert.equal(await page.evaluate(()=>window.draft[0].items.length),3)
  check('manual review can be cancelled without a write or draft change')
  await page.getByRole('button',{name:'اعتماد يدوي',exact:true}).click()
  dialog=page.getByRole('dialog')
  const confirm=dialog.getByRole('button',{name:'تأكيد واعتماد الأرقام اليدوية'})
  assert.equal(await confirm.isDisabled(),true)
  await dialog.getByLabel('ملاحظة المراجعة اليدوية').fill('Compared against the document; OCR repeated a unit price.')
  await dialog.getByRole('checkbox').check()
  await confirm.click()
  await dialog.getByText('اختر تصنيفًا صحيحًا للمبلغ الذي ستعتمده.').waitFor()
  assert.equal(await page.evaluate(()=>window.payloads.length),0)
  await dialog.getByLabel('تصنيف الإجمالي المعتمد',{exact:true}).selectOption('main')
  assert.equal(await confirm.isDisabled(),true)
  await dialog.getByRole('checkbox').check()
  await confirm.click()
  await dialog.waitFor({state:'hidden'})
  const manual=await page.evaluate(()=>window.payloads[0])
  assert.equal(manual.items.length,1)
  assert.equal(manual.items[0].category_id,'main')
  assert.equal(manual.totalAmount,'230.00')
  assert.equal(manual.vatAmount,'30.00')
  assert.equal(manual.manualReview.previous_items.length,3)
  assert.ok(manual.review_changes.some(s=>s.includes('اعتماد بمراجعة يدوية')))
  check('admin confirms a classification and final total despite OCR mismatch, retaining the audit')
  await render('multi',false,true)
  await page.locator('details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true))
  await page.locator('.rp-subinv').nth(1).getByRole('button',{name:'اعتماد يدوي لهذه الفاتورة'}).click()
  dialog=page.getByRole('dialog')
  await dialog.getByLabel('تصنيف الإجمالي المعتمد',{exact:true}).selectOption('main')
  await dialog.getByLabel('ملاحظة المراجعة اليدوية').fill('Reviewed second invoice only.')
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button',{name:'تأكيد واعتماد الأرقام اليدوية'}).click()
  await dialog.waitFor({state:'hidden'})
  assert.deepEqual(await page.evaluate(()=>window.payloads.map(p=>p._id)),['two'])
  assert.equal(await page.evaluate(()=>window.draft[0].items.length),2)
  check('manual action on multiple invoices targets only the selected invoice')
  await render('sales',false,true)
  assert.equal(await approve.isDisabled(),true)
  await page.getByRole('button',{name:'اعتماد يدوي',exact:true}).click()
  dialog=page.getByRole('dialog')
  await dialog.getByLabel('صافي النقدي',{exact:true}).fill('70')
  await dialog.getByLabel('صافي الشبكة / مدى',{exact:true}).fill('120')
  await dialog.getByLabel('صافي التحويل',{exact:true}).fill('40')
  assert.equal(await dialog.getByLabel('حساب الشبكة / مدى',{exact:true}).inputValue(),'bank-a')
  await dialog.getByLabel('ملاحظة المراجعة اليدوية').fill('Confirmed net channels from synthetic source.')
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button',{name:'تأكيد واعتماد الأرقام اليدوية'}).click()
  await dialog.getByText('اختر الحساب البنكي لقناة التحويل.').waitFor()
  await dialog.getByLabel('حساب التحويل',{exact:true}).selectOption('bank-b')
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button',{name:'تأكيد واعتماد الأرقام اليدوية'}).click()
  await dialog.waitFor({state:'hidden'})
  const sale=await page.evaluate(()=>window.payloads[0])
  assert.equal(sale.totalSales,'230.00');assert.equal(sale.cashSales,'70.00')
  assert.deepEqual(sale.bankAccounts,{network:'bank-a',transfer:'bank-b'})
  assert.deepEqual(sale.unknownPayments,[]);assert.equal(sale.manualReview.previous_unknown.length,1)
  check('manual sales confirms net channels and each visible bank account despite OCR warnings')
  await render('transfer',false,true)
  await page.getByRole('button',{name:'اعتماد يدوي',exact:true}).click()
  dialog=page.getByRole('dialog')
  await dialog.getByLabel('الإجمالي المعتمد شامل الضريبة').fill('55')
  await dialog.getByLabel('الحساب البنكي المعتمد').selectOption('bank-b')
  await dialog.getByLabel('ملاحظة المراجعة اليدوية').fill('Confirmed transfer amount.')
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button',{name:'تأكيد واعتماد الأرقام اليدوية'}).click()
  await dialog.waitFor({state:'hidden'})
  const transfer=await page.evaluate(()=>window.payloads[0])
  assert.equal(transfer.amount,'55.00');assert.equal(transfer.transType,'إيداع نقدي');assert.equal(transfer.paySource,'cash');assert.equal(transfer.bankAccountId,'bank-b')
  check('manual transfer keeps transaction routing and sends confirmed amount and displayed bank')
  assert.deepEqual(errors,[]);assert.deepEqual(network,[])
  check('no page errors or network calls')
  console.log(JSON.stringify({passed:passed.length,failed:0}))
} finally { await browser.close();await rm(temp,{recursive:true,force:true}) }
