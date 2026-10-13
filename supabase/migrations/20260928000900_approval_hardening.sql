-- تقوية الاعتماد الجديد بعد مراجعة الهجرات (ملحق مراجعة 6a402d6). لا تغيير في أي صف مالي قائم.
-- يعتمد على: 20260928000000 (الدوال والجداول)، و000500 (write_invoice)، و000700 (سجل التقرير)، و000800 (plan_invoice، approval_set_mode).
--
--   1. مبالغ المبيعات: فحص واحد للإنشاء والتصحيح (approval_private.sales_channels): كل قناة رقم صالح غير سالب بمنزلتين،
--      والمجموع موجب، ويطابق totalSales إن أُرسل. قيد الفرق عند التصحيح قد يكون سالبًا (خفض مبلغ سابق)، وهذا مشروع.
--   2. تصحيح التقرير مقابل نسخته: لكل تقرير رقم نسخة (revision) يزيد مع كل تصحيح، والتصحيح يُرسل النسخة التي بناها عليها.
--      نسخة أقدم ⇒ report_changed، فلا يمحو تصحيحٌ تصحيحًا سبقه من مستند آخر.
--   3. إعادة الطلب: النتيجة المحفوظة لا تُعاد إلا بعد التحقق من الجلسة والمنشأة والصلاحية الحالية، ولصاحب الطلب نفسه، وللمستند
--      نفسه. الفحص بعد قفل المستند، فالطلبان المتطابقان المتزامنان يعودان بالنتيجة نفسها.
--   4. هوية المورد: الرقم نفسه لمورد بالاسم نفسه يُمنع ولو تغيّر مسار الدفع (نقدي ⇐ آجل ⇐ مورد من القائمة)، متى كان أحد
--      الطرفين بلا سجل مورد (مفتاحه الاسم). موردان مسجّلان مختلفان بالاسم نفسه لا يُدمجان: يبقى اشتباهًا يحتاج سببًا.
--      ومورد آجل جديد لفاتورتين في طلب واحد (أو طلبين متتاليين) يُنشأ مرة واحدة.
--   5. التفعيل: مستند غير نهائي (أي حالة غير approved وrejected) بلا ملف يمنع التفعيل، بالشرط نفسه في الفحص قبل الترحيل.

-- ── 1) مبالغ القنوات ──────────────────────────────────────────────────────────
create function approval_private.sales_channels(inv jsonb) returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_ch jsonb; v_sum numeric; k text; v numeric; v_total numeric;
begin
  begin
    v_ch := jsonb_build_object(
      'cash', approval_private.money(inv -> 'cashSales', 'cashSales'), 'network', approval_private.money(inv -> 'networkSales', 'networkSales'),
      'transfer', approval_private.money(inv -> 'transferSales', 'transferSales'), 'hunger', approval_private.money(inv -> 'hungerSales', 'hungerSales'),
      'jahez', approval_private.money(inv -> 'jahez', 'jahez'), 'keeta', approval_private.money(inv -> 'keeta', 'keeta'),
      'mrsool', approval_private.money(inv -> 'mrsool', 'mrsool'));
    v_total := case when nullif(inv ->> 'totalSales', '') is not null then approval_private.money(inv -> 'totalSales', 'totalSales') end;
  exception when sqlstate 'P0001' then
    return jsonb_build_object('code', split_part(sqlerrm, ':', 2), 'field', split_part(sqlerrm, ':', 3));
  end;
  for k, v in select key, value::numeric from jsonb_each_text(v_ch) loop
    if v < 0 then return jsonb_build_object('code', 'negative_amount', 'field', k); end if;
  end loop;
  select sum(value::numeric) into v_sum from jsonb_each_text(v_ch);
  if v_sum <= 0 then return jsonb_build_object('code', 'amount_required'); end if;
  if v_total is not null and v_total <> v_sum then
    return jsonb_build_object('code', 'amounts_mismatch', 'items_total', v_sum, 'total', v_total, 'difference', v_sum - v_total);
  end if;
  return jsonb_build_object('channels', v_ch, 'total', v_sum);
end $$;

-- ── 2) نسخة التقرير ───────────────────────────────────────────────────────────
alter table approval_private.sales_reports add column revision int not null default 0;

-- ── 3) إعادة الطلب ───────────────────────────────────────────────────────────
-- يُستدعى بعد قفل المستند والتحقق من المنشأة والصلاحية. null = لا طلب سابق بهذا المعرّف.
create function approval_private.replay(p_request_id uuid, p_actor uuid, p_project uuid, p_document_id uuid, p_fp text) returns jsonb
language sql stable set search_path = '' as $$
  select case
    when rq.request_id is null then null
    when rq.actor_id is distinct from p_actor or rq.project_id is distinct from p_project or rq.document_id is distinct from p_document_id
      or rq.fingerprint <> p_fp then approval_private.err('request_reused')
    else rq.result || '{"replayed": true}'::jsonb end
  from (select 1) x left join approval_private.requests rq on rq.request_id = p_request_id
$$;

-- ── تصحيح تقرير المبيعات (بديل 20260928000000): نسخة التقرير، والفحص الموحّد، وإعادة الطلب الآمنة ──────
drop function public.approval_correct_sales_report(uuid, uuid, integer, jsonb, text, jsonb);
create function public.approval_correct_sales_report(p_document_id uuid, p_request_id uuid, p_expected_version int,
  p_invoice jsonb, p_reason text, p_expected_revision int, p_document jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a record; d public.documents; di record; r record; v_id uuid := nullif(p_invoice ->> '_id', '')::uuid;
  fp text := md5(jsonb_build_array('correct', p_document_id, p_invoice, p_reason, p_expected_revision, coalesce(p_document, '{}'))::text);
  v_date date; v_branch text; v_branch_key text; v_branches jsonb; v_chk jsonb; v_new jsonb; v_old jsonb; jn text; res jsonb;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if p_request_id is null then return approval_private.err('request_id_required'); end if;
  select * into d from public.documents where id = p_document_id for update;   -- الطلب المتزامن ينتظر هنا
  if d.id is null or a.project_id is distinct from d.project_id then return approval_private.err('not_found'); end if;
  if not approval_private.can_approve(a.role, d.project_id) then return approval_private.err('forbidden'); end if;
  res := approval_private.replay(p_request_id, a.id, a.project_id, p_document_id, fp); if res is not null then return res; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then return approval_private.err('reason_required'); end if;
  if approval_private.mode_of(d.project_id) <> 'v2' then return approval_private.err(approval_private.mode_of(d.project_id) || '_mode'); end if;
  perform pg_advisory_xact_lock(hashtextextended('approval:' || d.project_id::text, 0));
  res := approval_private.replay(p_request_id, a.id, a.project_id, p_document_id, fp); if res is not null then return res; end if;
  if d.status <> 'analyzed' then return approval_private.err('bad_status', jsonb_build_object('status', d.status)); end if;
  if d.version <> p_expected_version then return approval_private.err('stale', jsonb_build_object('version', d.version)); end if;
  if p_expected_revision is null then return approval_private.err('report_revision_required'); end if;
  select * into di from approval_private.document_invoices where id = v_id and document_id = d.id for update;
  if not found or di.status <> 'pending' then return approval_private.err('invoice_unknown'); end if;
  if p_invoice ->> 'type' <> 'sales' then return approval_private.err('not_sales'); end if;
  v_chk := approval_private.sales_channels(p_invoice);
  if v_chk ? 'code' then return approval_private.err(v_chk ->> 'code', (v_chk - 'code') || jsonb_build_object('invoice_id', v_id)); end if;
  v_new := v_chk -> 'channels';

  v_date := nullif(p_invoice ->> 'date', '')::date;
  v_branch := nullif(btrim(coalesce(p_document ->> 'branch', d.branch, '')), '');
  select settings -> 'branches' into v_branches from public.project_settings where project_id = d.project_id;
  v_branch_key := case when jsonb_typeof(v_branches) = 'array' and jsonb_array_length(v_branches) > 0 then v_branch else coalesce(v_branch, '∅') end;
  select * into r from approval_private.sales_reports where project_id = d.project_id and branch_key = v_branch_key and report_date = v_date for update;
  if not found then return approval_private.err('no_report_to_correct'); end if;
  -- التصحيح مبني على نسخة أقدم من التقرير (صحّحه مستخدم آخر بعد عرضه): لا يُكتب، ويُعرض الحالي
  if r.revision <> p_expected_revision then
    return approval_private.err('report_changed', jsonb_build_object('revision', r.revision, 'current', r.current));
  end if;
  v_old := r.current;
  if v_new = v_old then return approval_private.err('no_change'); end if;

  jn := approval_private.next_journal(d.project_id, v_date);
  -- قيد فرق لكل قناة تغيّرت: موجب عند الزيادة، وسالب عند خفض مبلغ سابق (يُنقص المبيعات والرصيد بقدره)
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
  update approval_private.sales_reports set current = v_new, revision = revision + 1
   where project_id = r.project_id and branch_key = r.branch_key and report_date = r.report_date;
  update approval_private.document_invoices set status = 'approved', kind = 'sales_correction', invoice_date = v_date, journal_number = jn,
         total = (v_chk ->> 'total')::numeric, approved_payload = p_invoice, review_changes = p_invoice -> 'review_changes',
         decided_by = a.id, decided_at = now(), request_id = p_request_id
   where id = v_id;
  d := approval_private.finish_document(d, a.id, jn, coalesce(p_document, '{}'));
  res := jsonb_build_object('ok', true, 'document_status', d.status, 'version', d.version, 'journal_number', jn, 'previous', v_old, 'corrected', v_new,
    'revision', r.revision + 1);
  insert into approval_private.requests (request_id, project_id, document_id, action, fingerprint, actor_id, result)
  values (p_request_id, d.project_id, d.id, 'correct_sales', fp, a.id, res);
  return res;
end $$;
revoke all on function public.approval_correct_sales_report(uuid, uuid, integer, jsonb, text, integer, jsonb) from public, anon;
grant execute on function public.approval_correct_sales_report(uuid, uuid, integer, jsonb, text, integer, jsonb) to authenticated;

-- ── سجل التقرير: مع رقم نسخته (بديل 20260928000700) ─────────────────────────────
create or replace function public.approval_sales_report_history(p_date date, p_branch text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  a record; v_branches jsonb; v_branch text := nullif(btrim(coalesce(p_branch, '')), ''); v_key text; r record;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.project_id is null or a.role not in ('owner', 'accountant') then return approval_private.err('forbidden'); end if;
  select settings -> 'branches' into v_branches from public.project_settings where project_id = a.project_id;
  v_key := case when jsonb_typeof(v_branches) = 'array' and jsonb_array_length(v_branches) > 0 then v_branch else coalesce(v_branch, '∅') end;
  select * into r from approval_private.sales_reports where project_id = a.project_id and branch_key = v_key and report_date = p_date;
  if not found then return approval_private.err('no_report'); end if;
  return jsonb_build_object('ok', true, 'report_date', r.report_date, 'branch', nullif(r.branch_key, '∅'),
    'journal_number', r.journal_number, 'current', r.current, 'revision', r.revision,
    'revisions', coalesce((
      select jsonb_agg(jsonb_build_object('at', v.created_at, 'previous', v.previous, 'corrected', v.corrected,
               'journal_number', v.journal_number, 'reason', v.reason, 'by', u.name) order by v.id)
        from approval_private.sales_report_revisions v left join public.app_users u on u.id = v.actor_id
       where v.project_id = r.project_id and v.branch_key = r.branch_key and v.report_date = r.report_date), '[]'::jsonb));
end $$;

-- ── 5) التفعيل: الشرط نفسه في الفحص قبل الترحيل (بديل 20260928000800) ─────────────────
create or replace function public.approval_set_mode(p_project_id uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; n int; was_active boolean; linked jsonb;
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
  if p_mode = 'v2' and not was_active then linked := approval_private.link_legacy_categories(p_project_id); end if;
  return jsonb_build_object('ok', true, 'mode', p_mode) || case when linked is not null then jsonb_build_object('linked', linked) else '{}' end;
exception when sqlstate 'P0001' then return approval_private.err('mode_locked');
end $$;

revoke all on function approval_private.sales_channels(jsonb), approval_private.replay(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;

-- ── 3) الاعتماد: إعادة الطلب بعد التحقق (نسخة 20260928000000 من approval_approve بتغيير الإعادة فقط) ─────────────
create or replace function public.approval_approve(p_document_id uuid, p_request_id uuid, p_expected_version int,
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

  select * into d from public.documents where id = p_document_id for update;   -- الطلب المتزامن للمستند نفسه ينتظر هنا
  if d.id is null or a.project_id is distinct from d.project_id then return approval_private.err('not_found'); end if;
  if not approval_private.can_approve(a.role, d.project_id) then return approval_private.err('forbidden'); end if;
  -- إعادة الطلب: بعد التحقق من المنشأة والصلاحية الحالية، ولصاحب الطلب وللمستند نفسه فقط
  res := approval_private.replay(p_request_id, a.id, a.project_id, p_document_id, fp); if res is not null then return res; end if;
  case approval_private.mode_of(d.project_id)
    when 'legacy' then return approval_private.err('legacy_mode');
    when 'paused' then return approval_private.err('paused');
    else null;
  end case;
  perform pg_advisory_xact_lock(hashtextextended('approval:' || d.project_id::text, 0));

  -- طلب مطابق اكتمل أثناء الانتظار على القفل
  res := approval_private.replay(p_request_id, a.id, a.project_id, p_document_id, fp); if res is not null then return res; end if;

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
    -- الرقم نفسه لمورد بالاسم نفسه داخل الطلب، ولو اختلف مسار الدفع، متى كان أحد الطرفين بلا سجل مورد (مفتاحه الاسم).
    -- موردان مسجّلان مختلفان بالاسم نفسه ليسا تكرارًا. الرفض في مرحلة الخطة، قبل أي كتابة.
    if plan ->> 'number' is not null and plan ->> 'kind' in ('expense', 'credit') then
      if exists (select 1 from jsonb_array_elements(plans) p
                  where p ->> 'number' = plan ->> 'number' and p ->> 'kind' in ('expense', 'credit')
                    and (p ->> 'supplier_key' = plan ->> 'supplier_key'
                         or ((p ->> 'supplier_key' like 'n:%' or plan ->> 'supplier_key' like 'n:%')
                             and approval_private.norm_name(p ->> 'label') = approval_private.norm_name(plan ->> 'label')))) then
        return approval_private.err('duplicate_in_batch', jsonb_build_object('invoice_id', v_id, 'number', plan ->> 'number'));
      end if;
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

-- ── 1، 2، 4) plan_invoice: نسخة 20260928000800 بثلاثة تغييرات: فحص القنوات الموحّد، ورقم نسخة التقرير في «تقرير موجود»،
--    ومنع الرقم نفسه لمورد بالاسم نفسه عبر مسارات الدفع حين يكون أحد الطرفين بلا سجل مورد ─────────────────
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
    -- الفحص نفسه في التصحيح: كل قناة غير سالبة، والمجموع موجب ويطابق totalSales
    v_ch := approval_private.sales_channels(inv);
    if v_ch ? 'code' then return approval_private.err(v_ch ->> 'code', (v_ch - 'code') || jsonb_build_object('invoice_id', v_id)); end if;
    v_sales_sum := (v_ch ->> 'total')::numeric; v_ch := v_ch -> 'channels';
    select r.document_id, r.journal_number, r.current, r.revision, dd.file_name into v_link
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
       and x.invoice_number_norm = v_num
       and (x.supplier_key = v_key
            -- طرف بلا سجل مورد (مفتاحه الاسم) يطابق بالاسم المطبّع أي مسار: نقدي ثم آجل أو من القائمة، أو العكس
            or ((x.supplier_key like 'n:%' or v_key like 'n:%')
                and approval_private.norm_name(x.supplier_label) = approval_private.norm_name(v_label)))
     limit 1;
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

-- ── 4) write_invoice: نسخة 20260928000500 بتغيير واحد: المورد الآجل الجديد يُنشأ مرة واحدة ──────────────
create or replace function approval_private.write_invoice(d public.documents, plan jsonb, p_actor uuid, p_request uuid) returns text
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
      -- فاتورة سابقة في الطلب نفسه (أو طلب سبقه تحت قفل المنشأة) أنشأت المورد بالاسم نفسه: يُستعمل، لا يُكرَّر
      select ps.id into v_supplier from public.payable_suppliers ps
       where ps.project_id = d.project_id and approval_private.norm_name(ps.name) = approval_private.norm_name(plan ->> 'label')
       order by ps.created_at nulls last limit 1;
      if v_supplier is null then
        insert into public.payable_suppliers (project_id, name) values (d.project_id, plan ->> 'label') returning id into v_supplier;
      end if;
      v_key := 'ps:' || v_supplier;
    end if;
    v_incoming := (plan ->> 'incoming')::boolean;
    for g in select value from jsonb_array_elements(plan -> 'groups') loop
      v_gross := (g ->> 'gross')::numeric;
      insert into public.ledger_entries (project_id, date, type, description, cash_out, bank_out, custody_out, cash_in, bank_in, custody_in,
        payable_in, payable_out, supplier_id, vat_amount, total_amount, status, file_url, journal_number, branch, purchase_category,
        category_main, category_sub, document_id, document_invoice_id, invoice_number, category_id, financial_class, discount_amount)
      values (d.project_id, v_date, coalesce(g ->> 'type', '🛒 مصروفات تشغيلية'), coalesce(plan ->> 'description', d.file_name),
        case when not v_incoming and v_pay = 'cash' then v_gross else 0 end,
        case when not v_incoming and v_pay = 'bank' then v_gross else 0 end,
        case when not v_incoming and v_pay = 'custody' then v_gross else 0 end,
        case when v_incoming and v_pay = 'cash' then v_gross else 0 end,
        case when v_incoming and v_pay = 'bank' then v_gross else 0 end,
        case when v_incoming and v_pay = 'custody' then v_gross else 0 end,
        case when not v_incoming and v_pay = 'payable' then v_gross else 0 end, 0,
        v_supplier, (g ->> 'vat')::numeric, v_gross, 'approved', coalesce(d.file_url, ''), jn, v_branch, d.purchase_category,
        g ->> 'main', g ->> 'sub', d.id, v_id, plan ->> 'number_raw', nullif(g ->> 'category_id', '')::uuid, g ->> 'financial_class',
        coalesce((g ->> 'discount')::numeric, 0))
      returning id into le_id;
      insert into public.document_items (document_id, project_id, journal_number, description, amount, vat_amount, category_main, category_sub,
        sort_order, ledger_entry_id, document_invoice_id, category_id, subcategory_id, line_discount, invoice_discount_share, amount_before_discount)
      select d.id, d.project_id, jn, x ->> 'description', (x ->> 'amount')::numeric, (x ->> 'vat')::numeric, x ->> 'main', x ->> 'sub',
             (x ->> 'sort')::int, le_id, v_id, nullif(x ->> 'category_id', '')::uuid, nullif(x ->> 'subcategory_id', '')::uuid,
             coalesce((x ->> 'line_discount')::numeric, 0), coalesce((x ->> 'invoice_discount_share')::numeric, 0),
             (x ->> 'amount_read')::numeric + coalesce((x ->> 'line_discount')::numeric, 0)
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
