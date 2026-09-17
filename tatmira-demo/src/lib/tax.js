import { normalizeDigits } from './money.js'

/**
 * إعداد الضريبة على مستوى المنشأة.
 *
 * - disabled: المنشأة لا تفصل ضريبة القيمة المضافة؛ ضريبة المورد تدخل في التكلفة.
 * - inclusive: أسعار البيع المدخلة شاملة الضريبة.
 * - exclusive: أسعار البيع المدخلة قبل الضريبة.
 *
 * الإعدادات مؤرخة، وكل مستند معتمد يحتفظ بلقطة منها حتى لا يتغير الماضي.
 */
export const TAX_MODE = {
  disabled:  { label: 'لا أطبق ضريبة القيمة المضافة', short: 'بدون ضريبة' },
  inclusive: { label: 'الأسعار شاملة الضريبة',       short: 'شامل الضريبة' },
  exclusive: { label: 'الأسعار قبل الضريبة',         short: 'قبل الضريبة' },
}

export const DEFAULT_TAX_RATE_BPS = 1500 // 15.00%، بالنقاط الأساس لتفادي الكسور
export const INITIAL_EFFECTIVE_FROM = '1900-01-01'

export function defaultTaxSettings({ mode = 'disabled', rateBps = DEFAULT_TAX_RATE_BPS, vatNumber = '' } = {}) {
  return [{
    id: 'tax-initial', mode, rateBps, vatNumber: String(vatNumber || '').trim(),
    effectiveFrom: INITIAL_EFFECTIVE_FROM,
  }]
}

export function isTaxMode(mode) {
  return Object.hasOwn(TAX_MODE, mode)
}

export function taxEnabled(setting) {
  return !!setting && setting.mode !== 'disabled'
}

export function ratePercentToBps(value) {
  const normalized = normalizeDigits(value).replace(/[\s٪%]/g, '').replace(/٫/g, '.')
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return NaN
  const n = Number(normalized)
  if (!Number.isFinite(n) || n < 0 || n > 100) return NaN
  return Math.round(n * 100)
}

export function rateBpsToPercent(rateBps) {
  const n = Number(rateBps)
  if (!Number.isFinite(n)) return '15'
  const pct = n / 100
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

export function normalizeTaxSetting(setting = {}) {
  const mode = isTaxMode(setting.mode) ? setting.mode : 'disabled'
  const rateBps = Number.isInteger(setting.rateBps) && setting.rateBps >= 0 && setting.rateBps <= 10000
    ? setting.rateBps : DEFAULT_TAX_RATE_BPS
  return {
    id: setting.id || '', mode, rateBps,
    vatNumber: String(setting.vatNumber || '').trim(),
    effectiveFrom: setting.effectiveFrom || INITIAL_EFFECTIVE_FROM,
  }
}

/** الإعداد الساري حسب تاريخ المستند، لا حسب وقت الاعتماد. */
export function taxSettingForDate(state, date) {
  const settings = (state.taxSettings?.length ? state.taxSettings : defaultTaxSettings())
    .map(normalizeTaxSetting)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
  const target = date || '9999-12-31'
  return [...settings].reverse().find(s => s.effectiveFrom <= target) || settings[0]
}

export function taxSnapshot(setting) {
  const s = normalizeTaxSetting(setting)
  return { mode: s.mode, rateBps: s.rateBps, vatNumber: taxEnabled(s) ? s.vatNumber : '', effectiveFrom: s.effectiveFrom }
}

/** يحسب البيع من مجموع أسعار البنود وفق وضع المنشأة. */
export function saleAmounts(baseAmount, setting) {
  const base = Math.max(0, Math.round(Number(baseAmount) || 0))
  const s = normalizeTaxSetting(setting)
  if (!taxEnabled(s) || s.rateBps === 0) return { net: base, vat: 0, total: base }
  if (s.mode === 'inclusive') {
    const net = Math.round((base * 10000) / (10000 + s.rateBps))
    return { net, vat: base - net, total: base }
  }
  const vat = Math.round((base * s.rateBps) / 10000)
  return { net: base, vat, total: base + vat }
}

/** أثر فاتورة المورد على المصروف: غير المسجل يتحمل الإجمالي، والمسجل يفصل الضريبة. */
export function expenseAmounts(netAmount, vatAmount, setting) {
  const net = Math.max(0, Math.round(Number(netAmount) || 0))
  const documentVat = Math.max(0, Math.round(Number(vatAmount) || 0))
  if (!taxEnabled(setting)) return { expenseAmount: net + documentVat, separatedVat: 0 }
  return { expenseAmount: net, separatedVat: documentVat }
}

export function taxModeLabel(setting) {
  return TAX_MODE[normalizeTaxSetting(setting).mode].short
}
