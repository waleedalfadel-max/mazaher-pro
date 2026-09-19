import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHandler,
  normalizePin,
} from "../tatmira-accounts/server/handler.js";
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
    },
    "signed-token",
  );
  assert.equal(res.status, 200);
  const args = s.calls[1].args;
  assert.equal(args.p_owner, "verified-owner");
  assert.equal(args.p_payload.pin, "123456");
  assert.equal(args.p_payload.ownerId, undefined);
  assert.equal(args.p_payload.role, undefined);
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
