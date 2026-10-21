# Bank workflows and uploader payment suggestions

Base: `restaurants/production` at `aa7c6dd855461a0f5a7682e93555f68d26fc6632`.
This branch has not been deployed. It contains no customer configuration, credentials, backups or financial examples taken from production.

## Behavior

- A platform administrator configures `settings.bank_workflow` for the selected business. There are separate defaults for owner, purchasing and cashier uploads, branch network-sales accounts, app-remittance receipts, account purposes, usual transfer destinations and operating availability.
- The review page derives its initial proposal from the document's server-recorded uploader role, not the reviewer. The accountant or platform administrator can change it before approval. Credit purchases, linking an existing supplier payment and internal transfers do not inherit an outgoing-payment suggestion.
- Proposals are applied only after accounts/settings and invoice IDs have loaded. Existing saved review drafts and reopened confirmed invoices keep their choices. Changing a payment choice saves the current review in the existing user/business/document-scoped **sessionStorage draft**. This survives reload in the same tab; it is not cross-device storage. Re-reading invalidates a stale draft. Original OCR data is not rewritten by a suggestion.
- Network sales keep the existing per-channel account handling. Only known delivery-app receivable collections use the company-level remittance account across branches when this setting is enabled. They settle receivables; they do not create another sale.
- Dashboard, balance report and exports separate positive operating bank balances from restricted/inactive accounts. Signed accounting balances remain unchanged. This is a booked-balance presentation, not a bank-verified withdrawable balance. No deposit automatically becomes a tax/debt settlement.
- An internal bank transfer selected in document review creates two linked ledger legs in the existing approval transaction. It debits one bank, credits the other, uses one journal, retains the real actor, and is excluded by existing revenue/expense classification. Replaying the approval request does not create another pair.
- Ledger edit/delete opens a paired-transfer dialog. Amount, date and accounts change together, with a required reason and an optimistic version check. Delete removes both legs and reopens the document with confirmed values, preserving original OCR separately. A deferred database guard rejects unilateral edits/deletions, including direct requests.

## Database changes

Migration: `supabase/migrations/20261021045837_payment_account_workflows.sql`.

- New public RPCs: `admin_bank_workflow_save`, `bank_transfer_manage`.
- New private table/guard: `approval_private.bank_transfers`, `check_bank_transfer_pair`, ledger constraint trigger.
- Existing function changes: `approval_private.plan_invoice`, `approval_private.write_invoice`, `admin_private.capture_action`.
- Public RPCs check the current server-validated session and selected business. Configuration writes are platform-admin-only, validate bank IDs against the same business and reject stale settings. Transfer management is available to the existing accountant/platform-admin approvers. Anonymous execution and direct access to private data are revoked.
- No business setting or existing financial row is modified by applying the migration. Tenant activation is a separate reviewed action using existing account IDs.

## Validation performed

Synthetic data only:

- New pure tests: 11/11. Uploader defaults, preserved/cleared choices, per-invoice independence, excluded document kinds, branch defaults, app collection, restricted/negative/unassigned balances, payload and audit fields, report/export consistency.
- Focused existing/new unit suites: 67 checks (payment workflows, approval payloads, branch setup, review drafts, manual review, receipts and exports).
- Database: 26/26 against isolated PGlite PostgreSQL using current schema/function definitions and synthetic users with sessions. Covers unauthorized/revoked access, foreign accounts, stale writes, audit actor, actual approval/retry, balanced ledger legs, direct-leg rejection, pair edit/delete/reopen, app receivables, rollback/reapply and retained integrity protection.
- Browser: 10/10 on the actual review/settings/transfer-management components connected to the same isolated PostgreSQL functions. Includes owner/purchasing/cashier proposals, reload after change/clear, actual approval to the visible account, both transfer legs, paired editing and settings saving. External network requests are blocked.
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

`node --test tests/payment-workflow.test.js tests/branch-setup-items.test.js tests/approval-v2-client.test.js tests/review-draft.test.js tests/supplier-receipts.test.js tests/manual-review.test.js tests/report-export.test.js`

`PAYMENT_TEST_FIXTURE=/absolute/path/to/isolated/fixture.mjs node tests/payment-workflow-db.mjs`

`PAYMENT_TEST_FIXTURE=/absolute/path/to/isolated/fixture.mjs CHROMIUM_EXECUTABLE_PATH=/path/to/chromium node tests/browser/payment-workflow.mjs`

The database fixture contract is documented in the test sources. It must contain synthetic data and must never target production. Browser-specific launch arguments may be supplied as a JSON array in `CHROMIUM_ARGS`.
