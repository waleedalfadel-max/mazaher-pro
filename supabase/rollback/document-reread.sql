-- رجوع 20261025120000 (الواجهة أولًا). يزيل الدالتين؛ ويُبقي جدول القراءات السابقة وما فيه (لا تُحذف القراءات المحفوظة).
-- يُنفَّذ في معاملة واحدة (psql -1). لا قيود مالية تتأثر.
drop function if exists public.document_readings(uuid);
drop function if exists public.document_reread_save(uuid, integer, jsonb);

-- Keep reject_replaced_invoice + its trigger with the archived ids: old screens must
-- not resurrect superseded invoices after rollback. No existing financial row changes.
drop function if exists approval_private.reread_evidence(jsonb);
