-- Extend the existing reviewed-receipt policy to the demo only. Preserve the
-- installed function bodies (including later fixes), signatures and grants.
do $policy$
declare
  fn regprocedure;
  definition text;
  old_clause constant text := 'p.subdomain = ''tashormik''';
  new_clause constant text := 'p.subdomain in (''tashormik'', ''demo'')';
  expected int;
begin
  foreach fn in array array[
    'approval_private.supplier_payment_core(uuid,uuid,text,text,text,uuid,numeric,date,text,text,uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure,
    'approval_private.plan_supplier_payment(public.documents,jsonb,jsonb,boolean)'::regprocedure
  ] loop
    definition := pg_get_functiondef(fn);
    expected := case when fn::text like '%supplier_payment_core%' then 2 else 1 end;
    if array_length(string_to_array(definition, old_clause), 1) <> expected + 1 then
      raise exception 'Unexpected supplier policy in %', fn;
    end if;
    execute replace(definition, old_clause, new_clause);
  end loop;
end
$policy$;

-- Provision the existing demo only. Never reuse another project's settings,
-- account IDs, customer records or balances. A different demo setup must be reviewed.
do $setup$
declare
  pid uuid;
  prefs jsonb;
  main_bank uuid;
  custody_bank uuid;
  apps_bank uuid;
  branch_name constant text := 'فرع الواحة';
  channels constant jsonb := '["cash","network","transfer","hunger","jahez","keeta","mrsool"]';
begin
  select id into pid from public.projects where subdomain='demo' and name='الواحة' for update;
  if pid is null then return; end if;
  select coalesce(settings,'{}') into strict prefs from public.project_settings where project_id=pid and active for update;
  if prefs ?| array['branches','branch_channels','bank_workflow','account_dashboard'] or
     exists (select 1 from public.bank_accounts where project_id=pid) or
     exists (select 1 from public.branches where project_id=pid) then
    raise exception 'Demo banking or branches already configured; review before applying';
  end if;

  if approval_private.mode_of(pid) = 'legacy' then
    if exists (select 1 from public.documents where project_id=pid and status not in ('approved','rejected') and coalesce(file_url,'')='') then
      raise exception 'Demo has unresolved documents without a file';
    end if;
    insert into approval_private.settings(project_id,mode) values(pid,'v2')
      on conflict(project_id) do update set mode=excluded.mode;
    perform approval_private.link_legacy_categories(pid);
    perform approval_private.link_legacy_sales_reports(pid);
  elsif approval_private.mode_of(pid) <> 'v2' then
    raise exception 'Demo approvals are paused';
  end if;

  insert into public.branches(project_id,name,active) values(pid,branch_name,true);
  insert into public.bank_accounts(project_id,name) values(pid,'البنك الرئيسي') returning id into main_bank;
  insert into public.bank_accounts(project_id,name) values(pid,'حساب العهدة') returning id into custody_bank;
  insert into public.bank_accounts(project_id,name) values(pid,'حساب تسويات التطبيقات') returning id into apps_bank;
  update public.app_users set branch=branch_name where project_id=pid and role='cashier' and is_active and branch is null;

  update public.project_settings set
    modules=case when coalesce(modules,'[]') ? 'suppliers' then modules else coalesce(modules,'[]') || '["suppliers"]'::jsonb end,
    settings=prefs || jsonb_build_object(
      'branches',jsonb_build_array(branch_name),'branch_channels',jsonb_build_object(branch_name,channels),
      'expenses_scope','project',
      'bank_workflow',jsonb_build_object('version',1,
        'uploaders',jsonb_build_object('purchasing',jsonb_build_object('source','bank','account_id',custody_bank),
                                      'cashier',jsonb_build_object('source','cash')),
        'network_by_branch',jsonb_build_object(branch_name,main_bank),'transfer_by_branch',jsonb_build_object(branch_name,main_bank),
        'apps_collection_account',apps_bank,
        'accounts',jsonb_build_object(main_bank::text,jsonb_build_object('operating_available',true),
                                     custody_bank::text,jsonb_build_object('operating_available',true),
                                     apps_bank::text,jsonb_build_object('operating_available',true))),
      'account_dashboard',jsonb_build_object('enabled',true,'custody_account_id',custody_bank,'liability_account_id',apps_bank,'liabilities',null)
    )
    where project_id=pid;
end
$setup$;
