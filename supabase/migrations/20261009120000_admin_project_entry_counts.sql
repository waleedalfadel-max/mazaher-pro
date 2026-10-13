-- لوحة مدير المنصة: عدد القيود لكل منشأة عبر دالة خادم (بعد 20261008120000).
--
-- السبب: اللوحة كانت تعدّ القيود بقراءة ledger_entries من المتصفح، وسياسة القراءة ledger_entries_select تحصر القراءة في منشأة
-- الجلسة (project_id = auth_project_id())، ومدير المنصة بلا منشأة، فيرى صفرًا. هذه حماية العزل نفسها تعمل، فلا تُوسَّع السياسة.
-- القواعد (كما في admin_project_user_counts):
--   • المستدعي مدير منصة نشط من هوية الجلسة (approval_private.actor()، الذي لا يعيد المعطّل)، وإلا forbidden أو no_session.
--   • المجاميع وحدها: عدد صفوف ledger_entries لكل منشأة (المعنى نفسه الذي كانت تعدّه اللوحة). لا صفوف ولا حقول من الدفاتر.
--   • سياسات القراءة كما هي، بلا توسيع.
create function public.admin_project_entry_counts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a record;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role is distinct from 'superadmin' then return approval_private.err('forbidden'); end if;
  return jsonb_build_object('ok', true, 'counts', coalesce((
    select jsonb_object_agg(project_id, n)
      from (select project_id, count(*) as n from public.ledger_entries where project_id is not null group by project_id) x), '{}'::jsonb));
end $$;

revoke all on function public.admin_project_entry_counts() from public, anon;
grant execute on function public.admin_project_entry_counts() to authenticated;

notify pgrst, 'reload schema';
