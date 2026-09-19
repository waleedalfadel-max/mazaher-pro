// Run privately with service-role credentials in the environment, never in browser code.
import { createClient } from "@supabase/supabase-js";
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  TATMIRA_OWNER_EMAIL,
  TATMIRA_SLUG = "tatmira",
  TATMIRA_NAME = "معمل تتميرا",
} = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TATMIRA_OWNER_EMAIL)
  throw new Error("Missing private provisioning settings");
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let owner;
for (let page = 1; !owner; page++) {
  const { data, error } = await admin.auth.admin.listUsers({
    page,
    perPage: 100,
  });
  if (error) throw new Error("Could not check owner account");
  owner = data.users.find(
    (u) => u.email?.toLowerCase() === TATMIRA_OWNER_EMAIL.toLowerCase(),
  );
  if (data.users.length < 100) break;
}
if (!owner)
  throw new Error(
    "Create the owner in Supabase Auth and verify their email first; no existing password is changed by this script",
  );
if (!owner.email_confirmed_at) throw new Error("Owner email is not confirmed");
const { error } = await admin.rpc("tatmira_provision", {
  p_slug: TATMIRA_SLUG,
  p_name: TATMIRA_NAME,
  p_owner: owner.id,
});
if (error)
  throw new Error(
    "Owner assignment failed; inspect private server configuration",
  );
console.log("Owner assigned. No password, token or PIN was printed.");
