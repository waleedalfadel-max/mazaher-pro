import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createHandler,
  normalizePin,
} from "../tatmira-accounts/server/handler.js";
const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
function setup({
  user = { id: "verified-owner" },
  authError = null,
  rpcResult = { actor: { role: "owner" } },
} = {}) {
  const calls = [];
  const admin = {
    auth: {
      getUser: async (token) => {
        calls.push({ auth: token });
        return { data: { user }, error: authError };
      },
    },
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: rpcResult, error: null };
    },
  };
  const handle = createHandler({
    admin,
    allowedOrigins: ["https://accounts.example.test"],
  });
  const request = (body, token, origin = "https://accounts.example.test") =>
    handle(
      new Request("https://functions.example.test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(origin ? { origin } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  return { calls, request, handle };
}
test("owner-only mutations require a verified session; caller identity is discarded", async () => {
  const s = setup();
  assert.equal(
    (await s.request({ action: "employees", tenant: "tatmira" })).status,
    401,
  );
  assert.equal(s.calls.length, 0);
  const res = await s.request(
    {
      action: "save_employee",
      tenant: "tatmira",
      ownerId: "forged",
      role: "owner",
      name: "موظف",
      grants: ["upload_expense"],
      pin: "١٢٣٤٥٦",
      requestId: REQUEST_ID,
    },
    "signed-token",
  );
  assert.equal(res.status, 200);
  const args = s.calls[1].args;
  assert.equal(s.calls[1].name, "tatmira_accounts_mutate");
  assert.equal(args.p_owner, "verified-owner");
  assert.equal(args.p_request_id, REQUEST_ID);
  assert.equal(args.p_payload.pin, "123456");
  assert.equal(args.p_payload.ownerId, undefined);
  assert.equal(args.p_payload.role, undefined);
  assert.equal(args.p_payload.requestId, undefined);
});

test("employee mutations require an idempotency key and stale edits require a version", async () => {
  const missing = setup();
  assert.equal((await missing.request({ action: "save_employee", tenant: "tatmira", name: "موظف", grants: [], pin: "123456" }, "owner")).status, 400);
  assert.equal(missing.calls.length, 1, "only JWT verification should run");

  const stale = setup();
  assert.equal((await stale.request({ action: "save_employee", tenant: "tatmira", id: REQUEST_ID, name: "موظف", grants: [], requestId: REQUEST_ID }, "owner")).status, 400);
  assert.equal(stale.calls.length, 1, "missing expectedVersion must not reach RPC");

  const valid = setup();
  assert.equal((await valid.request({ action: "save_employee", tenant: "tatmira", id: REQUEST_ID, expectedVersion: 3, name: "موظف", grants: [], requestId: REQUEST_ID }, "owner")).status, 200);
  assert.equal(valid.calls[1].args.p_payload.expectedVersion, 3);
});

test("account mutation migration stores receipts and compares employee versions", () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260919090000_tatmira_account_mutations.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table tatmira_private\.account_requests/i);
  assert.match(sql, /receipt\.fingerprint is distinct from v_fingerprint/i);
  assert.match(sql, /v_current is distinct from v_expected[\s\S]+CONFLICT/i);
  assert.match(sql, /'version',e\.version/i);
  assert.doesNotMatch(sql, /alter table auth\.|service_role\s*=/i);
});
test("invalid owner JWT never reaches database", async () => {
  const s = setup({ authError: new Error("secret provider text") });
  const res = await s.request(
    { action: "employees", tenant: "tatmira" },
    "forged",
  );
  assert.equal(res.status, 401);
  assert.equal(s.calls.length, 1);
  assert.doesNotMatch(await res.text(), /secret/);
});
test("employee tokens cannot create users or change permissions", async () => {
  const s = setup();
  for (const action of [
    "employees",
    "save_employee",
    "set_active",
    "set_pin",
  ]) {
    const res = await s.request(
      { action, tenant: "tatmira", pin: "123456" },
      `tm_${"a".repeat(64)}`,
    );
    assert.equal(res.status, 403);
  }
  assert.equal(s.calls.length, 0);
});
test("employee session is resolved on each request, disable is not cached", async () => {
  const s = setup({ rpcResult: { error: "INVALID_SESSION" } });
  const token = `tm_${"a".repeat(64)}`;
  const res = await s.request({ action: "me", tenant: "tatmira" }, token);
  assert.equal(res.status, 401);
  assert.equal(s.calls[0].args.p_token, token);
  assert.equal(s.calls[0].args.p_owner, null);
});
test("PIN format preserves leading zero and Arabic digits, rejects coercion", async () => {
  assert.equal(normalizePin("٠۱۲۳۴۵"), "012345");
  assert.equal(normalizePin(123456), "");
  const s = setup();
  for (const pin of ["12345", "1234567", "12 3456", 123456, "12345x"])
    assert.equal(
      (await s.request({ action: "pin_login", tenant: "tatmira", pin })).status,
      400,
    );
  assert.equal(s.calls.length, 0);
});
test("login rate limit from shared database survives handler instances", async () => {
  const a = setup({ rpcResult: { error: "RATE_LIMITED" } }),
    b = setup({ rpcResult: { error: "RATE_LIMITED" } });
  for (const s of [a, b])
    assert.equal(
      (
        await s.request({
          action: "pin_login",
          tenant: "tatmira",
          pin: "123456",
        })
      ).status,
      429,
    );
});
test("unknown grants and operations fail closed, request body is capped", async () => {
  const s = setup();
  assert.equal(
    (await s.request({ action: "provision", tenant: "tatmira" }, "owner"))
      .status,
    400,
  );
  assert.equal(
    (
      await s.request(
        {
          action: "save_employee",
          tenant: "tatmira",
          grants: ["manageEmployees"],
        },
        "owner",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await s.request(
        { action: "me", tenant: "tatmira", padding: "x".repeat(9000) },
        "owner",
      )
    ).status,
    413,
  );
  assert.equal(s.calls.length, 0);
});
test("origin is checked, missing origin still requires credentials", async () => {
  const s = setup();
  assert.equal(
    (
      await s.request(
        { action: "me", tenant: "tatmira" },
        "owner",
        "https://untrusted.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (await s.request({ action: "me", tenant: "tatmira" }, null, null)).status,
    401,
  );
  assert.equal(s.calls.length, 0);
});
