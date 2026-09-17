// تحويل عنصر معروض إلى PDF محلياً — نفس نهج صفحة التقارير في تحسيب (html2canvas + jsPDF).
// لا رفع ولا روابط عامة: الملف يُنزَّل مباشرة على الجهاز.

export async function elementToPdfBlob(el) {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')])
  const canvas = await html2canvas(el, { scale: 2, logging: false, backgroundColor: '#ffffff' })
  const imgData = canvas.toDataURL('image/png')
  const pdf = new jsPDF('p', 'mm', 'a4')
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const imgH = (canvas.height * pageW) / canvas.width
  let yOffset = 0
  let remaining = imgH
  while (remaining > 0) {
    pdf.addImage(imgData, 'PNG', 0, -yOffset, pageW, imgH)
    remaining -= pageH
    yOffset += pageH
    if (remaining > 0) pdf.addPage()
  }
  return pdf.output('blob')
}

export function safeFileName(s) {
  return String(s).replace(/[\\/:*?"<>|]+/g, '-').trim()
}
