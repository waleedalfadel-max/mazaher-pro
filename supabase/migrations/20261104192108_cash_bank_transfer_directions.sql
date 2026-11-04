-- Reuse the established document approval, idempotency and account checks.
do $install$
declare
  planner regprocedure := 'approval_private.plan_invoice(public.documents,jsonb,jsonb,jsonb,boolean)'::regprocedure;
  writer regprocedure := 'approval_private.write_invoice(public.documents,jsonb,uuid,uuid)'::regprocedure;
  definition text;
  anchor text;
begin
  anchor := 'plan := approval_private.plan_invoice_core(d, inv, p_decisions, p_document, v_known);';
  definition := pg_get_functiondef(planner);
  if array_length(string_to_array(definition,anchor),1) <> 2 then raise exception 'Unexpected approval planner'; end if;
  execute replace(definition,anchor,$patch$
  if inv->>'type'='transfer' and inv->>'transType' in ('🏧 تحويل داخلي — إيداع نقدي','تحويل داخلي — إيداع نقدي','🏧 تحويل داخلي — سحب نقدي','تحويل داخلي — سحب نقدي') then
    inv := inv || jsonb_build_object('paySource', case when inv->>'transType' like '%إيداع نقدي' then 'cash' else 'bank' end);
  end if;
  $patch$ || anchor);
  anchor := 'elsif v_kind = ''transfer'' then';
  definition := pg_get_functiondef(writer);
  if array_length(string_to_array(definition,anchor),1) <> 2 then raise exception 'Unexpected transfer writer'; end if;
  execute replace(definition,anchor,$patch$
  elsif v_kind='transfer' and plan->>'trans_type' in ('🏧 تحويل داخلي — سحب نقدي','تحويل داخلي — سحب نقدي') then
    v_total := (plan->>'total')::numeric;
    insert into public.ledger_entries(project_id,date,type,description,cash_in,bank_out,vat_amount,total_amount,status,file_url,journal_number,branch,document_id,document_invoice_id,bank_account_id)
    values(d.project_id,v_date,'🏧 تحويل داخلي — سحب نقدي',coalesce(plan->>'description',d.file_name),v_total,v_total,0,v_total,'approved',coalesce(d.file_url,''),jn,v_branch,d.id,v_id,v_bank);
  $patch$ || anchor);
end
$install$;

-- A transfer occupies one row. Both cash and bank statements must see the same amount.
create function approval_private.cash_bank_amounts_guard() returns trigger
language plpgsql set search_path='' as $fn$
declare deposit boolean := new.type like '%إيداع نقدي';
begin
  if new.type not in ('🏧 تحويل داخلي — إيداع نقدي','تحويل داخلي — إيداع نقدي','🏧 تحويل داخلي — سحب نقدي','تحويل داخلي — سحب نقدي') then return new; end if;
  if not coalesce(new.total_amount>0 and new.total_amount=round(new.total_amount,2)
    and coalesce(new.cash_in,0)=case when deposit then 0 else new.total_amount end
    and coalesce(new.bank_out,0)=case when deposit then 0 else new.total_amount end
    and coalesce(new.cash_out,0)=case when deposit then new.total_amount else 0 end
    and coalesce(new.bank_in,0)=case when deposit then new.total_amount else 0 end
    and coalesce(new.custody_in,0)=0 and coalesce(new.custody_out,0)=0
    and coalesce(new.receivable_in,0)=0 and coalesce(new.receivable_out,0)=0
    and coalesce(new.payable_in,0)=0 and coalesce(new.payable_out,0)=0
    and coalesce(new.vat_amount,0)=0 and coalesce(new.output_vat_amount,0)=0,false) then
    raise exception 'أدخل مبلغ التحويل نفسه خارجًا من المصدر وداخلًا إلى الوجهة.' using errcode='23514';
  end if;
  return new;
end $fn$;
revoke all on function approval_private.cash_bank_amounts_guard() from public,anon,authenticated;
create trigger cash_bank_amounts_guard before insert or update of type,total_amount,cash_in,cash_out,bank_in,bank_out,custody_in,custody_out,receivable_in,receivable_out,payable_in,payable_out,vat_amount,output_vat_amount on public.ledger_entries
for each row execute function approval_private.cash_bank_amounts_guard();

update public.project_settings ps set settings=jsonb_set(settings,'{transaction_types}',
  (settings->'transaction_types') || jsonb_build_array(jsonb_build_object('label','🏧 تحويل داخلي — سحب نقدي')))
from public.projects p where ps.project_id=p.id and p.subdomain='tashormik'
  and jsonb_typeof(settings->'transaction_types')='array'
  and not ((settings->'transaction_types') @> '[{"label":"🏧 تحويل داخلي — سحب نقدي"}]'::jsonb);
