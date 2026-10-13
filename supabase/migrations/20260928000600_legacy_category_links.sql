-- ربط البيانات السابقة بمعرّف التصنيف حيث يثبت الربط، ليبقى التصنيف صفًّا واحدًا في التقارير بعد إعادة تسميته.
-- يعتمد على: 20260928000400_category_financial_binding.sql (الأعمدة category_id وsubcategory_id، وnorm_cat).
--
-- القاعدة:
--   • أعمدة الربط وحدها (category_id، subcategory_id). لا يمس مبلغًا ولا ضريبة ولا نوعًا ولا اسمًا محفوظًا ولا financial_class؛
--     فالمجاميع والمعالجة المالية (تكلفة بضاعة أو مصروف) كما هي تمامًا.
--   • يُربط الاسم المحفوظ فقط إن طابق بعد التطبيع تصنيفًا أساسيًا واحدًا في منشأته، والفرعي فرعيًا واحدًا تحت ذلك الأساسي.
--   • لا مطابقة تقريبية ولا دمج لأسماء متشابهة. الملتبس (أكثر من تصنيف بالاسم نفسه) وغير المطابق يُسجَّلان للمراجعة ويبقيان بلا ربط.
--   • لا يغيّر ربطًا موجودًا (category_id is null فقط)، فتشغيله مرة ثانية آمن.
--
-- التوقيت: قبل أي إعادة تسمية للتصنيفات. يُعاد تشغيله مباشرة قبل تفعيل الاعتماد الجديد لكل منشأة
-- (ليشمل ما اعتُمد بالمسار السابق بين الهجرة والتفعيل):  select approval_private.link_legacy_categories('<project>');
-- إن سبقت إعادة تسمية الترحيلَ، بقيت الأسماء القديمة غير مطابقة وظهرت في المراجعة، ولا تُربط تلقائيًا.

create table approval_private.category_link_review (
  project_id uuid not null,
  source text not null check (source in ('ledger', 'item')),
  stored_main text not null default '',
  stored_sub text not null default '',
  status text not null check (status in ('unmatched_main', 'ambiguous_main', 'unmatched_sub', 'ambiguous_sub')),
  rows_count int not null,
  noted_at timestamptz not null default now(),
  primary key (project_id, source, stored_main, stored_sub, status)
);
alter table approval_private.category_link_review enable row level security;
revoke all on approval_private.category_link_review from public, anon, authenticated;

create function approval_private.link_legacy_categories(p_project uuid default null) returns jsonb
language plpgsql set search_path = '' as $f$
declare n_item int; n_sub int; n_ledger int; n_review int;
begin
  drop table if exists pg_temp.t_mains, pg_temp.t_subs;
  -- الأساسيات والفرعيات بالاسم المطبّع، مع عدد التصنيفات التي تحمل الاسم نفسه (للكشف عن الالتباس)
  create temp table t_mains on commit drop as
    select project_id, approval_private.norm_cat(name) as k, count(*) as n, (array_agg(id))[1] as id
      from public.categories where parent_id is null and (p_project is null or project_id = p_project)
     group by 1, 2;
  create temp table t_subs on commit drop as
    select parent_id, approval_private.norm_cat(name) as k, count(*) as n, (array_agg(id))[1] as id
      from public.categories where parent_id is not null and (p_project is null or project_id = p_project)
     group by 1, 2;

  update public.document_items i set category_id = m.id
    from t_mains m
   where i.category_id is null and m.project_id = i.project_id and m.n = 1
     and m.k = approval_private.norm_cat(i.category_main) and m.k <> '';
  get diagnostics n_item = row_count;

  update public.document_items i set subcategory_id = s.id
    from t_subs s
   where i.subcategory_id is null and i.category_id is not null and s.parent_id = i.category_id and s.n = 1
     and s.k = approval_private.norm_cat(i.category_sub) and s.k <> ''
     and (p_project is null or i.project_id = p_project);
  get diagnostics n_sub = row_count;

  -- القيود السابقة (بلا فاتورة اعتماد جديد): بالتصنيف المحفوظ، وإلا بنوع القيد
  update public.ledger_entries e set category_id = m.id
    from t_mains m
   where e.category_id is null and e.document_invoice_id is null and m.project_id = e.project_id and m.n = 1
     and m.k = approval_private.norm_cat(coalesce(nullif(e.category_main, ''), e.type)) and m.k <> '';
  get diagnostics n_ledger = row_count;

  -- للمراجعة: ما بقي بلا ربط وله اسم تصنيف محفوظ. (قيود بلا category_main ولا تصنيف بنوعها — مبيعات وتحويلات — ليست تصنيفات.)
  delete from approval_private.category_link_review where p_project is null or project_id = p_project;
  insert into approval_private.category_link_review (project_id, source, stored_main, stored_sub, status, rows_count)
  select i.project_id, 'item', coalesce(i.category_main, ''), '',
         case when m.n > 1 then 'ambiguous_main' else 'unmatched_main' end, count(*)
    from public.document_items i left join t_mains m on m.project_id = i.project_id and m.k = approval_private.norm_cat(i.category_main)
   where i.category_id is null and (p_project is null or i.project_id = p_project)
   group by 1, 3, 5
  union all
  select i.project_id, 'item', coalesce(i.category_main, ''), coalesce(i.category_sub, ''),
         case when s.n > 1 then 'ambiguous_sub' else 'unmatched_sub' end, count(*)
    from public.document_items i left join t_subs s on s.parent_id = i.category_id and s.k = approval_private.norm_cat(i.category_sub)
   where i.category_id is not null and i.subcategory_id is null and approval_private.norm_cat(i.category_sub) <> ''
     and (p_project is null or i.project_id = p_project)
   group by 1, 3, 4, 5
  union all
  select e.project_id, 'ledger', e.category_main, '',
         case when m.n > 1 then 'ambiguous_main' else 'unmatched_main' end, count(*)
    from public.ledger_entries e left join t_mains m on m.project_id = e.project_id and m.k = approval_private.norm_cat(e.category_main)
   where e.category_id is null and e.document_invoice_id is null and approval_private.norm_cat(e.category_main) <> ''
     and (p_project is null or e.project_id = p_project)
   group by 1, 3, 5;
  get diagnostics n_review = row_count;

  return jsonb_build_object('items_linked', n_item, 'items_sub_linked', n_sub, 'ledger_linked', n_ledger, 'review_groups', n_review);
end $f$;
revoke all on function approval_private.link_legacy_categories(uuid) from public, anon, authenticated;

select approval_private.link_legacy_categories();
