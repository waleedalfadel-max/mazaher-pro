-- Original-file text is independent of accounting records and approval state.
create table public.document_original_text (
  document_id uuid primary key references public.documents(id) on delete cascade,
  source_url text not null,
  body text not null default '',
  state text not null check (state in ('processing','ready','empty','retry','failed')),
  attempts integer not null default 0,
  next_page integer not null default 1,
  retry_at timestamptz,
  lease uuid
);
alter table public.document_original_text enable row level security;
revoke all on public.document_original_text from public, anon, authenticated;
grant select on public.document_original_text to authenticated;
grant all on public.document_original_text to service_role;
create policy document_original_text_read on public.document_original_text for select to authenticated
using ((select public.auth_role()) in ('owner','accountant','superadmin') and exists (
  select 1 from public.documents d where d.id=document_id and d.project_id=(select public.auth_project_id())
    and d.file_url=source_url
));

create function public.document_search_fold(value text)
returns text language sql immutable strict parallel safe set search_path='' as $$
  select btrim(regexp_replace(translate(lower(normalize(value,NFKC)),
    'أإآٱىکیک٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹ـًٌٍَُِّْٰ',
    'اااايكيك01234567890123456789'), '[[:space:]]+', ' ', 'g'))
$$;

-- Restrict the indexed reading to document fields. Discard diagnostic candidates
-- and suggested corrections, which may have never appeared on the invoice.
create function public.document_reading_lines(value jsonb)
returns text language sql immutable parallel safe set search_path='' as $$
  with recursive fields(key, val) as (
    select ''::text,value
    union all
    select child.key,child.val from fields f cross join lateral (
      select e.key,e.value from jsonb_each(case when jsonb_typeof(f.val)='object' then f.val else '{}' end) e
        where e.key in ('invoices','items','paymentLines','returnLines','salesBreakdown','bankReceipt','paymentEvidence',
          'description','name','label','supplier','supplier_name','supplierName','beneficiary','beneficiaryBank',
          'beneficiaryAccount','reference','invoiceNumber','transType','category_main','category_sub',
          'branch','date','amount','totalAmount','vatAmount','totalSales','quantity','unitPrice','accountNumber',
          'billNumber','subscriberNumber','billerName','customerName','memo','notes')
      union all select f.key,a.value from jsonb_array_elements(case when jsonb_typeof(f.val)='array' then f.val else '[]' end) a
    ) child(key,val)
  )
  select coalesce(string_agg(val #>> '{}',chr(10)), '') from fields where jsonb_typeof(val) in ('string','number')
$$;

create extension if not exists pg_trgm with schema extensions;
create index document_reading_text_trgm on public.documents using gin
  (public.document_search_fold(public.document_reading_lines(analysis_result)) extensions.gin_trgm_ops);
create index document_original_text_trgm on public.document_original_text using gin
  (public.document_search_fold(body) extensions.gin_trgm_ops);

-- Search one literal phrase. The snippet keeps the printed spelling whenever a
-- single line contains it. Handle wrapped lines and long OCR lines as well.
create function public.document_match_excerpt(body text, needle text)
returns text language sql immutable strict parallel safe set search_path='' as $$
  with lines as (
    select s,public.document_search_fold(s) folded,ord from regexp_split_to_table(body,E'[\r\n]+') with ordinality l(s,ord)
    union all select public.document_search_fold(body), public.document_search_fold(body),9223372036854775807::bigint
  )
  select case when length(s)<=180 then s else substring(folded from greatest(1,strpos(folded,needle)-50) for greatest(180,length(needle))) end
  from lines where strpos(folded,needle)>0 order by ord limit 1
$$;

create function public.search_uploaded_documents(p_project uuid,p_phrase text)
returns table (id uuid,file_name text,file_type text,file_url text,status text,uploaded_at timestamptz,
  uploaded_by text,uploaded_by_name text,created_by_user_id uuid,created_by_name text,created_by_role text,match_excerpt text)
language sql stable security invoker set search_path='' as $$
  with q as materialized (
    select term, '%'||replace(replace(replace(term,chr(92),chr(92)||chr(92)),'%',chr(92)||'%'),'_',chr(92)||'_')||'%' pattern
    from (select public.document_search_fold(p_phrase) term) n
    where length(term) between 1 and 200 and p_project=(select public.auth_project_id())
      and (select public.auth_role()) in ('owner','accountant','superadmin')
  ), hits as (
    select d.id,2 priority,public.document_reading_lines(d.analysis_result) body
      from public.documents d,q where d.project_id=p_project and public.document_search_fold(public.document_reading_lines(d.analysis_result)) like q.pattern
    union all
    select d.id,4,t.body from public.document_original_text t join public.documents d on d.id=t.document_id and d.file_url=t.source_url,q
      where d.project_id=p_project and public.document_search_fold(t.body) like q.pattern
    union all
    select d.id,1,concat_ws(chr(10),i.description,i.category_main,i.category_sub,c.name,sc.name)
      from public.document_items i join public.documents d on d.id=i.document_id and d.project_id=i.project_id
      left join public.categories c on c.id=i.category_id and c.project_id=i.project_id
      left join public.categories sc on sc.id=i.subcategory_id and sc.project_id=i.project_id,q
      where d.project_id=p_project and public.document_search_fold(concat_ws(chr(10),i.description,i.category_main,i.category_sub,c.name,sc.name)) like q.pattern
    union all
    select d.id,3,x.body from public.ledger_entries l join public.documents d on d.project_id=l.project_id and
      (l.document_id=d.id or (l.document_id is null and l.file_url=d.file_url))
      left join public.suppliers s on s.id=l.supplier_id and s.project_id=l.project_id
      left join public.categories c on c.id=l.category_id and c.project_id=l.project_id
      cross join lateral (select concat_ws(chr(10),s.name,l.description,l.type,l.category_main,l.category_sub,c.name,l.invoice_number,l.journal_number) body) x,q
      where l.project_id=p_project and public.document_search_fold(x.body) like q.pattern
    union all
    select d.id,5,x.body from public.documents d cross join lateral (select concat_ws(chr(10),d.file_name,
      d.branch,d.journal_number,d.purchase_category,d.category_main,d.category_sub) body) x,q
      where d.project_id=p_project and public.document_search_fold(x.body) like q.pattern
  ), first_hit as (
    select distinct on (h.id) h.id,h.body from hits h order by h.id,h.priority,length(h.body),h.body
  )
  select d.id,d.file_name,d.file_type,d.file_url,d.status,d.uploaded_at,d.uploaded_by,d.uploaded_by_name,
    d.created_by_user_id,d.created_by_name,d.created_by_role,public.document_match_excerpt(h.body,q.term)
    from first_hit h join public.documents d on d.id=h.id and d.project_id=p_project cross join q
$$;
revoke all on function public.search_uploaded_documents(uuid,text) from public,anon;
grant execute on function public.search_uploaded_documents(uuid,text) to authenticated;

-- Only the server worker can claim files. A lease prevents parallel runs and
-- fences a slow result if the source changes or another worker takes over.
create function public.claim_document_text(p_document uuid default null)
returns table(document_id uuid,project_id uuid,source_url text,file_type text,lease uuid,attempts integer,next_page integer)
language sql volatile security invoker set search_path='' as $$
  with candidate as (
    select d.id,d.project_id,d.file_url,d.file_type from public.documents d
      left join public.document_original_text t on t.document_id=d.id
    where d.file_url is not null and (p_document is null or d.id=p_document)
      and (t.document_id is null or t.source_url<>d.file_url or
        (t.state in ('processing','retry') and t.retry_at<=now()))
    order by d.uploaded_at desc,d.id limit 1 for update of d skip locked
  ), claimed as (
    insert into public.document_original_text as t(document_id,source_url,state,attempts,retry_at,lease)
    select id,file_url,'processing',1,now()+interval '6 minutes',gen_random_uuid() from candidate
    on conflict on constraint document_original_text_pkey do update set source_url=excluded.source_url,
      state='processing',body=case when t.source_url=excluded.source_url then t.body else '' end,
      next_page=case when t.source_url=excluded.source_url then t.next_page else 1 end,lease=excluded.lease,retry_at=excluded.retry_at,
      attempts=case when t.source_url=excluded.source_url then t.attempts+1 else 1 end
    returning t.document_id,t.source_url,t.lease,t.attempts,t.next_page
  )
  select c.id,c.project_id,t.source_url,c.file_type,t.lease,t.attempts,t.next_page from claimed t join candidate c on c.id=t.document_id
$$;
revoke all on function public.claim_document_text(uuid) from public,anon,authenticated;
grant execute on function public.claim_document_text(uuid) to service_role;

create function public.finish_document_text(p_document uuid,p_lease uuid,p_text text,p_next integer)
returns void language sql volatile security invoker set search_path='' as $$
  update public.document_original_text set body=concat_ws(chr(10),nullif(body,''),nullif(p_text,'')),
    state=case when p_next is not null then 'retry' when body='' and p_text='' then 'empty' else 'ready' end,
    attempts=0,next_page=coalesce(p_next,next_page),retry_at=case when p_next is not null then now() end,lease=null
    where document_id=p_document and lease=p_lease and state='processing'
$$;
revoke all on function public.finish_document_text(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.finish_document_text(uuid,uuid,text,integer) to service_role;
