// أصول هوية تحسيب للمطاعم (معاينة المشاركة وأيقونات الشاشة الرئيسية والمتصفح) من مصدر الشعار نفسه المستعمل في واجهة الدخول
// (رمز .ts-mark في src/ui/theme.css: مربع صغير ثم شريطان، كما في ملفات هوية تحسيب tahseeb-icon/maskable).
// يرسم كل أصل في Edge بلا واجهة بمقاسه الدقيق، ويكتب الملفات في public/branding بأسماء جديدة (-r1) حتى لا يبقى القديم محمّلًا.
//   node scripts/brand-assets.mjs
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const OUT = join(ROOT, 'public/branding')
const V = 'r1'
const NAVY = '#142D3A', PETROL = '#087F8C', MINT = '#DDF2EE'
mkdirSync(OUT, { recursive: true })

// الرمز المختصر: مربع أبيض صغير، شريط أبيض، شريط بترولي (34×38 كما في .ts-mark)
const MARK = `<rect x="12.5" y="2.5" width="9" height="9" rx="2" fill="#FFFFFF"/><rect x="0.5" y="15.5" width="33" height="8" rx="4" fill="#FFFFFF"/><rect x="0.5" y="27.5" width="33" height="8" rx="4" fill="${PETROL}"/>`
// أيقونة: خلفية كاملة بلون الهوية والرمز بنسبة scale من الضلع (maskable أصغر ليبقى داخل منطقة الأمان 80%)
function iconSvg(size, ratio) {
  const s = (size * ratio) / 34, w = 34 * s, h = 38 * s
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><title>تحسيب</title><rect width="${size}" height="${size}" fill="${NAVY}"/><g transform="translate(${(size - w) / 2} ${(size - h) / 2}) scale(${s})">${MARK}</g></svg>`
}
const fontDir = join(ROOT, 'node_modules/@fontsource/ibm-plex-sans-arabic/files')
const font = w => pathToFileURL(join(fontDir, `ibm-plex-sans-arabic-arabic-${w}-normal.woff2`)).href
const fontLatin = w => pathToFileURL(join(fontDir, `ibm-plex-sans-arabic-latin-${w}-normal.woff2`)).href
const SHARE = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
@font-face { font-family: Plex; font-weight: 700; src: url(${font(700)}) format('woff2'); }
@font-face { font-family: Plex; font-weight: 500; src: url(${font(500)}) format('woff2'); }
@font-face { font-family: Plex; font-weight: 500; src: url(${fontLatin(500)}) format('woff2'); unicode-range: U+0000-00FF; }
html, body { margin: 0; width: 1200px; height: 630px; background: ${NAVY}; overflow: hidden; }
.c { width: 1200px; height: 630px; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: Plex; color: #fff; }
.en { font-weight: 500; font-size: 22px; letter-spacing: 8px; color: #8BAFB8; direction: ltr; margin-bottom: 34px; }
.brand { display: flex; align-items: center; gap: 38px; }
.word { font-weight: 700; font-size: 132px; line-height: 1; letter-spacing: -3px; }
.slogan { margin-top: 46px; font-weight: 500; font-size: 40px; color: ${MINT}; }
.sub { margin-top: 12px; font-weight: 500; font-size: 26px; color: #B4C8CD; }
.line { margin-top: 44px; width: 124px; height: 5px; border-radius: 3px; background: ${PETROL}; }
</style></head><body><div class="c">
<div class="en">TAHSEEB</div>
<div class="brand"><svg width="128" height="143" viewBox="0 0 34 38">${MARK}</svg><div class="word">تحسيب</div></div>
<div class="slogan">أعمالك أوضح. وقرارك أقرب.</div>
<div class="sub">متابعة مالية للمطاعم والمقاهي</div>
<div class="line"></div>
</div></body></html>`

const sleep = ms => new Promise(r => setTimeout(r, ms))
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9700 + Math.floor(Math.random() * 50)
const profile = join(tmpdir(), `tahseeb-brand-${Date.now()}`)
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' })
let version
for (let i = 0; i < 40 && !version; i++) { try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json() } catch { await sleep(250) } }
const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl)
await new Promise(ok => { ws.onopen = ok })
let seq = 0; const pending = new Map()
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const cdp = (method, params = {}) => new Promise(ok => { const id = ++seq; pending.set(id, ok); ws.send(JSON.stringify({ id, method, params })) })
await cdp('Page.enable')

const work = join(tmpdir(), `tahseeb-brand-src-${Date.now()}`); mkdirSync(work, { recursive: true })
async function render(name, html, w, h) {
  const file = join(work, name + '.html'); writeFileSync(file, html)
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await cdp('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
  await cdp('Page.navigate', { url: pathToFileURL(file).href }); await sleep(900)
  const r = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } })
  const buf = Buffer.from(r.result.data, 'base64'); writeFileSync(join(OUT, name), buf); return buf
}
const page = svg => `<!doctype html><html><head><style>html,body{margin:0;overflow:hidden;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`

const made = {}
// المتصفح وشاشة الآيفون والأندرويد
made.svg = iconSvg(512, 0.55); writeFileSync(join(OUT, `tahseeb-icon-${V}.svg`), made.svg)
for (const [name, size, ratio] of [[`favicon-16-${V}.png`, 16, 0.72], [`favicon-32-${V}.png`, 32, 0.66], [`favicon-48-${V}.png`, 48, 0.62],
  [`apple-touch-icon-180-${V}.png`, 180, 0.55], [`tahseeb-icon-192-${V}.png`, 192, 0.55], [`tahseeb-icon-512-${V}.png`, 512, 0.55],
  [`tahseeb-maskable-192-${V}.png`, 192, 0.46], [`tahseeb-maskable-512-${V}.png`, 512, 0.46]]) {
  made[name] = await render(name, page(iconSvg(size, ratio)), size, size)
}
made.share = await render(`tahseeb-share-${V}.png`, SHARE, 1200, 630)

// favicon.ico من 16 و32 و48 (PNG داخل ICO)
const icoParts = [16, 32, 48].map(s => ({ s, data: readFileSync(join(OUT, `favicon-${s}-${V}.png`)) }))
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoParts.length, 4)
let offset = 6 + 16 * icoParts.length
const dir = icoParts.map(({ s, data }) => { const e = Buffer.alloc(16); e.writeUInt8(s, 0); e.writeUInt8(s, 1); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12); offset += data.length; return e })
writeFileSync(join(OUT, `favicon-${V}.ico`), Buffer.concat([header, ...dir, ...icoParts.map(p => p.data)]))

ws.close(); edge.kill(); await sleep(400)
try { rmSync(profile, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }) } catch {}
console.log('written', Object.keys(made).length + 1, 'files to public/branding')
