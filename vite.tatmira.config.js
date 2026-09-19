import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import baseTailwind from './tailwind.config.js'

// نموذج «معمل تتميرا» التجريبي — مدخل مستقل عن تطبيق تحسيب.
// لا يقرأ متغيرات VITE_* (envPrefix مختلف ومجلد env منفصل)، ولا ينسخ public/
// (لا sw.js ولا manifest)، ولا يغيّر بناء التطبيق الأساسي (vite.config.js).
const root = fileURLToPath(new URL('./tatmira-demo', import.meta.url))

export default defineConfig({
  root,
  envDir: root,
  envPrefix: 'TATMIRA_DEMO_',
  publicDir: false,
  base: './',
  plugins: [react()],
  css: {
    postcss: {
      plugins: [
        tailwindcss({ ...baseTailwind, content: [`${root}/index.html`, `${root}/src/**/*.{js,jsx}`] }),
        autoprefixer(),
      ],
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist-tatmira', import.meta.url)),
    emptyOutDir: true,
  },
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true },
})
