-- Rollback of 20261102150000_role_write_guards.sql: the exact policy definitions live in production on 2026-11-02 (pg_policies).
-- Note: this reopens H1. Data written while the guards were active is unaffected.

alter policy ledger_entries_insert on public.ledger_entries
  with check ((project_id = auth_project_id()) and (auth_is_superadmin() or (auth_role() = any (array['accountant'::text, 'cashier'::text]))));

alter policy sales_insert on public.sales
  with check ((project_id = auth_project_id()) and (auth_is_superadmin() or (auth_role() = any (array['accountant'::text, 'cashier'::text]))));

alter policy branches_project_write on public.branches
  using (project_id = auth_project_id())
  with check (project_id = auth_project_id());

alter policy loans_project_write on public.loans
  using (project_id = auth_project_id())
  with check (project_id = auth_project_id());
