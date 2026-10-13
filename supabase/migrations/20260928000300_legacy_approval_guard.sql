-- بعد تفعيل الاعتماد الجديد لمنشأة: الخادم يمنع مسار الاعتماد السابق عند أول كتابة له، حتى من صفحة ظلت مفتوحة،
-- فلا يبقى أثر جزئي (قيد أو بند أو مبيعات أو حركة مورد أو مورد).
--
-- التمييز من حقائق يتحقق منها الخادم، لا من علامة يرسلها المتصفح:
--   • دوال الخادم (approval_*) مالكها postgres، فكتابتها بدور مالكها؛ الكتابة المباشرة من العميل بدور authenticated.
--   • ما يكتبه الاعتماد وحده: بنود المستندات، والموردون بالاسم (payable_suppliers).
--   • المرتبط بمستند: حركة مورد لها document_id، وقيد مسار ملفه هو مسار ملف مستند في المنشأة نفسها (يتحقق الخادم
--     من جدول المستندات؛ الصفحات اليدوية تكتب مسارًا فارغًا أو ملف كشفها الخاص).
--   • صف مبيعات بوصف «تقرير POS»: توقيع ثابت في كود الاعتماد السابق وحده (الإدخال السريع يكتب وصفًا آخر).
--     يُستعمل للمنع فقط، لا يمنح أي صلاحية.
--   • تغيير حالة المستند مباشرة إلى معتمد أو مرفوض.
-- العمليات اليدوية المشروعة (الإدخال السريع، القيود اليدوية، المطابقات، سداد المورد) لا تطابق أيًّا من ذلك.

grant usage on schema approval_private to authenticated;

create function approval_private.v2_active(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from approval_private.settings where project_id = p_project and v2_enabled_at is not null)
$$;

create function approval_private.is_document_file(p_project uuid, p_file_url text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_file_url, '') <> ''
     and exists (select 1 from public.documents d where d.project_id = p_project and d.file_url = p_file_url)
$$;

create function approval_private.legacy_guard() returns trigger language plpgsql set search_path = '' as $$
declare
  msg constant text := 'تغيّرت طريقة الاعتماد في هذه المنشأة. حدّث الصفحة ثم أعد الاعتماد — لم يُسجَّل شيء من هذا المستند.';
  v_block boolean := false;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;   -- دوال الخادم بدور مالكها
  if not approval_private.v2_active(new.project_id) then return new; end if;
  -- فرع لكل جدول: الحقول تختلف بين الجداول
  if tg_table_name in ('document_items', 'payable_suppliers') then v_block := true;
  elsif tg_table_name = 'supplier_transactions' then v_block := new.document_id is not null;
  elsif tg_table_name = 'sales' then v_block := new.description = 'تقرير POS';
  elsif tg_table_name = 'ledger_entries' then v_block := approval_private.is_document_file(new.project_id, new.file_url);
  elsif tg_table_name = 'documents' then
    v_block := tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved', 'rejected');
  end if;
  if v_block then raise exception using errcode = 'P0001', message = msg, hint = 'approval_v2_active'; end if;
  return new;
end $$;

revoke all on function approval_private.v2_active(uuid), approval_private.is_document_file(uuid, text), approval_private.legacy_guard() from public;
grant execute on function approval_private.v2_active(uuid), approval_private.is_document_file(uuid, text), approval_private.legacy_guard() to authenticated, anon;

create trigger approval_legacy_guard before insert on public.ledger_entries for each row execute function approval_private.legacy_guard();
create trigger approval_legacy_guard before insert on public.document_items for each row execute function approval_private.legacy_guard();
create trigger approval_legacy_guard before insert on public.sales for each row execute function approval_private.legacy_guard();
create trigger approval_legacy_guard before insert on public.supplier_transactions for each row execute function approval_private.legacy_guard();
create trigger approval_legacy_guard before insert on public.payable_suppliers for each row execute function approval_private.legacy_guard();
create trigger approval_legacy_guard before update on public.documents for each row execute function approval_private.legacy_guard();

-- التفعيل ممنوع ما دام في المنشأة مستند معلّق بلا مسار ملف: قيد المسار السابق له بلا مسار فلا يُربط بمستند.
-- يُعالج أولًا (يُعتمد بالمسار السابق قبل التفعيل، أو يُرفع من جديد، أو يُرفض).
create or replace function public.approval_set_mode(p_project_id uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; n int;
begin
  select * into a from approval_private.actor();
  if a.role is distinct from 'superadmin' then return approval_private.err('forbidden'); end if;
  if p_mode = 'v2' and not approval_private.v2_active(p_project_id) then
    select count(*) into n from public.documents where project_id = p_project_id and status in ('uploaded', 'analyzed') and coalesce(file_url, '') = '';
    if n > 0 then return approval_private.err('documents_without_file', jsonb_build_object('count', n)); end if;
  end if;
  insert into approval_private.settings (project_id, mode, updated_by) values (p_project_id, p_mode, a.id)
  on conflict (project_id) do update set mode = excluded.mode, updated_by = excluded.updated_by;
  return jsonb_build_object('ok', true, 'mode', p_mode);
exception when sqlstate 'P0001' then return approval_private.err('mode_locked');
end $$;
