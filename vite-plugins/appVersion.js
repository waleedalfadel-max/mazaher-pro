// رقم إصدار الواجهة: يُكتب في الصفحة نفسها (<meta name="app-version">) وفي /version.json عند البناء.
// الصفحة المفتوحة تقارن رقمها بـ /version.json (src/lib/appVersion.js): اختلافهما يعني نشر إصدار أحدث.
// الرقم: إيداع Vercel إن وُجد، وإلا إيداع git المحلي، وإلا وقت البناء.
// overrideFile (بيئة الاختبار المحلية وحدها): ملف نصي يحاكي «نُشر إصدار جديد» دون إعادة تشغيل خادم التطوير:
//   محتواه رقم إصدار ← تقدّمه الصفحات الجديدة و/version.json؛ «FAIL» ← /version.json يرد 503 (تعذّر الفحص).
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

function baseVersion() {
  const vercel = (process.env.VERCEL_GIT_COMMIT_SHA || '').trim()
  if (vercel) return vercel.slice(0, 12)
  try { return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch {}
  return `t${Date.now()}`
}

export function appVersion({ overrideFile } = {}) {
  const base = baseVersion()
  const override = () => {
    if (!overrideFile || !existsSync(overrideFile)) return null
    const v = readFileSync(overrideFile, 'utf8').trim()
    return v || null
  }
  const current = () => { const v = override(); return v && v !== 'FAIL' ? v : base }
  return {
    name: 'app-version',
    transformIndexHtml(html) {
      return html.replace('</head>', `    <meta name="app-version" content="${current()}" />\n  </head>`)
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/version.json')) return next()
        res.setHeader('cache-control', 'no-store')
        if (override() === 'FAIL') { res.statusCode = 503; return res.end('unavailable') }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ version: current() }))
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: base }) })
    },
  }
}
