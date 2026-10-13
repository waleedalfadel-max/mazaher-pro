-- تثبيت مسار البحث فقط؛ لا تغيير لنص الاستعلام أو الصلاحيات أو البيانات.
-- تبقى الدالة SECURITY INVOKER وتطبق سياسات قراءة جداولها على المستخدم نفسه.
-- وجود pg_temp أخيرًا يمنع تقدّمه الضمني على جداول public.
alter function public.get_purchase_entries(uuid, date, date)
  set search_path = pg_catalog, public, pg_temp;
