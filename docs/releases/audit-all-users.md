# Action log for every user (readiness review 2026-11-02: H2, part 1)

## What changes
Before this change, `admin_private.capture_action()` ran on 18 business tables but returned early unless the actor was the platform admin. As a result, an accountant's or cashier's edits and deletions, such as changing an approved entry's amount, deleting an entry, or changing a supplier's opening balance, left no record.

1. **The audit function** (`supabase/migrations/20261102170000_audit_all_users.sql`): one line changes.
   - It now logs any write made under a signed-in, active user's session. This covers direct table writes and server-function writes such as approvals.
   - Writes with no app user (service role, PIN-login bookkeeping) are still skipped.
   - Updates that change nothing, or only excluded fields, are still skipped.
2. **The log's role rule:** `action_log_actor_role_check` accepted only `superadmin`.
   - Without widening it, every business-user write would fail inside the trigger and be rejected. The first test run caught this before any deployment.
   - It now accepts the same roles as `app_users_role_check`.
3. **The history screen** (Tahseeb admin → business settings): it is renamed «سجل الإجراءات» and shows each actor's role.

Nobody gains access to the log:
- Only the platform admin reads it (`admin_action_history`).
- Business users cannot read, change or delete it.

## Not in this change: H2 part 2
Today the only way to correct a wrongly approved invoice is to edit or delete its ledger entry; there is no server reopen or reverse path. Blocking those direct edits first needs a «reverse document» action with a required reason. That is pending the owner's decision. Until then, every such edit or deletion is recorded with its before and after values.

## Evidence
Tests ran on an isolated copy with production schema and roles, using synthetic businesses only.

**Audit checks: 12/12 pass.** They show:
- An accountant's edit is logged with the old and new amount.
- A deletion is logged with the deleted row.
- A change to a supplier's opening balance is logged.
- A cashier's upload is logged.
- A server approval is logged under the accountant.
- A platform admin's edit is still logged.
- A write with no session is not logged.
- An update that changes nothing is not logged.
- An accountant cannot delete the log or open the history.
- The admin history shows the business users' actions.

Before the change, the first check already failed: nothing was logged.

**Regression with the change applied:**

| Check | Result |
|---|---|
| Hand-calculated accounting, on a clean database | 25/25 |
| Report export figures | Unchanged |
| Document lifecycle | Unchanged (the 3 known H2 part 2 cases remain) |
| Concurrency | Pass |
| Permission matrix | 19/19 |
| Cross-business isolation | 530 attempts, no leak |
| Unit tests | 431/436, the same 5 pre-existing failures |
| Build | Passes |

**Rehearsal on a restored production copy, brought to today's state:**
- Exactly two catalog items change: the function and the constraint.
- Row counts are unchanged.
- Rollback restores the function exactly. The constraint comes back `NOT VALID` so that log rows written meanwhile are kept.
- Re-applying the change gives an identical result.

## Deployment (needs the owner's go-ahead)
1. Release tool:
   - read-only check that the function and the constraint equal the captured text;
   - fresh backup, isolated restore and match;
   - migration in one transaction;
   - verification that both items equal the expected text and that nothing else in the catalog changed.
2. Merge this PR to publish the screen wording.
