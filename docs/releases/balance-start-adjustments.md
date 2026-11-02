# Documented starting balances

When a business adopts an actual cash count or bank balance as its new operational starting point, the difference from the recorded balance must not change sales, costs, profit or VAT.

The exact ledger type `تسوية رصيد بداية المتابعة` is now excluded from operating results by the shared financial rules. Its signed cash or bank movement remains included in balances, statements and balance exports. A positive or negative adjustment is not a real deposit, withdrawal, loan, owner contribution or an inferred expense.

No new adjustment-entry screen, ordinary transaction choice, permission or tenant setting is added. Posting requires a separately authorized, documented maintenance operation. Do not invent a historical counterpart or imply the previous period is reconciled.

## Posting procedure

1. Record the owner's actual balances and capture time, target accounts and source, separately from the historical book balances.
2. Deploy the new classification before posting this type. Check the production version.
3. In one guarded transaction, calculate the adjustment as actual balance minus the complete approved/auto balance at the cutoff. Preserve every existing entry. Reject a changed ledger/settings snapshot and an already-used request reference.
4. Post one zero-VAT adjustment per account, with a clear description and unique reference; never label it as sales or an internal transfer. Keep other money, receivable and payable columns zero.
5. Keep target balances, previous balances, entry IDs, actor context and the user's authorization in the private maintenance log. Never commit customer figures or documents to this repository.
6. Verify the new balances and unchanged sales, costs, profit, VAT, suppliers, applications and other banks.

After posting, new movements continue normally. This is a dated adjustment, not a period lock: a later backdated entry or edit can still change the current balance. Documents whose cash/bank effect is already included in the adopted actual balance need review before posting, including documents from the same day. Historical reports remain historical and are not certified by the adjustment.

## Validation

The focused tests cover positive and negative adjustments, P&L/VAT neutrality, analysis and purchase-report neutrality, cards/statements/export consistency, preserved earlier periods, subsequent movements and unapproved-entry exclusion. All fixtures are synthetic.

## Rollback

Do not deploy a version without this classification while these entries remain counted: it could treat the incoming adjustment as a purchase return. Reverse an authorized data operation by its exact recorded entry IDs first, with a reason and unchanged-entry guards; then revert the code if necessary. Do not reset unrelated balances or delete operational history.
