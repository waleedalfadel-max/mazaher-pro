import { cashBankDirection } from './cashBankTransfer.js'

export const INTERNAL_TRANSFER_TYPE = '🔄 تحويل داخلي'
const label = value => String(value || '').replace(/^[^\p{L}\p{N}]+/u, '').trim()
export function isInternalTransferType(type) {
  const name = label(type)
  return !!cashBankDirection(type) || ['تحويل داخلي', 'تحويل داخلي — بين الحسابات البنكية', 'تحويل داخلي — صرف عهدة', 'صرف عهدة', 'إيداع نقدي'].includes(name)
}
export const isInternalTransfer = inv => inv?.type === 'transfer' && isInternalTransferType(inv.transType)
export function internalTransferTypes(types = []) {
  const result = [], seen = new Set()
  for (const type of [...types, INTERNAL_TRANSFER_TYPE]) {
    const value = isInternalTransferType(type) ? INTERNAL_TRANSFER_TYPE : type
    if (!seen.has(value)) { seen.add(value); result.push(value) }
  }
  return result
}
export function normalizeInternalTransfer(inv) {
  if (!isInternalTransfer(inv)) return inv
  let pair = inv.internalTransfer
  if (!pair) {
    const bank = inv.bankAccountId ? `bank:${inv.bankAccountId}` : ''
    const direction = cashBankDirection(inv.transType)
    if (inv.bankTransfer && label(inv.transType).includes('بين الحسابات البنكية')) pair = { from: inv.bankTransfer.from ? `bank:${inv.bankTransfer.from}` : '', to: inv.bankTransfer.to ? `bank:${inv.bankTransfer.to}` : '' }
    else if (direction === 'deposit' || label(inv.transType) === 'إيداع نقدي') pair = { from: 'cash', to: bank }
    else if (direction === 'withdrawal') pair = { from: bank, to: 'cash' }
    else if (label(inv.transType).includes('صرف عهدة')) pair = { from: inv.paySource === 'bank' ? bank : inv.paySource === 'cash' ? 'cash' : '', to: 'custody' }
    else pair = { from: '', to: '' }
  }
  return { ...inv, transType: INTERNAL_TRANSFER_TYPE, internalTransfer: { from: pair.from || '', to: pair.to || '' },
    paySource: pair.from?.startsWith('bank:') ? 'bank' : pair.from || '', bankAccountId: null, _paymentSuggested: false }
}
export function internalTransferAccounts(accounts = [], settings = {}) {
  const labels = new Map((settings?.statement_accounts || []).map(x => [x.value, x.label]))
  const list = [{ value: 'cash', label: labels.get('cash') || 'الصندوق' },
    ...accounts.filter(a => a.is_active !== false).map(a => ({ value: `bank:${a.id}`, label: labels.get(`bank:${a.id}`) || a.name || a.bank || 'حساب بنكي' })),
    ...(settings?.account_dashboard?.enabled ? [] : [{ value: 'custody', label: 'العهدة' }])]
  const order = new Map((settings?.statement_accounts || []).map((x, i) => [x.value, i]))
  return list.sort((a, b) => (order.get(a.value) ?? 999) - (order.get(b.value) ?? 999))
}
export function internalTransferError(inv, accounts, settings) {
  const pair = normalizeInternalTransfer(inv)?.internalTransfer || {}
  if (!pair.from || !pair.to || pair.from === pair.to) return 'اختر حسابين مختلفين في «تحويل من» و«تحويل إلى».'
  if (accounts && ![pair.from, pair.to].every(key => internalTransferAccounts(accounts, settings).some(a => a.value === key))) return 'أحد حسابَي التحويل غير متاح. اختر من القائمة.'
  return ''
}
