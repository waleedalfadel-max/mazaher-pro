# Tatmira authenticated shared workspace

This is the isolated Tatmira preview served at the site root. It combines owner/employee accounts with a shared server-side financial workspace. It does not modify or replace the existing Tahseeb production application or its public financial tables.

## Implemented

- Owner signs in through Supabase Auth with email/password; the server verifies the JWT using `getUser` and independently checks the organization owner.
- Only the owner creates employees, chooses grants, replaces a PIN or disables an employee.
- Employee signs in with a six-digit PIN scoped to the organization's link. Arabic/Persian digits and leading zeros are supported.
- The database stores a keyed PIN lookup and bcrypt hash, never plaintext PINs. The response never includes either hash.
- Employee bearer tokens are random, stored hashed in the database, kept in the browser's session storage and expire after 12 hours. Every request rechecks the active employee and session version.
- PIN reset, permission change, disable and logout revoke existing employee sessions. Reactivation does not revive an old session.
- Database rate limits work across Edge instances: 30 failed attempts per tenant per five minutes, 100 per 24-hour window, plus a global request budget. Successful logins do not consume tenant failure budgets. These tenant-wide limits intentionally trade availability for protection against distributed PIN guessing; an attacker may temporarily deny PIN login. Owner email login remains available.
- Private tables have RLS enabled and no client policies. Only `service_role` can invoke the RPC. Edge verifies owner identity; custom employee sessions are verified by the database.
- Financial commands are authorized twice: in the Edge handler and again inside the service-only database RPC. Client-supplied actor IDs, roles, file paths, timestamps and calculated ledger state are never trusted.
- The shared ledger uses optimistic revisions and idempotent request receipts, so a retry cannot duplicate a saved sale, payment, expense or customer.
- Sales can upload sales invoices and collections; purchasing can upload expense documents; accounting can review and approve; report viewers receive approved financial summaries; only the owner can change tax and account settings.
- Uploaded PDF/JPG/PNG files live in a private five-megabyte Storage bucket. The browser receives no object path or signed URL; every download rechecks the active session and document visibility.
- Only approved documents affect sales, collections, customer balances, expenses or estimated profit.

## Files and deployment

1. Apply the four Tatmira migrations in order: `20260918114709_tatmira_accounts.sql`, `20260918115721_tatmira_owner_provisioning.sql`, `20260918150034_tatmira_shared_finance.sql`, then `20260919090000_tatmira_account_mutations.sql`. They create only isolated private Tatmira tables, service-only RPCs and the private Tatmira documents bucket. Existing public financial tables remain untouched.
2. Apply `20260919090000_tatmira_account_mutations.sql` before deploying either updated Edge Function. It adds version-checked, idempotent employee mutations without modifying the applied v1 migration.
3. Deploy `server/index.ts` and `server/handler.js` as the `tatmira-accounts` Supabase Edge Function. `verify_jwt=false` is required for PIN sign-in and custom tokens: the function implements its own authentication for every authenticated operation. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are Edge runtime secrets only.
4. Deploy `server/finance-index.ts`, `server/finance-handler.js`, `server/finance-model.js` and its explicitly imported calculation modules as the `tatmira-finance` Edge Function. It also uses `verify_jwt=false` because employee bearer tokens are custom credentials, and it authenticates every request itself.
5. `TATMIRA_ACCOUNT_ORIGINS` is a comma-separated exact-origin allowlist shared by both functions. It defaults only to `https://tatmira-preview.vercel.app`. CORS is not the authentication mechanism. Do not add wildcard origins.
6. Build the portal with the **public** environment values below. Never use a service-role or secret key in the frontend.

```text
TATMIRA_PUBLIC_SUPABASE_URL=<selected project API URL>
TATMIRA_PUBLIC_SUPABASE_KEY=<publishable key or legacy anon key>
TATMIRA_PUBLIC_TENANT=tatmira
```

```sh
npm ci
npm test
npm run build:tatmira-preview
npm run build
```

`build:tatmira-preview` produces `dist-tatmira-preview`: `/` is the authenticated integrated workspace, `/demo/` preserves the isolated offline prototype, and `/accounts/` is only a compatibility rewrite to the root app. Deploy this directory only to the separate `tatmira-preview` project, keep the noindex header, and do not deploy it to the live Tahseeb project.

## Owner setup

The owner must create/enter their password themselves in the selected project's Supabase Auth dashboard. Use the agreed email privately, confirm ownership, and do not send credentials through chat, SQL, source control or build logs. No shared/default password is included.

Once the confirmed Auth user exists, run `node tatmira-accounts/provision-owner.mjs` privately with these environment values:

```text
SUPABASE_URL=<project API URL>
SUPABASE_SERVICE_ROLE_KEY=<private admin key; never a frontend variable>
TATMIRA_OWNER_EMAIL=<confirmed owner email>
TATMIRA_SLUG=tatmira
TATMIRA_NAME=<organization display name>
```

The script checks Auth privately, then calls the service-only provisioning RPC. It will not create a password, change an existing user's password, transfer an existing organization or expose user records. Keep email/password login enabled. For future invite/recovery links, add the exact integrated root application URL to Auth's permitted redirects without changing the existing application's Site URL. Recovery UI exists, but no invite/recovery message has been sent or tested end to end.

## Verification record

- 114 Node tests pass, including account gateway, authorization matrix, complete sale/collection/expense cycle, conflict/idempotency behavior, private attachment handling and migration guard tests. Main app, demo and integrated preview builds pass.
- `acceptance.sql` tests actual SQL with generated disposable PINs/tokens and rolls back the entire fixture. It covers owner scope, employee escalation, cross-tenant reads/mutations, duplicate PIN, hash storage, login, reset/disable/reactivation, permission changes, logout and both tenant rate limits.
- This SQL suite passed in an isolated PGlite PostgreSQL database with pgcrypto and a minimal synthetic Auth schema. No real owner or production data was used. It is not a full Supabase Auth end-to-end test or a concurrent load test.
- Running this write-and-rollback fixture through the live SQL connector was rejected because that connector uses a read-only transaction; no live fixture was created.
- Supabase's RLS-without-policies notices for the private Tatmira tables are intentional: all browser access is denied; only the server role accesses them. See [Supabase's explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- Browser visual testing remains outstanding: the available remote browser could not reach the local dev server.

Before activation, test on the deployed root application: owner login; one sale upload; one collection; one expense upload; accountant review/approval; report totals; denied cross-role actions; then reset/disable one disposable employee and verify the next request is rejected. Never enter real credentials into automation logs.

## Preview limits

This remains a controlled preview, not the Tahseeb production cutover. Data entry and review are manual; OCR/AI extraction is not connected. Existing offline-demo data and current Tahseeb production data are not imported automatically. The shared ledger is intentionally isolated until the complete browser acceptance cycle is approved.
