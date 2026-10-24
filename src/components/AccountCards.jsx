import { Link } from 'react-router-dom'
import { Money } from '../ui/components.jsx'
import { accountHref, balanceCards } from '../lib/accountStatement.js'

export function CompactCard({ label, value, hint, to, id }) {
  return <Link className={`account-card${value < 0 ? ' account-card-negative' : ''}`} to={to} data-k={id}>
    <span className="account-card-label">{label}</span>
    <strong className={`account-card-value${value != null && Math.abs(value) >= 100000 ? ' account-card-value-long' : ''}`}>{value == null ? 'غير محدد' : <Money value={value} />}</strong>
    <small>{hint}</small><span className="account-card-more">عرض التفاصيل ←</span>
  </Link>
}

export default function AccountCards({ stats, balances, settings, receivables, supplierBalance, liabilities, from, to }) {
  const report = tab => '/reports?' + new URLSearchParams({ tab, from, to, period: 'custom' })
  const appBalance = receivables ? Object.values(receivables.balances).reduce((s, v) => s + Math.round(v * 100), Math.round(receivables.unassigned * 100)) / 100 : 0
  return <div className="account-overview" data-k="account-overview">
    <div className="account-card-row">
      <CompactCard id="overview-sales" label="المبيعات" value={stats.totalSales} hint="قبل الضريبة · خلال الفترة" to={report('sales')} />
      <CompactCard id="overview-expenses" label="المصروفات" value={stats.totalExpenses} hint="المشتريات والتشغيل · قبل الضريبة" to={report('purchases')} />
      <CompactCard id="overview-profit" label="صافي الربح" value={stats.profit} hint="المبيعات − المصروفات · بلا تسوية مخزون" to={'/analysis?'+new URLSearchParams({period:'custom',from,to})} />
    </div>
    <div className="account-card-row">{balanceCards(balances, settings).map(c => <CompactCard key={c.account} id={`overview-${c.account}`} {...c} hint={`${c.hint} · حتى ${to}`} to={accountHref(c.account, to)} />)}</div>
    <div className="account-card-row">
      <CompactCard id="overview-apps" label="ذمم التطبيقات" value={appBalance} hint="لنا على التطبيقات · صافي دفتري" to={report('apps')} />
      <CompactCard id="overview-suppliers" label="ذمم الموردين" value={supplierBalance} hint="علينا للموردين" to="/suppliers" />
      <CompactCard id="overview-liabilities" label="التزامات أخرى" value={liabilities.remaining} hint={liabilities.confirmed ? 'بعد الخصم الآلي المؤكد بالإعداد' : liabilities.baseline ? `حسب الكشف في ${liabilities.baseline.date}` : 'يلزم إجمالي موثّق وتاريخه'} to={'/accounts?'+new URLSearchParams({section:'liabilities',to})} />
    </div>
    {balances.custody !== 0 && <p className="ts-note">توجد عهدة موظفين سابقة بمبلغ <Money value={balances.custody} />، منفصلة عن حساب العهدة البنكي. <Link to={accountHref('custody', to)}>عرض حركاتها</Link></p>}
  </div>
}
