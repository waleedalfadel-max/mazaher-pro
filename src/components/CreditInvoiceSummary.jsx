import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Dialog, Money } from '../ui/components.jsx'

export default function CreditInvoiceSummary({ row, onEdit, onDelete }) {
  const [open, setOpen] = useState(false)
  if (!row._creditRows) return null
  const net = Math.round((row.total_amount - row.vat_amount) * 100) / 100
  return <div className="credit-invoice-summary" data-k="credit-invoice-summary">
    <strong>{row._creditPartial ? 'إجمالي الجزء المعروض' : 'إجمالي الفاتورة'}: <Money value={row.total_amount} /></strong>
    <small>آجل على المورد · دون خروج من البنك أو الصندوق</small>
    <Button size="sm" variant="quiet" onClick={() => setOpen(true)}>تفاصيل الفاتورة ({row._creditRows.length})</Button>
    <Dialog open={open} title={row._creditPartial ? 'تفاصيل الفاتورة المطابقة للفلتر' : 'تفاصيل فاتورة شراء آجلة'}
      description={`${row.journal_number} — ${row.description || ''}`} onClose={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>إغلاق</Button>}>
      <div data-k="credit-invoice-details">
        <p>{row._creditPartial ? 'هذه أجزاء الفاتورة المطابقة للفلتر فقط؛ أزل الفلتر لعرض إجماليها.' : 'فاتورة واحدة، موزعة على التصنيفات التالية. هذه التفاصيل ليست فواتير مكررة.'}</p>
        <dl className="ldg-del-facts"><div><dt>قبل الضريبة</dt><dd><Money value={net} /></dd></div><div><dt>الضريبة</dt><dd><Money value={row.vat_amount} /></dd></div><div><dt>الإجمالي على المورد</dt><dd><Money value={row.payable_in} /></dd></div></dl>
        <p>أُضيف الإجمالي إلى مستحق المورد، وصافي البنود إلى تكاليفها حسب التصنيف. لا تسجّل هذه الفاتورة خروجًا نقديًا؛ السداد عملية مستقلة.</p>
        <Link to="/suppliers">عرض مستحقات الموردين</Link>
        <div className="credit-invoice-lines">{row._creditRows.map(r => <section key={r.id} className="credit-invoice-line">
          <strong>{r.category_main || r.type}{r.category_sub && <small> · {r.category_sub}</small>}</strong>
          <small>{r.type}</small>
          <dl><div><dt>قبل الضريبة</dt><dd><Money value={Math.round((Number(r.total_amount) - Number(r.vat_amount || 0))*100)/100} /></dd></div><div><dt>الضريبة الموزعة</dt><dd><Money value={Number(r.vat_amount || 0)} /></dd></div><div><dt>الإجمالي</dt><dd><Money value={Number(r.total_amount)} /></dd></div></dl>
          {(onEdit || onDelete) && <div className="credit-invoice-actions">{onEdit && <Button size="sm" onClick={() => { setOpen(false); onEdit(r) }}>تعديل الجزء</Button>}{onDelete && <Button size="sm" onClick={() => { setOpen(false); onDelete(r) }}>حذف الجزء</Button>}</div>}
        </section>)}</div>
        <p className="ts-field-hint">الضريبة المعروضة لكل تصنيف هي التوزيع المحفوظ في النظام؛ مرجع إجمالي الضريبة هو الفاتورة.</p>
      </div>
    </Dialog>
  </div>
}
