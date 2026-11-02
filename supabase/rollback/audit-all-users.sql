-- Rollback of 20261102170000_audit_all_users.sql: the exact production definition on 2026-11-02 (platform-admin actions only).
-- The constraint goes back to platform-admin only, NOT VALID: rows already logged for business users stay, new ones are refused again
-- (the restored function no longer writes them).

alter table admin_private.action_log drop constraint action_log_actor_role_check,
  add constraint action_log_actor_role_check check (actor_role = 'superadmin'::text) not valid;

CREATE OR REPLACE FUNCTION admin_private.capture_action()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a record; old_json jsonb; new_json jsonb; b jsonb; n jsonb; pid uuid; rid text; fields text[];
begin
  select * into a from approval_private.actor();
  if a.role is distinct from 'superadmin' then return null; end if;
  if tg_op <> 'INSERT' then old_json:=to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_json:=to_jsonb(new); end if;
  pid:=nullif(coalesce(new_json,old_json)->>'project_id','')::uuid;
  if tg_table_name='projects' then pid:=(coalesce(new_json,old_json)->>'id')::uuid; end if;
  rid:=coalesce(new_json,old_json)->>'id';
  b:=admin_private.audit_value(tg_table_name,old_json);
  n:=admin_private.audit_value(tg_table_name,new_json);
  if tg_table_name='project_settings' then
    if b is not null then b:=b||jsonb_build_object('settings',coalesce((select jsonb_object_agg(k,v) from jsonb_each(coalesce(old_json->'settings','{}')) e(k,v) where k=any(array['branches','branch_channels','expenses_scope','transaction_types','modules','bank_workflow'])),'{}')); end if;
    if n is not null then n:=n||jsonb_build_object('settings',coalesce((select jsonb_object_agg(k,v) from jsonb_each(coalesce(new_json->'settings','{}')) e(k,v) where k=any(array['branches','branch_channels','expenses_scope','transaction_types','modules','bank_workflow'])),'{}')); end if;
  end if;
  -- Record that a file/reading changed, but never store its contents or URL.
  -- Login bookkeeping is not a business edit and must not create audit noise.
  select coalesce(array_agg(k order by k),'{}') into fields from (
    select jsonb_object_keys(coalesce(old_json,'{}')||coalesce(new_json,'{}')) k
  ) keys where old_json->k is distinct from new_json->k
    and k not in ('auth_id','pin','password','password_hash','token','updated_at')
    and (tg_table_name<>'app_users' or b ? k or n ? k);
  if tg_op='UPDATE' and cardinality(fields)=0 then return null; end if;
  insert into admin_private.action_log(project_id,actor_id,actor_name,actor_role,entity,row_id,action,before_value,after_value,changed_fields,reason)
  values(pid,a.id,a.name,a.role,tg_table_name,rid,tg_op,b,n,fields,nullif(current_setting('tahseeb.admin_reason',true),''));
  return null;
end $function$

;
