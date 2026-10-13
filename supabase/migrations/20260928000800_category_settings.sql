-- إعدادات التصنيفات للمالك: إضافة، وتسمية، وترتيب، وتعطيل وإعادة تفعيل، عبر دوال في الخادم وحدها.
-- يعتمد على: 20260928000000 (actor، err، mode_of)، و000400 (أعمدة التصنيف، norm_cat)، و000500 (plan_invoice)، و000600 (الربط).
--
-- القواعد:
--   • الإدارة لمالك المنشأة الفعلي وحده (دوره في app_users من هوية الجلسة)، وفي منشأته فقط. لا كتابة مباشرة على الجدول
--     لأي دور بعد اليوم؛ القراءة كما هي لكل أدوار المنشأة.
--   • تُتاح بعد تفعيل الاعتماد الجديد للمنشأة (الربط بالمعرّف)، لا في الوضع السابق حيث تُطابق الأسماء نصًا.
--   • الاسم للعرض. المعالجة (رمز مالي ونوع قيد) تُختار للرئيسي عند إنشائه، والفرعي يتبع رئيسيه. لا تتغير معالجة تصنيف
--     مستخدم، ولا يُنقل فرعي بين الرئيسيات في هذه الحزمة.
--   • التعطيل يمنع الاستعمال الجديد (والرئيسي المعطّل يمنع فروعه)، ولا يمس القيود السابقة. إعادة تفعيل الرئيسي لا تفعّل
--     فرعيًا عُطّل بنفسه (لكل تصنيف حالته؛ لا تعطيل متسلسل).
--   • الاسم فريد بعد التطبيع (norm_cat) بين الرئيسيات، وبين فروع الرئيسي الواحد. الاسم نفسه تحت رئيسيين (مثل «أخرى»)
--     مقبول، لأن الاعتماد يحسم التصنيف بالمعرّف، والاسم الملتبس بلا معرّف يُرفض بطلب اختيار صريح (resolve_item_category).
--   • كل تغيير يُسجَّل بمنفّذه (الهوية نفسها التي يسجّلها fill_audit_fields للقيود)، وقبله وبعده.

-- ── السجل ───────────────────────────────────────────────────────────────────
create table approval_private.category_changes (
  id bigint generated always as identity primary key,
  project_id uuid not null,
  category_id uuid not null,
  action text not null check (action in ('create', 'rename', 'set_class', 'disable', 'enable', 'move')),
  before jsonb,
  after jsonb,
  actor_id uuid, actor_name text, actor_role text, acting_as_role text,
  created_at timestamptz not null default now()
);
create index on approval_private.category_changes (project_id, created_at desc);
alter table approval_private.category_changes enable row level security;
revoke all on approval_private.category_changes from public, anon, authenticated;

-- ── الكتابة المباشرة: لا أحد من العميل (القراءة تبقى بسياسة categories_select) ───────────
drop policy if exists categories_write on public.categories;

-- ── أدوات داخلية ─────────────────────────────────────────────────────────────
create function approval_private.category_denied(p_id uuid, p_role text, p_project uuid) returns jsonb
language sql stable set search_path = '' as $$
  select case
    when p_id is null then approval_private.err('no_session')
    when p_role is distinct from 'owner' or p_project is null then approval_private.err('forbidden')
    when not coalesce((select ps.active from public.project_settings ps where ps.project_id = p_project), true) then approval_private.err('project_inactive')
    when approval_private.mode_of(p_project) = 'legacy' then approval_private.err('approval_v2_required')
  end
$$;

create function approval_private.category_json(c public.categories) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'parent_id', c.parent_id, 'sort_order', c.sort_order,
    'financial_class', c.financial_class, 'ledger_type', c.ledger_type, 'is_active', c.is_active)
$$;

-- نوع القيد لمعالجة: نوع الحركة المطابق في إعدادات المنشأة (بصيغته فيها)، وإلا الاسم القياسي الذي يعرفه المحرك
create function approval_private.ledger_type_for_class(p_project uuid, p_class text) returns text
language sql stable set search_path = '' as $$
  with canon as (select case p_class when 'cogs' then '🥩 تكلفة البضاعة المباعة' when 'fixed' then '💰 مصروفات ثابتة'
                                     else '🛒 مصروفات تشغيلية' end as label)
  select coalesce((
    select t.label from public.project_settings ps,
           lateral jsonb_array_elements(case when jsonb_typeof(ps.settings -> 'transaction_types') = 'array' then ps.settings -> 'transaction_types' else '[]' end) x,
           lateral (select coalesce(x ->> 'label', x #>> '{}') as label) t
     where ps.project_id = p_project and jsonb_typeof(x) in ('object', 'string')
       and approval_private.norm_cat(t.label) = approval_private.norm_cat((select label from canon))
     limit 1), (select label from canon))
$$;

-- الاسم: مطلوب، فيه حرف (عربي أو لاتيني)، 60 حرفًا على الأكثر، وغير مكرر بين الرئيسيات أو بين فروع الرئيسي نفسه
-- (يُستثنى التصنيف نفسه عند التسمية). p_parent فارغ للرئيسي.
create function approval_private.category_name_error(p_project uuid, p_parent uuid, p_name text, p_self uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')); d record;
begin
  if v = '' then return approval_private.err('name_required'); end if;
  if length(v) > 60 then return approval_private.err('name_too_long'); end if;
  if approval_private.norm_cat(v) !~ '[A-Za-zء-ي]' then return approval_private.err('name_needs_letters'); end if;
  select c.name, p.name as parent_name, c.is_active into d from public.categories c left join public.categories p on p.id = c.parent_id
   where c.project_id = p_project and c.parent_id is not distinct from p_parent and c.id is distinct from p_self
     and approval_private.norm_cat(c.name) = approval_private.norm_cat(v)
   limit 1;
  if found then
    return approval_private.err('duplicate_name', jsonb_build_object('existing', d.name, 'parent', d.parent_name, 'existing_active', d.is_active));
  end if;
  return null;
end $$;

create function approval_private.log_category(p_project uuid, p_category uuid, p_action text, p_before jsonb, p_after jsonb,
  p_actor uuid, p_actor_name text, p_actor_role text) returns void language sql set search_path = '' as $$
  insert into approval_private.category_changes (project_id, category_id, action, before, after, actor_id, actor_name, actor_role, acting_as_role)
  values (p_project, p_category, p_action, p_before, p_after, p_actor, p_actor_name, p_actor_role, nullif(current_setting('app.acting_as', true), ''))
$$;

-- الاستعمال: قيود وبنود مرتبطة بالمعرّف (الرئيسي بمعرّفه، والفرعي بمعرّفه في البنود)
create function approval_private.category_usage(p_id uuid) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'entries', (select count(*) from public.ledger_entries where category_id = p_id),
    'items', (select count(*) from public.document_items where category_id = p_id or subcategory_id = p_id))
$$;

-- ── القراءة لشاشة الإعدادات (المالك) ──────────────────────────────────────────
create function public.category_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a record; e jsonb;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role is distinct from 'owner' or a.project_id is null then return approval_private.err('forbidden'); end if;
  e := approval_private.category_denied(a.id, a.role, a.project_id);
  return jsonb_build_object('ok', true, 'can_edit', e is null, 'blocked', e ->> 'code', 'mode', approval_private.mode_of(a.project_id),
    'categories', coalesce((
      select jsonb_agg(approval_private.category_json(c) || jsonb_build_object('usage', u.usage)
                       order by (c.parent_id is not null), coalesce(c.sort_order, 2147483647), c.name)
        from public.categories c,
             lateral (select jsonb_build_object(
               'entries', (select count(*) from public.ledger_entries le where le.project_id = c.project_id and le.category_id = c.id),
               'items', (select count(*) from public.document_items di where di.project_id = c.project_id and (di.category_id = c.id or di.subcategory_id = c.id))) as usage) u
       where c.project_id = a.project_id), '[]'::jsonb),
    'review', coalesce((
      select jsonb_agg(jsonb_build_object('source', r.source, 'main', r.stored_main, 'sub', r.stored_sub, 'status', r.status, 'rows', r.rows_count)
                       order by r.status, r.stored_main)
        from approval_private.category_link_review r where r.project_id = a.project_id), '[]'::jsonb),
    'changes', coalesce((
      select jsonb_agg(x order by x ->> 'at' desc) from (
        select jsonb_build_object('at', l.created_at, 'action', l.action, 'category_id', l.category_id, 'before', l.before, 'after', l.after,
                                  'by', l.actor_name) as x
          from approval_private.category_changes l where l.project_id = a.project_id order by l.created_at desc, l.id desc limit 20) t), '[]'::jsonb));
end $$;

-- ── الإنشاء ─────────────────────────────────────────────────────────────────
create function public.category_create(p_name text, p_parent_id uuid default null, p_financial_class text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; e jsonb; v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')); p public.categories; c public.categories;
begin
  select * into a from approval_private.actor();
  e := approval_private.category_denied(a.id, a.role, a.project_id); if e is not null then return e; end if;
  perform pg_advisory_xact_lock(hashtextextended('categories:' || a.project_id::text, 0));   -- إرسالان متتاليان: الثاني يرى الأول
  if p_parent_id is not null then
    select * into p from public.categories where id = p_parent_id and project_id = a.project_id;
    if p.id is null then return approval_private.err('parent_not_found'); end if;
    if p.parent_id is not null then return approval_private.err('parent_is_sub'); end if;
    if not p.is_active then return approval_private.err('parent_inactive', jsonb_build_object('parent', p.name)); end if;
  else
    if p_financial_class is null then return approval_private.err('class_required'); end if;
    if p_financial_class not in ('cogs', 'opex', 'fixed') then return approval_private.err('class_invalid'); end if;
  end if;
  e := approval_private.category_name_error(a.project_id, p_parent_id, v_name, null); if e is not null then return e; end if;
  insert into public.categories (project_id, name, parent_id, type, sort_order, financial_class, ledger_type, is_active)
  values (a.project_id, v_name, p_parent_id, coalesce(p.type, 'expense'),
          coalesce((select max(sort_order) from public.categories where project_id = a.project_id and parent_id is not distinct from p_parent_id), 0) + 1,
          case when p_parent_id is null then p_financial_class end,
          case when p_parent_id is null then approval_private.ledger_type_for_class(a.project_id, p_financial_class) end, true)
  returning * into c;
  perform approval_private.log_category(a.project_id, c.id, 'create', null, approval_private.category_json(c), a.id, a.name, a.role);
  return jsonb_build_object('ok', true, 'category', approval_private.category_json(c));
end $$;

-- ── التسمية ─────────────────────────────────────────────────────────────────
create function public.category_rename(p_id uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; e jsonb; v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')); c public.categories; n public.categories;
begin
  select * into a from approval_private.actor();
  e := approval_private.category_denied(a.id, a.role, a.project_id); if e is not null then return e; end if;
  perform pg_advisory_xact_lock(hashtextextended('categories:' || a.project_id::text, 0));
  select * into c from public.categories where id = p_id and project_id = a.project_id for update;
  if c.id is null then return approval_private.err('not_found'); end if;
  if v_name = c.name then return approval_private.err('no_change'); end if;
  e := approval_private.category_name_error(a.project_id, c.parent_id, v_name, c.id); if e is not null then return e; end if;
  update public.categories set name = v_name where id = c.id returning * into n;
  perform approval_private.log_category(a.project_id, c.id, 'rename', jsonb_build_object('name', c.name), jsonb_build_object('name', n.name), a.id, a.name, a.role);
  return jsonb_build_object('ok', true, 'category', approval_private.category_json(n));
end $$;

-- ── المعالجة: للرئيسي غير المستخدم فقط ────────────────────────────────────────
create function public.category_set_class(p_id uuid, p_financial_class text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; e jsonb; c public.categories; n public.categories; u jsonb;
begin
  select * into a from approval_private.actor();
  e := approval_private.category_denied(a.id, a.role, a.project_id); if e is not null then return e; end if;
  perform pg_advisory_xact_lock(hashtextextended('categories:' || a.project_id::text, 0));
  select * into c from public.categories where id = p_id and project_id = a.project_id for update;
  if c.id is null then return approval_private.err('not_found'); end if;
  if c.parent_id is not null then return approval_private.err('sub_follows_parent'); end if;
  if p_financial_class is null or p_financial_class not in ('cogs', 'opex', 'fixed') then return approval_private.err('class_invalid'); end if;
  if p_financial_class = c.financial_class then return approval_private.err('no_change'); end if;
  u := approval_private.category_usage(c.id) || jsonb_build_object('sub_items', (select count(*) from public.document_items di
         join public.categories s on s.id = di.subcategory_id where s.parent_id = c.id));
  if (u ->> 'entries')::int + (u ->> 'items')::int + (u ->> 'sub_items')::int > 0 then return approval_private.err('class_locked', u); end if;
  update public.categories set financial_class = p_financial_class, ledger_type = approval_private.ledger_type_for_class(a.project_id, p_financial_class)
   where id = c.id returning * into n;
  perform approval_private.log_category(a.project_id, c.id, 'set_class', jsonb_build_object('financial_class', c.financial_class, 'ledger_type', c.ledger_type),
    jsonb_build_object('financial_class', n.financial_class, 'ledger_type', n.ledger_type), a.id, a.name, a.role);
  return jsonb_build_object('ok', true, 'category', approval_private.category_json(n));
end $$;

-- ── التعطيل وإعادة التفعيل ─────────────────────────────────────────────────────
create function public.category_set_active(p_id uuid, p_active boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; e jsonb; c public.categories; n public.categories; p public.categories;
begin
  select * into a from approval_private.actor();
  e := approval_private.category_denied(a.id, a.role, a.project_id); if e is not null then return e; end if;
  if p_active is null then return approval_private.err('bad_request'); end if;
  perform pg_advisory_xact_lock(hashtextextended('categories:' || a.project_id::text, 0));
  select * into c from public.categories where id = p_id and project_id = a.project_id for update;
  if c.id is null then return approval_private.err('not_found'); end if;
  if c.is_active = p_active then return approval_private.err('no_change'); end if;
  -- إعادة تفعيل اسم يطابق تصنيفًا فعّالًا آخر في مستواه تُحدث التباسًا في الاختيار
  if p_active then
    e := approval_private.category_name_error(a.project_id, c.parent_id, c.name, c.id); if e is not null then return e; end if;
  end if;
  update public.categories set is_active = p_active where id = c.id returning * into n;
  perform approval_private.log_category(a.project_id, c.id, case when p_active then 'enable' else 'disable' end,
    jsonb_build_object('is_active', c.is_active), jsonb_build_object('is_active', n.is_active), a.id, a.name, a.role);
  if c.parent_id is not null then select * into p from public.categories where id = c.parent_id; end if;
  return jsonb_build_object('ok', true, 'category', approval_private.category_json(n), 'usage', approval_private.category_usage(c.id),
    'parent_inactive', coalesce(not p.is_active, false),
    'subs_inactive', case when c.parent_id is null then (select count(*) from public.categories where parent_id = c.id and not is_active) end);
end $$;

-- ── الترتيب: تبديل مع الجار في المستوى نفسه، ثم ترقيم متصل للإخوة ─────────────────────
-- p_skip_inactive: الجار هو أقرب تصنيف فعّال (حين تخفي الشاشة المعطّل)، والمعطّل بينهما يبقى في مكانه.
create function public.category_move(p_id uuid, p_direction int, p_skip_inactive boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; e jsonb; c public.categories; ids uuid[]; act boolean[]; i int; j int; tmp uuid;
begin
  select * into a from approval_private.actor();
  e := approval_private.category_denied(a.id, a.role, a.project_id); if e is not null then return e; end if;
  if p_direction not in (-1, 1) then return approval_private.err('bad_request'); end if;
  perform pg_advisory_xact_lock(hashtextextended('categories:' || a.project_id::text, 0));
  select * into c from public.categories where id = p_id and project_id = a.project_id;
  if c.id is null then return approval_private.err('not_found'); end if;
  select array_agg(id order by coalesce(sort_order, 2147483647), name, id), array_agg(is_active order by coalesce(sort_order, 2147483647), name, id) into ids, act
    from public.categories where project_id = a.project_id and parent_id is not distinct from c.parent_id;
  i := array_position(ids, c.id); j := i + p_direction;
  while p_skip_inactive and j between 1 and array_length(ids, 1) and not act[j] loop j := j + p_direction; end loop;
  if j < 1 or j > array_length(ids, 1) then return approval_private.err('at_edge'); end if;
  tmp := ids[i]; ids[i] := ids[j]; ids[j] := tmp;
  update public.categories x set sort_order = o.ord from unnest(ids) with ordinality as o(id, ord) where x.id = o.id and x.sort_order is distinct from o.ord;
  perform approval_private.log_category(a.project_id, c.id, 'move', jsonb_build_object('position', i), jsonb_build_object('position', j), a.id, a.name, a.role);
  return jsonb_build_object('ok', true, 'order', to_jsonb(ids));
end $$;

-- ── تحديد تصنيف البند في الاعتماد: صريح أو مرفوض، بلا تخمين ────────────────────────
-- يعيد {category_id, subcategory_id} (قد يكونان فارغين: بند بلا تصنيف مطابق)، أو {code} للرفض:
--   category_invalid     معرّف غير صالح أو ليس في منشأة المستند؛ لا يتحول إلى مطابقة بالاسم.
--   subcategory_invalid  معرّف فرعي غير صالح أو ليس في المنشأة.
--   subcategory_mismatch الفرعي المختار لا يتبع الرئيسي المختار.
--   category_ambiguous   الاسم (بلا معرّف) يطابق أكثر من تصنيف: رئيسيان بالاسم نفسه، أو فرعي بالاسم نفسه تحت أكثر من
--                        رئيسي ولم يُحدَّد الرئيسي. يُطلب اختيار صريح.
-- الترتيب: المعرّفات أولًا، ثم اسم الرئيسي، ثم اسم الفرعي تحت الرئيسي المحدد فقط؛ وبلا رئيسي، الفرعي إن كان وحيدًا في المنشأة.
-- p_ledger_type (فاتورة بلا بنود): التصنيف الوحيد المربوط بنوع الحركة؛ إن تعدد لا يُربط (القيد يبقى بنوعه).
create function approval_private.resolve_item_category(p_project uuid, p_cat_id text, p_sub_id text, p_main text, p_sub text,
  p_ledger_type text default null) returns jsonb
language plpgsql stable set search_path = '' as $$
declare c public.categories; s public.categories; v uuid; n int;
begin
  if nullif(btrim(coalesce(p_cat_id, '')), '') is not null then
    begin v := p_cat_id::uuid; exception when invalid_text_representation then return jsonb_build_object('code', 'category_invalid'); end;
    select * into c from public.categories where id = v and project_id = p_project;
    if c.id is null then return jsonb_build_object('code', 'category_invalid'); end if;
    if c.parent_id is not null then s := c; select * into c from public.categories where id = s.parent_id; end if;
  end if;
  if nullif(btrim(coalesce(p_sub_id, '')), '') is not null then
    begin v := p_sub_id::uuid; exception when invalid_text_representation then return jsonb_build_object('code', 'subcategory_invalid'); end;
    if s.id is null or s.id <> v then
      select * into s from public.categories where id = v and project_id = p_project and parent_id is not null;
      if s.id is null then return jsonb_build_object('code', 'subcategory_invalid'); end if;
    end if;
    if c.id is not null and s.parent_id <> c.id then
      return jsonb_build_object('code', 'subcategory_mismatch', 'name', s.name, 'parent', c.name);
    end if;
    if c.id is null then select * into c from public.categories where id = s.parent_id; end if;
  end if;
  if c.id is null and nullif(approval_private.norm_cat(p_main), '') is not null then
    select count(*) into n from public.categories where project_id = p_project and parent_id is null
       and approval_private.norm_cat(name) = approval_private.norm_cat(p_main);
    if n > 1 then return jsonb_build_object('code', 'category_ambiguous', 'name', p_main); end if;
    if n = 1 then
      select * into c from public.categories where project_id = p_project and parent_id is null
         and approval_private.norm_cat(name) = approval_private.norm_cat(p_main);
    end if;
  end if;
  if s.id is null and nullif(approval_private.norm_cat(p_sub), '') is not null then
    if c.id is not null then
      select count(*) into n from public.categories where parent_id = c.id and approval_private.norm_cat(name) = approval_private.norm_cat(p_sub);
      if n > 1 then return jsonb_build_object('code', 'category_ambiguous', 'name', p_sub, 'parent', c.name); end if;
      if n = 1 then select * into s from public.categories where parent_id = c.id and approval_private.norm_cat(name) = approval_private.norm_cat(p_sub); end if;
    else
      select count(*) into n from public.categories where project_id = p_project and parent_id is not null
         and approval_private.norm_cat(name) = approval_private.norm_cat(p_sub);
      if n > 1 then return jsonb_build_object('code', 'category_ambiguous', 'name', p_sub, 'needs_main', true); end if;
      if n = 1 then
        select * into s from public.categories where project_id = p_project and parent_id is not null
           and approval_private.norm_cat(name) = approval_private.norm_cat(p_sub);
        select * into c from public.categories where id = s.parent_id;
      end if;
    end if;
  end if;
  if c.id is null and nullif(p_ledger_type, '') is not null then
    select count(*) into n from public.categories where project_id = p_project and parent_id is null and ledger_type = p_ledger_type;
    if n = 1 then select * into c from public.categories where project_id = p_project and parent_id is null and ledger_type = p_ledger_type; end if;
  end if;
  return jsonb_build_object('category_id', c.id, 'subcategory_id', s.id);
end $$;
-- المُحلِّلان السابقان كانا يأخذان أول تطابق بالاسم ويتجاهلان المعرّف غير الصالح؛ لا يستعملهما شيء بعد هذه الهجرة
drop function approval_private.resolve_category(uuid, text, text, text, text, text);
drop function approval_private.resolve_subcategory(uuid, text, text);

-- ── الصلاحيات ───────────────────────────────────────────────────────────────
revoke all on function approval_private.category_denied(uuid, text, uuid), approval_private.category_json(public.categories),
  approval_private.ledger_type_for_class(uuid, text), approval_private.category_name_error(uuid, uuid, text, uuid),
  approval_private.log_category(uuid, uuid, text, jsonb, jsonb, uuid, text, text), approval_private.category_usage(uuid),
  approval_private.resolve_item_category(uuid, text, text, text, text, text)
  from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['category_settings()', 'category_create(text, uuid, text)', 'category_rename(uuid, text)',
    'category_set_class(uuid, text)', 'category_set_active(uuid, boolean)', 'category_move(uuid, integer, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ── التفعيل يربط البيانات السابقة بمعرّفاتها قبل أن تُتاح إعادة التسمية ─────────────────
create or replace function public.approval_set_mode(p_project_id uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; n int; was_active boolean; linked jsonb;
begin
  select * into a from approval_private.actor();
  if a.role is distinct from 'superadmin' then return approval_private.err('forbidden'); end if;
  was_active := approval_private.v2_active(p_project_id);
  if p_mode = 'v2' and not was_active then
    select count(*) into n from public.documents where project_id = p_project_id and status in ('uploaded', 'analyzed') and coalesce(file_url, '') = '';
    if n > 0 then return approval_private.err('documents_without_file', jsonb_build_object('count', n)); end if;
  end if;
  insert into approval_private.settings (project_id, mode, updated_by) values (p_project_id, p_mode, a.id)
  on conflict (project_id) do update set mode = excluded.mode, updated_by = excluded.updated_by;
  -- أول تفعيل: ما اعتُمد بالمسار السابق منذ الترحيل يُربط الآن، والأسماء ما زالت كما حُفظت
  if p_mode = 'v2' and not was_active then linked := approval_private.link_legacy_categories(p_project_id); end if;
  return jsonb_build_object('ok', true, 'mode', p_mode) || case when linked is not null then jsonb_build_object('linked', linked) else '{}' end;
exception when sqlstate 'P0001' then return approval_private.err('mode_locked');
end $$;

-- ── الاعتماد: تحديد التصنيف الصارم، ورفض المعطّل، ونوع القيد من التصنيف ─────────────────
-- نسخة 20260928000500 من plan_invoice بثلاثة تغييرات فقط:
--   (1) التصنيف عبر resolve_item_category: معرّف غير صالح أو من منشأة أخرى، أو فرعي لا يتبع رئيسيه، أو اسم ملتبس ⇒ رفض.
--       والفرعي المعطّل يُرفض كالرئيسي (الرئيسي المعطّل يمنع فروعه أصلًا).
--   (2) نوع القيد لبند واحد: من التصنيف قبل نوع الفاتورة، فلا يخالف نوع القيد رمزه المالي لتصنيف جديد.
--   (3) الفاتورة بلا بنود بالتحديد نفسه.
create or replace function approval_private.plan_invoice(d public.documents, inv jsonb, p_decisions jsonb, p_document jsonb, v_known boolean)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_id uuid := (inv ->> '_id')::uuid; v_kind text; v_total numeric; v_vat numeric; v_pay text; v_type text; v_basis text; v_date date;
  v_items jsonb; v_amounts numeric[]; v_vats numeric[]; v_sum numeric; v_n int; k int; v_groups jsonb; v_item jsonb; v_main text;
  v_gross numeric; v_label text; v_key text; v_num_raw text; v_num text; v_supplier uuid; v_sup_new boolean := false;
  v_link record; v_dec jsonb; v_branch text; v_branch_key text; v_branches jsonb; v_ch jsonb; v_sales_sum numeric; plan jsonb;
  v_cat public.categories; v_sub public.categories; v_key_cat text; v_res jsonb;
  v_disc numeric; v_line_disc numeric[]; v_disc_shares numeric[]; v_after numeric[];
begin
  v_date := nullif(inv ->> 'date', '')::date;
  if v_date is null then return approval_private.err('date_required', jsonb_build_object('invoice_id', v_id)); end if;
  v_kind := case inv ->> 'type' when 'sales' then 'sales' when 'transfer' then 'transfer'
                 else case when inv ->> 'paySource' = 'credit' then 'credit' else 'expense' end end;
  v_pay := nullif(inv ->> 'paySource', '');
  v_label := nullif(btrim(coalesce(inv ->> 'description', '')), '');
  v_num_raw := nullif(btrim(coalesce(inv ->> 'invoiceNumber', '')), '');
  v_num := approval_private.norm_invoice_number(v_num_raw);
  v_branch := nullif(btrim(coalesce(p_document ->> 'branch', d.branch, '')), '');
  plan := jsonb_build_object('ok', true, 'id', v_id, 'kind', v_kind, 'date', v_date, 'description', v_label, 'number_raw', v_num_raw,
                             'number', v_num, 'pay', v_pay, 'payload', inv, 'known', v_known, 'branch', v_branch);

  if v_kind = 'sales' then
    select settings -> 'branches' into v_branches from public.project_settings where project_id = d.project_id;
    if jsonb_typeof(v_branches) = 'array' and jsonb_array_length(v_branches) > 0 then
      if v_branch is null or not (v_branches ? v_branch) then return approval_private.err('branch_required', jsonb_build_object('invoice_id', v_id)); end if;
      v_branch_key := v_branch;
    else
      v_branch_key := coalesce(v_branch, '∅');   -- منشأة بلا فروع: مفتاح «بلا فرع» صريح
    end if;
    v_ch := jsonb_build_object(
      'cash', approval_private.money(inv -> 'cashSales', 'cashSales'), 'network', approval_private.money(inv -> 'networkSales', 'networkSales'),
      'transfer', approval_private.money(inv -> 'transferSales', 'transferSales'), 'hunger', approval_private.money(inv -> 'hungerSales', 'hungerSales'),
      'jahez', approval_private.money(inv -> 'jahez', 'jahez'), 'keeta', approval_private.money(inv -> 'keeta', 'keeta'),
      'mrsool', approval_private.money(inv -> 'mrsool', 'mrsool'));
    select sum(value::numeric) into v_sales_sum from jsonb_each_text(v_ch);
    if v_sales_sum <= 0 then return approval_private.err('amount_required', jsonb_build_object('invoice_id', v_id)); end if;
    if nullif(inv ->> 'totalSales', '') is not null and approval_private.money(inv -> 'totalSales', 'totalSales') <> v_sales_sum then
      return approval_private.err('amounts_mismatch', jsonb_build_object('invoice_id', v_id, 'items_total', v_sales_sum,
        'total', approval_private.money(inv -> 'totalSales', 'totalSales'), 'difference', v_sales_sum - approval_private.money(inv -> 'totalSales', 'totalSales')));
    end if;
    select r.document_id, r.journal_number, r.current, dd.file_name into v_link
      from approval_private.sales_reports r left join public.documents dd on dd.id = r.document_id
     where r.project_id = d.project_id and r.branch_key = v_branch_key and r.report_date = v_date;
    if found then
      return approval_private.err('sales_report_exists', jsonb_build_object('invoice_id', v_id, 'linked', to_jsonb(v_link)));
    end if;
    if exists (select 1 from public.sales s where s.project_id = d.project_id and s.date = v_date and s.description = 'تقرير POS'
                and coalesce(s.branch, '∅') = v_branch_key) then
      return approval_private.err('sales_report_exists_legacy', jsonb_build_object('invoice_id', v_id, 'date', v_date, 'branch', v_branch));
    end if;
    return plan || jsonb_build_object('channels', v_ch, 'branch_key', v_branch_key, 'total', v_sales_sum);
  end if;

  if v_kind = 'transfer' then
    if v_pay is null then return approval_private.err('pay_required', jsonb_build_object('invoice_id', v_id)); end if;
    v_total := approval_private.money(coalesce(inv -> 'amount', inv -> 'totalAmount'), 'amount');
    if v_total <= 0 then return approval_private.err('amount_required', jsonb_build_object('invoice_id', v_id)); end if;
    return plan || jsonb_build_object('total', v_total, 'trans_type', nullif(inv ->> 'transType', ''));
  end if;

  -- مصروف (نقدي/بنك/عهدة/آجل) أو مورد من القائمة
  if v_pay is null or v_pay not in ('cash', 'bank', 'custody', 'payable', 'credit') then
    return approval_private.err('pay_required', jsonb_build_object('invoice_id', v_id));
  end if;
  v_type := coalesce(d.purchase_category, nullif(inv ->> 'transType', ''));
  v_items := coalesce(inv -> 'items', '[]');
  v_n := jsonb_array_length(v_items);
  if v_n <= 1 and v_type is null then return approval_private.err('type_required', jsonb_build_object('invoice_id', v_id)); end if;
  v_total := approval_private.money(coalesce(inv -> 'totalAmount', inv -> 'amount'), 'totalAmount');
  v_vat := approval_private.money(inv -> 'vatAmount', 'vatAmount');
  if v_total <= 0 then return approval_private.err('amount_required', jsonb_build_object('invoice_id', v_id)); end if;
  if v_vat < 0 or v_vat > v_total then return approval_private.err('vat_invalid', jsonb_build_object('invoice_id', v_id)); end if;
  v_basis := case when inv ->> 'amountsBasis' = 'exclusive' then 'exclusive' else 'inclusive' end;

  -- البنود: مطابقة تامة بالهللة على أساس المستند، والضريبة موزعة بالباقي الأكبر؛ قيد لكل تصنيف أساسي
  v_groups := '[]';
  -- الخصم على إجمالي الفاتورة (موجب): يُطرح من مجموع البنود قبل الضريبة في أساس «قبل الضريبة»، ومن الشامل في الأساس الشامل
  v_disc := approval_private.money(inv -> 'invoiceDiscount', 'invoiceDiscount');
  if v_disc < 0 then return approval_private.err('invalid_discount', jsonb_build_object('invoice_id', v_id)); end if;
  if v_disc > 0 and v_n = 0 then return approval_private.err('discount_needs_items', jsonb_build_object('invoice_id', v_id)); end if;
  if v_n > 0 then
    -- مبلغ البند المحتسب هو بعد خصم البند؛ خصم البند يُسجَّل للتدقيق ولا يدخل المعادلة مرة ثانية
    v_amounts := array(select approval_private.money(x -> 'amount', 'items.amount') from jsonb_array_elements(v_items) x);
    v_line_disc := array(select approval_private.money(x -> 'discount', 'items.discount') from jsonb_array_elements(v_items) x);
    if exists (select 1 from unnest(v_line_disc) x where x < 0) then return approval_private.err('invalid_discount', jsonb_build_object('invoice_id', v_id)); end if;
    v_sum := (select sum(x) from unnest(v_amounts) x);
    if v_disc >= v_sum and v_disc > 0 then return approval_private.err('invalid_discount', jsonb_build_object('invoice_id', v_id, 'discount', v_disc, 'items_total', v_sum)); end if;
    if (v_basis = 'inclusive' and v_sum - v_disc <> v_total) or (v_basis = 'exclusive' and v_sum - v_disc + v_vat <> v_total) then
      return approval_private.err('amounts_mismatch', jsonb_build_object('invoice_id', v_id, 'basis', v_basis, 'items_total', v_sum, 'discount', v_disc,
        'total', v_total, 'vat', v_vat, 'difference', case when v_basis = 'inclusive' then v_sum - v_disc - v_total else v_sum - v_disc + v_vat - v_total end));
    end if;
    -- الخصم يوزَّع على البنود بنسبة مبالغها، ثم الضريبة على المبالغ بعد الخصم — بالهللة وبالباقي الأكبر
    v_disc_shares := approval_private.allocate(v_amounts, v_disc);
    v_after := array(select v_amounts[i] - v_disc_shares[i] from generate_subscripts(v_amounts, 1) i order by i);
    v_vats := approval_private.allocate(v_after, v_vat);
    for k in 1..v_n loop
      v_item := v_items -> (k - 1);
      v_main := coalesce(nullif(v_item ->> 'category_main', ''), nullif(inv ->> 'category_main', ''));
      -- التصنيف الأساسي بمعرّفه (أو بالفرعي، أو بالاسم للتوافق)؛ نوع القيد ومعالجته من التصنيف نفسه، لا من اسمه
      v_res := approval_private.resolve_item_category(d.project_id, v_item ->> 'category_id', v_item ->> 'subcategory_id', v_main, v_item ->> 'category_sub');
      if v_res ? 'code' then return approval_private.err(v_res ->> 'code', (v_res - 'code') || jsonb_build_object('invoice_id', v_id, 'item', k)); end if;
      select * into v_cat from public.categories where id = (v_res ->> 'category_id')::uuid;
      select * into v_sub from public.categories where id = (v_res ->> 'subcategory_id')::uuid;
      if v_cat.id is not null and not v_cat.is_active then
        return approval_private.err('category_inactive', jsonb_build_object('invoice_id', v_id, 'name', v_cat.name));
      end if;
      if v_sub.id is not null and not v_sub.is_active then
        return approval_private.err('category_inactive', jsonb_build_object('invoice_id', v_id, 'name', v_sub.name, 'parent', v_cat.name));
      end if;
      v_main := coalesce(v_cat.name, v_main);
      v_key_cat := coalesce(v_cat.id::text, 'n:' || coalesce(v_main, ''));
      v_gross := case when v_basis = 'inclusive' then v_after[k] else v_after[k] + v_vats[k] end;
      v_item := jsonb_build_object('description', coalesce(nullif(v_item ->> 'description', ''), v_label, ''), 'amount', v_gross, 'vat', v_vats[k],
        'main', v_main, 'sub', coalesce(v_sub.name, nullif(v_item ->> 'category_sub', '')), 'sort', k,
        'category_id', v_cat.id, 'subcategory_id', v_sub.id, 'cat_key', v_key_cat, 'financial_class', v_cat.financial_class,
        'line_discount', v_line_disc[k], 'invoice_discount_share', v_disc_shares[k], 'amount_read', v_amounts[k],
        'type', coalesce(v_cat.ledger_type, case when v_n = 1 then v_type end, nullif(v_item ->> 'ledger_type', ''), v_type, '🛒 مصروفات تشغيلية'));
      if exists (select 1 from jsonb_array_elements(v_groups) gg where gg ->> 'cat_key' = v_key_cat) then
        v_groups := (select jsonb_agg(case when gg ->> 'cat_key' = v_key_cat
            then gg || jsonb_build_object('gross', (gg ->> 'gross')::numeric + v_gross, 'vat', (gg ->> 'vat')::numeric + v_vats[k],
                                          'discount', (gg ->> 'discount')::numeric + v_disc_shares[k],
                                          'items', (gg -> 'items') || jsonb_build_array(v_item))
            else gg end) from jsonb_array_elements(v_groups) gg);
      else
        v_groups := v_groups || jsonb_build_array(jsonb_build_object('main', v_main, 'type', v_item -> 'type', 'gross', v_gross,
          'vat', v_vats[k], 'items', jsonb_build_array(v_item), 'cat_key', v_key_cat, 'category_id', v_cat.id, 'financial_class', v_cat.financial_class,
          'discount', v_disc_shares[k]));
      end if;
    end loop;
  else
    -- بلا بنود: تصنيف الفاتورة بمعرّفه، أو التصنيف المربوط بنوع الحركة المختار
    v_res := approval_private.resolve_item_category(d.project_id, inv ->> 'category_id', null, nullif(inv ->> 'category_main', ''), null, v_type);
    if v_res ? 'code' then return approval_private.err(v_res ->> 'code', (v_res - 'code') || jsonb_build_object('invoice_id', v_id)); end if;
    select * into v_cat from public.categories where id = (v_res ->> 'category_id')::uuid;
    if v_cat.id is not null and not v_cat.is_active then
      return approval_private.err('category_inactive', jsonb_build_object('invoice_id', v_id, 'name', v_cat.name));
    end if;
    v_groups := jsonb_build_array(jsonb_build_object('main', coalesce(v_cat.name, nullif(inv ->> 'category_main', '')), 'type', v_type,
      'gross', v_total, 'vat', v_vat, 'sub', nullif(inv ->> 'category_sub', ''), 'items', '[]'::jsonb,
      'category_id', v_cat.id, 'financial_class', v_cat.financial_class));
  end if;

  -- المورد ومفتاحه (نطاق ترقيم الفواتير: كل مورد يرقّم فواتيره بنفسه)
  if v_kind = 'credit' then
    v_supplier := nullif(coalesce(inv ->> 'supplier_id', p_document ->> 'supplier_id'), '')::uuid;
    if v_supplier is null or not exists (select 1 from public.suppliers s where s.id = v_supplier and s.project_id = d.project_id) then
      return approval_private.err('supplier_required', jsonb_build_object('invoice_id', v_id));
    end if;
    v_key := 's:' || v_supplier;
    v_label := coalesce(v_label, (select s.name from public.suppliers s where s.id = v_supplier));
  elsif v_pay = 'payable' then
    v_label := coalesce(nullif(btrim(inv ->> 'supplier_name'), ''), v_label);
    if v_label is null then return approval_private.err('supplier_required', jsonb_build_object('invoice_id', v_id)); end if;
    v_dec := p_decisions -> 'suppliers' -> (v_id::text);
    select ps.id into v_supplier from public.payable_suppliers ps
     where ps.project_id = d.project_id and approval_private.norm_name(ps.name) = approval_private.norm_name(v_label) limit 1;
    if v_supplier is null then
      if v_dec ->> 'resolution' = 'existing' then
        v_supplier := nullif(v_dec ->> 'supplier_id', '')::uuid;
        if not exists (select 1 from public.payable_suppliers ps where ps.id = v_supplier and ps.project_id = d.project_id) then
          return approval_private.err('supplier_required', jsonb_build_object('invoice_id', v_id));
        end if;
      elsif v_dec ->> 'resolution' = 'new' then v_sup_new := true;
      else return approval_private.err('supplier_decision_required', jsonb_build_object('invoice_id', v_id, 'name', v_label));
      end if;
    end if;
    v_key := case when v_supplier is not null then 'ps:' || v_supplier else 'n:' || approval_private.norm_name(v_label) end;
  else
    v_key := 'n:' || coalesce(approval_private.norm_name(v_label), '');
  end if;

  -- التكرار: الرقم نفسه للمورد نفسه يُمنع دائمًا. الاشتباه يحتاج سببًا مكتوبًا، ولا يمس حماية إعادة الاعتماد
  if v_num is not null then
    select x.document_id, x.journal_number, x.invoice_date, x.total, dd.file_name into v_link
      from approval_private.document_invoices x join public.documents dd on dd.id = x.document_id
     where x.project_id = d.project_id and x.status = 'approved' and x.kind in ('expense', 'credit')
       and x.supplier_key = v_key and x.invoice_number_norm = v_num limit 1;
    if found then return approval_private.err('duplicate_invoice', jsonb_build_object('invoice_id', v_id, 'linked', to_jsonb(v_link))); end if;
  end if;
  v_dec := p_decisions -> 'duplicates' -> (v_id::text);
  if nullif(btrim(coalesce(v_dec ->> 'reason', '')), '') is null then
    v_dec := null;
    select 'same_number_other_supplier' as reason, x.document_id, x.journal_number, x.invoice_date, x.total, dd.file_name, x.supplier_label into v_link
      from approval_private.document_invoices x join public.documents dd on dd.id = x.document_id
     where v_num is not null and x.project_id = d.project_id and x.status = 'approved' and x.kind in ('expense', 'credit')
       and x.invoice_number_norm = v_num and x.supplier_key <> v_key limit 1;
    if not found then
      select 'same_supplier_date_total' as reason, x.document_id, x.journal_number, x.invoice_date, x.total, dd.file_name, x.supplier_label into v_link
        from approval_private.document_invoices x join public.documents dd on dd.id = x.document_id
       where x.project_id = d.project_id and x.status = 'approved' and x.kind in ('expense', 'credit')
         and x.supplier_key = v_key and x.invoice_date = v_date and x.total = v_total
         and (v_num is null or x.invoice_number_norm is null) limit 1;   -- رقمان مختلفان = فاتورتان مختلفتان
    end if;
    if not found then   -- قيود المسار السابق (بلا سجل فواتير)
      select 'legacy_entry_match' as reason, null::uuid as document_id, le.journal_number, le.date as invoice_date, le.total_amount as total,
             null::text as file_name, le.description as supplier_label into v_link
        from public.ledger_entries le
       where le.project_id = d.project_id and le.document_invoice_id is null and le.date = v_date and le.total_amount = v_total
         and approval_private.norm_name(regexp_replace(coalesce(le.description, ''), '\s*(—.*|\[[a-z0-9]+\])$', '')) = approval_private.norm_name(v_label)
       limit 1;
    end if;
    if found then return approval_private.err('suspected_duplicate', jsonb_build_object('invoice_id', v_id, 'linked', to_jsonb(v_link))); end if;
  end if;

  return plan || jsonb_build_object('total', v_total, 'vat', v_vat, 'basis', v_basis, 'type', v_type, 'groups', v_groups, 'invoice_discount', v_disc,
    'supplier_id', v_supplier, 'supplier_new', v_sup_new, 'supplier_key', v_key, 'label', v_label,
    'incoming', coalesce(v_type, '') like '%تحصيل جملة%', 'duplicate_decision', v_dec);
exception when sqlstate 'P0001' then
  if sqlerrm like 'APPROVAL:%' then
    return approval_private.err(split_part(sqlerrm, ':', 2), jsonb_build_object('invoice_id', v_id, 'field', split_part(sqlerrm, ':', 3)));
  end if;
  raise;
end $$;
