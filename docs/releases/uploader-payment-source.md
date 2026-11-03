# Payment source per uploading user (Tashormik request, 2026-11-03)

## Request
Tashormik has two purchasing users who pay from different sources:
- one from the custody bank account;
- the other from the cash box.

Until now, the suggestion came from the uploader's **role** only (`bank_workflow.uploaders`), so both got the custody account.

At approval, the screen should show who uploaded the document and the suggested source, and the accountant must be able to change it.

## Change
**Settings:** a new key, `bank_workflow.uploader_users = { <app_user_id>: { source: 'cash' } | { source: 'bank', account_id } }`.
- A user rule takes precedence over the role rule.
- Users without a rule keep the role rule.

**Server:** `20261103120000_uploader_user_payment.sql` changes `admin_bank_workflow_save` only, so it accepts and validates the new key. Each entry must satisfy:
- the user is an **active** owner, purchasing or cashier user of the same business;
- the source is `bank` or `cash`;
- a bank source names an active account of that business;
- a cash source has no account;
- no extra fields.

The function still requires the platform admin, still uses optimistic locking, and still writes the action log with a reason. Approval is unchanged: the reviewed payload carries the source the accountant chose.

**Review screen** (`PendingDocuments.jsx`):
- `uploaderPaymentRule` (`src/lib/paymentWorkflow.js`) builds a line that is always visible, in both single-invoice and multi-invoice views: «رفعه: الاسم (الدور) · المصدر المقترح له: …».
- The suggestion note now names the uploader.
- The suggested source is pre-selected, and the accountant changes it from «مصدر الدفع» as before.
- Documents now load `created_by_user_id`, `created_by_name` and `uploaded_by_name`.

**Admin settings** (`BankWorkflowSettings.jsx`): one field per active uploading user, with «حسب الدور» as the default.

## Evidence
All tests used isolated copies and synthetic data.

| Test | Result | What it covers |
|---|---|---|
| Unit: `tests/uploader-user-payment.test.js` | 5/5 | User rule beats role rule. A user without a rule keeps the role rule. The review line text. The accountant's change is kept. Credit or payable invoices are not reassigned. |
| Existing payment-workflow unit tests | Pass | Full unit suite: 444/449, the same 5 pre-existing failures. |
| Database (`review_iso`, production schema) | 15/15 | Before the update the current validator refuses the new key. After it, these are refused with nothing saved: an unknown user, another business's user, an inactive user, an accountant, a bad source, a bank source without an account, an inactive account, a cash source with an account, extra fields. An accountant cannot save. The platform admin saves exactly what was sent, a stale expected value is refused, and the change is logged with its reason. |
| Click-through: `tests/browser/uploader-payment-source.mjs` | 6/6, three runs in a row | See the scenarios below. |
| `line-vat-review` | 8/8 | Unchanged. |
| `invoice-correction` | 7/7 | Unchanged. |
| `payment-workflow` (browser) | Same as live code | Its expected wording was updated: the note now names the uploader before the role. It reaches the same 16 checks as the live code and stops at the same pre-existing «مبلغ التحويل» step. It sometimes stops early at check 3 on both versions. |
| Build | Passes | |

Click-through scenarios:
- **Cash purchaser:** his name and «الصندوق» are shown and pre-selected, and approval records cash.
- **Custody purchaser:** his name and the custody account are shown and pre-selected. The accountant switches to cash, approval records cash, and the suggestion line stays visible.
- **Custody purchaser, accepted as suggested:** approval records the custody bank account.

**Rehearsal on a restored production copy:** `uploader-release-runner.mjs --rehearse` ran the exact production path.
1. Preflight: the validator, both users, the custody account, the platform admin and the current workflow all match what was captured.
2. Migration.
3. Only `admin_bank_workflow_save` changed, checked item by item in the app schemas.
4. The setting was saved through the admin function with a reason.
5. Verified: the rules are exactly as sent, the rest of the workflow is unchanged, and the change is logged.

Rollback on that copy restores the validator exactly. A saved `uploader_users` key stays in the settings and is ignored by older screens.

## Deployment (needs the owner's go-ahead)
1. Release tool in production (masked password window, mode `UploaderProd`):
   - preflight;
   - backup and isolated restore;
   - migration and verification;
   - save the setting (Murtada → custody bank account, Juma → cash) with the platform-admin identity and a reason, then verify it.
2. Merge this PR to publish the screens.

The new key is harmless for the live screens until then. The release tool refuses to run if production differs from what was captured.
