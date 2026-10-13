-- =============================================================================
-- اعتماد المستندات — المسار الجديد (v2): عملية واحدة في الخادم، في معاملة واحدة.
--
-- • الجداول الجديدة في مخطط approval_private غير المكشوف للواجهة البرمجية؛ الواجهة تصل إليها
--   عبر الدوال فقط. الدوال SECURITY DEFINER بـ search_path فارغ وأسماء مؤهلة.
-- • إضافات فقط على الجداول القائمة (أعمدة تقبل NULL أو لها افتراضي). لا تعديل لصفوف قائمة.
-- • الوضع لكل منشأة: legacy (المسار القديم كما هو) ← v2 ⇄ paused. لا عودة إلى legacy بعد v2.
-- • حذف فهرس القيود القديم في ملف منفصل (20260928000100)، بعد انتقال كل المنشآت إلى v2.
-- =============================================================================

create schema if not exists approval_private;
revoke all on schema approval_private from public;

-- ── إضافات على الجداول القائمة ───────────────────────────────────────────────
alter table public.documents
  add column if not exists version int not null default 0,
  add column if not exists approval_path text,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_reason text;
alter table public.ledger_entries
  add column if not exists document_id uuid,
  add column if not exists document_invoice_id uuid,
  add column if not exists invoice_number text;
alter table public.document_items
  add column if not exists ledger_entry_id uuid,
  add column if not exists document_invoice_id uuid;

-- ── الجداول الجديدة ──────────────────────────────────────────────────────────
create table approval_private.settings (
  project_id uuid primary key references public.projects(id),
  mode text not null default 'legacy' check (mode in ('legacy', 'v2', 'paused')),
  v2_enabled_at timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- كل فاتورة داخل المستند: معرّف ثابت وحالة محفوظة في الخادم
create table approval_private.document_invoices (
  id uuid primary key,
  document_id uuid not null references public.documents(id),
  project_id uuid not null,
  idx int not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'excluded')),
  kind text,                                   -- expense | sales | transfer | credit
  invoice_number_raw text,                     -- كما في المستند
  invoice_number_norm text,                    -- بعد التطبيع (للمقارنة فقط)
  supplier_key text,
  supplier_label text,
  invoice_date date,
  total numeric(14, 2),
  journal_number text,
  original_reading jsonb,                      -- نتيجة القراءة لهذه الفاتورة وقت التجهيز
  approved_payload jsonb,                      -- ما اعتُمد فعلًا بعد المراجعة
  review_changes jsonb,                        -- سجل التعديلات بين القراءة والاعتماد
  duplicate_decision jsonb,                    -- «ليست مكررة» وسببها ومن قرر
  excluded_reason text,
  decided_by uuid,
  decided_at timestamptz,
  request_id uuid,
  created_at timestamptz not null default now()
);
create index on approval_private.document_invoices (document_id);
-- فاتورة مصروفات برقم: مرة واحدة لكل (منشأة، مورد، رقم). النطاق مورد واحد لأن الترقيم يخص كل مورد.
create unique index document_invoices_number_once on approval_private.document_invoices (project_id, kind, supplier_key, invoice_number_norm)
  where status = 'approved' and invoice_number_norm is not null and kind in ('expense', 'credit');
create index on approval_private.document_invoices (project_id, invoice_number_norm) where status = 'approved';
create index on approval_private.document_invoices (project_id, supplier_key, invoice_date, total) where status = 'approved';

-- طلبات الاعتماد: نفس المعرّف بنفس البيانات يعيد النتيجة؛ ببيانات مختلفة يُرفض
create table approval_private.requests (
  request_id uuid primary key,
  project_id uuid not null,
  document_id uuid not null,
  action text not null,
  fingerprint text not null,
  actor_id uuid,
  result jsonb not null,
  created_at timestamptz not null default now()
);

-- تقرير المبيعات اليومي: تقرير واحد لكل (منشأة، فرع، يوم). الفرع الفارغ مفتاح صريح «بلا فرع».
-- لا يمس جدول sales نفسه (الإدخال السريع يكتب فيه صفوفًا بلا فرع).
create table approval_private.sales_reports (
  project_id uuid not null,
  branch_key text not null,
  report_date date not null,
  document_id uuid not null,
  invoice_id uuid not null,
  sales_id uuid,
  journal_number text,
  current jsonb not null,                      -- أرقام القنوات الحالية بعد آخر تصحيح
  created_at timestamptz not null default now(),
  primary key (project_id, branch_key, report_date)
);
create table approval_private.sales_report_revisions (
  id bigint generated always as identity primary key,
  project_id uuid not null, branch_key text not null, report_date date not null,
  document_id uuid not null, invoice_id uuid not null,
  previous jsonb not null, corrected jsonb not null, journal_number text,
  actor_id uuid, reason text, created_at timestamptz not null default now()
);

alter table approval_private.settings enable row level security;
alter table approval_private.document_invoices enable row level security;
alter table approval_private.requests enable row level security;
alter table approval_private.sales_reports enable row level security;
alter table approval_private.sales_report_revisions enable row level security;

-- لا عودة إلى legacy بعد تفعيل v2
create function approval_private.settings_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.mode = 'v2' and new.v2_enabled_at is null then new.v2_enabled_at := now(); end if;
  if old is not null and old.v2_enabled_at is not null then
    new.v2_enabled_at := old.v2_enabled_at;
    if new.mode = 'legacy' then raise exception 'approval mode cannot return to legacy after v2' using errcode = 'P0001'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger settings_guard before insert or update on approval_private.settings for each row execute function approval_private.settings_guard();

-- ── أدوات مساعدة (داخلية، بلا صلاحية تنفيذ لأدوار العميل) ─────────────────────
create function approval_private.latin_digits(t text) returns text language sql immutable set search_path = '' as $$
  select translate(t, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')
$$;

-- رقم الفاتورة: أرقام لاتينية، وشرطات موحّدة، وحروف كبيرة، وبلا مسافات. لا تُحذف الأصفار ولا الرموز.
create function approval_private.norm_invoice_number(t text) returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(upper(translate(approval_private.latin_digits(normalize(coalesce(t, ''), NFKC)),
         '‐‑‒–—―−／', '--------/')), '\s+', '', 'g'), '')
$$;

-- اسم المورد للمقارنة: توحيد أشكال الألف والياء والتاء المربوطة، وحذف التطويل، وضم المسافات
create function approval_private.norm_name(t text) returns text language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(translate(normalize(coalesce(t, ''), NFKC), 'أإآىةـ', 'اااية'), '\s+', ' ', 'g')), '')
$$;

-- مبلغ بهللتين على الأكثر؛ غير ذلك خطأ صريح (لا تقريب صامت)
create function approval_private.money(v jsonb, field text) returns numeric language plpgsql immutable set search_path = '' as $$
declare x numeric;
begin
  if v is null or v = 'null'::jsonb or btrim(v #>> '{}') = '' then return 0; end if;
  begin x := (approval_private.latin_digits(v #>> '{}'))::numeric;
  exception when others then raise exception 'APPROVAL:invalid_amount:%', field using errcode = 'P0001'; end;
  if x <> round(x, 2) then raise exception 'APPROVAL:too_many_decimals:%', field using errcode = 'P0001'; end if;
  return x;
end $$;

-- توزيع مبلغ على أوزان بالهللة، بطريقة الباقي الأكبر (التعادل لأسبق بند). المجموع يساوي المبلغ تمامًا.
create function approval_private.allocate(weights numeric[], amount numeric) returns numeric[] language plpgsql immutable set search_path = '' as $$
declare
  n int := coalesce(array_length(weights, 1), 0);
  total_h bigint := round(amount * 100);
  w bigint[]; sumw bigint := 0; base bigint[]; rem bigint[]; left_h bigint; i int; r record; out numeric[];
begin
  if n = 0 then return '{}'; end if;
  w := array(select round(x * 100)::bigint from unnest(weights) x);
  for i in 1..n loop
    if w[i] < 0 then raise exception 'APPROVAL:negative_items' using errcode = 'P0001'; end if;
    sumw := sumw + w[i];
  end loop;
  if sumw = 0 then
    if total_h = 0 then return array_fill(0::numeric, array[n]); end if;
    raise exception 'APPROVAL:zero_items_nonzero_vat' using errcode = 'P0001';
  end if;
  base := array_fill(0::bigint, array[n]); rem := array_fill(0::bigint, array[n]);
  left_h := total_h;
  for i in 1..n loop
    base[i] := (total_h * w[i]) / sumw; rem[i] := (total_h * w[i]) % sumw; left_h := left_h - base[i];
  end loop;
  for r in select k from generate_subscripts(rem, 1) k order by rem[k] desc, k asc limit left_h loop
    base[r.k] := base[r.k] + 1;
  end loop;
  out := array(select round(b::numeric / 100, 2) from unnest(base) b);
  return out;
end $$;

-- ترقيم القيود: نطاقه (منشأة، سنة). صف العدّاد يُقفل حتى نهاية المعاملة، فلا يأخذ طلبان متزامنان — من أي
-- مسار يمر هنا — الرقم نفسه. يبدأ من أكبر رقم قائم رقميًا (لا نصيًا: 1000 بعد 999)، ولا ينزل عنه أبدًا.
create table approval_private.journal_counters (
  project_id uuid not null,
  year int not null,
  last_seq int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (project_id, year)
);
alter table approval_private.journal_counters enable row level security;

create function approval_private.next_journal(p_project uuid, p_date date) returns text language plpgsql set search_path = '' as $$
declare y int := extract(year from p_date); v_last int; v_max int;
begin
  insert into approval_private.journal_counters (project_id, year) values (p_project, y) on conflict do nothing;
  select last_seq into v_last from approval_private.journal_counters where project_id = p_project and year = y for update;
  -- أرقام كتبتها مسارات لا تمر بالعدّاد (قيود قديمة، أو إدخال يدوي): لا يُعاد استعمالها
  select coalesce(max(nullif(split_part(journal_number, '-', 3), '')::int), 0) into v_max
    from public.ledger_entries where project_id = p_project and journal_number ~ ('^QD-' || y || '-[0-9]+$');
  v_last := greatest(v_last, v_max) + 1;
  update approval_private.journal_counters set last_seq = v_last, updated_at = now() where project_id = p_project and year = y;
  -- lpad يقصّ الأطول من ثلاث خانات (1000 تصير 100)، فيُكمَّل بالأصفار فقط حين يكون أقصر
  return 'QD-' || y || '-' || case when v_last < 100 then lpad(v_last::text, 3, '0') else v_last::text end;
end $$;

create function approval_private.actor() returns table (id uuid, role text, project_id uuid, name text) language sql stable security definer set search_path = '' as $$
  select u.id, u.role, u.project_id, u.name from public.app_users u where u.auth_id = auth.uid() limit 1
$$;

-- صلاحية الاعتماد: من صف المستخدم المرتبط بهوية الجلسة (auth.uid()) لا من أي قيمة يرسلها المتصفح.
-- في التطبيق: الاعتماد للمحاسب (صفحة المستندات الجديدة). المنشأة المعطّلة من المشرف لا تعتمد.
-- (لا عمود تعطيل لكل مستخدم في الجدول الحالي؛ فصل الحساب يكون بإلغاء ربطه بهويته.)
create function approval_private.can_approve(p_role text, p_project uuid) returns boolean language sql stable set search_path = '' as $$
  select p_role = 'accountant'
     and p_project is not null
     and coalesce((select ps.active from public.project_settings ps where ps.project_id = p_project), true)
$$;

create function approval_private.err(code text, detail jsonb default '{}') returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('ok', false, 'code', code) || coalesce(detail, '{}')
$$;

create function approval_private.mode_of(p_project uuid) returns text language sql stable set search_path = '' as $$
  select coalesce((select mode from approval_private.settings where project_id = p_project), 'legacy')
$$;

-- ── واجهات للعميل ────────────────────────────────────────────────────────────

-- وضع الاعتماد لمنشأة المستخدم
create function public.approval_mode(p_project_id uuid) returns text language plpgsql stable security definer set search_path = '' as $$
declare a record;
begin
  select * into a from approval_private.actor();
  if a.id is null or (a.role <> 'superadmin' and a.project_id is distinct from p_project_id) then return null; end if;
  return approval_private.mode_of(p_project_id);
end $$;

-- تغيير الوضع: المشرف فقط. لا عودة إلى legacy بعد v2 (يفرضه settings_guard)
create function public.approval_set_mode(p_project_id uuid, p_mode text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from approval_private.actor();
  if a.role is distinct from 'superadmin' then return approval_private.err('forbidden'); end if;
  insert into approval_private.settings (project_id, mode, updated_by) values (p_project_id, p_mode, a.id)
  on conflict (project_id) do update set mode = excluded.mode, updated_by = excluded.updated_by;
  return jsonb_build_object('ok', true, 'mode', p_mode);
exception when sqlstate 'P0001' then return approval_private.err('mode_locked');
end $$;

-- ── تجهيز المستند: معرّف ثابت لكل فاتورة وحالتها ─────────────────────────────
create function public.approval_prepare(p_document_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; d record; invs jsonb; el jsonb; i int := 0; new_invs jsonb := '[]'; v_id uuid; v_mode text;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  select * into d from public.documents where id = p_document_id for update;
  if d.id is null or a.project_id is distinct from d.project_id then return approval_private.err('not_found'); end if;
  if not approval_private.can_approve(a.role, d.project_id) then return approval_private.err('forbidden'); end if;
  v_mode := approval_private.mode_of(d.project_id);
  if v_mode = 'legacy' then return approval_private.err('legacy_mode'); end if;

  if d.status = 'analyzed' and d.analysis_result is not null
     and not exists (select 1 from approval_private.document_invoices where document_id = d.id) then
    invs := case when jsonb_typeof(d.analysis_result -> 'invoices') = 'array' then d.analysis_result -> 'invoices'
                 else jsonb_build_array(d.analysis_result) end;
    for el in select value from jsonb_array_elements(invs) loop
      i := i + 1;
      v_id := case when (el ->> '_id') ~* '^[0-9a-f-]{36}$' then (el ->> '_id')::uuid else gen_random_uuid() end;
      el := jsonb_set(el, '{_id}', to_jsonb(v_id::text));
      new_invs := new_invs || jsonb_build_array(el);
      insert into approval_private.document_invoices (id, document_id, project_id, idx, original_reading)
      values (v_id, d.id, d.project_id, i, el);
    end loop;
    update public.documents
       set analysis_result = case when jsonb_typeof(d.analysis_result -> 'invoices') = 'array'
                                  then jsonb_set(d.analysis_result, '{invoices}', new_invs)
                                  else jsonb_build_object('invoices', new_invs) end,
           version = version + 1
     where id = d.id
     returning * into d;
  end if;

  return jsonb_build_object('ok', true, 'mode', v_mode, 'version', d.version, 'status', d.status,
    'analysis_result', d.analysis_result,
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'idx', x.idx, 'status', x.status,
                 'journal_number', x.journal_number, 'excluded_reason', x.excluded_reason) order by x.idx)
               from approval_private.document_invoices x where x.document_id = d.id), '[]'));
end $$;

-- ── خطة فاتورة واحدة (تحقق بلا كتابة) ────────────────────────────────────────
-- تعيد الخطة، أو {ok:false, code…} لخطأ عمل. لا تكتب شيئًا.
create function approval_private.plan_invoice(d public.documents, inv jsonb, p_decisions jsonb, p_document jsonb, v_known boolean)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_id uuid := (inv ->> '_id')::uuid; v_kind text; v_total numeric; v_vat numeric; v_pay text; v_type text; v_basis text; v_date date;
  v_items jsonb; v_amounts numeric[]; v_vats numeric[]; v_sum numeric; v_n int; k int; v_groups jsonb; v_item jsonb; v_main text;
  v_gross numeric; v_label text; v_key text; v_num_raw text; v_num text; v_supplier uuid; v_sup_new boolean := false;
  v_link record; v_dec jsonb; v_branch text; v_branch_key text; v_branches jsonb; v_ch jsonb; v_sales_sum numeric; plan jsonb;
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
  if v_n > 0 then
    v_amounts := array(select approval_private.money(x -> 'amount', 'items.amount') from jsonb_array_elements(v_items) x);
    v_sum := (select sum(x) from unnest(v_amounts) x);
    if (v_basis = 'inclusive' and v_sum <> v_total) or (v_basis = 'exclusive' and v_sum + v_vat <> v_total) then
      return approval_private.err('amounts_mismatch', jsonb_build_object('invoice_id', v_id, 'basis', v_basis, 'items_total', v_sum,
        'total', v_total, 'vat', v_vat, 'difference', case when v_basis = 'inclusive' then v_sum - v_total else v_sum + v_vat - v_total end));
    end if;
    v_vats := approval_private.allocate(v_amounts, v_vat);
    for k in 1..v_n loop
      v_item := v_items -> (k - 1);
      v_main := coalesce(nullif(v_item ->> 'category_main', ''), nullif(inv ->> 'category_main', ''));
      v_gross := case when v_basis = 'inclusive' then v_amounts[k] else v_amounts[k] + v_vats[k] end;
      v_item := jsonb_build_object('description', coalesce(nullif(v_item ->> 'description', ''), v_label, ''), 'amount', v_gross, 'vat', v_vats[k],
        'main', v_main, 'sub', nullif(v_item ->> 'category_sub', ''), 'sort', k,
        'type', coalesce(case when v_n = 1 then v_type end, nullif(v_item ->> 'ledger_type', ''), v_type, '🛒 مصروفات تشغيلية'));
      if exists (select 1 from jsonb_array_elements(v_groups) gg where gg ->> 'main' is not distinct from v_main) then
        v_groups := (select jsonb_agg(case when gg ->> 'main' is not distinct from v_main
            then gg || jsonb_build_object('gross', (gg ->> 'gross')::numeric + v_gross, 'vat', (gg ->> 'vat')::numeric + v_vats[k],
                                          'items', (gg -> 'items') || jsonb_build_array(v_item))
            else gg end) from jsonb_array_elements(v_groups) gg);
      else
        v_groups := v_groups || jsonb_build_array(jsonb_build_object('main', v_main, 'type', v_item -> 'type', 'gross', v_gross,
          'vat', v_vats[k], 'items', jsonb_build_array(v_item)));
      end if;
    end loop;
  else
    v_groups := jsonb_build_array(jsonb_build_object('main', nullif(inv ->> 'category_main', ''), 'type', v_type,
      'gross', v_total, 'vat', v_vat, 'sub', nullif(inv ->> 'category_sub', ''), 'items', '[]'::jsonb));
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

  return plan || jsonb_build_object('total', v_total, 'vat', v_vat, 'basis', v_basis, 'type', v_type, 'groups', v_groups,
    'supplier_id', v_supplier, 'supplier_new', v_sup_new, 'supplier_key', v_key, 'label', v_label,
    'incoming', coalesce(v_type, '') like '%تحصيل جملة%', 'duplicate_decision', v_dec);
exception when sqlstate 'P0001' then
  if sqlerrm like 'APPROVAL:%' then
    return approval_private.err(split_part(sqlerrm, ':', 2), jsonb_build_object('invoice_id', v_id, 'field', split_part(sqlerrm, ':', 3)));
  end if;
  raise;
end $$;

-- ── كتابة فاتورة وفق خطتها (داخل معاملة الاعتماد) ────────────────────────────
create function approval_private.write_invoice(d public.documents, plan jsonb, p_actor uuid, p_request uuid) returns text
language plpgsql set search_path = '' as $$
declare
  v_id uuid := (plan ->> 'id')::uuid; v_date date := (plan ->> 'date')::date; v_kind text := plan ->> 'kind';
  jn text; v_ch jsonb; s_id uuid; v_total numeric; v_type text; v_pay text := plan ->> 'pay'; v_supplier uuid; v_incoming boolean;
  g jsonb; v_gross numeric; le_id uuid; v_key text := plan ->> 'supplier_key'; v_branch text := plan ->> 'branch';
begin
  if not (plan ->> 'known')::boolean then
    insert into approval_private.document_invoices (id, document_id, project_id, idx)
    values (v_id, d.id, d.project_id, coalesce((select max(idx) from approval_private.document_invoices where document_id = d.id), 0) + 1);
  end if;
  jn := approval_private.next_journal(d.project_id, v_date);

  if v_kind = 'sales' then
    v_ch := plan -> 'channels';
    insert into public.sales (project_id, date, cash_sales, network_sales, hunger_sales, jahez_sales, keeta_sales, description, branch)
    values (d.project_id, v_date, (v_ch ->> 'cash')::numeric, (v_ch ->> 'network')::numeric, (v_ch ->> 'hunger')::numeric,
            (v_ch ->> 'jahez')::numeric, (v_ch ->> 'keeta')::numeric, 'تقرير POS', v_branch)
    returning id into s_id;
    insert into public.ledger_entries (project_id, date, type, description, cash_in, cash_out, bank_in, bank_out, custody_in, custody_out,
      receivable_in, receivable_out, total_amount, status, journal_number, file_url, branch, document_id, document_invoice_id)
    select d.project_id, v_date, t.type, t.description, t.cash_in, 0, t.bank_in, 0, 0, 0, t.recv, 0, t.amount, 'approved', jn,
           coalesce(d.file_url, ''), v_branch, d.id, v_id
      from (values
        ('💵 مبيعات كاش', 'مبيعات كاش — POS', (v_ch ->> 'cash')::numeric, 0::numeric, 0::numeric, (v_ch ->> 'cash')::numeric),
        ('🏦 مبيعات شبكة', 'مبيعات شبكة — POS', 0, (v_ch ->> 'network')::numeric, 0, (v_ch ->> 'network')::numeric),
        ('💸 مبيعات تحويل', 'مبيعات تحويل — POS', 0, (v_ch ->> 'transfer')::numeric, 0, (v_ch ->> 'transfer')::numeric),
        ('🍔 مبيعات هنقر ستيشن', 'ذمم هنقر — POS', 0, 0, (v_ch ->> 'hunger')::numeric, (v_ch ->> 'hunger')::numeric),
        ('🛵 مبيعات جاهز', 'ذمم جاهز — POS', 0, 0, (v_ch ->> 'jahez')::numeric, (v_ch ->> 'jahez')::numeric),
        ('🛺 مبيعات كيتا', 'ذمم كيتا — POS', 0, 0, (v_ch ->> 'keeta')::numeric, (v_ch ->> 'keeta')::numeric),
        ('🛵 مبيعات مرسول', 'ذمم مرسول — POS', 0, 0, (v_ch ->> 'mrsool')::numeric, (v_ch ->> 'mrsool')::numeric)
      ) as t(type, description, cash_in, bank_in, recv, amount)
     where t.amount > 0;
    insert into approval_private.sales_reports (project_id, branch_key, report_date, document_id, invoice_id, sales_id, journal_number, current)
    values (d.project_id, plan ->> 'branch_key', v_date, d.id, v_id, s_id, jn, v_ch);

  elsif v_kind = 'transfer' then
    -- مطابق لمنطق المسار السابق، مع قراءة المبلغ من amount أو totalAmount
    v_total := (plan ->> 'total')::numeric; v_type := plan ->> 'trans_type';
    insert into public.ledger_entries (project_id, date, type, description, cash_in, bank_in, custody_in, cash_out, bank_out, custody_out,
      receivable_in, receivable_out, vat_amount, total_amount, status, file_url, journal_number, branch, document_id, document_invoice_id)
    values (d.project_id, v_date,
      coalesce(v_type, '🏧 تحويل داخلي — إيداع نقدي'), coalesce(plan ->> 'description', d.file_name),
      0,
      case when v_type like '%تحصيل ذمم%' or v_type is null or v_type like '%إيداع نقدي%' then v_total else 0 end,
      case when v_type like '%صرف عهدة%' then v_total else 0 end,
      case when v_type like '%تحصيل ذمم%' or v_type like '%صرف عهدة%' then 0
           when v_type is null or v_type like '%إيداع نقدي%' then v_total
           when v_pay = 'cash' then v_total else 0 end,
      case when v_type like '%صرف عهدة%' then v_total
           when v_type like '%تحصيل ذمم%' or v_type is null or v_type like '%إيداع نقدي%' then 0
           when v_pay = 'bank' then v_total else 0 end,
      case when v_type like '%تحصيل ذمم%' or v_type like '%صرف عهدة%' or v_type is null or v_type like '%إيداع نقدي%' then 0
           when v_pay = 'custody' then v_total else 0 end,
      0, case when v_type like '%تحصيل ذمم%' then v_total else 0 end,
      0, v_total, 'approved', coalesce(d.file_url, ''), jn, v_branch, d.id, v_id);

  elsif v_kind = 'credit' then
    insert into public.supplier_transactions (supplier_id, project_id, type, amount, date, notes, document_id, journal_number)
    values ((plan ->> 'supplier_id')::uuid, d.project_id, 'invoice', (plan ->> 'total')::numeric, v_date,
            coalesce(plan ->> 'description', d.file_name), d.id, jn);

  else
    v_supplier := nullif(plan ->> 'supplier_id', '')::uuid;
    if (plan ->> 'supplier_new')::boolean then
      insert into public.payable_suppliers (project_id, name) values (d.project_id, plan ->> 'label') returning id into v_supplier;
      v_key := 'ps:' || v_supplier;
    end if;
    v_incoming := (plan ->> 'incoming')::boolean;
    for g in select value from jsonb_array_elements(plan -> 'groups') loop
      v_gross := (g ->> 'gross')::numeric;
      insert into public.ledger_entries (project_id, date, type, description, cash_out, bank_out, custody_out, cash_in, bank_in, custody_in,
        payable_in, payable_out, supplier_id, vat_amount, total_amount, status, file_url, journal_number, branch, purchase_category,
        category_main, category_sub, document_id, document_invoice_id, invoice_number)
      values (d.project_id, v_date, coalesce(g ->> 'type', '🛒 مصروفات تشغيلية'), coalesce(plan ->> 'description', d.file_name),
        case when not v_incoming and v_pay = 'cash' then v_gross else 0 end,
        case when not v_incoming and v_pay = 'bank' then v_gross else 0 end,
        case when not v_incoming and v_pay = 'custody' then v_gross else 0 end,
        case when v_incoming and v_pay = 'cash' then v_gross else 0 end,
        case when v_incoming and v_pay = 'bank' then v_gross else 0 end,
        case when v_incoming and v_pay = 'custody' then v_gross else 0 end,
        case when not v_incoming and v_pay = 'payable' then v_gross else 0 end, 0,
        v_supplier, (g ->> 'vat')::numeric, v_gross, 'approved', coalesce(d.file_url, ''), jn, v_branch, d.purchase_category,
        g ->> 'main', g ->> 'sub', d.id, v_id, plan ->> 'number_raw')
      returning id into le_id;
      insert into public.document_items (document_id, project_id, journal_number, description, amount, vat_amount, category_main, category_sub,
        sort_order, ledger_entry_id, document_invoice_id)
      select d.id, d.project_id, jn, x ->> 'description', (x ->> 'amount')::numeric, (x ->> 'vat')::numeric, x ->> 'main', x ->> 'sub',
             (x ->> 'sort')::int, le_id, v_id
        from jsonb_array_elements(g -> 'items') x;
    end loop;
  end if;

  update approval_private.document_invoices set
    status = 'approved', kind = v_kind, invoice_number_raw = plan ->> 'number_raw', invoice_number_norm = plan ->> 'number',
    supplier_key = v_key, supplier_label = coalesce(plan ->> 'label', plan ->> 'description'),
    invoice_date = v_date, total = (plan ->> 'total')::numeric, journal_number = jn,
    approved_payload = plan -> 'payload', review_changes = plan -> 'payload' -> 'review_changes',
    duplicate_decision = case when jsonb_typeof(plan -> 'duplicate_decision') = 'object'
                              then (plan -> 'duplicate_decision') || jsonb_build_object('by', p_actor, 'at', now()) end,
    decided_by = p_actor, decided_at = now(), request_id = p_request
  where id = v_id;
  return jn;
end $$;

-- ── إغلاق المستند بعد قرار على فواتيره ───────────────────────────────────────
create function approval_private.finish_document(d public.documents, p_actor uuid, p_first_jn text, p_document jsonb) returns public.documents
language plpgsql set search_path = '' as $$
declare v_pending int; v_approved int; r public.documents;
begin
  select count(*) filter (where status = 'pending'), count(*) filter (where status = 'approved') into v_pending, v_approved
    from approval_private.document_invoices where document_id = d.id;
  update public.documents set
    status = case when v_pending > 0 then status when v_approved > 0 then 'approved' else 'rejected' end,
    journal_number = coalesce(journal_number, p_first_jn),
    branch = coalesce(nullif(btrim(coalesce(p_document ->> 'branch', '')), ''), branch),
    file_name = case when v_pending = 0 and v_approved > 0 then coalesce(nullif(p_document ->> 'file_name', ''), file_name) else file_name end,
    category_main = case when v_pending = 0 then null else category_main end,
    category_sub = case when v_pending = 0 then null else category_sub end,
    approval_path = 'v2',
    approved_by = case when v_pending = 0 and v_approved > 0 then p_actor else approved_by end,
    approved_at = case when v_pending = 0 and v_approved > 0 then now() else approved_at end,
    version = version + 1
  where id = d.id returning * into r;
  return r;
end $$;

-- ── الاعتماد: فاتورة واحدة، أو «المتبقي كله» في معاملة واحدة ─────────────────
-- p_invoices: الفواتير بعد المراجعة، لكلٍّ «_id». p_decisions: { suppliers: {<id>: {resolution, supplier_id}},
-- duplicates: {<id>: {reason, linked}} }. p_document: { branch, file_name, supplier_id }
create function public.approval_approve(p_document_id uuid, p_request_id uuid, p_expected_version int,
  p_invoices jsonb, p_decisions jsonb default '{}', p_document jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a record; d public.documents; rq record; di record; inv jsonb; plan jsonb; plans jsonb := '[]'; journals jsonb := '[]'; res jsonb;
  fp text := md5(jsonb_build_array(p_document_id, p_invoices, coalesce(p_decisions, '{}'), coalesce(p_document, '{}'))::text);
  v_id uuid; v_seen text[] := '{}'; v_num_keys text[] := '{}'; jn text; v_first_jn text; v_pending int;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if p_request_id is null then return approval_private.err('request_id_required'); end if;

  select * into rq from approval_private.requests where request_id = p_request_id;
  if found then
    if rq.fingerprint = fp and rq.document_id = p_document_id then return rq.result || '{"replayed": true}'; end if;
    return approval_private.err('request_reused');
  end if;

  select * into d from public.documents where id = p_document_id for update;
  if d.id is null or a.project_id is distinct from d.project_id then return approval_private.err('not_found'); end if;
  if not approval_private.can_approve(a.role, d.project_id) then return approval_private.err('forbidden'); end if;
  case approval_private.mode_of(d.project_id)
    when 'legacy' then return approval_private.err('legacy_mode');
    when 'paused' then return approval_private.err('paused');
    else null;
  end case;
  perform pg_advisory_xact_lock(hashtextextended('approval:' || d.project_id::text, 0));

  -- طلب مطابق اكتمل أثناء الانتظار على القفل
  select * into rq from approval_private.requests where request_id = p_request_id;
  if found then
    if rq.fingerprint = fp and rq.document_id = p_document_id then return rq.result || '{"replayed": true}'; end if;
    return approval_private.err('request_reused');
  end if;

  if d.status = 'approved' then
    return approval_private.err('already_approved', jsonb_build_object('journal_number', d.journal_number, 'approved_at', d.approved_at));
  end if;
  if d.status <> 'analyzed' then return approval_private.err('bad_status', jsonb_build_object('status', d.status)); end if;
  if d.version <> p_expected_version then return approval_private.err('stale', jsonb_build_object('version', d.version)); end if;
  if jsonb_typeof(p_invoices) <> 'array' or jsonb_array_length(p_invoices) = 0 then return approval_private.err('empty'); end if;

  -- المرحلة 1: خطة كل فاتورة، بلا أي كتابة
  for inv in select value from jsonb_array_elements(p_invoices) loop
    v_id := nullif(inv ->> '_id', '')::uuid;
    if v_id is null then return approval_private.err('invoice_id_missing'); end if;
    if v_id::text = any (v_seen) then return approval_private.err('duplicate_in_batch', jsonb_build_object('invoice_id', v_id)); end if;
    v_seen := v_seen || v_id::text;
    select * into di from approval_private.document_invoices where id = v_id;
    if found and di.document_id <> d.id then return approval_private.err('invoice_mismatch', jsonb_build_object('invoice_id', v_id)); end if;
    if found and di.status <> 'pending' then
      return approval_private.err('invoice_already_decided', jsonb_build_object('invoice_id', v_id, 'status', di.status, 'journal_number', di.journal_number));
    end if;
    plan := approval_private.plan_invoice(d, inv, coalesce(p_decisions, '{}'), coalesce(p_document, '{}'), di.id is not null);
    if not (plan ->> 'ok')::boolean then return plan; end if;
    if plan ->> 'number' is not null and plan ->> 'kind' in ('expense', 'credit') then
      if (plan ->> 'number') || '|' || (plan ->> 'supplier_key') = any (v_num_keys) then
        return approval_private.err('duplicate_in_batch', jsonb_build_object('invoice_id', v_id));
      end if;
      v_num_keys := v_num_keys || ((plan ->> 'number') || '|' || (plan ->> 'supplier_key'));
    end if;
    plans := plans || jsonb_build_array(plan);
  end loop;

  -- المرحلة 2: الكتابة كلها في هذه المعاملة. أي خطأ يلغيها كلها
  begin
    for plan in select value from jsonb_array_elements(plans) loop
      jn := approval_private.write_invoice(d, plan, a.id, p_request_id);
      v_first_jn := coalesce(v_first_jn, jn);
      journals := journals || jsonb_build_array(jsonb_build_object('invoice_id', plan ->> 'id', 'journal_number', jn));
    end loop;
  exception when unique_violation then
    return approval_private.err('duplicate_invoice', jsonb_build_object('detail', 'concurrent'));
  end;

  d := approval_private.finish_document(d, a.id, v_first_jn, coalesce(p_document, '{}'));
  select count(*) into v_pending from approval_private.document_invoices where document_id = d.id and status = 'pending';
  res := jsonb_build_object('ok', true, 'document_status', d.status, 'version', d.version, 'journals', journals, 'pending', v_pending);
  insert into approval_private.requests (request_id, project_id, document_id, action, fingerprint, actor_id, result)
  values (p_request_id, d.project_id, d.id, 'approve', fp, a.id, res);
  return res;
end $$;

-- ── استبعاد فاتورة من مستند (لا تُسجَّل) ─────────────────────────────────────
create function public.approval_exclude_invoice(p_document_id uuid, p_invoice_id uuid, p_expected_version int, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; d public.documents; di record;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  select * into d from public.documents where id = p_document_id for update;
  if d.id is null or a.project_id is distinct from d.project_id then return approval_private.err('not_found'); end if;
  if not approval_private.can_approve(a.role, d.project_id) then return approval_private.err('forbidden'); end if;
  if approval_private.mode_of(d.project_id) <> 'v2' then return approval_private.err(approval_private.mode_of(d.project_id) || '_mode'); end if;
  if d.status <> 'analyzed' then return approval_private.err('bad_status', jsonb_build_object('status', d.status)); end if;
  if d.version <> p_expected_version then return approval_private.err('stale', jsonb_build_object('version', d.version)); end if;
  select * into di from approval_private.document_invoices where id = p_invoice_id and document_id = d.id for update;
  if not found then return approval_private.err('invoice_unknown'); end if;
  if di.status <> 'pending' then return approval_private.err('invoice_already_decided', jsonb_build_object('status', di.status)); end if;
  update approval_private.document_invoices set status = 'excluded', excluded_reason = p_reason, decided_by = a.id, decided_at = now()
   where id = p_invoice_id;
  d := approval_private.finish_document(d, a.id, null, '{}');
  return jsonb_build_object('ok', true, 'document_status', d.status, 'version', d.version);
end $$;

-- ── رفض المستند كله (لا يُسمح بعد اعتماد أي فاتورة منه) ───────────────────────
create function public.approval_reject_document(p_document_id uuid, p_expected_version int, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; d public.documents;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  select * into d from public.documents where id = p_document_id for update;
  if d.id is null or a.project_id is distinct from d.project_id then return approval_private.err('not_found'); end if;
  if not approval_private.can_approve(a.role, d.project_id) then return approval_private.err('forbidden'); end if;
  if approval_private.mode_of(d.project_id) = 'legacy' then return approval_private.err('legacy_mode'); end if;
  if d.status not in ('uploaded', 'analyzed') then return approval_private.err('bad_status', jsonb_build_object('status', d.status)); end if;
  if d.version <> p_expected_version then return approval_private.err('stale', jsonb_build_object('version', d.version)); end if;
  if exists (select 1 from approval_private.document_invoices where document_id = d.id and status = 'approved') then
    return approval_private.err('partially_approved');
  end if;
  update approval_private.document_invoices set status = 'excluded', excluded_reason = coalesce(p_reason, 'رُفض المستند'), decided_by = a.id, decided_at = now()
   where document_id = d.id and status = 'pending';
  update public.documents set status = 'rejected', rejected_reason = nullif(btrim(coalesce(p_reason, '')), ''), approval_path = 'v2', version = version + 1
   where id = d.id returning * into d;
  return jsonb_build_object('ok', true, 'document_status', d.status, 'version', d.version);
end $$;

-- ── تصحيح تقرير مبيعات يومي موجود (مسار منفصل عن إنشاء تقرير) ────────────────
-- لا يعدّل القيود السابقة: يضيف قيود فرق بإشارة موجبة أو سالبة، ويحدّث صف المبيعات، ويحفظ النسخة السابقة.
create function public.approval_correct_sales_report(p_document_id uuid, p_request_id uuid, p_expected_version int,
  p_invoice jsonb, p_reason text, p_document jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a record; d public.documents; rq record; di record; r record; v_id uuid := nullif(p_invoice ->> '_id', '')::uuid;
  fp text := md5(jsonb_build_array('correct', p_document_id, p_invoice, p_reason, coalesce(p_document, '{}'))::text);
  v_date date; v_branch text; v_branch_key text; v_branches jsonb; v_new jsonb; v_old jsonb; jn text; res jsonb; k text; v_delta numeric;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if p_request_id is null then return approval_private.err('request_id_required'); end if;
  select * into rq from approval_private.requests where request_id = p_request_id;
  if found then
    if rq.fingerprint = fp then return rq.result || '{"replayed": true}'; end if;
    return approval_private.err('request_reused');
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then return approval_private.err('reason_required'); end if;
  select * into d from public.documents where id = p_document_id for update;
  if d.id is null or a.project_id is distinct from d.project_id then return approval_private.err('not_found'); end if;
  if not approval_private.can_approve(a.role, d.project_id) then return approval_private.err('forbidden'); end if;
  if approval_private.mode_of(d.project_id) <> 'v2' then return approval_private.err(approval_private.mode_of(d.project_id) || '_mode'); end if;
  perform pg_advisory_xact_lock(hashtextextended('approval:' || d.project_id::text, 0));
  if d.status <> 'analyzed' then return approval_private.err('bad_status', jsonb_build_object('status', d.status)); end if;
  if d.version <> p_expected_version then return approval_private.err('stale', jsonb_build_object('version', d.version)); end if;
  select * into di from approval_private.document_invoices where id = v_id and document_id = d.id for update;
  if not found or di.status <> 'pending' then return approval_private.err('invoice_unknown'); end if;
  if p_invoice ->> 'type' <> 'sales' then return approval_private.err('not_sales'); end if;

  v_date := nullif(p_invoice ->> 'date', '')::date;
  v_branch := nullif(btrim(coalesce(p_document ->> 'branch', d.branch, '')), '');
  select settings -> 'branches' into v_branches from public.project_settings where project_id = d.project_id;
  v_branch_key := case when jsonb_typeof(v_branches) = 'array' and jsonb_array_length(v_branches) > 0 then v_branch else coalesce(v_branch, '∅') end;
  select * into r from approval_private.sales_reports where project_id = d.project_id and branch_key = v_branch_key and report_date = v_date for update;
  if not found then return approval_private.err('no_report_to_correct'); end if;
  begin
    v_new := jsonb_build_object(
      'cash', approval_private.money(p_invoice -> 'cashSales', 'cashSales'), 'network', approval_private.money(p_invoice -> 'networkSales', 'networkSales'),
      'transfer', approval_private.money(p_invoice -> 'transferSales', 'transferSales'), 'hunger', approval_private.money(p_invoice -> 'hungerSales', 'hungerSales'),
      'jahez', approval_private.money(p_invoice -> 'jahez', 'jahez'), 'keeta', approval_private.money(p_invoice -> 'keeta', 'keeta'),
      'mrsool', approval_private.money(p_invoice -> 'mrsool', 'mrsool'));
  exception when sqlstate 'P0001' then return approval_private.err(split_part(sqlerrm, ':', 2)); end;
  v_old := r.current;
  if v_new = v_old then return approval_private.err('no_change'); end if;

  jn := approval_private.next_journal(d.project_id, v_date);
  insert into public.ledger_entries (project_id, date, type, description, cash_in, cash_out, bank_in, bank_out, custody_in, custody_out,
    receivable_in, receivable_out, total_amount, status, journal_number, file_url, branch, document_id, document_invoice_id)
  select d.project_id, v_date, t.type, 'تصحيح تقرير POS — ' || to_char(v_date, 'YYYY-MM-DD'),
         case when t.col = 'cash' then t.delta else 0 end, 0,
         case when t.col in ('bank') then t.delta else 0 end, 0, 0, 0,
         case when t.col = 'recv' then t.delta else 0 end, 0, t.delta, 'approved', jn, coalesce(d.file_url, ''), v_branch, d.id, v_id
    from (values
      ('💵 مبيعات كاش', 'cash', (v_new ->> 'cash')::numeric - (v_old ->> 'cash')::numeric),
      ('🏦 مبيعات شبكة', 'bank', (v_new ->> 'network')::numeric - (v_old ->> 'network')::numeric),
      ('💸 مبيعات تحويل', 'bank', (v_new ->> 'transfer')::numeric - (v_old ->> 'transfer')::numeric),
      ('🍔 مبيعات هنقر ستيشن', 'recv', (v_new ->> 'hunger')::numeric - (v_old ->> 'hunger')::numeric),
      ('🛵 مبيعات جاهز', 'recv', (v_new ->> 'jahez')::numeric - (v_old ->> 'jahez')::numeric),
      ('🛺 مبيعات كيتا', 'recv', (v_new ->> 'keeta')::numeric - (v_old ->> 'keeta')::numeric),
      ('🛵 مبيعات مرسول', 'recv', (v_new ->> 'mrsool')::numeric - (v_old ->> 'mrsool')::numeric)
    ) as t(type, col, delta)
   where t.delta <> 0;
  update public.sales set cash_sales = (v_new ->> 'cash')::numeric, network_sales = (v_new ->> 'network')::numeric,
         hunger_sales = (v_new ->> 'hunger')::numeric, jahez_sales = (v_new ->> 'jahez')::numeric, keeta_sales = (v_new ->> 'keeta')::numeric
   where id = r.sales_id;
  insert into approval_private.sales_report_revisions (project_id, branch_key, report_date, document_id, invoice_id, previous, corrected, journal_number, actor_id, reason)
  values (d.project_id, v_branch_key, v_date, d.id, v_id, v_old, v_new, jn, a.id, p_reason);
  update approval_private.sales_reports set current = v_new where project_id = r.project_id and branch_key = r.branch_key and report_date = r.report_date;
  update approval_private.document_invoices set status = 'approved', kind = 'sales_correction', invoice_date = v_date, journal_number = jn,
         total = (select sum(value::numeric) from jsonb_each_text(v_new)), approved_payload = p_invoice, review_changes = p_invoice -> 'review_changes',
         decided_by = a.id, decided_at = now(), request_id = p_request_id
   where id = v_id;
  d := approval_private.finish_document(d, a.id, jn, coalesce(p_document, '{}'));
  res := jsonb_build_object('ok', true, 'document_status', d.status, 'version', d.version, 'journal_number', jn, 'previous', v_old, 'corrected', v_new);
  insert into approval_private.requests (request_id, project_id, document_id, action, fingerprint, actor_id, result)
  values (p_request_id, d.project_id, d.id, 'correct_sales', fp, a.id, res);
  return res;
end $$;

-- ── الصلاحيات: دوال العميل للمستخدم المسجّل فقط؛ الداخلية لا أحد ─────────────
revoke all on all functions in schema approval_private from public, anon, authenticated;
revoke all on all tables in schema approval_private from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['approval_mode(uuid)', 'approval_set_mode(uuid, text)', 'approval_prepare(uuid)',
    'approval_approve(uuid, uuid, integer, jsonb, jsonb, jsonb)', 'approval_exclude_invoice(uuid, uuid, integer, text)',
    'approval_reject_document(uuid, integer, text)', 'approval_correct_sales_report(uuid, uuid, integer, jsonb, text, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
