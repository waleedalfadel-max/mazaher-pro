import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CompactCard } from './AccountCards.jsx'
import { Dialog, Money, Note } from '../ui/components.jsx'
import { accountHref, liquidityBreakdown } from '../lib/accountStatement.js'
import { recordedLiabilities } from '../lib/recordedLiabilities.js'
import { useAuth } from '../contexts/AuthContext'

export default function MazaherHomeCards({ stats, balances, from, to, comparison, comparisonLabel }) {
  const [showLiabilities, setShowLiabilities] = useState(false)
  const { role } = useAuth()
  const liquidity = liquidityBreakdown(balances, balances.banks, balances.settings)
  const debts = recordedLiabilities(balances.supplierBalance, balances.liabilities, balances.loans)
  const report = tab => '/reports?' + new URLSearchParams({ tab, from, to, period: 'custom' })
  const compare = (key, fallback) => comparison
    ? <>مقابل <Money value={comparison[key]} /> · {comparisonLabel}</> : fallback
  const accountLabels = ['البنك', 'الصندوق', 'العهدة']
  return <>
    <div className="account-overview account-overview-compact" data-k="mazaher-overview">
      <div className="account-card-row">
        <CompactCard id="overview-sales" label="المبيعات" value={stats.totalSales} hint={compare('totalSales', 'قبل الضريبة · خلال الفترة')} to={report('sales')} />
        <CompactCard id="overview-expenses" label="المصروفات" value={stats.totalExpenses} hint={compare('totalExpenses', 'المشتريات والتشغيل · قبل الضريبة')} to={report('purchases')} />
        <CompactCard id="overview-profit" label="صافي الربح" value={stats.profit} hint={compare('profit', 'المبيعات − المصروفات · بلا تسوية مخزون')} to={'/analysis?' + new URLSearchParams({ period: 'custom', from, to })} />
      </div>
      <div className="account-card-row">{liquidity.cards.map((card, index) =>
        <CompactCard key={card.account} id={`overview-${card.account}`} label={accountLabels[index]} value={card.value} hint={`حتى ${to}`} to={accountHref(card.account, to)} />
      )}</div>
      <div className="account-card-row">
        <CompactCard id="overview-gross-sales" label="المبيعات شاملة الضريبة" value={stats.grossSales} hint="خلال الفترة · تشمل المبيعات الآجلة" to={report('sales')} />
        <CompactCard id="overview-liquidity" label="صافي الكاش الفعلي" value={liquidity.total} hint="البنك + الصندوق + العهدة بإشاراتها" to={accountHref('liquidity', to)} />
        <button type="button" className="account-card" data-k="overview-total-liabilities" onClick={() => setShowLiabilities(true)} aria-haspopup="dialog">
          <span className="account-card-label">إجمالي الالتزامات</span>
          <strong className={`account-card-value${debts.total >= 100000 ? ' account-card-value-long' : ''}`}>{debts.total == null ? 'غير محدد' : <Money value={debts.total} />}</strong>
          <small>الأرصدة المسجلة فقط · حتى {to}</small><span className="account-card-more">عرض التفاصيل ←</span>
        </button>
      </div>
    </div>
    <p className="ts-field-hint">الأرصدة من القيود المسجلة حتى {to}. صافي الكاش يجمع البنك والصندوق والعهدة بإشاراتها؛ الحسابات المقيّدة والموقوفة خارج المبلغ.</p>
    {liquidity.excluded.map(item => <p className="ts-field-hint" key={item.account} data-k="liquidity-excluded">خارج الكاش المتاح: <Link to={accountHref(item.account, to)}>{item.label}</Link> — <Money value={item.value} /> ({item.reason}).</p>)}
    <Dialog open={showLiabilities} onClose={() => setShowLiabilities(false)} title="إجمالي الالتزامات المسجلة" description={`الأرصدة المستحقة حتى ${to}`}>
      <p>مستحقات الموردين: <Money value={balances.supplierBalance} /></p>
      {debts.otherTracked && <p>التزامات أخرى موثقة: {balances.liabilities.remaining == null ? 'غير محدد' : <Money value={balances.liabilities.remaining} />}</p>}
      {balances.loans?.loans.filter(l => l.tracked).map(loan => <p key={loan.key}>{loan.label}: {loan.remaining == null ? 'غير محدد لهذا التاريخ' : <Money value={loan.remaining} />}</p>)}
      <p>الإجمالي: {debts.total == null ? 'غير محدد؛ لم تكتمل الأرصدة لهذا التاريخ' : <Money value={debts.total} />}</p>
      <Note>يشمل مستحقات الموردين وأرصدة القروض والالتزامات الأخرى المسجلة فقط. لا يشمل الضرائب أو أي التزامات لم تُسجّل أرصدتها. الأقساط السابقة داخلة في رصيد القرض المثبت ولا تُخصم مرة ثانية، وذمم التطبيقات مبالغ لنا وليست التزامات علينا.</Note>
      <Link className="ts-btn" to="/suppliers">تفاصيل الموردين</Link>
      {balances.loans?.tracked && ['accountant', 'superadmin'].includes(role) && <Link className="ts-btn" to="/loans">تفاصيل القروض</Link>}
      {debts.otherTracked && <Link className="ts-btn" to={'/accounts?' + new URLSearchParams({ section: 'liabilities', to })}>تفاصيل الالتزامات الأخرى</Link>}
    </Dialog>
  </>
}
