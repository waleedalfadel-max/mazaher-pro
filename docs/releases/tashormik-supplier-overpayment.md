# Supplier receipt credit confirmation

Tashormik document approvals can now record a supplier payment above the outstanding balance after an explicit reviewer confirmation. The warning shows the supplier, current balance, payment, excess and resulting negative balance. Cancel returns to review without writing. Negative balances represent credit held with that supplier.

The server calculates the balance under the existing supplier row lock. Confirmation is separate from the OCR/invoice payload and binds document, invoice, supplier kind/ID, date, amount and exact balance. A changed balance requires another confirmation. Multiple receipts in one approval see sequential balances; a warning rolls the whole approval back. The final payment result stores the confirmation, resulting balance, actor and timestamp in the existing approved payload.

The new private 16-argument payment-core overload preserves the existing FIFO expense/settlement calculation. The excess is settlement/credit, not a new expense or VAT deduction. Split payments still create one supplier transaction and two bank legs. The original 15-argument function and standalone supplier-payment RPC retain their existing limit. Only projects whose persisted subdomain is `tashormik` get the document confirmation flow. Existing authentication, tenant checks, duplicate decisions, replay, deletion/reopen and grants remain in place. No existing business rows are updated by this migration.

Validation:

- 31 focused client tests passed (receipts, splits, approval client and account statements).
- All 25 existing split-payment integration checks also passed with the new migration installed.
- 18 integration checks passed in isolated PGlite/PostgreSQL with current production function/trigger definitions and synthetic rows: no writes before consent, ignored OCR consent, cash/credit accounting, replay, linking, deletion, fractional/zero/negative balances, two-bank payable settlement, stale consent, changed supplier/amount, unauthorized roles, other tenants, legacy expense allocation, multi-invoice atomicity, service-admin approval, rollback/reapply and private-function privileges.
- Real PendingDocuments UI with offline synthetic transport: warning, cancel with zero writes, changed-balance warning, one payment after confirmation, resulting negative balance; 320px notice fits without horizontal overflow. Production financial transactions were not exercised.
- Production build and whitespace check passed. Independent-connection concurrency was not exercised; existing row/advisory locks are preserved and balance checks remain inside the write transaction.

Deployment order: apply `20261102081501_tashormik_supplier_overpayment.sql`, then publish the UI. Pre-release live definitions must still match the captured rollback definitions. The migration adds one private function overload and replaces only the receipt planner/writer; it makes no table, data or public-RPC signature changes.

Rollback: publish the previous UI and apply `supabase/rollback/tashormik-supplier-overpayment.sql`. This restores the live pre-release planner/writer and removes the new overload. Already approved payments, negative balances and their audit trail remain intact.
