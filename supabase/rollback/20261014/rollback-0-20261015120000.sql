-- رجوع 20261015120000 (ملاحظات المراجعة R1). يُنفَّذ أولًا، قبل rollback-1. يبقي البيانات (ومنها سجل الربط approval_private.bank_account_links).
-- الفهرس الفريد بالحساب (ledger_unique_legacy_path_by_account) يبقى عمدًا: للقيود بلا حساب (كل ما يُسجَّل بعد الرجوع) يطابق الفهرس القديم
-- تمامًا، وإعادة الفهرس القديم قد تفشل إن وُجدت حركتان متطابقتان على حسابين مختلفين سُجّلتا قبل الرجوع (وهما صحيحتان).
\set ON_ERROR_STOP on
begin;
create or replace function public.approval_correct_sales_report(p_document_id uuid, p_request_id uuid, p_expected_version int,
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
create or replace function approval_private.ledger_branch_channel_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_ch text := approval_private.channel_of_type(new.type);
begin
  if v_ch is not null and new.branch is not null
     and (tg_op = 'INSERT' or new.type is distinct from old.type or new.branch is distinct from old.branch)
     and not approval_private.channel_enabled(new.project_id, new.branch, v_ch) then
    raise exception '«%» غير مفعّل في «%». القنوات المفعلة لكل فرع من إعداد المنشأة.', approval_private.channel_label(v_ch), new.branch
      using errcode = 'P0001', hint = 'channel_not_enabled_for_branch';
  end if;
  return new;
end $$;
drop function if exists public.ledger_link_bank_account(uuid, uuid);
notify pgrst, 'reload schema';
commit;
