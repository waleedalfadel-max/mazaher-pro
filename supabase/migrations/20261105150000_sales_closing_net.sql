-- Validate against the saved reading at the same transaction boundary as approval and correction.
-- Existing journals and reports are never replayed or rewritten.
create function approval_private.check_sales_closing_net() returns trigger
language plpgsql set search_path = '' as $$
declare
  source_reading jsonb := new.original_reading;
  submitted jsonb := new.approved_payload;
  reviewed jsonb := submitted -> 'printedNetReview';
  source_text text := replace(translate(approval_private.latin_digits(source_reading ->> 'reportNetTotal'), '٫٬', '.,'), ',', '');
  reviewed_text text := reviewed ->> 'value';
  confirmed boolean;
begin
  confirmed := coalesce(jsonb_typeof(reviewed -> 'reason') = 'string'
    and nullif(btrim(reviewed ->> 'reason'), '') is not null
    and case when reviewed_text ~ '^[0-9]+([.][0-9]{1,2})?$'
      then reviewed_text::numeric = new.total else false end, false);
  if (submitted -> 'manualReview' ->> 'mode' = 'confirmed_channels' and not confirmed)
    or (coalesce(source_reading -> 'salesAlignmentUnclear' = 'true'::jsonb, false)
      and not coalesce(submitted -> 'manualReview' ->> 'mode' = 'confirmed_channels' and confirmed, false)
      and not coalesce(jsonb_typeof(submitted #> '{salesRowsReview,reason}')='string'
        and nullif(btrim(submitted #>> '{salesRowsReview,reason}'), '') is not null
        and case when jsonb_typeof(submitted #> '{salesRowsReview,rows}')='array'
          then jsonb_array_length(submitted #> '{salesRowsReview,rows}') > 0 else false end, false))
    or (case when btrim(source_text) ~ '^[0-9]+([.][0-9]+)?$'
          then source_text::numeric <> new.total else false end and not confirmed) then
    raise exception 'sales_net_review_required' using errcode = 'P0521';
  end if;
  return new;
end $$;
revoke all on function approval_private.check_sales_closing_net() from public, anon, authenticated;

create trigger check_sales_closing_net before insert or update of status, approved_payload, total
on approval_private.document_invoices for each row
when (new.status = 'approved' and new.kind in ('sales', 'sales_correction'))
execute function approval_private.check_sales_closing_net();

-- Exact merchant-specific alias. Keep any previously configured mapping.
update public.project_settings ps
set settings = jsonb_set(ps.settings, '{pos_payment_aliases}',
  coalesce(ps.settings -> 'pos_payment_aliases', '{}'::jsonb) || '{"triple hunger":"hunger"}'::jsonb)
from public.projects p
where ps.project_id=p.id and p.subdomain='tashormik'
  and jsonb_typeof(ps.settings)='object'
  and jsonb_typeof(coalesce(ps.settings -> 'pos_payment_aliases', '{}'::jsonb))='object'
  and not exists (select 1 from jsonb_object_keys(coalesce(ps.settings -> 'pos_payment_aliases','{}'::jsonb)) k where lower(k)='triple hunger');
