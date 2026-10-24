-- Frontend first. Keep settings, bank names, audit history and all financial data.
-- The old frontend ignores account_dashboard; uploader bank suggestions remain compatible.
drop function if exists public.admin_account_dashboard_save(jsonb,jsonb,text);
