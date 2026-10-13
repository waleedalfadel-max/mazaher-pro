-- ربط تقارير المبيعات المعتمدة بالمسار السابق بسجل التقارير في الاعتماد الجديد، ليُتاح تصحيحها منه. بعد 20261001000100.
--
-- المسار السابق كان يكتب لكل تقرير: صف مبيعات بوصف «تقرير POS» (التاريخ والفرع وأرقام القنوات)، وقيودًا بأوصاف «… — POS» برقم قيد
-- واحد وملف المستند، ويسجّل رقم القيد في المستند المعتمد. لا مرجع مباشر بينها. الاعتماد الجديد يرفض تقريرًا جديدًا لليوم نفسه
-- (sales_report_exists_legacy) ولا يجد ما يصححه (no_report_to_correct).
--
-- الربط هنا تسجيل فقط: صف في approval_private.sales_reports (نسخة 0) وصف فاتورة معتمدة للمستند الأصلي. لا يغيّر أي رقم في المبيعات أو
-- القيود أو المستندات، ولا ينشئ قيدًا. يُربط التقرير فقط إذا ثبت كله دون تخمين:
--   1) صف مبيعات سابق واحد لذلك اليوم والفرع، أرقام قنواته الخمس موجودة وغير سالبة وبلا ملف (وفي منشأة لها فروع: فرعه مسجّل ومن فروعها)؛
--   2) مجموعة قيود واحدة برقم قيد واحد تطابق صف المبيعات قناةً قناة (التحويل ومرسول في القيود وحدها، فتؤخذ منها)، وتُفحص **كاملة**: كل
--      قيد بهذا الرقم في المنشأة قيدُ قناة POS لذلك اليوم والفرع، مرة واحدة لكل قناة، بالشكل الذي يكتبه المسار السابق تمامًا: النوع،
--      والحالة approved، والمبلغ موجب، والأعمدة المالية كلها (عمود القناة = المبلغ، وبقية النقد والبنك والعهدة والذمم والدائن والضريبة صفر)،
--      وبلا مستند أو فاتورة أو مورد مرتبط؛ وملف واحد. كل فحص يُحسم صفًا صفًا وNULL = غير صحيح. صف غير مفسَّر بالرقم يرفض الربط.
--   3) مستند معتمد واحد بذلك الرقم في المنشأة، ملفه ملف القيود وفرعه فرعها.
-- غير ذلك لا يُربط ولا تُصلح أرقامه، ويُسجَّل سببه في approval_private.legacy_sales_links للمراجعة (sales_row_invalid، multiple_rows،
-- branch_missing، branch_not_configured، no_matching_entries، ambiguous_entries، unexplained_entries، entry_shape_mismatch، not_positive،
-- no_document، ambiguous_document، document_mismatch، document_in_v2).
-- يُشغَّل مع أول تفعيل للاعتماد الجديد (approval_set_mode)، وبعده لا يكتب المسار السابق تقارير جديدة (حارس الاعتماد).

create table approval_private.legacy_sales_links (
  sales_id uuid primary key,
  project_id uuid not null,
  report_date date not null,
  branch text,
  status text not null check (status in ('linked', 'unproven')),
  reason text,
  document_id uuid,
  journal_number text,
  channels jsonb,
  checked_at timestamptz not null default now()
);
alter table approval_private.legacy_sales_links enable row level security;
revoke all on approval_private.legacy_sales_links from public, anon, authenticated;

-- التصنيف (قراءة فقط): لكل صف مبيعات سابق في المنشأة حالته وسببه.
-- كل فحص يُحسم صفًا صفًا قبل التجميع، وNULL في أي فحص = غير صحيح (coalesce(…, false))؛ ومجموعة القيود تُفحص كاملة برقمها.
create function approval_private.legacy_sales_candidates(p_project uuid)
returns table (sales_id uuid, report_date date, branch text, branch_key text, status text, reason text,
               document_id uuid, journal_number text, channels jsonb, total numeric)
language sql stable set search_path = '' as $$
with cfg as (
  select coalesce((select ps.settings -> 'branches' from public.project_settings ps where ps.project_id = p_project), 'null'::jsonb) as b
),
br as (select case when jsonb_typeof(b) = 'array' and jsonb_array_length(b) > 0 then b end as list from cfg),
-- القنوات كما يكتبها المسار السابق: الوصف، والنوع، وعمود المبلغ
k (ch, descr, typ, col) as (values
  ('cash', 'مبيعات كاش — POS', '💵 مبيعات كاش', 'cash'), ('network', 'مبيعات شبكة — POS', '🏦 مبيعات شبكة', 'bank'),
  ('transfer', 'مبيعات تحويل — POS', '💸 مبيعات تحويل', 'bank'), ('hunger', 'ذمم هنقر — POS', '🍔 مبيعات هنقر ستيشن', 'recv'),
  ('jahez', 'ذمم جاهز — POS', '🛵 مبيعات جاهز', 'recv'), ('keeta', 'ذمم كيتا — POS', '🛺 مبيعات كيتا', 'recv'),
  ('mrsool', 'ذمم مرسول — POS', '🛵 مبيعات مرسول', 'recv')),
s as (
  select s.id, s.date, nullif(btrim(coalesce(s.branch, '')), '') as branch,
         s.cash_sales as cash, s.network_sales as network, s.hunger_sales as hunger, s.jahez_sales as jahez, s.keeta_sales as keeta,
         -- صف المسار السابق: أرقام القنوات الخمس موجودة وغير سالبة، وبلا ملف (لم يكن يكتبه)
         coalesce(s.cash_sales >= 0 and s.network_sales >= 0 and s.hunger_sales >= 0 and s.jahez_sales >= 0 and s.keeta_sales >= 0
                  and coalesce(s.file_url, '') = '', false) as row_ok,
         count(*) over (partition by s.date, coalesce(nullif(btrim(coalesce(s.branch, '')), ''), '∅')) as same_day
    from public.sales s where s.project_id = p_project and s.description = 'تقرير POS'
),
-- كل قيد برقم قيد في المنشأة: قناته إن كان وصفه وصف قناة POS، وصحة شكله كاملًا كما يكتبه المسار السابق
e as (
  select l.journal_number as jn, l.date, coalesce(nullif(btrim(coalesce(l.branch, '')), ''), '∅') as bk, coalesce(l.file_url, '') as file_url,
         k.ch, l.total_amount as amt,
         coalesce(k.ch is not null and l.type = k.typ and l.status = 'approved' and l.total_amount > 0
           and l.cash_in = case when k.col = 'cash' then l.total_amount else 0 end and l.cash_out = 0
           and l.bank_in = case when k.col = 'bank' then l.total_amount else 0 end and l.bank_out = 0
           and l.custody_in = 0 and l.custody_out = 0
           and l.receivable_in = case when k.col = 'recv' then l.total_amount else 0 end and l.receivable_out = 0
           and l.payable_in = 0 and l.payable_out = 0 and l.vat_amount = 0
           and l.document_id is null and l.document_invoice_id is null and l.supplier_id is null and l.paid_invoice_id is null, false) as shape_ok
    from public.ledger_entries l
    left join k on k.descr = regexp_replace(l.description, ' \[[0-9a-z]+\]$', '')
   where l.project_id = p_project and l.journal_number is not null
),
-- أرقام القيود المرشحة لكل صف مبيعات: قيود قنوات POS لليوم والفرع نفسيهما
cand as (select distinct s.id as sid, e.jn from s join e on e.ch is not null and e.date = s.date and e.bk = coalesce(s.branch, '∅')),
-- المجموعة كاملة برقمها: كل قيد بهذا الرقم، المفسَّر (قناة POS لليوم والفرع) وغير المفسَّر
g as (
  select c.sid, c.jn,
         count(*) as n_rows,
         count(*) filter (where e.ch is not null and e.date = s.date and e.bk = coalesce(s.branch, '∅')) as n_pos,
         count(*) filter (where e.shape_ok and e.date = s.date and e.bk = coalesce(s.branch, '∅')) as n_ok,
         count(distinct e.ch) as n_ch,
         count(distinct e.file_url) as files, min(e.file_url) as file_url,
         coalesce(sum(e.amt) filter (where e.ch = 'cash'), 0) as cash, coalesce(sum(e.amt) filter (where e.ch = 'network'), 0) as network,
         coalesce(sum(e.amt) filter (where e.ch = 'transfer'), 0) as transfer, coalesce(sum(e.amt) filter (where e.ch = 'hunger'), 0) as hunger,
         coalesce(sum(e.amt) filter (where e.ch = 'jahez'), 0) as jahez, coalesce(sum(e.amt) filter (where e.ch = 'keeta'), 0) as keeta,
         coalesce(sum(e.amt) filter (where e.ch = 'mrsool'), 0) as mrsool
    from cand c join s on s.id = c.sid join e on e.jn = c.jn
   group by c.sid, c.jn
),
-- المجموعات التي تطابق أرقامها صف المبيعات قناةً قناة
m as (
  select g.* from g join s on s.id = g.sid
   where coalesce(g.cash = s.cash and g.network = s.network and g.hunger = s.hunger and g.jahez = s.jahez and g.keeta = s.keeta, false)
),
c as (
  select s.*, (select count(*) from m where m.sid = s.id) as n_groups, (select to_jsonb(m) from m where m.sid = s.id limit 1) as grp
    from s
)
select c.id, c.date, c.branch,
       case when (select list from br) is not null then c.branch else coalesce(c.branch, '∅') end as branch_key,
       case when v.reason is null then 'proven' else 'unproven' end,
       v.reason, case when v.reason is null then dc.id end, c.grp ->> 'jn',
       case when c.n_groups = 1 then jsonb_build_object('cash', c.cash, 'network', c.network, 'transfer', (c.grp ->> 'transfer')::numeric,
         'hunger', c.hunger, 'jahez', c.jahez, 'keeta', c.keeta, 'mrsool', (c.grp ->> 'mrsool')::numeric) end,
       case when c.n_groups = 1 then c.cash + c.network + (c.grp ->> 'transfer')::numeric + c.hunger + c.jahez + c.keeta + (c.grp ->> 'mrsool')::numeric end
  from c
  left join lateral (
    select count(*) as n, min(dd.id::text)::uuid as id, min(coalesce(dd.file_url, '')) as file_url,
           min(coalesce(nullif(btrim(coalesce(dd.branch, '')), ''), '∅')) as bk
      from public.documents dd where dd.project_id = p_project and dd.status = 'approved' and dd.journal_number = c.grp ->> 'jn'
  ) dc on true
  cross join lateral (select case
      when exists (select 1 from approval_private.sales_reports r where r.project_id = p_project and r.report_date = c.date
                     and r.branch_key = case when (select list from br) is not null then c.branch else coalesce(c.branch, '∅') end) then 'already_registered'
      when not c.row_ok then 'sales_row_invalid'
      when c.same_day > 1 then 'multiple_rows'
      when (select list from br) is not null and c.branch is null then 'branch_missing'
      when (select list from br) is not null and not coalesce((select list from br) ? c.branch, false) then 'branch_not_configured'
      when c.n_groups = 0 then 'no_matching_entries'
      when c.n_groups > 1 then 'ambiguous_entries'
      -- صف بهذا الرقم لا يفسّره التقرير (وصف آخر، أو يوم أو فرع آخر): لا يُتجاهل للوصول إلى تطابق جزئي
      when (c.grp ->> 'n_rows')::int <> (c.grp ->> 'n_pos')::int then 'unexplained_entries'
      -- قيد لا يطابق شكل المسار السابق كاملًا (النوع، الحالة، الأعمدة المالية، NULL)، أو قناة مكررة، أو أكثر من ملف
      when (c.grp ->> 'n_ok')::int <> (c.grp ->> 'n_rows')::int or (c.grp ->> 'n_ch')::int <> (c.grp ->> 'n_rows')::int
           or (c.grp ->> 'files')::int <> 1 then 'entry_shape_mismatch'
      when not coalesce(c.cash + c.network + (c.grp ->> 'transfer')::numeric + c.hunger + c.jahez + c.keeta + (c.grp ->> 'mrsool')::numeric > 0, false) then 'not_positive'
      when dc.n = 0 then 'no_document'
      when dc.n > 1 then 'ambiguous_document'
      when c.grp ->> 'file_url' = '' or dc.file_url <> c.grp ->> 'file_url' or dc.bk <> coalesce(c.branch, '∅') then 'document_mismatch'
      when exists (select 1 from approval_private.document_invoices di where di.document_id = dc.id) then 'document_in_v2'
    end as reason) v
$$;

-- الربط: المثبت وحده، ويُسجَّل غير المثبت بسببه. لا يغيّر مبيعات ولا قيودًا ولا مستندات.
create function approval_private.link_legacy_sales_reports(p_project uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare c record; v_inv uuid; n_linked int := 0; n_unproven int := 0; v_reasons jsonb := '{}';
begin
  -- قفل المنشأة نفسه الذي يستعمله الاعتماد: لا تقرير جديد يُكتب أثناء الربط
  perform pg_advisory_xact_lock(hashtextextended('approval:' || p_project::text, 0));
  for c in select * from approval_private.legacy_sales_candidates(p_project) loop
    if c.reason = 'already_registered' then continue; end if;
    if c.status = 'proven' then
      v_inv := gen_random_uuid();
      insert into approval_private.document_invoices (id, document_id, project_id, idx, status, kind, invoice_date, total, journal_number,
        approved_payload, decided_at)
      values (v_inv, c.document_id, p_project, 0, 'approved', 'sales', c.report_date, c.total, c.journal_number,
        jsonb_build_object('type', 'sales', 'source', 'legacy_link', 'channels', c.channels), now());
      insert into approval_private.sales_reports (project_id, branch_key, report_date, document_id, invoice_id, sales_id, journal_number, current, revision)
      values (p_project, c.branch_key, c.report_date, c.document_id, v_inv, c.sales_id, c.journal_number, c.channels, 0);
      n_linked := n_linked + 1;
    else
      n_unproven := n_unproven + 1;
      v_reasons := jsonb_set(v_reasons, array[c.reason], to_jsonb(coalesce((v_reasons ->> c.reason)::int, 0) + 1));
    end if;
    insert into approval_private.legacy_sales_links (sales_id, project_id, report_date, branch, status, reason, document_id, journal_number, channels)
    values (c.sales_id, p_project, c.report_date, c.branch, case when c.status = 'proven' then 'linked' else 'unproven' end,
            case when c.status = 'proven' then null else c.reason end, c.document_id, c.journal_number, c.channels)
    on conflict (sales_id) do update set status = excluded.status, reason = excluded.reason, document_id = excluded.document_id,
      journal_number = excluded.journal_number, channels = excluded.channels, checked_at = now();
  end loop;
  return jsonb_build_object('linked', n_linked, 'unproven', n_unproven, 'reasons', v_reasons);
end $$;
revoke all on function approval_private.legacy_sales_candidates(uuid), approval_private.link_legacy_sales_reports(uuid) from public, anon, authenticated;

-- التفعيل: كما في 20260928000900، ويُضاف الربط مع أول تفعيل (بعد ربط التصنيفات)
create or replace function public.approval_set_mode(p_project_id uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; n int; was_active boolean; linked jsonb; sales_links jsonb;
begin
  select * into a from approval_private.actor();
  if a.role is distinct from 'superadmin' then return approval_private.err('forbidden'); end if;
  was_active := approval_private.v2_active(p_project_id);
  if p_mode = 'v2' and not was_active then
    -- أي مستند لم يُحسم (مرفوع أو قيد القراءة أو مقروء أو تعذّرت قراءته) بلا ملف
    select count(*) into n from public.documents where project_id = p_project_id and status not in ('approved', 'rejected') and coalesce(file_url, '') = '';
    if n > 0 then return approval_private.err('documents_without_file', jsonb_build_object('count', n)); end if;
  end if;
  insert into approval_private.settings (project_id, mode, updated_by) values (p_project_id, p_mode, a.id)
  on conflict (project_id) do update set mode = excluded.mode, updated_by = excluded.updated_by;
  if p_mode = 'v2' and not was_active then
    linked := approval_private.link_legacy_categories(p_project_id);
    sales_links := approval_private.link_legacy_sales_reports(p_project_id);
  end if;
  return jsonb_build_object('ok', true, 'mode', p_mode) || case when linked is not null then jsonb_build_object('linked', linked) else '{}' end
    || case when sales_links is not null then jsonb_build_object('sales_links', sales_links) else '{}' end;
exception when sqlstate 'P0001' then return approval_private.err('mode_locked');
end $$;

-- منشآت مفعّلة قبل هذه الهجرة (لا شيء في الإنتاج؛ قد توجد محليًا): تُربط تقاريرها السابقة الآن بالشروط نفسها
do $$ declare p uuid; begin
  for p in select project_id from approval_private.settings where mode in ('v2', 'paused') loop
    perform approval_private.link_legacy_sales_reports(p);
  end loop;
end $$;

notify pgrst, 'reload schema';
