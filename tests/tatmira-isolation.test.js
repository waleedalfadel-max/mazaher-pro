import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// نموذج تتميرا يجب ألا يتصل بالإنتاج: لا Supabase ولا /api ولا مفاتيح، ولا يستورد شيئاً من تطبيق تحسيب
// غير ملف التنسيق وشعار العرض.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const demo = join(root, 'tatmira-demo')

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const sources = walk(demo).filter(p => /\.(jsx?|html|css)$/.test(p))
const FORBIDDEN = [
  /supabase/i, /\/api\//, /fetch\s*\(/, /XMLHttpRequest/, /navigator\.sendBeacon/, /WebSocket/,
  /import\.meta\.env/, /process\.env/, /tahseeb\.app/, /VITE_/, /anthropic/i, /serviceWorker/,
]
const ALLOWED_OUTSIDE = new Set(['src/index.css', 'public/شعار تحسيب الجديد.png'])

test('مصادر النموذج لا تحتوي أي اتصال بخادم أو إعدادات إنتاج', () => {
  assert.ok(sources.length > 5)
  for (const file of sources) {
    const text = readFileSync(file, 'utf8')
    for (const re of FORBIDDEN) assert.doesNotMatch(text, re, `${relative(root, file)} يطابق ${re}`)
  }
})

test('النموذج لا يستورد من تطبيق تحسيب إلا ملف التنسيق والشعار', () => {
  for (const file of sources.filter(p => /\.jsx?$/.test(p))) {
    const text = readFileSync(file, 'utf8')
    for (const [, spec] of text.matchAll(/(?:import|from)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      if (!spec.startsWith('.')) {
        assert.ok(['react', 'react-dom/client', 'react-router-dom', 'jspdf', 'html2canvas'].includes(spec), `${relative(root, file)}: حزمة غير متوقعة ${spec}`)
        continue
      }
      const target = relative(root, resolve(dirname(file), spec)).replace(/\\/g, '/')
      if (target.startsWith('tatmira-demo/')) continue
      assert.ok(ALLOWED_OUTSIDE.has(target), `${relative(root, file)} يستورد ${target}`)
    }
  }
})

test('بناء التطبيق الأساسي لا يتغير: vite.config.js والمدخل الرئيسي لا يشيران للنموذج', () => {
  assert.doesNotMatch(readFileSync(join(root, 'vite.config.js'), 'utf8'), /tatmira/)
  assert.doesNotMatch(readFileSync(join(root, 'index.html'), 'utf8'), /tatmira/)
  assert.doesNotMatch(readFileSync(join(root, 'src/App.jsx'), 'utf8'), /tatmira/)
})

test('مخرجات بناء النموذج (إن وُجدت) خالية من عناوين الإنتاج والمفاتيح', { skip: !existsSync(join(root, 'dist-tatmira')) }, () => {
  const out = walk(join(root, 'dist-tatmira')).filter(p => /\.(js|html|css)$/.test(p))
  assert.ok(out.length > 0)
  for (const file of out) {
    const text = readFileSync(file, 'utf8')
    for (const re of [/supabase\.co/i, /\/api\/(analyze|chat|pin-session)/, /tahseeb\.app/, /sk-ant-/, /eyJhbGci/, /sw\.js/]) {
      assert.doesNotMatch(text, re, `${relative(root, file)} يطابق ${re}`)
    }
  }
  assert.equal(existsSync(join(root, 'dist-tatmira', 'sw.js')), false)
  assert.equal(existsSync(join(root, 'dist-tatmira', 'manifest.json')), false)
})
