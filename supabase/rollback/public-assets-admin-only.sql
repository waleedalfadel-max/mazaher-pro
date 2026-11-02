-- Rollback of supabase/manual/public-assets-admin-only.sql: the exact production definitions on 2026-11-02. Reopens H3.
begin;
alter policy "public-assets insert authenticated" on storage.objects
  with check (bucket_id = 'public-assets'::text);

alter policy "public-assets update authenticated" on storage.objects
  using (bucket_id = 'public-assets'::text)
  with check (bucket_id = 'public-assets'::text);
commit;
