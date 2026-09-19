-- Run after the migration. Entire fixture is rolled back, including rate counters.
-- No PIN, token, owner identity or customer data is returned.
begin;
select set_config('tatmira.qa_slug','qa-'||replace(gen_random_uuid()::text,'-',''),true);
insert into tatmira_private.organizations(slug,name,owner_auth_id)
select current_setting('tatmira.qa_slug'),'Synthetic acceptance fixture',id
from auth.users where email_confirmed_at is not null limit 1;
set local role service_role;
do $$
declare
 v_slug text:=current_setting('tatmira.qa_slug'); owner_id uuid; org_id uuid;
 pin text:=lpad((floor(random()*1000000)::integer)::text,6,'0');
 next_pin text; r jsonb; employee_id uuid; token text; i integer;
begin
 select id,owner_auth_id into org_id,owner_id from tatmira_private.organizations where organizations.slug=v_slug;
 if owner_id is null then raise exception 'FIXTURE_REQUIRES_EXISTING_CONFIRMED_AUTH_USER'; end if;
 if public.tatmira_provision(v_slug,'Synthetic acceptance fixture',owner_id) is distinct from org_id then raise exception 'PROVISION_IDEMPOTENCY'; end if;
 perform public.tatmira_provision(v_slug||'-new','New synthetic organization',owner_id);
 begin
   perform public.tatmira_provision(v_slug,'Forbidden transfer',gen_random_uuid());
   raise exception 'PROVISION_REASSIGNMENT_ALLOWED';
 exception when raise_exception then
   if sqlerrm<>'OWNER_ALREADY_ASSIGNED' then raise; end if;
 end;
 next_pin:=lpad(((pin::integer+1)%1000000)::text,6,'0');
 if has_function_privilege('anon','public.tatmira_accounts(text,text,uuid,text,jsonb,text)','EXECUTE')
 or has_function_privilege('authenticated','public.tatmira_accounts(text,text,uuid,text,jsonb,text)','EXECUTE')
 or has_schema_privilege('authenticated','tatmira_private','USAGE') then raise exception 'PUBLIC_PRIVILEGES'; end if;

 r:=public.tatmira_accounts('employees',v_slug,gen_random_uuid());
 if r->>'error' is distinct from 'OWNER_ONLY' then raise exception 'OWNER_SCOPE'; end if;
 r:=public.tatmira_accounts('save_employee',v_slug,owner_id,null,jsonb_build_object('name','Synthetic employee','pin',pin,'grants',jsonb_build_array('upload_expense')));
 employee_id:=(r->'employee'->>'id')::uuid;
 if employee_id is null or (r->'employee') ?| array['pin','pin_hash','pin_lookup'] then raise exception 'CREATE_OR_REDACTION'; end if;
 r:=public.tatmira_accounts('save_employee',v_slug,owner_id,null,jsonb_build_object('name','Synthetic duplicate','pin',pin,'grants',jsonb_build_array()));
 if r->>'error' is distinct from 'PIN_IN_USE' then raise exception 'DUPLICATE_PIN'; end if;
 r:=public.tatmira_accounts('pin_login',v_slug,null,null,jsonb_build_object('pin',pin)); token:=r->>'token';
 if token is null then raise exception 'PIN_LOGIN'; end if;
 if exists(select 1 from tatmira_private.employees where id=employee_id and pin_hash=pin)
 or not exists(select 1 from tatmira_private.sessions where token_hash=extensions.digest(token,'sha256')) then raise exception 'SECRET_STORAGE'; end if;
 r:=public.tatmira_accounts('me',v_slug,null,token);
 if r->'actor'->>'id' is distinct from employee_id::text then raise exception 'SESSION'; end if;
 r:=public.tatmira_accounts('employees',v_slug,owner_id,token);
 if r->>'error' is distinct from 'OWNER_ONLY' then raise exception 'EMPLOYEE_ADMIN'; end if;

 insert into tatmira_private.organizations(slug,name,owner_auth_id) values(v_slug||'-b','Synthetic tenant B',owner_id);
 r:=public.tatmira_accounts('me',v_slug||'-b',null,token);
 if r->>'error' is distinct from 'INVALID_SESSION' then raise exception 'CROSS_TENANT_SESSION'; end if;
 r:=public.tatmira_accounts('set_pin',v_slug||'-b',owner_id,null,jsonb_build_object('id',employee_id,'pin',next_pin));
 if r->>'error' is distinct from 'EMPLOYEE_NOT_FOUND' then raise exception 'CROSS_TENANT_MUTATION'; end if;

 r:=public.tatmira_accounts('set_pin',v_slug,owner_id,null,jsonb_build_object('id',employee_id,'pin',next_pin));
 if r ? 'error' then raise exception 'RESET_PIN'; end if;
 r:=public.tatmira_accounts('me',v_slug,null,token);
 if r->>'error' is distinct from 'INVALID_SESSION' then raise exception 'RESET_REVOCATION'; end if;
 r:=public.tatmira_accounts('pin_login',v_slug,null,null,jsonb_build_object('pin',pin));
 if r->>'error' is distinct from 'INVALID_LOGIN' then raise exception 'OLD_PIN'; end if;
 r:=public.tatmira_accounts('pin_login',v_slug,null,null,jsonb_build_object('pin',next_pin)); token:=r->>'token';
 if token is null then raise exception 'NEW_PIN'; end if;
 r:=public.tatmira_accounts('set_active',v_slug,owner_id,null,jsonb_build_object('id',employee_id,'active',false));
 r:=public.tatmira_accounts('me',v_slug,null,token);
 if r->>'error' is distinct from 'INVALID_SESSION' then raise exception 'DISABLE_REVOCATION'; end if;
 r:=public.tatmira_accounts('pin_login',v_slug,null,null,jsonb_build_object('pin',next_pin));
 if r->>'error' is distinct from 'INVALID_LOGIN' then raise exception 'DISABLED_LOGIN'; end if;
 r:=public.tatmira_accounts('set_active',v_slug,owner_id,null,jsonb_build_object('id',employee_id,'active',true));
 r:=public.tatmira_accounts('me',v_slug,null,token);
 if r->>'error' is distinct from 'INVALID_SESSION' then raise exception 'REACTIVATION_REVIVES_TOKEN'; end if;
 r:=public.tatmira_accounts('pin_login',v_slug,null,null,jsonb_build_object('pin',next_pin)); token:=r->>'token';
 r:=public.tatmira_accounts('save_employee',v_slug,owner_id,null,jsonb_build_object('id',employee_id,'name','Updated synthetic employee','grants',jsonb_build_array('upload_sale')));
 r:=public.tatmira_accounts('me',v_slug,null,token);
 if r->>'error' is distinct from 'INVALID_SESSION' then raise exception 'GRANTS_REVOCATION'; end if;
 r:=public.tatmira_accounts('pin_login',v_slug,null,null,jsonb_build_object('pin',next_pin)); token:=r->>'token';
 r:=public.tatmira_accounts('logout',v_slug,null,token);
 r:=public.tatmira_accounts('me',v_slug,null,token);
 if r->>'error' is distinct from 'INVALID_SESSION' then raise exception 'LOGOUT_REVOCATION'; end if;

 update tatmira_private.rate_limits set attempts=0 where scope in ('global','tenant:'||v_slug,'daily:'||v_slug);
 for i in 1..30 loop
   r:=public.tatmira_accounts('pin_login',v_slug,null,null,jsonb_build_object('pin',pin));
   if r->>'error' is distinct from 'INVALID_LOGIN' then raise exception 'RATE_BUDGET'; end if;
 end loop;
 r:=public.tatmira_accounts('pin_login',v_slug,null,null,jsonb_build_object('pin',next_pin));
 if r->>'error' is distinct from 'RATE_LIMITED' then raise exception 'RATE_LIMIT'; end if;
 update tatmira_private.rate_limits set attempts=0 where scope='tenant:'||v_slug;
 update tatmira_private.rate_limits set attempts=100 where scope='daily:'||v_slug;
 r:=public.tatmira_accounts('pin_login',v_slug,null,null,jsonb_build_object('pin',next_pin));
 if r->>'error' is distinct from 'RATE_LIMITED' then raise exception 'DAILY_RATE_LIMIT'; end if;
end;$$;
rollback;
select 'Account acceptance checks passed; fixture rolled back' as result;
