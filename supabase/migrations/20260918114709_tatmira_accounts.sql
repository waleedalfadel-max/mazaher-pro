-- Isolated accounts only. No existing project, user, ledger or storage policy is changed.
create schema tatmira_private;
revoke all on schema tatmira_private from public, anon, authenticated;
grant usage on schema tatmira_private to service_role;

create table tatmira_private.organizations (
 id uuid primary key default gen_random_uuid(), slug text unique not null check (slug ~ '^[a-z0-9-]{1,63}$'),
 name text not null, owner_auth_id uuid references auth.users(id), active boolean not null default true,
 pin_secret bytea not null default extensions.gen_random_bytes(32), created_at timestamptz not null default now()
);
create table tatmira_private.employees (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references tatmira_private.organizations(id),
 name text not null check (length(name) between 1 and 100), active boolean not null default true,
 grants text[] not null default '{}', pin_lookup bytea not null, pin_hash text not null,
 version bigint not null default 1, created_at timestamptz not null default now(),
 unique(organization_id,pin_lookup),
 check (grants <@ array['upload_sale','upload_payment','upload_expense','review','view_reports','manage_customers']::text[])
);
create table tatmira_private.sessions (
 token_hash bytea primary key, employee_id uuid not null references tatmira_private.employees(id),
 version bigint not null, expires_at timestamptz not null, created_at timestamptz not null default now()
);
create index tatmira_sessions_employee on tatmira_private.sessions(employee_id);
create table tatmira_private.rate_limits (
 scope text primary key, attempts integer not null default 1, reset_at timestamptz not null
);
create index tatmira_rate_expiry on tatmira_private.rate_limits(reset_at);
create table tatmira_private.audit (
 id bigint generated always as identity primary key, organization_id uuid not null references tatmira_private.organizations(id),
 actor_id uuid, action text not null, employee_id uuid, created_at timestamptz not null default now()
);
create index tatmira_audit_organization on tatmira_private.audit(organization_id,created_at);
alter table tatmira_private.organizations enable row level security;
alter table tatmira_private.employees enable row level security;
alter table tatmira_private.sessions enable row level security;
alter table tatmira_private.rate_limits enable row level security;
alter table tatmira_private.audit enable row level security;
revoke all on all tables in schema tatmira_private from public,anon,authenticated;
grant select,insert,update,delete on all tables in schema tatmira_private to service_role;
grant usage,select on all sequences in schema tatmira_private to service_role;

create function tatmira_private.employee_json(e tatmira_private.employees) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('id',e.id,'name',e.name,'active',e.active,'grants',e.grants,'role','employee');
$$;
revoke all on function tatmira_private.employee_json(tatmira_private.employees) from public,anon,authenticated;
grant execute on function tatmira_private.employee_json(tatmira_private.employees) to service_role;

-- Service-role-only gateway. p_owner is supplied only after Edge auth.getUser succeeds.
create function public.tatmira_accounts(p_action text,p_slug text,p_owner uuid default null,p_token text default null,
 p_payload jsonb default '{}',p_address text default '') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 org tatmira_private.organizations%rowtype;
 emp tatmira_private.employees%rowtype;
 sess tatmira_private.sessions%rowtype;
 v_pin text; v_token text; v_scope text; v_attempts integer;
 v_name text; v_grants text[]; v_lookup bytea; v_id uuid; v_active boolean;
begin
 if current_user <> 'service_role' then return jsonb_build_object('error','OWNER_ONLY'); end if;
 if p_action not in ('pin_login','me','logout','employees','save_employee','set_active','set_pin') then
   return jsonb_build_object('error','INVALID_REQUEST'); end if;

 -- Failed logins commit their counter; no exception is used for authentication failures.
 if p_action='pin_login' then
   v_pin := p_payload->>'pin';
   if v_pin is null or v_pin !~ '^[0-9]{6}$' then return jsonb_build_object('error','PIN_FORMAT'); end if;
   -- A fixed global scope bounds unknown tenant names as well as known tenants.
   delete from tatmira_private.rate_limits where scope in
     (select scope from tatmira_private.rate_limits where reset_at<=clock_timestamp() limit 500);
   foreach v_scope in array array['global','tenant:'||p_slug,'daily:'||p_slug] loop
     insert into tatmira_private.rate_limits(scope,attempts,reset_at)
     values(v_scope,1,clock_timestamp()+case when v_scope like 'daily:%' then interval '24 hours' else interval '5 minutes' end)
     on conflict(scope) do update set
       attempts=case when tatmira_private.rate_limits.reset_at <= clock_timestamp() then 1 else tatmira_private.rate_limits.attempts+1 end,
       reset_at=case when tatmira_private.rate_limits.reset_at <= clock_timestamp() then clock_timestamp()+case when v_scope like 'daily:%' then interval '24 hours' else interval '5 minutes' end else tatmira_private.rate_limits.reset_at end
     returning attempts into v_attempts;
     if v_attempts > (case when v_scope='global' then 1000 when v_scope like 'daily:%' then 100 else 30 end) then return jsonb_build_object('error','RATE_LIMITED'); end if;
   end loop;
 end if;

 select * into org from tatmira_private.organizations where slug=p_slug and active;
 if not found then return jsonb_build_object('error',case when p_action='pin_login' then 'INVALID_LOGIN' else 'TENANT_UNAVAILABLE' end); end if;
 -- Login and all employee mutations use the same organization lock, closing reset/disable races.
 perform pg_advisory_xact_lock(hashtextextended(org.id::text,0));
 -- Re-read after lock acquisition so an account cannot be re-enabled by a stale snapshot.
 select * into org from tatmira_private.organizations where id=org.id and active;
 if not found then return jsonb_build_object('error','TENANT_UNAVAILABLE'); end if;

 if p_action='pin_login' then
   v_lookup:=extensions.hmac(v_pin,encode(org.pin_secret,'hex'),'sha256');
   select * into emp from tatmira_private.employees where organization_id=org.id and pin_lookup=v_lookup and active;
   if not found or extensions.crypt(v_pin,emp.pin_hash) is distinct from emp.pin_hash then
     return jsonb_build_object('error','INVALID_LOGIN'); end if;
   -- Successful staff logins do not consume the organization's failed-attempt budget.
   update tatmira_private.rate_limits set attempts=greatest(0,attempts-1)
     where scope in ('tenant:'||p_slug,'daily:'||p_slug);
   delete from tatmira_private.sessions where employee_id=emp.id and expires_at<=now();
   v_token:='tm_'||encode(extensions.gen_random_bytes(32),'hex');
   insert into tatmira_private.sessions(token_hash,employee_id,version,expires_at)
   values(extensions.digest(v_token,'sha256'),emp.id,emp.version,now()+interval '12 hours');
   insert into tatmira_private.audit(organization_id,actor_id,action,employee_id) values(org.id,emp.id,'login',emp.id);
   return jsonb_build_object('token',v_token,'expiresAt',now()+interval '12 hours','actor',tatmira_private.employee_json(emp),'organization',jsonb_build_object('slug',org.slug,'name',org.name));
 end if;

 if p_token is not null then
   select * into sess from tatmira_private.sessions where token_hash=extensions.digest(p_token,'sha256') and expires_at>now();
   if not found then return jsonb_build_object('error','INVALID_SESSION'); end if;
   select * into emp from tatmira_private.employees where id=sess.employee_id and organization_id=org.id and active and version=sess.version;
   if not found then return jsonb_build_object('error','INVALID_SESSION'); end if;
   if p_action='logout' then
     delete from tatmira_private.sessions where token_hash=sess.token_hash;
     return jsonb_build_object('ok',true);
   end if;
   if p_action<>'me' then return jsonb_build_object('error','OWNER_ONLY'); end if;
   return jsonb_build_object('actor',tatmira_private.employee_json(emp),'organization',jsonb_build_object('slug',org.slug,'name',org.name));
 end if;

 if p_owner is null or org.owner_auth_id is distinct from p_owner then return jsonb_build_object('error','OWNER_ONLY'); end if;
 if p_action='me' then return jsonb_build_object('actor',jsonb_build_object('id',p_owner,'name','المالك','role','owner','active',true),
   'organization',jsonb_build_object('slug',org.slug,'name',org.name)); end if;
 if p_action='logout' then return jsonb_build_object('ok',true); end if;
 if p_action='employees' then
   return jsonb_build_object('employees',coalesce((select jsonb_agg(tatmira_private.employee_json(e) order by e.created_at) from tatmira_private.employees e where e.organization_id=org.id),'[]'::jsonb));
 end if;

 if p_payload->>'id' is not null then
   begin v_id:=(p_payload->>'id')::uuid; exception when invalid_text_representation then return jsonb_build_object('error','INVALID_REQUEST'); end;
   select * into emp from tatmira_private.employees where id=v_id and organization_id=org.id;
   if not found then return jsonb_build_object('error','EMPLOYEE_NOT_FOUND'); end if;
 end if;
 if p_action='save_employee' then
   v_name:=btrim(p_payload->>'name');
   if v_name is null or length(v_name) not between 1 and 100 or jsonb_typeof(p_payload->'grants') is distinct from 'array' then return jsonb_build_object('error','INVALID_REQUEST'); end if;
   v_grants:=array(select jsonb_array_elements_text(p_payload->'grants'));
   if not v_grants <@ array['upload_sale','upload_payment','upload_expense','review','view_reports','manage_customers']::text[] then return jsonb_build_object('error','INVALID_GRANTS'); end if;
   if v_id is null then
     v_pin:=p_payload->>'pin';
     if v_pin is null or v_pin !~ '^[0-9]{6}$' then return jsonb_build_object('error','PIN_FORMAT'); end if;
     v_lookup:=extensions.hmac(v_pin,encode(org.pin_secret,'hex'),'sha256');
     if exists(select 1 from tatmira_private.employees where organization_id=org.id and pin_lookup=v_lookup) then return jsonb_build_object('error','PIN_IN_USE'); end if;
     insert into tatmira_private.employees(organization_id,name,grants,pin_lookup,pin_hash)
       values(org.id,v_name,v_grants,v_lookup,extensions.crypt(v_pin,extensions.gen_salt('bf',12))) returning * into emp;
   else
     update tatmira_private.employees set name=v_name,grants=v_grants,version=version+1 where id=v_id returning * into emp;
     delete from tatmira_private.sessions where employee_id=v_id;
   end if;
 elsif p_action='set_pin' and v_id is not null then
   v_pin:=p_payload->>'pin';
   if v_pin is null or v_pin !~ '^[0-9]{6}$' then return jsonb_build_object('error','PIN_FORMAT'); end if;
   v_lookup:=extensions.hmac(v_pin,encode(org.pin_secret,'hex'),'sha256');
   if exists(select 1 from tatmira_private.employees where organization_id=org.id and pin_lookup=v_lookup and id<>v_id) then return jsonb_build_object('error','PIN_IN_USE'); end if;
   update tatmira_private.employees set pin_lookup=v_lookup,pin_hash=extensions.crypt(v_pin,extensions.gen_salt('bf',12)),version=version+1 where id=v_id returning * into emp;
   delete from tatmira_private.sessions where employee_id=v_id;
 elsif p_action='set_active' and v_id is not null then
   if jsonb_typeof(p_payload->'active') is distinct from 'boolean' then return jsonb_build_object('error','INVALID_REQUEST'); end if;
   v_active:=(p_payload->>'active')::boolean;
   update tatmira_private.employees set active=v_active,version=version+1 where id=v_id returning * into emp;
   delete from tatmira_private.sessions where employee_id=v_id;
 else return jsonb_build_object('error','INVALID_REQUEST');
 end if;
 insert into tatmira_private.audit(organization_id,actor_id,action,employee_id) values(org.id,p_owner,p_action,emp.id);
 return jsonb_build_object('employee',tatmira_private.employee_json(emp));
end;
$$;
revoke all on function public.tatmira_accounts(text,text,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.tatmira_accounts(text,text,uuid,text,jsonb,text) to service_role;

-- Offline provisioning only; deliberately not exposed by the Edge gateway.
create function public.tatmira_provision(p_slug text,p_name text,p_owner uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_owner uuid;
begin
 if current_user<>'service_role' then raise exception 'SERVICE_ONLY'; end if;
 if p_owner is null or not exists(select 1 from auth.users where id=p_owner and email_confirmed_at is not null) then raise exception 'CONFIRMED_OWNER_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_slug,1));
 select id,owner_auth_id into v_id,v_owner from tatmira_private.organizations where slug=p_slug;
 if found then
   if v_owner is distinct from p_owner then raise exception 'OWNER_ALREADY_ASSIGNED'; end if;
   return v_id;
 end if;
 insert into tatmira_private.organizations(slug,name,owner_auth_id) values(p_slug,p_name,p_owner) returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.tatmira_provision(text,text,uuid) from public,anon,authenticated;
grant execute on function public.tatmira_provision(text,text,uuid) to service_role;
