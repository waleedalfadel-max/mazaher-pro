-- Payment source suggested per uploading user (Tashormik request 2026-11-03): bank_workflow.uploader_users = { <app_user_id>: { source, account_id } }.
-- A user rule takes precedence over the role rule (bank_workflow.uploaders) when the review screen suggests a source; the accountant still
-- confirms or changes it before approval, and approval itself is unchanged (the reviewed payload carries the chosen source).
-- This replaces only admin_bank_workflow_save so the platform admin can save the new key. Each user must be an active owner, purchasing
-- or cashier user of the same business; a bank source needs an active account of that business; the cash source takes no account.
-- Rollback: supabase/rollback/uploader-user-payment.sql (exact live definition).

CREATE OR REPLACE FUNCTION public.admin_bank_workflow_save(p_workflow jsonb, p_expected jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a record; ps jsonb; r record; v_id uuid; v_target uuid; v_channels jsonb;
begin
 select * into a from approval_private.actor();
 if a.id is null then return approval_private.err('no_session'); end if;
 if a.role <> 'superadmin' or a.project_id is null then return approval_private.err('forbidden'); end if;
 perform 1 from public.projects where id=a.project_id for update;
 select settings into ps from public.project_settings where project_id=a.project_id for update;
 if not found then return approval_private.err('not_found'); end if;
 if coalesce(ps->'bank_workflow','null') is distinct from coalesce(p_expected,'null') then return approval_private.err('stale'); end if;
 if jsonb_typeof(p_workflow) is distinct from 'object' or p_workflow->'version' is distinct from '1'::jsonb
  or exists(select 1 from jsonb_object_keys(p_workflow) k where k not in ('version','uploaders','uploader_users','network_by_branch','transfer_by_branch','apps_collection_account','accounts'))
  or jsonb_typeof(p_workflow->'uploaders') is distinct from 'object'
  or jsonb_typeof(p_workflow->'network_by_branch') is distinct from 'object'
  or (p_workflow ? 'transfer_by_branch' and jsonb_typeof(p_workflow->'transfer_by_branch') is distinct from 'object')
  or (p_workflow ? 'uploader_users' and jsonb_typeof(p_workflow->'uploader_users') is distinct from 'object')
  or jsonb_typeof(p_workflow->'accounts') is distinct from 'object' then return approval_private.err('invalid'); end if;
 for r in select * from jsonb_each(p_workflow->'uploaders') loop
  if r.key not in ('owner','purchasing','cashier') or jsonb_typeof(r.value) <> 'object'
   or coalesce(r.value->>'source','') not in ('bank','cash')
   or exists(select 1 from jsonb_object_keys(r.value) k where k not in ('source','account_id')) then return approval_private.err('invalid'); end if;
  if r.value->>'source'='bank' then
   v_id:=nullif(r.value->>'account_id','')::uuid;
   if not exists(select 1 from public.bank_accounts where id=v_id and project_id=a.project_id and is_active) then return approval_private.err('invalid'); end if;
  elsif nullif(r.value->>'account_id','') is not null then return approval_private.err('invalid'); end if;
 end loop;
 -- مصدر مقترح لمستخدم بعينه (20261103120000): يسبق قاعدة الدور. المفتاح معرّف مستخدم نشط في المنشأة نفسها بدور يرفع المستندات
 for r in select * from jsonb_each(coalesce(p_workflow->'uploader_users','{}')) loop
  if not exists(select 1 from public.app_users u where u.id=r.key::uuid and u.project_id=a.project_id and u.is_active and u.role in ('owner','purchasing','cashier'))
   or jsonb_typeof(r.value) <> 'object' or coalesce(r.value->>'source','') not in ('bank','cash')
   or exists(select 1 from jsonb_object_keys(r.value) k where k not in ('source','account_id')) then return approval_private.err('invalid'); end if;
  if r.value->>'source'='bank' then
   v_id:=nullif(r.value->>'account_id','')::uuid;
   if not exists(select 1 from public.bank_accounts where id=v_id and project_id=a.project_id and is_active) then return approval_private.err('invalid'); end if;
  elsif nullif(r.value->>'account_id','') is not null then return approval_private.err('invalid'); end if;
 end loop;
 for v_channels in select value from jsonb_each(jsonb_build_object('network',p_workflow->'network_by_branch','transfer',coalesce(p_workflow->'transfer_by_branch','{}'))) loop
 for r in select * from jsonb_each_text(v_channels) loop
  v_id:=r.value::uuid;
  if not coalesce(ps->'branches','[]') ? r.key or not exists(select 1 from public.bank_accounts where id=v_id and project_id=a.project_id and is_active
    and (coalesce(cardinality(branches),0)=0 or r.key=any(branches))) then return approval_private.err('invalid'); end if;
 end loop;
 end loop;
 v_id:=nullif(p_workflow->>'apps_collection_account','')::uuid;
 if v_id is not null and not exists(select 1 from public.bank_accounts where id=v_id and project_id=a.project_id and is_active) then return approval_private.err('invalid'); end if;
 for r in select * from jsonb_each(p_workflow->'accounts') loop
  v_id:=r.key::uuid;
  if not exists(select 1 from public.bank_accounts where id=v_id and project_id=a.project_id)
   or jsonb_typeof(r.value) <> 'object' or exists(select 1 from jsonb_object_keys(r.value) k where k not in ('purpose','operating_available','transfer_to'))
   or (r.value ? 'purpose' and (jsonb_typeof(r.value->'purpose') <> 'string' or length(r.value->>'purpose')>500))
   or (r.value ? 'operating_available' and jsonb_typeof(r.value->'operating_available') <> 'boolean') then return approval_private.err('invalid'); end if;
  v_target:=nullif(r.value->>'transfer_to','')::uuid;
  if v_target is not null and (v_target=v_id or not exists(select 1 from public.bank_accounts where id=v_target and project_id=a.project_id and is_active)) then return approval_private.err('invalid'); end if;
 end loop;
 update public.project_settings set settings=jsonb_set(coalesce(settings,'{}'),'{bank_workflow}',p_workflow) where project_id=a.project_id;
 return jsonb_build_object('ok',true,'project_id',a.project_id);
exception when invalid_text_representation then return approval_private.err('invalid');
end $function$;
