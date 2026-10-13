-- انتقال فهرس منع تكرار القيود.
-- الفهرس القديم (project_id, date, total_amount, type, description) يرفض فواتير صحيحة (مورد واحد، يوم ومبلغ واحد)،
-- ولا يحمي الاعتماد من الكتابة الجزئية. قيود المسار الجديد (document_invoice_id غير فارغ) يحميها سجل الفواتير
-- وقفل المستند وفحص الاشتباه، فلا يطبَّق عليها. يبقى الفهرس لقيود المسار السابق وحدها حتى تنتقل كل المنشآت،
-- ثم يُحذف (خطوة لاحقة منفصلة في خطة الترحيل). لا تعديل لأي صف قائم.
--
-- في الإنتاج: يُنشأ الفهرس الجديد بـ CREATE UNIQUE INDEX CONCURRENTLY خارج معاملة، ثم يُحذف القديم
-- (انظر خطة الترحيل). هنا (محليًا، داخل معاملة الهجرة) بلا CONCURRENTLY.
create unique index if not exists ledger_unique_invoice_legacy_path on public.ledger_entries
  (project_id, date, total_amount, type, description)
  where status <> 'cancelled' and document_invoice_id is null;
drop index if exists public.ledger_unique_invoice;
