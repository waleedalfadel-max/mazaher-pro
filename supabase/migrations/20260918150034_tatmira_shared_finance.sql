-- Isolated shared ledger. Existing public financial tables and account RPC are untouched.
create table tatmira_private.ledgers (
 organization_id uuid primary key references tatmira_private.organizations(id),
 revision bigint not null default 0 check (revision >= 0),
 state jsonb not null check (jsonb_typeof(state) = 'object'),
 updated_at timestamptz not null default now()
);
create table tatmira_private.finance_requests (
 organization_id uuid not null references tatmira_private.organizations(id),
 actor_id uuid not null,
 request_id uuid not null,
 fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key (organization_id, actor_id, request_id)
);
alter table tatmira_private.ledgers enable row level security;
alter table tatmira_private.finance_requests enable row level security;
revoke all on tatmira_private.ledgers, tatmira_private.finance_requests from public, anon, authenticated;
grant select, insert, update on tatmira_private.ledgers, tatmira_private.finance_requests to service_role;

-- File reads/uploads go through the custom-session gateway, never a public URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tatmira-documents', 'tatmira-documents', false, 5242880, array['application/pdf','image/jpeg','image/png']);
-- Defense against any future broad permissive policy; other buckets are unaffected.
create policy tatmira_files_gateway_only on storage.objects as restrictive for all to anon, authenticated
using (bucket_id <> 'tatmira-documents') with check (bucket_id <> 'tatmira-documents');

create function public.tatmira_finance(p_operation text, p_slug text, p_owner uuid default null, p_token text default null, p_payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
 identity jsonb; org_id uuid; v_actor_id uuid; actor jsonb; ledger tatmira_private.ledgers%rowtype;
 receipt tatmira_private.finance_requests%rowtype;
 v_request_id uuid; required_grant text; command_type text; expected_revision bigint; result jsonb;
begin
 if current_user <> 'service_role' then return jsonb_build_object('error','FORBIDDEN'); end if;
 if p_operation not in ('snapshot','receipt','commit') then return jsonb_build_object('error','INVALID_REQUEST'); end if;
 -- This RPC shares the organization transaction lock with login, reset and disable.
 -- Revalidation happens in the commit transaction, not only before edge calculations.
 identity := public.tatmira_accounts('me',p_slug,p_owner,p_token);
 if identity ? 'error' then return identity; end if;
 select id into org_id from tatmira_private.organizations where slug=p_slug and active;
 actor := identity->'actor'; v_actor_id := (actor->>'id')::uuid;
 select * into ledger from tatmira_private.ledgers where organization_id=org_id;
 if p_operation='snapshot' then
   return jsonb_build_object('actor',actor,'organization',(identity->'organization')||jsonb_build_object('id',org_id),
     'revision',coalesce(ledger.revision,0),'state',ledger.state);
 end if;
 begin v_request_id := (p_payload->>'requestId')::uuid;
 exception when invalid_text_representation then return jsonb_build_object('error','INVALID_REQUEST'); end;
 if v_request_id is null or coalesce(p_payload->>'fingerprint','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','INVALID_REQUEST'); end if;
 select * into receipt from tatmira_private.finance_requests r where r.organization_id=org_id and r.actor_id=v_actor_id and r.request_id=v_request_id;
 if found then
   if receipt.fingerprint is distinct from p_payload->>'fingerprint' then return jsonb_build_object('error','REQUEST_ID_REUSED'); end if;
   if p_operation='receipt' then return jsonb_build_object('result',receipt.result); end if;
   return receipt.result || jsonb_build_object('duplicate',true);
 end if;
 if p_operation='receipt' then return jsonb_build_object('result',null); end if;
 command_type := p_payload->'command'->>'type';
 required_grant := case
   when command_type='DOC_ADD' then case p_payload->'command'->>'kind'
     when 'sale' then 'upload_sale' when 'payment' then 'upload_payment' when 'purchase' then 'upload_expense' else null end
   when command_type in ('DOC_UPDATE_FIELDS','DOC_APPROVE','DOC_REJECT','CREDIT_APPLY') then 'review'
   when command_type in ('CUSTOMER_ADD','CUSTOMER_UPDATE','CUSTOMER_ARCHIVE') then 'manage_customers'
   when command_type in ('TAX_SETTING_SAVE','LAB_UPDATE','ACCOUNT_SAVE','ACCOUNT_ARCHIVE','GROUP_SAVE','GROUP_ARCHIVE','CATEGORY_SAVE','CATEGORY_ARCHIVE') then 'owner'
   else null end;
 if required_grant is null or (actor->>'role'<>'owner' and (required_grant='owner' or not coalesce(actor->'grants' ? required_grant,false))) then
   return jsonb_build_object('error','FORBIDDEN'); end if;
 begin expected_revision := (p_payload->>'revision')::bigint;
 exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('error','INVALID_REQUEST'); end;
 if expected_revision is null or expected_revision is distinct from coalesce(ledger.revision,0) then return jsonb_build_object('error','CONFLICT'); end if;
 if jsonb_typeof(p_payload->'state') is distinct from 'object'
   or jsonb_typeof(p_payload->'state'->'documents') is distinct from 'array'
   or jsonb_typeof(p_payload->'state'->'invoices') is distinct from 'array'
   or octet_length((p_payload->'state')::text)>16777216 then return jsonb_build_object('error','INVALID_REQUEST'); end if;
 -- p_state comes exclusively from the server reducer; clients cannot EXECUTE this RPC.
 insert into tatmira_private.ledgers(organization_id,revision,state) values(org_id,expected_revision+1,p_payload->'state')
 on conflict(organization_id) do update set state=excluded.state,revision=excluded.revision,updated_at=now();
 result := jsonb_build_object('ok',true,'revision',expected_revision+1,'documentId',p_payload->>'documentId');
 insert into tatmira_private.finance_requests(organization_id,actor_id,request_id,fingerprint,result)
 values(org_id,v_actor_id,v_request_id,p_payload->>'fingerprint',result);
 insert into tatmira_private.audit(organization_id,actor_id,action) values(org_id,v_actor_id,'finance:'||command_type);
 return result;
end; $$;
revoke all on function public.tatmira_finance(text,text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.tatmira_finance(text,text,uuid,text,jsonb) to service_role;
