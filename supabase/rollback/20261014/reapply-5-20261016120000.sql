-- إعادة تطبيق 20261016120000 بعد الرجوع (بعد reapply-4): الترحيل نفسه بصيغة آمنة للتكرار.
\set ON_ERROR_STOP on
begin;
-- ملاحظات المراجعة R2 (2026-10-16) على تصحيح تقرير المبيعات (R1-01). لا تعديل لأي قيد قائم.
-- R2-01: حساب القناة «الأصلي» من قيود التقرير نفسه وتصحيحاته (علاقاتها المحفوظة)، المحتسبة وحدها؛ لا قيود اليوم والفرع الأخرى. تعذّر الإثبات ⇒ توقف.
-- R2-02: حساب لكل قناة بنكية (bankAccounts) في الاعتماد والتصحيح: القناة القائمة على حسابها دائمًا، والجديدة على حسابها المختار، في طلب واحد.
-- منشأة بلا حسابات بنكية: سلوكها كما كان حرفيًا.

-- قيود التقرير = قيود فاتورته الأصلية (document_invoice_id = sales_reports.invoice_id) وفواتير تصحيحاته (sales_report_revisions.invoice_id)،
-- وللتقرير المربوط من المسار السابق (20261003000000، بلا فاتورة على قيوده): قيوده برقم القيد المحفوظ في الربط، بلا فاتورة، في يوم التقرير.
-- المحتسبة فقط (approved/auto). لا قيود اليوم والفرع الأخرى ولو طابقت النوع. «مثبت» = صافي قيود القناة يساوي رقم التقرير الحالي.
create or replace function approval_private.report_channel_accounts(p_project uuid, p_branch text, p_date date) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_branches jsonb; v_key text; r record; v_inv uuid[]; ch record; v_ids uuid[]; v_un numeric; v_tot numeric; v_old numeric; v_out jsonb := '{}';
begin
  select settings -> 'branches' into v_branches from public.project_settings where project_id = p_project;
  v_key := case when jsonb_typeof(v_branches) = 'array' and jsonb_array_length(v_branches) > 0 then p_branch else coalesce(p_branch, '∅') end;
  select * into r from approval_private.sales_reports where project_id = p_project and branch_key = v_key and report_date = p_date;
  if not found then return null; end if;
  v_inv := array[r.invoice_id] || coalesce((select array_agg(v.invoice_id) from approval_private.sales_report_revisions v
                                            where v.project_id = p_project and v.branch_key = v_key and v.report_date = p_date), '{}'::uuid[]);
  for ch in select * from (values ('network', '🏦 مبيعات شبكة'), ('transfer', '💸 مبيعات تحويل')) v(k, t) loop
    select array_agg(x.acc order by x.acc) filter (where x.acc is not null), coalesce(sum(x.s) filter (where x.acc is null), 0), coalesce(sum(x.s), 0)
      into v_ids, v_un, v_tot
      from (select e.bank_account_id acc, sum(coalesce(e.bank_in, 0) - coalesce(e.bank_out, 0)) s from public.ledger_entries e
             where e.project_id = p_project and e.type = ch.t and e.status in ('approved', 'auto')
               and (e.document_invoice_id = any (v_inv)
                    or (e.document_invoice_id is null and r.journal_number is not null and e.journal_number = r.journal_number and e.date = p_date))
             group by 1 having sum(coalesce(e.bank_in, 0) - coalesce(e.bank_out, 0)) <> 0) x;
    v_old := coalesce((r.current ->> ch.k)::numeric, 0);
    v_out := v_out || jsonb_build_object(ch.k, jsonb_build_object('old', v_old, 'total', v_tot, 'unassigned', v_un,
      'accounts', coalesce(to_jsonb(v_ids), '[]'::jsonb), 'proven', v_tot = v_old,
      'account', case when coalesce(cardinality(v_ids), 0) = 1 and v_un = 0 and v_tot = v_old then v_ids[1] end,
      'account_name', case when coalesce(cardinality(v_ids), 0) = 1 then (select b.name from public.bank_accounts b where b.id = v_ids[1]) end));
  end loop;
  return v_out;
end $$;
revoke all on function approval_private.report_channel_accounts(uuid, text, date) from public, anon, authenticated;

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
  -- R2: حسابات قنوات هذا التقرير من قيوده هو (report_channel_accounts)، والاختيار لكل قناة (bankAccounts) ثم العام (bankAccountId) للقناة الجديدة
  v_info jsonb; v_ci jsonb; v_explicit uuid; v_cand uuid;
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
  -- الحساب البنكي لكل قناة تغيّرت (R1-01، R2-01، R2-02):
  --   قناة قائمة في التقرير (مبلغها الحالي أو قيودها غير صفر): حسابها يُستخرج من قيود التقرير نفسه وتصحيحاته وحدها. يجب أن يُثبت (صافي قيودها
  --   = رقم التقرير) وأن يكون حسابًا واحدًا بلا جزء غير مربوط؛ وإلا يتوقف التصحيح للمراجعة. الفرق عليه دائمًا: الاختيار العام لا ينقله، واختيار
  --   حساب آخر لهذه القناة صراحة (bankAccounts.<القناة>) يُرفض باسم الحساب الأصلي.
  --   قناة جديدة (صفر في التقرير): حسابها المختار لها (bankAccounts.<القناة>) أو الاختيار العام أو الوحيد المتاح للفرع، وإلا يُطلب الاختيار.
  select exists (select 1 from public.bank_accounts b where b.project_id = d.project_id and b.is_active) into v_has_accounts;
  if v_has_accounts then
    v_info := approval_private.report_channel_accounts(d.project_id, v_branch, v_date);
    for ch in select * from (values ('network'), ('transfer')) v(k) loop
      v_delta := (v_new ->> ch.k)::numeric - (v_old ->> ch.k)::numeric;
      continue when v_delta = 0;
      v_ci := v_info -> ch.k;
      v_explicit := nullif(p_invoice -> 'bankAccounts' ->> ch.k, '')::uuid;
      if (v_ci ->> 'old')::numeric <> 0 or (v_ci ->> 'total')::numeric <> 0 then
        if not (v_ci ->> 'proven')::boolean then
          return approval_private.err('report_entries_unproven', jsonb_build_object('invoice_id', v_id, 'channel', ch.k, 'label', approval_private.channel_label(ch.k),
            'report', (v_ci ->> 'old')::numeric, 'entries', (v_ci ->> 'total')::numeric));
        elsif (v_ci ->> 'unassigned')::numeric <> 0 then
          return approval_private.err('bank_account_unassigned', jsonb_build_object('invoice_id', v_id, 'channel', ch.k, 'label', approval_private.channel_label(ch.k)));
        elsif jsonb_array_length(v_ci -> 'accounts') <> 1 then
          return approval_private.err('report_entries_unproven', jsonb_build_object('invoice_id', v_id, 'channel', ch.k, 'label', approval_private.channel_label(ch.k), 'split', true));
        elsif v_explicit is not null and v_explicit <> (v_ci ->> 'account')::uuid then
          return approval_private.err('bank_account_mismatch', jsonb_build_object('invoice_id', v_id, 'channel', ch.k, 'label', approval_private.channel_label(ch.k),
            'account_id', v_ci ->> 'account', 'account', v_ci ->> 'account_name'));
        end if;
        v_acct := v_acct || jsonb_build_object(ch.k, v_ci ->> 'account');
      else
        v_cand := coalesce(v_explicit, v_req);
        v_code := approval_private.bank_account_check(d.project_id, v_branch, v_cand);
        if v_code is not null then return approval_private.err(v_code, jsonb_build_object('invoice_id', v_id, 'branch', v_branch, 'channel', ch.k)); end if;
        v_acct := v_acct || jsonb_build_object(ch.k, v_cand);   -- null ⇒ الحارس يختار الحساب الوحيد المتاح للفرع
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

create or replace function approval_private.plan_invoice(d public.documents, inv jsonb, p_decisions jsonb, p_document jsonb, v_known boolean)
returns jsonb language plpgsql stable set search_path = '' as $$
declare plan jsonb := approval_private.plan_invoice_core(d, inv, p_decisions, p_document, v_known); k text; v_needs boolean; v_code text;
begin
  if not coalesce((plan ->> 'ok')::boolean, false) then
    -- «يوجد تقرير لهذا اليوم»: حسابات قنواته من قيوده، لتعرض الشاشة على أي حساب يُسجَّل فرق كل قناة قبل التصحيح (R2)
    if plan ->> 'code' = 'sales_report_exists' and jsonb_typeof(plan -> 'linked') = 'object' then
      plan := jsonb_set(plan, '{linked,accounts}', coalesce(approval_private.report_channel_accounts(d.project_id,
        nullif(btrim(coalesce(p_document ->> 'branch', d.branch, '')), ''), nullif(inv ->> 'date', '')::date), 'null'::jsonb));
    end if;
    return plan;
  end if;
  -- الحساب البنكي: الفاتورة التي فيها حركة بنك في منشأة بحسابات تحتاج حسابًا صالحًا لفرعها (أو حسابًا وحيدًا متاحًا)
  v_needs := case plan ->> 'kind'
    when 'sales' then coalesce(nullif(plan -> 'channels' ->> 'network', '')::numeric, 0) > 0 or coalesce(nullif(plan -> 'channels' ->> 'transfer', '')::numeric, 0) > 0
    when 'transfer' then plan ->> 'pay' = 'bank' or plan ->> 'trans_type' is null or plan ->> 'trans_type' ~ '(إيداع نقدي|تحصيل ذمم|صرف عهدة)'
    when 'expense' then plan ->> 'pay' = 'bank'
    else false end;
  if v_needs and plan ->> 'kind' = 'sales' then
    -- لكل قناة بنكية فيها مبلغ: حسابها (bankAccounts.<القناة>) أو الاختيار العام أو الوحيد المتاح
    for k in select * from (values ('network'), ('transfer')) v(k) loop
      continue when coalesce(nullif(plan -> 'channels' ->> k, '')::numeric, 0) <= 0;
      v_code := approval_private.bank_account_check(d.project_id, plan ->> 'branch',
        coalesce(nullif(inv -> 'bankAccounts' ->> k, '')::uuid, nullif(inv ->> 'bankAccountId', '')::uuid));
      if v_code is not null then return approval_private.err(v_code, jsonb_build_object('invoice_id', plan ->> 'id', 'branch', plan ->> 'branch', 'channel', k)); end if;
    end loop;
  elsif v_needs then
    v_code := approval_private.bank_account_check(d.project_id, plan ->> 'branch', nullif(inv ->> 'bankAccountId', '')::uuid);
    if v_code is not null then return approval_private.err(v_code, jsonb_build_object('invoice_id', plan ->> 'id', 'branch', plan ->> 'branch')); end if;
  end if;
  if plan ->> 'kind' = 'sales' then
    for k in select key from jsonb_each_text(case when jsonb_typeof(plan -> 'channels') = 'object' then plan -> 'channels' else '{}' end) e(key, value)
              where coalesce(nullif(e.value, '')::numeric, 0) > 0 loop
      if not approval_private.channel_enabled(d.project_id, plan ->> 'branch', k) then
        return approval_private.err('channel_not_enabled', jsonb_build_object('invoice_id', plan ->> 'id', 'channel', k,
          'label', approval_private.channel_label(k), 'branch', plan ->> 'branch'));
      end if;
    end loop;
    return plan;
  end if;
  if coalesce(plan ->> 'trans_type', '') like '%سداد مورد%' or coalesce(plan ->> 'type', '') like '%سداد مورد%'
     or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(plan -> 'groups') = 'array' then plan -> 'groups' else '[]' end) g
                 where coalesce(g ->> 'type', '') like '%سداد مورد%' or coalesce(g ->> 'main', '') like '%سداد مورد%'
                    or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(g -> 'items') = 'array' then g -> 'items' else '[]' end) x
                                where coalesce(x ->> 'type', '') like '%سداد مورد%' or coalesce(x ->> 'main', '') like '%سداد مورد%')) then
    return approval_private.err('supplier_payment_via_suppliers', jsonb_build_object('invoice_id', plan ->> 'id'));
  end if;
  return plan;
end $$;
revoke all on function approval_private.plan_invoice(public.documents, jsonb, jsonb, jsonb, boolean) from public, anon, authenticated;

create or replace function approval_private.write_invoice(d public.documents, plan jsonb, p_actor uuid, p_request uuid) returns text
language plpgsql set search_path = '' as $$
declare
  v_id uuid := (plan ->> 'id')::uuid; v_date date := (plan ->> 'date')::date; v_kind text := plan ->> 'kind';
  jn text; v_ch jsonb; s_id uuid; v_total numeric; v_type text; v_pay text := plan ->> 'pay'; v_supplier uuid; v_incoming boolean;
  g jsonb; v_gross numeric; le_id uuid; v_key text := plan ->> 'supplier_key'; v_branch text := plan ->> 'branch';
  -- الحساب البنكي المختار في الفاتورة (20261014140000). حارس الدفتر يتحقق منه ويختاره تلقائيًا إن كان للفرع حساب واحد.
  v_bank uuid := nullif(plan -> 'payload' ->> 'bankAccountId', '')::uuid;
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
      receivable_in, receivable_out, total_amount, status, journal_number, file_url, branch, document_id, document_invoice_id, bank_account_id)
    select d.project_id, v_date, t.type, t.description, t.cash_in, 0, t.bank_in, 0, 0, 0, t.recv, 0, t.amount, 'approved', jn,
           coalesce(d.file_url, ''), v_branch, d.id, v_id,
           -- حساب كل قناة بنكية (R2-02): المختار لها، وإلا العام
           case when t.bank_in > 0 then coalesce(nullif(plan -> 'payload' -> 'bankAccounts' ->> t.k, '')::uuid, v_bank) end
      from (values
        ('💵 مبيعات كاش', 'مبيعات كاش — POS', (v_ch ->> 'cash')::numeric, 0::numeric, 0::numeric, (v_ch ->> 'cash')::numeric, 'cash'),
        ('🏦 مبيعات شبكة', 'مبيعات شبكة — POS', 0, (v_ch ->> 'network')::numeric, 0, (v_ch ->> 'network')::numeric, 'network'),
        ('💸 مبيعات تحويل', 'مبيعات تحويل — POS', 0, (v_ch ->> 'transfer')::numeric, 0, (v_ch ->> 'transfer')::numeric, 'transfer'),
        ('🍔 مبيعات هنقر ستيشن', 'ذمم هنقر — POS', 0, 0, (v_ch ->> 'hunger')::numeric, (v_ch ->> 'hunger')::numeric, 'hunger'),
        ('🛵 مبيعات جاهز', 'ذمم جاهز — POS', 0, 0, (v_ch ->> 'jahez')::numeric, (v_ch ->> 'jahez')::numeric, 'jahez'),
        ('🛺 مبيعات كيتا', 'ذمم كيتا — POS', 0, 0, (v_ch ->> 'keeta')::numeric, (v_ch ->> 'keeta')::numeric, 'keeta'),
        ('🛵 مبيعات مرسول', 'ذمم مرسول — POS', 0, 0, (v_ch ->> 'mrsool')::numeric, (v_ch ->> 'mrsool')::numeric, 'mrsool')
      ) as t(type, description, cash_in, bank_in, recv, amount, k)
     where t.amount > 0;
    insert into approval_private.sales_reports (project_id, branch_key, report_date, document_id, invoice_id, sales_id, journal_number, current)
    values (d.project_id, plan ->> 'branch_key', v_date, d.id, v_id, s_id, jn, v_ch);

  elsif v_kind = 'transfer' then
    -- مطابق لمنطق المسار السابق، مع قراءة المبلغ من amount أو totalAmount
    v_total := (plan ->> 'total')::numeric; v_type := plan ->> 'trans_type';
    insert into public.ledger_entries (project_id, date, type, description, cash_in, bank_in, custody_in, cash_out, bank_out, custody_out,
      receivable_in, receivable_out, vat_amount, total_amount, status, file_url, journal_number, branch, document_id, document_invoice_id, bank_account_id)
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
      0, v_total, 'approved', coalesce(d.file_url, ''), jn, v_branch, d.id, v_id, v_bank);

  else
    if v_kind = 'credit' then
      -- مورد من القائمة: حركة «فاتورة» في حساب المورد كما كانت، ومعها الآن قيد الشراء في الدفتر آجلًا (payable_in) بضريبته وتصنيفه
      -- وبنوده كالآجل باسم المورد، فيُحتسب الشراء بصافيه بتاريخ الفاتورة مرة واحدة. الربط بحساب المورد برقم القيد نفسه
      -- (supplier_id في الدفتر يشير إلى payable_suppliers).
      insert into public.supplier_transactions (supplier_id, project_id, type, amount, date, notes, document_id, journal_number)
      values ((plan ->> 'supplier_id')::uuid, d.project_id, 'invoice', (plan ->> 'total')::numeric, v_date,
              coalesce(plan ->> 'description', d.file_name), d.id, jn);
      v_supplier := null;
      v_pay := 'payable';
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
    end if;
    v_incoming := (plan ->> 'incoming')::boolean;
    for g in select value from jsonb_array_elements(plan -> 'groups') loop
      v_gross := (g ->> 'gross')::numeric;
      insert into public.ledger_entries (project_id, date, type, description, cash_out, bank_out, custody_out, cash_in, bank_in, custody_in,
        payable_in, payable_out, supplier_id, vat_amount, total_amount, status, file_url, journal_number, branch, purchase_category,
        category_main, category_sub, document_id, document_invoice_id, invoice_number, category_id, financial_class, discount_amount, bank_account_id)
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
        coalesce((g ->> 'discount')::numeric, 0), case when v_pay = 'bank' then v_bank end)
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

notify pgrst, 'reload schema';

commit;
