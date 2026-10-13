-- الدالة القائمة next_journal_number (يستعملها الإدخال السريع والمطابقات والدفتر والموردون والمسار السابق للاعتماد)
-- كانت تحسب آخر رقم بفرز نصي ثم +1 بلا قفل: بعد 999 تعيد 1000 مرة بعد مرة، وطلبان متزامنان يأخذان الرقم نفسه.
-- تصير تحجز الرقم من العدّاد نفسه الذي يستعمله الاعتماد الجديد (قفل صف لكل منشأة وسنة). التوقيع والصلاحيات كما هي.
-- الرقم المحجوز لا يُعاد وإن لم يُستعمل (فجوة ممكنة بدل تكرار).
-- search_path = public كما في الدالة الأصلية: auth_is_superadmin وauth_project_id تعتمدان عليه حتى يُصلح
-- بند search_path الأمني المفتوح لهما.
create or replace function public.next_journal_number(p_project_id uuid, p_date date) returns text
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.auth_is_superadmin() then
    if p_project_id is null or public.auth_project_id() is null or p_project_id <> public.auth_project_id() then
      raise exception 'forbidden: project mismatch';
    end if;
  end if;
  return approval_private.next_journal(p_project_id, p_date);
end $$;
