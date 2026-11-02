# Reviewed POS output VAT

A POS report can contain sales whose printed VAT differs from the assumption that its entire gross total is taxable at 15%. Reviewers can now enter the report's net output VAT after returns. Approval allocates that exact amount across its payment channels using largest remainders. Input VAT remains separate.

`ledger_entries.output_vat_amount` is nullable. Existing rows remain NULL and retain the previous 15% estimate; explicit zero remains zero. Dashboard, reports, daily/branch figures, financial analysis and export use the same net-sales calculation. Channel allocations distribute the report tax proportionally; they do not establish channel-specific tax treatment.

Sales corrections append VAT deltas alongside gross deltas, including tax-only corrections with no balance movement. A report with reviewed VAT cannot be corrected by silently omitting that amount. The existing permissions, tenant, revision, request replay, bank-routing and channel checks remain in place. Legacy client approval refuses an entered VAT amount instead of silently discarding it.

This release adds a manual review field; it does not change OCR extraction or backfill historical reports. Cash/bank balance-start adjustments remain separate from revenue and tax.

Validation:

- 439 Node tests pass. Five existing prototype/local-test isolation tests fail because their fixture/config files are absent from the repository; the same five failures reproduce on the unchanged baseline.
- 13 isolated PostgreSQL checks: migration/rollback/reapply, private helper grants, legacy and printed/zero VAT, exact cent allocation, invalid-tax rejection, authorization/tenant/version guards, idempotent approval/correction, tax-only correction, subsequent amount correction with original bank routing, legacy-to-printed correction, and refusal of an unsafe rollback after use.
- Browser component check with synthetic data: printed 270 on gross 2300; zero stays zero; blank shows estimated 300; 301 shows a blocking validation message. Harness uses the current SalesReading and Num components and shared UI, without production connectivity.
- Production build succeeds.

Rollout: apply the additive migration first, verify existing ledger rows remain unchanged apart from the new NULL column, then deploy the UI. Function definitions were compared with live production before rollout. No new public RPC or privileges are added.

Rollback: `supabase/rollback/printed-sales-vat.sql` restores the prior functions and drops the column only if no explicit output VAT exists. Once used, retain the compatible financial readers; coordinate any rollback with review of affected records rather than silently reverting to estimates.
