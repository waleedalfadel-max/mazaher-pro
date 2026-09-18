# Tatmira accounts foundation

This is a separate accounts portal at `/accounts/`, **not a production financial application**. The existing offline prototype, its role simulation, local documents and reports remain unchanged. The account portal explicitly tells users that financial workflows are not connected yet. Do not put a login wrapper around the local demo and call it secure.

## Implemented

- Owner signs in through Supabase Auth with email/password; the server verifies the JWT using `getUser` and independently checks the organization owner.
- Only the owner creates employees, chooses grants, replaces a PIN or disables an employee.
- Employee signs in with a six-digit PIN scoped to the organization's link. Arabic/Persian digits and leading zeros are supported.
- The database stores a keyed PIN lookup and bcrypt hash, never plaintext PINs. The response never includes either hash.
- Employee bearer tokens are random, stored hashed in the database, kept in the browser's session storage and expire after 12 hours. Every request rechecks the active employee and session version.
- PIN reset, permission change, disable and logout revoke existing employee sessions. Reactivation does not revive an old session.
- Database rate limits work across Edge instances: 30 failed attempts per tenant per five minutes, 100 per 24-hour window, plus a global request budget. Successful logins do not consume tenant failure budgets. These tenant-wide limits intentionally trade availability for protection against distributed PIN guessing; an attacker may temporarily deny PIN login. Owner email login remains available.
- Private tables have RLS enabled and no client policies. Only `service_role` can invoke the RPC. Edge verifies owner identity; custom employee sessions are verified by the database.

## Files and deployment

1. Apply `supabase/migrations/20260918114709_tatmira_accounts.sql` and the subsequent `tatmira_owner_provisioning` migration once. They create only the `tatmira_private` schema and two service-only public RPCs. It does not modify existing account or financial tables, functions or Storage policies.
2. Deploy `server/index.ts` and `server/handler.js` as the `tatmira-accounts` Supabase Edge Function. `verify_jwt=false` is required for PIN sign-in and custom tokens: the function implements its own authentication for every authenticated operation. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are Edge runtime secrets only.
3. `TATMIRA_ACCOUNT_ORIGINS` is a comma-separated exact-origin allowlist. It defaults only to `https://tatmira-preview.vercel.app`. CORS is not the authentication mechanism. Do not add wildcard origins.
4. Build the portal with the **public** environment values below. Never use a service-role or secret key in the frontend.

```text
TATMIRA_PUBLIC_SUPABASE_URL=<selected project API URL>
TATMIRA_PUBLIC_SUPABASE_KEY=<publishable key or legacy anon key>
TATMIRA_PUBLIC_TENANT=tatmira
```

```sh
npm ci
npm run build:tatmira
npm test
npm run build:tatmira-accounts
npm run build
```

`build:tatmira-accounts` outputs `dist-tatmira-accounts`, with an `/accounts/` asset base. To preserve the existing demo, copy this directory's contents into `dist-tatmira/accounts/` **after** building the demo, then deploy that static directory only to the separate Tatmira preview project. Keep the deployment's noindex header. Do not deploy this output to the live Tahseeb project. No GitHub merge or production deployment is needed for this preview.

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

The script checks Auth privately, then calls the service-only provisioning RPC. It will not create a password, change an existing user's password, transfer an existing organization or expose user records. Keep email/password login enabled. For future invite/recovery links, add the exact accounts page to Auth's permitted redirects without changing the existing application's Site URL. Recovery UI exists, but no invite/recovery message has been sent or tested end to end.

## Verification record

- 94 Node tests passed, including 8 new HTTP handler tests. Main app, demo and accounts builds pass.
- `acceptance.sql` tests actual SQL with generated disposable PINs/tokens and rolls back the entire fixture. It covers owner scope, employee escalation, cross-tenant reads/mutations, duplicate PIN, hash storage, login, reset/disable/reactivation, permission changes, logout and both tenant rate limits.
- This SQL suite passed in an isolated PGlite PostgreSQL database with pgcrypto and a minimal synthetic Auth schema. No real owner or production data was used. It is not a full Supabase Auth end-to-end test or a concurrent load test.
- Running this write-and-rollback fixture through the live SQL connector was rejected because that connector uses a read-only transaction; no live fixture was created.
- Supabase's RLS-without-policies notices for the five private tables are intentional: all browser access is denied; only the server role accesses them. See [Supabase's explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- Browser visual testing remains outstanding: the available remote browser could not reach the local dev server.

Before activation, test on the deployed accounts page: owner login, add one disposable employee, PIN login, denied administration, then reset/disable from the owner and verify the employee's next API request is rejected. Never test by entering real credentials into automation logs.

## Remaining financial integration

The grants are stored and enforced for **account administration only** at this stage. Document upload, review, reports and customer permissions require their own server endpoints and shared storage; no financial operation is exposed by this Edge Function. The existing offline demo cannot supply this protection. Connect and test those operations before inviting staff to do real work. Tax settings must remain owner-only when moved to the server. No offline demo data is automatically imported.
