-- Covers the case foreign key independently of the tenant-scoped history index.
create index suspense_events_case_id on public.suspense_events(case_id);
