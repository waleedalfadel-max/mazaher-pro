import { fmt } from './money.js'

// يحوّل الرقم إلى صيغة دولية بلا "+" كما يطلبها wa.me.
// يقبل: 05xxxxxxxx أو 5xxxxxxxx أو 9665xxxxxxxx أو +9665xxxxxxxx أو 009665xxxxxxxx.
// يعيد '' للفارغ، وnull للرقم غير الصالح.
export function normalizeWhatsapp(raw) {
  const digits = String(raw ?? '')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[^\d+]/g, '')
  if (!digits) return ''
  let n = digits.replace(/^\+/, '').replace(/^00/, '')
  if (/^05\d{8}$/.test(n)) n = '966' + n.slice(1)
  else if (/^5\d{8}$/.test(n)) n = '966' + n
  if (/^9665\d{8}$/.test(n)) return n
  // أرقام دولية أخرى: 8 إلى 15 رقماً ولا تبدأ بصفر
  if (/^[1-9]\d{7,14}$/.test(n) && !n.startsWith('966')) return n
  return null
}

export function displayWhatsapp(n) {
  if (!n) return ''
  if (/^9665\d{8}$/.test(n)) return `+966 ${n.slice(3, 5)} ${n.slice(5, 8)} ${n.slice(8)}`
  return `+${n}`
}

export function invoiceMessage({ labName, customerName, invoice }) {
  return [
    `السلام عليكم ${customerName}،`,
    `مرفق لكم تفاصيل فاتورة ${labName}:`,
    `رقم الفاتورة: ${invoice.number}`,
    `التاريخ: ${invoice.date}`,
    `الإجمالي: ${fmt(invoice.total)} ر.س`,
    '',
    'نموذج تجريبي — ليس فاتورة ضريبية',
  ].join('\n')
}

export function whatsappUrl(number, text) {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`
}
