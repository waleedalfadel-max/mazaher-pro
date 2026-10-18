-- تقرير المبيعات (2026-10-18): وسيلة دفع غير معروفة في التقرير تمنع الاعتماد في الخادم أيضًا، لا في الشاشة وحدها.
-- القراءة تنسخ أسطر وسائل الدفع، والتطبيق يصنّفها (src/lib/salesReport.js)؛ ما لا يُعرف يبقى في unknownPayments حتى يُنسب لقناة أو يُستبعد بسبب.
-- فحص الفرق مع الإجمالي المطبوع قائم أصلًا هنا (totalSales ⇒ amounts_mismatch)، والتطبيق صار يرسل الإجمالي المطبوع لا مجموع القنوات.
-- وبعد مراجعة a2f72ca: سطر بلا مبلغ مقروء يمنع كغير المعروف، والاستبعاد يتطلب سببًا، والقراءة بالأسطر (salesReadingVersion ≥ 2) تتطلب
-- إجماليًا مطبوعًا مستقلًا (total_required). المستندات القديمة بلا العلامة لا يتغير لها شيء.
-- التعديل الوحيد: الشروط المضافة بعد قراءة المبالغ؛ بقية النص مطابق لنص الإنتاج حرفيًا (ومنح التنفيذ كما هو: create or replace يبقيه).

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
  -- وسيلة دفع غير معروفة بمبلغ غير صفري (أو بلا مبلغ مقروء) لم تُنسب لقناة ولم تُستبعد بسبب: لا اعتماد (src/lib/salesReport.js)
  if jsonb_typeof(inv -> 'unknownPayments') = 'array' and exists (select 1 from jsonb_array_elements(inv -> 'unknownPayments') e
      where coalesce(nullif(btrim(e ->> 'amount'), ''), '1') !~ '^-?0*([.]0*)?$') then
    return jsonb_build_object('code', 'unknown_payment', 'labels', (select jsonb_agg(e ->> 'label') from jsonb_array_elements(inv -> 'unknownPayments') e));
  end if;
  -- سطر مستبعد بلا سبب موثّق (مراجعة a2f72ca)
  if jsonb_typeof(inv -> 'resolvedPayments') = 'array' and exists (select 1 from jsonb_array_elements(inv -> 'resolvedPayments') e
      where nullif(e ->> 'channel', '') is null and nullif(btrim(e ->> 'reason'), '') is null) then
    return jsonb_build_object('code', 'exclusion_reason_required');
  end if;
  -- القراءة بالأسطر (salesReadingVersion ≥ 2) لا تُعتمد بلا إجمالي مستقل من التقرير؛ المستندات القديمة بلا العلامة كما كانت (مراجعة a2f72ca)
  if v_total is null and coalesce(inv ->> 'salesReadingVersion', '') ~ '^[0-9]{1,4}$' and (inv ->> 'salesReadingVersion')::int >= 2 then
    return jsonb_build_object('code', 'total_required');
  end if;
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
