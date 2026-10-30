// بناء PDF صفحات الفاتورة وعدّ صفحات PDF (pdf-lib)؛ منفصل ليُحمَّل عند الحاجة فقط.
import { PDFDocument } from 'pdf-lib'
import { pagesProblem } from './invoicePages.js'

/**
 * يبني PDF من صور الصفحات بالترتيب: كل صفحة بمقاس صورتها (نقطة لكل بكسل)، والصورة مرسومة كاملة من الزاوية إلى الزاوية.
 * pages: [{ bytes: Uint8Array|ArrayBuffer, type: 'image/jpeg'|'image/png' }]
 */
export async function buildPagesPdf(pages) {
  const problem = pagesProblem(pages)
  if (problem) throw new Error(problem)
  const pdf = await PDFDocument.create()
  for (const page of pages) {
    const image = page.type === 'image/png' ? await pdf.embedPng(page.bytes) : await pdf.embedJpg(page.bytes)
    const sheet = pdf.addPage([image.width, image.height])
    sheet.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
  }
  pdf.setTitle(`فاتورة من ${pages.length} صفحات`)
  return pdf.save()
}

/** عدد صفحات ملف PDF (للعرض في المراجعة). */
export async function pdfPageCount(bytes) {
  return (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount()
}

