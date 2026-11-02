# Correcting an approved invoice (readiness review 2026-11-02: H2, part 2)

## Before
The only way to fix a wrongly approved invoice was to edit or delete its ledger entry from the ledger screens.

The document then stayed «approved», while its items and supplier invoice stayed as they were. Nothing tied the change back to the document. The cycle test proved this: an accountant changed an approved entry from 230 to 999, and the items still said 230.

## After
**«تصحيح الفاتورة»** replaces delete or edit for document entries in the operations ledger (`JournalLedger`) and the ledger page (`Ledger`), including the credit-invoice details.

The button opens `/correct/:doc/:invoice` (`CorrectInvoice.jsx`). That page shows the approved invoice in the same review editor (`InvoiceSubPanel`, now exported). It requires a reason, then calls `approval_correct_invoice`.

The server runs one transaction, `supabase/migrations/20261103090000_invoice_correction.sql`:
1. It snapshots everything the invoice wrote: ledger entries, items, the supplier invoice and the approved payload.
2. It removes those rows and the bank-transfer pair, if any.
3. It plans the corrected payload with the same checks as approval: duplicates, categories, bank accounts, line VAT, supplier.
4. It writes the corrected payload with the same writer.
5. It keeps the original journal number when the year is unchanged. The number taken for the rewrite is released under the counter's row lock, so there is no gap.
6. It stores the reason, the actor and the previous rows in the invoice history. The action log also records each row change.

If anything fails, the approved invoice stays exactly as it was. Replaying the same request returns the same result.

**Supported:** expense, credit and transfer invoices, including loans and owner withdrawals.

**Not handled here** (the server refuses them with a message):
- Sales reports keep their own correction.
- Supplier receipts keep supplier-payment deletion.

**Lock** (`document_rows_guard`): the client role can no longer update or delete:
- ledger entries and items written by an approval (`document_invoice_id` set);
- supplier transactions written from a document.

Server functions run as their owner and are not affected. Manual and legacy entries stay editable.

## Evidence
All tests used isolated copies with production schema and roles, and synthetic businesses only.

**Server: 31/31.** Covered:
- The correction prepare step opens the approved payload.
- A correction keeps the journal number and replaces the rows with the corrected amount and category.
- The items and the invoice record are rewritten.
- The history keeps the reason, the actor and the previous rows. The action log has the deletes and inserts.
- The next approval takes the very next number.
- These are refused with nothing changed: no reason, a stale version, invalid amounts, and a duplicate invoice number.
- Replaying a request writes nothing more.
- A credit correction rewrites the supplier invoice and the balance follows it.
- A cash invoice can become credit.
- A bank-transfer correction updates both legs.
- A sales report is refused.
- Cashiers, owners and other businesses are refused.
- Of two simultaneous corrections, exactly one wins and the other is stale.
- Direct edit or delete of document entries, items and supplier invoice rows is refused with the message. Manual entries stay editable.
- Maintenance without an app session is not blocked.
- Supplier payment record and delete still work.
- Changing the year gives a new journal number in that year.

**Click-through on the real pages: 7/7** (`tests/browser/invoice-correction.mjs`).
- The ledger shows «تصحيح الفاتورة» and no delete for document entries; manual entries keep delete.
- The page opens the approved invoice.
- A missing reason is refused on the screen.
- A duplicate number is refused with nothing changed.
- The corrected category is saved as food/COGS under the same number, the next approval takes the next number, and the history keeps the reason and the previous category.
- Direct deletion is refused by the database.
- There are no browser errors.

**Regression with the change applied:**

| Check | Result |
|---|---|
| Hand-calculated accounting | 25/25 |
| Report export figures | Unchanged |
| Action log | 12/12 |
| Permission matrix | 19/19 |
| Cross-business isolation | 530 attempts, no leak |
| Sales channels case | Unchanged |
| `line-vat-review` | 8/8 |
| Unit tests | 431/436, the same 5 pre-existing failures |
| Build | Passes |

The document-lifecycle checks for direct edit or delete of approved entries now refuse those edits, which is the intended result.

`credit-invoice-summary` and `operations-split-payments` stop at the same early step on the unchanged live code and with this change. They look for the old «سجل العمليات» link and heading. They are stale against the current navigation and do not reach the changed screens.

**Rehearsal on a restored production copy, brought to today's state:**
- Exactly 3 functions and 3 triggers are added.
- Rows are unchanged.
- Rollback restores the production catalog exactly.
- Re-applying the change gives an identical result.
- The release tool's own queries and checks were dry-run on that copy and all pass.

## Deployment (needs the owner's go-ahead)
1. Release tool:
   - read-only check that production is at the post-action-log state, with no correction objects yet;
   - fresh backup, isolated restore and match;
   - migration in one transaction;
   - verification that only the 3 functions and 3 triggers were added, checked item by item in the app schemas.
2. Merge this PR to publish the screens.

The database part must go first. Otherwise the new button would call a function that does not exist yet. The old screens keep working with the database part alone, except that direct edits of document entries are refused with the message.

Rollback: publish the previous UI, then apply `supabase/rollback/invoice-correction.sql`.
