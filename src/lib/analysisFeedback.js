// رسائل آمنة للمستخدم بعد حفظ المستند؛ لا نعرض أخطاء المزوّد أو نص الفاتورة.
export function savedDocumentWarning(error) {
  const reason = error?.isAuthError
    ? error.message
    : 'تعذّر إكمال التحليل التلقائي.'
  return `حُفظ المستند للمراجعة — ${reason} لا حاجة لرفعه مرة أخرى.`
}
