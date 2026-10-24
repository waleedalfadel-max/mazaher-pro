# Account dashboard and purchasing bank as custody

Draft implementation based on production `7d0b4e6`. Not deployed; no production queries, financial transactions, bank rename, or customer configuration writes were made during this implementation. All examples/tests use synthetic data.

## Result

For an explicitly enabled company, its existing purchasing bank becomes `حساب العهدة` with the same UUID, branch links and history. The bank remains a bank in the ledger; it is not converted into the employee-custody columns. The purchasing uploader suggestion uses that account; reviewer choices, credit invoices and existing paired-transfer approval remain authoritative.

The optional dashboard has three rows of three cards on phones: sales/expenses/net profit, other banks/cash/custody bank, app receivables/supplier payables/other liabilities. Net profit uses the existing financial engine (sales minus purchases and operating expenses, excluding VAT, without an inventory adjustment). The bank card excludes the separately displayed custody bank; the company bank total in the detailed report still includes it once. Restricted banks retain their signed book balance; this is not a new measure of cash available for withdrawal.

Cards link to their corresponding report or account statement. `/accounts` is accessible to the owner, accountant and platform admin inside the selected company. It supports account and date selection, search, opening/incoming/outgoing/closing balances, running balance, journal/actor/document, and Excel/PDF. Account balances use approved/auto entries only, including history before the selected start date. Search filters rows, never recalculates balances from the subset. All history is fetched in ordered pages before totals are displayed; a load error blocks partial totals. Archived accounts remain visible. Company-wide accounts keep their unbranched transfer legs even when a branch is selected in the balance report; the scope is explicitly stated and exported.

Historic employee custody is retained as a separately labelled history when nonzero. New payment and classification choices for the enabled company do not suggest it. An old document that still uses it is labelled explicitly rather than silently moving past money.

## Other liabilities: no fabricated debt or payment

The user confirmed that a documented aggregate exists but has not provided its amount/date/source. Until entered, remaining liability is **unknown**, not zero. The administration form accepts an optional documented nonnegative closing balance after the end of a specified day, its source, and an explicit statement that every subsequent incoming deposit in the selected liability bank automatically pays that liability without unrecorded deductions.

- Without that explicit confirmation, deposits are labelled as directed toward repayment and do not reduce the documented amount.
- With confirmation, remaining is the documented closing balance minus approved incoming deposits after that day, including the configured sales and app collections. This is a calculated view, not new payment, expense, sale or bank entries.
- Zero is explicit; negative/invalid amounts, excessive precision, invalid/future dates and missing source are rejected server-side.
- Deposits beyond the baseline are displayed separately for review, not as negative debt.
- The source must be updated for new obligations, fees or changes in the automatic sweep. This is not a bank or creditor integration and does not allocate repayments among individual creditors.

## Reading and review

The prompt now distinguishes quantity, unit price and the printed extended line total, including weighted goods. It asks for handwritten printed totals and uncertainty notes. A separately read printed line total replaces a mistakenly copied unit price **only when its inclusive/exclusive tax basis matches the invoice**. The initial amount is retained in `readingAmount`; missing printed totals are never manufactured from the discrepancy.

Long images are sized by their short edge and maximum long edge regardless of orientation. An image already within limits remains byte-for-byte unchanged; no automatic cropping is used. Upload and re-read both receive the company's settings, so the reader no longer calls the purchasing bank an employee custody or classifies its funding as employee-custody disbursement.

A discrepancy of at most two halalas can be corrected only by a reviewer selecting an existing line and entering a reason. That line and `roundingReview` are replaced atomically, survive the actual approval, and remain distinct from the original reading. No fictitious item is inserted and no server accounting validation is relaxed. Larger discrepancies retain ordinary correction/manual-review paths. Admin manual approval remains available.

**Unverified:** provider extraction accuracy on the user's real photographs. No production OCR request was sent. Local tests prove the downstream handling with synthetic readings, not that the AI will extract every real invoice perfectly.

## Database / permissions / activation

Migration: `supabase/migrations/20261024135418_account_dashboard.sql`.

It adds one RPC only: `admin_account_dashboard_save(jsonb,jsonb,text)`. Applying the migration does not activate any company or rename a bank. The RPC validates the live session and selected company, allows platform admins only, requires a reason, locks the settings, rejects stale versions and foreign/inactive/identical bank IDs, and validates liability values. It atomically renames the selected existing bank, updates only the purchasing uploader rule and the new settings key, and writes a server-attributed audit record. Other workflow rules, company data and all financial entries are preserved. PUBLIC/anon execution is revoked.

Activation after review and deployment:

1. Verify production/base and migration/rollback fingerprints. Take a new backup, restore it in isolation, and rehearse against that exact state.
2. Apply the additive database migration, then deploy the reviewed frontend. Verify compatibility and permissions before activation.
3. Inside the intended company only, open platform administration → bank accounts → account dashboard. Select the **existing** purchasing bank and liability-settlement bank by verified IDs, enter an audit reason, and enable. Do not create a new bank or opening entry. Existing bank-workflow version 1 is required.
4. Leave the liability baseline empty until the documented amount, date and source are provided. Do not assume an automatic repayment rule without the explicit confirmation described above.
5. Check read-only that the bank ID/history, uploader suggestion, dashboard, account statement and exports agree. Do not approve a real or synthetic customer transaction merely to verify deployment.

## Validation

- Build: passes; existing bundle-size warning remains.
- Public unit suite: **318 passed / 5 failed** (323 total). The five failures are the same missing private `local-test`/prototype harness files as earlier baseline runs. No expectation was weakened; the upload mock only gained the newly imported settings/types reader.
- New unit coverage: account statements/splits, approved status, supplier debt, liability checkpoint/sweep limits, credit-preserving suggestions, printed totals, explicit rounding, exports and orientation-independent image dimensions.
- Actual PostgreSQL functions in isolated PGlite synthetic fixture: **17/17** (`tests/account-dashboard-db.mjs`). Includes activation, scoped permissions, revoked session, stale settings, immutable ID/history, audit, transfer + purchase, idempotence, owner RLS, rollback/reapply without data loss. No PostgreSQL server or live backup rehearsal was performed in this environment.
- Real React screens with the same isolated database: **18/18** (`tests/browser/account-dashboard.mjs`). Includes actual configuration RPC, purchasing suggestion, typed rounding reason, single/multiple invoice approval and original-reading preservation, larger discrepancy/manual review, phone layout at 320/375/430 with bundled fonts, owner statement/search/date filtering, real Excel and PDF downloads, company-wide report scope, tenant isolation, legacy dashboard, and byte-for-byte image preservation.
- Existing bank-workflow screen regression: **19/19**. Covers cash/purchasing/owner, reviewer overrides and saved clearing, channel accounts, app collections, loan principal confirmation, internal transfers and editing, and admin workflow settings.
- Excel content checked: opening, outgoing, ending balance, journal and actor match the displayed synthetic statement. PDF generated successfully through the existing capture verification.

The first screen run caught missing `generatedAt` metadata in the new Excel model; it was fixed and the real downloads now pass. A later reports test adapter needed to handle the existing table-returning RPC; the production code did not change for that. The multi-invoice test's button/column identifiers were corrected to the actual UI/schema, without changing assertions.

The synthetic mobile preview was inspected locally. No image or customer document is included in the public review.

## Rollback

Restore the previous frontend first. `supabase/rollback/account-dashboard.sql` removes only the new admin RPC. It deliberately preserves account names/IDs, settings, audit records and all financial history. Previous uploader-bank suggestions remain compatible. This rollback is **not** an automatic rename back or deletion of the settings; such a request would need a separate audited, reviewed settings change. Never restore an old backup over newer customer transactions.

## Suggested independent review

Review same-ID activation, actual session/tenant isolation and audit, no bank/custody double counting, owner scope, company-level balances, history/export consistency, liability assumptions, multi-invoice correction atomicity and original-reading preservation. Rehearse on a fresh production backup before deployment and test real-image extraction separately without approving or saving a customer document. The implementation has not been deployed.
