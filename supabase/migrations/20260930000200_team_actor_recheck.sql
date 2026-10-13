-- إدارة الفريق: صلاحية المنفّذ تُقرأ من جديد بعد انتظار أقفال المنشأة، قبل أي كتابة. بعد 20260930000100.
--
-- الحالة: طلب مالكٍ ينتظر أقفالًا يحملها مالك آخر يعطّله. بعد إثبات التعطيل كان الطلب المنتظر يكمل بصلاحية قُرئت قبل
-- الانتظار (مثبت في local-test/team-concurrency.mjs قبل هذه الهجرة). الآن: بعد الحصول على الأقفال يُقرأ صف المنفّذ نفسه
-- (مقفل ضمنها، فهو أحدث نسخة مثبتة) ويُشترط أن يبقى مرتبطًا بهوية الجلسة، ونشطًا، ومالكًا، وفي المنشأة نفسها.
-- التعريف كما في 20260930000000، والفرق فقرة «إعادة التحقق» وحدها.

create or replace function public.team_set_active(p_user_id uuid, p_active boolean, p_reason text default null, p_acknowledge text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; me record; t record; n int; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role is distinct from 'owner' or a.project_id is null then return approval_private.err('forbidden'); end if;
  if p_active is null or p_user_id is null then return approval_private.err('invalid'); end if;
  if length(v_reason) > 200 then return approval_private.err('reason_too_long'); end if;

  -- تغييرات الفريق في المنشأة الواحدة واحدًا بعد الآخر (شرطا آخر مالك وآخر محاسب لا يتسابقان)
  perform 1 from public.app_users where project_id = a.project_id order by id for update;

  -- إعادة التحقق بعد الانتظار: قد يكون المنفّذ عُطّل أو تغيّر دوره أو منشأته أو ربطه بينما ينتظر
  select u.id, u.auth_id, u.role, u.project_id, u.is_active into me from public.app_users u where u.id = a.id;
  if not found or me.auth_id is distinct from auth.uid() or not me.is_active then return approval_private.err('no_session'); end if;
  if me.role is distinct from 'owner' or me.project_id is distinct from a.project_id then return approval_private.err('forbidden'); end if;

  select * into t from public.app_users where id = p_user_id;
  -- حساب منشأة أخرى أو المشرف العام: كأنه غير موجود (لا يُكشف وجوده)
  if not found or t.project_id is distinct from a.project_id or t.role = 'superadmin' then return approval_private.err('not_found'); end if;
  if t.id = a.id then return approval_private.err('self'); end if;
  if t.is_active = p_active then
    return jsonb_build_object('ok', true, 'changed', false, 'is_active', t.is_active);
  end if;

  if not p_active then
    if t.role = 'owner' then
      select count(*) into n from public.app_users where project_id = a.project_id and role = 'owner' and is_active and id <> t.id;
      if n = 0 then return approval_private.err('last_owner'); end if;
    end if;
    if t.role = 'accountant' and p_acknowledge is distinct from 'last_accountant' then
      select count(*) into n from public.app_users where project_id = a.project_id and role = 'accountant' and is_active and id <> t.id;
      if n = 0 then return approval_private.err('last_accountant'); end if;
    end if;
    update public.app_users set is_active = false, deactivated_at = now(), deactivated_by = a.id where id = t.id;
  else
    update public.app_users set is_active = true, deactivated_at = null, deactivated_by = null where id = t.id;
  end if;

  insert into approval_private.user_status_changes (project_id, user_id, user_name, user_role, action, reason,
    actor_id, actor_name, actor_role, acting_as_role)
  values (a.project_id, t.id, t.name, t.role, case when p_active then 'reactivate' else 'deactivate' end, v_reason,
    a.id, a.name, a.role, nullif(current_setting('app.acting_as', true), ''));

  return jsonb_build_object('ok', true, 'changed', true, 'is_active', p_active);
end $$;
