import { Link } from 'react-router-dom'
import { Money } from '../ui/components.jsx'
import { accountHref, balanceCards, liquidityBreakdown } from '../lib/accountStatement.js'

export function CompactCard({ label, value, hint, to, id }) {
  return <Link className={`account-card${value < 0 ? ' account-card-negative' : ''}`} to={to} data-k={id}>
    <span className="account-card-label">{label}</span>
    <strong className={`account-card-value${value != null && Math.abs(value) >= 100000 ? ' account-card-value-long' : ''}`}>{value == null ? 'غير محدد' : <Money value={value} />}</strong>
    <small>{hint}</small><span className="account-card-more">عرض التفاصيل ←</span>
  </Link>
}

export default function AccountCards({ stats, balances, settings, receivables, supplierBalance, liabilities, from, to, compactHome = false }) {
  const report = tab => '/reports?' + new URLSearchParams({ tab, from, to, period: 'custom' })
  const appBalance = receivables ? Object.values(receivables.balances).reduce((s, v) => s + Math.round(v * 100), Math.round(receivables.unassigned * 100)) / 100 : 0
  const liquidity = compactHome ? liquidityBreakdown(balances, balances.banks, settings) : null
  return <div className={`account-overview${compactHome ? ' account-overview-compact' : ''}`} data-k="account-overview">
    <div className="account-card-row">
      <CompactCard id="overview-sales" label="المبيعات" value={stats.totalSales} hint="قبل الضريبة · خلال الفترة" to={report('sales')} />
      <CompactCard id="overview-expenses" label="المصروفات" value={stats.totalExpenses} hint="المشتريات والتشغيل · قبل الضريبة" to={report('purchases')} />
      <CompactCard id="overview-profit" label="صافي الربح" value={stats.profit} hint="المبيعات − المصروفات · بلا تسوية مخزون" to={'/analysis?'+new URLSearchParams({period:'custom',from,to})} />
    </div>
    <div className="account-card-row">{(liquidity?.cards || balanceCards(balances, settings)).map(c => <CompactCard key={c.account} id={`overview-${c.account}`} {...c} hint={`${c.hint} · حتى ${to}`} to={accountHref(c.account, to)} />)}</div>
    <div className="account-card-row">
      <CompactCard id="overview-apps" label="ذمم التطبيقات" value={appBalance} hint="لنا على التطبيقات · صافي دفتري" to={report('apps')} />
      <CompactCard id="overview-suppliers" label="ذمم الموردين" value={supplierBalance} hint="علينا للموردين" to="/suppliers" />
      <CompactCard id="overview-liabilities" label="التزامات أخرى" value={compactHome ? liabilities.signedRemaining : liabilities.remaining} hint={liabilities.confirmed ? 'السالب التزام متبقٍ؛ إيداعات حساب السداد تقلّله' : liabilities.baseline ? `حسب الرصيد المرجعي في ${liabilities.baseline.date}` : 'يلزم تحديد الرصيد وتاريخه ومصدره'} to={'/accounts?'+new URLSearchParams({section:'liabilities',to})} />
    </div>
    {compactHome && <div className="account-card-row account-card-row-two">
      <CompactCard id="overview-gross-sales" label="المبيعات شامل الضريبة" value={stats.grossSales} hint="خلال الفترة · تشمل المبيعات الآجلة" to={report('sales')} />
      <CompactCard id="overview-liquidity" label="الكاش الفعلي" value={liquidity.total} hint={`البنوك المتاحة + الصندوق + حساب العهدة · حتى ${to}`} to={accountHref('liquidity', to)} />
    </div>}
    {compactHome && <p className="ts-field-hint">الكاش الفعلي هو مجموع بطاقات البنوك المتاحة والصندوق وحساب العهدة بإشاراتها؛ الرصيد السالب يُخصم. الأرصدة حسب القيود المسجلة حتى {to}.</p>}
    {liquidity?.excluded.map(e => liabilities.baseline && e.account === `bank:${liabilities.accountId}`
      ? <p className="ts-field-hint" key={e.account} data-k="liquidity-excluded"><Link to={accountHref(e.account, to)}>{e.label}</Link> مخصص لسداد الالتزامات؛ المتبقي ظاهر في بطاقة «التزامات أخرى»، وخارج الكاش المتاح.</p>
      : <p className="ts-field-hint" key={e.account} data-k="liquidity-excluded">خارج الكاش المتاح: <Link to={accountHref(e.account, to)}>{e.label}</Link> — <Money value={e.value} /> ({e.reason}).</p>)}
    {balances.custody !== 0 && <p className="ts-note">توجد عهدة موظفين سابقة بمبلغ <Money value={balances.custody} />، منفصلة عن حساب العهدة البنكي. <Link to={accountHref('custody', to)}>عرض حركاتها</Link></p>}
  </div>
}
