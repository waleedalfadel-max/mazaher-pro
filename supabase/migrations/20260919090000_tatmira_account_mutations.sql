-- Idempotent/CAS owner mutations for employee administration.
-- The v1 accounts function remains available for reads and employee sessions.
create table tatmira_private.account_requests (
 organization_id uuid not null references tatmira_private.organizations(id),
 owner_id uuid not null,
 request_id uuid not null,
 fingerprint bytea not null check (octet_length(fingerprint)=32),
 result jsonb not null check (jsonb_typeof(result)='object'),
 created_at timestamptz not null default now(),
 primary key (organization_id,owner_id,request_id)
);
alter table tatmira_private.account_requests enable row level security;
revoke all on tatmira_private.account_requests from public,anon,authenticated;
grant select,insert on tatmira_private.account_requests to service_role;

create or replace function tatmira_private.employee_json(e tatmira_private.employees) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('id',e.id,'name',e.name,'active',e.active,'grants',e.grants,'role','employee','version',e.version);
$$;

create function public.tatmira_accounts_mutate(p_action text,p_slug text,p_owner uuid,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 org tatmira_private.organizations%rowtype;
 receipt tatmira_private.account_requests%rowtype;
 v_fingerprint bytea; v_result jsonb; v_id uuid; v_expected bigint; v_current bigint;
begin
 if current_user<>'service_role' then return jsonb_build_object('error','OWNER_ONLY'); end if;
 if p_action not in ('save_employee','set_active','set_pin') or p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' then
   return jsonb_build_object('error','INVALID_REQUEST'); end if;
 select * into org from tatmira_private.organizations where slug=p_slug and active;
 if not found then return jsonb_build_object('error','TENANT_UNAVAILABLE'); end if;
 if p_owner is null or org.owner_auth_id is distinct from p_owner then return jsonb_build_object('error','OWNER_ONLY'); end if;

 -- This is the same organization lock used by v1, so the version check and
 -- subsequent mutation are one serialized transaction.
 perform pg_advisory_xact_lock(hashtextextended(org.id::text,0));
 select * into org from tatmira_private.organizations where id=org.id and active and owner_auth_id=p_owner;
 if not found then return jsonb_build_object('error','OWNER_ONLY'); end if;
 v_fingerprint:=extensions.hmac(p_action||'|'||p_payload::text,encode(org.pin_secret,'hex'),'sha256');
 select * into receipt from tatmira_private.account_requests r
   where r.organization_id=org.id and r.owner_id=p_owner and r.request_id=p_request_id;
 if found then
   if receipt.fingerprint is distinct from v_fingerprint then return jsonb_build_object('error','REQUEST_ID_REUSED'); end if;
   return receipt.result||jsonb_build_object('duplicate',true);
 end if;

 if p_payload->>'id' is not null then
   begin v_id:=(p_payload->>'id')::uuid;
   exception when invalid_text_representation then return jsonb_build_object('error','INVALID_REQUEST'); end;
   begin v_expected:=(p_payload->>'expectedVersion')::bigint;
   exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('error','INVALID_REQUEST'); end;
   if v_expected is null or v_expected<1 then return jsonb_build_object('error','INVALID_REQUEST'); end if;
   select version into v_current from tatmira_private.employees where id=v_id and organization_id=org.id;
   if not found then return jsonb_build_object('error','EMPLOYEE_NOT_FOUND'); end if;
   if v_current is distinct from v_expected then return jsonb_build_object('error','CONFLICT'); end if;
 elsif p_action<>'save_employee' or p_payload ? 'expectedVersion' then
   return jsonb_build_object('error','INVALID_REQUEST');
 end if;

 v_result:=public.tatmira_accounts(p_action,p_slug,p_owner,null,p_payload,'');
 if v_result ? 'error' then return v_result; end if;
 insert into tatmira_private.account_requests(organization_id,owner_id,request_id,fingerprint,result)
 values(org.id,p_owner,p_request_id,v_fingerprint,v_result);
 return v_result;
end;
$$;
revoke all on function public.tatmira_accounts_mutate(text,text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.tatmira_accounts_mutate(text,text,uuid,jsonb,uuid) to service_role;
