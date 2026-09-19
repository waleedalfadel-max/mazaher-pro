// This handler is independent of the financial demo and the existing Tahseeb API.
// getUser verifies the owner JWT; the database independently enforces membership.
export const GRANTS = [
  "upload_sale",
  "upload_payment",
  "upload_expense",
  "review",
  "view_reports",
  "manage_customers",
];
const OWNER_ACTIONS = new Set([
  "employees",
  "save_employee",
  "set_active",
  "set_pin",
]);
const ACTIONS = new Set(["pin_login", "me", "logout", ...OWNER_ACTIONS]);
export function normalizePin(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776));
}
export function createHandler({
  admin,
  allowedOrigins,
  clientAddress = () => "unknown",
}) {
  return async (request) => {
    const origin = request.headers.get("origin");
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Vary: "Origin",
    };
    if (origin && allowedOrigins.includes(origin))
      headers["Access-Control-Allow-Origin"] = origin;
    const reply = (status, body) =>
      new Response(JSON.stringify(body), { status, headers });
    if (origin && !allowedOrigins.includes(origin))
      return reply(403, { error: "ORIGIN_DENIED" });
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers":
            "authorization, apikey, content-type, x-client-info",
        },
      });
    if (request.method !== "POST")
      return reply(405, { error: "METHOD_NOT_ALLOWED" });
    try {
      // Stream cap applies even if Content-Length is absent or forged.
      const reader = request.body?.getReader();
      if (!reader) return reply(400, { error: "INVALID_REQUEST" });
      const chunks = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 8192) {
          await reader.cancel();
          return reply(413, { error: "REQUEST_TOO_LARGE" });
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      let body;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return reply(400, { error: "INVALID_REQUEST" });
      }
      if (
        !body ||
        !ACTIONS.has(body.action) ||
        !/^[a-z0-9-]{1,63}$/.test(body.tenant || "")
      )
        return reply(400, { error: "INVALID_REQUEST" });
      const payload = {};
      for (const key of ["id", "name", "grants", "active"])
        if (Object.hasOwn(body, key)) payload[key] = body[key];
      if (Object.hasOwn(body, "pin")) {
        payload.pin = normalizePin(body.pin);
        if (!/^\d{6}$/.test(payload.pin))
          return reply(400, { error: "PIN_FORMAT" });
      }
      if (["pin_login", "set_pin"].includes(body.action) && !payload.pin)
        return reply(400, { error: "PIN_FORMAT" });
      if (
        payload.grants !== undefined &&
        (!Array.isArray(payload.grants) ||
          payload.grants.some((g) => !GRANTS.includes(g)))
      )
        return reply(400, { error: "INVALID_GRANTS" });
      const token = request.headers
        .get("authorization")
        ?.match(/^Bearer ([^\s]+)$/i)?.[1];
      let ownerId = null;
      let employeeToken = null;
      if (body.action !== "pin_login") {
        if (!token) return reply(401, { error: "AUTH_REQUIRED" });
        if (/^tm_[a-f0-9]{64}$/.test(token)) {
          if (OWNER_ACTIONS.has(body.action))
            return reply(403, { error: "OWNER_ONLY" });
          employeeToken = token;
        } else {
          const { data, error } = await admin.auth.getUser(token);
          if (error || !data?.user?.id)
            return reply(401, { error: "INVALID_SESSION" });
          ownerId = data.user.id;
        }
      }
      // No caller-supplied userId, role or owner email crosses this boundary.
      const { data, error } = await admin.rpc("tatmira_accounts", {
        p_action: body.action,
        p_slug: body.tenant,
        p_owner: ownerId,
        p_token: employeeToken,
        p_payload: payload,
        p_address: body.action === "pin_login" ? clientAddress(request) : "",
      });
      if (error || !data) return reply(503, { error: "AUTH_UNAVAILABLE" });
      if (data.error) {
        const status =
          data.error === "RATE_LIMITED"
            ? 429
            : ["INVALID_SESSION", "INVALID_LOGIN"].includes(data.error)
              ? 401
              : ["OWNER_ONLY", "TENANT_UNAVAILABLE"].includes(data.error)
                ? 403
                : 400;
        return reply(status, { error: data.error });
      }
      return reply(200, data);
    } catch {
      // Do not log caught errors: provider errors can include credentials or bodies.
      return reply(503, { error: "AUTH_UNAVAILABLE" });
    }
  };
}
