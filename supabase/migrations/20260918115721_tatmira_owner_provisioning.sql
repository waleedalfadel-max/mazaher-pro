-- The server role has no direct SELECT privilege on auth.users in hosted Supabase.
-- The private provisioning script verifies confirmation via Auth Admin first.
-- Keep this RPC service-only, SECURITY INVOKER and FK-validated; do not grant
-- table access to auth.users or add a SECURITY DEFINER privilege escalation.
create or replace function public.tatmira_provision(p_slug text,p_name text,p_owner uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_owner uuid;
begin
 if current_user<>'service_role' then raise exception 'SERVICE_ONLY'; end if;
 if p_owner is null then raise exception 'OWNER_REQUIRED'; end if;
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
