# Financial record navigation

Mazaher and Tashormik now have one navigation entry, السجل المالي, with two views: العمليات and كشف حساب. The established /operations and /accounts routes remain under the same role protection. Home balance cards and old statement links still open the selected account and dates. Returning from operations to the statement restores its account/date query. Other businesses retain their existing navigation.

This is a presentation change only. Account statements retain opening/running/closing balances and approved/auto filtering. Operations retain their existing status, attachment, deletion and export rules. The owner's operations view remains read-only; the separate accountant ledger permissions are unchanged. No database or financial-calculation changes.

Validation: production build and 16 existing account-statement, journal-loading and admin-access tests passed. Browser QA used the actual pages with synthetic data and external network access disabled: one mobile menu entry, switching views, 320px header without overflow, bank-card deep link, restored account and date parameters, active desktop navigation on both routes (including aria-current), accountant actions, no owner delete buttons, Tashormik views and unchanged other-business navigation. Rollback is a source revert; no data rollback is needed.
