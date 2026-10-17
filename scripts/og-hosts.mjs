// بعد البناء: og:url صحيح لكل نطاق في HTML الأولي، بلا تشغيل JavaScript ولا كود على الخادم.
// صفحة التطبيق واحدة لكل النطاقات؛ فتُنسخ لكل نطاق نسخة لا تختلف إلا في og:url (وtwitter:url)، ويختار Vercel النسخة بحسب النطاق
// (vercel.json rewrites بشرط host). قائمة النطاقات مصدرها واحد: قواعد vercel.json نفسها. النطاق غير المدرج يأخذ app.html العامة بلا og:url
// (فيأخذ تطبيق المشاركة الرابط المرسل نفسه). لا يبقى dist/index.html حتى يمر الجذر «/» أيضًا بقواعد النطاق.
//   vite build && node scripts/og-hosts.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const DIST = join(ROOT, process.argv[2] || 'dist')
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'))
export const hostRules = vercel.rewrites.filter(r => r.has?.[0]?.type === 'host')
const html = readFileSync(existsSync(join(DIST, 'index.html')) ? join(DIST, 'index.html') : join(DIST, 'app.html'), 'utf8')
const anchor = '<meta property="og:type" content="website" />'
if (!html.includes(anchor) || /property="og:url"/.test(html)) throw new Error('صفحة البناء غير متوقعة: وسم og:type مفقود أو og:url موجود مسبقًا')

// هوية نطاق منشأة بعينها (scripts/host-identity.json): العنوان والوصف واسم الحفظ على الشاشة، بشعار تحسيب نفسه وصوره.
// النطاق غير المدرج يبقى بالهوية العامة كما هو تمامًا. ملف التعريف (manifest) لكل نطاق مدرج في /manifests/<النطاق>.json.
const IDENTITY = JSON.parse(readFileSync(join(ROOT, 'scripts/host-identity.json'), 'utf8'))
const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
function setOnce(page, re, value, what) {
  const n = (page.match(new RegExp(re.source, 'g')) || []).length
  if (n !== 1) throw new Error(`صفحة البناء غير متوقعة: ${what} (${n})`)
  return page.replace(re, (m, a, b) => a + value + b)
}
export function brand(page, host, id) {
  const meta = (attr, key) => new RegExp(`(<meta ${attr}="${key.replace(/[.:]/g, '\\$&')}" content=")[^"]*(" \\/>)`)
  page = setOnce(page, /(<title>)[^<]*(<\/title>)/, esc(id.title), 'title')
  page = setOnce(page, meta('name', 'description'), esc(id.description), 'description')
  for (const k of ['og:title', 'og:description', 'og:image:alt']) page = setOnce(page, meta('property', k), esc(k === 'og:title' ? id.title : k === 'og:description' ? id.description : 'شعار تحسيب'), k)
  for (const k of ['twitter:title', 'twitter:description', 'twitter:image:alt']) page = setOnce(page, meta('name', k), esc(k === 'twitter:title' ? id.title : k === 'twitter:description' ? id.description : 'شعار تحسيب'), k)
  page = setOnce(page, meta('name', 'apple-mobile-web-app-title'), esc(id.name), 'apple-mobile-web-app-title')
  page = setOnce(page, /(<link rel="manifest" href=")[^"]*(" \/>)/, `/manifests/${host}.json`, 'manifest')
  const EOL = page.includes('\r\n') ? '\r\n' : '\n'
  return page.replace('<meta name="apple-mobile-web-app-title"', `<meta name="application-name" content="${esc(id.name)}" />${EOL}    <meta name="apple-mobile-web-app-title"`)
}
const baseManifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'))
for (const host of Object.keys(IDENTITY)) if (!hostRules.some(r => r.has[0].value === host)) throw new Error('هوية لنطاق بلا قاعدة في vercel.json: ' + host)

mkdirSync(join(DIST, 'h'), { recursive: true })
for (const rule of hostRules) {
  const host = rule.has[0].value
  if (!/^[a-z0-9.-]+$/.test(host) || rule.destination !== `/h/${host}.html`) throw new Error('قاعدة نطاق غير متوقعة: ' + JSON.stringify(rule))
  const url = `https://${host}/`
  const EOL = html.includes('\r\n') ? '\r\n' : '\n'
  let page = html.replace(anchor, `${anchor}${EOL}    <meta property="og:url" content="${url}" />${EOL}    <meta name="twitter:url" content="${url}" />`)
  const id = IDENTITY[host]
  if (id) {
    page = brand(page, host, id)
    mkdirSync(join(DIST, 'manifests'), { recursive: true })
    writeFileSync(join(DIST, 'manifests', `${host}.json`), JSON.stringify({ ...baseManifest, name: id.name, short_name: id.name, description: id.description }, null, 2) + '\n')
  }
  writeFileSync(join(DIST, 'h', `${host}.html`), page)
}
writeFileSync(join(DIST, 'app.html'), html)
// لو بقي index.html لخدمه Vercel للجذر «/» قبل قواعد النطاق؛ محتواه نفسه في app.html
rmSync(join(DIST, 'index.html'), { force: true })
console.log(`og:url لـ ${hostRules.length} نطاقات + app.html عامة؛ هوية خاصة لـ ${Object.keys(IDENTITY).length}`)
