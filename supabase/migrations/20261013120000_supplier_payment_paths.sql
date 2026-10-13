-- مسارات سداد الموردين (مراجعة الجولة 3: R3-01 وG3-01)
-- السداد يُسجَّل من «الموردين» وحدها (supplier_payment_record): حركة المورد وقيد الدفتر بتخفيض الالتزام معًا. كل مسار آخر يكتب
-- قيد «سداد مورد» من المتصفح (سجل الدفتر، المطابقة البنكية، صفحات نسخة سابقة) يُرفض من الخادم، لأن القيد بلا تخفيض التزام
-- يُحتسب تكلفة ثانية لفاتورة سُجلت آجلًا. وتصحيح دفعة مسجلة بحذفها ذريًا (supplier_payment_delete) ثم إعادة تسجيلها.
-- لا يمس القيود التاريخية: لا تُعدَّل بياناتها، و«سداد مورد» التاريخي يبقى محتسبًا كما هو.

-- ── 1) قيود «سداد مورد» في الدفتر: لا إدراج ولا تعديل مالي ولا حذف خارج المسار الموثوق ─────────────────────────────
-- الموثوق: دالتا السداد (supplier_payment_record وsupplier_payment_delete) تفتحان «tahseeb.supplier_payment» للمعاملة حول كتابتهما،
-- والصيانة المباشرة بلا طلب واجهة (psql/هجرة: لا request.jwt.claims). أي كتابة أخرى داخل طلب من الواجهة تخضع للحارس، سواء من دور
-- المتصفح أو من دالة SECURITY DEFINER أخرى (مثل الاعتماد — R4-02؛ current_user فيها مالكها، فلا يكفي فحص الدور).
-- المسموح لغير الموثوق على قيد «سداد مورد»: الوصف والمرفق والفرع، واعتماد/رفض قيد تاريخي معلّق (Journals). كل ما يغير
-- المبلغ أو النوع أو التاريخ أو رقم القيد أو المورد أو الحالة بعد الاعتماد مرفوض، والحذف عبر الدالة وحدها.
create function approval_private.ledger_supplier_payment_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_msg constant text := 'سداد الموردين يُسجَّل من صفحة «الموردين» وحدها، لأنها تخفض المستحق للمورد مع القيد؛ والمطابقة البنكية تطابق حركة البنك مع الدفعة المسجلة هناك.';
  v_old boolean := tg_op in ('UPDATE', 'DELETE') and coalesce(old.type, '') like '%سداد مورد%';
  v_new boolean := tg_op in ('INSERT', 'UPDATE') and coalesce(new.type, '') like '%سداد مورد%';
  v_free constant text[] := array['description', 'file_url', 'original_name', 'drive_file_id', 'branch', 'status'];
  v_trusted boolean := current_user not in ('authenticated', 'anon')
    and (nullif(current_setting('request.jwt.claims', true), '') is null or current_setting('tahseeb.supplier_payment', true) = 'on');
begin
  if v_trusted or not (v_old or v_new) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    raise exception '%', v_msg using errcode = 'P0001', hint = 'supplier_payment_record';
  elsif tg_op = 'DELETE' then
    raise exception 'قيد سداد المورد يُحذف مع حركته في حساب المورد معًا، من زر الحذف في «سجل الدفتر» بعد تحديث الصفحة.'
      using errcode = 'P0001', hint = 'supplier_payment_delete';
  end if;
  -- UPDATE: النوع إلى «سداد مورد» أو منه، أو أي عمود مالي/تعريفي
  if v_old is distinct from v_new
     or (to_jsonb(old) - v_free) is distinct from (to_jsonb(new) - v_free)
     or (old.status is distinct from new.status and not (old.status = 'pending' and new.status in ('approved', 'rejected'))) then
    raise exception 'لا يُعدَّل مبلغ قيد سداد المورد أو نوعه أو تاريخه من الدفتر: احذف الدفعة من «سجل الدفتر» (تُحذف معها حركة المورد) ثم سجّلها صحيحة من «الموردين».'
      using errcode = 'P0001', hint = 'supplier_payment_delete';
  end if;
  return new;
end $$;
create trigger ledger_supplier_payment_guard before insert or update or delete on public.ledger_entries
  for each row execute function approval_private.ledger_supplier_payment_guard();

-- ── 2) حركة «دفعة» المورد: لا تعديل ولا حذف من المتصفح، ولا تحويل حركة أخرى إلى «دفعة» ─────────────────────────────
-- (الإدراج مغلق منذ 20261010130000). الحذف المتسلسل من حذف المورد يعمل بصلاحية مالك الجدول فلا يمسه.
create or replace function approval_private.supplier_payment_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon')
     and ((tg_op in ('INSERT', 'UPDATE') and new.type = 'payment') or (tg_op in ('UPDATE', 'DELETE') and old.type = 'payment')) then
    if tg_op = 'INSERT' then
      raise exception 'تسجيل دفعات الموردين صار من الصفحة المحدّثة فقط. حدّث الصفحة ثم سجّل الدفعة من «الموردين».'
        using errcode = 'P0001', hint = 'supplier_payment_record';
    end if;
    raise exception 'دفعة المورد تُصحَّح بحذفها مع قيدها من «سجل الدفتر» ثم تسجيلها صحيحة من «الموردين».'
      using errcode = 'P0001', hint = 'supplier_payment_delete';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger supplier_payment_guard on public.supplier_transactions;
create trigger supplier_payment_guard before insert or update or delete on public.supplier_transactions
  for each row execute function approval_private.supplier_payment_guard();

-- ── 3) حذف دفعة ذريًا: حركة المورد وقيد الدفتر وسجل إعادة المحاولة معًا ─────────────────────────────────────────────
-- بالمحاسب وحده في منشأته النشطة. بقفل المورد (كما في التسجيل) فلا تتداخل مع دفعة متزامنة. p_entry_id لقيد تاريخي بلا رقم قيد.
-- سجل الطلب لا يُمسح بل يُعلَّم «حُذفت دفعته» (R4-01): إعادة الطلب نفسه بعده ترد payment_deleted ولا تعيد إنشاء الدفعة.
-- الترتيب: قفل المورد ← تعليم سجل الطلب (أول كتابة؛ إعادة متزامنة للطلب تنتظره بـ FOR SHARE ثم ترى الحذف) ← حذف القيد والحركة.
create function public.supplier_payment_delete(p_journal_number text, p_entry_id uuid default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare a record; v_jn text := nullif(btrim(coalesce(p_journal_number, '')), ''); v_sup uuid; v_led int; v_tx int;
begin
  select * into a from approval_private.actor();
  if a.id is null then return approval_private.err('no_session'); end if;
  if a.role is distinct from 'accountant' or a.project_id is null then return approval_private.err('forbidden'); end if;
  if not coalesce((select ps.active from public.project_settings ps where ps.project_id = a.project_id), true) then
    return approval_private.err('project_inactive');
  end if;
  if p_entry_id is not null then
    select le.journal_number into v_jn from public.ledger_entries le
     where le.id = p_entry_id and le.project_id = a.project_id and le.type like '%سداد مورد%';
    if not found then return approval_private.err('not_found'); end if;
  end if;
  if v_jn is null and p_entry_id is null then return approval_private.err('bad_request'); end if;

  -- قفل مورد القائمة (أو المورد الآجل) قبل الحذف
  if v_jn is not null then
    select t.supplier_id into v_sup from public.supplier_transactions t
     where t.project_id = a.project_id and t.journal_number = v_jn and t.type = 'payment' limit 1;
    if v_sup is not null then
      perform 1 from public.suppliers s where s.id = v_sup and s.project_id = a.project_id for update;
    else
      perform 1 from public.payable_suppliers ps where ps.project_id = a.project_id and ps.id in (
        select le.supplier_id from public.ledger_entries le where le.project_id = a.project_id and le.journal_number = v_jn
           and le.type like '%سداد مورد%' and le.supplier_id is not null) for update;
    end if;
  end if;

  -- بعد القفل: لا شيء يُحذف ← not_found بلا أي كتابة (ولا يُعلَّم سجل طلب)
  if not exists (select 1 from public.ledger_entries le where le.project_id = a.project_id and le.type like '%سداد مورد%'
                  and ((v_jn is not null and le.journal_number = v_jn) or le.id = p_entry_id))
     and not (v_jn is not null and exists (select 1 from public.supplier_transactions t
                  where t.project_id = a.project_id and t.journal_number = v_jn and t.type = 'payment')) then
    return approval_private.err('not_found');
  end if;
  if v_jn is not null then
    update approval_private.supplier_payment_requests r set deleted_at = now(), deleted_by = a.id
     where r.project_id = a.project_id and r.result ->> 'journal_number' = v_jn and r.deleted_at is null;
  end if;

  perform set_config('tahseeb.supplier_payment', 'on', true);
  delete from public.ledger_entries le where le.project_id = a.project_id and le.type like '%سداد مورد%'
     and ((v_jn is not null and le.journal_number = v_jn) or le.id = p_entry_id);
  get diagnostics v_led = row_count;
  if v_jn is not null then
    delete from public.supplier_transactions t where t.project_id = a.project_id and t.journal_number = v_jn and t.type = 'payment';
    get diagnostics v_tx = row_count;
  end if;
  perform set_config('tahseeb.supplier_payment', 'off', true);
  return jsonb_build_object('ok', true, 'journal_number', v_jn, 'ledger_rows', v_led, 'supplier_rows', coalesce(v_tx, 0));
end $$;
revoke all on function public.supplier_payment_delete(text, uuid) from public, anon;
grant execute on function public.supplier_payment_delete(text, uuid) to authenticated;

-- ── 4) الاعتماد لا يُنتج «سداد مورد» (مراجعة الجولة 4: R4-02) ─────────────────────────────────────────────────────────
-- الاعتماد يكتب السند بخروج نقدي دون تخفيض المستحق ودون حركة في حساب المورد، فيُحتسب تكلفة ثانية لفاتورة سُجلت آجلًا.
-- الفحص على الخطة النهائية بعد اشتقاق الأنواع (لا على حقل واحد): نوع التحويل، ونوع المصروف المختار، ونوع كل مجموعة
-- (من التصنيف المربوط أو نوع البند)، وتصنيفها، وبنودها. الرفض في مرحلة الخطة، قبل حجز رقم القيد وقبل أي كتابة، والطلب كله
-- يُرفض (approval_approve يرجع أول خطأ خطة)، فلا اعتماد جزئي لبقية فواتير المستند. نص الخطة الأصلية لا يتغير (plan_invoice_core).
alter function approval_private.plan_invoice(public.documents, jsonb, jsonb, jsonb, boolean) rename to plan_invoice_core;
create function approval_private.plan_invoice(d public.documents, inv jsonb, p_decisions jsonb, p_document jsonb, v_known boolean)
returns jsonb language plpgsql stable set search_path = '' as $$
declare plan jsonb := approval_private.plan_invoice_core(d, inv, p_decisions, p_document, v_known);
begin
  if not coalesce((plan ->> 'ok')::boolean, false) or plan ->> 'kind' = 'sales' then return plan; end if;
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

notify pgrst, 'reload schema';
