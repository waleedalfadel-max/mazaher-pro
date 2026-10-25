// Offline browser regression: real image encoding/rotation and real analyzeDocument path.
// All provider replies are synthetic; no customer files, credentials, or network requests.
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import path from 'node:path'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
let playwright
try { playwright = require('playwright') } catch {
  playwright = createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, '../package.json'))('playwright')
}
const bundle = await build({ stdin: { contents: `import {analyzeDocument} from './src/lib/claude.js';
import {uprightImage} from './src/lib/readingImage.js'; window.ocr={analyzeDocument,uprightImage};`,
  resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'iife', platform: 'browser',
  define: { 'import.meta.env': '{}' }, plugins: [{ name: 'synthetic-provider', setup(b) {
    b.onLoad({ filter: /[\\/]lib[\\/]supabase\.js$/ }, () => ({ contents: 'export const supabase={}', loader: 'js' }))
    b.onLoad({ filter: /[\\/]lib[\\/]analyzeRequest\.js$/ }, () => ({ contents: `
      export const createAnalyzeFetch=()=>async init=>{
        window.requests.push({body:JSON.parse(init.body),bytes:new TextEncoder().encode(init.body).length});
        if(window.http413)return {ok:false,status:413,json:async()=>({error:'too large'})};
        if(window.wrapped413)return {ok:true,json:async()=>({error:'CLAUDE_API_ERROR',status:413})};
        return {ok:true,json:async()=>({content:[{text:JSON.stringify({rotation:window.requests.length===1?window.rotation:0,
          invoices:[{type:'expense',description:'Synthetic receipt',amountsBasis:'inclusive',totalAmount:69,vatAmount:9,
          items:[{description:'Synthetic item',quantity:3,unitPrice:23,amount:23,printedLineTotal:69,printedLineBasis:'inclusive'}]}]})}]})};
      }`, loader: 'js' }))
  } }] })
const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage', ...JSON.parse(process.env.CHROMIUM_ARGS || '[]')] })
let checks = 0
const pass = name => { checks++; console.log('PASS ' + name) }
try {
  const page = await browser.newPage()
  await page.route('**/*', route => route.abort())
  await page.setContent('<!doctype html><meta charset="utf-8"><title>Offline OCR fixture</title>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const observed = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1200
    const ctx = canvas.getContext('2d'), image = ctx.createImageData(canvas.width, canvas.height)
    let seed = 1917
    for (let i = 0; i < image.data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) { seed = (1664525 * seed + 1013904223) >>> 0; image.data[i + channel] = seed >>> 24 }
      image.data[i + 3] = 255
    }
    ctx.putImageData(image, 0, 0)
    for (const [color, x, y] of [['#ff0000', 0, 0], ['#00ff00', 2200, 0], ['#0000ff', 0, 1000], ['#ffff00', 2200, 1000]]) {
      ctx.fillStyle = color; ctx.fillRect(x, y, 200, 200)
    }
    const original = canvas.toDataURL('image/jpeg', .85).split(',')[1]
    window.requests = []; window.rotation = 90
    const result = await window.ocr.analyzeDocument(original, 'image/jpeg', 'synthetic.jpeg')
    const requests = window.requests
    const upright = await window.ocr.uprightImage(original, 'image/jpeg', 90)
    const unbounded = structuredClone(requests[1].body)
    unbounded.messages[0].content[0].source = { type: 'base64', media_type: upright.mime, data: upright.base64 }
    const sent = requests[1].body.messages[0].content[0].source
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(sent.data), c => c.charCodeAt(0))], { type: sent.media_type }))
    const sample = document.createElement('canvas'); sample.width = bitmap.width; sample.height = bitmap.height
    const draw = sample.getContext('2d'); draw.drawImage(bitmap, 0, 0)
    const corners = [[50, 50], [1150, 50], [50, 2350], [1150, 2350]].map(([x, y]) => [...draw.getImageData(x, y, 1, 1).data])
    const info = { calls: requests.length, sizes: requests.map(r => r.bytes),
      originalUnchanged: requests[0].body.messages[0].content[0].source.data === original,
      unboundedBytes: new TextEncoder().encode(JSON.stringify(unbounded)).length,
      dimensions: [bitmap.width, bitmap.height], corners, result }
    bitmap.close()
    // Small upright PNG remains exactly as stored. A small rotated PNG remains lossless.
    canvas.width = 180; canvas.height = 300; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 180, 300)
    ctx.fillStyle = 'black'; ctx.fillText('Synthetic text', 20, 70)
    const small = canvas.toDataURL('image/png').split(',')[1]
    window.requests = []; window.rotation = 0
    await window.ocr.analyzeDocument(small, 'image/png', 'small.png')
    info.small = { calls: window.requests.length, identical: window.requests[0].body.messages[0].content[0].source.data === small }
    window.requests = []; window.rotation = 270
    await window.ocr.analyzeDocument(small, 'image/png', 'small.png')
    const smallUp = await window.ocr.uprightImage(small, 'image/png', 270)
    info.smallRotatedLossless = window.requests[1].body.messages[0].content[0].source.data === smallUp.base64
    info.errors = []
    for (const flag of ['http413', 'wrapped413']) {
      window.requests = []; window.rotation = 0; window[flag] = true
      try { await window.ocr.analyzeDocument(small, 'image/png', 'small.png') } catch (error) { info.errors.push({ message: error.message, calls: window.requests.length }) }
      window[flag] = false
    }
    return info
  })
  assert.ok(observed.unboundedBytes > 4_500_000); pass('old upright PNG request reproduces the hosting size limit')
  assert.equal(observed.calls, 2); assert.ok(observed.sizes.every(size => size <= 4_000_000)); pass('both actual reading requests stay within budget, at most two reads')
  assert.equal(observed.originalUnchanged, true); pass('stored JPEG stays byte-for-byte identical on the first read')
  assert.deepEqual(observed.dimensions, [1200, 2400]); pass('oversized upright copy retains full resolution')
  const expected = [[0, 0, 255], [255, 0, 0], [255, 255, 0], [0, 255, 0]]
  observed.corners.forEach((pixel, i) => expected[i].forEach((value, c) => assert.ok(Math.abs(pixel[c] - value) < 10)))
  pass('all four marked corners survive in their correct rotated positions, with no crop')
  assert.equal(observed.result.invoices[0].items[0].amount, '69.00'); assert.equal(observed.result._reading.rotated, 90)
  pass('second reading supplies the normalized amounts and rotation metadata')
  assert.deepEqual(observed.small, { calls: 1, identical: true }); assert.equal(observed.smallRotatedLossless, true)
  pass('small upright PNG is unchanged and small rotated PNG remains lossless')
  assert.equal(observed.errors.length, 2); observed.errors.forEach(e => { assert.match(e.message, /413/); assert.match(e.message, /حجم طلب القراءة/); assert.equal(e.calls, 1) })
  pass('hosting and provider size errors are explained without automatic retries')
  console.log(JSON.stringify({ checks, requestBytes: observed.sizes, oldRotatedRequestBytes: observed.unboundedBytes }))
} finally { await browser.close() }
