-- رجوع 20261023120000 (الواجهة أولًا). يُزيل دوال المطابقة الثلاث؛ ويُبقي جدول السجلات وما فيه (لا تُحذف بيانات المطابقة).
-- يُنفَّذ في معاملة واحدة (psql -1). لا قيود مالية تتأثر: الجدول لا يرتبط بالدفتر.
drop function if exists public.app_statement_checkpoint_void(uuid, text);
drop function if exists public.app_statement_checkpoint_save(text, date, numeric, text, text);
drop function if exists public.app_statement_checkpoints(text);
