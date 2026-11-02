# Role write guards (readiness review 2026-11-02: H1, H3)

## What changes
Database policies only. No table, function, data or UI change.

| Policy | Before | After |
|---|---|---|
| `ledger_entries_insert` | accountant **or cashier** (or platform admin) in own business | accountant or platform admin |
| `sales_insert` | accountant **or cashier** | accountant or platform admin |
| `branches_project_write` | **any role** in own business | accountant or platform admin |
| `loans_project_write` | **any role** in own business | accountant or platform admin |
| `public-assets insert authenticated` (storage) | **any signed-in user** | platform admin |
| `public-assets update authenticated` (storage) | **any signed-in user** | platform admin |

Identity helpers are wrapped in `(select …)` so they run once per statement.

- Cashiers keep their only app path: uploading documents (the `documents` table and the `documents` bucket are unchanged).
- Approval, supplier payments and admin writes run in SECURITY DEFINER functions and are not affected.

## How it is applied
- `supabase/migrations/20261102150000_role_write_guards.sql`
  - The four `public` policies.
  - Applied by the release role.
- `supabase/manual/public-assets-admin-only.sql`
  - The two storage policies.
  - `storage.objects` is owned by `supabase_storage_admin`, so the release role gets `must be owner of table objects`. This was reproduced on a copy with the production roles.
  - It is therefore applied from the Supabase dashboard.
- Rollback files (exact live definitions):
  - `supabase/rollback/role-write-guards.sql`
  - `supabase/rollback/public-assets-admin-only.sql`

## Evidence
All tests ran on an isolated copy with production schema and roles, using synthetic businesses only. No production change was made during testing.

**Permission matrix: 19 cases.**
- Before: 11 cases failed.
- After: 19/19 passed.

**Now refused:**
- The cashier adding:
  - an approved sales entry;
  - an approved cash expense entry;
  - a sales row.
- Renaming loans or deleting branches, by cashier and by owner.
- Uploading to the public bucket, or replacing the shared logo, by cashiers of two businesses and by an accountant.

**Still allowed:**
- A cashier uploading a document row and a file to the cashier's own business folder.
- An accountant adding a manual entry, adding a sales row, or renaming a loan.
- The platform admin replacing or uploading the logo.
- The owner reading the ledger.

**Regression on the same database after the fix:**
- Hand-calculated accounting cases: 25/25.
- Cross-business isolation: 530 attempts with no leak.
- The only changes in that run are the expected new refusals for the public bucket.
- Document-lifecycle checks are unchanged, except that the cashier case is now refused.

**Rehearsal on today's restored production copy:**
- The storage part is refused for the release role.
- The migration applies.
- Exactly 6 policies change.
- Functions, columns, grants, triggers and row counts are unchanged.
- Rollback restores identical policies.
- Re-applying the migration gives the same result.

## Deployment (needs the owner's go-ahead)
1. Release tool, using the migration only:
   - read-only check that the six live policies equal the captured text;
   - fresh backup, then isolated restore and match;
   - migration in one transaction;
   - verification that the four policies equal the expected text and that nothing else in the catalog changed.
2. Storage part from the Supabase dashboard. Then verify the two policies.
3. Merge this PR. It contains only SQL and documentation files, so the deployed UI does not change.
