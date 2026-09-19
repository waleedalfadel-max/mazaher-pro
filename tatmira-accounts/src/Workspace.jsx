import React, { useEffect, useRef, useState } from 'react';
import { fmtSar, moneyFieldValue, quantityFieldValue, inputValue } from '../../tatmira-demo/src/lib/money.js';
import { saleTotals, purchaseTotals } from '../../tatmira-demo/src/lib/ledger.js';
import { TAX_MODE, taxSettingForDate, ratePercentToBps } from '../../tatmira-demo/src/lib/tax.js';
const KINDS = { sale: 'فاتورة بيع', payment: 'إثبات سداد', purchase: 'مستند مصروفات' };
const STATUS = { pending: 'بانتظار المراجعة', approved: 'معتمد', rejected: 'مرفوض' };
const UPLOAD = { sale: 'upload_sale', payment: 'upload_payment', purchase: 'upload_expense' };
const can = (actor, grant) => actor.role === 'owner' || actor.grants?.includes(grant);
const today = () => new Date().toISOString().slice(0, 10);
function Field({ label, children, ...props }) { return <label className="field"><span>{label}</span>{children || <input {...props} />}</label>; }
function Select({ label, value, onChange, items, required = true }) {
  return <Field label={label}><select value={value || ''} onChange={e => onChange(e.target.value)} required={required}><option value="">اختر…</option>{items.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>;
}
function Money({ label, value, onChange }) { return <Field label={label} inputMode="decimal" value={typeof value === 'number' ? inputValue(value) : value || ''} onChange={e => onChange(moneyFieldValue(e.target.value))} />; }
function Upload({ actor, data, mutate, busy }) {
  const kinds = Object.keys(KINDS).filter(k => can(actor, UPLOAD[k]));
  const [kind, setKind] = useState(kinds[0] || ''), [customerId, setCustomer] = useState(''), [file, setFile] = useState(null), [inputKey, setInputKey] = useState(0);
  if (!kinds.length) return null;
  return <form className="card" onSubmit={async e => { e.preventDefault(); if (await mutate({ type: 'DOC_ADD', kind, customerId }, file)) { setFile(null); setInputKey(v => v + 1); } }}><h2>رفع مستند</h2><fieldset disabled={busy} className="plain-fieldset">
    <div className="form-grid"><Select label="نوع المستند" value={kind} onChange={setKind} items={kinds.map(id => ({ id, name: KINDS[id] }))} />
    {kind !== 'purchase' && <Select label="العميل / نقطة البيع" value={customerId} onChange={setCustomer} items={data.customers.filter(c => !c.archived)} />}</div>
    {kind !== 'purchase' && !data.customers.some(c => !c.archived) && <p className="notice">يلزم أن يضيف المالك أو مسؤول العملاء أول نقطة بيع.</p>}
    <Field label="صورة أو PDF — حتى 5 ميجابايت" key={inputKey} type="file" required accept="image/jpeg,image/png,application/pdf" onChange={e => setFile(e.target.files[0] || null)} />
    <p>يحفظ الملف في مساحة المنشأة المشتركة. لا يغيّر الأرصدة حتى تتم مراجعته واعتماده.</p>
    <button className="primary" disabled={!file}>{busy ? 'جارٍ الرفع…' : 'رفع للمراجعة'}</button></fieldset></form>;
}
function Review({ document: doc, data, mutate, download, busy, close }) {
  const [fields, setFields] = useState(() => structuredClone(doc.fields));
  const patch = changes => setFields(f => ({ ...f, ...changes }));
  const dirty = JSON.stringify(fields) !== JSON.stringify(doc.fields);
  const line = (index, changes) => patch({ lines: fields.lines.map((l, i) => i === index ? { ...l, ...changes } : l) });
  async function run(command) { if (await mutate(command, null, doc.revision)) close(); }
  const totals = doc.kind === 'sale' ? saleTotals(fields, taxSettingForDate(data, fields.date)) : doc.kind === 'purchase' ? purchaseTotals(fields) : null;
  return <section className="card editor"><div className="title-row"><h2>مراجعة {KINDS[doc.kind]}</h2><button onClick={close} disabled={busy}>إغلاق</button></div>
    <p>{doc.file.name} · رفعه {doc.uploaderName} · <button disabled={busy} onClick={() => download(doc)}>تنزيل الملف الأصلي</button></p>
    <p className="notice">طابق الحقول مع الملف الأصلي. الإدخال يدوي ولا توجد قراءة آلية للمستند.</p><fieldset className="plain-fieldset" disabled={busy}>
    <div className="form-grid"><Field label="تاريخ المستند" type="date" value={fields.date || ''} onChange={e => patch({ date: e.target.value })} />
      {doc.kind !== 'purchase' && <Select label="العميل" value={fields.customerId} onChange={customerId => patch({ customerId, ...(doc.kind === 'payment' ? { allocations: [] } : {}) })} items={data.customers.filter(c => !c.archived)} />}
      {doc.kind !== 'payment' && <Field label={doc.kind === 'sale' ? 'رقم الفاتورة' : 'رقم المستند (اختياري)'} value={fields.number || ''} onChange={e => patch({ number: e.target.value })} />}
      {doc.kind === 'purchase' && <Field label="الجهة / المستفيد" value={fields.payee || ''} onChange={e => patch({ payee: e.target.value })} />}
      {doc.kind !== 'sale' && <Select label={doc.kind === 'payment' ? 'الحساب المستلم' : 'حساب الدفع'} value={fields.accountId} onChange={accountId => patch({ accountId })} items={data.accounts.filter(a => !a.archived)} />}
    </div>
    {doc.kind === 'payment' ? <><Money label="مبلغ السداد (ريال)" value={fields.amount} onChange={amount => patch({ amount })} />
      <Field label="مرجع السداد" value={fields.reference || ''} onChange={e => patch({ reference: e.target.value })} />
      <h3>توزيع السداد</h3><p>غير الموزّع يبقى رصيدًا دائنًا للعميل. التحصيل لا يُحسب مبيعات جديدة.</p>
      {(data.openItems?.[fields.customerId] || []).map(item => <Money key={item.target} label={`${item.label} — المتبقي ${fmtSar(item.remaining)}`} value={fields.allocations?.find(a => a.target === item.target)?.amount || 0}
        onChange={amount => patch({ allocations: [...(fields.allocations || []).filter(a => a.target !== item.target), { target: item.target, amount }] })} />)}
    </> : <><h3>البنود</h3>{(fields.lines || []).map((l, i) => <div className="line-editor" key={i}><div className="form-grid">
      <Field label={`وصف البند ${i + 1}`} value={l.desc || ''} onChange={e => line(i, { desc: e.target.value })} />
      {doc.kind === 'sale' ? <><Field label="الكمية" inputMode="decimal" value={l.qty ?? ''} onChange={e => line(i, { qty: quantityFieldValue(e.target.value) })} /><Money label="سعر الوحدة (ريال)" value={l.price} onChange={price => line(i, { price })} /></>
        : <><Select label="التصنيف" value={l.categoryId} onChange={categoryId => line(i, { categoryId })} items={data.categories.filter(c => !c.archived)} /><Money label="المبلغ قبل ضريبة المورد (ريال)" value={l.net} onChange={net => line(i, { net })} /><Money label="ضريبة المورد (ريال)" value={l.vat} onChange={vat => line(i, { vat })} /></>}
    </div><button onClick={() => patch({ lines: fields.lines.filter((_, n) => n !== i) })}>حذف البند</button></div>)}
      <button onClick={() => patch({ lines: [...(fields.lines || []), doc.kind === 'sale' ? { desc: '', qty: 1, price: 0 } : { desc: '', categoryId: '', net: 0, vat: 0 }] })}>+ بند</button>
      <p>الصافي: {fmtSar(totals.net)} · الضريبة: {fmtSar(totals.vat)} · الإجمالي: <strong>{fmtSar(totals.total)}</strong></p></>}
    <div className="actions"><button className="primary" disabled={!dirty} onClick={() => run({ type: 'DOC_UPDATE_FIELDS', id: doc.id, fields })}>حفظ بيانات المراجعة</button>
      <button disabled={dirty} onClick={() => { if (window.confirm('اعتماد المستند وتسجيل أثره المالي؟ لا يمكن تعديله بعد الاعتماد.')) run({ type: 'DOC_APPROVE', id: doc.id }); }}>اعتماد المستند</button>
      <button onClick={() => { if (window.confirm('رفض المستند دون أثر مالي؟')) run({ type: 'DOC_REJECT', id: doc.id }); }}>رفض</button></div>
    {dirty && <p>احفظ البيانات أولًا، ثم افتح المستند مجددًا لاعتماد النسخة المحفوظة.</p>}</fieldset></section>;
}
function Customers({ data, mutate, busy }) {
  const empty = { name: '', whatsapp: '' }, [draft, setDraft] = useState(empty);
  return <><form className="card" onSubmit={async e => { e.preventDefault(); if (await mutate({ type: draft.id ? 'CUSTOMER_UPDATE' : 'CUSTOMER_ADD', ...draft })) setDraft(empty); }}>
    <h2>{draft.id ? 'تعديل العميل' : 'إضافة عميل / نقطة بيع'}</h2><fieldset disabled={busy} className="plain-fieldset"><div className="form-grid">
    <Field label="اسم العميل" required maxLength={200} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /><Field label="رقم واتساب (اختياري)" type="tel" value={draft.whatsapp} onChange={e => setDraft({ ...draft, whatsapp: e.target.value })} />
    </div><div className="actions"><button className="primary">حفظ العميل</button>{draft.id && <button type="button" onClick={() => setDraft(empty)}>إلغاء التعديل</button>}</div></fieldset></form>
    {data.customers.map(c => <article className="card title-row" key={c.id}><div><strong>{c.name}</strong><p>{c.whatsapp || 'لا يوجد رقم واتساب'} {c.archived ? '· مؤرشف' : ''}</p></div><div className="actions">
      <button disabled={busy} onClick={() => setDraft({ id: c.id, name: c.name, whatsapp: c.whatsapp })}>تعديل</button><button disabled={busy} onClick={() => mutate({ type: 'CUSTOMER_ARCHIVE', id: c.id, archived: !c.archived })}>{c.archived ? 'إعادة تفعيل' : 'أرشفة'}</button></div></article>)}</>;
}
function Reports({ data }) {
  const [customerId, setCustomer] = useState(''); const d = data.dashboard, s = data.statements?.[customerId]; if (!d) return null;
  const metrics = [['صافي المبيعات', d.salesNet], ['التحصيل', d.collected], ['المستحق على العملاء', d.due], ['أرصدة العملاء الدائنة', d.credit], ['التكاليف المباشرة', d.direct], ['المصروفات التشغيلية', d.operating], ['الربح التقديري', d.estimatedProfit]];
  return <><h2>التقارير — جميع الفترات</h2><p>الأرقام من المستندات المعتمدة فقط. التحصيل منفصل عن المبيعات.</p><div className="metrics">{metrics.map(([label, value]) => <article className="card" key={label}><p>{label}</p><strong>{fmtSar(value)}</strong></article>)}</div>
    <section className="card"><h3>حركة الحسابات منذ بدء التسجيل</h3>{d.accounts.map(a => <p key={a.id}>{a.name}: {fmtSar(a.balance)} · وارد {fmtSar(a.inflow)} · صادر {fmtSar(a.outflow)}</p>)}</section>
    <section className="card"><h3>أرصدة العملاء</h3><div className="table-scroll"><table><thead><tr><th>العميل</th><th>المستحق</th><th>رصيد دائن</th></tr></thead><tbody>{data.customerBalances.map(c => <tr key={c.id}><td>{c.name}</td><td>{fmtSar(c.due)}</td><td>{fmtSar(c.credit)}</td></tr>)}</tbody></table></div></section>
    <section className="card"><h3>كشف حساب</h3><Select label="العميل" value={customerId} onChange={setCustomer} items={data.customers} required={false} />{s && <><div className="table-scroll"><table><thead><tr><th>التاريخ</th><th>البيان</th><th>المرجع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead><tbody>{s.rows.map(r => <tr key={r.key}><td>{r.date}</td><td>{r.label}</td><td>{r.ref}</td><td>{fmtSar(r.debit)}</td><td>{fmtSar(r.credit)}</td><td>{fmtSar(r.balance)}</td></tr>)}</tbody></table></div><p>الرصيد الختامي: {fmtSar(s.closing)}</p></>}</section></>;
}
function Settings({ data, mutate, busy }) {
  const [tax, setTax] = useState({ ...taxSettingForDate(data, today()), id: undefined, effectiveFrom: today() }), [account, setAccount] = useState({ name: '', kind: 'bank' });
  return <><form className="card" onSubmit={e => { e.preventDefault(); mutate({ type: 'TAX_SETTING_SAVE', ...tax }); }}><h2>إعدادات الضريبة — المالك فقط</h2><p>تُطبّق بحسب تاريخ المستند. المستندات المعتمدة تحتفظ بإعدادها وقت الاعتماد.</p>
    <fieldset disabled={busy} className="plain-fieldset"><Select label="طريقة الضريبة" value={tax.mode} onChange={mode => setTax({ ...tax, mode })} items={Object.entries(TAX_MODE).map(([id, v]) => ({ id, name: v.label }))} /><div className="form-grid">
    <Field label="تاريخ بدء التطبيق" type="date" required value={tax.effectiveFrom} onChange={e => setTax({ ...tax, effectiveFrom: e.target.value })} /><Field label="نسبة الضريبة (%)" inputMode="decimal" defaultValue={tax.rateBps / 100} onChange={e => setTax({ ...tax, rateBps: ratePercentToBps(e.target.value) })} /><Field label="الرقم الضريبي" value={tax.vatNumber || ''} onChange={e => setTax({ ...tax, vatNumber: e.target.value })} /></div><button className="primary">حفظ الإعداد المؤرّخ</button></fieldset>
    <h3>سجل الإعدادات</h3>{data.taxSettings.map(t => <p key={t.id}>{t.effectiveFrom} · {TAX_MODE[t.mode]?.label} {t.mode !== 'disabled' ? `· ${t.rateBps / 100}%` : ''}</p>)}</form>
    <form className="card" onSubmit={async e => { e.preventDefault(); if (await mutate({ type: 'ACCOUNT_SAVE', ...account })) setAccount({ name: '', kind: 'bank' }); }}><h2>حسابات التحصيل والدفع</h2>
    {data.accounts.map(a => <div className="title-row" key={a.id}><p>{a.name} {a.archived ? '· مؤرشف' : ''}</p><button type="button" disabled={busy} onClick={() => mutate({ type: 'ACCOUNT_ARCHIVE', id: a.id, archived: !a.archived })}>{a.archived ? 'تفعيل' : 'أرشفة'}</button></div>)}
    <fieldset disabled={busy} className="plain-fieldset"><div className="form-grid"><Field label="اسم الحساب الجديد" required value={account.name} onChange={e => setAccount({ ...account, name: e.target.value })} /><Select label="النوع" value={account.kind} onChange={kind => setAccount({ ...account, kind })} items={[{ id: 'cash', name: 'نقدي' }, { id: 'bank', name: 'بنكي' }]} /></div><button className="primary">إضافة حساب</button></fieldset></form></>;
}
export default function Workspace({ actor, api, employees, onExpired }) {
  const [snapshot, setSnapshot] = useState(null), [tab, setTab] = useState('documents'), [selected, setSelected] = useState(null), [filter, setFilter] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const busyRef = useRef(false), pending = useRef(null), generation = useRef(0);
  const expired = e => ['INVALID_SESSION', 'AUTH_REQUIRED', 'OWNER_ONLY', 'TENANT_UNAVAILABLE'].includes(e.code);
  async function load() { const n = ++generation.current; try { const r = await api('read'); if (n === generation.current) setSnapshot(r); } catch (e) { if (expired(e)) { setSnapshot(null); onExpired(); } throw e; } }
  useEffect(() => { load().catch(e => setError(e.message)); return () => { generation.current++; }; }, []);
  useEffect(() => { if (selected) return; const refresh = () => { if (!busyRef.current) load().catch(e => setError(e.message)); }; const timer = setInterval(refresh, 30000); window.addEventListener('focus', refresh); return () => { clearInterval(timer); window.removeEventListener('focus', refresh); }; }, [selected]);
  async function mutate(command, file = null, expectedRevision) {
    if (busyRef.current || !snapshot) return false;
    busyRef.current = true; setBusy(true); setError(''); setMessage(''); const signature = JSON.stringify(command);
    if (!pending.current || pending.current.signature !== signature || pending.current.file !== file) pending.current = { signature, file, requestId: crypto.randomUUID(), revision: expectedRevision ?? snapshot.revision };
    try { await api('mutate', { command, requestId: pending.current.requestId, revision: pending.current.revision }, file); pending.current = null; setMessage(command.type === 'DOC_ADD' ? 'تم رفع المستند للمراجعة' : 'تم الحفظ');
      try { await load(); } catch { setError('تم الحفظ، لكن تعذر تحديث العرض. استخدم زر تحديث.'); } return true;
    } catch (e) { setError(e.message); if (e.code === 'CONFLICT') await load().catch(() => {}); if (expired(e)) { setSnapshot(null); onExpired(); } if (e.code && e.code !== 'FINANCE_UNAVAILABLE') pending.current = null; return false; }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function download(doc) { setError(''); try { const blob = await api('file', { documentId: doc.id }); const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = doc.file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); } catch (e) { setError(e.message); } }
  const tabs = [['documents', 'المستندات'], ...(can(actor, 'manage_customers') ? [['customers', 'العملاء']] : []), ...(can(actor, 'view_reports') ? [['reports', 'التقارير']] : []), ...(actor.role === 'owner' ? [['employees', 'الموظفون'], ['settings', 'الإعدادات']] : [])];
  if (!snapshot) return <main className="card"><p role={error ? 'alert' : undefined}>{error || 'جارٍ تحميل مساحة العمل…'}</p>{error && <button onClick={() => load().then(() => setError('')).catch(e => setError(e.message))}>إعادة المحاولة</button>}</main>;
  const data = snapshot.data;
  return <main><nav className="tabs workspace-tabs" aria-label="أقسام مساحة العمل">{tabs.map(([id, label]) => <button key={id} aria-pressed={tab === id} disabled={busy} onClick={() => { setTab(id); setSelected(null); setError(''); setMessage(''); }}>{label}</button>)}</nav>
    <div className="title-row"><span className="badge">مساحة عمل مشتركة</span><button disabled={busy || !!selected} onClick={() => load().then(() => setError('')).catch(e => setError(e.message))}>تحديث</button></div>
    {error && <p className="error" role="alert">{error}</p>}{message && <p className="success" role="status">{message}</p>}
    {tab === 'documents' && <>{selected ? <Review key={selected.id} document={selected} data={data} mutate={mutate} download={download} busy={busy} close={() => { setSelected(null); load().catch(e => setError(e.message)); }} /> : <>
      <Upload actor={actor} data={data} mutate={mutate} busy={busy} /><div className="title-row"><h2>{can(actor, 'review') ? 'المستندات والمراجعة' : 'المستندات المتاحة لك'}</h2><select aria-label="تصفية حالة المستند" value={filter} onChange={e => setFilter(e.target.value)}><option value="">كل الحالات</option>{Object.entries(STATUS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
      {!data.documents.length && <div className="card empty">لا توجد مستندات بعد. ابدأ برفع أول مستند.</div>}
      {data.documents.filter(d => !filter || d.status === filter).map(d => <article className="card" key={d.id}><div className="title-row"><strong>{KINDS[d.kind]} {d.fields.number ? `· ${d.fields.number}` : ''}</strong><span className={`badge ${d.status === 'approved' ? '' : 'off'}`}>{STATUS[d.status]}</span></div><p>{d.file.name} · {d.uploaderName} · {d.uploadedAt.slice(0, 10)}</p><p>{data.customers.find(c => c.id === d.fields.customerId)?.name || d.fields.payee || ''}</p>{d.reviewerName && <p>راجعه {d.reviewerName}</p>}
      <div className="actions"><button onClick={() => download(d)}>تنزيل الملف</button>{can(actor, 'review') && d.status === 'pending' && <button className="primary" disabled={busy} onClick={() => setSelected({ ...d, revision: snapshot.revision })}>مراجعة</button>}</div></article>)}</>}</>}
    {tab === 'customers' && <Customers data={data} mutate={mutate} busy={busy} />}{tab === 'reports' && <Reports data={data} />}{tab === 'employees' && employees}{tab === 'settings' && <Settings data={data} mutate={mutate} busy={busy} />}
  </main>;
}
