import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createHandler } from "./handler.js";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
const allowedOrigins = (
  Deno.env.get("TATMIRA_ACCOUNT_ORIGINS") ||
  "https://tatmira-preview.vercel.app"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
Deno.serve(createHandler({ admin, allowedOrigins }));
// PIN sessions are custom credentials, verified by the RPC on every request.
// The tenant-wide DB limiter works across instances; no trust in proxy IP headers.
