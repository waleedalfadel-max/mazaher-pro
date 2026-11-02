-- Role write guards (readiness review 2026-11-02, H1 and H3). Policies only: no table, function or data change.
--
-- H1: a cashier could insert approved ledger_entries / sales rows directly (outside document approval) and write loans and
--     branches; any role could write loans and branches. The app gives cashiers no such path: they only upload documents
--     (documents + the documents bucket, unchanged here). Approval, supplier payments and admin writes run in SECURITY DEFINER
--     functions and are not affected by these policies.
-- H3: any signed-in user of any business could upload to the public-assets bucket and overwrite the shared logo.
--     Only the platform admin uploads it (SuperAdmin.jsx -> src/lib/appLogo.js).
--
-- Identity helpers are wrapped in (select ...) so they are evaluated once per statement, not per row.
-- H3 (storage.objects policies) is NOT in this migration: storage.objects is owned by supabase_storage_admin, and the release
-- role (postgres) cannot alter its policies ("must be owner of table objects", reproduced on the restored production roles).
-- It is applied separately as supabase/manual/public-assets-admin-only.sql through the Supabase dashboard.
-- Rollback: supabase/rollback/role-write-guards.sql restores the exact previous definitions.

alter policy ledger_entries_insert on public.ledger_entries
  with check ((project_id = (select auth_project_id())) and ((select auth_is_superadmin()) or (select auth_role()) = 'accountant'));

alter policy sales_insert on public.sales
  with check ((project_id = (select auth_project_id())) and ((select auth_is_superadmin()) or (select auth_role()) = 'accountant'));

alter policy branches_project_write on public.branches
  using ((project_id = (select auth_project_id())) and ((select auth_is_superadmin()) or (select auth_role()) = 'accountant'))
  with check ((project_id = (select auth_project_id())) and ((select auth_is_superadmin()) or (select auth_role()) = 'accountant'));

alter policy loans_project_write on public.loans
  using ((project_id = (select auth_project_id())) and ((select auth_is_superadmin()) or (select auth_role()) = 'accountant'))
  with check ((project_id = (select auth_project_id())) and ((select auth_is_superadmin()) or (select auth_role()) = 'accountant'));
