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
  const root=createRoot(document.getElementById('root'));
  const base={type:'expense',date:'2026-01-01',paySource:'cash',transType:'Test category',description:'Test supplier',totalAmount:230,vatAmount:30,
    items:[{description:'Product A',amount:80},{description:'Product B',amount:120}]};
  function Fixture({invoices,readOnly}){
    const [rows,setRows]=useState(invoices);
    window.draft=rows;
    const edit=(i,k,v)=>setRows(rows.map((r,j)=>i===j?{...r,[k]:v}:r));
    const capture=i=>window.payloads.push(buildInvoicePayload(rows[i],{original:invoices[i],categories:[],transTypes:[]}));
    return <DocCard doc={{status:'analyzed',file_name:'synthetic.png',analysis_result:{invoices:rows}}}
      v2={{version:1,mode:'active',invoices:rows.map(r=>({id:r._id,status:'pending'}))}} readOnly={readOnly}
      categories={[]} transTypes={['Test category']} branches={[]} suppliers={[]} payableSuppliers={[]}
      setup={{settings:{},banks:[]}} onEdit={(k,v)=>edit(0,k,v)} onEditInvoice={edit}
      onEditItem={(i,patch)=>edit(0,'items',rows[0].items.map((it,j)=>j===i?{...it,...patch}:it))}
      onDeleteItem={i=>edit(0,'items',rows[0].items.filter((_,j)=>i!==j))}
      onApprove={()=>rows.forEach((_,i)=>capture(i))} onApproveInvoice={capture} />
  }
  window.render=(kind='single',readOnly=false)=>{
    window.payloads=[];
    const first={...structuredClone(base),_id:'one'};
    const second={...structuredClone(base),_id:'two',amountsBasis:'exclusive',items:[{description:'C',amount:92},{description:'D',amount:138}]};
    const rows=kind==='multi'?[first,second]:[kind==='duplicate'?{...first,items:[...first.items,{description:'Unit price duplicated',amount:60}]}:first];
    root.render(<Fixture key={Math.random()} invoices={rows} readOnly={readOnly}/>);
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
const render=async(kind='single',readOnly=false)=>{
  await page.evaluate(({kind,readOnly})=>window.render(kind,readOnly),{kind,readOnly})
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  await page.getByRole('group',{name:'أساس مبالغ البنود',includeHidden:true}).first().waitFor({state:'attached'})
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
  assert.deepEqual(errors,[]);assert.deepEqual(network,[])
  check('no page errors or network calls')
  console.log(JSON.stringify({passed:passed.length,failed:0}))
} finally { await browser.close();await rm(temp,{recursive:true,force:true}) }
