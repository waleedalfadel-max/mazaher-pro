import { toHalalas, fromHalalas } from './approvalV2.js'
import { salesReviewRows, CHANNEL_FIELD } from './salesReport.js'

// Keep terminal digits. Channel classification deliberately discards them.
export const paymentAccountKey = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
  .replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي')
  .replace(/[^a-z0-9ء-ي]/g, '')

export function suggestSalesPaymentAccounts(inv, settings) {
  if (inv?.type !== 'sales') return inv
  const rules = settings?.pos_payment_accounts
  if (!Array.isArray(rules) || !rules.length) return inv
  const routes = []
  for (const rule of rules) {
    const aliases = new Set((rule.aliases || [rule.label]).map(paymentAccountKey))
    const rows = salesReviewRows(inv).filter(row => row.channel === rule.channel && aliases.has(paymentAccountKey(row.label)))
    if (!rows.length) continue
    const amount = rows.reduce((sum, row) => sum + (row.kind === 'return' ? -1 : 1) * toHalalas(row.amount), 0)
    const previous = (Array.isArray(inv.salesBankRoutes) ? inv.salesBankRoutes : []).find(row => row.channel === rule.channel
      && paymentAccountKey(row.label) === paymentAccountKey(rule.label))
    routes.push({ label: rule.label, channel: rule.channel, amount: fromHalalas(amount),
      accountId: previous ? previous.accountId : rule.account_id })
  }
  if (!routes.length && !Array.isArray(inv.salesBankRoutes)) return inv
  if (JSON.stringify(routes) === JSON.stringify(inv.salesBankRoutes)) return inv
  return { ...inv, salesBankRoutes: routes }
}

export function salesRouteRemainder(inv, channel) {
  return (toHalalas(inv?.[CHANNEL_FIELD[channel]] || 0) || 0)
    - (inv.salesBankRoutes || []).filter(row => row.channel === channel)
      .reduce((sum, row) => sum + toHalalas(row.amount), 0)
}

export function salesPaymentAccountsError(inv) {
  if (!inv?.salesBankRoutes) return null
  if (!Array.isArray(inv.salesBankRoutes)) return 'راجع توزيع وسائل الدفع على الحسابات.'
  for (const row of inv.salesBankRoutes) {
    const amount = toHalalas(row.amount)
    if (!['network', 'transfer'].includes(row.channel) || !row.label || !row.accountId
        || !Number.isSafeInteger(amount) || amount < 0) return 'أكمل حساب كل وسيلة دفع وراجع مبلغها ومرتجعاتها.'
  }
  if (['network', 'transfer'].some(channel => salesRouteRemainder(inv, channel) < 0)) {
    return 'مبالغ وسائل الدفع الموزعة أكبر من صافي القناة. راجع أسطر الإغلاق.'
  }
  return null
}
