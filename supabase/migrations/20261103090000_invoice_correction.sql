-- Correcting an approved invoice, and locking document rows against direct edits (readiness review 2026-11-02, H2 part 2).
--
-- Before: the only way to fix a wrongly approved invoice was to edit or delete its ledger entry from the ledger screens. The document
-- stayed «approved», its items and supplier invoice stayed as they were, and nothing tied the change to the document.
--
-- 1. approval_correction_prepare(doc, invoice): what the review screen needs to open an approved invoice for correction (same shape as
--    approval_prepare), with the approved payload as the editable invoice. Reads only.
-- 2. approval_correct_invoice(doc, invoice, request, version, payload, reason, ...): one transaction that removes everything the invoice
--    wrote (ledger entries, items, supplier invoice, bank-transfer pair), plans the corrected payload with the same checks as approval
--    (duplicates, categories, bank accounts, line VAT…), writes it with the same writer, keeps the original journal number when the year
--    is unchanged (the number taken for the rewrite is released, so no gap), and records the previous rows, the reason and the actor in
--    the invoice history. Any failure leaves the approved invoice exactly as it was. Supported: expense, credit and transfer invoices.
--    Sales reports keep their own correction (approval_correct_sales_report); supplier receipts keep supplier_payment_delete.
-- 3. document_rows_guard: direct updates and deletes (the client role) of ledger entries / items written by a v2 approval
--    (document_invoice_id set) and of supplier transactions written from a document are refused with a message pointing to «تصحيح».
--    Server functions (approval, correction, supplier payments, admin tools) run as their owner and are not affected. Manual entries
--    and legacy rows (no document_invoice_id) stay editable. Every change is already in the action log (20261102170000).
-- Rollback: supabase/rollback/invoice-correction.sql.

create or replace function approval_private.document_rows_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_locked boolean;
begin
  if current_user <> 'authenticated' then return case when tg_op = 'DELETE' then old else new end; end if;
  -- كل جدول بعموده: لا يُقرأ عمود غير موجود في الجدول الآخر (plpgsql لا يضمن تقييمًا مختصرًا)
  if tg_table_name = 'supplier_transactions' then v_locked := (to_jsonb(old) ->> 'document_id') is not null;
  else v_locked := (to_jsonb(old) ->> 'document_invoice_id') is not null; end if;
  if v_locked then
    raise exception using errcode = 'P0001',
      message = 'هذا القيد من مستند معتمد، فلا يُعدَّل أو يُحذف من الدفتر. صحّح المستند نفسه من زر «تصحيح» في أرشيف المستندات.',
      hint = 'document_entry_locked';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function approval_private.document_rows_guard() from public, anon, authenticated;

drop trigger if exists document_rows_guard on public.ledger_entries;
create trigger document_rows_guard before update or delete on public.ledger_entries for each row execute function approval_private.document_rows_guard();
drop trigger if exists document_rows_guard on public.document_items;
create trigger document_rows_guard before update or delete on public.document_items for each row execute function approval_private.document_rows_guard();
drop trigger if exists document_rows_guard on public.supplier_transactions;
create trigger document_rows_guard before update or delete on public.supplier_transactions for each row execute function approval_private.document_rows_guard();

create or replace function public.approval_correction_prepare(p_document_id uuid, p_invoice_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a record; d public.documents; di record; v_restored jsonb; v_invs jsonb;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  select * into d from public.documents where id = p_document_id;
  if d.id is null or a.project_id is distinct from d.project_id then return approval_private.err('not_found'); end if;
  if not approval_private.can_approve(a.role, d.project_id) then return approval_private.err('forbidden'); end if;
  if approval_private.mode_of(d.project_id) <> 'v2' then return approval_private.err(approval_private.mode_of(d.project_id) || '_mode'); end if;
  select * into di from approval_private.document_invoices where id = p_invoice_id and document_id = d.id;
  if not found then return approval_private.err('invoice_unknown'); end if;
  if di.status <> 'approved' then return approval_private.err('invoice_not_approved', jsonb_build_object('status', di.status)); end if;
  if di.kind not in ('expense', 'credit', 'transfer') then return approval_private.err('correction_not_supported', jsonb_build_object('kind', di.kind)); end if;
  v_restored := (coalesce(di.approved_payload, '{}'::jsonb) - 'journal_number' - 'review_changes') || jsonb_build_object('_id', di.id::text);
  v_invs := case when jsonb_typeof(d.analysis_result -> 'invoices') = 'array'
    then (select jsonb_agg(case when e ->> '_id' = di.id::text then v_restored else e end order by o)
            from jsonb_array_elements(d.analysis_result -> 'invoices') with ordinality t(e, o))
    else jsonb_build_array(v_restored) end;
  if not exists (select 1 from jsonb_array_elements(v_invs) e where e ->> '_id' = di.id::text) then v_invs := v_invs || jsonb_build_array(v_restored); end if;
  return jsonb_build_object('ok', true, 'mode', 'v2', 'version', d.version, 'status', 'analyzed', 'correction', true,
    'analysis_result', coalesce(d.analysis_result, '{}'::jsonb) || jsonb_build_object('invoices', v_invs),
    'corrected_invoice', jsonb_build_object('id', di.id, 'kind', di.kind, 'journal_number', di.journal_number, 'total', di.total,
      'invoice_date', di.invoice_date, 'decided_at', di.decided_at, 'supplier_id', di.approved_payload ->> 'supplier_id'),
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'idx', x.idx,
                 'status', case when x.id = di.id then 'pending' else x.status end,
                 'journal_number', case when x.id = di.id then null else x.journal_number end, 'excluded_reason', x.excluded_reason,
                 'history', x.history, 'original_reading', x.original_reading) order by x.idx)
               from approval_private.document_invoices x where x.document_id = d.id), '[]'));
end $$;
revoke all on function public.approval_correction_prepare(uuid, uuid) from public, anon;
grant execute on function public.approval_correction_prepare(uuid, uuid) to authenticated;

create or replace function public.approval_correct_invoice(p_document_id uuid, p_invoice_id uuid, p_request_id uuid, p_expected_version integer,
  p_invoice jsonb, p_reason text, p_decisions jsonb default '{}'::jsonb, p_document jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a record; d public.documents; di record; plan jsonb; res jsonb; jn text; v_old_jn text; v_detail text; v_prev jsonb; v_seq int; v_year int;
  fp text := md5(jsonb_build_array('correct_invoice', p_document_id, p_invoice_id, p_invoice, p_reason, coalesce(p_decisions, '{}'), coalesce(p_document, '{}'))::text);
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if p_request_id is null then return approval_private.err('request_id_required'); end if;
  select * into d from public.documents where id = p_document_id for update;   -- اعتماد أو تصحيح متزامن للمستند نفسه ينتظر هنا
  if d.id is null or a.project_id is distinct from d.project_id then return approval_private.err('not_found'); end if;
  if not approval_private.can_approve(a.role, d.project_id) then return approval_private.err('forbidden'); end if;
  res := approval_private.replay(p_request_id, a.id, a.project_id, p_document_id, fp); if res is not null then return res; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then return approval_private.err('reason_required'); end if;
  if approval_private.mode_of(d.project_id) <> 'v2' then return approval_private.err(approval_private.mode_of(d.project_id) || '_mode'); end if;
  perform pg_advisory_xact_lock(hashtextextended('approval:' || d.project_id::text, 0));
  res := approval_private.replay(p_request_id, a.id, a.project_id, p_document_id, fp); if res is not null then return res; end if;
  if d.version <> p_expected_version then return approval_private.err('stale', jsonb_build_object('version', d.version)); end if;
  select * into di from approval_private.document_invoices where id = p_invoice_id and document_id = d.id for update;
  if not found then return approval_private.err('invoice_unknown'); end if;
  if di.status <> 'approved' then return approval_private.err('invoice_not_approved', jsonb_build_object('status', di.status)); end if;
  if di.kind not in ('expense', 'credit', 'transfer') then return approval_private.err('correction_not_supported', jsonb_build_object('kind', di.kind)); end if;
  if nullif(p_invoice ->> '_id', '') is distinct from p_invoice_id::text then return approval_private.err('invoice_mismatch'); end if;
  if coalesce(p_invoice ->> 'type', '') in ('sales', 'supplier_payment') then return approval_private.err('correction_not_supported', jsonb_build_object('kind', p_invoice ->> 'type')); end if;
  v_old_jn := di.journal_number;

  -- ما كتبته الفاتورة قبل التصحيح: يُحفظ في سجلها كما هو
  v_prev := jsonb_build_object('journal_number', v_old_jn, 'kind', di.kind, 'total', di.total, 'invoice_date', di.invoice_date,
    'approved_payload', di.approved_payload, 'decided_by', di.decided_by, 'decided_at', di.decided_at,
    'ledger', (select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]') from public.ledger_entries l where l.document_invoice_id = di.id),
    'items', (select coalesce(jsonb_agg(to_jsonb(i) order by i.sort_order, i.id), '[]') from public.document_items i where i.document_invoice_id = di.id),
    'supplier_transactions', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from public.supplier_transactions t
                               where t.document_id = d.id and t.journal_number = v_old_jn and t.type = 'invoice'));

  begin
    delete from approval_private.bank_transfers where invoice_id = di.id;
    delete from public.document_items where document_invoice_id = di.id;
    delete from public.ledger_entries where document_invoice_id = di.id;
    if di.kind = 'credit' then
      delete from public.supplier_transactions where document_id = d.id and journal_number = v_old_jn and type = 'invoice';
    end if;
    -- خارج حساب التكرار مؤقتًا (الفاتورة لا تطابق نفسها)، ثم تُكتب من جديد بالمسار نفسه
    update approval_private.document_invoices set status = 'pending' where id = di.id;
    plan := approval_private.plan_invoice(d, p_invoice, coalesce(p_decisions, '{}'), coalesce(p_document, '{}'), true);
    if not (plan ->> 'ok')::boolean then raise exception using errcode = 'P0001', message = 'APPROVAL_CORRECT:plan', detail = plan::text; end if;
    if plan ->> 'kind' not in ('expense', 'credit', 'transfer') then
      raise exception using errcode = 'P0001', message = 'APPROVAL_CORRECT:kind',
        detail = approval_private.err('correction_not_supported', jsonb_build_object('kind', plan ->> 'kind'))::text;
    end if;
    jn := approval_private.write_invoice(d, plan, a.id, p_request_id);
    -- رقم القيد الأصلي يبقى إن لم تتغير السنة، ويُعاد الرقم الذي أُخذ للكتابة إلى العدّاد (قفل صف العدّاد قائم حتى نهاية المعاملة)
    if v_old_jn is not null and split_part(v_old_jn, '-', 2) = split_part(jn, '-', 2) and jn <> v_old_jn then
      update public.ledger_entries set journal_number = v_old_jn where document_invoice_id = di.id;
      update public.document_items set journal_number = v_old_jn where document_invoice_id = di.id;
      update public.supplier_transactions set journal_number = v_old_jn where document_id = d.id and journal_number = jn and type = 'invoice';
      update approval_private.document_invoices set journal_number = v_old_jn where id = di.id;
      v_year := split_part(jn, '-', 2)::int; v_seq := split_part(jn, '-', 3)::int;
      update approval_private.journal_counters set last_seq = last_seq - 1, updated_at = now()
       where project_id = d.project_id and year = v_year and last_seq = v_seq;
      jn := v_old_jn;
    end if;
  exception
    when unique_violation then
      return approval_private.err('duplicate_invoice', jsonb_build_object('detail', 'concurrent'));
    when sqlstate 'P0001' then
      if sqlerrm like 'APPROVAL_CORRECT:%' or sqlerrm like 'APPROVAL_WRITE:%' then
        get stacked diagnostics v_detail = pg_exception_detail;
        return coalesce(nullif(v_detail, '')::jsonb, approval_private.err(split_part(sqlerrm, ':', 2)));
      end if;
      raise;
  end;

  update approval_private.document_invoices set history = history || jsonb_build_array(jsonb_build_object('event', 'corrected',
      'reason', btrim(p_reason), 'by', a.id, 'by_name', a.name, 'by_role', a.role, 'at', now(), 'journal_number', jn, 'previous', v_prev))
   where id = di.id;
  update public.documents set version = version + 1 where id = d.id returning * into d;
  res := jsonb_build_object('ok', true, 'document_status', d.status, 'version', d.version, 'journal_number', jn, 'previous_journal_number', v_old_jn,
    'previous_total', di.total, 'total', (plan ->> 'total')::numeric);
  insert into approval_private.requests (request_id, project_id, document_id, action, fingerprint, actor_id, result)
  values (p_request_id, d.project_id, d.id, 'correct_invoice', fp, a.id, res);
  return res;
end $$;
revoke all on function public.approval_correct_invoice(uuid, uuid, uuid, integer, jsonb, text, jsonb, jsonb) from public, anon;
grant execute on function public.approval_correct_invoice(uuid, uuid, uuid, integer, jsonb, text, jsonb, jsonb) to authenticated;
