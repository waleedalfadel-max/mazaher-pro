# Documented loan balances

A project's `settings.loan_balances` holds version 1 checkpoints with an `items` array. Each item has a stable loan key (`car`, `land`, `loan1`, `loan2`), display label, closing balance, effective date, counted `paid_at_baseline` total, reference and recording timestamp. Customer amounts are stored only in the target project's database settings.

Remaining principal = documented closing balance minus the change in approved/auto repayments since the captured paid total. The caller supplies the complete project history through the reporting date. Capturing the paid total and setting the checkpoint must use the same database snapshot. Prior repayments are already reflected in the supplied balance. New same-day approvals, backdated approvals and cancellations therefore reconcile without subtracting old repayments twice. New borrowing or off-ledger payments require a new documented checkpoint.

The display name can change without rewriting a historical ledger type or changing approval payloads, debt classification, profit, tax, or bank movements. The review selector displays the alias but sends the existing configured type. Earlier reporting dates remain unknown; missing or invalid checkpoints never silently become zero. Overpayment is flagged separately and cannot reduce another loan's liability. Unrecorded loans are excluded from the recorded total and marked as unrecorded.

The loan page retains the paid-only view for projects without checkpoints. Mazaher's home total adds documented loan principal to supplier dues and any separately documented obligation. Existing permissions are unchanged; owners can see the home breakdown but the detailed loan-page link remains limited to accountant/superadmin. No schema, RLS, authentication or ledger changes are required.

Validation: 30 focused Node tests passed (`loan-balances`, `loan-repayment`, `recorded-liabilities`, `account-statement`), production build passed. The real Dashboard, Loans and repayment selector were exercised with synthetic data and network connections disabled. Verified home total and breakdown, loan balances, alias with unchanged selector value, 320px/375px layouts, owner link restriction, settings-load failure, and unchanged Tashormik/other home layouts. No real repayment was posted during QA.

Rollback: revert this source change to restore the prior screens. The newly introduced `loan_balances` key can be removed from only the intended project's settings after verifying it has not subsequently changed; preserve every other settings key and all ledger rows.
