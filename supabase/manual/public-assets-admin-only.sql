-- H3 (readiness review 2026-11-02): only the platform admin may upload to or overwrite files in the public-assets bucket
-- (the shared logo, SuperAdmin.jsx -> src/lib/appLogo.js). Any signed-in user of any business could do it before.
-- storage.objects is owned by supabase_storage_admin, so this runs through the Supabase dashboard (SQL editor as an owner role,
-- or Storage -> Policies), not through the postgres release role. Single transaction; changes these two policies only.
begin;
alter policy "public-assets insert authenticated" on storage.objects
  with check (bucket_id = 'public-assets' and (select public.auth_is_superadmin()));

alter policy "public-assets update authenticated" on storage.objects
  using (bucket_id = 'public-assets' and (select public.auth_is_superadmin()))
  with check (bucket_id = 'public-assets' and (select public.auth_is_superadmin()));
commit;
