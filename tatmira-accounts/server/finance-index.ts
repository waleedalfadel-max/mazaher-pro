import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { createFinanceHandler } from './finance-handler.js';
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const allowedOrigins = (Deno.env.get('TATMIRA_ACCOUNT_ORIGINS') || 'https://tatmira-preview.vercel.app').split(',').map(s => s.trim()).filter(Boolean);
// Custom PIN tokens are authenticated in the RPC; owner JWTs via auth.getUser.
Deno.serve(createFinanceHandler({ admin, allowedOrigins }));

