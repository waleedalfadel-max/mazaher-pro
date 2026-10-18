-- رجوع 20261018150000: نص الإنتاج الأصلي لـ approval_private.sales_channels (قبل شرط وسائل الدفع غير المعروفة).

CREATE OR REPLACE FUNCTION approval_private.sales_channels(inv jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
end $function$;
