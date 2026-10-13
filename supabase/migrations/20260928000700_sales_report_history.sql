-- سجل تقرير المبيعات لليوم والفرع: الأرقام الحالية، وكل تصحيح بسببه وقيده ومنفّذه ووقته.
-- للقراءة فقط، لمالك المنشأة ومحاسبها (الجلسة نفسها، لا معرّف منشأة من المتصفح).
-- يعتمد على: 20260928000000_approval_v2.sql (جدولا sales_reports وsales_report_revisions).

create function public.approval_sales_report_history(p_date date, p_branch text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  a record; v_branches jsonb; v_branch text := nullif(btrim(coalesce(p_branch, '')), ''); v_key text; r record;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.project_id is null or a.role not in ('owner', 'accountant') then return approval_private.err('forbidden'); end if;
  -- مفتاح الفرع بالقاعدة نفسها في الاعتماد والتصحيح
  select settings -> 'branches' into v_branches from public.project_settings where project_id = a.project_id;
  v_key := case when jsonb_typeof(v_branches) = 'array' and jsonb_array_length(v_branches) > 0 then v_branch else coalesce(v_branch, '∅') end;
  select * into r from approval_private.sales_reports where project_id = a.project_id and branch_key = v_key and report_date = p_date;
  if not found then return approval_private.err('no_report'); end if;
  return jsonb_build_object('ok', true, 'report_date', r.report_date, 'branch', nullif(r.branch_key, '∅'),
    'journal_number', r.journal_number, 'current', r.current,
    'revisions', coalesce((
      select jsonb_agg(jsonb_build_object('at', v.created_at, 'previous', v.previous, 'corrected', v.corrected,
               'journal_number', v.journal_number, 'reason', v.reason, 'by', u.name) order by v.id)
        from approval_private.sales_report_revisions v left join public.app_users u on u.id = v.actor_id
       where v.project_id = r.project_id and v.branch_key = r.branch_key and v.report_date = r.report_date), '[]'::jsonb));
end $$;

revoke all on function public.approval_sales_report_history(date, text) from public, anon;
grant execute on function public.approval_sales_report_history(date, text) to authenticated;
