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

mkdirSync(join(DIST, 'h'), { recursive: true })
for (const rule of hostRules) {
  const host = rule.has[0].value
  if (!/^[a-z0-9.-]+$/.test(host) || rule.destination !== `/h/${host}.html`) throw new Error('قاعدة نطاق غير متوقعة: ' + JSON.stringify(rule))
  const url = `https://${host}/`
  const EOL = html.includes('\r\n') ? '\r\n' : '\n'
  writeFileSync(join(DIST, 'h', `${host}.html`), html.replace(anchor, `${anchor}${EOL}    <meta property="og:url" content="${url}" />${EOL}    <meta name="twitter:url" content="${url}" />`))
}
writeFileSync(join(DIST, 'app.html'), html)
// لو بقي index.html لخدمه Vercel للجذر «/» قبل قواعد النطاق؛ محتواه نفسه في app.html
rmSync(join(DIST, 'index.html'), { force: true })
console.log(`og:url لـ ${hostRules.length} نطاقات + app.html عامة`)
