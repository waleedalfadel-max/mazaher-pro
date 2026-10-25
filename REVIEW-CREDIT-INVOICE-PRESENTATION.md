# Credit invoice presentation

An approved credit purchase produces one ledger row per cost category. The compact business's ledger and operations history previously displayed each category as an unrelated operation, without showing the purchase amount or supplier liability. The stored total was not duplicated.

This frontend-only change groups approved/automatic credit-purchase rows by project, document, invoice, journal, date, status and supplier. It preserves every underlying row and amount. Different invoice IDs and cash/payment movements remain separate; equal rows are never silently deduplicated. A filtered category displays a clearly marked partial invoice. Other businesses retain their existing ledger presentation.

Each summary shows the gross purchase and explains that it adds supplier debt without cash outflow. Details show original cost categories, net amounts, allocated tax and gross amounts. Existing edit/delete actions still target individual original rows, never the summary total. Receivables headers distinguish amounts owed to the business from supplier liabilities. Daily operations PDF shows the credit purchase and explicitly separates cash movement totals.

## Validation

- 22 targeted unit checks passed, including exact cent sums, identity boundaries, partial filters, unchanged raw rows and excluded unapproved states.
- 18 Chromium/React scenarios passed against isolated PGlite 17 with a schema-only fixture and synthetic records. They cover owner/accountant presentation, category editing targets, desktop/mobile, daily PDF output, other-business presentation, split supplier approvals, account filters and dashboard balances. A whole-ledger fingerprint stayed identical across credit-presentation interactions.
- Daily PDF and mobile/desktop screenshots inspected visually.
- Full unit suite: 343 passed; five private-environment checks fail because their local-only files are absent. Those same five failures were reproduced on the production baseline, independently of this change.
- Production build and whitespace checks passed.

Browser reproduction requires PAYMENT_TEST_FIXTURE and an available Chromium executable. The fixture supplies actual database authorization/functions with synthetic users; browser transport is emulated and outbound traffic blocked. This is not a signed-in production test.

## Release

No database migration, approval change, OCR request, data repair or financial transaction. Deploy the frontend only. Roll back by restoring the preceding frontend deployment; no data restoration is needed. Customer evidence remains private and is not included in this repository.
