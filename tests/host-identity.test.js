// هوية نطاق المنشأة بعد البناء (scripts/og-hosts.mjs + scripts/host-identity.json): في HTML الأولي بلا JavaScript.
// النطاق المدرج يأخذ عنوانه ووصفه واسم الحفظ وملف تعريفه بشعار تحسيب نفسه؛ وبقية النطاقات كما كانت تمامًا (لا يختلف إلا og:url).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, copyFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const IDENTITY = JSON.parse(readFileSync(join(ROOT, 'scripts/host-identity.json'), 'utf8'))

function build() {
  const dist = mkdtempSync(join(ROOT, '.og-test-'))
  copyFileSync(join(ROOT, 'index.html'), join(dist, 'index.html'))
  copyFileSync(join(ROOT, 'public/manifest.json'), join(dist, 'manifest.json'))
  execFileSync(process.execPath, [join(ROOT, 'scripts/og-hosts.mjs'), relative(ROOT, dist)], { cwd: ROOT, stdio: 'ignore' })
  return dist
}
const head = (html, re) => (html.match(re) || [])[1]

test('نطاق تشورميك: العنوان والوصف ومعاينة المشاركة واسم الحفظ وملف التعريف بشعار تحسيب', () => {
  const dist = build()
  try {
    const host = 'tashormik.tahseeb.app', id = IDENTITY[host]
    assert.equal(id.title, 'تشورميك | تحسيب')
    const page = readFileSync(join(dist, 'h', `${host}.html`), 'utf8')
    assert.equal(head(page, /<title>([^<]*)<\/title>/), id.title)
    for (const [attr, key, want] of [['name', 'description', id.description], ['property', 'og:title', id.title], ['property', 'og:description', id.description],
      ['name', 'twitter:title', id.title], ['name', 'twitter:description', id.description], ['name', 'apple-mobile-web-app-title', id.name], ['name', 'application-name', id.name],
      ['property', 'og:url', `https://${host}/`], ['property', 'og:image', 'https://www.tahseeb.app/branding/tahseeb-share-r1.png']])
      assert.equal(head(page, new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`)), want, key)
    assert.match(page, /<link rel="icon" type="image\/svg\+xml" href="\/branding\/tahseeb-icon-r1\.svg" \/>/)
    assert.match(page, /<link rel="apple-touch-icon" sizes="180x180" href="\/branding\/apple-touch-icon-180-r1\.png" \/>/)
    assert.equal(head(page, /<link rel="manifest" href="([^"]*)"/), `/manifests/${host}.json`)
    const m = JSON.parse(readFileSync(join(dist, 'manifests', `${host}.json`), 'utf8')), base = JSON.parse(readFileSync(join(ROOT, 'public/manifest.json'), 'utf8'))
    assert.deepEqual(m, { ...base, name: id.name, short_name: id.name, description: id.description })
  } finally { rmSync(dist, { recursive: true, force: true }) }
})

test('بقية النطاقات والصفحة العامة بلا تغيير: الصفحة العامة نفسها مع og:url وحده، ولا ملف تعريف خاص', () => {
  const dist = build()
  try {
    const general = readFileSync(join(dist, 'app.html'), 'utf8')
    assert.equal(general, readFileSync(join(ROOT, 'index.html'), 'utf8'))
    const rules = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')).rewrites.filter(r => r.has?.[0]?.type === 'host').map(r => r.has[0].value)
    for (const host of rules.filter(h => !IDENTITY[h])) {
      const page = readFileSync(join(dist, 'h', `${host}.html`), 'utf8')
      const stripped = page.replace(/\r?\n\s*<meta property="og:url" content="[^"]*" \/>/, '').replace(/\r?\n\s*<meta name="twitter:url" content="[^"]*" \/>/, '')
      assert.equal(stripped, general, host)
      assert.equal(existsSync(join(dist, 'manifests', `${host}.json`)), false, host)
    }
  } finally { rmSync(dist, { recursive: true, force: true }) }
})
