import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { fetchEveryRow } from '../lib/fetchAll.js'
import { accountDashboard, accountOptions, buildAccountStatement, liabilityFigures } from '../lib/accountStatement.js'
import { Button, Field, Input, Money, Note, Panel, Select } from '../ui/components.jsx'
import { formatDate } from '../ui/format.js'
import { exportFileName, modelToXlsx } from '../lib/reportExport.js'
import { downloadBlob } from '../lib/reportPdf.js'
import { getSignedUrl } from '../lib/storage.js'

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
export default function Accounts() {
  const { projectId } = useAuth()
  return <AccountPage key={projectId} />
}
function AccountPage() {
  const { projectId, projectName, sessionEpoch } = useAuth()
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [exporting, setExporting] = useState(false)
  const [search, setSearch] = useState(''), [page, setPage] = useState(1)
  const seq = useRef(0)
  const from = params.get('from') || '', to = params.get('to') || today(), key = params.get('account') || (params.get('section')==='liabilities' && data?.settings?.account_dashboard?.liability_account_id ? 'bank:'+data.settings.account_dashboard.liability_account_id : 'bank')
  const iso = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v
  const valid = iso(to) && (!from || iso(from) && from <= to)
  const set = (k,v) => { const next = new URLSearchParams(params); if (v) next.set(k,v); else next.delete(k); setParams(next); setPage(1) }
  async function load() {
    const n = ++seq.current; setLoading(true); setError(''); setData(null)
    try {
      const [entries, banks, settings] = await Promise.all([
        fetchEveryRow(() => supabase.from('ledger_entries').select('*').eq('project_id',projectId).in('status',['approved','auto']).order('id')),
        fetchEveryRow(() => supabase.from('bank_accounts').select('id,name,bank,is_active,sort_order').eq('project_id',projectId).order('sort_order').order('id')),
        supabase.from('project_settings').select('settings').eq('project_id',projectId).single(),
      ])
      if (entries.error || banks.error || settings.error) throw new Error('load')
      if (n === seq.current) setData({ entries: entries.data, banks: banks.data, settings: settings.data.settings })
    } catch { if (n === seq.current) setError('تعذّر تحميل الكشف كاملًا؛ أعد المحاولة. لا تُعرض أرصدة جزئية.') }
    finally { if (n === seq.current) setLoading(false) }
  }
  useEffect(() => { if (projectId) load(); return () => { seq.current++ } }, [projectId, sessionEpoch])
  const options = accountOptions(data?.banks, data?.settings)
  const selected = options.find(o => o.value === key)
  const statement = useMemo(() => data && valid && selected ? buildAccountStatement(data.entries,key,{from,to,settings:data.settings,search}) : null,[data,key,from,to,valid,!!selected,search])
  useEffect(() => {setPage(1)},[key,from,to])
  const liabilities = data ? liabilityFigures(data.entries,data.settings,to) : null
  async function exportAs(kind) {
    if (!statement || exporting) return
    setExporting(true); setError('')
    try {
      const generated = new Date()
      const model = { tab:'account', title: `كشف ${selected.label}`, org:projectName, from:from || statement.rows[0]?.date || to, to, branch:'all', branchText:'المنشأة كاملة', rangeText:`${from || 'من بداية التسجيل'} — ${to}`, generatedAt:generated.toISOString(), generatedText:generated.toLocaleString('ar-SA'),
        intro:'الحركات المعتمدة والتلقائية فقط. الرصيد دفتري وليس اتصالًا مباشرًا بالبنك.', scope:[], blocks:[
          {kind:'calc',id:'account.summary',title:'ملخص الحساب',rows:[{label:'رصيد بداية الفترة من القيود السابقة',value:statement.opening},{label:'داخل',value:statement.incoming},{label:'خارج',value:statement.outgoing},{label:'رصيد نهاية الفترة',value:statement.closing}]},
          ...(search ? [{kind:'note',id:'account.search',text:`الصفوف المعروضة بعد البحث: ${search}. الأرصدة والملخص يشملان كامل الفترة.`}] : []),
          {kind:'table',id:'account.movements',title:selected.label,columns:[{label:'التاريخ',type:'date'},{label:'القيد'},{label:'البيان'},{label:'داخل',type:'money'},{label:'خارج',type:'money'},{label:'الرصيد',type:'money'},{label:'المنفذ'}],rows:statement.rows.map(r=>[r.date,r.journal_number,r.description||r.type,r.incoming,r.outgoing,r.balance,r.created_by_name||'غير مسجل'])},
        ] }
      const blob = kind === 'xlsx' ? new Blob([modelToXlsx(model)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}) : await (await import('../lib/reportPdf.js')).modelToPdf(model)
      downloadBlob(blob,exportFileName(model,kind))
    } catch { setError('تعذّر إنشاء الملف؛ أعد المحاولة.') } finally { setExporting(false) }
  }
  async function openReceipt(url) {
    try { const signed = await getSignedUrl(url); if (!signed) throw new Error(); window.open(signed,'_blank','noopener,noreferrer') }
    catch { setError('تعذّر فتح المستند؛ أعد المحاولة.') }
  }
  return <div className="rpt-page" data-k="accounts-page"><Panel title="كشف الحسابات" subtitle="كل حساب وحركاته ورصيده، للمنشأة كاملة؛ يشمل المعتمد والتلقائي فقط." action={<Button onClick={load} disabled={loading}>تحديث</Button>}>
    <div className="ts-panel-body"><div className="ts-form-grid">
      <Field label="الحساب"><Select value={key} options={options} onChange={e=>set('account',e.target.value)} data-k="account-select" /></Field>
      <Field label="من تاريخ (اختياري)"><Input type="date" value={from} onChange={e=>set('from',e.target.value)} /></Field>
      <Field label="حتى تاريخ"><Input type="date" value={to} onChange={e=>set('to',e.target.value)} /></Field>
      <Field label="بحث بالبيان أو القيد أو المنفذ"><Input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} /></Field>
    </div>{!valid && <Note tone="error">اختر فترة صحيحة.</Note>}{!selected && data && <Note tone="error">الحساب غير موجود في هذه المنشأة؛ اختر حسابًا من القائمة.</Note>}
    {error && <Note tone="error">{error}</Note>}{loading && <p>جارٍ تحميل الكشف…</p>}
    {statement && <><div className="account-card-row"><div>رصيد بداية الفترة<Money value={statement.opening}/></div><div>إجمالي الداخل<Money value={statement.incoming}/></div><div>إجمالي الخارج<Money value={statement.outgoing}/></div></div>
      <p data-k="account-closing"><strong>رصيد نهاية الفترة: <Money value={statement.closing}/></strong></p>
      <Note>رصيد البداية من القيود السابقة المسجلة فقط. لا يفترض وجود رصيد افتتاحي بنكي غير مسجل. التحويل الداخلي يظهر خروجًا من المصدر ودخولًا للوجهة.</Note>
      <Button disabled={exporting} onClick={()=>exportAs('xlsx')}>Excel</Button> <Button disabled={exporting} onClick={()=>exportAs('pdf')}>PDF</Button>
      {search && <p>البحث يرشّح الصفوف فقط؛ الرصيد والملخص يشملان كل حركات الفترة.</p>}
      <div className="rpt-table-wrap"><table className="rpt-table" data-k="account-movements"><thead><tr><th>التاريخ</th><th>القيد</th><th>البيان</th><th>داخل</th><th>خارج</th><th>الرصيد</th><th>المنفذ</th><th>المستند</th></tr></thead>
        <tbody>{statement.rows.slice((page-1)*50,page*50).map(r=><tr key={r.id}><td>{formatDate(r.date,{year:true})}</td><td>{r.journal_number||'—'}</td><td>{r.description||r.type}</td><td><Money value={r.incoming}/></td><td><Money value={r.outgoing}/></td><td><Money value={r.balance}/></td><td>{r.created_by_name||'غير مسجل'}</td><td>{r.file_url && <Button size="sm" onClick={()=>openReceipt(r.file_url)}>عرض</Button>}</td></tr>)}</tbody></table></div>
      {!statement.rows.length && <p>لا حركات في الاختيار الحالي.</p>}
      <Button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>السابق</Button> <span>{page} / {Math.max(1,Math.ceil(statement.rows.length/50))}</span> <Button disabled={page*50>=statement.rows.length} onClick={()=>setPage(p=>p+1)}>التالي</Button>
    </>}
    </div></Panel>
    {data && accountDashboard(data.settings) && <Panel title="الالتزامات الأخرى وحساب السداد"><div className="ts-panel-body">
      <p>الرصيد حسب الكشف الموثّق: {liabilities.baseline ? <><Money value={liabilities.baseline.balance}/> في {liabilities.baseline.date} — المصدر: {liabilities.baseline.reference}</> : 'غير محدد؛ أدخل الإجمالي وتاريخه ومصدره من إعدادات إدارة تحسيب.'}</p>
      <p>الإيداعات الموجّهة لحساب السداد {liabilities.baseline ? 'بعد تاريخ الكشف' : 'من بداية التسجيل'}: <Money value={liabilities.directed}/></p>
      <p>المتبقي: {liabilities.remaining == null ? 'غير محدد' : <Money value={liabilities.remaining}/>}</p>
      <Note>{liabilities.confirmed ? 'الحساب وفق إقرار إدارة تحسيب بأن كل إيداع يُخصم آليًا من الالتزام. المتبقي = رصيد الكشف بعد نهاية يومه − الإيداعات المعتمدة بعده. راجع كشف الجهة لأي رسوم أو التزامات جديدة. لا يُنشئ هذا العرض قيود سداد أو مصروفات.' : 'الإيداع وحده ليس إثبات سداد. لا يُخصم من الالتزام دون تأكيد آلية الخصم الآلي أو تحديث الرصيد من كشف جديد.'}</Note>
      {liabilities.excess > 0 && <p>إيداعات تتجاوز رصيد الالتزام: <Money value={liabilities.excess}/>؛ تحتاج مراجعة.</p>}
      {liabilities.accountId && <Link to={'/accounts?account=bank:'+liabilities.accountId}>عرض حركات حساب السداد</Link>}
    </div></Panel>}
  </div>
}
