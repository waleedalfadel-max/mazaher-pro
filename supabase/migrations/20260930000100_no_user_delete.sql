-- لا حذف نهائي لحسابات المستخدمين من طلبات التطبيق. بعد 20260930000000 (تعطيل الموظف).
--
-- القواعد:
--   • الإجراءان المتاحان لإيقاف موظف: التعطيل وإعادة التفعيل (team_set_active، للمالك من الإعدادات). الحساب يبقى، وتبقى
--     القيود والمستندات والمبيعات مرتبطة به (created_by_user_id) وسجل التعطيل.
--   • المنع على مستويين: سحب صلاحية DELETE على app_users من دوري الواجهة (anon وauthenticated)، ومشغّل يرفض الحذف منهما
--     لأي دور في التطبيق، ومنه مزوّد الخدمة، لو أُعيدت الصلاحية يومًا.
--   • لا يمس الحذف بمفتاح الخدمة أو من لوحة التحكم (صيانة يدوية مقصودة)، ولا حذف المنشأة نفسها (ON DELETE CASCADE).

revoke delete on public.app_users from anon, authenticated;

-- المشغّل كما في 20260930000000، والفرق فرع الحذف وحده: رفض لكل أدوار التطبيق
create or replace function approval_private.app_users_client_guard() returns trigger language plpgsql set search_path = '' as $$
declare sa boolean;
begin
  if current_user not in ('authenticated', 'anon') then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    raise exception 'user_delete_forbidden' using errcode = '42501';
  end if;
  sa := public.auth_is_superadmin();
  if tg_op = 'INSERT' then
    if new.is_active is distinct from true or new.deactivated_at is not null or new.deactivated_by is not null then
      raise exception 'use_team_set_active' using errcode = '42501';
    end if;
    if not sa and (new.role in ('owner', 'superadmin') or new.auth_id is not null) then
      raise exception 'user_change_forbidden' using errcode = '42501';
    end if;
    return new;
  else
    if new.is_active is distinct from old.is_active or new.deactivated_at is distinct from old.deactivated_at
       or new.deactivated_by is distinct from old.deactivated_by then
      raise exception 'use_team_set_active' using errcode = '42501';
    end if;
    if not sa and (old.role in ('owner', 'superadmin') or new.role is distinct from old.role
                   or new.project_id is distinct from old.project_id or new.auth_id is distinct from old.auth_id) then
      raise exception 'user_change_forbidden' using errcode = '42501';
    end if;
    return new;
  end if;
end $$;
