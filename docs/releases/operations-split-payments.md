# Compact home, operations history and optional supplier payment split

The compact business dashboard hides the remaining expense/weekly charts, places pending review at the top, and adds gross sales and booked operational liquidity in a two-card row. Liquidity includes negative operating balances and the purchasing bank once; restricted/inactive/unassigned banks are excluded. It is not a live-bank balance. Other businesses retain their dashboard/navigation.

The compact business uses one operations page instead of journal/archive navigation. Existing routes remain valid. The page supports account/type/date/search filters, daily PDF and attachments. Owners can read/export; accounting edits retain server authorization. Cash/account filters isolate that account's side even on a mixed transfer row.

Supplier receipt approvals default to one account. Reviewers can explicitly enable two distinct bank accounts, with positive cent amounts summing exactly to the receipt. The backend retains one supplier payment and journal, with two bank ledger legs. Existing supplier balance, FIFO settlement/expense allocation, locks, request replay and deletion/reopening remain authoritative. Linking checks the entire payment, not one leg. Deleting either displayed payment row reverses the whole payment and reopens its receipts with the confirmed split.

## Validation

- 73 targeted unit checks pass (approval helpers, drafts, suppliers, account statements, journals and financial rules).
- 25 isolated PostgreSQL checks pass: totals, both supplier types, retries, linking, invalid accounts/amounts, tenant/role/session checks, direct-edit guards, full delete/reopen, rollback/reapply. A forced failure on the second ledger leg rolls back the first leg and payment header. Legacy mixed debt preserves settlement and expense totals.
- 9 Chromium/React screen scenarios pass against that isolated PostgreSQL: 320/375 mobile layout, navigation scope, owner filters/daily PDF, default/split toggling, validation, actual approval, downstream cards and account filtering.
- Production build passes.

The isolated PostgreSQL engine is PGlite 17, loaded with a private schema-only snapshot of current functions/triggers/policies and synthetic records. Auth/session fixtures emulate JWT/session claims. No production transactions, real receipt reading or independent-connection concurrency test was performed in this change; existing supplier locking is retained. Database/browser scripts require the private PAYMENT_TEST_FIXTURE fixture; it contains no customer records. Unit tests need no private fixture.

## Release and rollback

Deploy the database before the frontend. The migration changes three existing functions, adds one private validator and one private aggregate view, and does not update existing records. A guarded release checks baseline function fingerprints, unchanged table data and unchanged existing function permissions within the same transaction. Keep the prior frontend deployment and original function definitions.

Rollback the frontend first, then run supabase/rollback/supplier-payment-splits.sql. It disables new split approvals and restores the old writer, but intentionally retains aggregate readers so already-recorded splits remain correctly readable, linkable and deletable. It deletes no data. Reapplication is tested. Old single-account approvals continue to work during deployment.
