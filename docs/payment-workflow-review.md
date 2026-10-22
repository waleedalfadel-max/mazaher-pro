# Bank workflows and uploader payment suggestions

Base: `restaurants/production` at `f61357ee6f224aa9290728a2947d53b9175c5e6b`.
This branch has not been deployed. It contains no customer configuration, credentials, backups or financial examples taken from production.

## Behavior

- A platform administrator configures `settings.bank_workflow` for the selected business. There are separate defaults for owner, purchasing and cashier uploads, independent network-sales and customer-transfer accounts per branch, app-remittance receipts, account purposes, usual transfer destinations and operating availability.
- The review page derives its initial proposal from the document's server-recorded uploader role, not the reviewer. The accountant or platform administrator can change it before approval. Loan principal repayments also receive outgoing suggestions when the account is eligible, without supplying the required principal confirmation. Credit purchases, linking an existing supplier payment and internal transfers do not inherit an outgoing-payment suggestion.
- Proposals are applied only after accounts/settings and invoice IDs have loaded. Existing saved review drafts and reopened confirmed invoices keep their choices. Changing a payment choice saves the current review in the existing user/business/document-scoped **sessionStorage draft**. This survives reload in the same tab; it is not cross-device storage. Re-reading invalidates a stale draft. Original OCR data is not rewritten by a suggestion.
- Network and customer-transfer sales each have their own optional branch default (`network_by_branch` / `transfer_by_branch`), preserving the existing per-channel account handling. Saved explicit choices are never replaced. Older settings without `transfer_by_branch` remain valid. Only known delivery-app receivable collections use the company-level remittance account across branches when this setting is enabled. They settle receivables; they do not create another sale.
- Dashboard, balance report and exports separate positive operating bank balances from restricted/inactive accounts. Signed accounting balances remain unchanged. This is a booked-balance presentation, not a bank-verified withdrawable balance. No deposit automatically becomes a tax/debt settlement.
- An internal bank transfer selected in document review creates two linked ledger legs in the existing approval transaction. It debits one bank, credits the other, uses one journal, retains the real actor, and is excluded by existing revenue/expense classification. Replaying the approval request does not create another pair.
- Ledger edit/delete opens a paired-transfer dialog. Amount, date and accounts change together, with a required reason and an optimistic version check. Delete removes both legs and reopens the document with confirmed values, preserving original OCR separately. A deferred database guard rejects unilateral edits/deletions, including direct requests. It also compares both ledger legs with the private approval record, so balanced direct edits cannot bypass the reason/actor/history path.

## Database changes

Migration: `supabase/migrations/20261021045837_payment_account_workflows.sql`.

- New public RPCs: `admin_bank_workflow_save`, `bank_transfer_manage`.
- New private table/guard: `approval_private.bank_transfers`, `check_bank_transfer_pair`, ledger constraint trigger.
- Existing function changes: `approval_private.plan_invoice`, `approval_private.write_invoice`, `admin_private.capture_action`.
- Public RPCs check the current server-validated session and selected business. Configuration writes are platform-admin-only, validate bank IDs against the same business and reject stale settings. Transfer management is available to the existing accountant/platform-admin approvers. Anonymous execution and direct access to private data are revoked.
- No business setting or existing financial row is modified by applying the migration. Tenant activation is a separate reviewed action using existing account IDs.

## Validation performed

Synthetic data only:

- New pure tests: 15/15. Uploader defaults, preserved/cleared choices, per-invoice independence, excluded document kinds, branch defaults, app collection, restricted/negative/unassigned balances, payload and audit fields, report/export consistency.
- Focused existing/new unit suites: 89 checks (payment workflows, approval payloads, branch setup, review drafts, manual review, receipts and exports).
- Database: 34/34 against isolated PGlite PostgreSQL using current schema/function definitions and synthetic users with sessions. Covers unauthorized/revoked access, foreign accounts, stale writes, audit actor, actual approval/retry, balanced ledger legs, direct-leg rejection, pair edit/delete/reopen, app receivables, rollback/reapply and retained integrity protection.
- Browser: 19/19 on the actual review/settings/transfer-management components connected to the same isolated PostgreSQL functions. Includes owner/purchasing/cashier proposals, reload after change/clear, actual approval to the visible account, both transfer legs, paired editing and settings saving, independent network/transfer bank proposals reaching actual ledger rows, and loan proposals with a fresh principal-only confirmation. External network requests are blocked.
- The full loan-review browser suite also passes 18/18 on the combined code and migrated synthetic database, including forged-reading confirmation, drafts, manual approval and retries.
- Existing Bank-label sales browser regression: 5/5 on the combined code and migrated synthetic database.
- Production build passed.
- Full unit run has five known failures because `prototype/`, `vite.prototype.config.js` and `local-test/` helper files are absent from the public repository. Those tests/paths were not changed. These failures are not reported as passing.

## Limits and deployment gates

- This is not a fresh production backup/restore rehearsal. The isolated fixture uses schema metadata, synthetic records and Supabase-compatible claims. It omits the external maintenance fence and does not prove concurrent multi-connection behavior on the deployed Supabase runtime.
- Before deployment, rehearse migration/rollback on a fresh verified isolated backup using the established deployment runner, including two-session approval/edit/delete races. Pin the reviewed SQL/UI fingerprints, stop at first failure, update database before interface, then activate the selected business's settings.
- Real OCR, real customer approvals and live bank balances were not tested or changed. A bank statement's confirmed opening amount and date are still required to establish a missing negative bank opening balance; this release deliberately does not guess one.
- Account purposes are informational. Operating availability affects presentation, not the administrator's authority to choose an account. No daily transfer or debt repayment is scheduled or automatically recorded.

## Rollback

Restore the previous UI first, then use `supabase/rollback/payment-account-workflows.sql`.
The rollback restores the prior planning/writing/audit functions and removes the new configuration-save RPC. It retains configuration, financial rows, transfer links, the pair integrity guard and the protected management RPC. These are intentionally retained after use so the previous UI cannot damage one side of an existing transfer. Reapply this release to manage those transfers through its UI. Rollback/reapply was tested after use without losing rows.

## Reproduction

`node --test tests/payment-workflow.test.js tests/branch-setup-items.test.js tests/approval-v2-client.test.js tests/review-draft.test.js tests/supplier-receipts.test.js tests/manual-review.test.js tests/report-export.test.js tests/loan-repayment.test.js tests/sales-bank-label.test.js`

`PAYMENT_TEST_FIXTURE=/absolute/path/to/isolated/fixture.mjs node tests/payment-workflow-db.mjs`

`PAYMENT_TEST_FIXTURE=/absolute/path/to/isolated/fixture.mjs CHROMIUM_EXECUTABLE_PATH=/path/to/chromium node tests/browser/payment-workflow.mjs`

The database fixture contract is documented in the test sources. It must contain synthetic data and must never target production. Browser-specific launch arguments may be supplied as a JSON array in `CHROMIUM_ARGS`.

## Integration review — 22 October 2026

- Merged the reviewed production release (loan principal confirmation and Bank-label recognition); neither fix is removed or weakened.
- Read-only comparison of the three replaced function definitions against current production matches the isolated fixture baseline and the rollback definitions. This checks function provenance only; it is **not** a new backup or restore rehearsal.
- The new transfer-channel map is optional for backward compatibility. Its save RPC rejects foreign accounts, inactive accounts, non-member branches, unknown branches and malformed maps, just like the network-channel map.
- Tenant activation must use the existing bank-account IDs. A receiving account must be linked to a sales branch before configuring it for that branch's transfer channel. Expand the intended branch association only; do not replace accounts or rewrite historical entries.
- Configure restricted/obligation accounts as not operating-available. Preserve existing signed ledger balances. Do not insert any opening amount without the bank statement amount and date, and do not infer debt/tax settlements from deposits.
- Before merge/deploy: independent review, native two-connection race checks, fresh backup/verified restore, pinned migration rehearsal, then database → frontend → specific tenant settings. The migration itself still changes no tenant setting or existing financial row.

Pinned SQL SHA-256: `e6653d53026dc54ef1860a224fe3ec7eb1a2b510ce602b95a20b2968515c1fa2`.
Rollback SHA-256 (unchanged): `cdcd054861fae6c2760b5713c3cae701005016741a0c9db879d9557e92237077`.


## Independent-review response — 22 October 2026

### Blocking source-field regression: fixed

- Restore the payment-source selector for app collections in both single- and multi-invoice forms, including businesses without `bank_workflow`. Existing source selection remains available; opted-in businesses retain the proposed bank/account and the reviewer can change the account.
- A pre-classified bank-to-bank transfer derives `paySource: bank` from its type on review loading, saved-choice restoration and payload preparation. No hidden cash/custody/default account can override its two visible bank accounts. This normalization is independent of tenant activation and preserves the original reading.
- The new browser tests fail on the submitted `2f1cf0a` tree: the app collection cannot find its required selector, and the pre-classified transfer returns `pay_required`. On the fix they approve to the selected bank(s). Tests include workflow on/off, explicit draft save where autosave is not enabled, reload, and individual/remaining-batch approval for both kinds in multi-invoice images.

### Balanced edits without approval history: fixed

- Balance is necessary but insufficient. At transaction completion the pair must also agree with the private approved invoice: tenant/document, approved status/kind, journal, amount/date, source/destination accounts and description.
- Public ledger edits cannot rewrite that private record. The existing management RPC changes the two legs and private record atomically and retains its mandatory reason, server-derived actor and timestamp.
- Tests attempt balanced direct amount, date, description, journal and account changes as both accountant and platform admin. The old tree allows the first attempt; the fix rejects them and leaves both original rows intact. Authorized paired editing, reason/history, delete/reopen, rollback after use and reapply pass. The rollback retains this guard as designed.
- The isolated fixture initially lacked existing authenticated helper grants and stopped before the guard. Its grants were corrected to match read-only production metadata; this was a fixture correction, not a new production grant. The final database result is 34/34.

### Business decisions unchanged

- Operating availability still explicitly means the sum of **positive** eligible booked bank balances, not net operating balances. Negative balances are separately disclosed and restricted-account balances retain their signs. No netting policy was silently changed in this review response; the owner's decision on whether to add a separate net figure remains open.
- Opted-in app remittances remain company-wide, without branch attribution. Company totals are correct; there is no claim that a branch report shows its own collection. Splitting a mixed-app remittance across branches requires source evidence and is outside this fix.
- A fresh read-only check confirmed four active existing accounts. The network-bank branch associations already exist. The intended main receiving bank still needs the additional sales-branch association at activation; no existing account was replaced and no setting was activated.

### Verification scope

- Current round: 89 focused unit checks, 34 isolated database checks including rollback/reapply, 19 browser workflow checks, production build and diff checks.
- The independent reviewer reported 28 database checks, 7 native two-connection races, 302 unit checks and the related regressions on **2f1cf0a**. These are attributed reviewer results, not reruns of the new guard.
- Because this response strengthens a database guard, independent re-verification should include balanced direct-write rejection and the existing transfer concurrency/rollback checks, in addition to the two UI regressions. A fresh verified-backup deployment rehearsal is still required. Nothing has been deployed or activated.
