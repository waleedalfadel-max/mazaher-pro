-- رجوع 20261025120000 (الواجهة أولًا). يزيل الدالتين؛ ويُبقي جدول القراءات السابقة وما فيه (لا تُحذف القراءات المحفوظة).
-- يُنفَّذ في معاملة واحدة (psql -1). لا قيود مالية تتأثر.
drop function if exists public.document_readings(uuid);
drop function if exists public.document_reread_save(uuid, integer, jsonb);
