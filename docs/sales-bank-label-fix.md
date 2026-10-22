# POS Bank payment label — 2026-10-22

## Cause and scope

Production baseline: `aa7c6dd855461a0f5a7682e93555f68d26fc6632`, deployment
`dpl_DfRz4REw7qoTSEo1uZzYoMSSEJTn` (confirmed for the reported domain).
The payment-line classifier did not recognise `بنك - Bank`. The amount had been
read, but stayed in `unknownPayments`, outside the network total, so the existing
approval guards correctly refused an unexplained difference.

The only application change is in `src/lib/salesReport.js`. In a POS payment
summary, Bank/بنك is the network/card channel. An explicit Bank Transfer remains
transfer. Mixed cash/app labels, unknown qualifiers and conflicting card/transfer
labels still need review. Returns use the same channel recognition and are
deducted once. Printed totals, unknown-line checks, server approval, account
selection, manual approval and permissions are unchanged.

No database migration, tenant settings, reading prompt changes or OCR requests.
This branch starts from production and does not include PR #18 bank workflows.

## Existing documents

Previously saved readings are not rewritten by deployment. In the existing
unknown-payment row, select `شبكة / مدى` under `انسبها إلى`, then `تطبيق`, select
the appropriate account if requested, and review the zero difference before
approving. The existing path retains the original reading and records the mapping.
Do not just type the amount into network while leaving the unknown row unresolved.
No real document was approved or edited during this fix.

## Evidence

All fixtures use synthetic amounts and identities; no customer images or figures
are included. The new unit suite reproduced the old classifier fault before the
fix (five failing checks, one passing existing-document check).

- Focused unit suites: **59/59**, including six new Bank-label checks, existing
  sales/returns safeguards, approval payloads, manual review and bank-field rules.
- Actual review page in Chromium → isolated PostgreSQL functions: **5/5**.
  New reading posts cash/card correctly; old unresolved reading blocks until
  mapping; mapping is retained and original reading preserved; explicit transfer
  posts to its independently selected account; no browser errors.
- Production build: passed. Existing bundle-size/code-splitting warnings only.

Commands:

```sh
node --test tests/sales-bank-label.test.js tests/sales-report.test.js tests/approval-v2-client.test.js tests/manual-review.test.js tests/branch-setup-items.test.js tests/review-round3.test.js
npm run build
SALES_TEST_FIXTURE=/path/to/isolated/fixture.mjs CHROMIUM_EXECUTABLE_PATH=/path/to/chromium node tests/browser/sales-bank-label.mjs
```

The browser test requires an external synthetic fixture exporting `fixture` with
the current production SQL definitions (no workflow migration), `db`, `one`,
`claims`, `p1`, `admin`, `acc` and `owner`. Verification used PGlite and a mock
Supabase transport to that offline database, not hosted Supabase or real logins.
It does not claim new OCR accuracy, production transaction verification, native
Supabase concurrency testing or production RLS testing. No SQL was changed.

## Release

Draft only until deployment approval. Publish the frontend after reviewing the
pinned head. Verify the served version and the classifier; do not generate a
test financial transaction in production. Previously saved readings still use
the documented mapping action. Rollback is the previous frontend deployment;
no database rollback is needed.
