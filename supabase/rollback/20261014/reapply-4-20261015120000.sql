-- إعادة تطبيق 20261015120000 بعد الرجوع (بعد reapply-3): الترحيل نفسه بصيغة آمنة للتكرار.
\set ON_ERROR_STOP on
begin;
-- ملاحظات المراجعة R1 (2026-10-15) على تحديث الحسابات البنكية 20261014140000. لا تعديل لأي قيد قائم.
-- R1-01: تصحيح تقرير المبيعات يسجّل فرق الشبكة والتحويل على حساب المبلغ الأصلي (كان بلا حساب فيُرفض في فرع بحسابين).
-- R1-02: منع تكرار قيود المسار السابق يميّز الحساب البنكي (عمولة الحساب A لا تمنع عمولة الحساب B)؛ القيود بلا حساب كما كانت.
-- R1-04: ربط حساب لقيد بنك بلا حساب (ومنه سداد المورد) بدالة خادم محدودة، تسجّل الربط ولا تغيّر المبلغ.
-- منشأة بلا حسابات بنكية: سلوكها كما كان حرفيًا.

-- ══ R1-01 ═══════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.approval_correct_sales_report(p_document_id uuid, p_request_id uuid, p_expected_version int,
  p_invoice jsonb, p_reason text, p_expected_revision int, p_document jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a record; d public.documents; di record; r record; v_id uuid := nullif(p_invoice ->> '_id', '')::uuid;
  fp text := md5(jsonb_build_array('correct', p_document_id, p_invoice, p_reason, p_expected_revision, coalesce(p_document, '{}'))::text);
  v_date date; v_branch text; v_branch_key text; v_branches jsonb; v_chk jsonb; v_new jsonb; v_old jsonb; jn text; res jsonb;
  -- R1-01: حساب كل قناة بنكية (الشبكة والتحويل) لقيد فرقها؛ v_req الحساب المختار في المستند (لقناة بلا مبلغ أصلي)
  v_req uuid := nullif(p_invoice ->> 'bankAccountId', '')::uuid; v_acct jsonb := '{}'; ch record; v_delta numeric; v_ids uuid[]; v_unassigned numeric;
  v_code text; v_has_accounts boolean;
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

  -- القنوات قبل أي كتابة (20261015120000): زيادة قناة غير مفعّلة للفرع تُرفض برسالة؛ الخفض مسموح (تصحيح مبلغ سابق)
  for ch in select * from (values ('cash'), ('network'), ('transfer'), ('hunger'), ('jahez'), ('keeta'), ('mrsool')) v(k) loop
    if (v_new ->> ch.k)::numeric > (v_old ->> ch.k)::numeric and not approval_private.channel_enabled(d.project_id, v_branch, ch.k) then
      return approval_private.err('channel_not_enabled', jsonb_build_object('invoice_id', v_id, 'channel', ch.k, 'label', approval_private.channel_label(ch.k), 'branch', v_branch));
    end if;
  end loop;
  -- الحساب البنكي لكل قناة تغيّرت (R1-01): الفرق يتبع حساب المبلغ الأصلي للقناة في هذا التقرير، ولا يُنسب لحساب آخر اعتباطًا.
  --   قناة لها مبلغ على حساب واحد ← حسابه؛ واختيار حساب آخر صراحة يُرفض باسم الحساب الأصلي.
  --   قناة بلا مبلغ أصلي ← الحساب المختار (يُتحقق منه للفرع) أو الحساب الوحيد المتاح، وإلا يُطلب الاختيار.
  --   مبلغ أصلي غير مربوط بحساب ← يُرفض حتى يُربط من «سجل الدفتر» (ledger_link_bank_account)، فلا تختل أرصدة الحسابات.
  select exists (select 1 from public.bank_accounts b where b.project_id = d.project_id and b.is_active) into v_has_accounts;
  if v_has_accounts then
    for ch in select * from (values ('network', '🏦 مبيعات شبكة'), ('transfer', '💸 مبيعات تحويل')) v(k, t) loop
      v_delta := (v_new ->> ch.k)::numeric - (v_old ->> ch.k)::numeric;
      continue when v_delta = 0;
      select array_agg(x.acc order by x.acc) filter (where x.acc is not null), coalesce(sum(x.s) filter (where x.acc is null), 0)
        into v_ids, v_unassigned
        from (select e.bank_account_id acc, sum(coalesce(e.bank_in, 0) - coalesce(e.bank_out, 0)) s from public.ledger_entries e
               where e.project_id = d.project_id and e.date = v_date and e.branch is not distinct from v_branch and e.type = ch.t
                 and e.status <> 'cancelled' group by 1 having sum(coalesce(e.bank_in, 0) - coalesce(e.bank_out, 0)) <> 0) x;
      if v_unassigned <> 0 then
        return approval_private.err('bank_account_unassigned', jsonb_build_object('invoice_id', v_id, 'channel', ch.k, 'label', approval_private.channel_label(ch.k)));
      elsif coalesce(cardinality(v_ids), 0) = 1 then
        if v_req is not null and v_req <> v_ids[1] then
          return approval_private.err('bank_account_mismatch', jsonb_build_object('invoice_id', v_id, 'channel', ch.k, 'label', approval_private.channel_label(ch.k),
            'account_id', v_ids[1], 'account', (select b.name from public.bank_accounts b where b.id = v_ids[1])));
        end if;
        v_acct := v_acct || jsonb_build_object(ch.k, v_ids[1]);
      elsif coalesce(cardinality(v_ids), 0) = 0 then
        v_code := approval_private.bank_account_check(d.project_id, v_branch, v_req);
        if v_code is not null then return approval_private.err(v_code, jsonb_build_object('invoice_id', v_id, 'branch', v_branch)); end if;
        v_acct := v_acct || jsonb_build_object(ch.k, v_req);   -- null ⇒ الحارس يختار الحساب الوحيد المتاح للفرع
      elsif v_req is not null and v_req = any (v_ids) then
        v_acct := v_acct || jsonb_build_object(ch.k, v_req);
      else
        return approval_private.err('bank_account_required', jsonb_build_object('invoice_id', v_id, 'branch', v_branch, 'channel', ch.k));
      end if;
    end loop;
  end if;

  jn := approval_private.next_journal(d.project_id, v_date);
  -- قيد فرق لكل قناة تغيّرت: موجب عند الزيادة، وسالب عند خفض مبلغ سابق (يُنقص المبيعات والرصيد بقدره)
  insert into public.ledger_entries (project_id, date, type, description, cash_in, cash_out, bank_in, bank_out, custody_in, custody_out,
    receivable_in, receivable_out, total_amount, status, journal_number, file_url, branch, document_id, document_invoice_id, bank_account_id)
  select d.project_id, v_date, t.type, 'تصحيح تقرير POS — ' || to_char(v_date, 'YYYY-MM-DD'),
         case when t.col = 'cash' then t.delta else 0 end, 0,
         case when t.col in ('bank') then t.delta else 0 end, 0, 0, 0,
         case when t.col = 'recv' then t.delta else 0 end, 0, t.delta, 'approved', jn, coalesce(d.file_url, ''), v_branch, d.id, v_id,
         case when t.col = 'bank' then nullif(v_acct ->> t.k, '')::uuid end
    from (values
      ('💵 مبيعات كاش', 'cash', (v_new ->> 'cash')::numeric - (v_old ->> 'cash')::numeric, 'cash'),
      ('🏦 مبيعات شبكة', 'bank', (v_new ->> 'network')::numeric - (v_old ->> 'network')::numeric, 'network'),
      ('💸 مبيعات تحويل', 'bank', (v_new ->> 'transfer')::numeric - (v_old ->> 'transfer')::numeric, 'transfer'),
      ('🍔 مبيعات هنقر ستيشن', 'recv', (v_new ->> 'hunger')::numeric - (v_old ->> 'hunger')::numeric, 'hunger'),
      ('🛵 مبيعات جاهز', 'recv', (v_new ->> 'jahez')::numeric - (v_old ->> 'jahez')::numeric, 'jahez'),
      ('🛺 مبيعات كيتا', 'recv', (v_new ->> 'keeta')::numeric - (v_old ->> 'keeta')::numeric, 'keeta'),
      ('🛵 مبيعات مرسول', 'recv', (v_new ->> 'mrsool')::numeric - (v_old ->> 'mrsool')::numeric, 'mrsool')
    ) as t(type, col, delta, k)
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

create or replace function approval_private.ledger_branch_channel_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_ch text := approval_private.channel_of_type(new.type);
begin
  if v_ch is not null and new.branch is not null and coalesce(new.total_amount, 0) >= 0
     and (tg_op = 'INSERT' or new.type is distinct from old.type or new.branch is distinct from old.branch)
     and not approval_private.channel_enabled(new.project_id, new.branch, v_ch) then
    raise exception '«%» غير مفعّل في «%». القنوات المفعلة لكل فرع من إعداد المنشأة.', approval_private.channel_label(v_ch), new.branch
      using errcode = 'P0001', hint = 'channel_not_enabled_for_branch';
  end if;
  return new;
end $$;

-- ══ R1-02: الفهرس الفريد لقيود المسار السابق بالحساب البنكي ═══════════════════════════════════════════════════
-- القيد بلا حساب يأخذ قيمة ثابتة (الصفر)، فيبقى سلوك المنشآت بلا حسابات وقيود ما قبل الإعداد كما كان تمامًا.
-- في الإنتاج: يُنشأ بـ CONCURRENTLY خارج معاملة ثم يُحذف القديم (خطة النشر)؛ هنا داخل معاملة الهجرة (الجدول صغير).
create unique index if not exists ledger_unique_legacy_path_by_account on public.ledger_entries
  (project_id, date, total_amount, type, description, coalesce(bank_account_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status <> 'cancelled' and document_invoice_id is null;
drop index if exists public.ledger_unique_invoice_legacy_path;

-- ══ R1-04: ربط حساب لقيد بنك بلا حساب ═══════════════════════════════════════════════════════════════════════
create table if not exists approval_private.bank_account_links (
  id bigserial primary key,
  project_id uuid not null references public.projects(id),
  entry_id uuid not null,
  account_id uuid not null references public.bank_accounts(id),
  actor_id uuid not null,
  linked_at timestamptz not null default now()
);
revoke all on approval_private.bank_account_links from public, anon, authenticated;

-- المحاسب وحده، في منشأته: قيد فيه مبلغ بنك، بلا حساب، والحساب نشط ومربوط بفرع القيد. يغيّر عمود الحساب وحده (ولا المبلغ ولا النوع
-- ولا التاريخ)، ولو كان القيد سداد مورد: المسار الموثوق لحارس سداد الموردين يُفتح داخل الدالة لهذا التحديث وحده ثم يُغلق.
create or replace function public.ledger_link_bank_account(p_entry uuid, p_account uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; e public.ledger_entries; v_code text; v_before jsonb;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  select * into e from public.ledger_entries where id = p_entry for update;
  if e.id is null or a.project_id is distinct from e.project_id then return approval_private.err('not_found'); end if;
  if not approval_private.can_approve(a.role, e.project_id) then return approval_private.err('forbidden'); end if;
  if e.status = 'cancelled' then return approval_private.err('bad_status'); end if;
  if coalesce(e.bank_in, 0) = 0 and coalesce(e.bank_out, 0) = 0 then return approval_private.err('no_bank_amount'); end if;
  if e.bank_account_id is not null then return approval_private.err('already_linked', jsonb_build_object('account_id', e.bank_account_id)); end if;
  if p_account is null then return approval_private.err('bank_account_required'); end if;
  v_code := approval_private.bank_account_check(e.project_id, e.branch, p_account);
  if v_code is not null then return approval_private.err(v_code, jsonb_build_object('branch', e.branch)); end if;
  v_before := to_jsonb(e) - 'bank_account_id';
  perform set_config('tahseeb.supplier_payment', 'on', true);
  update public.ledger_entries set bank_account_id = p_account where id = e.id;
  perform set_config('tahseeb.supplier_payment', 'off', true);
  -- لا عمود غير الحساب تغيّر (حماية من أي محفّز يعدّل الصف)
  if (select to_jsonb(x) - 'bank_account_id' from public.ledger_entries x where x.id = e.id) is distinct from v_before then
    raise exception 'ledger_link_changed_other_columns';
  end if;
  insert into approval_private.bank_account_links (project_id, entry_id, account_id, actor_id) values (e.project_id, e.id, p_account, a.id);
  return jsonb_build_object('ok', true, 'id', e.id, 'account_id', p_account);
end $$;
revoke all on function public.ledger_link_bank_account(uuid, uuid) from public, anon;
grant execute on function public.ledger_link_bank_account(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
