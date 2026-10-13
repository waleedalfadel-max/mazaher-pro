-- إغلاق فحص الرموز المباشر من المتصفح. بعد 20261001000000، ولا يُطبَّق إلا بعد نشر الواجهة الجديدة (تدخل عبر /api/pin-login)
-- والتحقق من دخولها: الواجهة القديمة تستدعي login_with_pin من المتصفح، فيتوقف دخولها بهذا الملف.
-- الدالة نفسها لا تتغير؛ يُسحب تنفيذها من أدوار العميل فقط، فلا يبقى طريق لفحص الرموز يتجاوز حد المحاولات.
-- الرجوع (بقرار المالك فقط، ويعيد التخمين بلا حد): grant execute on function public.login_with_pin(text, text) to public, anon, authenticated;

revoke all on function public.login_with_pin(text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
