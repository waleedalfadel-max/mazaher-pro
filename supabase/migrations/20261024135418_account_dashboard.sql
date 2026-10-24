-- Optional per-company account dashboard. No activation, bank rename, opening balance or financial entry on migration.
create function public.admin_account_dashboard_save(p_config jsonb, p_expected jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a record; ps jsonb; old_cfg jsonb; custody_id uuid; liability_id uuid; liability jsonb; n numeric; d date;
begin
 select * into a from approval_private.actor();
 if a.id is null then return approval_private.err('no_session'); end if;
 if a.role is distinct from 'superadmin' or a.project_id is null then return approval_private.err('forbidden'); end if;
 if nullif(btrim(p_reason),'') is null or length(p_reason)>500 then return approval_private.err('reason_required'); end if;
 perform 1 from public.projects where id=a.project_id for update;
 select settings into ps from public.project_settings where project_id=a.project_id for update;
 if not found then return approval_private.err('not_found'); end if;
 old_cfg:=ps->'account_dashboard';
 if coalesce(old_cfg,'null') is distinct from coalesce(p_expected,'null') then return approval_private.err('stale'); end if;
 if jsonb_typeof(p_config) is distinct from 'object' then return approval_private.err('invalid'); end if;
 if jsonb_typeof(p_config->'enabled') is distinct from 'boolean'
 or exists(select 1 from jsonb_object_keys(p_config) k where k not in ('enabled','custody_account_id','liability_account_id','liabilities')) then return approval_private.err('invalid'); end if;
 custody_id:=nullif(p_config->>'custody_account_id','')::uuid;
 liability_id:=nullif(p_config->>'liability_account_id','')::uuid;
 if p_config->'enabled'='true'::jsonb then
  if ps->'bank_workflow'->'version' is distinct from '1'::jsonb then return approval_private.err('workflow_required'); end if;
  if custody_id is null or liability_id is null or custody_id=liability_id then return approval_private.err('invalid'); end if;
 end if;
 if custody_id is not null and not exists(select 1 from public.bank_accounts where id=custody_id and project_id=a.project_id and is_active) then return approval_private.err('invalid'); end if;
 if liability_id is not null and not exists(select 1 from public.bank_accounts where id=liability_id and project_id=a.project_id and is_active) then return approval_private.err('invalid'); end if;
 liability:=p_config->'liabilities';
 if liability is not null and liability<>'null'::jsonb then
  if jsonb_typeof(liability) is distinct from 'object' then return approval_private.err('invalid'); end if;
  if liability_id is null or jsonb_typeof(liability->'balance') is distinct from 'number'
   or jsonb_typeof(liability->'date') is distinct from 'string'
   or jsonb_typeof(liability->'reference') is distinct from 'string'
   or jsonb_typeof(liability->'automatic_sweep') is distinct from 'boolean'
   or exists(select 1 from jsonb_object_keys(liability) k where k not in ('balance','date','reference','automatic_sweep')) then return approval_private.err('invalid'); end if;
  n:=(liability->>'balance')::numeric;
  if n<0 or n>=1e12 or n<>round(n,2) or nullif(btrim(liability->>'reference'),'') is null or length(liability->>'reference')>500
   or (liability->>'date') !~ '^\d{4}-\d{2}-\d{2}$' then return approval_private.err('invalid'); end if;
  d:=(liability->>'date')::date;
  if d>(now() at time zone 'Asia/Riyadh')::date then return approval_private.err('invalid'); end if;
 end if;
 perform set_config('tahseeb.admin_reason',btrim(p_reason),true);
 if p_config->'enabled'='true'::jsonb then
  -- Same bank ID, history and branch links. The actual name is used throughout the application.
  update public.bank_accounts set name='حساب العهدة' where id=custody_id and project_id=a.project_id;
  ps:=jsonb_set(ps,'{bank_workflow,uploaders,purchasing}',jsonb_build_object('source','bank','account_id',custody_id));
 end if;
 update public.project_settings set settings=jsonb_set(coalesce(ps,'{}'),'{account_dashboard}',p_config) where project_id=a.project_id;
 -- The existing generic audit whitelist predates this settings key. Record its full before/after explicitly.
 insert into admin_private.action_log(project_id,actor_id,actor_name,actor_role,entity,row_id,action,before_value,after_value,changed_fields,reason)
 values(a.project_id,a.id,a.name,a.role,'account_dashboard',a.project_id::text,'UPDATE',old_cfg,p_config,array['account_dashboard'],btrim(p_reason));
 return jsonb_build_object('ok',true,'project_id',a.project_id);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return approval_private.err('invalid');
 when unique_violation then return approval_private.err('name_exists');
end $$;
revoke all on function public.admin_account_dashboard_save(jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.admin_account_dashboard_save(jsonb,jsonb,text) to authenticated;
