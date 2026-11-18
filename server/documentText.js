import { createRequire } from 'node:module'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorker, OEM } from 'tesseract.js'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const require = createRequire(import.meta.url)
const models = {
  ara: require.resolve('@tesseract.js-data/ara/4.0.0_best_int/ara.traineddata.gz'),
  eng: require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
}

export function storagePath(job, origin) {
  const url = new URL(job.source_url)
  const prefix = '/storage/v1/object/public/documents/'
  if (url.origin !== new URL(origin).origin || !url.pathname.startsWith(prefix)) throw Error('Invalid storage source')
  const path = decodeURIComponent(url.pathname.slice(prefix.length))
  if (!path.startsWith(job.project_id + '/') || path.split('/').some(p => !p || p === '..' || p === '.')) throw Error('Invalid document path')
  return path
}

// Use packaged models and a worker local to this invocation. Originals never go to an OCR vendor.
export function originalTextReader() {
  let worker, directory
  async function recognize(bytes) {
    if (!worker) {
      directory = await mkdtemp(join(tmpdir(), 'tahseeb-ocr-'))
      await Promise.all(Object.entries(models).map(([lang, src]) => copyFile(src, join(directory, lang + '.traineddata.gz'))))
      worker = await createWorker('ara+eng', OEM.LSTM_ONLY, {
        workerPath: require.resolve('tesseract.js/src/worker-script/node/index.js'),
        langPath: directory, cacheMethod: 'none', errorHandler: () => {},
      })
    }
    return (await worker.recognize(bytes)).data.text.trim()
  }
  return {
    async read(bytes, mime, start = 1) {
      if (mime !== 'application/pdf' && !bytes.subarray(0, 1024).includes('%PDF-')) {
        const picture = await loadImage(bytes)
        const scale = Math.min(2, 2800 / Math.max(picture.width, picture.height))
        const canvas = createCanvas(Math.max(1, Math.round(picture.width * scale)), Math.max(1, Math.round(picture.height * scale)))
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(picture, 0, 0, canvas.width, canvas.height)
        return { text: await recognize(canvas.toBuffer('image/png')), next: null }
      }
      const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const pdf = await getDocument({ data: Uint8Array.from(bytes), isEvalSupported: false, useSystemFonts: true,
        cMapUrl: require.resolve('pdfjs-dist/cmaps/Adobe-Japan1-UCS2.bcmap').replace(/[^/]+$/, ''),
        cMapPacked: true, standardFontDataUrl: require.resolve('pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf').replace(/[^/]+$/, ''),
      }).promise
      const lines = []
      try {
        const last = Math.min(pdf.numPages, start + 2)
        for (let n = start; n <= last; n++) {
          const page = await pdf.getPage(n)
          const content = await page.getTextContent()
          const embedded = content.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join('').trim()
          if (embedded) lines.push(embedded)
          const ops = await page.getOperatorList()
          if (!embedded || ops.fnArray.some(op => op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject || op === OPS.paintImageMaskXObject)) {
            const size = page.getViewport({ scale: 1 })
            const viewport = page.getViewport({ scale: Math.min(3, 2600 / Math.max(size.width, size.height)) })
            const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)))
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
            const scanned = await recognize(canvas.toBuffer('image/png'))
            if (scanned) lines.push(scanned)
          }
          page.cleanup()
        }
        return { text: lines.join('\n'), next: last < pdf.numPages ? last + 1 : null }
      } finally { await pdf.destroy() }
    },
    async close() {
      try { if (worker) await worker.terminate() }
      finally { if (directory) await rm(directory, { recursive: true, force: true }) }
    },
  }
}
